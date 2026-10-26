// Shows one session as the API returned it when the page loaded: its title
// and ID, whether it's active or archived, when it was created, its working
// directories with their base refs, and the diff of every changed file, with
// the comment panel on the right. Archived sessions show the current diff,
// the same as active ones. The file view will go on the left of the diff.
import { useSuspenseQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { orpc } from '../client.ts';
import { CommentPanel } from '../components/CommentPanel.tsx';
import { SessionDiff } from '../components/SessionDiff.tsx';
import { Time } from '../components/Time.tsx';

const route = getRouteApi('/sessions/$id');

// The route's loader has loaded the session, or failed, before this renders.
export function SessionPage() {
  const { id } = route.useParams();
  const { data: session } = useSuspenseQuery(
    orpc.session.show.queryOptions({ input: { id } }),
  );
  return (
    <div className="session-page">
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
        <h2 id="working-directories-heading">Working directories</h2>
        <ul aria-labelledby="working-directories-heading">
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
        <SessionDiff sessionId={session.id} />
      </main>
      <CommentPanel
        sessionId={session.id}
        archived={session.archivedAt !== null}
      />
    </div>
  );
}
