import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";
import request from "supertest";

const { mockEnqueue, mockCacheSet } = vi.hoisted(() => ({
  mockEnqueue: vi.fn(),
  mockCacheSet: vi.fn(),
}));

vi.mock("../services/job_queue", () => ({
  default: {
    enqueueProblemsSyncJob: mockEnqueue,
  },
}));

vi.mock("../data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../data")>();
  return {
    ...actual,
    CacheClient: {
      get: vi.fn().mockResolvedValue({
        set: mockCacheSet,
      }),
    },
  };
});

import app from "../app";

const sign = (body: Buffer | string, secret = "test-webhook-secret") =>
  "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

describe("POST /api/webhooks/github (HMAC 401 & PB1 cases)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnqueue.mockResolvedValue("job-sync-100");
    mockCacheSet.mockResolvedValue("OK");
  });

  it("returns 401 when x-hub-signature-256 header is missing", async () => {
    const res = await request(app)
      .post("/api/webhooks/github")
      .set("x-github-event", "push")
      .set("x-github-delivery", "delivery-1")
      .send({ ref: "refs/heads/main" });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Invalid signature" });
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("returns 401 when HMAC signature is invalid / mismatched", async () => {
    const bodyStr = JSON.stringify({ ref: "refs/heads/main" });
    const invalidSig = sign(bodyStr, "wrong-secret");

    const res = await request(app)
      .post("/api/webhooks/github")
      .set("x-hub-signature-256", invalidSig)
      .set("x-github-event", "push")
      .set("x-github-delivery", "delivery-2")
      .set("Content-Type", "application/json")
      .send(bodyStr);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Invalid signature" });
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("returns 204 for non-push events (e.g. ping)", async () => {
    const bodyStr = JSON.stringify({ zen: "Responsive is better than fast." });
    const validSig = sign(bodyStr);

    const res = await request(app)
      .post("/api/webhooks/github")
      .set("x-hub-signature-256", validSig)
      .set("x-github-event", "ping")
      .set("x-github-delivery", "delivery-ping")
      .set("Content-Type", "application/json")
      .send(bodyStr);

    expect(res.status).toBe(204);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("returns 202 and enqueues sync job on valid signature and push event", async () => {
    const payload = {
      ref: "refs/heads/main",
      after: "abc123456789",
      commits: [
        { added: ["problems/joins/problem.yaml"], modified: [], removed: [] },
      ],
    };
    const bodyStr = JSON.stringify(payload);
    const validSig = sign(bodyStr);

    const res = await request(app)
      .post("/api/webhooks/github")
      .set("x-hub-signature-256", validSig)
      .set("x-github-event", "push")
      .set("x-github-delivery", "delivery-push-1")
      .set("Content-Type", "application/json")
      .send(bodyStr);

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ jobId: "job-sync-100" });
    expect(mockEnqueue).toHaveBeenCalledWith({
      deliveryId: "delivery-push-1",
      ref: "refs/heads/main",
      afterSha: "abc123456789",
      forced: false,
      commits: payload.commits,
    });
  });

  it("returns 202 with deduped: true when delivery ID was already processed", async () => {
    mockCacheSet.mockResolvedValue(null);

    const payload = { ref: "refs/heads/main", after: "abc123456789" };
    const bodyStr = JSON.stringify(payload);
    const validSig = sign(bodyStr);

    const res = await request(app)
      .post("/api/webhooks/github")
      .set("x-hub-signature-256", validSig)
      .set("x-github-event", "push")
      .set("x-github-delivery", "delivery-duplicate")
      .set("Content-Type", "application/json")
      .send(bodyStr);

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ deduped: true });
    expect(mockEnqueue).not.toHaveBeenCalled();
  });
});
