import { Request, Response } from "express";
import { TaskQueueClient, SseSubscriber } from "../../services";
import { maybeAttachOwnerHint } from "../../services/ai_hint";
import { logger } from "../../config";

const SSE_HEARTBEAT_MS = 25000;
const TERMINAL_STATUSES = new Set(["completed", "failed"]);

const isOwnerOrAdmin = (
  ownerUserId: string | undefined,
  requester: { id: string; role?: string | null } | null,
): boolean => {
  if (!ownerUserId) return true;
  if (requester?.role === "admin") return true;
  return ownerUserId === requester?.id;
};

const stream_job_status = async (
  req: Request<{ taskId: string }>,
  res: Response,
) => {
  const { taskId } = req.params;

  if (!/^\d+$/.test(taskId)) {
    res.status(400).json({ error: "Invalid taskId provided!" });
    return;
  }

  const jobStatus = await TaskQueueClient.getStatus(taskId);

  if (!jobStatus) {
    res.status(404).json({ error: "Couldn't find the task!" });
    return;
  }

  const requester = req.user;
  if (!isOwnerOrAdmin(jobStatus.ownerUserId, requester)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  // Authz snapshot at connect. ownerUserId is immutable for the job's
  // lifetime, so the per-event re-check below is a pure in-memory compare
  // (src/services/job_queue/index.ts:126 — owner read once from job data).
  // No queue/Mongo round-trip per event.
  const ownerUserId = jobStatus.ownerUserId;
  const requesterSnapshot = requester
    ? { id: requester.id, role: requester.role ?? undefined }
    : null;

  const channel = `job:${taskId}`;

  try {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders?.();

    const heartbeat = setInterval(() => {
      try {
        res.write(":keepalive\n\n");
      } catch (err) {
        logger.error({ err, taskId }, "Failed to write SSE heartbeat!");
      }
    }, SSE_HEARTBEAT_MS);

    // keep-alive handle must not hold the process open
    (heartbeat as unknown as { unref?: () => void }).unref?.();

    let tornDown = false;
    let unsubscribe: (() => Promise<void>) | null = null;

    const teardown = async () => {
      if (tornDown) return;
      tornDown = true;
      clearInterval(heartbeat);
      if (unsubscribe) {
        try {
          await unsubscribe();
        } catch (err) {
          logger.error({ err, taskId }, "Failed to unsubscribe SSE channel!");
        }
      }
    };

    req.on("close", () => {
      void teardown();
    });

    unsubscribe = await SseSubscriber.subscribe(channel, async (message: string) => {
      if (tornDown) return;
      // Cheap re-check: snapshot compare, zero I/O.
      if (!isOwnerOrAdmin(ownerUserId, requesterSnapshot)) {
        await teardown();
        try {
          res.end();
        } catch {
          // client already gone
        }
        return;
      }

      let payload: { status: string; result?: unknown };
      try {
        payload = JSON.parse(message) as { status: string; result?: unknown };
      } catch (err) {
        logger.error({ err, taskId }, "Dropping malformed SSE job message!");
        return;
      }

      payload = await maybeAttachOwnerHint(payload, {
        taskId,
        ownerUserId,
        requesterId: requesterSnapshot?.id,
      });

      try {
        res.write(`event: job-status\ndata: ${JSON.stringify(payload)}\n\n`);
      } catch (err) {
        logger.error({ err, taskId }, "Failed to write SSE event!");
        await teardown();
        return;
      }

      if (TERMINAL_STATUSES.has(payload.status)) {
        await teardown();
        res.end();
      }
    });

    // Client disconnected while the shared subscription was being attached.
    if (tornDown && unsubscribe) {
      await unsubscribe();
    }
  } catch (err) {
    logger.error({ err, taskId }, "Failed to establish SSE job stream!");
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to stream job status!" });
    } else {
      res.end();
    }
  }
};

export default stream_job_status;
