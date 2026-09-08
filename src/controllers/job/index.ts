import { Request, Response } from "express";
import { TaskQueueClient } from "../../services";

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

  const { ownerUserId: _ownerUserId, ...body } = jobStatus;
  res.status(200).json(body);
};

export default get_job_status;
