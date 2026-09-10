import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

const mockUserProfile = vi.hoisted(() => ({
  findOne: vi.fn(),
  findOneAndUpdate: vi.fn(),
  create: vi.fn(),
}));

vi.mock("../data/db/models/user_profile", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../data/db/models/user_profile")>();
  return {
    ...actual,
    UserProfile: mockUserProfile,
  };
});

import {
  get_my_profile,
  update_my_profile,
  get_public_profile,
} from "../controllers/profile";

function makeReq(overrides: Record<string, unknown> = {}): Request {
  return {
    params: {},
    body: {},
    ...overrides,
  } as unknown as Request;
}

function makeRes(): Response {
  const res: any = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res as Response;
}

describe("GET /profile/me", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 200 with profile for authenticated owner", async () => {
    const profileDoc = {
      _id: "p1",
      userId: "user-1",
      displayName: "Alice",
      bio: "Hello",
      avatarUrl: null,
      preferences: { theme: "system", emailNotifications: true, publicProfile: true },
      stats: { assignmentsCompleted: 3, totalExecutions: 10, lastActiveAt: null },
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-09-01T00:00:00Z"),
    };
    const lean = vi.fn().mockResolvedValue(profileDoc);
    mockUserProfile.findOne.mockReturnValue({ lean } as any);

    const req = makeReq({ user: { id: "user-1", email: "a@x.com", role: "user" } });
    const res = makeRes();

    await get_my_profile(req, res);

    expect(mockUserProfile.findOne).toHaveBeenCalledWith({ userId: "user-1" });
    expect(res.status).toHaveBeenCalledWith(200);
    const body = (res.json as any).mock.calls[0][0];
    expect(body.profile.displayName).toBe("Alice");
    expect(body.profile.userId).toBe("user-1");
    expect(body.profile.preferences).toBeDefined();
  });

  it("returns 404 when profile not found", async () => {
    const lean = vi.fn().mockResolvedValue(null);
    mockUserProfile.findOne.mockReturnValue({ lean } as any);

    const req = makeReq({ user: { id: "user-1", email: "a@x.com", role: "user" } });
    const res = makeRes();

    await get_my_profile(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: "Profile not found" });
  });
});

describe("PATCH /profile/me", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 200 with updated profile", async () => {
    const updatedDoc = {
      _id: "p1",
      userId: "user-1",
      displayName: "Alice Updated",
      bio: "New bio",
      avatarUrl: "https://example.com/a.png",
      preferences: { theme: "dark", emailNotifications: true, publicProfile: true },
      stats: { assignmentsCompleted: 4, totalExecutions: 11, lastActiveAt: null },
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-09-10T00:00:00Z"),
    };
    const leanForFind = vi.fn().mockResolvedValue(null);
    mockUserProfile.findOne.mockReturnValue({ lean: leanForFind } as any);
    const leanForUpdate = vi.fn().mockResolvedValue(updatedDoc);
    mockUserProfile.findOneAndUpdate.mockReturnValue({ lean: leanForUpdate } as any);

    const req = makeReq({
      user: { id: "user-1", email: "a@x.com", role: "user" },
      body: { displayName: "Alice Updated", bio: "New bio", avatarUrl: "https://example.com/a.png", preferences: { theme: "dark" } },
    });
    const res = makeRes();

    await update_my_profile(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = (res.json as any).mock.calls[0][0];
    expect(body.profile.displayName).toBe("Alice Updated");
    expect(body.profile.preferences.theme).toBe("dark");
  });

  it("returns 400 for invalid body", async () => {
    const req = makeReq({
      user: { id: "user-1", email: "a@x.com", role: "user" },
      body: { avatarUrl: "not-a-url" },
    });
    const res = makeRes();

    await update_my_profile(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 409 when displayName is taken", async () => {
    const lean = vi.fn().mockResolvedValue({ _id: "p2", userId: "user-99", displayName: "Taken" });
    mockUserProfile.findOne.mockReturnValue({ lean } as any);

    const req = makeReq({
      user: { id: "user-1", email: "a@x.com", role: "user" },
      body: { displayName: "Taken" },
    });
    const res = makeRes();

    await update_my_profile(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: "Display name already taken" });
  });

  it("returns 404 when profile missing during update", async () => {
    const leanForFind = vi.fn().mockResolvedValue(null);
    mockUserProfile.findOne.mockReturnValue({ lean: leanForFind } as any);
    const leanForUpdate = vi.fn().mockResolvedValue(null);
    mockUserProfile.findOneAndUpdate.mockReturnValue({ lean: leanForUpdate } as any);

    const req = makeReq({
      user: { id: "user-1", email: "a@x.com", role: "user" },
      body: { displayName: "New Name" },
    });
    const res = makeRes();

    await update_my_profile(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe("GET /profile/:id", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 200 for public profile (no auth)", async () => {
    const profileDoc = {
      _id: "p2",
      userId: "user-2",
      displayName: "Bob",
      bio: "Bobs bio",
      avatarUrl: null,
      preferences: { theme: "system", emailNotifications: true, publicProfile: true },
      stats: { assignmentsCompleted: 7, totalExecutions: 21, lastActiveAt: null },
      createdAt: new Date("2026-03-01T00:00:00Z"),
      updatedAt: new Date("2026-09-05T00:00:00Z"),
    };
    const lean = vi.fn().mockResolvedValue(profileDoc);
    mockUserProfile.findOne.mockReturnValue({ lean } as any);

    const req = makeReq({ params: { id: "user-2" } });
    const res = makeRes();

    await get_public_profile(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = (res.json as any).mock.calls[0][0];
    expect(body.profile.displayName).toBe("Bob");
    expect(body.profile.preferences).toBeUndefined();
  });

  it("returns 200 for private profile when accessed by owner", async () => {
    const profileDoc = {
      _id: "p2",
      userId: "user-2",
      displayName: "Bob",
      bio: "Private",
      avatarUrl: null,
      preferences: { theme: "system", emailNotifications: false, publicProfile: false },
      stats: { assignmentsCompleted: 7, totalExecutions: 21, lastActiveAt: null },
      createdAt: new Date("2026-03-01T00:00:00Z"),
      updatedAt: new Date("2026-09-05T00:00:00Z"),
    };
    const lean = vi.fn().mockResolvedValue(profileDoc);
    mockUserProfile.findOne.mockReturnValue({ lean } as any);

    const req = makeReq({
      user: { id: "user-2", email: "b@x.com", role: "user" },
      params: { id: "user-2" },
    });
    const res = makeRes();

    await get_public_profile(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = (res.json as any).mock.calls[0][0];
    expect(body.profile.preferences).toBeDefined();
  });

  it("returns 404 for private profile accessed by other user", async () => {
    const profileDoc = {
      _id: "p2",
      userId: "user-2",
      displayName: "Bob",
      bio: "Private",
      avatarUrl: null,
      preferences: { theme: "system", emailNotifications: false, publicProfile: false },
      stats: { assignmentsCompleted: 7, totalExecutions: 21, lastActiveAt: null },
      createdAt: new Date("2026-03-01T00:00:00Z"),
      updatedAt: new Date("2026-09-05T00:00:00Z"),
    };
    const lean = vi.fn().mockResolvedValue(profileDoc);
    mockUserProfile.findOne.mockReturnValue({ lean } as any);

    const req = makeReq({
      user: { id: "user-1", email: "a@x.com", role: "user" },
      params: { id: "user-2" },
    });
    const res = makeRes();

    await get_public_profile(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: "Profile not found" });
  });

  it("returns 200 for private profile when accessed by admin", async () => {
    const profileDoc = {
      _id: "p2",
      userId: "user-2",
      displayName: "Bob",
      bio: "Private",
      avatarUrl: null,
      preferences: { theme: "system", emailNotifications: false, publicProfile: false },
      stats: { assignmentsCompleted: 7, totalExecutions: 21, lastActiveAt: null },
      createdAt: new Date("2026-03-01T00:00:00Z"),
      updatedAt: new Date("2026-09-05T00:00:00Z"),
    };
    const lean = vi.fn().mockResolvedValue(profileDoc);
    mockUserProfile.findOne.mockReturnValue({ lean } as any);

    const req = makeReq({
      user: { id: "admin-1", email: "admin@x.com", role: "admin" },
      params: { id: "user-2" },
    });
    const res = makeRes();

    await get_public_profile(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = (res.json as any).mock.calls[0][0];
    expect(body.profile.displayName).toBe("Bob");
    expect(body.profile.preferences).toBeDefined();
  });

  it("returns 404 when profile not found", async () => {
    const lean = vi.fn().mockResolvedValue(null);
    mockUserProfile.findOne.mockReturnValue({ lean } as any);

    const req = makeReq({ params: { id: "user-nonexistent" } });
    const res = makeRes();

    await get_public_profile(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});
