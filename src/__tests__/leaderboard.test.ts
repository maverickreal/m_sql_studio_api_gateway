import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const { mockAggregate, mockDistinct, mockFindOne } = vi.hoisted(() => ({
  mockAggregate: vi.fn(),
  mockDistinct: vi.fn(),
  mockFindOne: vi.fn(),
}));

vi.mock("../data/db/models/user_pass", () => ({
  UserPass: {
    aggregate: mockAggregate,
    distinct: mockDistinct,
  },
}));

vi.mock("../data/db/models/user_profile", () => ({
  UserProfile: {
    findOne: mockFindOne,
  },
}));

import app from "../app";

describe("GET /api/v1/leaderboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty entries when no passes exist", async () => {
    mockAggregate.mockResolvedValue([]);
    mockDistinct.mockResolvedValue([]);

    const res = await request(app).get("/api/v1/leaderboard");

    expect(res.status).toBe(200);
    expect(res.body.entries).toEqual([]);
    expect(res.body.total).toBe(0);
    expect(res.body.generatedAt).toBeDefined();
  });

  it("returns sorted entries by passes desc", async () => {
    mockAggregate.mockResolvedValue([
      { _id: "user-1", passes: 5, lastPassAt: new Date("2026-09-10T00:00:00Z") },
      { _id: "user-2", passes: 3, lastPassAt: new Date("2026-09-10T01:00:00Z") },
      { _id: "user-3", passes: 1, lastPassAt: new Date("2026-09-10T02:00:00Z") },
    ]);
    mockDistinct.mockResolvedValue(["user-1", "user-2", "user-3"]);
    mockFindOne.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue({ displayName: "Alice" }),
    });

    const res = await request(app).get("/api/v1/leaderboard");

    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(3);
    expect(res.body.entries[0].passes).toBe(5);
    expect(res.body.entries[1].passes).toBe(3);
    expect(res.body.entries[2].passes).toBe(1);
    expect(res.body.total).toBe(3);
  });

  it("respects limit and offset", async () => {
    mockAggregate.mockResolvedValue([
      { _id: "user-2", passes: 3, lastPassAt: new Date("2026-09-10T01:00:00Z") },
    ]);
    mockDistinct.mockResolvedValue(["user-1", "user-2", "user-3"]);
    mockFindOne.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue({ displayName: "Bob" }),
    });

    const res = await request(app).get("/api/v1/leaderboard?limit=1&offset=1");

    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(1);
    expect(res.body.total).toBe(3);
    expect(res.body.entries[0].userId).toBe("user-2");
  });

  it("tiebreaks by lastPassAt when passes are equal", async () => {
    mockAggregate.mockResolvedValue([
      { _id: "user-1", passes: 3, lastPassAt: new Date("2026-09-09T00:00:00Z") },
      { _id: "user-2", passes: 3, lastPassAt: new Date("2026-09-10T00:00:00Z") },
    ]);
    mockDistinct.mockResolvedValue(["user-1", "user-2"]);
    mockFindOne.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue({ displayName: "Alice" }),
    });

    const res = await request(app).get("/api/v1/leaderboard");

    expect(res.status).toBe(200);
    expect(res.body.entries[0].userId).toBe("user-1");
    expect(res.body.entries[1].userId).toBe("user-2");
  });
});