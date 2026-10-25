-- Header fields of the downloaded list (title, description, homepage, license, version, last modified) as JSON
ALTER TABLE filter_lists ADD COLUMN meta TEXT;
