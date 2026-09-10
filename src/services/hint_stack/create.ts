import { HintRouter } from "./hint-router";
import { OllamaHintProvider } from "./ollama-hint-provider";
import { GeminiHintProvider } from "./gemini-hint-provider";
import { FileConsentStore, InMemoryConsentStore } from "./consent-store";
import { FileAuditLogger } from "./audit-logger";

export interface HintStackConfig {
  enabled?: boolean;
  ollamaHost?: string;
  ollamaModel?: string;
  ollamaApiKey?: string;
  geminiHost?: string;
  geminiApiKey?: string;
  geminiModel?: string;
  consentPath?: string;
  auditLogPath?: string;
  say?: boolean;
}

export function createHintStack(config: HintStackConfig): HintRouter {
  const ollama = new OllamaHintProvider({
    host: config.ollamaHost ?? "http://127.0.0.1:11434/v1",
    model: config.ollamaModel ?? "gemma3:4b",
    apiKey: config.ollamaApiKey,
  });

  const gemini =
    config.geminiApiKey && config.geminiHost
      ? new GeminiHintProvider({
          host: config.geminiHost,
          apiKey: config.geminiApiKey,
          model: config.geminiModel ?? "gemini-3.5-flash",
        })
      : null;

  const consent = config.consentPath
    ? new FileConsentStore(config.consentPath)
    : new InMemoryConsentStore(config.say ?? false);

  if (config.say !== undefined && config.consentPath) {
    void consent.setSayConsent(config.say);
  }

  const audit = new FileAuditLogger(
    config.auditLogPath ?? "./logs/hint-audit.jsonl",
  );

  return new HintRouter(ollama, gemini, consent, audit, {
    enabled: config.enabled ?? true,
  });
}
