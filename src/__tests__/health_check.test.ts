import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockCacheGet,
  mockCachePing,
  mockQueuePing,
  mockGetWorkersCount,
  mockPgConnect,
  mockPgQuery,
  mockPgEnd,
  mockMongoPing,
  mongooseState,
} = vi.hoisted(() => ({
  mockCacheGet: vi.fn(),
  mockCachePing: vi.fn(),
  mockQueuePing: vi.fn(),
  mockGetWorkersCount: vi.fn(),
  mockPgConnect: vi.fn(),
  mockPgQuery: vi.fn(),
  mockPgEnd: vi.fn(),
  mockMongoPing: vi.fn(),
  mongooseState: { readyState: 1 },
}));

vi.mock("mongoose", () => ({
  default: {
    connection: {
      get readyState() {
        return mongooseState.readyState;
      },
      db: {
        admin: () => ({ ping: mockMongoPing }),
      },
    },
  },
}));

vi.mock("pg", () => {
  class MockClient {
    connect = mockPgConnect;
    query = mockPgQuery;
    end = mockPgEnd;
  }
  return { Client: MockClient };
});

vi.mock("../config", () => ({
  envVars: {
    SANDBOX_PG_HOST: "localhost",
    SANDBOX_PG_PORT: 5432,
    SANDBOX_PG_USER: "user",
    SANDBOX_PG_PASSWORD: "pass",
    SANDBOX_PG_DATABASE: "db",
  },
}));

vi.mock("../data", () => ({
  CacheClient: {
    get: mockCacheGet,
  },
}));

vi.mock("../services/job_queue", () => ({
  default: {
    ping: mockQueuePing,
    getWorkersCount: mockGetWorkersCount,
  },
}));

import { runSystemHealthCheck } from "../services/health_check";

describe("runSystemHealthCheck", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mongooseState.readyState = 1;
    mockCacheGet.mockResolvedValue({ ping: mockCachePing });
    mockCachePing.mockResolvedValue("PONG");
    mockQueuePing.mockResolvedValue(undefined);
    mockGetWorkersCount.mockResolvedValue(1);
    mockPgConnect.mockResolvedValue(undefined);
    mockPgQuery.mockResolvedValue({ rows: [{ "?column?": 1 }] });
    mockPgEnd.mockResolvedValue(undefined);
    mockMongoPing.mockResolvedValue(true);
  });

  it("returns ok when every dependency check passes", async () => {
    const result = await runSystemHealthCheck();

    expect(result.status).toBe("ok");
    expect(result.checks).toEqual({
      redis: "ok",
      mongodb: "ok",
      queue: "ok",
      sandbox_service: "ok",
      sandbox_db: "ok",
    });
    expect(mockPgEnd).toHaveBeenCalled();
  });

  it("marks redis degraded when cache ping fails", async () => {
    mockCachePing.mockRejectedValue(new Error("redis down"));

    const result = await runSystemHealthCheck();

    expect(result.status).toBe("degraded");
    expect(result.checks.redis).toBe("degraded");
    expect(result.checks.mongodb).toBe("ok");
  });

  it("marks mongodb degraded when mongoose is not connected", async () => {
    mongooseState.readyState = 0;

    const result = await runSystemHealthCheck();

    expect(result.status).toBe("degraded");
    expect(result.checks.mongodb).toBe("degraded");
  });

  it("marks sandbox_service degraded when no workers are connected", async () => {
    mockGetWorkersCount.mockResolvedValue(0);

    const result = await runSystemHealthCheck();

    expect(result.status).toBe("degraded");
    expect(result.checks.sandbox_service).toBe("degraded");
  });

  it("marks sandbox_db degraded when postgres query fails and still ends the client", async () => {
    mockPgQuery.mockRejectedValue(new Error("pg down"));

    const result = await runSystemHealthCheck();

    expect(result.status).toBe("degraded");
    expect(result.checks.sandbox_db).toBe("degraded");
    expect(mockPgEnd).toHaveBeenCalled();
  });
});
