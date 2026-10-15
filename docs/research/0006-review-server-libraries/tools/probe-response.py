# Copies each server example, makes the "get review session" handler return
# startedAt as a number, and reports whether tsc rejects it.
import os, shutil, subprocess, sys
S = sys.argv[1]
edits = {
  'node-http': ("send(res, 200, session)", "send(res, 200, { ...session, startedAt: 1 })"),
  'hono': ("c.json(session, 200)", "c.json({ ...session, startedAt: 1 }, 200)"),
  'fastify': ("if (session) reply.send(session);", "if (session) reply.send({ ...session, startedAt: 1 });"),
  'express': ("if (session) res.json(session);", "if (session) res.json({ ...session, startedAt: 1 });"),
  'h3': ("    return session;\n", "    return { ...session, startedAt: 1 };\n"),
  'elysia': ("store.getReviewSession(params.id) ??", "((s) => s && { ...s, startedAt: 1 })(store.getReviewSession(params.id)) ??"),
  'trpc': ("store.getReviewSession(input.id) ??", "((s) => s && { ...s, startedAt: 1 })(store.getReviewSession(input.id)) ??"),
  'orpc': ("      return session;\n", "      return { ...session, startedAt: 1 };\n"),
}
for name, (old, new) in edits.items():
  src = f'{S}/server/{name}'
  dst = f'{S}/probe/{name}'
  shutil.rmtree(dst, ignore_errors=True)
  shutil.copytree(src, dst, symlinks=True, ignore=shutil.ignore_patterns('node_modules'))
  os.symlink(f'{src}/node_modules', f'{dst}/node_modules')
  text = open(f'{dst}/server.ts').read()
  assert text.count(old) >= 1, name
  open(f'{dst}/server.ts', 'w').write(text.replace(old, new, 1))
  r = subprocess.run([f'{S}/tools/check.sh', dst], capture_output=True, text=True)
  first = (r.stdout + r.stderr).strip().splitlines()
  print(f'{name}: {"caught" if r.returncode else "not caught"}' + (f' -- {first[0][:160]}' if r.returncode else ''))
