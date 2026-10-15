// Applies the migrations in db/migrations with dbmate, from decision 0022.
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { resolveBinary } from 'dbmate';

export const migrationsDir = path.join(
  import.meta.dirname,
  '..',
  'db',
  'migrations',
);

// Runs `dbmate up` against the database, creating it if it doesn't exist.
export async function migrate(databasePath: string): Promise<void> {
  try {
    await promisify(execFile)(
      resolveBinary(),
      [
        '--url',
        `sqlite:${encodeURI(databasePath)}`,
        '--migrations-dir',
        migrationsDir,
        // Writing db/schema.sql needs the sqlite3 tool, and the schema isn't
        // committed yet (0022's follow-ups).
        '--no-dump-schema',
        'up',
      ],
      // dbmate reads a .env file from its working directory, so it runs where
      // there isn't one.
      { cwd: migrationsDir },
    );
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    throw new Error(
      `Couldn't migrate the database ${databasePath}${stderr ? `: ${stderr}` : '.'}`,
      { cause: error },
    );
  }
}
