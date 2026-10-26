// The fallback chain: try each configured provider in order, validate its output, and finish with a
// deterministic non-AI grader. A submission is never rejected because providers are down.
import type { ChainResult, GradingProvider, ProviderAttempt, PromptPair } from "./types";
import { FALLBACK_PROVIDER } from "./types";

export interface ChainOptions<G> {
  providers: readonly GradingProvider[];
  prompt: PromptPair;
  /** Parse + validate + clamp raw model text. Throw to reject (counts as a provider failure). */
  parse: (text: string) => G;
  /** Deterministic non-AI grade. */
  fallback: () => G;
  perProviderMs?: number;
  /** Total time budget across all providers. */
  deadlineMs?: number;
  clock?: () => number;
}

function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const ac = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, rej) => { timer = setTimeout(() => { ac.abort(); rej(new Error(`timed out after ${ms}ms`)); }, ms); });
  return Promise.race([run(ac.signal), timeout]).finally(() => clearTimeout(timer));
}

export async function runChain<G>(o: ChainOptions<G>): Promise<ChainResult<G>> {
  const clock = o.clock ?? Date.now;
  const perProvider = o.perProviderMs ?? 8000;
  const deadline = o.deadlineMs ?? 20000;
  const t0 = clock();
  const attempts: ProviderAttempt[] = [];

  if (o.providers.length === 0) {
    return { grade: o.fallback(), outcome: "fallback", ...FALLBACK_PROVIDER, attempts, fallbackReason: "no_providers_configured", latencyMs: clock() - t0 };
  }
  for (const p of o.providers) {
    const remaining = deadline - (clock() - t0);
    if (remaining < 1000) {
      return { grade: o.fallback(), outcome: "fallback", ...FALLBACK_PROVIDER, attempts, fallbackReason: "deadline_exceeded", latencyMs: clock() - t0 };
    }
    const started = clock();
    try {
      const text = await withTimeout((signal) => p.run(o.prompt, signal), Math.min(perProvider, remaining));
      const grade = o.parse(text);
      attempts.push({ provider: p.id, model: p.model, ok: true, ms: clock() - started });
      return { grade, outcome: "ai", provider: p.id, model: p.model, attempts, fallbackReason: null, latencyMs: clock() - t0 };
    } catch (e) {
      attempts.push({ provider: p.id, model: p.model, ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 200), ms: clock() - started });
    }
  }
  return { grade: o.fallback(), outcome: "fallback", ...FALLBACK_PROVIDER, attempts, fallbackReason: "all_providers_failed", latencyMs: clock() - t0 };
}
