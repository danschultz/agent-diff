import Database from 'libsql';
import { run, type Driver, type Row } from './workload.ts';

let db: Database.Database;
let insert: Database.Statement<Row>;
let select: Database.Statement<[string]>;

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
    db.transaction(() => {
      for (const r of rows) insert.run(...r);
    })();
  },
  insertOne(r) {
    insert.run(...r);
  },
  select: (id) => select.all(id),
  close: () => void db.close(),
};

await run('libsql', driver);
