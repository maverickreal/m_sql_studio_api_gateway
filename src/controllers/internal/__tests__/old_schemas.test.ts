import { describe, it, expect, vi, beforeEach } from "vitest";
import { Request, Response } from "express";
import { get_old_schemas, trigger_cleanup } from "../index";

vi.mock("../../../data/db/models/assignment", () => ({
  Assignment: {
    find: vi.fn(),
  },
}));

vi.mock("../../../services", () => ({
  TaskQueueClient: {
    enqueueCleanupJob: vi.fn(),
  },
}));

vi.mock("../../../data", () => ({
  CacheClient: {
    get: vi.fn(),
  },
}));

vi.mock("../../../config", () => ({
  envVars: {
    SANDBOX_SCHEMA_TTL_DAYS: 7,
  },
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../../utils", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../../utils")>();
  return {
    ...orig,
    getSandboxDBSchemaIdForAssignment: (id: string) =>
      `assignment_schema_${id}`,
  };
});

import { Assignment } from "../../../data/db/models/assignment";
import { TaskQueueClient } from "../../../services";

function mockRes() {
  const jsonMock = vi.fn();
  const statusMock = vi.fn().mockReturnValue({ json: jsonMock });
  return {
    res: { status: statusMock, json: jsonMock } as unknown as Response,
    statusMock,
    jsonMock,
  };
}

describe("get_old_schemas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns schema names for assignments older than ttlDays", async () => {
    const docs = [{ _id: "507f1f77bcf86cd799439011" }, { _id: "507f1f77bcf86cd799439012" }];
    vi.mocked(Assignment.find).mockReturnValue({
      lean: () => Promise.resolve(docs),
    } as never);
    const req = { query: { ttlDays: "7" } } as unknown as Request;
    const { res, statusMock, jsonMock } = mockRes();

    await get_old_schemas(req, res);

    expect(Assignment.find).toHaveBeenCalledWith(
      { createdAt: expect.objectContaining({ $lt: expect.any(Date) }) },
      { _id: 1 },
    );
    expect(statusMock).toHaveBeenCalledWith(200);
    expect(jsonMock).toHaveBeenCalledWith({
      schemaNames: [
        "assignment_schema_507f1f77bcf86cd799439011",
        "assignment_schema_507f1f77bcf86cd799439012",
      ],
      count: 2,
    });
  });

  it("defaults ttlDays to SANDBOX_SCHEMA_TTL_DAYS when not provided", async () => {
    vi.mocked(Assignment.find).mockReturnValue({
      lean: () => Promise.resolve([]),
    } as never);
    const req = { query: {} } as unknown as Request;
    const { res, statusMock, jsonMock } = mockRes();

    await get_old_schemas(req, res);

    expect(Assignment.find).toHaveBeenCalled();
    expect(statusMock).toHaveBeenCalledWith(200);
    expect(jsonMock).toHaveBeenCalledWith({ schemaNames: [], count: 0 });
  });

  it("rejects invalid ttlDays with 400", async () => {
    const req = { query: { ttlDays: "banana" } } as unknown as Request;
    const { res, statusMock } = mockRes();

    await get_old_schemas(req, res);

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(Assignment.find).not.toHaveBeenCalled();
  });
});

describe("trigger_cleanup (dev-only manual trigger)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("enqueues a cleanup job and returns its id", async () => {
    vi.mocked(TaskQueueClient.enqueueCleanupJob).mockResolvedValue("job-9");
    const req = {} as Request;
    const { res, statusMock, jsonMock } = mockRes();

    await trigger_cleanup(req, res);

    expect(TaskQueueClient.enqueueCleanupJob).toHaveBeenCalled();
    expect(statusMock).toHaveBeenCalledWith(202);
    expect(jsonMock).toHaveBeenCalledWith({ jobId: "job-9" });
  });
});
