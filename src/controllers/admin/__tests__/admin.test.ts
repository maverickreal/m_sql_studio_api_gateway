import { describe, it, expect, vi, beforeEach } from "vitest";
import { Request, Response } from "express";
import { z } from "zod/v4";

vi.mock("../../../config", () => ({
  envVars: {},
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../../data/db/client", () => ({
  sharedMongoClient: { db: vi.fn(() => ({ collection: vi.fn() })) },
  default: {
    connect: vi.fn(),
    disconnect: vi.fn(),
  },
}));

vi.mock("../../../data/db/models/audit_log", () => ({
  AuditLog: {
    create: vi.fn().mockResolvedValue({}),
    find: vi.fn(),
  },
}));

vi.mock("../../../auth", () => ({
  auth: { api: { listUsers: vi.fn(), setRole: vi.fn() } },
  seedAdminUser: vi.fn(),
}));

vi.mock("../../../data/db/models/assignment", () => ({
  Assignment: {
    create: vi.fn(),
    findByIdAndUpdate: vi.fn(),
    findByIdAndDelete: vi.fn(),
    findById: vi.fn(),
  },
  AssignmentValidatorSchema: {
    title: z.string().nonempty(),
    description: z.string().nonempty(),
    difficulty: z.enum(["easy", "medium", "hard"]),
    mode: z.enum(["read", "write"]),
    sampleInput: z
      .array(z.string().nonempty().nonoptional())
      .nonempty()
      .nonoptional(),
    sampleOutput: z.string().nonempty(),
  },
}));

vi.mock("../../../data/db/models/assignment_solution", () => ({
  AssignmentSolution: {
    create: vi.fn().mockResolvedValue({}),
    deleteOne: vi.fn().mockResolvedValue({}),
  },
  AssignmentSolutionValidatorSchema: {
    solutionSql: z.string().nonempty().optional(),
    validationSql: z.string().nonempty().optional(),
    orderMatters: z.boolean().nonoptional(),
  },
}));

vi.mock("../../../services/job_queue", () => ({
  default: {
    enqueueAdminAssignmentSeedJob: vi.fn(),
    getStatus: vi.fn(),
  },
}));

import { create_assignment } from "../index";
import { Assignment } from "../../../data/db/models/assignment";
import { AssignmentSolution } from "../../../data/db/models/assignment_solution";
import TaskQueueClient from "../../../services/job_queue";

describe("create_assignment controller", () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let jsonMock: ReturnType<typeof vi.fn>;
  let statusMock: ReturnType<typeof vi.fn>;

  const validPayload = {
    title: "Test",
    description: "Desc",
    difficulty: "easy",
    mode: "read",
    sampleInput: ["SELECT * FROM users"],
    sampleOutput: "output",
    initSql: "CREATE TABLE t (id INT);",
    orderMatters: true,
  };

  beforeEach(() => {
    jsonMock = vi.fn();
    statusMock = vi.fn().mockReturnValue({ json: jsonMock });
    res = { status: statusMock, json: jsonMock };
    vi.clearAllMocks();
  });

  it("should return 201 on valid payload", async () => {
    const fakeId = "abc123";
    vi.mocked(Assignment.create).mockResolvedValue({ _id: fakeId } as any);
    vi.mocked(TaskQueueClient.enqueueAdminAssignmentSeedJob).mockResolvedValue(
      "job-1",
    );

    req = { body: validPayload };

    await create_assignment(req as Request, res as Response);

    expect(statusMock).toHaveBeenCalledWith(201);
    expect(jsonMock).toHaveBeenCalledWith({
      assignmentId: fakeId,
      jobId: "job-1",
    });
  });

  it("should return 201 with optional fields (solutionSql, validationSql)", async () => {
    const fakeId = "abc456";
    vi.mocked(Assignment.create).mockResolvedValue({ _id: fakeId } as any);
    vi.mocked(TaskQueueClient.enqueueAdminAssignmentSeedJob).mockResolvedValue(
      "job-2",
    );

    req = {
      body: {
        ...validPayload,
        solutionSql: "SELECT 1",
        validationSql: "SELECT count(*) FROM t",
      },
    };

    await create_assignment(req as Request, res as Response);

    expect(statusMock).toHaveBeenCalledWith(201);
    expect(jsonMock).toHaveBeenCalledWith({
      assignmentId: fakeId,
      jobId: "job-2",
    });
  });

  it("should return 201 without optional solutionSql/validationSql", async () => {
    const fakeId = "abc789";
    vi.mocked(Assignment.create).mockResolvedValue({ _id: fakeId } as any);
    vi.mocked(TaskQueueClient.enqueueAdminAssignmentSeedJob).mockResolvedValue(
      "job-3",
    );

    req = { body: validPayload };

    await create_assignment(req as Request, res as Response);

    expect(statusMock).toHaveBeenCalledWith(201);
    expect(jsonMock).toHaveBeenCalledWith({
      assignmentId: fakeId,
      jobId: "job-3",
    });
  });

  it("should pass only assignment fields to Assignment.create", async () => {
    const fakeId = "abc123";
    vi.mocked(Assignment.create).mockResolvedValue({ _id: fakeId } as any);
    vi.mocked(TaskQueueClient.enqueueAdminAssignmentSeedJob).mockResolvedValue(
      "job-1",
    );

    req = {
      body: {
        ...validPayload,
        solutionSql: "SELECT 1",
        validationSql: "SELECT count(*) FROM t",
      },
    };

    await create_assignment(req as Request, res as Response);

    const createArg = vi.mocked(Assignment.create).mock.calls[0][0] as any;
    expect(createArg).not.toHaveProperty("initSql");
    expect(createArg).not.toHaveProperty("solutionSql");
    expect(createArg).not.toHaveProperty("validationSql");
    expect(createArg).not.toHaveProperty("orderMatters");
    expect(createArg).toHaveProperty("title");
    expect(createArg).toHaveProperty("description");
    expect(createArg).toHaveProperty("mode");
  });

  it("should pass assignmentId and initSql to enqueueAdminAssignmentSeedJob", async () => {
    const fakeId = "abc123";
    vi.mocked(Assignment.create).mockResolvedValue({ _id: fakeId } as any);
    vi.mocked(TaskQueueClient.enqueueAdminAssignmentSeedJob).mockResolvedValue(
      "job-1",
    );

    req = { body: validPayload };

    await create_assignment(req as Request, res as Response);

    expect(TaskQueueClient.enqueueAdminAssignmentSeedJob).toHaveBeenCalledWith({
      assignmentId: fakeId,
      initSql: validPayload.initSql,
    });
  });

  it("should return 400 on invalid payload (missing required fields)", async () => {
    req = { body: { title: "Test" } };

    await create_assignment(req as Request, res as Response);

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.any(String) }),
    );
  });

  it("should return 400 when missing title", async () => {
    req = { body: { ...validPayload, title: undefined } };

    await create_assignment(req as Request, res as Response);

    expect(statusMock).toHaveBeenCalledWith(400);
  });

  it("should return 400 when missing description", async () => {
    req = { body: { ...validPayload, description: undefined } };

    await create_assignment(req as Request, res as Response);

    expect(statusMock).toHaveBeenCalledWith(400);
  });

  it("should return 400 when missing initSql", async () => {
    req = { body: { ...validPayload, initSql: undefined } };

    await create_assignment(req as Request, res as Response);

    expect(statusMock).toHaveBeenCalledWith(400);
  });

  it("should return 400 when missing orderMatters", async () => {
    req = { body: { ...validPayload, orderMatters: undefined } };

    await create_assignment(req as Request, res as Response);

    expect(statusMock).toHaveBeenCalledWith(400);
  });

  it("should return 400 for invalid mode enum", async () => {
    req = { body: { ...validPayload, mode: "invalid" } };

    await create_assignment(req as Request, res as Response);

    expect(statusMock).toHaveBeenCalledWith(400);
  });

  it("should return 400 for invalid difficulty enum", async () => {
    req = { body: { ...validPayload, difficulty: "impossible" } };

    await create_assignment(req as Request, res as Response);

    expect(statusMock).toHaveBeenCalledWith(400);
  });

  it("should return 400 when sampleInput is a string instead of array", async () => {
    req = { body: { ...validPayload, sampleInput: "SELECT 1" } };

    await create_assignment(req as Request, res as Response);

    expect(statusMock).toHaveBeenCalledWith(400);
  });

  it("should return 400 when sampleInput is an empty array", async () => {
    req = { body: { ...validPayload, sampleInput: [] } };

    await create_assignment(req as Request, res as Response);

    expect(statusMock).toHaveBeenCalledWith(400);
  });

  it("should return 400 when sampleInput contains empty string", async () => {
    req = { body: { ...validPayload, sampleInput: [""] } };

    await create_assignment(req as Request, res as Response);

    expect(statusMock).toHaveBeenCalledWith(400);
  });

  it("should return 400 when orderMatters is a string", async () => {
    req = { body: { ...validPayload, orderMatters: "true" } };

    await create_assignment(req as Request, res as Response);

    expect(statusMock).toHaveBeenCalledWith(400);
  });

  it("should return 400 when initSql is empty", async () => {
    req = { body: { ...validPayload, initSql: "" } };

    await create_assignment(req as Request, res as Response);

    expect(statusMock).toHaveBeenCalledWith(400);
  });

  it("should return 400 on empty body", async () => {
    req = { body: {} };

    await create_assignment(req as Request, res as Response);

    expect(statusMock).toHaveBeenCalledWith(400);
  });

  it("should return 500 when Assignment.create rejects", async () => {
    vi.mocked(Assignment.create).mockRejectedValue(new Error("DB error"));

    req = { body: validPayload };

    await create_assignment(req as Request, res as Response);

    expect(statusMock).toHaveBeenCalledWith(500);
    expect(jsonMock).toHaveBeenCalledWith({
      error: "Failed to create the assignment!",
    });
  });

  it("should return 500 when AssignmentSolution.create rejects", async () => {
    vi.mocked(Assignment.create).mockResolvedValue({ _id: "abc" } as any);
    vi.mocked(AssignmentSolution.create).mockRejectedValue(
      new Error("Solution DB error"),
    );
    vi.mocked(Assignment.findByIdAndDelete).mockResolvedValue({} as any);
    vi.mocked(AssignmentSolution.deleteOne).mockResolvedValue({} as any);

    req = { body: validPayload };

    await create_assignment(req as Request, res as Response);

    expect(statusMock).toHaveBeenCalledWith(500);
    expect(jsonMock).toHaveBeenCalledWith({
      error: "Failed to create the assignment!",
    });
  });

  it("should return 500 when enqueue rejects", async () => {
    vi.mocked(Assignment.create).mockResolvedValue({ _id: "abc" } as any);
    vi.mocked(AssignmentSolution.create).mockResolvedValue({} as any);
    vi.mocked(Assignment.findByIdAndDelete).mockResolvedValue({} as any);
    vi.mocked(AssignmentSolution.deleteOne).mockResolvedValue({} as any);
    vi.mocked(TaskQueueClient.enqueueAdminAssignmentSeedJob).mockRejectedValue(
      new Error("Queue error"),
    );

    req = { body: validPayload };

    await create_assignment(req as Request, res as Response);

    expect(statusMock).toHaveBeenCalledWith(500);
    expect(jsonMock).toHaveBeenCalledWith({
      error: "Failed to enqueue seed job!",
    });
  });

  it("should return 400 when title is empty string", async () => {
    req = { body: { ...validPayload, title: "" } };

    await create_assignment(req as Request, res as Response);

    expect(statusMock).toHaveBeenCalledWith(400);
  });

  it("should return 400 when description is empty string", async () => {
    req = { body: { ...validPayload, description: "" } };

    await create_assignment(req as Request, res as Response);

    expect(statusMock).toHaveBeenCalledWith(400);
  });

  it("should return 400 when sampleInput contains whitespace-only strings", async () => {
    vi.mocked(Assignment.create).mockResolvedValue({
      _id: "whitespace123",
    } as any);
    vi.mocked(AssignmentSolution.create).mockResolvedValue({} as any);
    vi.mocked(TaskQueueClient.enqueueAdminAssignmentSeedJob).mockResolvedValue(
      "job-whitespace",
    );

    req = { body: { ...validPayload, sampleInput: ["   ", "\t", "\n"] } };

    await create_assignment(req as Request, res as Response);

    expect(statusMock).toHaveBeenCalledWith(201);
  });

  it("should return 400 when sampleOutput is empty string", async () => {
    req = { body: { ...validPayload, sampleOutput: "" } };

    await create_assignment(req as Request, res as Response);

    expect(statusMock).toHaveBeenCalledWith(400);
  });

  it("should return 400 for invalid mode value", async () => {
    req = { body: { ...validPayload, mode: "execute" } };

    await create_assignment(req as Request, res as Response);

    expect(statusMock).toHaveBeenCalledWith(400);
  });

  it("should return 400 for invalid difficulty value", async () => {
    req = { body: { ...validPayload, difficulty: "extreme" } };

    await create_assignment(req as Request, res as Response);

    expect(statusMock).toHaveBeenCalledWith(400);
  });

  it("should return 201 with maximum length inputs", async () => {
    const fakeId = "maxlen123";
    const longString = "a".repeat(10000);
    vi.mocked(Assignment.create).mockResolvedValue({ _id: fakeId } as any);
    vi.mocked(TaskQueueClient.enqueueAdminAssignmentSeedJob).mockResolvedValue(
      "job-max",
    );

    req = {
      body: {
        ...validPayload,
        title: longString,
        description: longString,
        sampleInput: [longString],
        sampleOutput: longString,
        initSql: longString,
      },
    };

    await create_assignment(req as Request, res as Response);

    expect(statusMock).toHaveBeenCalledWith(201);
    expect(jsonMock).toHaveBeenCalledWith({
      assignmentId: fakeId,
      jobId: "job-max",
    });
  });

  it("should throw when Assignment.findByIdAndDelete fails during rollback", async () => {
    vi.mocked(Assignment.create).mockResolvedValue({ _id: "abc" } as any);
    vi.mocked(AssignmentSolution.create).mockResolvedValue({} as any);
    vi.mocked(Assignment.findByIdAndDelete).mockRejectedValue(
      new Error("Delete failed"),
    );
    vi.mocked(AssignmentSolution.deleteOne).mockResolvedValue({} as any);
    vi.mocked(TaskQueueClient.enqueueAdminAssignmentSeedJob).mockRejectedValue(
      new Error("Queue error"),
    );

    req = { body: validPayload };

    await expect(
      create_assignment(req as Request, res as Response),
    ).rejects.toThrow("Delete failed");
  });

  it("should throw when AssignmentSolution.deleteOne fails during rollback", async () => {
    vi.mocked(Assignment.create).mockResolvedValue({ _id: "abc" } as any);
    vi.mocked(AssignmentSolution.create).mockResolvedValue({} as any);
    vi.mocked(Assignment.findByIdAndDelete).mockResolvedValue({} as any);
    vi.mocked(AssignmentSolution.deleteOne).mockRejectedValue(
      new Error("Solution delete failed"),
    );
    vi.mocked(TaskQueueClient.enqueueAdminAssignmentSeedJob).mockRejectedValue(
      new Error("Queue error"),
    );

    req = { body: validPayload };

    await expect(
      create_assignment(req as Request, res as Response),
    ).rejects.toThrow("Solution delete failed");
  });
});
