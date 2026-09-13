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

export function liveApiKey(): string | undefined {
  const key = process.env.ANTHROPIC_API_KEY ?? process.env.SCIR_ANTHROPIC_API_KEY;
  return key && key.length > 0 ? key : undefined;
}
