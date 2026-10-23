// Shows one session as the API returned it when the page loaded: its title
// and ID, whether it's active or archived, when it was created, and its
// working directories with their base refs.
import { ORPCError } from '@orpc/client';
import { useQuery } from '@tanstack/react-query';
import { NotFound } from './NotFound.tsx';
import { orpc } from './client.ts';
import { Time } from './components/Time.tsx';
import { savedToken } from './token.ts';

export function SessionPage({ id }: { id: string }) {
  const hasToken = savedToken() !== null;
  const { data: session, error } = useQuery({
    ...orpc.session.show.queryOptions({ input: { id } }),
    enabled: hasToken,
  });

  // There's no saved token, or the review server rejected it (decision 0031).
  if (!hasToken || (error instanceof ORPCError && error.status === 401)) {
    return (
      <p role="alert">
        Open the link printed by <code>agent-diff session new</code> or{' '}
        <code>agent-diff session show</code>.
      </p>
    );
  }
  if (error instanceof ORPCError && error.code === 'NOT_FOUND') {
    return <NotFound />;
  }
  if (error) {
    return (
      <p role="alert">Couldn't reach the review server: {error.message}</p>
    );
  }
  if (!session) return <p>Loading…</p>;
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
