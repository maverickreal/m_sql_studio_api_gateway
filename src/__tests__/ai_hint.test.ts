import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";

const { mockGetSession, mockGetAssignmentByIdCached } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockGetAssignmentByIdCached: vi.fn(),
}));

vi.mock("../auth", () => ({
  auth: {
    api: {
      getSession: mockGetSession,
    },
  },
}));

vi.mock("../services/assignment_cache", () => ({
  getAssignmentByIdCached: mockGetAssignmentByIdCached,
}));

import app from "../app";
import {
  resolveAiModel,
  setAiModelForTests,
  setAuditLoggerForTests,
  setConsentStoreForTests,
  isOwnerOnly,
} from "../services/ai_hint";
import { InMemoryAuditLogger, InMemoryConsentStore } from "../services/hint_stack";
import { envVars } from "../config";

function createMockStreamingModel(textChunks: string[] = ["Check ", "your ", "JOIN syntax"]) {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          ...textChunks.map((delta, i) => ({
            type: "text-delta" as const,
            id: String(i),
            delta,
          })),
          {
            type: "finish" as const,
            finishReason: { raw: "stop", unified: "stop" as const },
            usage: { inputTokens: { total: 10 }, outputTokens: { total: 5 } },
          },
        ],
      }),
    }),
  });
}

describe("Vercel AI SDK Hint Path (Card t_77fe60f5)", () => {
  let auditLogger: InMemoryAuditLogger;
  let consentStore: InMemoryConsentStore;

  beforeEach(() => {
    vi.clearAllMocks();
    auditLogger = new InMemoryAuditLogger();
    consentStore = new InMemoryConsentStore(false);
    setAuditLoggerForTests(auditLogger);
    setConsentStoreForTests(consentStore);
  });

  afterEach(() => {
    setAiModelForTests(null);
    setAuditLoggerForTests(null);
    setConsentStoreForTests(null);
  });

  describe("Authentication and Validation", () => {
    it("returns 401 when unauthenticated", async () => {
      mockGetSession.mockResolvedValue(null);

      const res = await request(app)
        .post("/api/v1/assignments/hint")
        .send({
          failedSql: "SELECT * FROM users",
          error: 'column "foo" does not exist',
        });

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: "Authentication required" });
    });

    it("returns 400 when failedSql or error is missing", async () => {
      mockGetSession.mockResolvedValue({
        user: { id: "user-1", email: "learner@msql.dev", role: "user" },
        session: { id: "sess-1" },
      });

      const res1 = await request(app)
        .post("/api/v1/assignments/hint")
        .send({ failedSql: "SELECT 1" });
      expect(res1.status).toBe(400);

      const res2 = await request(app)
        .post("/api/v1/assignments/hint")
        .send({ error: "syntax error" });
      expect(res2.status).toBe(400);
    });
  });

  describe("Hint Streaming (POST /api/v1/assignments/hint)", () => {
    beforeEach(() => {
      mockGetSession.mockResolvedValue({
        user: { id: "user-1", email: "learner@msql.dev", role: "user" },
        session: { id: "sess-1" },
      });
    });

    it("streams plain text response back to client with no SSE framing", async () => {
      const mockModel = createMockStreamingModel(["Check ", "your ", "GROUP BY"]);
      setAiModelForTests(mockModel);

      const res = await request(app)
        .post("/api/v1/assignments/hint")
        .send({
          schemaExcerpt: "CREATE TABLE employees (id INT, dept_id INT, salary INT);",
          assignmentDescription: "Calculate average salary by department",
          failedSql: "SELECT dept_id, AVG(salary) FROM employees;",
          error: 'column "employees.dept_id" must appear in the GROUP BY clause',
        });

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("text/plain");
      // Must not contain SSE framing ("data: ..." or "event: ...")
      expect(res.text).not.toContain("data:");
      expect(res.text).not.toContain("event:");
      expect(res.text).toBe("Check your GROUP BY");
    });

    it("fetches assignment schema and description when assignmentId is provided", async () => {
      const mockModel = createMockStreamingModel(["Use INNER JOIN"]);
      setAiModelForTests(mockModel);

      mockGetAssignmentByIdCached.mockResolvedValue({
        _id: "650000000000000000000001",
        description: "Join customers and orders to find total spent.",
        sampleInput: ["customers(id, name)", "orders(id, customer_id, amount)"],
      });

      const res = await request(app)
        .post("/api/v1/assignments/hint")
        .send({
          assignmentId: "650000000000000000000001",
          failedSql: "SELECT * FROM customers, orders;",
          error: "Cartesian product not allowed",
        });

      expect(res.status).toBe(200);
      expect(res.text).toBe("Use INNER JOIN");
      expect(mockGetAssignmentByIdCached).toHaveBeenCalledWith("650000000000000000000001");
    });
  });

  describe("Provider Swappability & Defaults (Env-swappable via single switch)", () => {
    it("defaults to local model (mlx-serve :3208) when AI_PROVIDER is unset or local", () => {
      const origProvider = envVars.AI_PROVIDER;
      (envVars as any).AI_PROVIDER = "local";

      const resolution = resolveAiModel();
      expect(resolution.isLocal).toBe(true);
      expect(resolution.providerName).toBe("local");
      expect(resolution.modelName).toBe("LFM2.5-8B-A1B-MLX-6bit");

      (envVars as any).AI_PROVIDER = origProvider;
    });

    it("resolves to OpenAI provider when AI_PROVIDER=openai", () => {
      const origProvider = envVars.AI_PROVIDER;
      (envVars as any).AI_PROVIDER = "openai";

      const resolution = resolveAiModel();
      expect(resolution.isLocal).toBe(false);
      expect(resolution.providerName).toBe("openai");
      expect(resolution.modelName).toBe("gpt-4o-mini");

      (envVars as any).AI_PROVIDER = origProvider;
    });

    it("resolves to Anthropic provider when AI_PROVIDER=anthropic", () => {
      const origProvider = envVars.AI_PROVIDER;
      (envVars as any).AI_PROVIDER = "anthropic";

      const resolution = resolveAiModel();
      expect(resolution.isLocal).toBe(false);
      expect(resolution.providerName).toBe("anthropic");
      expect(resolution.modelName).toBe("claude-3-5-haiku-latest");

      (envVars as any).AI_PROVIDER = origProvider;
    });

    it("resolves to Google provider when AI_PROVIDER=google", () => {
      const origProvider = envVars.AI_PROVIDER;
      (envVars as any).AI_PROVIDER = "google";

      const resolution = resolveAiModel();
      expect(resolution.isLocal).toBe(false);
      expect(resolution.providerName).toBe("google");
      expect(resolution.modelName).toBe("gemini-2.5-flash");

      (envVars as any).AI_PROVIDER = origProvider;
    });

    it("honors AI_MODEL override across any provider", () => {
      const origProvider = envVars.AI_PROVIDER;
      const origModel = envVars.AI_MODEL;
      (envVars as any).AI_PROVIDER = "openai";
      (envVars as any).AI_MODEL = "gpt-4o";

      const resolution = resolveAiModel();
      expect(resolution.modelName).toBe("gpt-4o");

      (envVars as any).AI_PROVIDER = origProvider;
      (envVars as any).AI_MODEL = origModel;
    });
  });

  describe("HINT Consent and Audit Semantics (PII Guard & Consent Gate)", () => {
    beforeEach(() => {
      mockGetSession.mockResolvedValue({
        user: { id: "user-42", email: "student@msql.dev", role: "user" },
        session: { id: "sess-42" },
      });
    });

    it("detects private indicators (isOwnerOnly)", () => {
      expect(isOwnerOnly("private_accounts(id INT, ssn TEXT)")).toBe(true);
      expect(isOwnerOnly("users(id INT, salary INT)")).toBe(true);
      expect(isOwnerOnly("SELECT password FROM credentials")).toBe(true);
      expect(isOwnerOnly("public_catalog(id INT, item_name TEXT)")).toBe(false);
    });

    it("prevents PII off-box: forces local model and logs pii_off_box when owner_only", async () => {
      const origProvider = envVars.AI_PROVIDER;
      (envVars as any).AI_PROVIDER = "openai";

      const mockModel = createMockStreamingModel(["Local hint for private data"]);
      setAiModelForTests(mockModel);

      const res = await request(app)
        .post("/api/v1/assignments/hint")
        .send({
          schemaExcerpt: "private_employees(id INT, ssn TEXT, salary INT);",
          assignmentDescription: "Analyze salaries",
          failedSql: "SELECT salary FROM private_employees;",
          error: "syntax error",
        });

      expect(res.status).toBe(200);
      const events = auditLogger.getEvents();
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "hint_suppressed",
          reason: "pii_off_box",
          classification: "owner_only",
        }),
      );
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "hint_generated",
          route: "owner_only",
        }),
      );

      (envVars as any).AI_PROVIDER = origProvider;
    });

    it("suppresses remote inference and falls back to local when say consent is false", async () => {
      const origProvider = envVars.AI_PROVIDER;
      const origSay = envVars.HINT_SAY;
      (envVars as any).AI_PROVIDER = "google";
      (envVars as any).HINT_SAY = "false";
      await consentStore.setSayConsent(false);

      const mockModel = createMockStreamingModel(["Fallback local hint"]);
      setAiModelForTests(mockModel);

      const res = await request(app)
        .post("/api/v1/assignments/hint")
        .send({
          schemaExcerpt: "products(id INT, title TEXT, price INT);",
          assignmentDescription: "List products",
          failedSql: "SELECT * FROM products;",
          error: "syntax error",
        });

      expect(res.status).toBe(200);
      const events = auditLogger.getEvents();
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "hint_suppressed",
          reason: "no_say_consent",
          classification: "shared",
        }),
      );
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "hint_fallback",
          route: "shared_fallback_local",
        }),
      );

      (envVars as any).AI_PROVIDER = origProvider;
      (envVars as any).HINT_SAY = origSay;
    });

    it("allows remote inference on shared data when say consent is granted", async () => {
      const origProvider = envVars.AI_PROVIDER;
      const origSay = envVars.HINT_SAY;
      (envVars as any).AI_PROVIDER = "google";
      (envVars as any).HINT_SAY = "true";
      await consentStore.setSayConsent(true);

      const mockModel = createMockStreamingModel(["Remote Gemini hint"]);
      setAiModelForTests(mockModel);

      const res = await request(app)
        .post("/api/v1/assignments/hint")
        .send({
          schemaExcerpt: "products(id INT, title TEXT, price INT);",
          assignmentDescription: "List products",
          failedSql: "SELECT * FROM products;",
          error: "syntax error",
        });

      expect(res.status).toBe(200);
      const events = auditLogger.getEvents();
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "hint_generated",
          route: "shared",
        }),
      );

      (envVars as any).AI_PROVIDER = origProvider;
      (envVars as any).HINT_SAY = origSay;
    });
  });
});
