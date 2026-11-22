delete from exam_attempt as older
using exam_attempt as newer
where older.submitted_at is not null
  and newer.submitted_at is not null
  and older.name = newer.name
  and older.paper_updated_at = newer.paper_updated_at
  and (
    older.submitted_at < newer.submitted_at
    or (older.submitted_at = newer.submitted_at and older.token < newer.token)
  );

create unique index if not exists exam_attempt_one_submitted
  on exam_attempt (name, paper_updated_at)
  where submitted_at is not null;
