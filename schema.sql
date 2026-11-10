CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  host_token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  closed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS votes (
  room_id TEXT NOT NULL,
  voter_id TEXT NOT NULL,
  name TEXT NOT NULL,
  activity_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (room_id, voter_id),
  UNIQUE (room_id, name)
);
