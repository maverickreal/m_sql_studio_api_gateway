import { envVars } from "../../config";
import TaskQueueClient from "../job_queue";
import { generateHintText } from "./index";

export interface AttachArgs {
  taskId: string;
  ownerUserId?: string;
  requesterId?: string;
}

export function failureReasonFromResult(result: unknown): string | null {
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

    if (envVars.HINT_ENABLED !== "true") {
      return body;
    }

    const job = await TaskQueueClient.getJob(args.taskId);
    const data = (job?.data ?? {}) as {
      userSql?: string;
      assignmentSchema?: string;
    };

    const hintText = await generateHintText({
      schemaExcerpt: data.assignmentSchema ?? "private_user_assignment",
      assignmentDescription: "SQL query debugging and assistance",
      failedSql: data.userSql ?? "",
      error: failureReason,
      taskId: args.taskId,
      userId: args.ownerUserId,
    });

    if (!hintText) {
      return body;
    }

    if (!body.result || typeof body.result !== "object") {
      return { ...body, result: { hint: hintText } };
    }

    return {
      ...body,
      result: { ...(body.result as Record<string, unknown>), hint: hintText },
    };
  } catch {
    return body;
  }
}
