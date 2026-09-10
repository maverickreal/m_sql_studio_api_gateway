import type {
  HintProvider,
  HintPrompt,
  HintResult,
  HealthStatus,
  ModelInfo,
} from "./types";
import {
  buildHintPrompt,
  openaiChatCompletion,
  openaiModelsHealth,
} from "./openai-http";

export interface GeminiHintProviderConfig {
  host: string;
  apiKey: string;
  model: string;
}

export class GeminiHintProvider implements HintProvider {
  readonly classification = "shared" as const;
  readonly name: string;

  private readonly host: string;
  private readonly model: string;
  private readonly apiKey: string;

  constructor(config: GeminiHintProviderConfig) {
    this.host = config.host;
    this.model = config.model;
    this.apiKey = config.apiKey;
    this.name = `gemini/${config.model}`;
  }

  async generateHint(prompt: HintPrompt): Promise<HintResult> {
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
    const ok = await openaiModelsHealth(this.host, this.apiKey);
    return ok ? { status: "up" } : { status: "down" };
  }

  getModelInfo(): ModelInfo {
    return {
      name: this.model,
      provider: "gemini",
      contextWindow: 32768,
    };
  }
}
