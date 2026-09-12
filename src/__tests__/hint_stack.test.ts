import { describe, it, expect, vi, beforeEach } from "vitest";
import { HintRouter } from "../services/hint_stack/hint-router";
import { OllamaHintProvider } from "../services/hint_stack/ollama-hint-provider";
import { GeminiHintProvider } from "../services/hint_stack/gemini-hint-provider";
import { InMemoryConsentStore } from "../services/hint_stack/consent-store";
import { InMemoryAuditLogger } from "../services/hint_stack/audit-logger";
import { isLoopbackUrl } from "../services/hint_stack/openai-http";
import type { HintPrompt } from "../services/hint_stack/types";

const basePrompt: HintPrompt = {
  taskId: "task-123",
  userQuery: "SELECT * FROM users WHERE name = 'John'",
  schemaContext: "users(id INT, name TEXT, email TEXT)",
  failureReason: "column \"John\" does not exist",
  attemptNumber: 1,
};

const jsonResponse = (content: string, model: string) =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 50, completion_tokens: 20 },
      model,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

const makeProviders = () => {
  const ollama = new OllamaHintProvider({
    host: "http://127.0.0.1:3208/v1",
    model: "LFM2.5-8B-A1B-MLX-6bit",
  });
  const gemini = new GeminiHintProvider({
    host: "https://generativelanguage.googleapis.com/v1beta/openai",
    apiKey: "test-key",
    model: "gemini-3.5-flash",
  });
  return { ollama, gemini };
};

describe("HITL Hint Stack (ADR 005)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("loopback guard", () => {
    it("treats localhost and 127.0.0.1 as on-box", () => {
      expect(isLoopbackUrl("http://127.0.0.1:11434/v1")).toBe(true);
      expect(isLoopbackUrl("http://localhost:11434/v1")).toBe(true);
      expect(isLoopbackUrl("https://generativelanguage.googleapis.com/v1beta/openai")).toBe(
        false,
      );
    });
  });

  describe("classification", () => {
    it("classifies a query referencing user-owned tables as owner_only", async () => {
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        expect(url.startsWith("http://127.0.0.1")).toBe(true);
        return jsonResponse("Try using double quotes for string literals", "gemma3:4b");
      });
      vi.stubGlobal("fetch", fetchMock);

      const { ollama, gemini } = makeProviders();
      const router = new HintRouter(
        ollama,
        gemini,
        new InMemoryConsentStore(false),
        new InMemoryAuditLogger(),
      );

      const result = await router.getHint({
        ...basePrompt,
        schemaContext: "private_dataset(id INT, secret TEXT)",
      });
      expect(result).not.toBeNull();
      expect(result?.model).toBe("LFM2.5-8B-A1B-MLX-6bit");
    });

    it("classifies a query on public/shared datasets as shared", async () => {
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        expect(url.includes("generativelanguage.googleapis.com")).toBe(true);
        return jsonResponse("Use parameterized queries", "gemini-3.5-flash");
      });
      vi.stubGlobal("fetch", fetchMock);

      const { ollama, gemini } = makeProviders();
      const router = new HintRouter(
        ollama,
        gemini,
        new InMemoryConsentStore(true),
        new InMemoryAuditLogger(),
      );

      const result = await router.getHint({
        ...basePrompt,
        schemaContext: "public_dataset(id INT, data TEXT)",
        failureReason: "syntax error",
      });
      expect(result?.model).toBe("gemini-3.5-flash");
    });
  });

  describe("failed vs successful submit", () => {
    it("generates a hint on failed submit", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          jsonResponse("Try using double quotes for string literals", "gemma3:4b"),
        ),
      );

      const { ollama, gemini } = makeProviders();
      const router = new HintRouter(
        ollama,
        gemini,
        new InMemoryConsentStore(false),
        new InMemoryAuditLogger(),
      );

      const result = await router.getHint({
        ...basePrompt,
        failureReason: "relation \"users\" does not exist",
      });
      expect(result).not.toBeNull();
      expect(result?.text).toBeTruthy();
    });

    it("does NOT generate a hint on successful submit (failureReason empty)", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      const { ollama, gemini } = makeProviders();
      const router = new HintRouter(
        ollama,
        gemini,
        new InMemoryConsentStore(false),
        new InMemoryAuditLogger(),
      );

      const result = await router.getHint({
        ...basePrompt,
        failureReason: "",
      });
      expect(result).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("say consent gate", () => {
    it("suppresses shared hint when say=false and falls back to Ollama", async () => {
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        expect(String(input).startsWith("http://127.0.0.1")).toBe(true);
        return jsonResponse("local fallback hint", "gemma3:4b");
      });
      vi.stubGlobal("fetch", fetchMock);

      const { ollama, gemini } = makeProviders();
      const router = new HintRouter(
        ollama,
        gemini,
        new InMemoryConsentStore(false),
        new InMemoryAuditLogger(),
      );

      const result = await router.getHint({
        ...basePrompt,
        schemaContext: "public_dataset(id INT, data TEXT)",
      });
      expect(result?.model).toBe("LFM2.5-8B-A1B-MLX-6bit");
    });

    it("routes shared hint to Gemini when say=true", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => jsonResponse("Use parameterized queries", "gemini-3.5-flash")),
      );

      const { ollama, gemini } = makeProviders();
      const router = new HintRouter(
        ollama,
        gemini,
        new InMemoryConsentStore(true),
        new InMemoryAuditLogger(),
      );

      const result = await router.getHint({
        ...basePrompt,
        schemaContext: "public_dataset(id INT, data TEXT)",
      });
      expect(result?.model).toBe("gemini-3.5-flash");
    });
  });

  describe("owner-only visibility", () => {
    it("never routes owner_only hints to Gemini (PII-off-box guard)", async () => {
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        expect(String(input).includes("googleapis.com")).toBe(false);
        return jsonResponse("keep it local", "gemma3:4b");
      });
      vi.stubGlobal("fetch", fetchMock);

      const { ollama, gemini } = makeProviders();
      const router = new HintRouter(
        ollama,
        gemini,
        new InMemoryConsentStore(true),
        new InMemoryAuditLogger(),
      );

      const result = await router.getHint({
        ...basePrompt,
        schemaContext: "private_user_data(id INT, ssn TEXT, salary INT)",
      });
      expect(result?.model).toBe("LFM2.5-8B-A1B-MLX-6bit");
    });
  });

  describe("PII-off-box guard", () => {
    it("suppresses hint entirely when owner-only and Ollama is down", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("down", { status: 500 })),
      );

      const { ollama, gemini } = makeProviders();
      const router = new HintRouter(
        ollama,
        gemini,
        new InMemoryConsentStore(false),
        new InMemoryAuditLogger(),
      );

      const result = await router.getHint({
        ...basePrompt,
        schemaContext: "private_dataset(id INT, secret TEXT)",
      });
      expect(result).toBeNull();
    });

    it("does not call a non-loopback host for owner-only hints", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      const ollama = new OllamaHintProvider({
        host: "https://generativelanguage.googleapis.com/v1beta/openai",
        model: "gemma3:4b",
      });
      const gemini = new GeminiHintProvider({
        host: "https://generativelanguage.googleapis.com/v1beta/openai",
        apiKey: "test-key",
        model: "gemini-3.5-flash",
      });
      const router = new HintRouter(
        ollama,
        gemini,
        new InMemoryConsentStore(true),
        new InMemoryAuditLogger(),
      );

      const result = await router.getHint({
        ...basePrompt,
        schemaContext: "private_dataset(id INT, secret TEXT)",
      });
      expect(result).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("fallback chain", () => {
    it("falls back from Gemini to Ollama on shared hint when Gemini fails", async () => {
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("googleapis.com")) {
          return new Response("nope", { status: 429 });
        }
        return jsonResponse("local fallback hint", "gemma3:4b");
      });
      vi.stubGlobal("fetch", fetchMock);

      const { ollama, gemini } = makeProviders();
      const router = new HintRouter(
        ollama,
        gemini,
        new InMemoryConsentStore(true),
        new InMemoryAuditLogger(),
      );

      const result = await router.getHint({
        ...basePrompt,
        schemaContext: "public_dataset(id INT, data TEXT)",
      });
      expect(result?.model).toBe("LFM2.5-8B-A1B-MLX-6bit");
    });

    it("suppresses hint when both Gemini and Ollama fail", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("down", { status: 500 })),
      );

      const { ollama, gemini } = makeProviders();
      const router = new HintRouter(
        ollama,
        gemini,
        new InMemoryConsentStore(true),
        new InMemoryAuditLogger(),
      );

      const result = await router.getHint({
        ...basePrompt,
        schemaContext: "public_dataset(id INT, data TEXT)",
      });
      expect(result).toBeNull();
    });
  });

  describe("consent revocation", () => {
    it("stops routing to Gemini after consent revoked", async () => {
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        expect(String(input).includes("googleapis.com")).toBe(false);
        return jsonResponse("local after revoke", "gemma3:4b");
      });
      vi.stubGlobal("fetch", fetchMock);

      const { ollama, gemini } = makeProviders();
      const consent = new InMemoryConsentStore(true);
      await consent.setSayConsent(false);
      const router = new HintRouter(
        ollama,
        gemini,
        consent,
        new InMemoryAuditLogger(),
      );

      const result = await router.getHint({
        ...basePrompt,
        schemaContext: "public_dataset(id INT, data TEXT)",
      });
      expect(result?.model).toBe("LFM2.5-8B-A1B-MLX-6bit");
    });
  });

  describe("audit logging", () => {
    it("emits hint_generated event on successful generation", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => jsonResponse("ok", "gemma3:4b")),
      );

      const { ollama, gemini } = makeProviders();
      const audit = new InMemoryAuditLogger();
      const router = new HintRouter(
        ollama,
        gemini,
        new InMemoryConsentStore(false),
        audit,
      );

      await router.getHint({
        ...basePrompt,
        schemaContext: "private_dataset(id INT)",
      });

      expect(audit.getEvents()).toContainEqual(
        expect.objectContaining({ type: "hint_generated" }),
      );
    });

    it("emits hint_suppressed event when no say consent", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => jsonResponse("local", "gemma3:4b")),
      );

      const { ollama, gemini } = makeProviders();
      const audit = new InMemoryAuditLogger();
      const router = new HintRouter(
        ollama,
        gemini,
        new InMemoryConsentStore(false),
        audit,
      );

      await router.getHint({
        ...basePrompt,
        schemaContext: "public_dataset(id INT)",
      });

      expect(audit.getEvents()).toContainEqual(
        expect.objectContaining({
          type: "hint_suppressed",
          reason: "no_say_consent",
        }),
      );
    });
  });

  describe("kill switch", () => {
    it("returns no hint when disabled", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      const { ollama, gemini } = makeProviders();
      const router = new HintRouter(
        ollama,
        gemini,
        new InMemoryConsentStore(false),
        new InMemoryAuditLogger(),
        { enabled: false },
      );

      const result = await router.getHint(basePrompt);
      expect(result).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("provider health", () => {
    it("Ollama provider has correct classification and name", () => {
      const ollama = new OllamaHintProvider({
        host: "http://127.0.0.1:11434/v1",
        model: "gemma3:4b",
      });
      expect(ollama.classification).toBe("owner_only");
      expect(ollama.name).toBe("ollama/gemma3:4b");
    });

    it("Gemini provider has correct classification and name", () => {
      const gemini = new GeminiHintProvider({
        host: "https://generativelanguage.googleapis.com/v1beta/openai",
        apiKey: "test-key",
        model: "gemini-3.5-flash",
      });
      expect(gemini.classification).toBe("shared");
      expect(gemini.name).toBe("gemini/gemini-3.5-flash");
    });
  });

  describe("health endpoint", () => {
    it("returns health status for both providers", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("{}", { status: 200 })),
      );

      const { ollama, gemini } = makeProviders();
      const router = new HintRouter(
        ollama,
        gemini,
        new InMemoryConsentStore(false),
        new InMemoryAuditLogger(),
      );

      const health = await router.getHealth();
      expect(health).toHaveProperty("ollama");
      expect(health).toHaveProperty("gemini");
    });
  });
});
