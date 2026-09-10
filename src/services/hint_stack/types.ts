export interface HintProvider {
  readonly classification: "owner_only" | "shared";
  readonly name: string;

  generateHint(prompt: HintPrompt): Promise<HintResult>;
  healthCheck(): Promise<HealthStatus>;
  getModelInfo(): ModelInfo;
}

export interface HintPrompt {
  taskId: string;
  userQuery: string;
  schemaContext: SchemaSummary;
  failureReason: string;
  attemptNumber: number;
}

export interface HintResult {
  text: string;
  model: string;
  latencyMs: number;
  tokensIn: number;
  tokensOut: number;
}

export interface HealthStatus {
  status: "up" | "down" | "unconfigured";
  message?: string;
}

export interface ModelInfo {
  name: string;
  provider: string;
  contextWindow: number;
}

export type SchemaSummary = string;
