import type {
  HintProvider,
  HintPrompt,
  HintResult,
  HealthStatus,
  ModelInfo,
} from "./types";
import {
  buildHintPrompt,
  isLoopbackUrl,
  openaiChatCompletion,
  openaiModelsHealth,
} from "./openai-http";

export interface OllamaHintProviderConfig {
  host: string;
  model: string;
  apiKey?: string;
}

export class OllamaHintProvider implements HintProvider {
  readonly classification = "owner_only" as const;
  readonly name: string;

  private readonly host: string;
  private readonly model: string;
  private readonly apiKey?: string;

  constructor(config: OllamaHintProviderConfig) {
    this.host = config.host;
    this.model = config.model;
    this.apiKey = config.apiKey;
    this.name = `ollama/${config.model}`;
  }

  async generateHint(prompt: HintPrompt): Promise<HintResult> {
    if (!isLoopbackUrl(this.host)) {
      throw new Error("pii_off_box");
    }

    const startTime = Date.now();
    const response = await openaiChatCompletion({
      baseUrl: this.host,
      apiKey: this.apiKey,
      model: this.model,
      prompt: buildHintPrompt(prompt),
    });

    return {
      text: response.text,
      model: this.model,
      latencyMs: Date.now() - startTime,
      tokensIn: response.tokensIn,
      tokensOut: response.tokensOut,
    };
  }

  async healthCheck(): Promise<HealthStatus> {
    if (!isLoopbackUrl(this.host)) {
      return { status: "down", message: "pii_off_box" };
    }
    const ok = await openaiModelsHealth(this.host, this.apiKey);
    return ok ? { status: "up" } : { status: "down" };
  }

  getModelInfo(): ModelInfo {
    return {
      name: this.model,
      provider: "ollama",
      contextWindow: 8192,
    };
  }
}
