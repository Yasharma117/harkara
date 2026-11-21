-- War Council entries (D1). Apply with: npx wrangler d1 execute harkara --remote --file schema.sql
CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY,
  day TEXT NOT NULL,          -- IST date the entry was sent
  house TEXT NOT NULL,
  author TEXT NOT NULL,
  text TEXT NOT NULL,
  at TEXT NOT NULL,
  visitor TEXT NOT NULL,      -- salted hash of IP + day; the IP itself is never stored
  used INTEGER NOT NULL DEFAULT 0,
  UNIQUE (day, visitor)
);
CREATE INDEX IF NOT EXISTS entries_queue ON entries (used, at);
