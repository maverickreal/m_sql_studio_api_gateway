import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("pino-http", () => ({
  default: vi.fn(() => {
    return (req: unknown, res: unknown, next: () => void) => {
      next();
    };
  }),
}));

vi.mock("../../../../config", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

import pinoHttp from "pino-http";
import { logger } from "../../../../config";
import apiLogger from "../index";

describe("apiLogger middleware", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("should export a function as default and call pinoHttp with the logger", () => {
    expect(typeof apiLogger).toBe("function");
    expect(pinoHttp).toHaveBeenCalledWith(
      expect.objectContaining({ logger }),
    );
  });

  it("should pass through to next middleware", () => {
    const mockNext = vi.fn();

    apiLogger({}, {}, mockNext);

    expect(mockNext).toHaveBeenCalled();
  });
});
