// The agent runs `node reply.mjs <message-id> <text...>` to answer a message
// from the prototype review server.
const [id, ...rest] = process.argv.slice(2);
const port = process.env.PORT ?? 47107;
const res = await fetch(`http://127.0.0.1:${port}/reply`, {
  method: 'POST',
  body: JSON.stringify({ id, text: rest.join(' ') }),
});
console.log(res.status, await res.text());
