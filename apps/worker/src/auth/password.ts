// PBKDF2-SHA256 via WebCrypto. Workers cap PBKDF2 at 100,000 iterations, so that is the value.
// Used by the Worker AND by scripts/setup.ts (admin bootstrap), so there is one implementation.
const MAX_ITERATIONS = 100_000;
let ITERATIONS = MAX_ITERATIONS;
/** TEST ONLY: lower the PBKDF2 cost so the suite is fast. Production never calls this. */
export function setPbkdf2IterationsForTests(n: number): void { ITERATIONS = Math.min(Math.max(1, n), MAX_ITERATIONS); }
const enc = new TextEncoder();

const toB64 = (b: ArrayBuffer | Uint8Array): string => {
  const u = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = ""; for (const x of u) s += String.fromCharCode(x);
  return btoa(s);
};
const fromB64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITERATIONS}$${toB64(salt)}$${toB64(await derive(password, salt, ITERATIONS))}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > MAX_ITERATIONS) return false;
  const expected = fromB64(parts[3]!);
  const actual = new Uint8Array(await derive(password, fromB64(parts[2]!), iterations));
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i]! ^ expected[i]!;
  return diff === 0;
}

/** A hash of a throwaway password: verified against when the account doesn't exist, so timing doesn't reveal it. */
export const DUMMY_HASH_PROMISE = (() => { let p: Promise<string> | null = null; return () => (p ??= hashPassword("not-a-real-password")); })();
