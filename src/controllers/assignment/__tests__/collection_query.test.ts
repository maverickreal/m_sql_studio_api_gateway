import { describe, it, expect, vi, beforeEach } from "vitest";
import { Request, Response } from "express";
import { retrieve_all_assignments } from "../index";

vi.mock("../../../config", () => ({
  envVars: { CLIENT_URL: "http://localhost:3000" },
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../../data", () => ({
  Assignment: {
    find: vi.fn(),
    countDocuments: vi.fn(),
  },
}));

vi.mock("../../../services", () => ({
  getAssignmentByIdCached: vi.fn(),
}));

import { Assignment } from "../../../data";

const mockRes = () => {
  const jsonMock = vi.fn();
  const statusMock = vi.fn().mockReturnValue({ json: jsonMock });
  return {
    res: {
      status: statusMock,
      json: jsonMock,
      set: vi.fn().mockReturnThis(),
    } as unknown as Response,
    statusMock,
    jsonMock,
  };
};

const mockFindChain = (docs: unknown[]) => {
  (Assignment.find as any).mockReturnValue({
    sort: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    lean: vi.fn().mockResolvedValue(docs),
  });
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("retrieve_all_assignments — ADR 004 collection contract", () => {
  it("returns the envelope with total/totalPages (happy path)", async () => {
    const docs = [{ _id: "1", title: "Two Sum" }];
    mockFindChain(docs);
    (Assignment.countDocuments as any).mockResolvedValue(42);
    const { res, statusMock, jsonMock } = mockRes();

    await retrieve_all_assignments(
      { query: { page: "2", limit: "10" } } as unknown as Request,
      res,
    );

    expect(statusMock).toHaveBeenCalledWith(200);
    expect(jsonMock).toHaveBeenCalledWith({
      assignments: docs,
      page: 2,
      limit: 10,
      total: 42,
      totalPages: 5,
    });
  });

  it("combines filter + search + sort + page into one mongo query", async () => {
    mockFindChain([]);
    (Assignment.countDocuments as any).mockResolvedValue(0);
    const { res } = mockRes();

    await retrieve_all_assignments(
      {
        query: {
          page: "1",
          limit: "10",
          filter: { difficulty: "easy", mode: "read" },
          q: "sum",
          sort: "title",
          order: "asc",
        },
      } as unknown as Request,
      res,
    );

    expect(Assignment.find).toHaveBeenCalledWith(
      {
        pgSchemaReady: true,
        difficulty: "easy",
        mode: "read",
        $or: [
          { title: { $regex: "sum", $options: "i" } },
          { description: { $regex: "sum", $options: "i" } },
        ],
      },
      { _id: 1, title: 1, difficulty: 1, mode: 1 },
    );
    const chain = (Assignment.find as any).mock.results[0].value;
    expect(chain.sort).toHaveBeenCalledWith({ title: 1 });
    expect(chain.skip).toHaveBeenCalledWith(0);
    expect(chain.limit).toHaveBeenCalledWith(10);
  });

  it("returns the empty-result shape with totalPages 0", async () => {
    mockFindChain([]);
    (Assignment.countDocuments as any).mockResolvedValue(0);
    const { res, statusMock, jsonMock } = mockRes();

    await retrieve_all_assignments(
      { query: { q: "nonexistent" } } as unknown as Request,
      res,
    );

    expect(statusMock).toHaveBeenCalledWith(200);
    expect(jsonMock).toHaveBeenCalledWith({
      assignments: [],
      page: 1,
      limit: 20,
      total: 0,
      totalPages: 0,
    });
  });

  it("returns 400 with details for invalid params", async () => {
    const { res, statusMock, jsonMock } = mockRes();

    await retrieve_all_assignments(
      {
        query: {
          page: "0",
          sort: "invalid",
          order: "up",
          filter: { difficulty: "foo" },
        },
      } as unknown as Request,
      res,
    );

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(jsonMock).toHaveBeenCalledWith({
      error: "Invalid query parameter",
      details: expect.arrayContaining([
        { field: "page", message: "must be ≥ 1" },
        {
          field: "sort",
          message: "invalid field 'invalid'; allowed: createdAt, title",
        },
        { field: "order", message: "must be 'asc' or 'desc'" },
        {
          field: "filter[difficulty]",
          message: "invalid value 'foo'; allowed: easy, medium, hard",
        },
      ]),
    });
    expect(Assignment.find).not.toHaveBeenCalled();
  });

  it("keeps backward compat: bare page/limit still works with envelope", async () => {
    const docs = [{ _id: "1", title: "A" }];
    mockFindChain(docs);
    (Assignment.countDocuments as any).mockResolvedValue(1);
    const { res, statusMock, jsonMock } = mockRes();

    await retrieve_all_assignments({ query: {} } as unknown as Request, res);

    expect(statusMock).toHaveBeenCalledWith(200);
    expect(jsonMock).toHaveBeenCalledWith({
      assignments: docs,
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
    });
  });
});
