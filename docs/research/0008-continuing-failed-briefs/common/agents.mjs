// Reads the JSON from `claude agents --json [--all]` on stdin and prints one
// tab-separated line per agent session: short ID, session ID, state, status,
// name, cwd. Missing fields print as "-".
let input = '';
for await (const chunk of process.stdin) input += chunk;
for (const a of JSON.parse(input || '[]'))
  console.log(
    [a.id, a.sessionId, a.state, a.status, a.name, a.cwd]
      .map((v) => v ?? '-')
      .join('\t'),
  );
