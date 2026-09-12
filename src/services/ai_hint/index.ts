import fs from "node:fs";
import { streamText, type LanguageModel } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { envVars } from "../../config";
import {
  FileAuditLogger,
  InMemoryAuditLogger,
  type AuditLogger,
  type AuditEvent,
} from "./audit-logger";
import {
  FileConsentStore,
  InMemoryConsentStore,
  type ConsentStore,
} from "./consent-store";

export * from "./audit-logger";
export * from "./consent-store";
export * from "./health";
export * from "./attach";

export type AiProviderName =
  | "local"
  | "ollama"
  | "openai"
  | "anthropic"
  | "google";

export interface ResolveModelOptions {
  provider?: string;
  modelName?: string;
  apiKey?: string;
  forceLocal?: boolean;
}

export interface ModelResolution {
  model: LanguageModel;
  providerName: AiProviderName;
  modelName: string;
  isLocal: boolean;
}

function resolveHostForContainer(url: string): string {
  try {
    if (fs.existsSync("/.dockerenv")) {
      const parsed = new URL(url);
      if (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") {
        parsed.hostname = "host.docker.internal";
        return parsed.toString();
      }
    }
  } catch {}
  return url;
}

const PRIVATE_INDICATORS = [
  "private",
  "user",
  "account",
  "secret",
  "token",
  "password",
  "ssn",
  "salary",
  "personal",
];

export function isOwnerOnly(schemaContext: string, query?: string): boolean {
  const text = `${schemaContext} ${query ?? ""}`.toLowerCase();
  return PRIVATE_INDICATORS.some((indicator) => text.includes(indicator));
}

let testModelOverride: LanguageModel | null = null;
let testAuditLogger: AuditLogger | null = null;
let testConsentStore: ConsentStore | null = null;

export function setAiModelForTests(model: LanguageModel | null): void {
  testModelOverride = model;
}

export function setAuditLoggerForTests(logger: AuditLogger | null): void {
  testAuditLogger = logger;
}

export function setConsentStoreForTests(store: ConsentStore | null): void {
  testConsentStore = store;
}

export function getAuditLogger(): AuditLogger {
  if (testAuditLogger) return testAuditLogger;
  return new FileAuditLogger(envVars.HINT_AUDIT_PATH);
}

export function getConsentStore(): ConsentStore {
  if (testConsentStore) return testConsentStore;
  if (envVars.HINT_CONSENT_PATH) {
    return new FileConsentStore(envVars.HINT_CONSENT_PATH);
  }
  return new InMemoryConsentStore(envVars.HINT_SAY === "true");
}

export function resolveAiModel(
  options: ResolveModelOptions = {},
): ModelResolution {
  if (testModelOverride) {
    return {
      model: testModelOverride,
      providerName: (options.provider as AiProviderName) ?? "local",
      modelName: options.modelName ?? "test-model",
      isLocal: true,
    };
  }

  const rawProvider = options.forceLocal
    ? "local"
    : (options.provider || envVars.AI_PROVIDER || "local").toLowerCase();

  const providerName: AiProviderName = [
    "openai",
    "anthropic",
    "google",
    "ollama",
    "local",
  ].includes(rawProvider)
    ? (rawProvider as AiProviderName)
    : "local";

  switch (providerName) {
    case "openai": {
      const apiKey =
        options.apiKey ||
        envVars.AI_API_KEY ||
        process.env.OPENAI_API_KEY ||
        "";
      const modelName =
        options.modelName || envVars.AI_MODEL || "gpt-4o-mini";
      const openai = createOpenAI({ apiKey });
      return {
        model: openai(modelName),
        providerName: "openai",
        modelName,
        isLocal: false,
      };
    }

    case "anthropic": {
      const apiKey =
        options.apiKey ||
        envVars.AI_API_KEY ||
        process.env.ANTHROPIC_API_KEY ||
        "";
      const modelName =
        options.modelName || envVars.AI_MODEL || "claude-3-5-haiku-latest";
      const anthropic = createAnthropic({ apiKey });
      return {
        model: anthropic(modelName),
        providerName: "anthropic",
        modelName,
        isLocal: false,
      };
    }

    case "google": {
      const apiKey =
        options.apiKey ||
        envVars.AI_API_KEY ||
        process.env.GOOGLE_API_KEY ||
        process.env.GEMINI_API_KEY ||
        "";
      const modelName =
        options.modelName || envVars.AI_MODEL || "gemini-2.5-flash";
      const google = createGoogleGenerativeAI({ apiKey });
      return {
        model: google(modelName),
        providerName: "google",
        modelName,
        isLocal: false,
      };
    }

    case "ollama":
    case "local":
    default: {
      const localBaseUrl = resolveHostForContainer(
        envVars.AI_API_URL ||
          envVars.HINT_API_URL ||
          "http://127.0.0.1:3208/v1",
      );
      const modelName =
        options.modelName ||
        envVars.AI_MODEL ||
        envVars.HINT_MODEL ||
        "LFM2.5-8B-A1B-MLX-6bit";
      const apiKey =
        options.apiKey ||
        envVars.AI_API_KEY ||
        envVars.HINT_API_KEY ||
        "dummy";
      const localOpenAi = createOpenAI({
        baseURL: localBaseUrl,
        apiKey,
      });
      return {
        model: localOpenAi(modelName),
        providerName: "local",
        modelName,
        isLocal: true,
      };
    }
  }
}

export interface GenerateHintStreamArgs {
  schemaExcerpt: string;
  assignmentDescription: string;
  failedSql: string;
  error: string;
  taskId?: string;
  userId?: string;
  abortSignal?: AbortSignal;
}

export async function generateHintStream(
  args: GenerateHintStreamArgs,
): Promise<ReturnType<typeof streamText>> {
  const audit = getAuditLogger();
  const consent = getConsentStore();

  const configuredProvider = (envVars.AI_PROVIDER || "local").toLowerCase();
  const isRemoteRequested = [
    "openai",
    "anthropic",
    "google",
  ].includes(configuredProvider);
  const ownerOnly = isOwnerOnly(args.schemaExcerpt, args.failedSql);

  let activeProvider = configuredProvider;
  let route: "owner_only" | "shared" | "shared_fallback_local" = ownerOnly
    ? "owner_only"
    : "shared";

  if (ownerOnly) {
    if (isRemoteRequested) {
      audit.emit({
        type: "hint_suppressed",
        reason: "pii_off_box",
        classification: "owner_only",
        taskId: args.taskId,
        userId: args.userId,
      });
      activeProvider = "local";
    }
  } else if (isRemoteRequested) {
    const sayConsent =
      envVars.HINT_SAY === "true" || (await consent.getSayConsent());
    if (!sayConsent) {
      audit.emit({
        type: "hint_suppressed",
        reason: "no_say_consent",
        classification: "shared",
        taskId: args.taskId,
        userId: args.userId,
      });
      audit.emit({
        type: "hint_fallback",
        route: "shared_fallback_local",
        taskId: args.taskId,
        userId: args.userId,
      });
      activeProvider = "local";
      route = "shared_fallback_local";
    }
  }

  const resolved = resolveAiModel({
    provider: activeProvider,
    forceLocal: activeProvider === "local" || activeProvider === "ollama",
  });

  audit.emit({
    type: "hint_generated",
    route,
    model: resolved.modelName,
    provider: resolved.providerName,
    taskId: args.taskId,
    userId: args.userId,
  });

  const systemPrompt = [
    "You are a SQL hint assistant. Provide exactly one concise hint to help the user fix their SQL query without giving away the full solution.",
    "",
    "Schema:",
    args.schemaExcerpt,
    "",
    "Assignment:",
    args.assignmentDescription,
  ].join("\n");

  const userPrompt = [
    "Failed SQL:",
    args.failedSql,
    "",
    "Error:",
    args.error,
  ].join("\n");

  return streamText({
    model: resolved.model,
    system: systemPrompt,
    prompt: userPrompt,
    abortSignal: args.abortSignal,
  });
}

export async function generateHintText(
  args: GenerateHintStreamArgs,
): Promise<string> {
  const result = await generateHintStream(args);
  let fullText = "";
  for await (const chunk of result.textStream) {
    fullText += chunk;
  }
  return fullText.trim();
}
