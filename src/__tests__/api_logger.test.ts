import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("pino-http", () => ({
  default: vi.fn().mockReturnValue((req: any, res: any) => {}),
}));

import apiLogger from "../middleware/api/api_logger";

describe("apiLogger middleware", () => {
  it("returns a middleware function", () => {
    expect(typeof apiLogger).toBe("function");
  });

  it("can be used as middleware without errors", () => {
    const req = { method: "GET", url: "/test", headers: {} } as any;
    const res = { statusCode: 200, on: vi.fn() } as any;

    expect(() => apiLogger(req, res)).not.toThrow();
  });
});