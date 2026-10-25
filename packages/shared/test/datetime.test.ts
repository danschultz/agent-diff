import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';

const datetime = path.join(import.meta.dirname, '..', 'src', 'datetime.ts');

// Formats the timestamp in a child process with the locale and time zone
// given, since both are read when the process starts.
function format(iso: string, lang: string, tz: string): string {
  return execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `import { localDateTime } from ${JSON.stringify(datetime)};
      process.stdout.write(localDateTime(${JSON.stringify(iso)}));`,
    ],
    { env: { PATH: process.env.PATH, LANG: lang, TZ: tz }, encoding: 'utf8' },
  );
}

test('localDateTime formats a timestamp to the minute in the local time zone and locale', () => {
  const iso = '2026-10-22T08:33:59.999Z';
  assert.equal(
    format(iso, 'en_US.UTF-8', 'Asia/Kolkata'),
    '10/22/2026, 2:03 PM',
  );
  assert.equal(format(iso, 'en_GB.UTF-8', 'Asia/Kolkata'), '22/10/2026, 14:03');
  assert.equal(format(iso, 'en_US.UTF-8', 'UTC'), '10/22/2026, 8:33 AM');
});
