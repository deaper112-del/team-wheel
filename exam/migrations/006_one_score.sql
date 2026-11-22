delete from exam_attempt as older
where older.submitted_at is not null
  and exists (
    select 1
    from exam_attempt as newer
    where newer.name = older.name
      and newer.paper_updated_at = older.paper_updated_at
      and newer.submitted_at is not null
      and newer.token <> older.token
      and (
        newer.submitted_at > older.submitted_at
        or (newer.submitted_at = older.submitted_at and newer.token > older.token)
      )
  );

create unique index if not exists exam_attempt_one_submitted
  on exam_attempt (name, paper_updated_at)
  where submitted_at is not null;
