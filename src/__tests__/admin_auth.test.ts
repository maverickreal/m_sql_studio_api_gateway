import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const { mockGetSession } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
}));

vi.mock("../auth", () => ({
  auth: {
    api: {
      getSession: mockGetSession,
    },
  },
}));

import app from "../app";

describe("Auth 401/403 on /api/v1/admin/*", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Unauthenticated requests (401)", () => {
    beforeEach(() => {
      mockGetSession.mockResolvedValue(null);
    });

    it("GET /api/v1/admin/assignments returns 401", async () => {
      const res = await request(app).get("/api/v1/admin/assignments");
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: "Authentication required" });
    });

    it("POST /api/v1/admin/assignments returns 401", async () => {
      const res = await request(app)
        .post("/api/v1/admin/assignments")
        .send({ title: "Test" });
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: "Authentication required" });
    });

    it("GET /api/v1/admin/users returns 401", async () => {
      const res = await request(app).get("/api/v1/admin/users");
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: "Authentication required" });
    });

    it("POST /api/v1/admin/users/user123/role returns 401", async () => {
      const res = await request(app)
        .post("/api/v1/admin/users/user123/role")
        .send({ role: "admin" });
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: "Authentication required" });
    });

    it("GET /api/v1/admin/audit returns 401", async () => {
      const res = await request(app).get("/api/v1/admin/audit");
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: "Authentication required" });
    });
  });

  describe("Authenticated unverified requests (403)", () => {
    beforeEach(() => {
      mockGetSession.mockResolvedValue({
        user: {
          id: "user-1",
          email: "user@example.com",
          role: "admin",
          emailVerified: false,
        },
        session: { id: "session-1" },
      });
    });

    it("POST /api/v1/admin/assignments returns 403 when unverified", async () => {
      const res = await request(app)
        .post("/api/v1/admin/assignments")
        .send({ title: "Test" });
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: "Email verification required" });
    });

    it("GET /api/v1/admin/assignments returns 403 when unverified", async () => {
      const res = await request(app).get("/api/v1/admin/assignments");
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: "Email verification required" });
    });
  });

  describe("Authenticated non-admin requests (403)", () => {
    beforeEach(() => {
      mockGetSession.mockResolvedValue({
        user: {
          id: "user-1",
          email: "user@example.com",
          role: "user",
          emailVerified: true,
        },
        session: { id: "session-1" },
      });
    });

    it("GET /api/v1/admin/assignments returns 403", async () => {
      const res = await request(app).get("/api/v1/admin/assignments");
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: "Admin access required" });
    });

    it("POST /api/v1/admin/assignments returns 403", async () => {
      const res = await request(app)
        .post("/api/v1/admin/assignments")
        .send({ title: "Test" });
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: "Admin access required" });
    });

    it("GET /api/v1/admin/users returns 403", async () => {
      const res = await request(app).get("/api/v1/admin/users");
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: "Admin access required" });
    });

    it("POST /api/v1/admin/users/user123/role returns 403", async () => {
      const res = await request(app)
        .post("/api/v1/admin/users/user123/role")
        .send({ role: "admin" });
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: "Admin access required" });
    });

    it("GET /api/v1/admin/audit returns 403", async () => {
      const res = await request(app).get("/api/v1/admin/audit");
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: "Admin access required" });
    });
  });
});
