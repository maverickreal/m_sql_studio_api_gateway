import { envVars } from "../../config";

export function isLoopbackUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "[::1]" ||
      hostname === "0.0.0.0" ||
      hostname === "host.docker.internal"
    );
  } catch {
    return false;
  }
}

export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

export async function checkProviderHealth(
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

export interface HintHealthResult {
  ollama: "up" | "down";
  gemini: "up" | "down" | "unconfigured";
  enabled: boolean;
}

export async function getHintHealth(): Promise<HintHealthResult> {
  if (envVars.HINT_ENABLED !== "true") {
    return { ollama: "down", gemini: "unconfigured", enabled: false };
  }

  const localUrl =
    envVars.AI_API_URL || envVars.HINT_API_URL || "http://127.0.0.1:3208/v1";
  const isLoopback = isLoopbackUrl(localUrl);

  const ollamaPromise = isLoopback
    ? checkProviderHealth(localUrl, envVars.AI_API_KEY || envVars.HINT_API_KEY)
    : Promise.resolve(false);

  const geminiConfigured = Boolean(
    (envVars.HINT_ALLOW_REMOTE === "true" &&
      envVars.HINT_REMOTE_API_KEY &&
      envVars.HINT_REMOTE_API_URL) ||
      (envVars.AI_PROVIDER === "google" &&
        (envVars.AI_API_KEY ||
          process.env.GOOGLE_API_KEY ||
          process.env.GEMINI_API_KEY)),
  );

  let geminiPromise: Promise<"up" | "down" | "unconfigured">;
  if (!geminiConfigured) {
    geminiPromise = Promise.resolve("unconfigured");
  } else {
    const geminiUrl =
      envVars.HINT_REMOTE_API_URL ||
      "https://generativelanguage.googleapis.com/v1beta/openai";
    const geminiKey =
      envVars.HINT_REMOTE_API_KEY ||
      envVars.AI_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      process.env.GEMINI_API_KEY;
    geminiPromise = checkProviderHealth(geminiUrl, geminiKey).then((ok) =>
      ok ? "up" : "down",
    );
  }

  const [ollamaOk, geminiStatus] = await Promise.all([
    ollamaPromise,
    geminiPromise,
  ]);

  return {
    ollama: ollamaOk ? "up" : "down",
    gemini: geminiStatus,
    enabled: true,
  };
}
