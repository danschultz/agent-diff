// Placeholder for the hello world scaffolding: calls `hello` with the name
// `world` and shows its message. Remove it when real features land.
import { useEffect, useState } from 'react';
import { ORPCError } from '@orpc/client';
import { client } from './client.ts';
import { savedToken } from './token.ts';

type Greeting =
  | { status: 'loading' }
  | { status: 'done'; message: string }
  | { status: 'failed'; error: string }
  // There's no saved token, or the review server rejected it (decision 0031).
  | { status: 'unauthorized' };

export function App() {
  const [greeting, setGreeting] = useState<Greeting>(() =>
    savedToken() ? { status: 'loading' } : { status: 'unauthorized' },
  );

  useEffect(() => {
    if (!savedToken()) return;
    const controller = new AbortController();
    client
      .hello({ name: 'world' }, { signal: controller.signal })
      .then(({ message }) => setGreeting({ status: 'done', message }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof ORPCError && error.status === 401) {
          setGreeting({ status: 'unauthorized' });
          return;
        }
        setGreeting({
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        });
      });
    return () => controller.abort();
  }, []);

  switch (greeting.status) {
    case 'loading':
      return <p>Loading…</p>;
    case 'done':
      return <h1>{greeting.message}</h1>;
    case 'unauthorized':
      return (
        <p role="alert">
          Open the link printed by <code>agent-diff server start</code>.
        </p>
      );
    case 'failed':
      return (
        <p role="alert">Couldn't reach the review server: {greeting.error}</p>
      );
  }
}
