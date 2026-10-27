// A session's All changes diff, from decision 0045: one continuous diff of
// every changed file, grouped by working directory in the order they were
// added, and sorted by path in each, as the review server returns them.
// Working directories that don't use git, are missing, have no changes, or
// whose changes couldn't be worked out say so instead.
import { useSuspenseQuery } from '@tanstack/react-query';
import type { WorkingDirectoryDiff } from '@agent-diff/shared/schemas';
import { orpc } from '../client.ts';
import { FileDiff } from './FileDiff.tsx';

function WorkingDirectoryChanges({
  sessionId,
  diff,
}: {
  sessionId: string;
  diff: WorkingDirectoryDiff;
}) {
  let content;
  if (diff.kind === 'no_git') {
    content = (
      <p className="working-directory-note">
        This working directory doesn't use git, so it has no diff, and its files
        aren't listed yet.
      </p>
    );
  } else if (diff.kind === 'missing') {
    content = (
      <p className="working-directory-note">
        This working directory doesn't exist anymore.
      </p>
    );
  } else if (diff.kind === 'error') {
    content = <p className="working-directory-note error">{diff.message}</p>;
  } else if (diff.files.length === 0) {
    content = <p className="working-directory-note">No changes.</p>;
  } else {
    content = diff.files.map((file) => (
      <FileDiff
        key={file.path}
        sessionId={sessionId}
        workingDirectory={diff.path}
        file={file}
      />
    ));
  }
  return (
    <section className="working-directory-changes" aria-label={diff.path}>
      <h3>
        <code>{diff.path}</code>
      </h3>
      {content}
    </section>
  );
}

// The route's loader has loaded the file lists, or failed, before this
// renders.
export function SessionDiff({ sessionId }: { sessionId: string }) {
  const { data } = useSuspenseQuery(
    orpc.diff.files.queryOptions({ input: { sessionId, mode: 'all' } }),
  );
  return (
    <section className="session-diff" aria-labelledby="changes-heading">
      <h2 id="changes-heading">Changes</h2>
      {data.workingDirectories.map((diff) => (
        <WorkingDirectoryChanges
          key={diff.path}
          sessionId={sessionId}
          diff={diff}
        />
      ))}
    </section>
  );
}
