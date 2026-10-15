// Port, token, and the checks every example applies to /api requests:
// the Host header must be the server's own, and the token must match.
export const port = Number(process.env.PORT ?? 4317);
export const token = process.env.AGENT_DIFF_TOKEN ?? 'dev-token';
export const baseUrl = `http://127.0.0.1:${port}`;

const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

/** Returns an error status and message, or undefined when the request may proceed. */
export function checkRequest(
  host: string | undefined | null,
  authorization: string | undefined | null,
): { status: 401 | 403; error: string } | undefined {
  if (!host || !allowedHosts.has(host))
    return { status: 403, error: 'Unexpected Host header' };
  if (authorization !== `Bearer ${token}`)
    return { status: 401, error: 'Missing or wrong token' };
  return undefined;
}
