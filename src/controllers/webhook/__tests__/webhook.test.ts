import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";
import { Request, Response } from "express";

vi.mock("../../../config", () => ({
  envVars: {
    GITHUB_WEBHOOK_SECRET: "test-webhook-secret",
    GITHUB_PROBLEMS_REPO: "maverickreal/m_sql_studio_problems",
    ENV_MODE: "DEV",
  },
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { mockEnqueue } = vi.hoisted(() => ({
  mockEnqueue: vi.fn(),
}));

vi.mock("../../../services/job_queue", () => ({
  default: { enqueueProblemsSyncJob: mockEnqueue },
}));

const { mockCacheSet } = vi.hoisted(() => ({
  mockCacheSet: vi.fn(),
}));

vi.mock("../../../data", () => ({
  CacheClient: { get: vi.fn() },
}));

import { github_webhook } from "../index";
import TaskQueueClient from "../../../services/job_queue";
import { CacheClient } from "../../../data";

const sign = (body: Buffer, secret = "test-webhook-secret") =>
  "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

const makeRes = () => {
  const json = vi.fn();
  const end = vi.fn();
  const status = vi.fn().mockReturnValue({ json, end });
  return { status, json, end, res: { status, json } as unknown as Response };
};

const makeReq = (raw: Buffer, sig: string, event = "push", delivery = "d-1") =>
  ({
    headers: {
      "x-hub-signature-256": sig,
      "x-github-event": event,
      "x-github-delivery": delivery,
    },
    body: JSON.parse(raw.toString()),
    rawBody: raw,
  }) as unknown as Request;

describe("POST /api/webhooks/github", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnqueue.mockResolvedValue("job-1");
    mockCacheSet.mockResolvedValue("OK");
    vi.mocked(CacheClient.get).mockResolvedValue({ set: mockCacheSet } as any);
  });

  it("returns 401 on HMAC mismatch", async () => {
    const raw = Buffer.from(JSON.stringify({ ref: "refs/heads/main" }));
    const req = makeReq(raw, sign(raw, "wrong-secret"));
    const { status, json, res } = makeRes();

    await github_webhook(req, res);

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ error: "Invalid signature" });
    expect(TaskQueueClient.enqueueProblemsSyncJob).not.toHaveBeenCalled();
  });

  it("returns 401 when signature header missing", async () => {
    const raw = Buffer.from(JSON.stringify({ ref: "refs/heads/main" }));
    const req = {
      headers: { "x-github-event": "push", "x-github-delivery": "d-2" },
      body: { ref: "refs/heads/main" },
      rawBody: raw,
    } as unknown as Request;
    const { status, res } = makeRes();

    await github_webhook(req, res);

    expect(status).toHaveBeenCalledWith(401);
    expect(TaskQueueClient.enqueueProblemsSyncJob).not.toHaveBeenCalled();
  });

  it("ignores non-push events with 204", async () => {
    const raw = Buffer.from(JSON.stringify({ ref: "refs/heads/main" }));
    const req = makeReq(raw, sign(raw), "ping");
    const { status, end, res } = makeRes();

    await github_webhook(req, res);

    expect(status).toHaveBeenCalledWith(204);
    expect(end).toHaveBeenCalled();
    expect(TaskQueueClient.enqueueProblemsSyncJob).not.toHaveBeenCalled();
  });

  it("good push returns 202 and enqueues sync job", async () => {
    const raw = Buffer.from(
      JSON.stringify({
        ref: "refs/heads/main",
        after: "abc123",
        commits: [{ added: ["problems/joins/a.yaml"], modified: [], removed: [] }],
      }),
    );
    const req = makeReq(raw, sign(raw), "push", "d-100");
    const { status, json, res } = makeRes();

    await github_webhook(req, res);

    expect(status).toHaveBeenCalledWith(202);
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({ deliveryId: "d-100", afterSha: "abc123" }),
    );
    expect(json).toHaveBeenCalledWith({ jobId: "job-1" });
  });

  it("replays of same delivery id skip enqueue", async () => {
    const raw = Buffer.from(
      JSON.stringify({ ref: "refs/heads/main", after: "abc123", commits: [] }),
    );
    const first = makeReq(raw, sign(raw), "push", "d-replay");
    const { status, res } = makeRes();

    await github_webhook(first, res);
    expect(mockEnqueue).toHaveBeenCalledTimes(1);

    mockCacheSet.mockResolvedValue(null);
    const second = makeReq(raw, sign(raw), "push", "d-replay");
    const res2 = makeRes();
    await github_webhook(second, res2.res);

    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    expect(res2.status).toHaveBeenCalledWith(202);
    expect(res2.json).toHaveBeenCalledWith(
      expect.objectContaining({ deduped: true }),
    );
    expect(status).toHaveBeenCalledWith(202);
  });
});
