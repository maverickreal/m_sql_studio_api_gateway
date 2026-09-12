import { vi } from "vitest";

// Pass-through rate limiters in test environment
vi.mock("./src/middleware/rate_limiter", () => ({
  GlobalRateLimitMware: (_req: unknown, _res: unknown, next: () => void) => next(),
  ExecuteRateLimitMware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const mockRedisClient = {
  sendCommand: vi.fn().mockResolvedValue(["1", 60000]),
  set: vi.fn().mockResolvedValue("OK"),
  ping: vi.fn().mockResolvedValue("PONG"),
  quit: vi.fn().mockResolvedValue("OK"),
};

vi.mock("./src/data/cache", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    default: {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(mockRedisClient),
    },
    CacheClient: {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(mockRedisClient),
    },
  };
});
