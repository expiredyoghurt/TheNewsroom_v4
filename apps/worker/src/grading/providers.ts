import type { Env } from "../env";
import type { GradingProvider, PromptPair } from "./types";

async function postJson(url: string, init: { headers: Record<string, string>; body: unknown }, signal: AbortSignal): Promise<any> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...init.headers }, body: JSON.stringify(init.body), signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
const chatBody = (model: string, p: PromptPair, extra: object = {}) => ({
  model, temperature: 0.1, max_tokens: 1200, messages: [{ role: "system", content: p.system }, { role: "user", content: p.user }], ...extra,
});

/** Providers that are actually configured, in priority order. Unconfigured ones are skipped silently. */
export function buildProviders(env: Env & Record<string, unknown>): GradingProvider[] {
  const out: GradingProvider[] = [];
  const orModel = (env.OPENROUTER_GRADER_MODEL as string) || "openrouter/free";
  const geminiModel = (env.GEMINI_GRADER_MODEL as string) || "gemini-2.5-flash";
  const groqModel = (env.GROQ_GRADER_MODEL as string) || "llama-3.3-70b-versatile";
  const waiModel = (env.WORKERS_AI_GRADER_MODEL as string) || "@cf/meta/llama-3.1-8b-instruct";

  if (env.OPENROUTER_API_KEY) {
    // Free-only on purpose: grading must never spend credits.
    if (orModel === "openrouter/free" || orModel.endsWith(":free")) {
      out.push({ id: "openrouter", model: orModel, async run(p, signal) {
        const d = await postJson("https://openrouter.ai/api/v1/chat/completions", { headers: { authorization: `Bearer ${env.OPENROUTER_API_KEY}`, "X-Title": "The Newsroom" }, body: chatBody(orModel, p) }, signal);
        return d.choices?.[0]?.message?.content ?? "";
      } });
    }
  }
  for (const [id, key] of [["gemini-1", env.GEMINI_API_KEY_1], ["gemini-2", env.GEMINI_API_KEY_2]] as const) {
    if (!key) continue;
    out.push({ id, model: geminiModel, async run(p, signal) {
      const d = await postJson(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel)}:generateContent`, {
        headers: { "x-goog-api-key": key },
        body: { systemInstruction: { parts: [{ text: p.system }] }, contents: [{ role: "user", parts: [{ text: p.user }] }], generationConfig: { temperature: 0.1, maxOutputTokens: 1200, responseMimeType: "application/json" } },
      }, signal);
      return (d.candidates?.[0]?.content?.parts ?? []).map((x: { text?: string }) => x.text ?? "").join("");
    } });
  }
  for (const [id, key] of [["groq-1", env.GROQ_API_KEY_1], ["groq-2", env.GROQ_API_KEY_2]] as const) {
    if (!key) continue;
    out.push({ id, model: groqModel, async run(p, signal) {
      const d = await postJson("https://api.groq.com/openai/v1/chat/completions", { headers: { authorization: `Bearer ${key}` }, body: chatBody(groqModel, p, { response_format: { type: "json_object" } }) }, signal);
      return d.choices?.[0]?.message?.content ?? "";
    } });
  }
  if (env.AI) {
    const ai = env.AI;
    out.push({ id: "workers-ai", model: waiModel, async run(p) {
      const r: any = await ai.run(waiModel as any, { messages: [{ role: "system", content: p.system }, { role: "user", content: p.user }] } as any);
      return typeof r?.response === "string" ? r.response : JSON.stringify(r?.response ?? r ?? "");
    } });
  }
  return out;
}
