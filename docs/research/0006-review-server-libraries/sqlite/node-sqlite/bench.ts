import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { run, type Driver } from './workload.ts';

let db: DatabaseSync;
let insert: StatementSync;
let select: StatementSync;

const driver: Driver = {
  open(file) {
    db = new DatabaseSync(file);
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
    for (const r of rows) insert.run(...r);
    db.exec('commit');
  },
  insertOne(r) {
    insert.run(...r);
  },
  select: (id) => select.all(id),
  close: () => db.close(),
};

await run('node:sqlite', driver);
