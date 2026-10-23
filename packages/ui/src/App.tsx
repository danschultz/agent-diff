// The review UI's only page is a session, at `/sessions/<id>` (decision
// 0040). Every other path shows the not-found message. Routing reads
// `location.pathname`, with no router library.
import { NotFound } from './NotFound.tsx';
import { SessionPage } from './SessionPage.tsx';

const sessionPath = /^\/sessions\/([^/]+)$/;

// The session ID in the path, or undefined when the path isn't a session's.
function sessionIdFromPath(pathname: string): string | undefined {
  const match = sessionPath.exec(pathname);
  if (!match) return undefined;
  try {
    return decodeURIComponent(match[1]!);
  } catch {
    return undefined;
  }
}

export function App() {
  const id = sessionIdFromPath(window.location.pathname);
  return id === undefined ? <NotFound /> : <SessionPage id={id} />;
}
