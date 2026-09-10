import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    env: {
      CLIENT_URL: "http://localhost:3000",
      SERVER_PORT: "8080",
      MONGO_URI: "mongodb://localhost:27017/test_db",
      REDIS_URL: "redis://localhost:6379",
      BULLMQ_SQL_QUEUE_NAME: "test_queue",
      SANDBOX_PG_HOST: "localhost",
      SANDBOX_PG_PORT: "5432",
      SANDBOX_PG_DATABASE: "test_sandbox",
      SANDBOX_PG_USER: "test_user",
      SANDBOX_PG_PASSWORD: "test_pass",
      LOG_LEVEL: "info",
      ENV_MODE: "DEV",
      HINT_ENABLED: "false",
      INTERNAL_API_KEY: "test-internal-api-key",
      BETTER_AUTH_SECRET: "12345678901234567890123456789012",
      BETTER_AUTH_URL: "http://localhost:8080",
      DEFAULT_ADMIN_EMAIL: "admin@example.com",
      DEFAULT_ADMIN_PASSWORD: "adminpass123",
      ADMIN_SECRET_CODE: "secret123",
      GITHUB_WEBHOOK_SECRET: "test-webhook-secret",
    },
  },
});
