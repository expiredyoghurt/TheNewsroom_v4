export interface PromptPair { system: string; user: string }

export interface GradingProvider {
  id: string;        // "openrouter" | "gemini-1" | ... (what gets persisted)
  model: string;
  run(prompt: PromptPair, signal: AbortSignal): Promise<string>;
}

export interface ProviderAttempt { provider: string; model: string; ok: boolean; error?: string; ms: number }

export interface ChainResult<G> {
  grade: G;
  outcome: "ai" | "fallback";
  provider: string;
  model: string;
  attempts: ProviderAttempt[];
  /** Why the non-AI fallback was used (null when an AI provider succeeded). */
  fallbackReason: string | null;
  latencyMs: number;
}

export const FALLBACK_PROVIDER = { provider: "keyword-fallback", model: "heuristic-v1" } as const;
