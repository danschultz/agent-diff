// Placeholder for the hello world scaffolding: calls `hello` with the name
// `world` and shows its message. Remove it when real features land.
import { useEffect, useState } from 'react';
import { client } from './client.ts';

type Greeting =
  | { status: 'loading' }
  | { status: 'done'; message: string }
  | { status: 'failed'; error: string };

export function App() {
  const [greeting, setGreeting] = useState<Greeting>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    client
      .hello({ name: 'world' }, { signal: controller.signal })
      .then(({ message }) => setGreeting({ status: 'done', message }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
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
    case 'failed':
      return (
        <p role="alert">Couldn't reach the review server: {greeting.error}</p>
      );
  }
}
