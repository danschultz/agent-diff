import sqlite3 from 'sqlite3';
import { run, type Driver } from './workload.ts';

let db: sqlite3.Database;
let insert: sqlite3.Statement;
let select: sqlite3.Statement;

const call = (fn: (done: (error: Error | null) => void) => void) =>
  new Promise<void>((resolve, reject) =>
    fn((error) => (error ? reject(error) : resolve())),
  );

const driver: Driver = {
  open: (file) =>
    new Promise<void>((resolve, reject) => {
      db = new sqlite3.Database(file, (error) =>
        error ? reject(error) : resolve(),
      );
    }),
  async exec(sql) {
    await call((done) => db.exec(sql, done));
    insert = db.prepare(
      'insert into comments (id, review_session_id, path, start_line, end_line, body) values (?, ?, ?, ?, ?, ?)',
    );
    select = db.prepare(
      'select * from comments where review_session_id = ? order by start_line',
    );
  },
  async insertMany(rows) {
    await call((done) => db.exec('begin', done));
    for (const r of rows) await call((done) => insert.run(r, done));
    await call((done) => db.exec('commit', done));
  },
  insertOne: (r) => call((done) => insert.run(r, done)),
  select: (id) =>
    new Promise<unknown[]>((resolve, reject) =>
      select.all([id], (error, rows) =>
        error ? reject(error) : resolve(rows),
      ),
    ),
  async close() {
    await call((done) => insert.finalize(done));
    await call((done) => select.finalize(done));
    await call((done) => db.close(done));
  },
};

await run('sqlite3', driver);
