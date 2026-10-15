// A minimal server-sent events reader for clients without one of their own.
export async function firstEvent(
  url: string,
  headers: Record<string, string>,
  ready: () => void,
): Promise<{ event: string; data: unknown }> {
  const res = await fetch(url, { headers });
  if (!res.ok || !res.body) throw new Error(`events: HTTP ${res.status}`);
  ready();
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let end: number;
    while ((end = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      let event = 'message';
      let data = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      // Returning ends the loop, which cancels the response body.
      if (data) return { event, data: JSON.parse(data) };
    }
  }
  throw new Error('events: stream ended');
}

/** Replaces ids and timestamps so output from different examples can be compared. */
export function normalize(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value)
      .replace(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
        '<id>',
      )
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, '<time>'),
  );
}
