export interface Env {
  DB: D1Database;
  SESSIONS: KVNamespace;
  MEDIA: R2Bucket;
  ASSETS?: Fetcher;
  AI?: Ai;
  AUTH_LIMITER?: RateLimit;
  SUBMIT_LIMITER?: RateLimit;
  OPENROUTER_API_KEY?: string;
  GEMINI_API_KEY_1?: string;
  GEMINI_API_KEY_2?: string;
  GROQ_API_KEY_1?: string;
  GROQ_API_KEY_2?: string;
}
