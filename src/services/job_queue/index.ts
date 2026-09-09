import { Queue } from "bullmq";
import { type ServiceClient } from "../../types";
import {
  JOB_TTL_S,
  BULLMQ_JOB_NAME,
  ADMIN_ASSIGNMENT_SEED_JOB_NAME,
  CLEANUP_JOB_NAME,
  PROBLEMS_SYNC_JOB_NAME,
  BULLMQ_JOB_FAILURE_MESSAGE,
  ASSIGNMENT_SEED_JOB_MAX_ATTEMPTS,
} from "../../utils";
import { logger, envVars } from "../../config";
import { Types } from "mongoose";

interface SqlJobPayload {
  assignmentId: string;
  userSql: string;
  assignmentSchema: string;
  mode: "read" | "write";
  solutionSql?: string;
  validationSql?: string;
  orderMatters?: boolean;
  userId?: string;
}

export interface AdminAssignmentSeedJobPayload {
  assignmentId: Types.ObjectId;
  initSql: string;
}

export interface ProblemsSyncJobPayload {
  deliveryId: string;
  ref?: string;
  afterSha?: string;
  forced?: boolean;
  commits?: Array<{
    added?: string[];
    modified?: string[];
    removed?: string[];
  }>;
  reason?: string;
}

interface JobStatusResponse {
  status: string;
  result?: unknown;
  ownerUserId?: string;
}

class TaskQueueClient {
  private static clientInst: Queue | null = null;

  static connect() {
    if (TaskQueueClient.clientInst !== null) {
      return;
    }

    TaskQueueClient.clientInst = new Queue(envVars.BULLMQ_SQL_QUEUE_NAME, {
      connection: {
        url: envVars.REDIS_URL,
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        lazyConnect: false,
      },
    });
  }

  static async enqueue(data: SqlJobPayload) {
    const { id } = await TaskQueueClient.clientInst!.add(
      BULLMQ_JOB_NAME,
      data,
      {
        removeOnComplete: { age: JOB_TTL_S },
        removeOnFail: { age: JOB_TTL_S },
      },
    );

    return id;
  }

  static async enqueueAdminAssignmentSeedJob(
    data: AdminAssignmentSeedJobPayload,
  ) {
    const { id } = await TaskQueueClient.clientInst!.add(
      ADMIN_ASSIGNMENT_SEED_JOB_NAME,
      data,
      {
        removeOnComplete: { age: JOB_TTL_S },
        removeOnFail: { age: JOB_TTL_S },
        attempts: ASSIGNMENT_SEED_JOB_MAX_ATTEMPTS,
        backoff: { type: "exponential", delay: 1000 },
      },
    );

    return id;
  }

  static async enqueueCleanupJob() {
    const { id } = await TaskQueueClient.clientInst!.add(
      CLEANUP_JOB_NAME,
      {},
      {
        removeOnComplete: { age: JOB_TTL_S },
        removeOnFail: { age: JOB_TTL_S },
      },
    );

    return id;
  }

  static async enqueueRepeatableCleanupJob(cronPattern: string) {
    const { id } = await TaskQueueClient.clientInst!.add(
      CLEANUP_JOB_NAME,
      {},
      {
        repeat: { pattern: cronPattern },
        removeOnComplete: { age: JOB_TTL_S },
        removeOnFail: { age: JOB_TTL_S },
      },
    );

    return id;
  }
  static async enqueueProblemsSyncJob(data: ProblemsSyncJobPayload) {
    const { id } = await TaskQueueClient.clientInst!.add(
      PROBLEMS_SYNC_JOB_NAME,
      data,
      {
        removeOnComplete: { age: JOB_TTL_S },
        removeOnFail: { age: JOB_TTL_S },
      },
    );

    return id;
  }

  static async ping(): Promise<void> {
    await TaskQueueClient.clientInst!.getJobCounts();
  }

  static async getWorkersCount(): Promise<number> {
    return TaskQueueClient.clientInst!.getWorkersCount();
  }

  static async getStatus(taskId: string) {
    const task = await TaskQueueClient.clientInst!.getJob(taskId);

    if (!task) {
      return null;
    }
    const taskState = await task.getState();
    const respBodyData: JobStatusResponse = { status: taskState };
    const ownerUserId = (task.data as SqlJobPayload | undefined)?.userId;
    if (ownerUserId) {
      respBodyData.ownerUserId = ownerUserId;
    }

    if (taskState === "completed" && task.returnvalue) {
      respBodyData.result = task.returnvalue;
    } else if (taskState === "failed") {
      logger.error(
        { taskId, taskName: task.name, failedReason: task.failedReason },
        BULLMQ_JOB_FAILURE_MESSAGE,
      );
      respBodyData.result = BULLMQ_JOB_FAILURE_MESSAGE;
    }

    return respBodyData;
  }

  static async disconnect(): Promise<void> {
    if (TaskQueueClient.clientInst) {
      await TaskQueueClient.clientInst.close();
      TaskQueueClient.clientInst = null;
    }
  }
}

export default TaskQueueClient satisfies ServiceClient;
