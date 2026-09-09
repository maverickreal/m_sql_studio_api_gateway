import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const { mockRunHealthCheck } = vi.hoisted(() => ({
  mockRunHealthCheck: vi.fn(),
}));

vi.mock("../services", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services")>();
  return {
    ...actual,
    runSystemHealthCheck: mockRunHealthCheck,
  };
});

import app from "../app";

describe("GET /health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 OK when all checks pass", async () => {
    mockRunHealthCheck.mockResolvedValue({
      status: "ok",
      checks: {
        redis: "ok",
        mongodb: "ok",
        queue: "ok",
        sandbox_service: "ok",
        sandbox_db: "ok",
      },
    });

    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: "ok",
      checks: {
        redis: "ok",
        mongodb: "ok",
        queue: "ok",
        sandbox_service: "ok",
        sandbox_db: "ok",
      },
    });
  });

  it("returns 503 Service Unavailable when system health is degraded", async () => {
    mockRunHealthCheck.mockResolvedValue({
      status: "degraded",
      checks: {
        redis: "degraded",
        mongodb: "ok",
        queue: "ok",
        sandbox_service: "ok",
        sandbox_db: "ok",
      },
    });

    const res = await request(app).get("/health");

    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      status: "degraded",
      checks: {
        redis: "degraded",
        mongodb: "ok",
        queue: "ok",
        sandbox_service: "ok",
        sandbox_db: "ok",
      },
    });
  });
});
