import { describe, it, expect, vi, beforeEach } from "vitest";
import get_job_status from "../index";
import { Request, Response } from "express";
import * as services from "../../../services";

vi.mock("../../../services", () => ({
  TaskQueueClient: {
    getStatus: vi.fn(),
  },
}));

describe("Job Controller", () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let jsonMock: ReturnType<typeof vi.fn>;
  let statusMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    jsonMock = vi.fn();
    statusMock = vi.fn().mockReturnValue({ json: jsonMock });
    res = {
      status: statusMock,
      json: jsonMock,
    };
    vi.clearAllMocks();
  });

  it("should return 200 with job status when task exists", async () => {
    req = { params: { taskId: "123" }, user: { id: "user-1", role: "user" } } as any;
    const mockStatus = { status: "completed", result: { rows: [] } };
    (services.TaskQueueClient.getStatus as any).mockResolvedValue(mockStatus);

    await get_job_status(req as Request, res as Response);

    expect(services.TaskQueueClient.getStatus).toHaveBeenCalledWith(
      "123",
    );
    expect(statusMock).toHaveBeenCalledWith(200);
    expect(jsonMock).toHaveBeenCalledWith(mockStatus);
  });

  it("should return 404 when task is not found", async () => {
    req = { params: { taskId: "999999" } };
    (services.TaskQueueClient.getStatus as any).mockResolvedValue(null);

    await get_job_status(req as Request, res as Response);

    expect(statusMock).toHaveBeenCalledWith(404);
    expect(jsonMock).toHaveBeenCalledWith({
      error: "Couldn't find the task!",
    });
  });

  it("should pass the correct taskId from params", async () => {
    req = { params: { taskId: "456" } };
    (services.TaskQueueClient.getStatus as any).mockResolvedValue({
      status: "active",
    });

    await get_job_status(req as Request, res as Response);

    expect(services.TaskQueueClient.getStatus).toHaveBeenCalledWith("456");
  });

  it("should return 403 when another user owns the job", async () => {
    req = {
      params: { taskId: "123" },
      user: { id: "user-2", role: "user" },
    } as any;
    (services.TaskQueueClient.getStatus as any).mockResolvedValue({
      status: "completed",
      result: { passed: true },
      ownerUserId: "user-1",
    });

    await get_job_status(req as Request, res as Response);

    expect(statusMock).toHaveBeenCalledWith(403);
    expect(jsonMock).toHaveBeenCalledWith({ error: "Forbidden" });
  });

  it("should allow admin to read another user's job and strip ownerUserId", async () => {
    req = {
      params: { taskId: "123" },
      user: { id: "admin-1", role: "admin" },
    } as any;
    (services.TaskQueueClient.getStatus as any).mockResolvedValue({
      status: "completed",
      result: { passed: true },
      ownerUserId: "user-1",
    });

    await get_job_status(req as Request, res as Response);

    expect(statusMock).toHaveBeenCalledWith(200);
    expect(jsonMock).toHaveBeenCalledWith({
      status: "completed",
      result: { passed: true },
    });
  });
});
