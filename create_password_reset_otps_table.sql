-- Create password_reset_otps table for dual-option forgot password
-- This table stores OTPs for password reset via SMS or Email

CREATE TABLE IF NOT EXISTS password_reset_otps (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    otp VARCHAR(6) NOT NULL,
    method VARCHAR(10) NOT NULL CHECK (method IN ('email', 'sms')),
    expires_at TIMESTAMP NOT NULL,
    used_at TIMESTAMP,
    attempts INTEGER DEFAULT 0,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_password_reset_otps_user_id 
ON password_reset_otps(user_id);

CREATE INDEX IF NOT EXISTS idx_password_reset_otps_expires 
ON password_reset_otps(expires_at) 
WHERE used_at IS NULL;

-- Add this comment
COMMENT ON TABLE password_reset_otps IS 'Stores OTP codes for password reset via SMS or Email';
