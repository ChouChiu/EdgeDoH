CREATE TABLE filter_lists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  -- registry: HostlistsRegistry entry, url: added by hand
  source TEXT NOT NULL,
  registry_id INTEGER,
  enabled INTEGER NOT NULL DEFAULT 1,
  -- Filled in from the browser after each compile
  rules INTEGER,
  unsupported INTEGER,
  reasons TEXT,
  fetched_at INTEGER,
  compiled_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
