import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockQueue } = vi.hoisted(() => ({
  mockQueue: {
    add: vi.fn(),
    getJob: vi.fn(),
    getJobCounts: vi.fn(),
    getWorkersCount: vi.fn(),
    close: vi.fn(),
  },
}));

vi.mock("bullmq", () => ({
  Queue: vi.fn().mockImplementation(() => mockQueue),
}));

vi.mock("../config", () => ({
  envVars: {
    BULLMQ_SQL_QUEUE_NAME: "test-queue",
    REDIS_URL: "redis://localhost:6379",
  },
  logger: {
    error: vi.fn(),
    info: vi.fn(),
  },
}));

import TaskQueueClient from "../services/job_queue";

describe("TaskQueueClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the client instance before each test
    Object.defineProperty(TaskQueueClient, "clientInst", {
      value: mockQueue,
      writable: true,
      configurable: true,
    });
  });

  describe("enqueue", () => {
    it("enqueues a job with correct parameters", async () => {
      mockQueue.add.mockResolvedValue({ id: "job-123" });

      const payload = {
        assignmentId: "test-id",
        userSql: "SELECT 1",
        assignmentSchema: "schema",
        mode: "read" as const,
      };

      const result = await TaskQueueClient.enqueue(payload);

      expect(result).toBe("job-123");
      expect(mockQueue.add).toHaveBeenCalledWith(
        "client_sql_studio_sql_exec",
        payload,
        expect.objectContaining({
          removeOnComplete: expect.any(Object),
          removeOnFail: expect.any(Object),
        }),
      );
    });
  });

  describe("getStatus", () => {
    it("returns null when job not found", async () => {
      mockQueue.getJob.mockResolvedValue(null);

      const result = await TaskQueueClient.getStatus("nonexistent");

      expect(result).toBeNull();
    });

    it("returns job status when job exists", async () => {
      const mockJob = {
        getState: vi.fn().mockResolvedValue("completed"),
        data: { userId: "user-1" },
        returnvalue: { passed: true },
        name: "client_sql_studio_sql_exec",
        failedReason: undefined,
      };
      mockQueue.getJob.mockResolvedValue(mockJob);

      const result = await TaskQueueClient.getStatus("job-123");

      expect(result).toEqual({
        status: "completed",
        ownerUserId: "user-1",
        result: { passed: true },
      });
    });

    it("returns null result for failed job", async () => {
      const mockJob = {
        getState: vi.fn().mockResolvedValue("failed"),
        data: {},
        returnvalue: undefined,
        name: "client_sql_studio_sql_exec",
        failedReason: "Error",
      };
      mockQueue.getJob.mockResolvedValue(mockJob);

      const result = await TaskQueueClient.getStatus("job-123");

      expect(result?.status).toBe("failed");
      expect(result?.result).toBe("BullMQ task failed!");
    });
  });

  describe("ping", () => {
    it("calls getJobCounts", async () => {
      mockQueue.getJobCounts.mockResolvedValue({});

      await TaskQueueClient.ping();

      expect(mockQueue.getJobCounts).toHaveBeenCalled();
    });
  });

  describe("getWorkersCount", () => {
    it("returns workers count", async () => {
      mockQueue.getWorkersCount.mockResolvedValue(5);

      const result = await TaskQueueClient.getWorkersCount();

      expect(result).toBe(5);
    });
  });
});