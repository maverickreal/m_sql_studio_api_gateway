import { envVars } from "../../config";
import TaskQueueClient from "../job_queue";
import { createHintStack } from "./create";
import type { HintRouter } from "./hint-router";
import type { HintPrompt } from "./types";

let stack: HintRouter | null | undefined;

export function getHintStack(): HintRouter | null {
  if (stack !== undefined) {
    return stack;
  }
  if (envVars.HINT_ENABLED !== "true") {
    stack = null;
    return null;
  }
  stack = createHintStack({
    enabled: true,
    ollamaHost: envVars.HINT_API_URL,
    ollamaModel: envVars.HINT_MODEL,
    ollamaApiKey: envVars.HINT_API_KEY,
    geminiHost:
      envVars.HINT_ALLOW_REMOTE === "true"
        ? envVars.HINT_REMOTE_API_URL
        : undefined,
    geminiApiKey:
      envVars.HINT_ALLOW_REMOTE === "true"
        ? envVars.HINT_REMOTE_API_KEY
        : undefined,
    geminiModel: envVars.HINT_REMOTE_MODEL,
    auditLogPath: envVars.HINT_AUDIT_PATH,
    say: envVars.HINT_SAY === "true",
  });
  return stack;
}

export function setHintStackForTests(next: HintRouter | null | undefined): void {
  stack = next;
}

interface AttachArgs {
  taskId: string;
  ownerUserId?: string;
  requesterId?: string;
}

function failureReasonFromResult(result: unknown): string | null {
  if (!result || typeof result !== "object") {
    return null;
  }
  const rec = result as Record<string, unknown>;
  if (rec.passed === true) {
    return null;
  }
  if (rec.passed === false) {
    return typeof rec.error === "string" && rec.error.trim()
      ? rec.error
      : "assignment failed";
  }
  if (rec.success === false && typeof rec.error === "string") {
    return rec.error;
  }
  return null;
}

export async function maybeAttachOwnerHint<T extends { result?: unknown }>(
  body: T,
  args: AttachArgs,
): Promise<T> {
  try {
    if (!args.ownerUserId || args.ownerUserId !== args.requesterId) {
      return body;
    }

    const failureReason = failureReasonFromResult(body.result);
    if (!failureReason) {
      return body;
    }

    const router = getHintStack();
    if (!router) {
      return body;
    }

    const job = await TaskQueueClient.getJob(args.taskId);
    const data = (job?.data ?? {}) as {
      userSql?: string;
      assignmentSchema?: string;
    };

    const prompt: HintPrompt = {
      taskId: args.taskId,
      userQuery: data.userSql ?? "",
      schemaContext: data.assignmentSchema ?? "private_user_assignment",
      failureReason,
      attemptNumber: 1,
    };

    const hint = await router.getHint(prompt);
    if (!hint?.text) {
      return body;
    }

    if (!body.result || typeof body.result !== "object") {
      return { ...body, result: { hint: hint.text } };
    }

    return {
      ...body,
      result: { ...(body.result as Record<string, unknown>), hint: hint.text },
    };
  } catch {
    return body;
  }
}
