import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
create table if not exists workspaces (
  id text primary key,
  root text not null unique,
  created_at text not null
);

create table if not exists review_sessions (
  id text primary key,
  title text,
  status text not null default 'open',
  started_by text,
  created_at text not null,
  ended_at text
);

-- The base ref lives on a workspace's membership in a review session.
create table if not exists review_session_workspaces (
  review_session_id text not null references review_sessions(id),
  workspace_id text not null references workspaces(id),
  base_ref text not null,
  added_at text not null,
  primary key (review_session_id, workspace_id)
);

create table if not exists agents (
  id text primary key,
  label text,
  parent_id text,
  notify text not null,
  busy integer not null default 0,
  last_seen_at text not null,
  created_at text not null
);

create table if not exists agent_workspaces (
  agent_id text not null references agents(id),
  workspace_id text not null references workspaces(id),
  primary key (agent_id, workspace_id)
);

-- Full file contents keyed by git blob hash, shared by every comment on that version.
create table if not exists file_versions (
  hash text primary key,
  content text not null,
  created_at text not null
);

create table if not exists reviews (
  id text primary key,
  review_session_id text not null references review_sessions(id),
  submitted_at text not null
);

create table if not exists comments (
  id text primary key,
  review_session_id text not null references review_sessions(id),
  review_id text references reviews(id),
  workspace_id text references workspaces(id),
  path text,
  side text,
  start_line integer,
  end_line integer,
  file_version text references file_versions(hash),
  diff_mode text,
  body text not null,
  created_at text not null,
  updated_at text not null
);

create table if not exists notifications (
  id text primary key,
  review_id text not null references reviews(id),
  agent_id text,
  workspace_id text not null,
  method text not null,
  message text not null,
  status text not null,
  error text,
  created_at text not null,
  sent_at text,
  fetched_at text
);

create table if not exists feedback_fetches (
  review_id text not null references reviews(id),
  workspace_id text not null,
  agent_id text,
  fetched_at text not null
);

create table if not exists turn_snapshots (
  id integer primary key autoincrement,
  workspace_id text not null references workspaces(id),
  seq integer not null,
  commit_sha text not null,
  ref text not null,
  agent_id text,
  reason text not null,
  created_at text not null
);
`;

export type Row = Record<string, string | number | null>;

export class Db {
  readonly raw: DatabaseSync;

  constructor(file: string) {
    mkdirSync(path.dirname(file), { recursive: true });
    this.raw = new DatabaseSync(file);
    this.raw.exec('pragma journal_mode = wal; pragma foreign_keys = on; pragma busy_timeout = 2000;');
    this.raw.exec(SCHEMA);
  }

  all<T = Row>(sql: string, ...params: (string | number | null)[]): T[] {
    return this.raw.prepare(sql).all(...params) as T[];
  }

  get<T = Row>(sql: string, ...params: (string | number | null)[]): T | undefined {
    return this.raw.prepare(sql).get(...params) as T | undefined;
  }

  run(sql: string, ...params: (string | number | null)[]): void {
    this.raw.prepare(sql).run(...params);
  }

  transaction<T>(fn: () => T): T {
    this.raw.exec('begin');
    try {
      const result = fn();
      this.raw.exec('commit');
      return result;
    } catch (error) {
      this.raw.exec('rollback');
      throw error;
    }
  }
}

export function now(): string {
  return new Date().toISOString();
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 10)}`;
}
