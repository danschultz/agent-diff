// Summarises the JSON `claude -p --output-format json` prints, on stdin: the
// session ID, whether it is an error, the usage, and the start of the reply.
let input = '';
for await (const chunk of process.stdin) input += chunk;
try {
  const r = JSON.parse(input);
  const u = r.usage ?? {};
  console.log(
    `session_id=${r.session_id} is_error=${r.is_error} turns=${r.num_turns} models=${Object.keys(r.modelUsage ?? {}).join(',')} usage: input=${u.input_tokens} cache_creation=${u.cache_creation_input_tokens} cache_read=${u.cache_read_input_tokens} output=${u.output_tokens}`,
  );
  console.log(
    `result: ${JSON.stringify(String(r.result ?? '').slice(0, 200))}`,
  );
} catch {
  console.log(`(not JSON) ${JSON.stringify(input.slice(0, 300))}`);
}
