create table review_sessions (id text primary key, title text, started_at text not null);
create table review_session_working_directories (
  review_session_id text not null references review_sessions(id),
  path text not null, primary key (review_session_id, path));
create table comments (
  id text primary key, review_session_id text not null references review_sessions(id),
  path text not null, start_line integer not null, end_line integer not null,
  body text not null, created_at text not null);
