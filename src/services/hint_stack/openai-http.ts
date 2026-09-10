export function isLoopbackUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "[::1]" ||
      hostname === "0.0.0.0"
    );
  } catch {
    return false;
  }
}

export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

export function buildHintPrompt(prompt: {
  schemaContext: string;
  userQuery: string;
  failureReason: string;
  attemptNumber: number;
}): string {
  return `You are a SQL hint assistant. The user's query failed. Provide exactly ONE concise hint to help them fix it. Do not provide the full corrected query.

Schema: ${prompt.schemaContext}
Failed query: ${prompt.userQuery}
Error: ${prompt.failureReason}
Attempt: ${prompt.attemptNumber}

Hint:`;
}

interface OpenAIChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export async function openaiChatCompletion(opts: {
  baseUrl: string;
  apiKey?: string;
  model: string;
  prompt: string;
  timeoutMs?: number;
}): Promise<{ text: string; tokensIn: number; tokensOut: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 5000);
  try {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (opts.apiKey) {
      headers.authorization = `Bearer ${opts.apiKey}`;
    }

    const res = await fetch(joinUrl(opts.baseUrl, "chat/completions"), {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: opts.model,
        messages: [{ role: "user", content: opts.prompt }],
        temperature: 0.3,
        max_tokens: 256,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`hint http ${res.status}`);
    }

    const json = (await res.json()) as OpenAIChatResponse;
    const text = json.choices?.[0]?.message?.content?.trim() ?? "";
    if (!text) {
      throw new Error("empty hint");
    }

    return {
      text,
      tokensIn: json.usage?.prompt_tokens ?? 0,
      tokensOut: json.usage?.completion_tokens ?? 0,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function openaiModelsHealth(
  baseUrl: string,
  apiKey?: string,
  timeoutMs = 2000,
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = {};
    if (apiKey) {
      headers.authorization = `Bearer ${apiKey}`;
    }
    const res = await fetch(joinUrl(baseUrl, "models"), {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
