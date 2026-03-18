-- Create blocked_dates table for admin date blocking feature
-- This allows administrators to selectively disable or enable specific dates for appointment bookings

CREATE TABLE IF NOT EXISTS blocked_dates (
    id SERIAL PRIMARY KEY,
    blocked_date DATE NOT NULL UNIQUE,
    is_blocked BOOLEAN NOT NULL DEFAULT TRUE,
    reason TEXT,
    blocked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    clinic_id INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Add index for faster date lookups
CREATE INDEX IF NOT EXISTS idx_blocked_dates_date ON blocked_dates(blocked_date);
CREATE INDEX IF NOT EXISTS idx_blocked_dates_clinic ON blocked_dates(clinic_id);

-- Add comment
COMMENT ON TABLE blocked_dates IS 'Stores admin-configured blocked/unblocked dates for appointment booking';
COMMENT ON COLUMN blocked_dates.blocked_date IS 'The date that is blocked or unblocked';
COMMENT ON COLUMN blocked_dates.is_blocked IS 'TRUE if date is blocked (unavailable), FALSE if explicitly unblocked';
COMMENT ON COLUMN blocked_dates.reason IS 'Optional reason for blocking/unblocking the date';
COMMENT ON COLUMN blocked_dates.blocked_by IS 'User ID of admin who blocked/unblocked the date';
COMMENT ON COLUMN blocked_dates.clinic_id IS 'Clinic ID if the block is clinic-specific';
