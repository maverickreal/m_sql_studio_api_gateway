import { describe, it, expect, vi, beforeEach } from "vitest";
import { Request, Response } from "express";
import { get_last_sql, save_last_sql } from "../index";

vi.mock("../../../data/db/models/user_sql_state", () => ({
  UserSqlState: {
    findOne: vi.fn(),
    findOneAndUpdate: vi.fn(),
  },
}));

vi.mock("../../../config", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

import { UserSqlState } from "../../../data/db/models/user_sql_state";

const AID = "507f1f77bcf86cd799439011";

function mockRes() {
  const jsonMock = vi.fn();
  const statusMock = vi.fn().mockReturnValue({ json: jsonMock });
  return {
    res: { status: statusMock, json: jsonMock } as unknown as Response,
    statusMock,
    jsonMock,
  };
}

describe("last-sql handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET returns stored SQL with updatedAt", async () => {
    const doc = { userSql: "SELECT 1;", updatedAt: new Date("2026-09-09T10:00:00Z") };
    vi.mocked(UserSqlState.findOne).mockReturnValue({
      lean: () => Promise.resolve(doc),
    } as never);
    const req = { params: { id: AID }, user: { id: "user-1" } } as unknown as Request;
    const { res, statusMock, jsonMock } = mockRes();

    await get_last_sql(req, res);

    expect(UserSqlState.findOne).toHaveBeenCalledWith({
      userId: "user-1",
      assignmentId: AID,
    });
    expect(statusMock).toHaveBeenCalledWith(200);
    expect(jsonMock).toHaveBeenCalledWith({
      userSql: "SELECT 1;",
      updatedAt: doc.updatedAt,
    });
  });

  it("GET returns userSql null when nothing stored", async () => {
    vi.mocked(UserSqlState.findOne).mockReturnValue({
      lean: () => Promise.resolve(null),
    } as never);
    const req = { params: { id: AID }, user: { id: "user-1" } } as unknown as Request;
    const { res, statusMock, jsonMock } = mockRes();

    await get_last_sql(req, res);

    expect(statusMock).toHaveBeenCalledWith(200);
    expect(jsonMock).toHaveBeenCalledWith({ userSql: null });
  });

  it("POST upserts and returns success", async () => {
    vi.mocked(UserSqlState.findOneAndUpdate).mockResolvedValue({} as any);
    const req = {
      params: { id: AID },
      body: { userSql: "SELECT 2;" },
      user: { id: "user-1" },
    } as unknown as Request;
    const { res, statusMock, jsonMock } = mockRes();

    await save_last_sql(req, res);

    expect(UserSqlState.findOneAndUpdate).toHaveBeenCalledWith(
      { userId: "user-1", assignmentId: AID },
      expect.objectContaining({ userSql: "SELECT 2;" }),
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    expect(statusMock).toHaveBeenCalledWith(200);
    expect(jsonMock).toHaveBeenCalledWith({ success: true });
  });

  it("POST rejects empty userSql with 400", async () => {
    const req = {
      params: { id: AID },
      body: { userSql: "" },
      user: { id: "user-1" },
    } as unknown as Request;
    const { res, statusMock } = mockRes();

    await save_last_sql(req, res);

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(UserSqlState.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("POST rejects over-long userSql with 400", async () => {
    const req = {
      params: { id: AID },
      body: { userSql: "x".repeat(5001) },
      user: { id: "user-1" },
    } as unknown as Request;
    const { res, statusMock } = mockRes();

    await save_last_sql(req, res);

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(UserSqlState.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("POST overwrites previous value (upsert same key)", async () => {
    vi.mocked(UserSqlState.findOneAndUpdate).mockResolvedValue({} as any);
    const mkReq = (sql: string) =>
      ({ params: { id: AID }, body: { userSql: sql }, user: { id: "user-1" } }) as unknown as Request;
    const r1 = mockRes();
    await save_last_sql(mkReq("SELECT 1;"), r1.res);
    const r2 = mockRes();
    await save_last_sql(mkReq("SELECT 2;"), r2.res);

    expect(vi.mocked(UserSqlState.findOneAndUpdate).mock.calls[1][0]).toEqual({
      userId: "user-1",
      assignmentId: AID,
    });
    expect(vi.mocked(UserSqlState.findOneAndUpdate).mock.calls[1][1]).toEqual(
      expect.objectContaining({ userSql: "SELECT 2;" }),
    );
    expect(r2.statusMock).toHaveBeenCalledWith(200);
  });
});
