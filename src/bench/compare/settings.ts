/**
 * Live compare uses one model for both policies. Splitting models would
 * measure Claude vs GPT, not structured IR vs screenshots.
 */
export const COMPARE_LIVE_MODEL = process.env.SCIR_COMPARE_MODEL ?? "claude-sonnet-4-5";

export const COMPARE_REPEATS = 5;

/** Unused by the frozen v4 host_drift task (injectWhen). Kept so older notes still resolve. */
export const HOST_DRIFT_AFTER_STEPS = 3;

export const COMPARE_DRIVERS = ["scripted", "live"] as const;
export type CompareDriver = (typeof COMPARE_DRIVERS)[number];

export const COMPARE_PROVIDERS = ["anthropic", "gemini", "openai"] as const;
export type CompareProvider = (typeof COMPARE_PROVIDERS)[number];

function firstEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.length > 0) return value;
  }
  return undefined;
}

export function compareBaseUrl(): string | undefined {
  const value = firstEnv("SCIR_COMPARE_BASE_URL", "OPENAI_BASE_URL");
  return value?.replace(/\/+$/, "");
}

function isLocalOpenAiBase(url: string | undefined): boolean {
  if (!url) return false;
  return /localhost|127\.0\.0\.1|0\.0\.0\.0|::1/i.test(url);
}

export function compareProvider(): CompareProvider {
  const explicit = process.env.SCIR_COMPARE_PROVIDER?.trim().toLowerCase();
  if (explicit === "gemini" || explicit === "google") return "gemini";
  if (explicit === "anthropic") return "anthropic";
  if (explicit === "openai" || explicit === "local" || explicit === "vllm") return "openai";
  if (compareBaseUrl()) return "openai";
  const model = (process.env.SCIR_COMPARE_MODEL ?? COMPARE_LIVE_MODEL).toLowerCase();
  if (model.startsWith("gemini")) return "gemini";
  if (model.startsWith("claude")) return "anthropic";
  if (model.startsWith("gpt-") || model.startsWith("o1") || model.startsWith("o3") || model.startsWith("o4")) {
    return "openai";
  }
  if (firstEnv("GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "SCIR_GEMINI_API_KEY")) {
    if (!firstEnv("ANTHROPIC_API_KEY", "SCIR_ANTHROPIC_API_KEY")) return "gemini";
  }
  return "anthropic";
}

export function liveApiKey(): string | undefined {
  if (compareProvider() === "gemini") {
    return firstEnv("GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "SCIR_GEMINI_API_KEY");
  }
  if (compareProvider() === "openai") {
    const key = firstEnv("OPENAI_API_KEY", "SCIR_COMPARE_API_KEY");
    if (key) return key;
    if (isLocalOpenAiBase(compareBaseUrl())) return "local";
    return undefined;
  }
  return firstEnv("ANTHROPIC_API_KEY", "SCIR_ANTHROPIC_API_KEY");
}
