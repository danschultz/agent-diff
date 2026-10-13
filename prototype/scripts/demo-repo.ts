// Creates prototype/.data/demo-repo: a main branch plus an "agent" branch with committed, staged,
// unstaged, untracked, renamed, deleted, binary, ignored, and one large file.
// Usage: npm run demo-repo [-- --large-lines 6000] [--force]
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { dataDir } from '../src/shared/paths.ts';

const { values } = parseArgs({
  options: {
    'large-lines': { type: 'string', default: '6000' },
    force: { type: 'boolean', default: false },
  },
});

const dir = path.join(dataDir, 'demo-repo');
if (existsSync(dir)) {
  if (!values.force) {
    console.error(`${dir} already exists. Pass --force to recreate it.`);
    process.exit(1);
  }
  rmSync(dir, { recursive: true, force: true });
}
mkdirSync(dir, { recursive: true });

const env = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_AUTHOR_NAME: 'Demo',
  GIT_AUTHOR_EMAIL: 'demo@example.com',
  GIT_COMMITTER_NAME: 'Demo',
  GIT_COMMITTER_EMAIL: 'demo@example.com',
};
const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: dir, encoding: 'utf8', env });
const write = (file: string, content: string | Buffer) => {
  mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  writeFileSync(path.join(dir, file), content);
};

git('init', '-q', '-b', 'main');
git('config', 'commit.gpgsign', 'false');

// --- main ---------------------------------------------------------------

write('.gitignore', 'node_modules/\n*.log\n.env\n');
write(
  'README.md',
  `# Demo service

A tiny order service used to exercise agent-diff.

## Running

    npm start
`,
);
write(
  'src/orders.ts',
  `import { db } from './db.ts';
import { log } from './log.ts';

export interface Order {
  id: string;
  customerId: string;
  items: { sku: string; quantity: number; price: number }[];
  createdAt: Date;
}

export function orderTotal(order: Order): number {
  let total = 0;
  for (const item of order.items) {
    total += item.quantity * item.price;
  }
  return total;
}

export async function createOrder(customerId: string, items: Order['items']): Promise<Order> {
  const order: Order = { id: crypto.randomUUID(), customerId, items, createdAt: new Date() };
  await db.insert('orders', order);
  log.info('order created', { id: order.id });
  return order;
}

export async function cancelOrder(id: string): Promise<void> {
  await db.delete('orders', id);
  log.info('order cancelled', { id });
}
`,
);
write(
  'src/db.ts',
  `const tables = new Map<string, Map<string, unknown>>();

export const db = {
  async insert(table: string, row: { id: string }) {
    if (!tables.has(table)) tables.set(table, new Map());
    tables.get(table)!.set(row.id, row);
  },
  async delete(table: string, id: string) {
    tables.get(table)?.delete(id);
  },
  async get<T>(table: string, id: string): Promise<T | undefined> {
    return tables.get(table)?.get(id) as T | undefined;
  },
};
`,
);
write(
  'src/log.ts',
  `export const log = {
  info(message: string, fields: Record<string, unknown> = {}) {
    console.log(JSON.stringify({ level: 'info', message, ...fields }));
  },
};
`,
);
write(
  'src/legacy/discounts.ts',
  `// Deprecated: discounts moved to the pricing service.
export function applyDiscount(total: number, percent: number): number {
  return total - (total * percent) / 100;
}
`,
);
write(
  'src/helpers.ts',
  `export function formatMoney(cents: number): string {\n  return '$' + (cents / 100).toFixed(2);\n}\n`,
);
write('src/generated/catalog.ts', largeFile(Number(values['large-lines']), 0));
write('jvm/build.sbt', scalaBuild(false));
write('jvm/src/main/scala/orders/OrderTotals.scala', scalaSource(false));
write(
  'assets/logo.png',
  Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 1, 2, 3,
  ]),
);
git('add', '-A');
git('commit', '-q', '-m', 'Initial order service');

// --- agent branch: committed work --------------------------------------

git('switch', '-q', '-c', 'agent/order-validation');
write(
  'src/orders.ts',
  `import { db } from './db.ts';
import { log } from './log.ts';
import { validateItems } from './validation.ts';

export interface Order {
  id: string;
  customerId: string;
  items: { sku: string; quantity: number; price: number }[];
  createdAt: Date;
  status: 'open' | 'cancelled';
}

export function orderTotal(order: Order): number {
  return order.items.reduce((sum, item) => sum + item.quantity * item.price, 0);
}

export async function createOrder(customerId: string, items: Order['items']): Promise<Order> {
  validateItems(items);
  const order: Order = { id: crypto.randomUUID(), customerId, items, createdAt: new Date(), status: 'open' };
  await db.insert('orders', order);
  log.info('order created', { id: order.id, total: orderTotal(order) });
  return order;
}

export async function cancelOrder(id: string): Promise<void> {
  const order = await db.get<Order>('orders', id);
  if (!order) throw new Error(\`Order \${id} not found\`);
  order.status = 'cancelled';
  await db.insert('orders', order);
  log.info('order cancelled', { id });
}
`,
);
write(
  'src/validation.ts',
  `import type { Order } from './orders.ts';

export function validateItems(items: Order['items']): void {
  if (items.length === 0) throw new Error('An order needs at least one item');
  for (const item of items) {
    if (item.quantity <= 0) throw new Error(\`Invalid quantity for \${item.sku}\`);
    if (item.price < 0) throw new Error(\`Invalid price for \${item.sku}\`);
  }
}
`,
);
unlinkSync(path.join(dir, 'src/legacy/discounts.ts'));
renameSync(path.join(dir, 'src/helpers.ts'), path.join(dir, 'src/money.ts'));
write('src/generated/catalog.ts', largeFile(Number(values['large-lines']), 1));
write('jvm/build.sbt', scalaBuild(true));
write('jvm/src/main/scala/orders/OrderTotals.scala', scalaSource(true));
git('add', '-A');
git(
  'commit',
  '-q',
  '-m',
  'Validate order items and soft-delete cancelled orders',
);

// --- uncommitted work ---------------------------------------------------

write(
  'src/log.ts',
  `export const log = {
  info(message: string, fields: Record<string, unknown> = {}) {
    console.log(JSON.stringify({ level: 'info', time: new Date().toISOString(), message, ...fields }));
  },
  warn(message: string, fields: Record<string, unknown> = {}) {
    console.warn(JSON.stringify({ level: 'warn', time: new Date().toISOString(), message, ...fields }));
  },
};
`,
);
git('add', 'src/log.ts');

write(
  'README.md',
  `# Demo service

A tiny order service used to exercise agent-diff.

## Running

    npm start

## Validation

Orders are validated before they're stored. See \`src/validation.ts\`. Validation checks that every order has at least one line item, that quantities are positive whole numbers, that each SKU exists in the catalog, and that the customer's shipping country is one we currently deliver to; failures are returned together so the caller can fix them all at once.
`,
);
write(
  'test/validation.test.ts',
  `import { validateItems } from '../src/validation.ts';

validateItems([{ sku: 'A', quantity: 1, price: 100 }]);
`,
);
write('debug.log', 'ignored by .gitignore\n');
write(
  'assets/logo.png',
  Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 4, 5, 6, 7,
  ]),
);

console.log(`Demo repo ready at ${dir}

  Branch: agent/order-validation (base: main)
  Committed: src/orders.ts, src/validation.ts (new), src/money.ts (renamed), src/legacy/discounts.ts (deleted),
             src/generated/catalog.ts (${values['large-lines']} lines, for viewer render timings),
             jvm/build.sbt and jvm/src/main/scala/orders/OrderTotals.scala (Scala highlighting)
  Staged:    src/log.ts
  Unstaged:  README.md, assets/logo.png (binary)
  Untracked: test/validation.test.ts
  Ignored:   debug.log

Start a review session:
  cd ${dir} && ${path.relative(dir, path.resolve(import.meta.dirname, '..', 'bin', 'agent-diff'))} start --base main
`);

function scalaBuild(agent: boolean): string {
  return `ThisBuild / scalaVersion := "3.3.4"

lazy val root = (project in file("."))
  .settings(
    name := "order-totals",
    libraryDependencies ++= Seq(
      "org.typelevel" %% "cats-core" % "2.12.0"${agent ? `,\n      "org.scalameta" %% "munit" % "1.0.2" % Test` : ''}
    )
  )
`;
}

function scalaSource(agent: boolean): string {
  if (!agent) {
    return `package orders

final case class Item(sku: String, quantity: Int, price: BigDecimal)

object OrderTotals {
  def total(items: List[Item]): BigDecimal = {
    var sum = BigDecimal(0)
    for (item <- items) sum += item.price * item.quantity
    sum
  }
}
`;
  }
  return `package orders

import cats.syntax.all.*

final case class Item(sku: String, quantity: Int, price: BigDecimal)

sealed trait OrderError
object OrderError {
  case object Empty extends OrderError
  final case class InvalidQuantity(sku: String) extends OrderError
}

object OrderTotals {
  /** Sums the order, rejecting empty orders and non-positive quantities. */
  def total(items: List[Item]): Either[OrderError, BigDecimal] =
    items match {
      case Nil => Left(OrderError.Empty)
      case _ =>
        items
          .traverse(item => Either.cond(item.quantity > 0, item.price * item.quantity, OrderError.InvalidQuantity(item.sku)))
          .map(_.sum)
    }
}
`;
}

/** A long generated file where every 40th entry differs between variants. */
function largeFile(lines: number, variant: number): string {
  const out = [
    '// Generated catalog. Do not edit by hand.',
    'export const catalog = [',
  ];
  for (let i = 0; out.length < lines - 1; i++) {
    const price = variant && i % 40 === 7 ? 100 + i * 3 : 100 + i * 2;
    const name = variant && i % 97 === 11 ? `Item ${i} (renamed)` : `Item ${i}`;
    out.push(
      `  { sku: 'SKU-${String(i).padStart(5, '0')}', name: '${name}', price: ${price} },`,
    );
  }
  out.push('];');
  return out.join('\n') + '\n';
}
