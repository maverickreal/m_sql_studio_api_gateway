import { Queue } from "bullmq";
import { type ServiceClient } from "../../types";
import {
  JOB_TTL_S,
  BULLMQ_JOB_NAME,
  ADMIN_ASSIGNMENT_SEED_JOB_NAME,
  CLEANUP_JOB_NAME,
  PROBLEMS_SYNC_JOB_NAME,
  PROBLEMS_SYNC_QUEUE_NAME,
  BULLMQ_JOB_FAILURE_MESSAGE,
  ASSIGNMENT_SEED_JOB_MAX_ATTEMPTS,
} from "../../utils";
import { logger, envVars } from "../../config";
import { encodedRedisUrl } from "../../data/cache";
import { Types } from "mongoose";
import { PassRecorder } from "../pass_recorder";

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
  beforeSha?: string;
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
  private static syncQueue: Queue | null = null;

  static connect() {
    const connection = {
      url: encodedRedisUrl,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: false,
    };
    if (TaskQueueClient.clientInst === null) {
      TaskQueueClient.clientInst = new Queue(envVars.BULLMQ_SQL_QUEUE_NAME, {
        connection,
      });
    }
    if (TaskQueueClient.syncQueue === null) {
      TaskQueueClient.syncQueue = new Queue(PROBLEMS_SYNC_QUEUE_NAME, {
        connection,
      });
    }
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
    const { id } = await TaskQueueClient.syncQueue!.add(
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

  static async getJob(taskId: string) {
    return TaskQueueClient.clientInst!.getJob(taskId);
  }

  static async recordPass(data: {
    userId: string;
    assignmentId: string;
    taskId: string;
  }): Promise<void> {
    await PassRecorder.recordPass(data);
  }

  static async disconnect(): Promise<void> {
    if (TaskQueueClient.clientInst) {
      await TaskQueueClient.clientInst.close();
      TaskQueueClient.clientInst = null;
    }
    if (TaskQueueClient.syncQueue) {
      await TaskQueueClient.syncQueue.close();
      TaskQueueClient.syncQueue = null;
    }
  }
}

export default TaskQueueClient satisfies ServiceClient;
