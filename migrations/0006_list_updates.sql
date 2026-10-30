-- Validators of the last download, so a scheduled check can ask the source whether the list changed
ALTER TABLE filter_lists ADD COLUMN etag TEXT;
ALTER TABLE filter_lists ADD COLUMN last_modified TEXT;
-- Last scheduled check (ms since epoch) and its outcome: 1 when the source has a newer copy than the stored one
ALTER TABLE filter_lists ADD COLUMN checked_at INTEGER;
ALTER TABLE filter_lists ADD COLUMN update_available INTEGER NOT NULL DEFAULT 0;
