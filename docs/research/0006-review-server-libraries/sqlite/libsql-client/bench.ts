import { createClient, type Client } from '@libsql/client';
import { run, type Driver } from './workload.ts';

let db: Client;

const driver: Driver = {
  open(file) {
    db = createClient({ url: `file:${file}` });
  },
  async exec(sql) {
    await db.executeMultiple(sql);
  },
  async insertMany(rows) {
    await db.batch(
      rows.map((args) => ({
        sql: 'insert into comments (id, review_session_id, path, start_line, end_line, body) values (?, ?, ?, ?, ?, ?)',
        args,
      })),
      'write',
    );
  },
  async insertOne(args) {
    await db.execute({
      sql: 'insert into comments (id, review_session_id, path, start_line, end_line, body) values (?, ?, ?, ?, ?, ?)',
      args,
    });
  },
  select: async (id) =>
    (
      await db.execute({
        sql: 'select * from comments where review_session_id = ? order by start_line',
        args: [id],
      })
    ).rows,
  close: () => db.close(),
};

await run('@libsql/client', driver);
