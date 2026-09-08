import app from "./app";
import { envVars, logger } from "./config";
import { DBClient, CacheClient } from "./data";
import { TaskQueueClient, SseSubscriber } from "./services";
import { seedAdminUser } from "./auth";
import {
  SERVER_START_FAILURE_EXIT_CODE,
  SERVER_KILL_SIGNAL_EXIT_CODE,
  ENV_MODE,
} from "./utils";

const cleanup = async () => {
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
