-- Adds the double opt-in confirmation token to an existing subscribers table.
-- New databases get this column from schema.sql; this migration brings an
-- already-deployed table up to date.
--
-- Apply with:
--   wrangler d1 execute flippinflops-db --remote --file=migrations/0001_add_subscriber_token.sql
--
-- SQLite has no "ADD COLUMN IF NOT EXISTS"; running this twice errors with
-- "duplicate column name: token", which is safe to ignore.
ALTER TABLE subscribers ADD COLUMN token TEXT;
