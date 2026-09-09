import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockCacheInstance = {
  get: vi.fn(),
  setEx: vi.fn(),
  expire: vi.fn(),
};

vi.mock("../data/cache", () => ({
  default: {
    get: vi.fn(() => Promise.resolve(mockCacheInstance)),
  },
}));

import { getAssignmentByIdCached, getAssignmentSolutionByAssignmentIdCached } from "../services/assignment_cache";
import { ASSIGNMENT_CACHE_TTL_S, ASSIGNMENT_KEY_PREFIX, ASSIGNMENT_SOLUTION_KEY_PREFIX } from "../utils";

describe("assignment_cache service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getAssignmentByIdCached", () => {
    it("returns cached assignment when found", async () => {
      const cachedAssignment = { _id: "650000000000000000000001", title: "Test Assignment" };
      mockCacheInstance.get.mockResolvedValue(JSON.stringify(cachedAssignment));
      mockCacheInstance.expire.mockResolvedValue("OK");

      const result = await getAssignmentByIdCached("650000000000000000000001");

      expect(result).toEqual(cachedAssignment);
      expect(mockCacheInstance.get).toHaveBeenCalledWith(`${ASSIGNMENT_KEY_PREFIX}650000000000000000000001`);
      expect(mockCacheInstance.expire).toHaveBeenCalledWith(
        `${ASSIGNMENT_KEY_PREFIX}650000000000000000000001`,
        ASSIGNMENT_CACHE_TTL_S,
      );
    });

    it("fetches from DB and caches when not in cache", async () => {
      const dbAssignment = { _id: "650000000000000000000001", title: "Test Assignment" };
      mockCacheInstance.get.mockResolvedValue(null);
      
      // Mock the mongoose model
      const { Assignment } = await import("../data/db/models/assignment");
      vi.spyOn(Assignment, "findById").mockReturnValue({
        lean: vi.fn().mockResolvedValue(dbAssignment),
      } as any);
      mockCacheInstance.setEx.mockResolvedValue("OK");

      const result = await getAssignmentByIdCached("650000000000000000000001");

      expect(result).toEqual(dbAssignment);
      expect(mockCacheInstance.setEx).toHaveBeenCalledWith(
        `${ASSIGNMENT_KEY_PREFIX}650000000000000000000001`,
        ASSIGNMENT_CACHE_TTL_S,
        JSON.stringify(dbAssignment),
      );
    });

    it("returns null when not in cache and not in DB", async () => {
      mockCacheInstance.get.mockResolvedValue(null);
      
      const { Assignment } = await import("../data/db/models/assignment");
      vi.spyOn(Assignment, "findById").mockReturnValue({
        lean: vi.fn().mockResolvedValue(null),
      } as any);

      const result = await getAssignmentByIdCached("650000000000000000000001");

      expect(result).toBeNull();
      expect(mockCacheInstance.setEx).not.toHaveBeenCalled();
    });
  });

  describe("getAssignmentSolutionByAssignmentIdCached", () => {
    it("returns cached solution when found", async () => {
      const cachedSolution = { assignmentId: "650000000000000000000001", solutionSql: "SELECT 1" };
      mockCacheInstance.get.mockResolvedValue(JSON.stringify(cachedSolution));
      mockCacheInstance.expire.mockResolvedValue("OK");

      const result = await getAssignmentSolutionByAssignmentIdCached("650000000000000000000001");

      expect(result).toEqual(cachedSolution);
      expect(mockCacheInstance.get).toHaveBeenCalledWith(
        `${ASSIGNMENT_SOLUTION_KEY_PREFIX}650000000000000000000001`,
      );
      expect(mockCacheInstance.expire).toHaveBeenCalledWith(
        `${ASSIGNMENT_SOLUTION_KEY_PREFIX}650000000000000000000001`,
        ASSIGNMENT_CACHE_TTL_S,
      );
    });

    it("fetches from DB and caches when not in cache", async () => {
      const dbSolution = { assignmentId: "650000000000000000000001", solutionSql: "SELECT 1" };
      mockCacheInstance.get.mockResolvedValue(null);
      
      const { AssignmentSolution } = await import("../data/db/models/assignment_solution");
      vi.spyOn(AssignmentSolution, "findOne").mockReturnValue({
        lean: vi.fn().mockResolvedValue(dbSolution),
      } as any);
      mockCacheInstance.setEx.mockResolvedValue("OK");

      const result = await getAssignmentSolutionByAssignmentIdCached("650000000000000000000001");

      expect(result).toEqual(dbSolution);
      expect(mockCacheInstance.setEx).toHaveBeenCalledWith(
        `${ASSIGNMENT_SOLUTION_KEY_PREFIX}650000000000000000000001`,
        ASSIGNMENT_CACHE_TTL_S,
        JSON.stringify(dbSolution),
      );
    });

    it("returns null when not in cache and not in DB", async () => {
      mockCacheInstance.get.mockResolvedValue(null);
      
      const { AssignmentSolution } = await import("../data/db/models/assignment_solution");
      vi.spyOn(AssignmentSolution, "findOne").mockReturnValue({
        lean: vi.fn().mockResolvedValue(null),
      } as any);

      const result = await getAssignmentSolutionByAssignmentIdCached("650000000000000000000001");

      expect(result).toBeNull();
      expect(mockCacheInstance.setEx).not.toHaveBeenCalled();
    });
  });
});