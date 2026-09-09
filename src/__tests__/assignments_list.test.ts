import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const { mockCountDocuments, mockLean, mockLimit, mockSkip, mockSort, mockFind } =
  vi.hoisted(() => {
    const mockCountDocuments = vi.fn();
    const mockLean = vi.fn();
    const mockLimit = vi.fn().mockReturnValue({ lean: mockLean });
    const mockSkip = vi.fn().mockReturnValue({ limit: mockLimit });
    const mockSort = vi.fn().mockReturnValue({ skip: mockSkip });
    const mockFind = vi.fn().mockReturnValue({ sort: mockSort });

    return {
      mockCountDocuments,
      mockLean,
      mockLimit,
      mockSkip,
      mockSort,
      mockFind,
    };
  });

vi.mock("../data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../data")>();
  return {
    ...actual,
    Assignment: {
      countDocuments: mockCountDocuments,
      find: mockFind,
    },
  };
});

import app from "../app";

describe("GET /api/v1/assignments envelope & query handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCountDocuments.mockResolvedValue(2);
    mockLean.mockResolvedValue([
      { _id: "650000000000000000000001", title: "Join 101", difficulty: "easy", mode: "read" },
      { _id: "650000000000000000000002", title: "Group By", difficulty: "medium", mode: "write" },
    ]);
  });

  it("returns default pagination envelope with Cache-Control header", async () => {
    const res = await request(app).get("/api/v1/assignments");

    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("public, max-age=15");
    expect(res.body).toEqual({
      assignments: [
        { _id: "650000000000000000000001", title: "Join 101", difficulty: "easy", mode: "read" },
        { _id: "650000000000000000000002", title: "Group By", difficulty: "medium", mode: "write" },
      ],
      page: 1,
      limit: 20,
      total: 2,
      totalPages: 1,
    });
    expect(mockFind).toHaveBeenCalledWith(
      expect.objectContaining({ pgSchemaReady: true }),
      { _id: 1, title: 1, difficulty: 1, mode: 1, origin: 1, contributor: 1 }
    );
  });

  it("supports page and limit query parameters", async () => {
    mockCountDocuments.mockResolvedValue(25);
    mockLean.mockResolvedValue([
      { _id: "650000000000000000000003", title: "Window Functions", difficulty: "hard", mode: "read" },
    ]);

    const res = await request(app).get("/api/v1/assignments?page=2&limit=5");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      assignments: [
        { _id: "650000000000000000000003", title: "Window Functions", difficulty: "hard", mode: "read" },
      ],
      page: 2,
      limit: 5,
      total: 25,
      totalPages: 5,
    });
    expect(mockSkip).toHaveBeenCalledWith(5); // (2-1)*5
    expect(mockLimit).toHaveBeenCalledWith(5);
  });

  it("supports free-text search query parameter q", async () => {
    await request(app).get("/api/v1/assignments?q=join");

    expect(mockFind).toHaveBeenCalledWith(
      expect.objectContaining({
        pgSchemaReady: true,
        $or: [
          { title: { $regex: "join", $options: "i" } },
          { description: { $regex: "join", $options: "i" } },
        ],
      }),
      expect.anything()
    );
  });

  it("supports filtering by difficulty and mode", async () => {
    await request(app).get("/api/v1/assignments?filter[difficulty]=easy&filter[mode]=read");

    expect(mockFind).toHaveBeenCalledWith(
      expect.objectContaining({
        pgSchemaReady: true,
        difficulty: "easy",
        mode: "read",
      }),
      expect.anything()
    );
  });

  it("supports sorting by title asc", async () => {
    await request(app).get("/api/v1/assignments?sort=title&order=asc");

    expect(mockSort).toHaveBeenCalledWith({ title: 1 });
  });

  it("returns 400 when invalid sort field is requested", async () => {
    const res = await request(app).get("/api/v1/assignments?sort=invalid_column");

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid query parameter");
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "sort" }),
      ])
    );
  });

  it("returns 400 when invalid filter value is requested", async () => {
    const res = await request(app).get("/api/v1/assignments?filter[difficulty]=impossible");

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid query parameter");
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "filter[difficulty]" }),
      ])
    );
  });

  it("returns 400 when page is less than 1", async () => {
    const res = await request(app).get("/api/v1/assignments?page=0");

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid query parameter");
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "page" }),
      ])
    );
  });
});
