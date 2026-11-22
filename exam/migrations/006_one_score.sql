create unique index if not exists exam_attempt_one_submitted
  on exam_attempt (name, paper_updated_at)
  where submitted_at is not null;
