// An ISO 8601 timestamp in the reader's locale and time zone.
export function Time({ value }: { value: string }) {
  return <time dateTime={value}>{new Date(value).toLocaleString()}</time>;
}
