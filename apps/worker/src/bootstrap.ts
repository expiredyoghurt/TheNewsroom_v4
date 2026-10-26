// First-admin bootstrap, used by scripts/setup.ts. Pure SQL generation so it is unit/integration tested.
// Idempotent: inserts nothing if ANY admin already exists, so `npm run setup` is safe to re-run.
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

export function adminBootstrapSql(a: { username: string; name: string; passwordHash: string }): string {
  if (!/^[A-Za-z0-9._@-]{3,64}$/.test(a.username)) throw new Error("Admin username must be 3-64 characters: letters, digits and . _ @ -");
  return `INSERT INTO teachers (username, name, password_hash, role) SELECT ${q(a.username)}, ${q(a.name)}, ${q(a.passwordHash)}, 'admin' WHERE NOT EXISTS (SELECT 1 FROM teachers WHERE role = 'admin');`;
}
