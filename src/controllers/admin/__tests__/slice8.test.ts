import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../config", () => ({
  envVars: {},
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const collectionMock = {
  findOne: vi.fn(),
  countDocuments: vi.fn(),
};

vi.mock("../../../data/db/client", () => ({
  sharedMongoClient: { db: vi.fn(() => ({ collection: () => collectionMock })) },
  default: { connect: vi.fn(), disconnect: vi.fn() },
}));

vi.mock("../../../data/db/models/assignment", () => ({
  Assignment: { create: vi.fn(), find: vi.fn(), findByIdAndDelete: vi.fn() },
  AssignmentValidatorSchema: {},
}));

vi.mock("../../../data/db/models/assignment_solution", () => ({
  AssignmentSolution: { create: vi.fn(), deleteOne: vi.fn() },
  AssignmentSolutionValidatorSchema: {},
}));

vi.mock("../../../data/db/models/audit_log", () => ({
  AuditLog: { create: vi.fn(), find: vi.fn() },
}));

vi.mock("../../../services/job_queue", () => ({
  default: { enqueueAdminAssignmentSeedJob: vi.fn(), getStatus: vi.fn() },
}));

vi.mock("../../../auth", () => ({
  auth: { api: { listUsers: vi.fn(), setRole: vi.fn() } },
  seedAdminUser: vi.fn(),
}));

import {
  list_assignments,
  list_audit,
  list_users,
  set_user_role,
} from "../index";
import { AuditLog } from "../../../data/db/models/audit_log";
import { auth } from "../../../auth";

const mockRes = () => {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  return { status, json };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("slice8 admin lists", () => {
  it("list_assignments returns 200 with items array", async () => {
    const { status, json } = mockRes() as any;
    await list_assignments({} as any, { status, json } as any);
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ items: expect.any(Array) }),
    );
  });

  it("list_audit clamps huge limit and returns items", async () => {
    vi.mocked(AuditLog.find as any).mockReturnValue({
      sort: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          lean: vi.fn().mockResolvedValue([]),
        }),
      }),
    });
    const { status, json } = mockRes() as any;
    await list_audit({ query: { limit: "9999" } } as any, { status, json } as any);
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ items: expect.any(Array) }),
    );
  });

  it("list_users maps better-auth users to items", async () => {
    vi.mocked(auth.api.listUsers as any).mockResolvedValue({
      users: [{ id: "u1", email: "a@b.c", name: "A", role: "user" }],
      total: 1,
    });
    const { status, json } = mockRes() as any;
    await list_users({ headers: {} } as any, { status, json } as any);
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({
      items: [{ id: "u1", email: "a@b.c", name: "A", role: "user" }],
    });
  });
});

describe("slice8 set_user_role", () => {
  it("returns 400 for invalid role", async () => {
    const { status } = mockRes() as any;
    const json = vi.fn();
    await set_user_role(
      { params: { id: "u1" }, body: { role: "superadmin" } } as any,
      { status, json } as any,
    );
    expect(status).toHaveBeenCalledWith(400);
  });

  it("returns 409 when demoting the last admin and writes no audit", async () => {
    collectionMock.findOne.mockResolvedValue({ id: "u1", role: "admin" });
    collectionMock.countDocuments.mockResolvedValue(1);
    const { status, json } = mockRes() as any;
    await set_user_role(
      { params: { id: "u1" }, body: { role: "user" }, user: { id: "u1" }, headers: {} } as any,
      { status, json } as any,
    );
    expect(status).toHaveBeenCalledWith(409);
    expect(AuditLog.create).not.toHaveBeenCalled();
  });

  it("promotes user, calls setRole, writes role.change audit", async () => {
    collectionMock.findOne.mockResolvedValue({ id: "u2", role: "user" });
    vi.mocked(auth.api.setRole as any).mockResolvedValue({
      user: { id: "u2", role: "admin" },
    });
    const { status, json } = mockRes() as any;
    await set_user_role(
      { params: { id: "u2" }, body: { role: "admin" }, user: { id: "u1" }, headers: {} } as any,
      { status, json } as any,
    );
    expect(status).toHaveBeenCalledWith(200);
    expect(auth.api.setRole).toHaveBeenCalled();
    expect(AuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ action: "role.change", targetId: "u2" }),
    );
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ user: expect.anything() }),
    );
  });

  it("returns 404 for unknown user", async () => {
    collectionMock.findOne.mockResolvedValue(null);
    const { status, json } = mockRes() as any;
    await set_user_role(
      { params: { id: "nope" }, body: { role: "admin" }, user: { id: "u1" }, headers: {} } as any,
      { status, json } as any,
    );
    expect(status).toHaveBeenCalledWith(404);
  });
});
