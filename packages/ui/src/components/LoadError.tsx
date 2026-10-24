// Shown when a route's loader fails: without a saved token, when the review
// server rejected it (decision 0031), or when the review server couldn't be
// reached. An unknown session is the not-found page instead.
import { ORPCError } from '@orpc/client';
import type { ErrorComponentProps } from '@tanstack/react-router';

// Thrown by a loader when there's no saved token, before it calls the API.
export class NoTokenError extends Error {
  constructor() {
    super('There is no saved token.');
  }
}

export function LoadError({ error }: ErrorComponentProps) {
  if (
    error instanceof NoTokenError ||
    (error instanceof ORPCError && error.status === 401)
  ) {
    return (
      <p role="alert">
        Open the link printed by <code>agent-diff session new</code> or{' '}
        <code>agent-diff session show</code>.
      </p>
    );
  }
  return (
    <p role="alert">
      Couldn't reach the review server:{' '}
      {error instanceof Error ? error.message : String(error)}
    </p>
  );
}
