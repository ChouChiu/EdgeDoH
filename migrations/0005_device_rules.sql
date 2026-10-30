-- Per-device allow / block overrides, compiled into the always-applied `device-rules` snapshot list
CREATE TABLE device_rules (
  device_id TEXT NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
  -- Lowercase domain; the rule covers its subdomains too
  name TEXT NOT NULL,
  -- allow | block
  action TEXT NOT NULL,
  PRIMARY KEY (device_id, name)
);
