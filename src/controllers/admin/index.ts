import { Request, Response } from "express";
import { z } from "zod/v4";
import { fromNodeHeaders } from "better-auth/node";
import {
  Assignment,
  AssignmentValidatorSchema,
} from "../../data/db/models/assignment";
import {
  AssignmentSolution,
  AssignmentSolutionValidatorSchema,
} from "../../data/db/models/assignment_solution";
import { AuditLog } from "../../data/db/models/audit_log";
import TaskQueueClient from "../../services/job_queue";
import { logger } from "../../config";
import { auth } from "../../auth";

const adminAssignmentSchema = z.object({
  ...AssignmentValidatorSchema,
  ...AssignmentSolutionValidatorSchema,
  initSql: z.string().nonempty().nonoptional(),
});

const create_assignment = async (req: Request, res: Response) => {
  const parsedBodyData = adminAssignmentSchema.safeParse(req.body);

  if (!parsedBodyData.success) {
    res.status(400).json({ error: parsedBodyData.error.message });
    return;
  }

  const {
    initSql,
    solutionSql,
    validationSql,
    orderMatters,
    ...assignmentObj
  } = parsedBodyData.data;

  let freshAssignment;

  try {
    freshAssignment = await Assignment.create(assignmentObj);

    await AssignmentSolution.create({
      assignmentId: freshAssignment._id,
      solutionSql,
      validationSql,
      orderMatters,
      initSql,
    });
  } catch (err) {
    logger.error({ err }, "Failed to create assignment in MongoDB!");
    res.status(500).json({ error: "Failed to create the assignment!" });

    return;
  }

  logger.info(
    { assignmentId: freshAssignment._id },
    "Added new assignment to MongoDB.",
  );

  try {
    const jobId = await TaskQueueClient.enqueueAdminAssignmentSeedJob({
      assignmentId: freshAssignment._id,
      initSql: initSql,
    });

    try {
      await AuditLog.create({
        actorId: String(req.user?.id ?? "unknown"),
        action: "assignment.create",
        targetType: "assignment",
        targetId: String(freshAssignment._id),
      });
    } catch (auditErr) {
      logger.error({ auditErr }, "Failed to write assignment.create audit row");
    }

    res.status(201).json({
      assignmentId: freshAssignment._id,
      jobId,
    });
  } catch (err) {
    logger.error(
      { err, assignmentId: freshAssignment._id },
      `Failed to enqueue assignment sandbox seed job;
      Rolling back assignment and solution MongoDB objects!"`,
    );
    await Assignment.findByIdAndDelete(freshAssignment._id);
    await AssignmentSolution.deleteOne({
      assignmentId: freshAssignment._id,
    });
    res.status(500).json({ error: "Failed to enqueue seed job!" });

    return;
  }
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const runListQuery = async (findResult: any, sortSpec: any, limit?: number) => {
  if (findResult && typeof findResult.sort === "function") {
    let q = findResult.sort(sortSpec);
    if (typeof limit === "number" && q && typeof q.limit === "function") {
      q = q.limit(limit);
    }
    if (q && typeof q.lean === "function") {
      return await q.lean();
    }
    return await q;
  }
  return await findResult;
};

const list_assignments = async (_req: Request, res: Response) => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const docs = (await runListQuery((Assignment as any).find({}), { createdAt: -1 }, undefined)) as any[];
    const items = (docs ?? []).map((d: any) => ({
      _id: String(d._id),
      title: d.title,
      difficulty: d.difficulty,
      mode: d.mode,
      createdAt: d.createdAt,
    }));
    res.status(200).json({ items });
  } catch (err) {
    logger.error({ err }, "Failed to list assignments");
    res.status(500).json({ error: "Failed to list assignments" });
  }
};

const list_users = async (req: Request, res: Response) => {
  try {
    let users: any[] = [];
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (await (auth.api as any).listUsers({
        headers: fromNodeHeaders(req.headers),
        query: { limit: 100 },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      })) as any;
      users = result?.users ?? [];
    } catch (apiErr) {
      logger.warn({ apiErr }, "auth.api.listUsers failed; falling back to user collection");
    }
    if (users.length === 0) {
      const { sharedMongoClient } = await import("../../data/db/client");
      users = await sharedMongoClient
        .db()
        .collection("user")
        .find({})
        .project({ email: 1, name: 1, role: 1 })
        .limit(100)
        .toArray();
    }
    const items = users.map((u: any) => ({
      id: String(u.id ?? u._id),
      email: u.email,
      name: u.name,
      role: u.role ?? "user",
    }));
    res.status(200).json({ items });
  } catch (err) {
    logger.error({ err }, "Failed to list users");
    res.status(500).json({ error: "Failed to list users" });
  }
};

const roleBodySchema = z.object({
  role: z.enum(["admin", "user"]),
});

const set_user_role = async (req: Request, res: Response) => {
  const rawId: unknown = (req.params as Record<string, unknown>).id;
  const targetId = Array.isArray(rawId) ? rawId[0] : (rawId as string);
  if (!targetId) {
    res.status(400).json({ error: "User id is required" });
    return;
  }
  const parsed = roleBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "role must be admin or user" });
    return;
  }
  const to = parsed.data.role;

  try {
    const { sharedMongoClient } = await import("../../data/db/client");
    const usersCollection = sharedMongoClient.db().collection("user");
    const { ObjectId } = await import("mongodb");
    const or: Record<string, unknown>[] = [{ id: targetId }];
    if (ObjectId.isValid(targetId)) {
      or.push({ _id: new ObjectId(targetId) });
      or.push({ _id: targetId });
    }
    const target = await usersCollection.findOne({ $or: or });
    if (!target) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const from = String((target as Record<string, unknown>).role ?? "user");
    if (from === to) {
      res.status(200).json({ user: { id: targetId, role: to } });
      return;
    }
    if (from === "admin" && to === "user") {
      const adminCount = await usersCollection.countDocuments({ role: "admin" });
      if (adminCount <= 1) {
        res.status(409).json({ error: "Cannot demote the last admin" });
        return;
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updated = (await (auth.api as any).setRole({
      headers: fromNodeHeaders(req.headers),
      body: { userId: targetId, role: to },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any) as { user?: unknown };

    try {
      await AuditLog.create({
        actorId: String(req.user?.id ?? "unknown"),
        action: "role.change",
        targetType: "user",
        targetId: String(targetId),
        meta: { from, to },
      });
    } catch (auditErr) {
      logger.error({ auditErr }, "Failed to write role.change audit row");
    }

    res.status(200).json({ user: updated.user ?? { id: targetId, role: to } });
  } catch (err) {
    logger.error({ err }, "Failed to set user role");
    res.status(500).json({ error: "Failed to set user role" });
  }
};

const list_audit = async (req: Request, res: Response) => {
  try {
    const raw = Number((req.query as Record<string, unknown>)?.limit ?? 50);
    const limit = Number.isFinite(raw)
      ? Math.min(200, Math.max(1, Math.floor(raw)))
      : 50;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (await runListQuery((AuditLog as any).find({}), { at: -1 }, limit)) as any[];
    res.status(200).json({ items: rows ?? [] });
  } catch (err) {
    logger.error({ err }, "Failed to list audit log");
    res.status(500).json({ error: "Failed to list audit log" });
  }
};

export default create_assignment;
export {
  create_assignment,
  list_assignments,
  list_users,
  set_user_role,
  list_audit,
};
