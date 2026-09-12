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
  maybeAttachOwnerHint,
  getHintHealth,
  isLoopbackUrl,
  generateHintStream,
  InMemoryAuditLogger,
  InMemoryConsentStore,
} from "../services/ai_hint";
import { TaskQueueClient } from "../services";
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

  describe("Job Status Hint Attachment (maybeAttachOwnerHint)", () => {
    it("attaches hint to failed job result when requester is owner", async () => {
      const origEnabled = envVars.HINT_ENABLED;
      (envVars as any).HINT_ENABLED = "true";

      try {
        const mockModel = createMockStreamingModel(["Check your WHERE clause"]);
        setAiModelForTests(mockModel);

        vi.spyOn(TaskQueueClient, "getJob").mockResolvedValue({
          data: {
            userSql: "SELECT * FROM users WHERE foo = 1",
            assignmentSchema: "users(id INT, name TEXT)",
          },
        } as any);

        const payload = {
          status: "completed",
          result: {
            passed: false,
            error: "column foo does not exist",
          },
        };

        const withHint = await maybeAttachOwnerHint(payload, {
          taskId: "123",
          ownerUserId: "user-1",
          requesterId: "user-1",
        });

        expect(withHint.result).toEqual({
          passed: false,
          error: "column foo does not exist",
          hint: "Check your WHERE clause",
        });
      } finally {
        (envVars as any).HINT_ENABLED = origEnabled;
      }
    });

    it("does NOT attach hint if requester is not owner", async () => {
      const payload = {
        status: "completed",
        result: { passed: false, error: "column foo does not exist" },
      };

      const withHint = await maybeAttachOwnerHint(payload, {
        taskId: "123",
        ownerUserId: "user-1",
        requesterId: "user-2",
      });

      expect((withHint.result as any).hint).toBeUndefined();
    });

    it("does NOT attach hint if job passed", async () => {
      const payload = {
        status: "completed",
        result: { passed: true },
      };

      const withHint = await maybeAttachOwnerHint(payload, {
        taskId: "123",
        ownerUserId: "user-1",
        requesterId: "user-1",
      });

      expect((withHint.result as any)?.hint).toBeUndefined();
    });

    it("does NOT attach hint when HINT_ENABLED=false", async () => {
      const origEnabled = envVars.HINT_ENABLED;
      (envVars as any).HINT_ENABLED = "false";

      const payload = {
        status: "completed",
        result: { passed: false, error: "failed" },
      };

      const withHint = await maybeAttachOwnerHint(payload, {
        taskId: "123",
        ownerUserId: "user-1",
        requesterId: "user-1",
      });

      expect((withHint.result as any).hint).toBeUndefined();

      (envVars as any).HINT_ENABLED = origEnabled;
    });
  });

  describe("Health Endpoint and Functions (GET /api/v1/sat/hints/health)", () => {
    it("returns 401 when unauthenticated", async () => {
      mockGetSession.mockResolvedValue(null);

      const res = await request(app).get("/api/v1/sat/hints/health");
      expect(res.status).toBe(401);
    });

    it("returns health response when authenticated and enabled", async () => {
      const origEnabled = envVars.HINT_ENABLED;
      (envVars as any).HINT_ENABLED = "true";

      try {
        mockGetSession.mockResolvedValue({
          user: { id: "user-1", email: "learner@msql.dev", role: "user" },
          session: { id: "sess-1" },
        });

        vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));

        const res = await request(app).get("/api/v1/sat/hints/health");
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty("ollama");
        expect(res.body).toHaveProperty("gemini");
        expect(res.body.enabled).toBe(true);

        vi.unstubAllGlobals();
      } finally {
        (envVars as any).HINT_ENABLED = origEnabled;
      }
    });

    it("returns down and disabled when HINT_ENABLED=false", async () => {
      const origEnabled = envVars.HINT_ENABLED;
      (envVars as any).HINT_ENABLED = "false";

      mockGetSession.mockResolvedValue({
        user: { id: "user-1", email: "learner@msql.dev", role: "user" },
        session: { id: "sess-1" },
      });

      const res = await request(app).get("/api/v1/sat/hints/health");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        ollama: "down",
        gemini: "unconfigured",
        enabled: false,
      });

      (envVars as any).HINT_ENABLED = origEnabled;
    });

    it("evaluates loopback urls correctly", () => {
      expect(isLoopbackUrl("http://127.0.0.1:3208/v1")).toBe(true);
      expect(isLoopbackUrl("http://localhost:3208/v1")).toBe(true);
      expect(isLoopbackUrl("http://host.docker.internal:3208/v1")).toBe(true);
      expect(isLoopbackUrl("https://api.openai.com/v1")).toBe(false);
    });
  });

  describe("live local LFM2.5 model (mlx-serve on 127.0.0.1:3208)", () => {
    it("returns hint text from local LFM2.5 via Vercel AI SDK when model is running", async () => {
      vi.unstubAllGlobals();
      const healthRes = await fetch("http://127.0.0.1:3208/v1/models").catch(() => null);
      if (!healthRes?.ok) {
        console.warn("mlx-serve is not running, skipping live model assertion");
        return;
      }

      setAiModelForTests(null);
      const stream = await generateHintStream({
        schemaExcerpt: "CREATE TABLE users (id int, name text);",
        assignmentDescription: "SQL query debugging and assistance",
        failedSql: "SELECT * FORM users;",
        error: 'syntax error at or near "FORM"',
        taskId: "live-test-1",
        userId: "user-live",
      });

      let fullText = "";
      for await (const delta of stream.textStream) {
        fullText += delta;
      }
      expect(fullText).toBeTruthy();
    }, 25000);
  });

  describe("Live End-to-End Proof (Card Requirement 5)", () => {
    it("executes live assignment-hint request returning 200 with live hint content", async () => {
      vi.unstubAllGlobals();
      const healthRes = await fetch("http://127.0.0.1:3208/v1/models").catch(() => null);
      if (!healthRes?.ok) {
        console.warn("mlx-serve is not running, skipping live proof");
        return;
      }

      const origEnabled = envVars.HINT_ENABLED;
      (envVars as any).HINT_ENABLED = "true";
      setAiModelForTests(null);

      try {
        mockGetSession.mockResolvedValue({
          user: { id: "user-live-proof", email: "live@msql.dev", role: "user" },
          session: { id: "sess-live-proof" },
        });

        const res = await request(app)
          .post("/api/v1/assignments/hint")
          .send({
            schemaExcerpt: "CREATE TABLE users (id int, name text);",
            assignmentDescription: "Select all users",
            failedSql: "SELECT * FORM users;",
            error: 'syntax error at or near "FORM"',
          });

        expect(res.status).toBe(200);
        expect(res.text).toBeTruthy();
        console.log("\n[LIVE PROOF] Assignment Hint 200 OK ->", res.text.trim());
      } finally {
        (envVars as any).HINT_ENABLED = origEnabled;
      }
    }, 30000);

    it("executes live job-hint request returning 200 with live hint content attached", async () => {
      vi.unstubAllGlobals();
      const healthRes = await fetch("http://127.0.0.1:3208/v1/models").catch(() => null);
      if (!healthRes?.ok) {
        console.warn("mlx-serve is not running, skipping live proof");
        return;
      }

      const origEnabled = envVars.HINT_ENABLED;
      (envVars as any).HINT_ENABLED = "true";
      setAiModelForTests(null);

      try {
        mockGetSession.mockResolvedValue({
          user: { id: "user-live-proof", email: "live@msql.dev", role: "user" },
          session: { id: "sess-live-proof" },
        });

        vi.spyOn(TaskQueueClient, "getStatus").mockResolvedValue({
          status: "completed",
          ownerUserId: "user-live-proof",
          result: {
            passed: false,
            error: 'syntax error at or near "FORM"',
          },
        } as any);

        vi.spyOn(TaskQueueClient, "getJob").mockResolvedValue({
          data: {
            userSql: "SELECT * FORM users;",
            assignmentSchema: "CREATE TABLE users (id int, name text);",
          },
        } as any);

        const res = await request(app).get(
          "/api/v1/assignments/client-sql-code-run/status/12345",
        );

        expect(res.status).toBe(200);
        expect(res.body.result).toHaveProperty("hint");
        expect(res.body.result.hint).toBeTruthy();
        console.log("\n[LIVE PROOF] Job Hint 200 OK ->", JSON.stringify(res.body, null, 2));
      } finally {
        (envVars as any).HINT_ENABLED = origEnabled;
      }
    }, 30000);
  });
});


