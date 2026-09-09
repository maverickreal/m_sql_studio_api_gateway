import { Request, Response } from "express";
import { Types } from "mongoose";
import { Assignment } from "../../data/db/models/assignment";
import { AssignmentSolution } from "../../data/db/models/assignment_solution";
import { CacheClient } from "../../data";
import { ASSIGNMENT_KEY_PREFIX } from "../../utils";
import { getSandboxDBSchemaIdForAssignment } from "../../utils";
import { SANDBOX_SCHEMA_TTL_DAYS } from "../../utils";
import { TaskQueueClient } from "../../services";
import { envVars, logger } from "../../config";
import {
  parseCollectionQuery,
  type CollectionQueryConfig,
} from "../../utils";

const cleanup_assignment = async (req: Request, res: Response) => {
  const id = req.params.id as string;

  try {
    const deletedAssignment = await Assignment.findByIdAndDelete(id);
    if (!deletedAssignment) {
      res.status(404).json({ error: "Assignment not found" });
      return;
    }

    await AssignmentSolution.deleteOne({
      assignmentId: new Types.ObjectId(id),
    });

    logger.info(
      { assignmentId: id },
      "Cleaned up orphaned assignment after schema creation failure",
    );

    res.status(200).json({ success: true, assignmentId: id });
  } catch (err) {
    logger.error({ err, assignmentId: id }, "Failed to cleanup assignment");
    res.status(500).json({ error: "Failed to cleanup assignment" });
  }
};

const confirm_assignment = async (req: Request, res: Response) => {
  const assignmentId = `${req.params.id}`;

  try {
    const sandboxUpdatedAssignment = await Assignment.findByIdAndUpdate(
      assignmentId,
      {
        pgSchemaReady: true,
      },
    );

    if (!sandboxUpdatedAssignment) {
      res.status(404).json({ error: "Assignment not found!" });
      return;
    }

    const cacheClient = (await CacheClient.get())!;
    await cacheClient.del(ASSIGNMENT_KEY_PREFIX + assignmentId);

    logger.info(
      { assignmentId },
      `Uncached assignment ${assignmentId} and set 'pgSchemaReady=true'.`,
    );

    res.status(200).json({ success: true, assignmentId });
  } catch (err) {
    logger.error(
      { err, assignmentId },
      `Failed at updating the pgSchemaReady field for assignment ${assignmentId}!`,
    );
    res.status(500).json({ error: "Assignment confirmation failed!" });
  }
};

const OLD_SCHEMAS_QUERY_CONFIG: CollectionQueryConfig = {
  sortFields: ["_id"],
  filterFields: {},
  searchFields: [],
  defaultSort: "_id",
  defaultOrder: "asc",
  defaultLimit: 100,
  maxLimit: 500,
};

const get_old_schemas = async (req: Request, res: Response) => {
  const rawTtl = req.query.ttlDays;
  const ttlDays =
    rawTtl === undefined
      ? (envVars.SANDBOX_SCHEMA_TTL_DAYS ?? SANDBOX_SCHEMA_TTL_DAYS)
      : Number(rawTtl);

  if (!Number.isInteger(ttlDays) || ttlDays < 1) {
    res.status(400).json({ error: "Invalid ttlDays provided!" });
    return;
  }

  // ADR 004 P6: defensive page/limit cap. ttlDays stays the domain selector;
  // filter/sort/q are not implemented for this internal endpoint.
  const parsed = parseCollectionQuery(
    req.query as Record<string, unknown>,
    OLD_SCHEMAS_QUERY_CONFIG,
  );

  if (parsed.error !== undefined) {
    res.status(parsed.error.status).json(parsed.error.body);
    return;
  }

  try {
    const cutoff = new Date(Date.now() - ttlDays * 24 * 60 * 60 * 1000);
    const stale = await Assignment.find(
      { createdAt: { $lt: cutoff } },
      { _id: 1 },
    ).lean();

    const allNames = stale.map((doc) =>
      getSandboxDBSchemaIdForAssignment(`${(doc as { _id: unknown })._id}`),
    );
    const total = allNames.length;
    const schemaNames = allNames.slice(parsed.skip, parsed.skip + parsed.limit);

    res.status(200).json({
      schemaNames,
      count: schemaNames.length,
      page: parsed.page,
      limit: parsed.limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / parsed.limit),
    });
  } catch (err) {
    logger.error({ err }, "Failed to list old schemas for cleanup!");
    res.status(500).json({ error: "Failed to list old schemas!" });
  }
};

const trigger_cleanup = async (_req: Request, res: Response) => {
  try {
    const jobId = await TaskQueueClient.enqueueCleanupJob();
    res.status(202).json({ jobId });
  } catch (err) {
    logger.error({ err }, "Failed to enqueue cleanup job!");
    res.status(500).json({ error: "Failed to enqueue cleanup job!" });
  }
};

const trigger_problems_sync = async (req: Request, res: Response) => {
  try {
    const forced = (req.body as { forced?: unknown } | undefined)?.forced === true;
    const jobId = await TaskQueueClient.enqueueProblemsSyncJob({
      deliveryId: `manual-${Date.now()}`,
      reason: "manual",
      forced,
    });
    res.status(202).json({ jobId });
  } catch (err) {
    logger.error({ err }, "Failed to enqueue problems sync job!");
    res.status(500).json({ error: "Failed to enqueue problems sync job!" });
  }
};

export {
  cleanup_assignment,
  confirm_assignment,
  get_old_schemas,
  trigger_cleanup,
  trigger_problems_sync,
};
