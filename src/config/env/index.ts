import { z } from "zod/v4";
import {
  ENV_MODE,
  SERVER_START_FAILURE_EXIT_CODE,
  SANDBOX_SCHEMA_TTL_DAYS,
  CLEANUP_JOB_CRON,
  JOB_RESULT_TTL_DAYS,
} from "../../utils";

const envVarsSchema = z.object({
  CLIENT_URL: z.url().nonempty().nonoptional(),
  SERVER_PORT: z.coerce.number().int().nonoptional(),
  MONGO_URI: z.string().startsWith("mongodb").nonempty().nonoptional(),
  REDIS_URL: z.url().nonempty().nonoptional(),
  BULLMQ_SQL_QUEUE_NAME: z.string().nonempty().nonoptional(),
  SANDBOX_PG_HOST: z.string().nonempty().nonoptional(),
  SANDBOX_PG_PORT: z.coerce.number().int().nonoptional(),
  SANDBOX_PG_DATABASE: z.string().nonempty().nonoptional(),
  SANDBOX_PG_USER: z.string().nonempty().nonoptional(),
  SANDBOX_PG_PASSWORD: z.string().nonempty().nonoptional(),
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .nonoptional(),
  ENV_MODE: z.enum(ENV_MODE).nonoptional(),
  LOG_DIR: z.string().default("./logs"),
  INTERNAL_API_KEY: z.string().nonempty().nonoptional(),
  BETTER_AUTH_SECRET: z.string().min(32).nonoptional(),
  BETTER_AUTH_URL: z.url().nonempty().nonoptional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GITHUB_WEBHOOK_SECRET: z.string().nonempty().optional(),
  GITHUB_PROBLEMS_REPO: z
    .string()
    .nonempty()
    .default("maverickreal/m_sql_studio_problems"),
  GITHUB_PROBLEMS_LOCAL_DIR: z.string().nonempty().optional(),
  DEFAULT_ADMIN_EMAIL: z.email().nonoptional(),
  DEFAULT_ADMIN_PASSWORD: z.string().nonempty().nonoptional(),
  ADMIN_SECRET_CODE: z.string().nonempty().nonoptional(),
  SANDBOX_SCHEMA_TTL_DAYS: z.coerce
    .number()
    .int()
    .positive()
    .default(SANDBOX_SCHEMA_TTL_DAYS),
  CLEANUP_JOB_CRON: z.string().nonempty().default(CLEANUP_JOB_CRON),
  JOB_RESULT_TTL_DAYS: z.coerce
    .number()
    .int()
    .positive()
    .default(JOB_RESULT_TTL_DAYS),
});

const parsedEnvVarsBody = envVarsSchema.safeParse(process.env);

if (!parsedEnvVarsBody.success) {
  console.error(
    "Invalid environment variables:",
    z.prettifyError(parsedEnvVarsBody.error),
  );
  process.exit(SERVER_START_FAILURE_EXIT_CODE);
}

export default parsedEnvVarsBody.data;
