// Runs the same workload against a driver and prints the time for each phase.
// Each driver file exports a Driver; this file is copied next to it.
import { rmSync } from 'node:fs';

export type Row = [
  id: string,
  reviewSessionId: string,
  path: string,
  startLine: number,
  endLine: number,
  body: string,
];

export interface Driver {
  open(file: string): Promise<void> | void;
  exec(sql: string): Promise<void> | void;
  /** Inserts every row in one transaction. */
  insertMany(rows: Row[]): Promise<void> | void;
  /** Inserts one row in its own transaction. */
  insertOne(row: Row): Promise<void> | void;
  /** Returns the comments for a review session, ordered by start line. */
  select(reviewSessionId: string): Promise<unknown[]> | unknown[];
  close(): Promise<void> | void;
}

const SCHEMA = `
  pragma journal_mode = wal;
  pragma synchronous = normal;
  create table comments (
    id text primary key, review_session_id text not null, path text not null,
    start_line integer not null, end_line integer not null, body text not null);
  create index comments_by_session on comments (review_session_id, start_line);
`;

const row = (i: number): Row => [
  `c${i}`,
  `rs${i % 100}`,
  `src/file${i % 37}.ts`,
  i % 500,
  (i % 500) + 3,
  `Comment number ${i}: please rename this variable.`,
];

export async function run(name: string, driver: Driver): Promise<void> {
  const results: Record<string, number[]> = { bulk: [], single: [], read: [] };
  for (let round = 0; round < 3; round++) {
    const file = `${process.env.BENCH_DIR ?? import.meta.dirname}/bench.db`;
    for (const suffix of ['', '-wal', '-shm'])
      rmSync(file + suffix, { force: true });
    await driver.open(file);
    await driver.exec(SCHEMA);

    let start = performance.now();
    await driver.insertMany(Array.from({ length: 10_000 }, (_, i) => row(i)));
    results.bulk!.push(performance.now() - start);

    start = performance.now();
    for (let i = 10_000; i < 12_000; i++) await driver.insertOne(row(i));
    results.single!.push(performance.now() - start);

    start = performance.now();
    let count = 0;
    for (let i = 0; i < 2_000; i++)
      count += (await driver.select(`rs${i % 100}`)).length;
    results.read!.push(performance.now() - start);
    if (count !== 2_000 * 120) throw new Error(`${name}: read ${count} rows`);
    await driver.close();
  }
  const median = (xs: number[]) => xs.sort((a, b) => a - b)[1]!.toFixed(0);
  console.log(
    `${name}\tbulk ${median(results.bulk!)} ms\tsingle ${median(results.single!)} ms\tread ${median(results.read!)} ms`,
  );
}
