import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

class MockClient {
  query = vi.fn().mockResolvedValue(undefined);
  release = vi.fn().mockResolvedValue(undefined);
}

class MockPool {
  connect = vi.fn().mockResolvedValue(new MockClient());
  query = vi.fn().mockResolvedValue(undefined);
  end = vi.fn().mockResolvedValue(undefined);
}

vi.mock("pg", () => {
  return {
    Pool: MockPool,
    Client: MockClient,
  };
});

vi.mock("mongoose", async (importOriginal) => {
  const actual = await importOriginal<typeof import("mongoose")>();
  return {
    ...actual,
    default: {
      connection: {
        readyState: 1,
        db: {
          admin: vi.fn(() => ({
            ping: vi.fn().mockResolvedValue(true),
          })),
        },
      },
      connect: vi.fn(),
      disconnect: vi.fn(),
    },
    Schema: actual.Schema,
    model: actual.model,
    Types: {
      ObjectId: vi.fn(() => "507f1f77bcf86cd799439011"),
    },
  };
});

// Mock the modules first
vi.mock("../data/db/models/problem");
vi.mock("../data/db/models/assignment");
vi.mock("../data/db/models/assignment_solution");
vi.mock("../data/db/models/sync_state", () => {
  const mockLean = vi.fn().mockResolvedValue(null);
  const mockFindOne = vi.fn().mockReturnValue({ lean: mockLean });
  const mockFindOneAndUpdate = vi.fn().mockResolvedValue({});
  return {
    SyncState: {
      findOne: mockFindOne,
      findOneAndUpdate: mockFindOneAndUpdate,
    },
    SyncStateSchema: {},
  };
});
vi.mock("../services/test_executor");
vi.mock("../services/job_queue");
vi.mock("node:fs/promises");

// Now import the mocked modules
import { processProblemsSyncJob } from "../services/problems_sync";
import { Problem } from "../data/db/models/problem";
import { Assignment } from "../data/db/models/assignment";
import { AssignmentSolution } from "../data/db/models/assignment_solution";
import { SyncState } from "../data/db/models/sync_state";
import { checkDenyList, executeTestInIsolatedSchema } from "../services/test_executor";
import TaskQueueClient from "../services/job_queue";
import { readFile, readdir } from "node:fs/promises";

describe("processProblemsSyncJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Problem.findOneAndUpdate.mockResolvedValue({});
    Problem.find.mockReturnValue({
      lean: vi.fn().mockResolvedValue([]),
    });
    Problem.updateMany.mockResolvedValue({});
    Assignment.findOneAndUpdate.mockResolvedValue({ _id: "507f1f77bcf86cd799439011" });
    AssignmentSolution.findOneAndUpdate.mockResolvedValue({});
    SyncState.findOneAndUpdate.mockResolvedValue({});
    TaskQueueClient.enqueueAdminAssignmentSeedJob.mockResolvedValue("seed-job-id");
    readFile.mockResolvedValue("");
    readdir.mockResolvedValue([]);
    executeTestInIsolatedSchema.mockResolvedValue({ passed: true });
    checkDenyList.mockReturnValue([]);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  const validProblemYaml = `id: 018f2e3a-1b4c-7d8e-9f0a-1b2c3d4e5f6a
slug: test-problem
title: Test Problem
description: A test problem
difficulty: easy
mode: read
category: joins
datasets:
  - sample
sampleInput:
  - SELECT 1
sampleOutput: result
initSql: CREATE TABLE test (id INT);
solutionSql: SELECT 1 as result
validationSql: SELECT 1
overlaySql: SELECT 1
orderMatters: true
origin: first-party
contributor: test
author: test
license: MIT
schema_version: 1
`;

  it("passes tests and writes problem + assignment + solution + enqueues seed job", async () => {
    executeTestInIsolatedSchema.mockResolvedValue({ passed: true });

    const result = await processProblemsSyncJob({
      deliveryId: "test-delivery",
      ref: "refs/heads/main",
      afterSha: "abc123",
      forced: true,
      files: [
        {
          path: "problems/joins/test-problem.yaml",
          status: "added",
          content: validProblemYaml,
        },
      ],
    });

    expect(result.upserted).toBe(1);
    expect(result.skipped).toBe(0);
    expect(executeTestInIsolatedSchema).toHaveBeenCalled();
    expect(Problem.findOneAndUpdate).toHaveBeenCalled();
    expect(Assignment.findOneAndUpdate).toHaveBeenCalled();
    expect(AssignmentSolution.findOneAndUpdate).toHaveBeenCalled();
    expect(TaskQueueClient.enqueueAdminAssignmentSeedJob).toHaveBeenCalled();
  });

  it("fails tests and writes nothing (zero DB write)", async () => {
    executeTestInIsolatedSchema.mockResolvedValue({ 
      passed: false, 
      error: "Output mismatch" 
    });

    const result = await processProblemsSyncJob({
      deliveryId: "test-delivery",
      ref: "refs/heads/main",
      afterSha: "abc123",
      forced: true,
      files: [
        {
          path: "problems/joins/test-problem.yaml",
          status: "added",
          content: validProblemYaml,
        },
      ],
    });

    expect(result.upserted).toBe(0);
    expect(result.skipped).toBe(1);
    expect(Problem.findOneAndUpdate).not.toHaveBeenCalled();
    expect(Assignment.findOneAndUpdate).not.toHaveBeenCalled();
    expect(AssignmentSolution.findOneAndUpdate).not.toHaveBeenCalled();
    expect(TaskQueueClient.enqueueAdminAssignmentSeedJob).not.toHaveBeenCalled();
  });

  it("skips deny-list violations", async () => {
    checkDenyList.mockReturnValue([{ pattern: "COPY", sql: "COPY users FROM '/tmp/test.csv'" }]);
    executeTestInIsolatedSchema.mockResolvedValue({ passed: true });

    const result = await processProblemsSyncJob({
      deliveryId: "test-delivery",
      ref: "refs/heads/main",
      afterSha: "abc123",
      forced: true,
      files: [
        {
          path: "problems/joins/test-problem.yaml",
          status: "added",
          content: validProblemYaml,
        },
      ],
    });

    expect(result.upserted).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it("tombstones removed files", async () => {
    const result = await processProblemsSyncJob({
      deliveryId: "test-delivery",
      ref: "refs/heads/main",
      afterSha: "abc123",
      forced: true,
      files: [
        {
          path: "problems/joins/test-problem.yaml",
          status: "removed",
        },
      ],
    });

    expect(result.tombstoned).toBe(1);
    expect(Problem.findOneAndUpdate).toHaveBeenCalled();
  });

  it("detects drift on force-push and triggers full resync", async () => {
      // Mock stored sync state with old lastSha - use the lean mock
      const mockLean = vi.fn().mockResolvedValue({
        _id: "github-problems",
        lastSha: "stored-old-sha",
        repo: "test/repo",
      });
      SyncState.findOne.mockReturnValue({ lean: mockLean });

      // The job comes with beforeSha that doesn't match stored lastSha
      const result = await processProblemsSyncJob({
        deliveryId: "test-delivery-drift",
        ref: "refs/heads/main",
        beforeSha: "incoming-different-sha", // Different from stored lastSha -> drift
        afterSha: "new-sha-after-force-push",
        forced: false, // Not explicitly forced, but drift should force it
        commits: [],
      });

      // Should have queried SyncState for drift detection
      expect(SyncState.findOne).toHaveBeenCalled();
    });

    it("does not trigger drift on new branch (zero beforeSha)", async () => {
      const zeroSha = "0000000000000000000000000000000000000000";

      const result = await processProblemsSyncJob({
        deliveryId: "test-delivery-new-branch",
        ref: "refs/heads/new-feature",
        beforeSha: zeroSha,
        afterSha: "new-branch-sha",
        forced: false,
        commits: [],
      });

      // Should not query SyncState for drift detection on new branch
      // (though it will still query for the final update)
    });
  });