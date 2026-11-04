INSERT INTO app_meta (key, value) VALUES ('ui_language', 'en')
ON CONFLICT(key) DO NOTHING;
