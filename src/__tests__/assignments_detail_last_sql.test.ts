import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const {
  mockGetSession,
  mockGetAssignmentByIdCached,
  mockFindOne,
  mockFindOneAndUpdate,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockGetAssignmentByIdCached: vi.fn(),
  mockFindOne: vi.fn(),
  mockFindOneAndUpdate: vi.fn(),
}));

vi.mock("../auth", () => ({
  auth: {
    api: {
      getSession: mockGetSession,
    },
  },
}));

vi.mock("../services", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services")>();
  return {
    ...actual,
    getAssignmentByIdCached: mockGetAssignmentByIdCached,
  };
});

vi.mock("../data/db/models/user_sql_state", () => ({
  UserSqlState: {
    findOne: mockFindOne,
    findOneAndUpdate: mockFindOneAndUpdate,
  },
}));

import app from "../app";

describe("Assignments detail & last-sql routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/v1/assignments/:id", () => {
    it("returns 400 when provided an invalid ObjectId", async () => {
      const res = await request(app).get("/api/v1/assignments/invalid-id");

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error: "The provided assignmentId is invalid!",
      });
    });

    it("returns 404 when assignment is not found", async () => {
      mockGetAssignmentByIdCached.mockResolvedValue(null);

      const res = await request(app).get(
        "/api/v1/assignments/650000000000000000000099",
      );

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Assignment not found!" });
    });

    it("returns 200 and assignment object when assignment exists and pgSchemaReady is true", async () => {
      const mockAssignment = {
        _id: "650000000000000000000001",
        title: "Test Assignment",
        pgSchemaReady: true,
      };
      mockGetAssignmentByIdCached.mockResolvedValue(mockAssignment);

      const res = await request(app).get(
        "/api/v1/assignments/650000000000000000000001",
      );

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ assignment: mockAssignment });
    });
  });

  describe("GET /api/v1/assignments/:id/last-sql", () => {
    it("returns 401 without session", async () => {
      mockGetSession.mockResolvedValue(null);

      const res = await request(app).get(
        "/api/v1/assignments/650000000000000000000001/last-sql",
      );

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: "Authentication required" });
    });

    it("returns 400 on invalid ObjectId when authenticated", async () => {
      mockGetSession.mockResolvedValue({
        user: { id: "user-1", email: "user@example.com" },
        session: { id: "session-1" },
      });

      const res = await request(app).get(
        "/api/v1/assignments/invalid-id/last-sql",
      );

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error: "The provided assignmentId is invalid!",
      });
    });

    it("returns 200 with null userSql when no state saved", async () => {
      mockGetSession.mockResolvedValue({
        user: { id: "user-1", email: "user@example.com" },
        session: { id: "session-1" },
      });
      mockFindOne.mockReturnValue({
        lean: vi.fn().mockResolvedValue(null),
      });

      const res = await request(app).get(
        "/api/v1/assignments/650000000000000000000001/last-sql",
      );

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ userSql: null });
    });

    it("returns 200 with saved userSql when found", async () => {
      mockGetSession.mockResolvedValue({
        user: { id: "user-1", email: "user@example.com" },
        session: { id: "session-1" },
      });
      const updatedAt = new Date().toISOString();
      mockFindOne.mockReturnValue({
        lean: vi.fn().mockResolvedValue({
          userId: "user-1",
          assignmentId: "650000000000000000000001",
          userSql: "SELECT 1;",
          updatedAt,
        }),
      });

      const res = await request(app).get(
        "/api/v1/assignments/650000000000000000000001/last-sql",
      );

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ userSql: "SELECT 1;", updatedAt });
    });
  });

  describe("POST /api/v1/assignments/:id/last-sql", () => {
    it("returns 401 without session", async () => {
      mockGetSession.mockResolvedValue(null);

      const res = await request(app)
        .post("/api/v1/assignments/650000000000000000000001/last-sql")
        .send({ userSql: "SELECT 1;" });

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: "Authentication required" });
    });

    it("returns 403 when user email is not verified", async () => {
      mockGetSession.mockResolvedValue({
        user: { id: "user-1", email: "user@example.com", emailVerified: false },
        session: { id: "session-1" },
      });

      const res = await request(app)
        .post("/api/v1/assignments/650000000000000000000001/last-sql")
        .send({ userSql: "SELECT 1;" });

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: "Email verification required" });
    });

    it("returns 400 on invalid userSql when authenticated", async () => {
      mockGetSession.mockResolvedValue({
        user: { id: "user-1", email: "user@example.com", emailVerified: true },
        session: { id: "session-1" },
      });

      const res = await request(app)
        .post("/api/v1/assignments/650000000000000000000001/last-sql")
        .send({ userSql: "" });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "An invalid SQL query provided!" });
    });

    it("returns 200 and saves last sql when valid", async () => {
      mockGetSession.mockResolvedValue({
        user: { id: "user-1", email: "user@example.com", emailVerified: true },
        session: { id: "session-1" },
      });
      mockFindOneAndUpdate.mockResolvedValue({});

      const res = await request(app)
        .post("/api/v1/assignments/650000000000000000000001/last-sql")
        .send({ userSql: "SELECT * FROM users;" });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
        { userId: "user-1", assignmentId: "650000000000000000000001" },
        { userSql: "SELECT * FROM users;", updatedAt: expect.any(Date) },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
    });
  });
});
