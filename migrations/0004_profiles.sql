-- Per-device policy groups. `config` holds the validated profile fields as JSON
CREATE TABLE profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  config TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
-- Devices without a profile use this one; it cannot be deleted
INSERT INTO profiles (id, name, config, created_at) VALUES ('default', 'Default', '{}', 0);

-- NULL means the default profile
ALTER TABLE devices ADD COLUMN profile_id TEXT REFERENCES profiles (id) ON DELETE SET NULL;
-- Filtering is skipped for the device until this time (ms since epoch)
ALTER TABLE devices ADD COLUMN paused_until INTEGER;

-- filter: blocking rules; route: split-DNS domain list resolved through `upstreams`
ALTER TABLE filter_lists ADD COLUMN kind TEXT NOT NULL DEFAULT 'filter';
-- JSON array of DoH URLs, route lists only
ALTER TABLE filter_lists ADD COLUMN upstreams TEXT;

-- Hand-written answers for names such as home.lan; `name` may start with `*.` to cover subdomains
CREATE TABLE local_records (
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (name, type, value)
);
