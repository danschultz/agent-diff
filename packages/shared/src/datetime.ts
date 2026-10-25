// Formats timestamps for people and agents to read.

const fmt = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

// An ISO 8601 timestamp to the minute, in the local time zone and locale, such
// as `10/22/2026, 2:03 PM` in en-US.
export function localDateTime(iso: string): string {
  return fmt.format(new Date(iso));
}
