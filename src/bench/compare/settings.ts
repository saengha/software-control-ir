/**
 * Live compare uses one model for both policies. Splitting models would
 * measure Claude vs GPT, not structured IR vs screenshots.
 */
export const COMPARE_LIVE_MODEL = process.env.SCIR_COMPARE_MODEL ?? "claude-sonnet-4-5";

export const COMPARE_REPEATS = 5;

/** After this many tool calls, host_drift mutates the document out of band. */
export const HOST_DRIFT_AFTER_STEPS = 3;

export const COMPARE_DRIVERS = ["scripted", "live"] as const;
export type CompareDriver = (typeof COMPARE_DRIVERS)[number];

export const COMPARE_PROVIDERS = ["anthropic", "gemini"] as const;
export type CompareProvider = (typeof COMPARE_PROVIDERS)[number];

function firstEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.length > 0) return value;
  }
  return undefined;
}

export function compareProvider(): CompareProvider {
  const explicit = process.env.SCIR_COMPARE_PROVIDER?.trim().toLowerCase();
  if (explicit === "gemini" || explicit === "google") return "gemini";
  if (explicit === "anthropic") return "anthropic";
  const model = (process.env.SCIR_COMPARE_MODEL ?? COMPARE_LIVE_MODEL).toLowerCase();
  if (model.startsWith("gemini")) return "gemini";
  if (firstEnv("GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "SCIR_GEMINI_API_KEY")) {
    if (!firstEnv("ANTHROPIC_API_KEY", "SCIR_ANTHROPIC_API_KEY")) return "gemini";
  }
  return "anthropic";
}

export function liveApiKey(): string | undefined {
  if (compareProvider() === "gemini") {
    return firstEnv("GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "SCIR_GEMINI_API_KEY");
  }
  return firstEnv("ANTHROPIC_API_KEY", "SCIR_ANTHROPIC_API_KEY");
}
