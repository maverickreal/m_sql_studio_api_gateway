import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockError } = vi.hoisted(() => ({
  mockError: {
    error: vi.fn(),
  },
}));

vi.mock("../config", () => ({
  logger: mockError,
}));

import errorHandler from "../middleware/error_handler";

describe("errorHandler middleware", () => {
  let req: any;
  let res: any;
  let next: any;

  beforeEach(() => {
    req = {};
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    next = vi.fn();
  });

  it("logs the error and returns 500", () => {
    const err = new Error("Test error");

    errorHandler(err, req, res, next);

    expect(mockError.error).toHaveBeenCalledWith(
      { error: err },
      "Unhandled error!",
    );
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: "Internal Server Error",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("does not call next", () => {
    const err = new Error("Test error");

    errorHandler(err, req, res, next);

    expect(next).not.toHaveBeenCalled();
  });
});