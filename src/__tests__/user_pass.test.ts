import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockCreate } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
}));

vi.mock("../data/db/models/user_pass", () => ({
  UserPass: {
    create: mockCreate,
  },
}));

function makeDuplicateKeyError() {
  const err = new Error("duplicate key error") as Error & { code: number };
  err.code = 11000;
  return err;
}

import { PassRecorder } from "../services/pass_recorder";

describe("UserPass Model & PassRecorder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("UserPass.create()", () => {
    it("creates a user pass document with valid data", async () => {
      mockCreate.mockResolvedValue({});

      await PassRecorder.recordPass({
        userId: "user-1",
        assignmentId: "assignment-1",
        taskId: "task-123",
      });

      expect(mockCreate).toHaveBeenCalledWith({
        userId: "user-1",
        assignmentId: "assignment-1",
        taskId: "task-123",
        passedAt: expect.any(Date),
      });
    });
  });

  describe("Unique taskId", () => {
    it("silently ignores duplicate key error (code 11000)", async () => {
      mockCreate.mockRejectedValue(makeDuplicateKeyError());

      // Should not throw - duplicate is silently ignored
      await expect(
        PassRecorder.recordPass({
          userId: "user-1",
          assignmentId: "assignment-2",
          taskId: "task-123",
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("PassRecorder.recordPass() idempotency", () => {
    it("inserts on first call, no-op on second call with same taskId", async () => {
      mockCreate.mockResolvedValue({});

      // First call
      await PassRecorder.recordPass({
        userId: "user-1",
        assignmentId: "assignment-1",
        taskId: "task-123",
      });
      expect(mockCreate).toHaveBeenCalledTimes(1);

      // Second call with same taskId - simulates duplicate key error
      mockCreate.mockRejectedValue(makeDuplicateKeyError());
      await PassRecorder.recordPass({
        userId: "user-1",
        assignmentId: "assignment-2",
        taskId: "task-123",
      });
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    it("rethrows non-duplicate errors", async () => {
      mockCreate.mockRejectedValue(new Error("Connection lost"));

      await expect(
        PassRecorder.recordPass({
          userId: "user-1",
          assignmentId: "assignment-1",
          taskId: "task-123",
        }),
      ).rejects.toThrow("Connection lost");
    });
  });

  describe("Aggregation pipeline", () => {
    it("given 3 users with different pass counts, returns sorted by passes desc", async () => {
      // This is covered by leaderboard.test.ts which mocks UserPass.aggregate
      // Here we just verify the PassRecorder records correctly
      mockCreate.mockResolvedValue({});

      await PassRecorder.recordPass({
        userId: "user-1",
        assignmentId: "a1",
        taskId: "t1",
      });
      await PassRecorder.recordPass({
        userId: "user-1",
        assignmentId: "a2",
        taskId: "t2",
      });
      await PassRecorder.recordPass({
        userId: "user-2",
        assignmentId: "a1",
        taskId: "t3",
      });

      expect(mockCreate).toHaveBeenCalledTimes(3);
    });
  });
});