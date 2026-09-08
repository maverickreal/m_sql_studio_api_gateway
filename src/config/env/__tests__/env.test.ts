import { describe, it, expect } from "vitest";
import { z } from "zod/v4";

const ENV_MODE = {
  DEV: "DEV",
  STAGING: "STAGING",
  PROD: "PROD",
} as const;

const envVarsSchema = z.object({
  CLIENT_URL: z.url().nonempty().nonoptional(),
  SERVER_PORT: z.coerce.number().int().nonoptional(),
  MONGO_URI: z.string().startsWith("mongodb").nonempty().nonoptional(),
  REDIS_URL: z.url().nonempty().nonoptional(),
  BULLMQ_SQL_QUEUE_NAME: z.string().nonempty().nonoptional(),
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .nonoptional(),
  ENV_MODE: z.enum(ENV_MODE).nonoptional(),
  LOG_DIR: z.string().default("./logs"),
  INTERNAL_API_KEY: z.string().nonempty().nonoptional(),
});

const validEnv = {
  CLIENT_URL: "http://localhost:3000",
  SERVER_PORT: "8080",
  MONGO_URI: "mongodb://localhost:27017",
  REDIS_URL: "redis://localhost:6379",
  BULLMQ_SQL_QUEUE_NAME: "sql-exec-queue",
  LOG_LEVEL: "info",
  ENV_MODE: "DEV",
  LOG_DIR: "./logs",
  INTERNAL_API_KEY: "test-api-key",
};

describe("env validation", () => {
  describe("valid environment variables pass validation", () => {
    it("should pass with valid complete env vars", () => {
      const result = envVarsSchema.safeParse(validEnv);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.CLIENT_URL).toBe("http://localhost:3000");
        expect(result.data.SERVER_PORT).toBe(8080);
        expect(result.data.ENV_MODE).toBe("DEV");
      }
    });

    it("should pass with minimal required vars and defaults", () => {
      const minimalEnv = {
        CLIENT_URL: "http://localhost:3000",
        SERVER_PORT: "8080",
        MONGO_URI: "mongodb://localhost:27017",
        REDIS_URL: "redis://localhost:6379",
        BULLMQ_SQL_QUEUE_NAME: "queue",
        LOG_LEVEL: "info",
        ENV_MODE: "DEV",
        INTERNAL_API_KEY: "key",
      };
      const result = envVarsSchema.safeParse(minimalEnv);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.LOG_DIR).toBe("./logs");
      }
    });
  });

  describe("missing required fields fail validation", () => {
    it("should fail when CLIENT_URL is missing", () => {
      const env = { ...validEnv };
      delete env.CLIENT_URL;
      const result = envVarsSchema.safeParse(env);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some((i) => i.path.includes("CLIENT_URL")),
        ).toBe(true);
      }
    });

    it("should fail when SERVER_PORT is missing", () => {
      const env = { ...validEnv };
      delete env.SERVER_PORT;
      const result = envVarsSchema.safeParse(env);
      expect(result.success).toBe(false);
    });

    it("should fail when MONGO_URI is missing", () => {
      const env = { ...validEnv };
      delete env.MONGO_URI;
      const result = envVarsSchema.safeParse(env);
      expect(result.success).toBe(false);
    });

    it("should fail when REDIS_URL is missing", () => {
      const env = { ...validEnv };
      delete env.REDIS_URL;
      const result = envVarsSchema.safeParse(env);
      expect(result.success).toBe(false);
    });

    it("should fail when BULLMQ_SQL_QUEUE_NAME is missing", () => {
      const env = { ...validEnv };
      delete env.BULLMQ_SQL_QUEUE_NAME;
      const result = envVarsSchema.safeParse(env);
      expect(result.success).toBe(false);
    });

    it("should fail when LOG_LEVEL is missing", () => {
      const env = { ...validEnv };
      delete env.LOG_LEVEL;
      const result = envVarsSchema.safeParse(env);
      expect(result.success).toBe(false);
    });

    it("should fail when INTERNAL_API_KEY is missing", () => {
      const env = { ...validEnv };
      delete env.INTERNAL_API_KEY;
      const result = envVarsSchema.safeParse(env);
      expect(result.success).toBe(false);
    });
  });

  describe("invalid URL formats fail validation", () => {
    it("should fail with invalid CLIENT_URL", () => {
      const env = { ...validEnv, CLIENT_URL: "not-a-url" };
      const result = envVarsSchema.safeParse(env);
      expect(result.success).toBe(false);
    });

    it("should fail with invalid MONGO_URI", () => {
      const env = { ...validEnv, MONGO_URI: "invalid-mongo" };
      const result = envVarsSchema.safeParse(env);
      expect(result.success).toBe(false);
    });

    it("should fail with invalid REDIS_URL", () => {
      const env = { ...validEnv, REDIS_URL: "redis-local" };
      const result = envVarsSchema.safeParse(env);
      expect(result.success).toBe(false);
    });

    it("should pass with valid mongodb:// URL", () => {
      const env = {
        ...validEnv,
        MONGO_URI: "mongodb://user:pass@host:27017/db",
      };
      const result = envVarsSchema.safeParse(env);
      expect(result.success).toBe(true);
    });

    it("should pass with valid redis:// URL", () => {
      const env = { ...validEnv, REDIS_URL: "redis://:password@host:6380" };
      const result = envVarsSchema.safeParse(env);
      expect(result.success).toBe(true);
    });
  });

  describe("invalid enum values fail validation", () => {
    it("should fail with invalid LOG_LEVEL", () => {
      const env = { ...validEnv, LOG_LEVEL: "invalid-level" };
      const result = envVarsSchema.safeParse(env);
      expect(result.success).toBe(false);
    });

    it("should fail with invalid ENV_MODE", () => {
      const env = { ...validEnv, ENV_MODE: "INVALID" };
      const result = envVarsSchema.safeParse(env);
      expect(result.success).toBe(false);
    });

    it("should pass with all valid LOG_LEVEL values", () => {
      const levels = [
        "trace",
        "debug",
        "info",
        "warn",
        "error",
        "fatal",
      ] as const;
      for (const level of levels) {
        const env = { ...validEnv, LOG_LEVEL: level };
        const result = envVarsSchema.safeParse(env);
        expect(result.success).toBe(true);
      }
    });

    it("should pass with all valid ENV_MODE values", () => {
      const modes = ["DEV", "STAGING", "PROD"] as const;
      for (const mode of modes) {
        const env = { ...validEnv, ENV_MODE: mode };
        const result = envVarsSchema.safeParse(env);
        expect(result.success).toBe(true);
      }
    });
  });

  describe("default values are applied correctly", () => {
    it("should apply default LOG_DIR when not provided", () => {
      const env = { ...validEnv };
      delete env.LOG_DIR;
      const result = envVarsSchema.safeParse(env);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.LOG_DIR).toBe("./logs");
      }
    });

    it("should use custom LOG_DIR when provided", () => {
      const env = { ...validEnv, LOG_DIR: "/custom/log/path" };
      const result = envVarsSchema.safeParse(env);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.LOG_DIR).toBe("/custom/log/path");
      }
    });

    it("should fail when ENV_MODE is not provided (required field)", () => {
      const env = { ...validEnv };
      delete env.ENV_MODE;
      const result = envVarsSchema.safeParse(env);
      expect(result.success).toBe(false);
    });
  });

  describe("type coercion", () => {
    it("should coerce SERVER_PORT string to number", () => {
      const env = { ...validEnv, SERVER_PORT: "3000" };
      const result = envVarsSchema.safeParse(env);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(typeof result.data.SERVER_PORT).toBe("number");
        expect(result.data.SERVER_PORT).toBe(3000);
      }
    });

    it("should coerce SERVER_PORT numeric string", () => {
      const env = { ...validEnv, SERVER_PORT: "8080" };
      const result = envVarsSchema.safeParse(env);
      expect(result.success).toBe(true);
    });

    it("should fail for non-numeric SERVER_PORT", () => {
      const env = { ...validEnv, SERVER_PORT: "not-a-number" };
      const result = envVarsSchema.safeParse(env);
      expect(result.success).toBe(false);
    });
  });
});
