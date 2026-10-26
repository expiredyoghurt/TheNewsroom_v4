// Thin D1 wrapper whose only extra job is COUNTING ROUND TRIPS. Tests assert that list endpoints
// issue a bounded number of round trips no matter how many rows exist (the N+1 guard), and the
// access log records the count per request.

export class Db {
  /** Round trips to the database in this instance's lifetime (a batch counts as ONE). */
  roundTrips = 0;
  constructor(readonly d1: D1Database) {}

  /** Build a statement (no round trip yet). Use with batch(). */
  stmt(sql: string, ...binds: unknown[]): D1PreparedStatement {
    return this.d1.prepare(sql).bind(...binds);
  }
  async all<T>(sql: string, ...binds: unknown[]): Promise<T[]> {
    this.roundTrips++;
    const r = await this.d1.prepare(sql).bind(...binds).all<T>();
    return r.results ?? [];
  }
  async first<T>(sql: string, ...binds: unknown[]): Promise<T | null> {
    this.roundTrips++;
    return (await this.d1.prepare(sql).bind(...binds).first<T>()) ?? null;
  }
  async run(sql: string, ...binds: unknown[]): Promise<D1Result> {
    this.roundTrips++;
    return this.d1.prepare(sql).bind(...binds).run();
  }
  /** All statements execute atomically in ONE round trip (D1 batch = a transaction). */
  async batch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
    if (statements.length === 0) return [];
    this.roundTrips++;
    return this.d1.batch(statements);
  }
}

export const nowIso = (d: Date = new Date()): string => d.toISOString();
