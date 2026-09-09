import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockRunHealthCheck } = vi.hoisted(() => ({
  mockRunHealthCheck: vi.fn(),
}));

vi.mock("../services", () => ({
  runSystemHealthCheck: mockRunHealthCheck,
}));

import { system_health_check } from "../controllers/misc";

describe("system_health_check controller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 when all checks pass", async () => {
    mockRunHealthCheck.mockResolvedValue({
      status: "ok",
      checks: {
        redis: "ok",
        mongodb: "ok",
      },
    });

    const req = {} as any;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as any;

    await system_health_check(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      status: "ok",
      checks: {
        redis: "ok",
        mongodb: "ok",
      },
    });
  });

  it("returns 503 when system health is degraded", async () => {
    mockRunHealthCheck.mockResolvedValue({
      status: "degraded",
      checks: {
        redis: "degraded",
        mongodb: "ok",
      },
    });

    const req = {} as any;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as any;

    await system_health_check(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      status: "degraded",
      checks: {
        redis: "degraded",
        mongodb: "ok",
      },
    });
  });

  it("returns 200 when status is ok", async () => {
    mockRunHealthCheck.mockResolvedValue({
      status: "ok",
      checks: {
        redis: "ok",
        mongodb: "ok",
        queue: "degraded",
      },
    });

    const req = {} as any;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as any;

    await system_health_check(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
  });
});
