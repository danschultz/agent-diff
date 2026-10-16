// Reads and writes the database with node:sqlite and plain SQL, from decision
// 0022. The review server is the only process that opens it (0023).
import { DatabaseSync } from 'node:sqlite';

export class Store {
  #db: DatabaseSync;

  constructor(databasePath: string) {
    this.#db = new DatabaseSync(databasePath);
  }

  // Placeholder for the hello world scaffolding. Adds a row to `greetings`
  // and returns how many rows it has. Remove it when real features land.
  addGreeting(name: string): number {
    this.#db.prepare('INSERT INTO greetings (name) VALUES (?)').run(name);
    const row = this.#db
      .prepare('SELECT count(*) AS count FROM greetings')
      .get() as { count: number };
    return row.count;
  }

  close(): void {
    this.#db.close();
  }
}
