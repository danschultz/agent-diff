import sqlite, { type Statement } from 'node-sqlite3-wasm';
import { run, type Driver } from './workload.ts';

const { Database } = sqlite;
let db: InstanceType<typeof Database>;
let insert: Statement;
let select: Statement;

const driver: Driver = {
  open(file) {
    db = new Database(file);
  },
  exec(sql) {
    db.exec(sql);
    insert = db.prepare(
      'insert into comments (id, review_session_id, path, start_line, end_line, body) values (?, ?, ?, ?, ?, ?)',
    );
    select = db.prepare(
      'select * from comments where review_session_id = ? order by start_line',
    );
  },
  insertMany(rows) {
    db.exec('begin');
    for (const r of rows) insert.run(r);
    db.exec('commit');
  },
  insertOne(r) {
    insert.run(r);
  },
  select: (id) => select.all([id]),
  close() {
    insert.finalize();
    select.finalize();
    db.close();
  },
};

await run('node-sqlite3-wasm', driver);
