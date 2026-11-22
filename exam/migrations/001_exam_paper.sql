create table if not exists exam_paper (
  id integer primary key,
  title text not null,
  duration_minutes double precision,
  questions jsonb not null,
  answer_key jsonb not null,
  updated_at timestamptz not null default now()
);
