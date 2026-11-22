create table if not exists exam_subject (
  id bigserial primary key,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists exam_saved_paper (
  id bigserial primary key,
  subject_id bigint not null references exam_subject(id),
  title text not null,
  duration_minutes double precision,
  questions jsonb not null,
  answer_key jsonb not null,
  question_hash text not null,
  created_at timestamptz not null default now()
);

create index if not exists exam_saved_paper_subject_idx on exam_saved_paper (subject_id);
create index if not exists exam_saved_paper_hash_idx on exam_saved_paper (question_hash);

create table if not exists exam_round (
  id bigserial primary key,
  subject_id bigint not null references exam_subject(id),
  paper_id bigint not null references exam_saved_paper(id),
  paper_updated_at timestamptz not null unique,
  started_at timestamptz not null default now()
);

create index if not exists exam_round_subject_idx on exam_round (subject_id, started_at);
