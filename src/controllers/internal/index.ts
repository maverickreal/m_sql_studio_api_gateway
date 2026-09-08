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

  try {
    const cutoff = new Date(Date.now() - ttlDays * 24 * 60 * 60 * 1000);
    const stale = await Assignment.find(
      { createdAt: { $lt: cutoff } },
      { _id: 1 },
    ).lean();

    const schemaNames = stale.map((doc) =>
      getSandboxDBSchemaIdForAssignment(`${doc._id}`),
    );

    res.status(200).json({ schemaNames, count: schemaNames.length });
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

export {
  cleanup_assignment,
  confirm_assignment,
  get_old_schemas,
  trigger_cleanup,
};
