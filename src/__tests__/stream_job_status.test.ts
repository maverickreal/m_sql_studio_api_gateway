import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const { mockGetSession, mockGetStatus, mockSubscribe } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockGetStatus: vi.fn(),
  mockSubscribe: vi.fn(),
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
    TaskQueueClient: {
      ...actual.TaskQueueClient,
      getStatus: mockGetStatus,
    },
    SseSubscriber: {
      ...actual.SseSubscriber,
      subscribe: mockSubscribe,
    },
  };
});

import app from "../app";

describe("GET /api/v1/assignments/client-sql-code-run/status/:taskId/stream (SSE)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 without session", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await request(app).get(
      "/api/v1/assignments/client-sql-code-run/status/12345/stream",
    );

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Authentication required" });
  });

  it("returns 400 for non-numeric taskId when authenticated", async () => {
    mockGetSession.mockResolvedValue({
      user: { id: "user-1", role: "user" },
      session: { id: "sess-1" },
    });

    const res = await request(app).get(
      "/api/v1/assignments/client-sql-code-run/status/invalid-id/stream",
    );

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid taskId provided!" });
  });

  it("returns 404 when task is not found when authenticated", async () => {
    mockGetSession.mockResolvedValue({
      user: { id: "user-1", role: "user" },
      session: { id: "sess-1" },
    });
    mockGetStatus.mockResolvedValue(null);

    const res = await request(app).get(
      "/api/v1/assignments/client-sql-code-run/status/12345/stream",
    );

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Couldn't find the task!" });
  });

  it("returns 403 when user is not owner nor admin when authenticated", async () => {
    mockGetSession.mockResolvedValue({
      user: { id: "user-1", role: "user" },
      session: { id: "sess-1" },
    });
    mockGetStatus.mockResolvedValue({
      ownerUserId: "user-2",
      status: "active",
    });

    const res = await request(app).get(
      "/api/v1/assignments/client-sql-code-run/status/12345/stream",
    );

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Forbidden" });
  });
});