-- Settings Management Schema for Immunicare Admin Dashboard
-- This schema provides comprehensive settings management with categorized sections

-- Create user_settings table for storing user-specific settings
CREATE TABLE IF NOT EXISTS user_settings (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category VARCHAR(50) NOT NULL, -- 'general', 'profile', 'security', 'notification'
    settings_key VARCHAR(100) NOT NULL,
    settings_value TEXT,
    value_type VARCHAR(20) DEFAULT 'string', -- 'string', 'boolean', 'number', 'json'
    is_encrypted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, category, settings_key)
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_user_settings_user_id ON user_settings(user_id);
CREATE INDEX IF NOT EXISTS idx_user_settings_category ON user_settings(category);
CREATE INDEX IF NOT EXISTS idx_user_settings_key ON user_settings(settings_key);

-- Create audit log for settings changes
CREATE TABLE IF NOT EXISTS settings_audit_log (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    setting_id INTEGER REFERENCES user_settings(id) ON DELETE SET NULL,
    category VARCHAR(50) NOT NULL,
    settings_key VARCHAR(100) NOT NULL,
    old_value TEXT,
    new_value TEXT,
    action VARCHAR(20) NOT NULL, -- 'create', 'update', 'delete'
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index for audit log queries
CREATE INDEX IF NOT EXISTS idx_settings_audit_user_id ON settings_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_settings_audit_created_at ON settings_audit_log(created_at);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_user_settings_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for user_settings
CREATE TRIGGER trigger_update_user_settings_timestamp
    BEFORE UPDATE ON user_settings
    FOR EACH ROW
    EXECUTE FUNCTION update_user_settings_timestamp();

-- Create function to log settings changes
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

-- Create trigger for settings audit log
CREATE TRIGGER trigger_log_settings_change
    AFTER INSERT OR UPDATE OR DELETE ON user_settings
    FOR EACH ROW
    EXECUTE FUNCTION log_settings_change();

-- Insert default settings for existing users
INSERT INTO user_settings (user_id, category, settings_key, settings_value, value_type)
SELECT 
    u.id,
    'general',
    'language',
    'en',
    'string'
FROM users u
WHERE NOT EXISTS (
    SELECT 1 FROM user_settings us 
    WHERE us.user_id = u.id 
    AND us.category = 'general' 
    AND us.settings_key = 'language'
);

INSERT INTO user_settings (user_id, category, settings_key, settings_value, value_type)
SELECT 
    u.id,
    'general',
    'timezone',
    'Asia/Singapore',
    'string'
FROM users u
WHERE NOT EXISTS (
    SELECT 1 FROM user_settings us 
    WHERE us.user_id = u.id 
    AND us.category = 'general' 
    AND us.settings_key = 'timezone'
);

INSERT INTO user_settings (user_id, category, settings_key, settings_value, value_type)
SELECT 
    u.id,
    'general',
    'theme',
    'light',
    'string'
FROM users u
WHERE NOT EXISTS (
    SELECT 1 FROM user_settings us 
    WHERE us.user_id = u.id 
    AND us.category = 'general' 
    AND us.settings_key = 'theme'
);

INSERT INTO user_settings (user_id, category, settings_key, settings_value, value_type)
SELECT 
    u.id,
    'profile',
    'display_name',
    u.username,
    'string'
FROM users u
WHERE NOT EXISTS (
    SELECT 1 FROM user_settings us 
    WHERE us.user_id = u.id 
    AND us.category = 'profile' 
    AND us.settings_key = 'display_name'
);

INSERT INTO user_settings (user_id, category, settings_key, settings_value, value_type)
SELECT 
    u.id,
    'profile',
    'bio',
    '',
    'string'
FROM users u
WHERE NOT EXISTS (
    SELECT 1 FROM user_settings us 
    WHERE us.user_id = u.id 
    AND us.category = 'profile' 
    AND us.settings_key = 'bio'
);

INSERT INTO user_settings (user_id, category, settings_key, settings_value, value_type)
SELECT 
    u.id,
    'security',
    'two_factor_enabled',
    'false',
    'boolean'
FROM users u
WHERE NOT EXISTS (
    SELECT 1 FROM user_settings us 
    WHERE us.user_id = u.id 
    AND us.category = 'security' 
    AND us.settings_key = 'two_factor_enabled'
);

INSERT INTO user_settings (user_id, category, settings_key, settings_value, value_type)
SELECT 
    u.id,
    'security',
    'login_notifications',
    'true',
    'boolean'
FROM users u
WHERE NOT EXISTS (
    SELECT 1 FROM user_settings us 
    WHERE us.user_id = u.id 
    AND us.category = 'security' 
    AND us.settings_key = 'login_notifications'
);

INSERT INTO user_settings (user_id, category, settings_key, settings_value, value_type)
SELECT 
    u.id,
    'security',
    'session_timeout',
    '30',
    'number'
FROM users u
WHERE NOT EXISTS (
    SELECT 1 FROM user_settings us 
    WHERE us.user_id = u.id 
    AND us.category = 'security' 
    AND us.settings_key = 'session_timeout'
);

INSERT INTO user_settings (user_id, category, settings_key, settings_value, value_type)
SELECT 
    u.id,
    'notification',
    'email_enabled',
    'true',
    'boolean'
FROM users u
WHERE NOT EXISTS (
    SELECT 1 FROM user_settings us 
    WHERE us.user_id = u.id 
    AND us.category = 'notification' 
    AND us.settings_key = 'email_enabled'
);

INSERT INTO user_settings (user_id, category, settings_key, settings_value, value_type)
SELECT 
    u.id,
    'notification',
    'push_enabled',
    'true',
    'boolean'
FROM users u
WHERE NOT EXISTS (
    SELECT 1 FROM user_settings us 
    WHERE us.user_id = u.id 
    AND us.category = 'notification' 
    AND us.settings_key = 'push_enabled'
);

INSERT INTO user_settings (user_id, category, settings_key, settings_value, value_type)
SELECT 
    u.id,
    'notification',
    'sms_enabled',
    'false',
    'boolean'
FROM users u
WHERE NOT EXISTS (
    SELECT 1 FROM user_settings us 
    WHERE us.user_id = u.id 
    AND us.category = 'notification' 
    AND us.settings_key = 'sms_enabled'
);

INSERT INTO user_settings (user_id, category, settings_key, settings_value, value_type)
SELECT 
    u.id,
    'notification',
    'digest_frequency',
    'daily',
    'string'
FROM users u
WHERE NOT EXISTS (
    SELECT 1 FROM user_settings us 
    WHERE us.user_id = u.id 
    AND us.category = 'notification' 
    AND us.settings_key = 'digest_frequency'
);

-- Grant necessary permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON user_settings TO immunicare_user;
GRANT SELECT, INSERT ON settings_audit_log TO immunicare_user;
GRANT USAGE, SELECT ON SEQUENCE user_settings_id_seq TO immunicare_user;
GRANT USAGE, SELECT ON SEQUENCE settings_audit_log_id_seq TO immunicare_user;

-- Create view for user settings summary
CREATE OR REPLACE VIEW user_settings_summary AS
SELECT 
    u.id as user_id,
    u.username,
    u.email,
    COUNT(DISTINCT us.category) as categories_configured,
    COUNT(us.id) as total_settings,
    MAX(us.updated_at) as last_updated
FROM users u
LEFT JOIN user_settings us ON u.id = us.user_id
GROUP BY u.id, u.username, u.email;

GRANT SELECT ON user_settings_summary TO immunicare_user;

COMMENT ON TABLE user_settings IS 'Stores user-specific settings categorized by type (general, profile, security, notification)';
COMMENT ON TABLE settings_audit_log IS 'Audit log for tracking all settings changes';
COMMENT ON VIEW user_settings_summary IS 'Summary view of user settings configuration';
