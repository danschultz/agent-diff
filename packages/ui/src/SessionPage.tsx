// Shows one session as the API returned it when the page loaded: its title
// and ID, whether it's active or archived, when it was created, and its
// working directories with their base refs.
import { useEffect, useState } from 'react';
import { ORPCError } from '@orpc/client';
import type { SessionDetails } from '@agent-diff/shared/schemas';
import { NotFound } from './NotFound.tsx';
import { client } from './client.ts';
import { savedToken } from './token.ts';

type State =
  | { status: 'loading' }
  | { status: 'done'; session: SessionDetails }
  | { status: 'not-found' }
  | { status: 'failed'; error: string }
  // There's no saved token, or the review server rejected it (decision 0031).
  | { status: 'unauthorized' };

// An ISO 8601 timestamp in the reader's locale and time zone.
function Time({ value }: { value: string }) {
  return <time dateTime={value}>{new Date(value).toLocaleString()}</time>;
}

export function SessionPage({ id }: { id: string }) {
  const [state, setState] = useState<State>(() =>
    savedToken() ? { status: 'loading' } : { status: 'unauthorized' },
  );

  useEffect(() => {
    if (!savedToken()) return;
    const controller = new AbortController();
    client.session
      .show({ id }, { signal: controller.signal })
      .then((session) => setState({ status: 'done', session }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof ORPCError && error.status === 401) {
          setState({ status: 'unauthorized' });
        } else if (error instanceof ORPCError && error.code === 'NOT_FOUND') {
          setState({ status: 'not-found' });
        } else {
          setState({
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
    return () => controller.abort();
  }, [id]);

  switch (state.status) {
    case 'loading':
      return <p>Loading…</p>;
    case 'not-found':
      return <NotFound />;
    case 'unauthorized':
      return (
        <p role="alert">
          Open the link printed by <code>agent-diff session new</code> or{' '}
          <code>agent-diff session show</code>.
        </p>
      );
    case 'failed':
      return (
        <p role="alert">Couldn't reach the review server: {state.error}</p>
      );
    case 'done': {
      const { session } = state;
      return (
        <main>
          <h1>{session.title ?? `Session ${session.id}`}</h1>
          <dl>
            <dt>ID</dt>
            <dd>
              <code>{session.id}</code>
            </dd>
            <dt>Status</dt>
            <dd data-testid="status">
              {session.archivedAt === null ? (
                'Active'
              ) : (
                <>
                  Archived on <Time value={session.archivedAt} />
                </>
              )}
            </dd>
            <dt>Created</dt>
            <dd data-testid="created">
              <Time value={session.createdAt} />
            </dd>
          </dl>
          <h2>Working directories</h2>
          <ul>
            {session.workingDirectories.map((workingDirectory) => (
              <li key={workingDirectory.path}>
                <code>{workingDirectory.path}</code>{' '}
                {workingDirectory.baseRef === null ? (
                  "doesn't use git"
                ) : (
                  <>
                    base ref <code>{workingDirectory.baseRef}</code>
                  </>
                )}
              </li>
            ))}
          </ul>
        </main>
      );
    }
  }
}
