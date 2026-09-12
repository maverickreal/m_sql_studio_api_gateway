import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const {
  mockGetSession,
  mockListUsers,
  mockSetRole,
  mockFindOne,
  mockCountDocuments,
  mockToArray,
  mockAuditLogCreate,
  mockAuditLogFind,
} = vi.hoisted(() => {
  const mockGetSession = vi.fn();
  const mockListUsers = vi.fn();
  const mockSetRole = vi.fn();
  const mockFindOne = vi.fn();
  const mockCountDocuments = vi.fn();
  const mockToArray = vi.fn();
  const mockAuditLogCreate = vi.fn();

  const mockLean = vi.fn();
  const mockLimit = vi.fn().mockReturnValue({ lean: mockLean });
  const mockSort = vi.fn().mockReturnValue({ limit: mockLimit, lean: mockLean });
  const mockAuditLogFind = vi.fn().mockReturnValue({ sort: mockSort });

  return {
    mockGetSession,
    mockListUsers,
    mockSetRole,
    mockFindOne,
    mockCountDocuments,
    mockToArray,
    mockAuditLogCreate,
    mockAuditLogFind,
  };
});

vi.mock("../auth", () => ({
  auth: {
    api: {
      getSession: mockGetSession,
      listUsers: mockListUsers,
      setRole: mockSetRole,
    },
  },
}));

vi.mock("../data/db/client", () => ({
  sharedMongoClient: {
    db: () => ({
      collection: () => ({
        find: () => ({
          project: () => ({
            limit: () => ({
              toArray: mockToArray,
            }),
          }),
        }),
        findOne: mockFindOne,
        countDocuments: mockCountDocuments,
      }),
    }),
  },
}));

vi.mock("../data/db/models/audit_log", () => ({
  AuditLog: {
    create: mockAuditLogCreate,
    find: mockAuditLogFind,
  },
}));

import app from "../app";

describe("Admin users and audit log endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default session: authenticated admin user
    mockGetSession.mockResolvedValue({
      user: { id: "admin-actor-id", email: "admin@example.com", role: "admin", emailVerified: true },
      session: { id: "session-admin" },
    });
  });

  describe("GET /api/v1/admin/users", () => {
    it("returns user list using auth.api.listUsers when available", async () => {
      mockListUsers.mockResolvedValue({
        users: [
          { id: "u-1", email: "alice@example.com", name: "Alice", role: "admin" },
          { id: "u-2", email: "bob@example.com", name: "Bob", role: "user" },
        ],
      });

      const res = await request(app).get("/api/v1/admin/users");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        items: [
          { id: "u-1", email: "alice@example.com", name: "Alice", role: "admin" },
          { id: "u-2", email: "bob@example.com", name: "Bob", role: "user" },
        ],
      });
      expect(mockListUsers).toHaveBeenCalled();
    });

    it("falls back to mongo collection when auth.api.listUsers fails", async () => {
      mockListUsers.mockRejectedValue(new Error("auth api error"));
      mockToArray.mockResolvedValue([
        { _id: "mongo-u1", email: "charlie@example.com", name: "Charlie", role: "user" },
      ]);

      const res = await request(app).get("/api/v1/admin/users");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        items: [
          { id: "mongo-u1", email: "charlie@example.com", name: "Charlie", role: "user" },
        ],
      });
    });
  });

  describe("POST /api/v1/admin/users/:id/role", () => {
    it("returns 400 when body role is invalid or missing", async () => {
      const res = await request(app)
        .post("/api/v1/admin/users/u-1/role")
        .send({ role: "superadmin" });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "role must be admin or user" });
    });

    it("returns 404 when target user is not found", async () => {
      mockFindOne.mockResolvedValue(null);

      const res = await request(app)
        .post("/api/v1/admin/users/nonexistent/role")
        .send({ role: "admin" });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "User not found" });
    });

    it("returns 200 without changes if user already has requested role", async () => {
      mockFindOne.mockResolvedValue({ id: "u-1", role: "user" });

      const res = await request(app)
        .post("/api/v1/admin/users/u-1/role")
        .send({ role: "user" });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ user: { id: "u-1", role: "user" } });
      expect(mockSetRole).not.toHaveBeenCalled();
    });

    it("returns 409 when attempting to demote the last admin", async () => {
      mockFindOne.mockResolvedValue({ id: "u-last-admin", role: "admin" });
      mockCountDocuments.mockResolvedValue(1); // only 1 admin exists

      const res = await request(app)
        .post("/api/v1/admin/users/u-last-admin/role")
        .send({ role: "user" });

      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: "Cannot demote the last admin" });
      expect(mockSetRole).not.toHaveBeenCalled();
    });

    it("successfully promotes user to admin and writes audit log", async () => {
      mockFindOne.mockResolvedValue({ id: "u-user", role: "user" });
      mockSetRole.mockResolvedValue({ user: { id: "u-user", role: "admin" } });
      mockAuditLogCreate.mockResolvedValue({ _id: "audit-1" });

      const res = await request(app)
        .post("/api/v1/admin/users/u-user/role")
        .send({ role: "admin" });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ user: { id: "u-user", role: "admin" } });
      expect(mockSetRole).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { userId: "u-user", role: "admin" },
        })
      );
      expect(mockAuditLogCreate).toHaveBeenCalledWith({
        actorId: "admin-actor-id",
        action: "role.change",
        targetType: "user",
        targetId: "u-user",
        meta: { from: "user", to: "admin" },
      });
    });

    it("successfully demotes admin when multiple admins exist", async () => {
      mockFindOne.mockResolvedValue({ id: "u-admin-2", role: "admin" });
      mockCountDocuments.mockResolvedValue(3); // 3 admins exist
      mockSetRole.mockResolvedValue({ user: { id: "u-admin-2", role: "user" } });
      mockAuditLogCreate.mockResolvedValue({ _id: "audit-2" });

      const res = await request(app)
        .post("/api/v1/admin/users/u-admin-2/role")
        .send({ role: "user" });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ user: { id: "u-admin-2", role: "user" } });
      expect(mockSetRole).toHaveBeenCalled();
    });
  });

  describe("GET /api/v1/admin/audit", () => {
    it("returns audit log items", async () => {
      const mockAuditRows = [
        {
          _id: "a-1",
          actorId: "admin-actor-id",
          action: "role.change",
          targetType: "user",
          targetId: "u-user",
          at: new Date("2026-09-09T10:00:00Z").toISOString(),
        },
      ];

      const mockLean = vi.fn().mockResolvedValue(mockAuditRows);
      const mockLimit = vi.fn().mockReturnValue({ lean: mockLean });
      const mockSort = vi.fn().mockReturnValue({ limit: mockLimit, lean: mockLean });
      mockAuditLogFind.mockReturnValue({ sort: mockSort });

      const res = await request(app).get("/api/v1/admin/audit?limit=10");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ items: mockAuditRows });
      expect(mockAuditLogFind).toHaveBeenCalled();
    });

    it("completes cleanly when audit log response exceeds 16KB (Bun chunking verification)", async () => {
      // Generate rows to ensure total response payload is > 16KB (16384 bytes)
      const largeRows = Array.from({ length: 120 }, (_, i) => ({
        _id: `audit-large-entry-${i}-${"x".repeat(50)}`,
        actorId: `admin-actor-uuid-${i}-${"y".repeat(30)}`,
        action: "role.change",
        targetType: "user",
        targetId: `target-user-uuid-${i}-${"z".repeat(30)}`,
        meta: { from: "user", to: "admin", note: "filler payload for >16KB Bun stream verification" },
        at: new Date("2026-09-09T10:00:00Z").toISOString(),
      }));

      const mockLean = vi.fn().mockResolvedValue(largeRows);
      const mockLimit = vi.fn().mockReturnValue({ lean: mockLean });
      const mockSort = vi.fn().mockReturnValue({ limit: mockLimit, lean: mockLean });
      mockAuditLogFind.mockReturnValue({ sort: mockSort });

      const res = await request(app).get("/api/v1/admin/audit?limit=200");

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(120);
      const payloadBytes = Buffer.byteLength(JSON.stringify(res.body));
      expect(payloadBytes).toBeGreaterThan(16384);
    });
  });
});
