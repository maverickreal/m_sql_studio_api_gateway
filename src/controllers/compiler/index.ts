import { z } from "zod/v4";
import {
  getAssignmentByIdCached,
  getAssignmentSolutionByAssignmentIdCached,
  TaskQueueClient,
} from "../../services";
import { MAX_USER_SQL_CODE_LEN } from "../../utils";
import { Request, Response } from "express";
import { Types } from "mongoose";
import { getSandboxDBSchemaIdForAssignment } from "../../utils";

const SqlJobPayloadSchema = z.object({
  assignmentId: z.string().refine((id) => Types.ObjectId.isValid(`${id}`), {
    message: "Invalid assignment ID provided!",
  }),
  userSql: z
    .string()
    .max(MAX_USER_SQL_CODE_LEN)
    .nonempty({ message: "An invalid SQL query provided!" })
    .nonoptional(),
});

const run_client_sql_code = async (req: Request, res: Response) => {
  const parsedData = SqlJobPayloadSchema.safeParse(req.body);

  if (!parsedData.success) {
    res.status(400).json({ error: parsedData.error.message });
    return;
  }
  const bodyData = parsedData.data;
  const assignment = await getAssignmentByIdCached(`${bodyData.assignmentId}`);

  if (!assignment) {
    res.status(404).json({ error: "Couldn't find the assignment!" });
    return;
  }

  if (!assignment.pgSchemaReady) {
    res.status(503).json({ error: "Assignment unavailable at the moment!" });

    return;
  }

  const assignmentSchema = getSandboxDBSchemaIdForAssignment(
    bodyData.assignmentId,
  );

  const solution = await getAssignmentSolutionByAssignmentIdCached(
    bodyData.assignmentId,
  );

  const taskId = await TaskQueueClient.enqueue({
    assignmentId: bodyData.assignmentId,
    userSql: bodyData.userSql,
    assignmentSchema,
    mode: assignment.mode,
    solutionSql: solution?.solutionSql || undefined,
    validationSql: solution?.validationSql || undefined,
    orderMatters: solution?.orderMatters,
    userId: req.user?.id,
  });

  res.status(202).json({ taskId });
};

export default run_client_sql_code;
