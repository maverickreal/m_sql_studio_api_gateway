import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const {
  mockGetSession,
  mockFindOne,
  mockFindOneAndUpdate,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
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

vi.mock("../data/db/models/user_profile", async () => {
  // Export real zod schemas that work with z.object()
  const { z } = await import("zod/v4");

  const ProfileUpdateValidatorSchema = z.object({
    displayName: z.string().min(1).max(50).optional(),
    bio: z.string().max(500).optional(),
    avatarUrl: z.string().url().startsWith("https://").nullable().optional(),
    preferences: z
      .object({
        theme: z.enum(["system", "light", "dark"]).optional(),
        emailNotifications: z.boolean().optional(),
        publicProfile: z.boolean().optional(),
      })
      .optional(),
  });

  return {
    UserProfile: {
      findOne: mockFindOne,
      findOneAndUpdate: mockFindOneAndUpdate,
    },
    ProfileUpdateValidatorSchema,
  };
});

import app from "../app";

describe("Profile API — /api/v1/profile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockProfile = (overrides: Partial<any> = {}) => ({
    _id: "profile-1",
    userId: "user-1",
    displayName: "Test User",
    bio: "Test bio",
    avatarUrl: "https://example.com/avatar.png",
    preferences: {
      theme: "system",
      emailNotifications: true,
      publicProfile: true,
    },
    stats: {
      assignmentsCompleted: 5,
      totalExecutions: 20,
      lastActiveAt: new Date("2026-09-10T00:00:00Z"),
    },
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-09-01T00:00:00Z"),
    ...overrides,
  });

  describe("GET /api/v1/profile/me", () => {
    it("returns 401 when unauthenticated", async () => {
      mockGetSession.mockResolvedValue(null);

      const res = await request(app).get("/api/v1/profile/me");

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: "Authentication required" });
    });

    it("returns 404 when profile not found for authenticated user", async () => {
      mockGetSession.mockResolvedValue({
        user: { id: "user-1", email: "user@example.com", role: "user" },
        session: { id: "session-1" },
      });
      mockFindOne.mockReturnValue({
        lean: vi.fn().mockResolvedValue(null),
      });

      const res = await request(app).get("/api/v1/profile/me");

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Profile not found" });
    });

    it("returns 200 with profile when authenticated owner", async () => {
      mockGetSession.mockResolvedValue({
        user: { id: "user-1", email: "user@example.com", role: "user" },
        session: { id: "session-1" },
      });
      const profile = mockProfile();
      mockFindOne.mockReturnValue({
        lean: vi.fn().mockResolvedValue(profile),
      });

      const res = await request(app).get("/api/v1/profile/me");

      expect(res.status).toBe(200);
      expect(res.body.profile).toMatchObject({
        userId: "user-1",
        displayName: "Test User",
        bio: "Test bio",
        avatarUrl: "https://example.com/avatar.png",
        preferences: {
          theme: "system",
          emailNotifications: true,
          publicProfile: true,
        },
        stats: {
          assignmentsCompleted: 5,
          totalExecutions: 20,
          lastActiveAt: "2026-09-10T00:00:00.000Z",
        },
      });
      expect(res.body.profile.createdAt).toBeDefined();
      expect(res.body.profile.updatedAt).toBeDefined();
    });
  });

  describe("PATCH /api/v1/profile/me", () => {
    it("returns 401 when unauthenticated", async () => {
      mockGetSession.mockResolvedValue(null);

      const res = await request(app)
        .patch("/api/v1/profile/me")
        .send({ displayName: "New Name" });

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: "Authentication required" });
    });

    it("returns 400 when avatarUrl is not https", async () => {
      mockGetSession.mockResolvedValue({
        user: { id: "user-1", email: "user@example.com", role: "user" },
        session: { id: "session-1" },
      });

      const res = await request(app)
        .patch("/api/v1/profile/me")
        .send({ avatarUrl: "http://example.com/avatar.png" });

      expect(res.status).toBe(400);
    });

    it("returns 200 and updates profile when valid", async () => {
      mockGetSession.mockResolvedValue({
        user: { id: "user-1", email: "user@example.com", role: "user" },
        session: { id: "session-1" },
      });
      const updatedProfile = mockProfile({ displayName: "Updated Name", bio: "Updated bio" });
      mockFindOne.mockReturnValue({
        lean: vi.fn().mockResolvedValue(null),
      });
      mockFindOneAndUpdate.mockReturnValue({
        lean: vi.fn().mockResolvedValue(updatedProfile),
      });

      const res = await request(app)
        .patch("/api/v1/profile/me")
        .send({ displayName: "Updated Name", bio: "Updated bio" });

      expect(res.status).toBe(200);
      expect(res.body.profile.displayName).toBe("Updated Name");
      expect(res.body.profile.bio).toBe("Updated bio");
    });

    it("returns 409 when displayName is already taken", async () => {
      mockGetSession.mockResolvedValue({
        user: { id: "user-1", email: "user@example.com", role: "user" },
        session: { id: "session-1" },
      });
      mockFindOne.mockReturnValue({
        lean: vi.fn().mockResolvedValue(mockProfile({ displayName: "Taken Name" })),
      });

      const res = await request(app)
        .patch("/api/v1/profile/me")
        .send({ displayName: "Taken Name" });

      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: "Display name already taken" });
    });
  });

  describe("GET /api/v1/profile/:id", () => {
    it("returns 404 when profile not found", async () => {
      mockGetSession.mockResolvedValue(null);
      mockFindOne.mockReturnValue({
        lean: vi.fn().mockResolvedValue(null),
      });

      const res = await request(app).get("/api/v1/profile/nonexistent-id");

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Profile not found" });
    });

    it("returns 200 with public profile for unauthenticated user", async () => {
      mockGetSession.mockResolvedValue(null);
      const profile = mockProfile({ preferences: { ...mockProfile().preferences, publicProfile: true } });
      mockFindOne.mockReturnValue({
        lean: vi.fn().mockResolvedValue(profile),
      });

      const res = await request(app).get("/api/v1/profile/user-1");

      expect(res.status).toBe(200);
      expect(res.body.profile).toMatchObject({
        userId: "user-1",
        displayName: "Test User",
        bio: "Test bio",
        avatarUrl: "https://example.com/avatar.png",
        stats: {
          assignmentsCompleted: 5,
          totalExecutions: 20,
          lastActiveAt: "2026-09-10T00:00:00.000Z",
        },
      });
      expect(res.body.profile.preferences).toBeUndefined();
    });

    it("returns 404 for private profile when unauthenticated", async () => {
      mockGetSession.mockResolvedValue(null);
      const profile = mockProfile({ preferences: { ...mockProfile().preferences, publicProfile: false } });
      mockFindOne.mockReturnValue({
        lean: vi.fn().mockResolvedValue(profile),
      });

      const res = await request(app).get("/api/v1/profile/user-1");

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Profile not found" });
    });

    it("returns 404 for private profile when accessed by other user", async () => {
      mockGetSession.mockResolvedValue({
        user: { id: "user-2", email: "other@example.com", role: "user" },
        session: { id: "session-2" },
      });
      const profile = mockProfile({
        userId: "user-1",
        preferences: { ...mockProfile().preferences, publicProfile: false },
      });
      mockFindOne.mockReturnValue({
        lean: vi.fn().mockResolvedValue(profile),
      });

      const res = await request(app).get("/api/v1/profile/user-1");

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "Profile not found" });
    });

    it("returns 200 with full profile for owner of private profile", async () => {
      mockGetSession.mockResolvedValue({
        user: { id: "user-1", email: "user@example.com", role: "user" },
        session: { id: "session-1" },
      });
      const profile = mockProfile({
        userId: "user-1",
        preferences: { ...mockProfile().preferences, publicProfile: false },
      });
      mockFindOne.mockReturnValue({
        lean: vi.fn().mockResolvedValue(profile),
      });

      const res = await request(app).get("/api/v1/profile/user-1");

      expect(res.status).toBe(200);
      expect(res.body.profile).toMatchObject({
        userId: "user-1",
        displayName: "Test User",
        preferences: {
          theme: "system",
          emailNotifications: true,
          publicProfile: false,
        },
      });
    });

    it("returns 200 with full profile for admin accessing private profile", async () => {
      mockGetSession.mockResolvedValue({
        user: { id: "admin-1", email: "admin@example.com", role: "admin" },
        session: { id: "session-admin" },
      });
      const profile = mockProfile({
        userId: "user-1",
        preferences: { ...mockProfile().preferences, publicProfile: false },
      });
      mockFindOne.mockReturnValue({
        lean: vi.fn().mockResolvedValue(profile),
      });

      const res = await request(app).get("/api/v1/profile/user-1");

      expect(res.status).toBe(200);
      expect(res.body.profile.preferences).toBeDefined();
    });

    it("returns 200 with public profile (no preferences) for other user when public", async () => {
      mockGetSession.mockResolvedValue({
        user: { id: "user-2", email: "other@example.com", role: "user" },
        session: { id: "session-2" },
      });
      const profile = mockProfile({
        userId: "user-1",
        preferences: { ...mockProfile().preferences, publicProfile: true },
      });
      mockFindOne.mockReturnValue({
        lean: vi.fn().mockResolvedValue(profile),
      });

      const res = await request(app).get("/api/v1/profile/user-1");

      expect(res.status).toBe(200);
      expect(res.body.profile.preferences).toBeUndefined();
      expect(res.body.profile.userId).toBe("user-1");
    });
  });
});