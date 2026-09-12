import { Request, Response } from "express";
import { TaskQueueClient, PassRecorder } from "../../services";
import { maybeAttachOwnerHint } from "../../services/ai_hint";

const get_job_status = async (
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
  const isAdmin = requester?.role === "admin";
  if (
    jobStatus.ownerUserId &&
    !isAdmin &&
    jobStatus.ownerUserId !== requester?.id
  ) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  // Record pass if job completed with passed: true
  if (
    jobStatus.status === "completed" &&
    jobStatus.result &&
    typeof jobStatus.result === "object" &&
    "passed" in jobStatus.result &&
    jobStatus.result.passed === true
  ) {
    const ownerUserId = jobStatus.ownerUserId;
    const assignmentId = (jobStatus.result as Record<string, unknown>).assignmentId as string | undefined;
    if (ownerUserId && assignmentId) {
      await PassRecorder.recordPass({
        userId: ownerUserId,
        assignmentId,
        taskId,
      });
    }
  }

  const { ownerUserId: _ownerUserId, ...body } = jobStatus;
  const withHint = await maybeAttachOwnerHint(body, {
    taskId,
    ownerUserId: jobStatus.ownerUserId,
    requesterId: requester?.id,
  });
  res.status(200).json(withHint);
};

export default get_job_status;
