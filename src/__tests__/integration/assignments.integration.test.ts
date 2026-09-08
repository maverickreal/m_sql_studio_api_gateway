import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("../../config", () => ({
  envVars: { CLIENT_URL: "http://localhost:3000" },
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../auth", () => ({
  auth: {
    api: {
      getSession: vi.fn().mockResolvedValue({
        user: {
          id: "test-user-id",
          email: "admin@test.com",
          name: "Test Admin",
          emailVerified: true,
          role: "admin",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        session: {
          id: "test-session-id",
          userId: "test-user-id",
          expiresAt: new Date(Date.now() + 86400_000),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      }),
    },
  },
  disconnectAuth: vi.fn(),
}));

vi.mock("../../middleware/api/api_logger", () => ({
  default: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../middleware/rate_limiter", () => ({
  GlobalRateLimitMware: (_req: any, _res: any, next: any) => next(),
  ExecuteRateLimitMware: (_req: any, _res: any, next: any) => next(),
}));

const {
  MockAssignment,
  MockAssignmentSolution,
  AssignmentValidatorSchema,
  AssignmentSolutionValidatorSchema,
} = vi.hoisted(() => {
  const { z } = require("zod/v4");

  const assignment = {
    create: vi.fn(),
    findByIdAndUpdate: vi.fn().mockResolvedValue({}),
    findByIdAndDelete: vi.fn().mockResolvedValue({}),
    findById: vi.fn().mockResolvedValue(null),
    find: vi.fn().mockReturnValue({
      skip: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue([]),
    }),
    countDocuments: vi.fn().mockResolvedValue(0),
  };

  const assignmentSolution = {
    create: vi.fn().mockResolvedValue({}),
    deleteMany: vi.fn().mockResolvedValue({}),
    deleteOne: vi.fn().mockResolvedValue({}),
  };

  const assignmentValidatorSchema = {
    title: z.string().nonempty(),
    description: z.string().nonempty(),
    difficulty: z.enum(["easy", "medium", "hard"]),
    mode: z.enum(["read", "write"]),
    sampleInput: z
      .array(z.string().nonempty().nonoptional())
      .nonempty()
      .nonoptional(),
    sampleOutput: z.string().nonempty(),
    pgSchemaReady: z.boolean().optional(),
    jobId: z.string().optional(),
  };

  const assignmentSolutionValidatorSchema = {
    solutionSql: z.string().nonempty().optional(),
    validationSql: z.string().nonempty().optional(),
    orderMatters: z.boolean().nonoptional(),
  };

  return {
    MockAssignment: assignment,
    MockAssignmentSolution: assignmentSolution,
    AssignmentValidatorSchema: assignmentValidatorSchema,
    AssignmentSolutionValidatorSchema: assignmentSolutionValidatorSchema,
  };
});

vi.mock("../../data", () => ({
  CacheClient: {
    get: vi.fn().mockResolvedValue({
      sendCommand: vi.fn(),
      ping: vi.fn().mockResolvedValue("PONG"),
    }),
    connect: vi.fn(),
    disconnect: vi.fn(),
  },
  Assignment: MockAssignment,
  AssignmentValidatorSchema,
  AssignmentSolution: MockAssignmentSolution,
  AssignmentSolutionValidatorSchema,
}));

vi.mock("../../data/db/models/assignment", () => ({
  default: MockAssignment,
  Assignment: MockAssignment,
  AssignmentValidatorSchema,
}));

vi.mock("../../data/db/models/assignment_solution", () => ({
  default: MockAssignmentSolution,
  AssignmentSolution: MockAssignmentSolution,
  AssignmentSolutionValidatorSchema,
}));

const { mockTaskQueueClient } = vi.hoisted(() => {
  const job = {
    waitUntilFinished: vi.fn().mockResolvedValue({ success: true }),
  };
  return {
    mockTaskQueueClient: {
      enqueue: vi.fn(),
      enqueueAdminAssignmentSeedJob: vi.fn(),
      getStatus: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
      clientInst: {
        getJob: vi.fn().mockResolvedValue(job),
      },
    },
  };
});

vi.mock("../../services/job_queue", () => ({
  default: mockTaskQueueClient,
}));

vi.mock("../../services", () => ({
  getAssignmentByIdCached: vi.fn(),
  getAssignmentSolutionByAssignmentIdCached: vi.fn(),
  TaskQueueClient: mockTaskQueueClient,
}));

import app from "../../app";
import * as services from "../../services";
import { Assignment } from "../../data/db/models/assignment";

describe("Assignments API Integration", () => {
  const validId = "507f1f77bcf86cd799439011";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/v1/assignments", () => {
    it("should return 200 and paginated list of assignments", async () => {
      const mockList = [{ _id: validId, title: "Test", difficulty: "easy" }];
      (Assignment.find as any).mockReturnValue({
        skip: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        lean: vi.fn().mockResolvedValue(mockList),
      });

      const res = await request(app).get("/api/v1/assignments");

      expect(res.status).toBe(200);
      expect(res.body.assignments).toEqual(mockList);
    });
  });

  describe("GET /api/v1/assignments/:id", () => {
    it("should return 200 and the assignment", async () => {
      const mockAssignment = {
        _id: validId,
        title: "Test",
        pgSchemaReady: true,
      };
      (services.getAssignmentByIdCached as any).mockResolvedValue(
        mockAssignment,
      );

      const res = await request(app).get(`/api/v1/assignments/${validId}`);

      expect(res.status).toBe(200);
      expect(res.body.assignment).toEqual(mockAssignment);
    });

    it("should return 404 if not found", async () => {
      (services.getAssignmentByIdCached as any).mockResolvedValue(null);

      const res = await request(app).get(`/api/v1/assignments/${validId}`);

      expect(res.status).toBe(404);
    });

    it("should return 503 if schema is not ready", async () => {
      const mockAssignment = {
        _id: validId,
        title: "Test",
        pgSchemaReady: false,
      };
      (services.getAssignmentByIdCached as any).mockResolvedValue(
        mockAssignment,
      );

      const res = await request(app).get(`/api/v1/assignments/${validId}`);

      expect(res.status).toBe(503);
      expect(res.body.error).toBe("Assignment unavailable at the moment!");
    });

    it("should return 400 for invalid id format", async () => {
      const res = await request(app).get("/api/v1/assignments/invalid-id");
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/v1/assignments/client-sql-code-run/execute", () => {
    it("should return 202 and taskId", async () => {
      (services.getAssignmentByIdCached as any).mockResolvedValue({
        id: validId,
        mode: "read",
        pgSchemaReady: true,
      });
      (
        services.getAssignmentSolutionByAssignmentIdCached as any
      ).mockResolvedValue({
        solutionSql: "SELECT 1",
        validationSql: null,
      });
      (services.TaskQueueClient.enqueue as any).mockResolvedValue("task-123");

      const res = await request(app)
        .post("/api/v1/assignments/client-sql-code-run/execute")
        .send({
          assignmentId: validId,
          userSql: "SELECT 1",
        });

      expect(res.status).toBe(202);
      expect(res.body.taskId).toBe("task-123");
    });

    it("should return 400 for validation failure", async () => {
      const res = await request(app)
        .post("/api/v1/assignments/client-sql-code-run/execute")
        .send({
          assignmentId: validId,
        });

      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/v1/admin/assignments", () => {
    const validPayload = {
      title: "Test Assignment",
      description: "A test description",
      difficulty: "easy",
      mode: "read",
      sampleInput: ["SELECT * FROM users"],
      sampleOutput: "expected output",
      initSql: "CREATE TABLE users (id INT);",
      orderMatters: true,
    };

    it("should return 201 with valid complete payload", async () => {
      const fakeId = "abc123";
      (Assignment.create as any).mockResolvedValue({ _id: fakeId });
      (
        services.TaskQueueClient.enqueueAdminAssignmentSeedJob as any
      ).mockResolvedValue("job-1");

      const res = await request(app)
        .post("/api/v1/admin/assignments")
        .send({
          ...validPayload,
          solutionSql: "SELECT 1",
          validationSql: "SELECT count(*) FROM t",
        });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ assignmentId: fakeId, jobId: "job-1" });
    });

    it("should return 201 with valid payload without optional fields", async () => {
      const fakeId = "abc456";
      (Assignment.create as any).mockResolvedValue({ _id: fakeId });
      (
        services.TaskQueueClient.enqueueAdminAssignmentSeedJob as any
      ).mockResolvedValue("job-2");

      const res = await request(app)
        .post("/api/v1/admin/assignments")
        .send(validPayload);

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ assignmentId: fakeId, jobId: "job-2" });
    });

    it("should return 400 for missing required field", async () => {
      const res = await request(app)
        .post("/api/v1/admin/assignments")
        .send({ title: "Only title" });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
    });

    it("should return 400 for invalid difficulty enum", async () => {
      const res = await request(app)
        .post("/api/v1/admin/assignments")
        .send({ ...validPayload, difficulty: "impossible" });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
    });

    it("should return 400 for empty body", async () => {
      const res = await request(app).post("/api/v1/admin/assignments").send({});

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
    });
  });

  describe("GET /api/v1/assignments/client-sql-code-run/status/:taskId", () => {
    it("should return 200 with job status when found", async () => {
      const mockStatus = { status: "completed", result: { success: true } };
      (services.TaskQueueClient.getStatus as any).mockResolvedValue(mockStatus);

      const res = await request(app).get(
        "/api/v1/assignments/client-sql-code-run/status/123",
      );

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockStatus);
    });

    it("should return 404 when task not found", async () => {
      (services.TaskQueueClient.getStatus as any).mockResolvedValue(null);

      const res = await request(app).get(
        "/api/v1/assignments/client-sql-code-run/status/999999",
      );

      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty("error");
    });
  });
});
