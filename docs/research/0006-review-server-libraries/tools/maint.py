# Prints latest version, its date, releases in the last year, and GitHub repo stats.
import json, subprocess, sys
pkgs = {
 'hono':'honojs/hono','fastify':'fastify/fastify','express':'expressjs/express','h3':'h3js/h3','elysia':'elysiajs/elysia',
 '@trpc/server':'trpc/trpc','@orpc/server':'middleapi/orpc','@ts-rest/core':'ts-rest/ts-rest','koa':'koajs/koa',
 'zod':'colinhacks/zod','valibot':'open-circle/valibot','arktype':'arktypeio/arktype','typebox':'sinclairzx81/typebox','effect':'Effect-TS/effect',
 'better-sqlite3':'WiseLibs/better-sqlite3','libsql':'tursodatabase/libsql-js','@libsql/client':'tursodatabase/libsql-client-ts','sqlite3':'TryGhost/node-sqlite3','node-sqlite3-wasm':'tndrle/node-sqlite3-wasm',
 'kysely':'kysely-org/kysely','drizzle-orm':'drizzle-team/drizzle-orm','@prisma/client':'prisma/prisma',
}
for p, repo in pkgs.items():
  t = json.loads(subprocess.run(['npm','view',p,'time','--json'],capture_output=True,text=True).stdout)
  latest = subprocess.run(['npm','view',p,'dist-tags.latest'],capture_output=True,text=True).stdout.strip()
  n = sum(1 for k,v in t.items() if k not in ('created','modified') and '2025-10-14' <= v[:10] <= '2026-10-14')
  r = subprocess.run(['gh','api',f'repos/{repo}','--jq','[.stargazers_count,.pushed_at[:10],.archived,.full_name]'],capture_output=True,text=True).stdout.strip()
  print(f'{p}\t{latest}\t{t.get(latest,"")[:10]}\t{n}\t{r}')
