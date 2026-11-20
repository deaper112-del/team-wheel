create table if not exists exam_attempt (
  token text primary key,
  name text not null,
  paper_updated_at timestamptz not null,
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  report jsonb
);

create table if not exists proctor_failure (
  id bigserial primary key,
  created_at timestamptz not null default now()
);
