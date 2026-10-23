// Shows one session as the API returned it when the page loaded: its title
// and ID, whether it's active or archived, when it was created, and its
// working directories with their base refs.
import { useSuspenseQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { orpc } from '../client.ts';
import { Time } from '../components/Time.tsx';

const route = getRouteApi('/sessions/$id');

// The route's loader has loaded the session, or failed, before this renders.
export function SessionPage() {
  const { id } = route.useParams();
  const { data: session } = useSuspenseQuery(
    orpc.session.show.queryOptions({ input: { id } }),
  );
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
