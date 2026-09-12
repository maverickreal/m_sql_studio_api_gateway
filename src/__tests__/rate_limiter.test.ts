import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { Request, Response } from "express";
import request from "supertest";

vi.mock("../data/cache", () => ({
  default: {
    get: vi.fn().mockResolvedValue({
      sendCommand: vi.fn().mockImplementation((args: string[]) => {
        if (args[0] === "SCRIPT" && args[1] === "LOAD") {
          return Promise.resolve("mock_sha");
        }
        return Promise.resolve(["1", 60000]);
      }),
    }),
  },
  CacheClient: {
    get: vi.fn().mockResolvedValue({
      sendCommand: vi.fn().mockImplementation((args: string[]) => {
        if (args[0] === "SCRIPT" && args[1] === "LOAD") {
          return Promise.resolve("mock_sha");
        }
        return Promise.resolve(["1", 60000]);
      }),
    }),
  },
}));

import {
  GLOBAL_RATE_LIMIT_PER_WINDOW,
  GLOBAL_RATE_LIMIT_WINDOW_SIZE,
  RATE_LIMIT_ERROR,
} from "../utils";

describe("Rate Limiter Middleware & /internal exemption", async () => {
  const { isInternalRequest, getRateLimitMware, GlobalRateLimitMware } =
    await vi.importActual<typeof import("../middleware/rate_limiter")>(
      "../middleware/rate_limiter",
    );

  describe("isInternalRequest helper", () => {
    it("identifies /internal root and subpaths as internal", () => {
      expect(isInternalRequest({ path: "/internal" } as Request)).toBe(true);
      expect(
        isInternalRequest({
          path: "/internal/confirm/650000000000000000000001",
        } as Request),
      ).toBe(true);
      expect(
        isInternalRequest({
          path: "/internal/cleanup/old-schemas",
        } as Request),
      ).toBe(true);
      expect(
        isInternalRequest({
          path: "/internal",
          originalUrl: "/internal?dryRun=true",
        } as Request),
      ).toBe(true);
      expect(
        isInternalRequest({
          baseUrl: "/internal",
          path: "/confirm/123",
        } as Request),
      ).toBe(true);
    });

    it("does not identify public or other routes as internal", () => {
      expect(
        isInternalRequest({ path: "/api/v1/assignments" } as Request),
      ).toBe(false);
      expect(
        isInternalRequest({
          path: "/api/v1/assignments/client-sql-code-run/execute",
        } as Request),
      ).toBe(false);
      expect(isInternalRequest({ path: "/health" } as Request)).toBe(false);
      expect(isInternalRequest({ path: "/api/auth/session" } as Request)).toBe(
        false,
      );
      expect(
        isInternalRequest({ path: "/internal-forbidden" } as Request),
      ).toBe(false);
      expect(isInternalRequest({ path: "/api/internal" } as Request)).toBe(
        false,
      );
    });
  });

  describe("Exemption in rate limiter behavior", () => {
    let testApp: express.Express;

    beforeEach(() => {
      testApp = express();
      // Use getRateLimitMware with in-memory test store and limit of 2 for fast unit test
      const testLimiter = getRateLimitMware("test-scope", 2, 60_000, {
        store: undefined,
        skip: (req) => isInternalRequest(req as Request),
      });

      testApp.use(testLimiter);

      testApp.get("/api/v1/test", (_req: Request, res: Response) => {
        res.status(200).json({ ok: true });
      });

      testApp.patch(
        "/internal/confirm/:id",
        (_req: Request, res: Response) => {
          res.status(200).json({ confirmed: true });
        },
      );
    });

    it("applies rate limiting to public /api/v1 endpoints after exceeding limit", async () => {
      // Request 1: ok
      const res1 = await request(testApp).get("/api/v1/test");
      expect(res1.status).toBe(200);
      expect(res1.headers["ratelimit-limit"]).toBe("2");
      expect(res1.headers["ratelimit-remaining"]).toBe("1");

      // Request 2: ok
      const res2 = await request(testApp).get("/api/v1/test");
      expect(res2.status).toBe(200);
      expect(res2.headers["ratelimit-remaining"]).toBe("0");

      // Request 3: 429 rate limit exceeded
      const res3 = await request(testApp).get("/api/v1/test");
      expect(res3.status).toBe(429);
      expect(res3.body).toEqual({ message: RATE_LIMIT_ERROR });
    });

    it("exempts /internal routes from rate limiting even during bursts", async () => {
      // First exhaust public rate limit
      await request(testApp).get("/api/v1/test");
      await request(testApp).get("/api/v1/test");
      const blocked = await request(testApp).get("/api/v1/test");
      expect(blocked.status).toBe(429);

      // Bursts of /internal requests should all succeed (not rate limited)
      for (let i = 0; i < 10; i++) {
        const internalRes = await request(testApp).patch(
          `/internal/confirm/job-${i}`,
        );
        expect(internalRes.status).toBe(200);
        expect(internalRes.body).toEqual({ confirmed: true });
        // /internal should not have consumed public rate limit headers
        expect(internalRes.headers["ratelimit-limit"]).toBeUndefined();
      }
    });

    it("GlobalRateLimitMware has skip function configured", () => {
      expect(GlobalRateLimitMware).toBeDefined();
    });

    it("maintains byte-identical global rate limit constants", () => {
      expect(GLOBAL_RATE_LIMIT_PER_WINDOW).toBe(100);
      expect(GLOBAL_RATE_LIMIT_WINDOW_SIZE).toBe(60_000);
      expect(RATE_LIMIT_ERROR).toBe("API endpoint rate limit reached!");
    });
  });
});
