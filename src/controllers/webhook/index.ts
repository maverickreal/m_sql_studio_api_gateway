import { createHmac, timingSafeEqual } from "crypto";
import { Request, Response } from "express";
import { envVars, logger } from "../../config";
import { CacheClient } from "../../data";
import TaskQueueClient from "../../services/job_queue";
import {
  GITHUB_DELIVERY_KEY_PREFIX,
  GITHUB_DELIVERY_TTL_S,
  DEV_WEBHOOK_SECRET,
  ENV_MODE,
} from "../../utils";

type RawBodyRequest = Request & { rawBody?: Buffer };

const resolveSecret = (): string | undefined =>
  envVars.GITHUB_WEBHOOK_SECRET ??
  (envVars.ENV_MODE === ENV_MODE.DEV ? DEV_WEBHOOK_SECRET : undefined);

const rawBodyOf = (req: RawBodyRequest): Buffer => {
  if (req.rawBody) return req.rawBody;
  return Buffer.from(JSON.stringify(req.body ?? {}));
};

const signatureValid = (raw: Buffer, secret: string, provided: string): boolean => {
  const expected = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

// POST /api/webhooks/github — no session auth; HMAC is the auth.
const github_webhook = async (req: Request, res: Response) => {
  const secret = resolveSecret();
  if (!secret) {
    logger.error("GitHub webhook called without a configured secret");
    res.status(500).json({ error: "Webhook not configured" });
    return;
  }

  const provided = req.headers["x-hub-signature-256"];
  const raw = rawBodyOf(req as RawBodyRequest);
  if (typeof provided !== "string" || !signatureValid(raw, secret, provided)) {
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  if (req.headers["x-github-event"] !== "push") {
    res.status(204).end();
    return;
  }

  const deliveryId = req.headers["x-github-delivery"];
  const delivery = typeof deliveryId === "string" ? deliveryId : undefined;

  if (delivery) {
    try {
      const cache = (await CacheClient.get())!;
      const setResult = await (cache as unknown as {
        set: (
          key: string,
          value: string,
          opts: { EX: number; NX: boolean },
        ) => Promise<string | null>;
      }).set(GITHUB_DELIVERY_KEY_PREFIX + delivery, "1", {
        EX: GITHUB_DELIVERY_TTL_S,
        NX: true,
      });
      if (setResult === null) {
        res.status(202).json({ deduped: true });
        return;
      }
    } catch (err) {
      logger.warn({ err }, "Delivery dedup unavailable; proceeding");
    }
  }

  const body = (req.body ?? {}) as {
    ref?: string;
    before?: string;
    after?: string;
    commits?: Array<{ added?: string[]; modified?: string[]; removed?: string[] }>;
  };

  try {
    const jobId = await TaskQueueClient.enqueueProblemsSyncJob({
      deliveryId: delivery ?? `${Date.now()}`,
      ref: body.ref,
      afterSha: body.after,
      beforeSha: body.before,
      forced: false,
      commits: body.commits ?? [],
    });
    res.status(202).json({ jobId });
  } catch (err) {
    logger.error({ err }, "Failed to enqueue problems sync job");
    res.status(500).json({ error: "Failed to enqueue sync job" });
  }
};

export { github_webhook };
