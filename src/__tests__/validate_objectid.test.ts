import { describe, it, expect, vi, beforeEach } from "vitest";
import { Request, Response, NextFunction } from "express";
import { Types } from "mongoose";
import reqParamObjIdValidMwareProvider from "../middleware/validate_objectid";

describe("validate_objectid middleware", () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: NextFunction;

  beforeEach(() => {
    req = {
      params: {},
    };
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    next = vi.fn();
  });

  it("calls next() for valid ObjectId", () => {
    req.params = { assignmentId: "650000000000000000000001" };
    const middleware = reqParamObjIdValidMwareProvider("assignmentId");

    middleware(req as Request, res as Response, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid ObjectId", () => {
    req.params = { assignmentId: "invalid-id" };
    const middleware = reqParamObjIdValidMwareProvider("assignmentId");

    middleware(req as Request, res as Response, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: "The provided assignmentId is invalid!",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 400 for empty string", () => {
    req.params = { assignmentId: "" };
    const middleware = reqParamObjIdValidMwareProvider("assignmentId");

    middleware(req as Request, res as Response, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 400 for special characters", () => {
    req.params = { assignmentId: "!@#$%" };
    const middleware = reqParamObjIdValidMwareProvider("assignmentId");

    middleware(req as Request, res as Response, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });
});