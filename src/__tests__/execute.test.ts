import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const {
  mockGetSession,
  mockGetAssignmentByIdCached,
  mockGetAssignmentSolutionByAssignmentIdCached,
  mockEnqueue,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockGetAssignmentByIdCached: vi.fn(),
  mockGetAssignmentSolutionByAssignmentIdCached: vi.fn(),
  mockEnqueue: vi.fn(),
}));

vi.mock("../auth", () => ({
  auth: {
    api: {
      getSession: mockGetSession,
    },
  },
}));

vi.mock("../services", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services")>();
  return {
    ...actual,
    getAssignmentByIdCached: mockGetAssignmentByIdCached,
    getAssignmentSolutionByAssignmentIdCached:
      mockGetAssignmentSolutionByAssignmentIdCached,
    TaskQueueClient: {
      ...actual.TaskQueueClient,
      enqueue: mockEnqueue,
    },
  };
});

import app from "../app";

describe("POST /api/v1/assignments/client-sql-code-run/execute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when user is not authenticated", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await request(app)
      .post("/api/v1/assignments/client-sql-code-run/execute")
      .send({
        assignmentId: "650000000000000000000001",
        userSql: "SELECT 1;",
      });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Authentication required" });
  });

  it("returns 403 when user email is not verified", async () => {
    mockGetSession.mockResolvedValue({
      user: {
        id: "user-100",
        email: "student@example.com",
        role: "user",
        emailVerified: false,
      },
      session: { id: "session-100" },
    });

    const res = await request(app)
      .post("/api/v1/assignments/client-sql-code-run/execute")
      .send({
        assignmentId: "650000000000000000000001",
        userSql: "SELECT 1;",
      });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Email verification required" });
  });

  describe("Authenticated user tests", () => {
    beforeEach(() => {
      mockGetSession.mockResolvedValue({
        user: {
          id: "user-100",
          email: "student@example.com",
          role: "user",
          emailVerified: true,
        },
        session: { id: "session-100" },
      });
    });

    it("returns 400 when request body is empty / missing", async () => {
      const res = await request(app)
        .post("/api/v1/assignments/client-sql-code-run/execute")
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it("returns 400 when assignmentId is missing", async () => {
      const res = await request(app)
        .post("/api/v1/assignments/client-sql-code-run/execute")
        .send({ userSql: "SELECT * FROM users;" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it("returns 400 when userSql is missing", async () => {
      const res = await request(app)
        .post("/api/v1/assignments/client-sql-code-run/execute")
        .send({ assignmentId: "650000000000000000000001" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it("returns 400 when assignmentId is invalid string (not ObjectId)", async () => {
      const res = await request(app)
        .post("/api/v1/assignments/client-sql-code-run/execute")
        .send({
          assignmentId: "invalid-id",
          userSql: "SELECT 1;",
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it("returns 404 when assignment is not found in DB/cache", async () => {
      mockGetAssignmentByIdCached.mockResolvedValue(null);

      const res = await request(app)
        .post("/api/v1/assignments/client-sql-code-run/execute")
        .send({
          assignmentId: "650000000000000000000001",
          userSql: "SELECT 1;",
        });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Couldn't find the assignment!" });
    });

    it("returns 503 when assignment pgSchemaReady is false", async () => {
      mockGetAssignmentByIdCached.mockResolvedValue({
        _id: "650000000000000000000001",
        pgSchemaReady: false,
        mode: "read",
      });

      const res = await request(app)
        .post("/api/v1/assignments/client-sql-code-run/execute")
        .send({
          assignmentId: "650000000000000000000001",
          userSql: "SELECT 1;",
        });

      expect(res.status).toBe(503);
      expect(res.body).toEqual({
        error: "Assignment unavailable at the moment!",
      });
    });

    it("returns 202 and enqueues execution job on valid body and ready assignment", async () => {
      mockGetAssignmentByIdCached.mockResolvedValue({
        _id: "650000000000000000000001",
        pgSchemaReady: true,
        mode: "read",
      });
      mockGetAssignmentSolutionByAssignmentIdCached.mockResolvedValue({
        solutionSql: "SELECT * FROM users;",
        validationSql: "SELECT COUNT(*) FROM users;",
        orderMatters: true,
      });
      mockEnqueue.mockResolvedValue("task-job-999");

      const res = await request(app)
        .post("/api/v1/assignments/client-sql-code-run/execute")
        .send({
          assignmentId: "650000000000000000000001",
          userSql: "SELECT * FROM users;",
        });

      expect(res.status).toBe(202);
      expect(res.body).toEqual({ taskId: "task-job-999" });
      expect(mockEnqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          assignmentId: "650000000000000000000001",
          userSql: "SELECT * FROM users;",
          userId: "user-100",
          solutionSql: "SELECT * FROM users;",
          orderMatters: true,
        }),
      );
    });
  });
});
