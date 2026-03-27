CREATE TABLE IF NOT EXISTS user_settings (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category VARCHAR(50) NOT NULL,
  settings_key VARCHAR(100) NOT NULL,
  settings_value TEXT,
  value_type VARCHAR(20) NOT NULL DEFAULT 'string',
  is_encrypted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, category, settings_key)
);

CREATE INDEX IF NOT EXISTS idx_user_settings_user_id ON user_settings(user_id);
CREATE INDEX IF NOT EXISTS idx_user_settings_category ON user_settings(category);
CREATE INDEX IF NOT EXISTS idx_user_settings_key ON user_settings(settings_key);

CREATE TABLE IF NOT EXISTS settings_audit_log (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  setting_id INTEGER REFERENCES user_settings(id) ON DELETE SET NULL,
  category VARCHAR(50) NOT NULL,
  settings_key VARCHAR(100) NOT NULL,
  old_value TEXT,
  new_value TEXT,
  action VARCHAR(20) NOT NULL,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_settings_audit_user_id ON settings_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_settings_audit_created_at ON settings_audit_log(created_at);

CREATE OR REPLACE FUNCTION update_user_settings_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_user_settings_timestamp ON user_settings;
CREATE TRIGGER trigger_update_user_settings_timestamp
  BEFORE UPDATE ON user_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_user_settings_timestamp();

CREATE OR REPLACE FUNCTION log_settings_change()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO settings_audit_log (user_id, setting_id, category, settings_key, old_value, new_value, action)
    VALUES (NEW.user_id, NEW.id, NEW.category, NEW.settings_key, NULL, NEW.settings_value, 'create');
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO settings_audit_log (user_id, setting_id, category, settings_key, old_value, new_value, action)
    VALUES (NEW.user_id, NEW.id, NEW.category, NEW.settings_key, OLD.settings_value, NEW.settings_value, 'update');
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO settings_audit_log (user_id, setting_id, category, settings_key, old_value, new_value, action)
    VALUES (OLD.user_id, OLD.id, OLD.category, OLD.settings_key, OLD.settings_value, NULL, 'delete');
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_log_settings_change ON user_settings;
CREATE TRIGGER trigger_log_settings_change
  AFTER INSERT OR UPDATE OR DELETE ON user_settings
  FOR EACH ROW
  EXECUTE FUNCTION log_settings_change();

INSERT INTO user_settings (user_id, category, settings_key, settings_value, value_type)
SELECT u.id, 'general', 'language', 'en', 'string'
FROM users u
WHERE NOT EXISTS (
  SELECT 1
  FROM user_settings us
  WHERE us.user_id = u.id
    AND us.category = 'general'
    AND us.settings_key = 'language'
);

INSERT INTO user_settings (user_id, category, settings_key, settings_value, value_type)
SELECT u.id, 'general', 'timezone', 'Asia/Singapore', 'string'
FROM users u
WHERE NOT EXISTS (
  SELECT 1
  FROM user_settings us
  WHERE us.user_id = u.id
    AND us.category = 'general'
    AND us.settings_key = 'timezone'
);

INSERT INTO user_settings (user_id, category, settings_key, settings_value, value_type)
SELECT u.id, 'general', 'theme', 'light', 'string'
FROM users u
WHERE NOT EXISTS (
  SELECT 1
  FROM user_settings us
  WHERE us.user_id = u.id
    AND us.category = 'general'
    AND us.settings_key = 'theme'
);

INSERT INTO user_settings (user_id, category, settings_key, settings_value, value_type)
SELECT u.id, 'profile', 'display_name', COALESCE(u.username, ''), 'string'
FROM users u
WHERE NOT EXISTS (
  SELECT 1
  FROM user_settings us
  WHERE us.user_id = u.id
    AND us.category = 'profile'
    AND us.settings_key = 'display_name'
);

INSERT INTO user_settings (user_id, category, settings_key, settings_value, value_type)
SELECT u.id, 'security', 'two_factor_enabled', 'false', 'boolean'
FROM users u
WHERE NOT EXISTS (
  SELECT 1
  FROM user_settings us
  WHERE us.user_id = u.id
    AND us.category = 'security'
    AND us.settings_key = 'two_factor_enabled'
);

INSERT INTO user_settings (user_id, category, settings_key, settings_value, value_type)
SELECT u.id, 'security', 'login_notifications', 'true', 'boolean'
FROM users u
WHERE NOT EXISTS (
  SELECT 1
  FROM user_settings us
  WHERE us.user_id = u.id
    AND us.category = 'security'
    AND us.settings_key = 'login_notifications'
);

INSERT INTO user_settings (user_id, category, settings_key, settings_value, value_type)
SELECT u.id, 'notification', 'email_enabled', 'true', 'boolean'
FROM users u
WHERE NOT EXISTS (
  SELECT 1
  FROM user_settings us
  WHERE us.user_id = u.id
    AND us.category = 'notification'
    AND us.settings_key = 'email_enabled'
);

INSERT INTO user_settings (user_id, category, settings_key, settings_value, value_type)
SELECT u.id, 'notification', 'push_enabled', 'true', 'boolean'
FROM users u
WHERE NOT EXISTS (
  SELECT 1
  FROM user_settings us
  WHERE us.user_id = u.id
    AND us.category = 'notification'
    AND us.settings_key = 'push_enabled'
);

INSERT INTO user_settings (user_id, category, settings_key, settings_value, value_type)
SELECT u.id, 'notification', 'sms_enabled', 'false', 'boolean'
FROM users u
WHERE NOT EXISTS (
  SELECT 1
  FROM user_settings us
  WHERE us.user_id = u.id
    AND us.category = 'notification'
    AND us.settings_key = 'sms_enabled'
);

CREATE OR REPLACE VIEW user_settings_summary AS
SELECT
  u.id AS user_id,
  u.username,
  u.email,
  COUNT(DISTINCT us.category) AS categories_configured,
  COUNT(us.id) AS total_settings,
  MAX(us.updated_at) AS last_updated
FROM users u
LEFT JOIN user_settings us ON u.id = us.user_id
GROUP BY u.id, u.username, u.email;
