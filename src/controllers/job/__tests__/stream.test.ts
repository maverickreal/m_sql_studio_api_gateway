import { describe, it, expect, vi, beforeEach } from "vitest";
import { Request, Response } from "express";
import stream_job_status from "../stream";

vi.mock("../../../services/job_queue", () => ({
  default: {
    getStatus: vi.fn(),
  },
}));

vi.mock("../../../data", () => ({
  CacheClient: {
    get: vi.fn(),
  },
}));

vi.mock("../../../config", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

// NOTE: real SseSubscriber (not mocked) — these tests prove multiplexing.
import TaskQueueClient from "../../../services/job_queue";
import { CacheClient } from "../../../data";
import { SseSubscriber } from "../../../services";

type RedisListener = (message: string, channel: string) => void;

function mockReqRes(taskId: string, user: unknown) {
  const writes: string[] = [];
  const handlers: Record<string, (...args: never[]) => void> = {};
  const req = {
    params: { taskId },
    user,
    on: vi.fn((ev: string, cb: (...args: never[]) => void) => {
      handlers[ev] = cb;
    }),
  } as unknown as Request<{ taskId: string }>;
  const res = {
    writes,
    writeHead: vi.fn(),
    setHeader: vi.fn(),
    flushHeaders: vi.fn(),
    write: vi.fn((chunk: string) => {
      writes.push(chunk);
      return true;
    }),
    end: vi.fn(),
  } as unknown as Response & { writes: string[] };
  return { req, res, handlers };
}

describe("stream_job_status (SSE)", () => {
  let listeners: Map<string, RedisListener>;
  let fakeClient: {
    connect: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
    unsubscribe: ReturnType<typeof vi.fn>;
    quit: ReturnType<typeof vi.fn>;
  };
  const duplicate = vi.fn();

  const publish = async (channel: string, payload: unknown) => {
    const cb = listeners.get(channel);
    expect(cb).not.toBeUndefined();
    cb!(JSON.stringify(payload), channel);
    await new Promise((resolve) => setTimeout(resolve, 10));
  };

  beforeEach(() => {
    vi.clearAllMocks();
    listeners = new Map();
    fakeClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn((ch: string, cb: RedisListener) => {
        listeners.set(ch, cb);
        return Promise.resolve(undefined);
      }),
      unsubscribe: vi.fn((ch: string) => {
        listeners.delete(ch);
        return Promise.resolve(undefined);
      }),
      quit: vi.fn().mockResolvedValue(undefined),
    };
    duplicate.mockImplementation(() => fakeClient);
    vi.mocked(CacheClient.get).mockResolvedValue({
      duplicate,
    } as never);
    SseSubscriber._resetForTests();
  });

  it("returns 400 for non-numeric taskId without opening a stream", async () => {
    const { req, res } = mockReqRes("abc", { id: "u1", role: "user" });
    const statusMock = vi.fn().mockReturnValue({ json: vi.fn() });
    (res as unknown as Record<string, unknown>).status = statusMock;

    await stream_job_status(req, res);

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(CacheClient.get).not.toHaveBeenCalled();
  });

  it("returns 404 when job does not exist", async () => {
    vi.mocked(TaskQueueClient.getStatus).mockResolvedValue(null);
    const { req, res } = mockReqRes("123", { id: "u1", role: "user" });
    const jsonMock = vi.fn();
    const statusMock = vi.fn().mockReturnValue({ json: jsonMock });
    (res as unknown as Record<string, unknown>).status = statusMock;

    await stream_job_status(req, res);

    expect(statusMock).toHaveBeenCalledWith(404);
  });

  it("returns 403 when non-owner non-admin connects", async () => {
    vi.mocked(TaskQueueClient.getStatus).mockResolvedValue({
      status: "active",
      ownerUserId: "owner-1",
    });
    const { req, res } = mockReqRes("123", { id: "intruder", role: "user" });
    const jsonMock = vi.fn();
    const statusMock = vi.fn().mockReturnValue({ json: jsonMock });
    (res as unknown as Record<string, unknown>).status = statusMock;

    await stream_job_status(req, res);

    expect(statusMock).toHaveBeenCalledWith(403);
  });

  it("opens SSE stream for owner, writes job-status event, then ends", async () => {
    vi.mocked(TaskQueueClient.getStatus).mockResolvedValue({
      status: "active",
      ownerUserId: "u1",
    });
    const { req, res } = mockReqRes("42", { id: "u1", role: "user" });

    await stream_job_status(req, res);

    expect(res.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({ "Content-Type": "text/event-stream" }),
    );
    expect(listeners.get("job:42")).not.toBeUndefined();

    await publish("job:42", { status: "completed", result: { success: true } });

    const body = (res as unknown as { writes: string[] }).writes.join("");
    expect(body).toContain("event: job-status");
    expect(body).toContain('"status":"completed"');
    expect(res.end).toHaveBeenCalled();
  });

  it("allows admin to stream another user's job", async () => {
    vi.mocked(TaskQueueClient.getStatus).mockResolvedValue({
      status: "active",
      ownerUserId: "someone-else",
    });
    const { req, res } = mockReqRes("7", { id: "admin-1", role: "admin" });

    await stream_job_status(req, res);

    expect(res.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({ "Content-Type": "text/event-stream" }),
    );
  });

  it("does not re-fetch job status on every event (no N+1)", async () => {
    vi.mocked(TaskQueueClient.getStatus).mockResolvedValue({
      status: "active",
      ownerUserId: "u1",
    });
    const { req, res } = mockReqRes("42", { id: "u1", role: "user" });

    await stream_job_status(req, res);
    expect(vi.mocked(TaskQueueClient.getStatus)).toHaveBeenCalledTimes(1);

    await publish("job:42", { status: "active", result: null });
    await publish("job:42", { status: "active", result: null });

    // Authz on connect + cheap in-memory re-check: zero extra round-trips.
    expect(vi.mocked(TaskQueueClient.getStatus)).toHaveBeenCalledTimes(1);
    const body = (res as unknown as { writes: string[] }).writes.join("");
    expect(body).toContain("event: job-status");
    expect(res.end).not.toHaveBeenCalled();
  });

  it("shares one Redis connection across EventSources; disconnect returns to baseline", async () => {
    vi.mocked(TaskQueueClient.getStatus).mockResolvedValue({
      status: "active",
      ownerUserId: "u1",
    });
    const a = mockReqRes("42", { id: "u1", role: "user" });
    const b = mockReqRes("42", { id: "u1", role: "user" });

    await stream_job_status(a.req, a.res);
    await stream_job_status(b.req, b.res);

    // One duplicated connection total, one Redis SUBSCRIBE (ref-counted).
    expect(duplicate).toHaveBeenCalledTimes(1);
    expect(fakeClient.subscribe).toHaveBeenCalledTimes(1);
    expect(SseSubscriber.handlerCount("job:42")).toBe(2);

    // First disconnect: handler removed, Redis subscription retained.
    await a.handlers["close"]();
    expect(SseSubscriber.handlerCount("job:42")).toBe(1);
    expect(fakeClient.unsubscribe).not.toHaveBeenCalled();
    expect(fakeClient.quit).not.toHaveBeenCalled();

    // Last disconnect: Redis UNSUBSCRIBE fires, shared client stays open.
    await b.handlers["close"]();
    expect(SseSubscriber.handlerCount("job:42")).toBe(0);
    expect(fakeClient.unsubscribe).toHaveBeenCalledTimes(1);
    expect(fakeClient.unsubscribe).toHaveBeenCalledWith("job:42");
    expect(fakeClient.quit).not.toHaveBeenCalled();

    // Baseline restored: no listeners, no extra connections.
    expect(listeners.size).toBe(0);
    expect(duplicate).toHaveBeenCalledTimes(1);
  });

  it("terminal event unsubscribes only its own handler", async () => {
    vi.mocked(TaskQueueClient.getStatus).mockResolvedValue({
      status: "active",
      ownerUserId: "u1",
    });
    const a = mockReqRes("42", { id: "u1", role: "user" });
    const b = mockReqRes("42", { id: "u1", role: "user" });

    await stream_job_status(a.req, a.res);
    await stream_job_status(b.req, b.res);

    await publish("job:42", { status: "completed", result: { ok: true } });

    expect(a.res.end).toHaveBeenCalled();
    expect(b.res.end).toHaveBeenCalled();
    expect(SseSubscriber.handlerCount("job:42")).toBe(0);
    expect(fakeClient.unsubscribe).toHaveBeenCalledWith("job:42");
  });
});
