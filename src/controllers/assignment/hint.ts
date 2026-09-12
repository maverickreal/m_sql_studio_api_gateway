import type { Request, Response } from "express";
import { getAssignmentByIdCached } from "../../services/assignment_cache";
import { generateHintStream } from "../../services/ai_hint";
import { logger } from "../../config";

export interface HintRequestParams {
  assignmentId?: string;
  schemaExcerpt?: string;
  schemaContext?: string;
  schema?: string;
  assignmentDescription?: string;
  description?: string;
  failedSql?: string;
  userSql?: string;
  sql?: string;
  error?: string;
  failureReason?: string;
  errorMessage?: string;
}

export const generate_assignment_hint = async (
  req: Request<unknown, unknown, HintRequestParams>,
  res: Response,
) => {
  const body = req.body || {};

  const failedSql = (body.failedSql ?? body.userSql ?? body.sql ?? "").trim();
  const error = (body.error ?? body.failureReason ?? body.errorMessage ?? "").trim();

  if (!failedSql || !error) {
    res.status(400).json({ error: "failedSql and error are required fields!" });
    return;
  }

  let schemaExcerpt = (
    body.schemaExcerpt ??
    body.schemaContext ??
    body.schema ??
    ""
  ).trim();

  let assignmentDescription = (
    body.assignmentDescription ??
    body.description ??
    ""
  ).trim();

  const assignmentId = body.assignmentId?.trim();

  if (assignmentId && (!schemaExcerpt || !assignmentDescription)) {
    try {
      const assignment = await getAssignmentByIdCached(assignmentId);
      if (assignment) {
        if (!schemaExcerpt && assignment.sampleInput?.length) {
          schemaExcerpt = assignment.sampleInput.join("\n");
        }
        if (!assignmentDescription && assignment.description) {
          assignmentDescription = assignment.description;
        }
      }
    } catch (err) {
      logger.warn({ err, assignmentId }, "Could not fetch assignment for hint context");
    }
  }

  if (!schemaExcerpt) {
    schemaExcerpt = "No schema provided";
  }
  if (!assignmentDescription) {
    assignmentDescription = "SQL query debugging and assistance";
  }

  const abortController = new AbortController();
  req.on("close", () => {
    if (!res.writableEnded) {
      abortController.abort();
    }
  });

  try {
    const result = await generateHintStream({
      schemaExcerpt,
      assignmentDescription,
      failedSql,
      error,
      taskId: assignmentId || `hint-${Date.now()}`,
      userId: req.user?.id,
      abortSignal: abortController.signal,
    });

    result.pipeTextStreamToResponse(res);
  } catch (err) {
    logger.error({ err }, "Failed to generate hint stream");
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to generate hint" });
    } else {
      res.end();
    }
  }
};

export default generate_assignment_hint;
