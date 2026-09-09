import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../data/db/models/problem", () => ({
  Problem: {
    findOneAndUpdate: vi.fn(),
    find: vi.fn(),
    updateMany: vi.fn(),
  },
}));

vi.mock("../../../data/db/models/sync_state", () => ({
  SyncState: {
    findOneAndUpdate: vi.fn(),
  },
}));

vi.mock("../../../config", () => ({
  envVars: {
    GITHUB_PROBLEMS_REPO: "maverickreal/m_sql_studio_problems",
    ENV_MODE: "DEV",
  },
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { Problem } from "../../../data/db/models/problem";
import { SyncState } from "../../../data/db/models/sync_state";
import {
  applyProblemFiles,
  tombstoneIdsNotIn,
  processProblemsSyncJob,
} from "../index";

const VALID_ID = "0196a1b2-3c4d-7e5f-89ab-cdef01234567";
const SIBLING_ID = "0196a1b2-3c4d-7e5f-89ab-cdef01234568";

const validYaml = (id: string, slug: string) => `id: "${id}"
slug: "${slug}"
title: "Above average salary"
description: |
  Return employees paid above their department average.
difficulty: easy
mode: read
category: joins
sampleInput:
  - "employees(id, dept_id, salary)"
sampleOutput: "id\\n1\\n3"
initSql: |
  CREATE TABLE employees (id INT);
solutionSql: |
  SELECT id FROM employees;
validationSql: |
  SELECT 1;
orderMatters: false
author: "octocat"
license: "CC-BY-4.0"
schema_version: 1
`;

describe("problems sync worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(Problem.findOneAndUpdate).mockResolvedValue({} as any);
    vi.mocked(SyncState.findOneAndUpdate).mockResolvedValue({} as any);
  });

  it("upserts a valid problem yaml on id", async () => {
    const result = await applyProblemFiles(
      [
        {
          path: "problems/joins/a.yaml",
          status: "added",
          content: validYaml(VALID_ID, "above-avg-salary"),
        },
      ],
      { gitSha: "abc123" },
    );

    expect(result.upserted).toBe(1);
    expect(result.skipped).toBe(0);
    expect(Problem.findOneAndUpdate).toHaveBeenCalledWith(
      { id: VALID_ID },
      expect.objectContaining({
        $set: expect.objectContaining({
          id: VALID_ID,
          slug: "above-avg-salary",
          gitSha: "abc123",
          path: "problems/joins/a.yaml",
          deletedAt: null,
        }),
      }),
      expect.objectContaining({ upsert: true }),
    );
  });

  it("skips invalid yaml but upserts valid sibling", async () => {
    const result = await applyProblemFiles([
      {
        path: "problems/joins/bad.yaml",
        status: "added",
        content: "id: not-a-uuid\nslug: bad\n",
      },
      {
        path: "problems/joins/good.yaml",
        status: "added",
        content: validYaml(SIBLING_ID, "good-one"),
      },
    ]);

    expect(result.upserted).toBe(1);
    expect(result.skipped).toBe(1);
    expect(Problem.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(Problem.findOneAndUpdate).toHaveBeenCalledWith(
      { id: SIBLING_ID },
      expect.anything(),
      expect.anything(),
    );
  });

  it("rejects LeetCode-style extra fields", async () => {
    const result = await applyProblemFiles([
      {
        path: "problems/joins/leet.yaml",
        status: "added",
        content:
          validYaml(VALID_ID, "leet") +
          "test_cases:\n  - input: 1\nstatement: two sum\n",
      },
    ]);

    expect(result.upserted).toBe(0);
    expect(result.skipped).toBe(1);
    expect(Problem.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("sets deletedAt on removed files", async () => {
    const result = await applyProblemFiles([
      { path: "problems/joins/gone.yaml", status: "removed" },
    ]);

    expect(result.tombstoned).toBe(1);
    expect(Problem.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ path: "problems/joins/gone.yaml" }),
      expect.objectContaining({
        $set: expect.objectContaining({ deletedAt: expect.any(Date) }),
      }),
      expect.anything(),
    );
  });

  it("forced resync tombstones ids missing at HEAD", async () => {
    vi.mocked(Problem.find).mockReturnValue({
      lean: vi.fn().mockResolvedValue([{ id: "stale-id-1" }]),
    } as any);

    const count = await tombstoneIdsNotIn(["fresh-id"]);

    expect(count).toBe(1);
    expect(Problem.updateMany).toHaveBeenCalledWith(
      { id: { $in: ["stale-id-1"] } },
      expect.objectContaining({
        $set: expect.objectContaining({ deletedAt: expect.any(Date) }),
      }),
    );
  });

  it("processProblemsSyncJob applies files and updates sync_state", async () => {
    const result = await processProblemsSyncJob({
      deliveryId: "d-1",
      afterSha: "abc123",
      forced: false,
      files: [
        {
          path: "problems/joins/a.yaml",
          status: "added",
          content: validYaml(VALID_ID, "above-avg-salary"),
        },
      ],
    });

    expect(result.upserted).toBe(1);
    expect(SyncState.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: "github-problems" },
      expect.objectContaining({
        $set: expect.objectContaining({
          lastSha: "abc123",
          lastDeliveryId: "d-1",
        }),
      }),
      expect.objectContaining({ upsert: true }),
    );
  });
});
