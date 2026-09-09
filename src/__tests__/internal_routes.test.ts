import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const { mockEnqueueProblemsSyncJob, mockFind } = vi.hoisted(() => ({
  mockEnqueueProblemsSyncJob: vi.fn(),
  mockFind: vi.fn(),
}));

vi.mock("../services", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services")>();
  return {
    ...actual,
    TaskQueueClient: {
      ...actual.TaskQueueClient,
      enqueueProblemsSyncJob: mockEnqueueProblemsSyncJob,
    },
  };
});

vi.mock("../data/db/models/assignment", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../data/db/models/assignment")>();
  return {
    ...actual,
    Assignment: {
      ...actual.Assignment,
      find: mockFind,
    },
  };
});

import app from "../app";

describe("Internal API routes authentication & handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /internal/cleanup/old-schemas", () => {
    it("returns 401 without x-internal-api-key header", async () => {
      const res = await request(app).get("/internal/cleanup/old-schemas");

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: "Unauthorized!" });
    });

    it("returns 401 with wrong x-internal-api-key header", async () => {
      const res = await request(app)
        .get("/internal/cleanup/old-schemas")
        .set("x-internal-api-key", "wrong-key");

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: "Unauthorized!" });
    });

    it("returns 200 with valid x-internal-api-key header", async () => {
      mockFind.mockReturnValue({
        lean: vi.fn().mockResolvedValue([
          { _id: "650000000000000000000001" },
        ]),
      });

      const res = await request(app)
        .get("/internal/cleanup/old-schemas")
        .set("x-internal-api-key", "test-internal-api-key");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        schemaNames: ["assignment_schema_650000000000000000000001"],
        count: 1,
        page: 1,
        limit: 100,
        total: 1,
        totalPages: 1,
      });
    });
  });

  describe("POST /internal/problems-sync", () => {
    it("returns 401 without x-internal-api-key header", async () => {
      const res = await request(app).post("/internal/problems-sync");

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: "Unauthorized!" });
    });

    it("returns 401 with wrong x-internal-api-key header", async () => {
      const res = await request(app)
        .post("/internal/problems-sync")
        .set("x-internal-api-key", "wrong-key");

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: "Unauthorized!" });
    });

    it("returns 202 and enqueues sync job with valid x-internal-api-key header", async () => {
      mockEnqueueProblemsSyncJob.mockResolvedValue("job-sync-123");

      const res = await request(app)
        .post("/internal/problems-sync")
        .set("x-internal-api-key", "test-internal-api-key")
        .send({ forced: true });

      expect(res.status).toBe(202);
      expect(res.body).toEqual({ jobId: "job-sync-123" });
      expect(mockEnqueueProblemsSyncJob).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: "manual",
          forced: true,
        }),
      );
    });
  });
});
