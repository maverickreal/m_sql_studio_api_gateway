import { Worker } from "bullmq";
import app from "./app";
import { envVars, logger } from "./config";
import { DBClient, CacheClient } from "./data";
import { TaskQueueClient, SseSubscriber } from "./services";
import { processProblemsSyncJob } from "./services/problems_sync";
import { seedAdminUser } from "./auth";
import {
  SERVER_START_FAILURE_EXIT_CODE,
  SERVER_KILL_SIGNAL_EXIT_CODE,
  ENV_MODE,
  PROBLEMS_SYNC_QUEUE_NAME,
} from "./utils";

let problemsSyncWorker: Worker | null = null;

const cleanup = async () => {
  if (problemsSyncWorker) {
    await problemsSyncWorker.close();
    problemsSyncWorker = null;
  }
  await SseSubscriber.disconnect();
  await TaskQueueClient.disconnect();
  await CacheClient.disconnect();
  await DBClient.disconnect();
};

app
  .listen(envVars.SERVER_PORT, async () => {
    logger.info("Started the server.");

    ["SIGTERM", "SIGINT"].forEach((signal) => {
      process.on(signal, async () => {
        logger.info({ signal }, "Terminating the server due to kill signal!");
        await cleanup();
        process.exit(SERVER_KILL_SIGNAL_EXIT_CODE);
      });
    });

    process.on("unhandledRejection", (reason) => {
      logger.error({ reason }, "Unhandled promise rejection — shutting down!");
      cleanup().finally(() => process.exit(1));
    });

    process.on("uncaughtException", (err: Error) => {
      logger.error({ err }, "Uncaught exception — shutting down!");
      cleanup().finally(() => process.exit(1));
    });

    await CacheClient.connect();
    await DBClient.connect();
    TaskQueueClient.connect();

    problemsSyncWorker = new Worker(
      PROBLEMS_SYNC_QUEUE_NAME,
      async (job) => processProblemsSyncJob(job.data),
      {
        connection: {
          url: envVars.REDIS_URL,
          maxRetriesPerRequest: null,
          enableReadyCheck: false,
          lazyConnect: false,
        },
        concurrency: 1,
      },
    );
    problemsSyncWorker.on("failed", (job, err) => {
      logger.error(
        { jobId: job?.id, err: err.message },
        "Problems sync job failed",
      );
    });
    logger.info(
      { queue: PROBLEMS_SYNC_QUEUE_NAME },
      "Problems sync worker started.",
    );

    try {
      await TaskQueueClient.enqueueRepeatableCleanupJob(
        envVars.CLEANUP_JOB_CRON,
      );
      logger.info(
        { cron: envVars.CLEANUP_JOB_CRON },
        "Enqueued repeatable sandbox cleanup job.",
      );
    } catch (err) {
      logger.error({ err }, "Failed to enqueue repeatable cleanup job!");
    }

    if (envVars.ENV_MODE === ENV_MODE.DEV) {
      const adminEmail = envVars.DEFAULT_ADMIN_EMAIL;
      const adminPassword = envVars.DEFAULT_ADMIN_PASSWORD;

      try {
        await seedAdminUser(adminEmail, adminPassword, "Admin");
        logger.info({ email: adminEmail }, "Seeded admin user.");
      } catch (err) {
        logger.error({ err }, "Failed to seed admin user.");
      }
    }
  })
  .on("error", (err: Error) => {
    logger.error({ err }, "Error starting the server!");
    process.exit(SERVER_START_FAILURE_EXIT_CODE);
  });
