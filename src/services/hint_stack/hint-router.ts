import type { HintPrompt, HintResult } from "./types";
import type { OllamaHintProvider } from "./ollama-hint-provider";
import type { GeminiHintProvider } from "./gemini-hint-provider";
import type { ConsentStore } from "./consent-store";
import type { AuditLogger } from "./audit-logger";

export type HintClassification = "owner_only" | "shared";

export interface HintRouterOptions {
  enabled?: boolean;
}

export class HintRouter {
  private readonly enabled: boolean;

  constructor(
    private readonly ollama: OllamaHintProvider,
    private readonly gemini: GeminiHintProvider | null,
    private readonly consentStore: ConsentStore,
    private readonly auditLog: AuditLogger,
    options: HintRouterOptions = {},
  ) {
    this.enabled = options.enabled ?? true;
  }

  /**
   * Get a hint for a failed SQL submit.
   *
   * Sequence per ADR:
   * 1. Kill-switch off or no failure → no hint
   * 2. Classify hint (owner_only vs shared)
   * 3. owner_only → local OpenAI-compat (never leaves box)
   * 4. shared → check say consent → remote (if yes) or local fallback
   * 5. Fallback chain per ADR §5
   */
  async getHint(prompt: HintPrompt): Promise<HintResult | null> {
    if (!this.enabled) {
      this.auditLog.emit({
        type: "hint_skipped",
        reason: "kill_switch",
        taskId: prompt.taskId,
      });
      return null;
    }

    if (!prompt.failureReason || prompt.failureReason.trim() === "") {
      this.auditLog.emit({
        type: "hint_skipped",
        reason: "successful_submit",
        taskId: prompt.taskId,
      });
      return null;
    }

    const classification = this.classify(prompt);

    if (classification === "owner_only") {
      return this.getOwnerHint(prompt);
    }

    return this.getSharedHint(prompt);
  }

  private async getOwnerHint(prompt: HintPrompt): Promise<HintResult | null> {
    try {
      const result = await this.ollama.generateHint(prompt);
      this.auditLog.emit({
        type: "hint_generated",
        route: "owner_only",
        model: this.ollama.name,
        taskId: prompt.taskId,
      });
      return result;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.auditLog.emit({
        type: "hint_suppressed",
        reason: message === "pii_off_box" ? "pii_off_box" : "ollama_down",
        classification: "owner_only",
        error: message,
        taskId: prompt.taskId,
      });
      return null;
    }
  }

  private async getSharedHint(prompt: HintPrompt): Promise<HintResult | null> {
    const say = await this.consentStore.getSayConsent();

    if (!say) {
      this.auditLog.emit({
        type: "hint_suppressed",
        reason: "no_say_consent",
        classification: "shared",
        taskId: prompt.taskId,
      });

      try {
        const result = await this.ollama.generateHint(prompt);
        this.auditLog.emit({
          type: "hint_generated",
          route: "shared_fallback_local",
          model: this.ollama.name,
          taskId: prompt.taskId,
        });
        return result;
      } catch {
        this.auditLog.emit({
          type: "hint_suppressed",
          reason: "ollama_fallback_down",
          classification: "shared",
          taskId: prompt.taskId,
        });
        return null;
      }
    }

    if (this.gemini) {
      try {
        const result = await this.gemini.generateHint(prompt);
        this.auditLog.emit({
          type: "hint_generated",
          route: "shared",
          model: this.gemini.name,
          taskId: prompt.taskId,
        });
        return result;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.auditLog.emit({
          type: "hint_fallback",
          route: "shared",
          error: message,
          taskId: prompt.taskId,
        });
      }
    }

    try {
      const result = await this.ollama.generateHint(prompt);
      this.auditLog.emit({
        type: "hint_generated",
        route: "shared_fallback_local",
        model: this.ollama.name,
        taskId: prompt.taskId,
      });
      return result;
    } catch {
      this.auditLog.emit({
        type: "hint_suppressed",
        reason: "all_providers_down",
        classification: "shared",
        taskId: prompt.taskId,
      });
      return null;
    }
  }

  /**
   * Classify hint based on schema context.
   * owner_only: schema contains private/user-owned data indicators.
   * shared: schema is clearly public/shared.
   * SAT failed-submit path always sends owner_only-shaped prompts.
   */
  private classify(prompt: HintPrompt): HintClassification {
    const schemaLower = prompt.schemaContext.toLowerCase();

    const privateIndicators = [
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

    for (const indicator of privateIndicators) {
      if (schemaLower.includes(indicator)) {
        return "owner_only";
      }
    }

    return "shared";
  }

  async getHealth(): Promise<{
    ollama: "up" | "down";
    gemini: "up" | "down" | "unconfigured";
  }> {
    const [ollamaStatus, geminiStatus] = await Promise.all([
      this.ollama.healthCheck(),
      this.gemini?.healthCheck() ??
        Promise.resolve({ status: "unconfigured" as const }),
    ]);

    return {
      ollama: ollamaStatus.status === "up" ? "up" : "down",
      gemini: geminiStatus.status,
    };
  }
}
