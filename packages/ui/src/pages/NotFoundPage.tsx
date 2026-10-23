// Shown for an unknown or malformed session ID, and for every path that isn't
// a session's.
export function NotFoundPage() {
  return (
    <main>
      <p role="alert">There's no session at this address.</p>
    </main>
  );
}
