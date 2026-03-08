-- Immunicare Database Index Verification and Optimization
-- Run this script to verify and create recommended indexes

-- ============================================
-- SECTION 1: Check existing indexes
-- ============================================

-- View all existing indexes in the database
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;

-- ============================================
-- SECTION 2: User-related indexes
-- ============================================

-- Primary lookup indexes for users table
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role_id ON users(role_id);
CREATE INDEX IF NOT EXISTS idx_users_is_active ON users(is_active);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);

-- Composite index for common login query
CREATE INDEX IF NOT EXISTS idx_users_login_lookup ON users(username, is_active) WHERE is_active = true;

-- ============================================
-- SECTION 3: Infant/Patient-related indexes
-- ============================================

-- Indexes for infants table
CREATE INDEX IF NOT EXISTS idx_infants_guardian_id ON infants(guardian_id);
CREATE INDEX IF NOT EXISTS idx_infants_created_at ON infants(created_at);
CREATE INDEX IF NOT EXISTS idx_infants_date_of_birth ON infants(date_of_birth);
CREATE INDEX IF NOT EXISTS idx_infants_is_active ON infants(is_active);

-- Composite index for guardian's active infants
CREATE INDEX IF NOT EXISTS idx_infants_guardian_active ON infants(guardian_id, is_active) WHERE is_active = true;

-- ============================================
-- SECTION 4: Appointment-related indexes
-- ============================================

-- Indexes for appointments table
CREATE INDEX IF NOT EXISTS idx_appointments_infant_id ON appointments(infant_id);
CREATE INDEX IF NOT EXISTS idx_appointments_scheduled_date ON appointments(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);
CREATE INDEX IF NOT EXISTS idx_appointments_created_at ON appointments(created_at);
CREATE INDEX IF NOT EXISTS idx_appointments_location ON appointments(location);

-- Composite index for upcoming appointments query
CREATE INDEX IF NOT EXISTS idx_appointments_upcoming ON appointments(scheduled_date, status) 
WHERE status IN ('scheduled', 'confirmed');

-- Composite index for appointment history
CREATE INDEX IF NOT EXISTS idx_appointments_history ON appointments(infant_id, scheduled_date DESC);

-- ============================================
-- SECTION 5: Vaccination-related indexes
-- ============================================

-- Indexes for immunization_records table
CREATE INDEX IF NOT EXISTS idx_immunization_records_patient_id ON immunization_records(patient_id);
CREATE INDEX IF NOT EXISTS idx_immunization_records_vaccine_id ON immunization_records(vaccine_id);
CREATE INDEX IF NOT EXISTS idx_immunization_records_date_administered ON immunization_records(date_administered);
CREATE INDEX IF NOT EXISTS idx_immunization_records_created_at ON immunization_records(created_at);

-- Composite index for patient vaccination history
CREATE INDEX IF NOT EXISTS idx_immunization_records_patient_date ON immunization_records(patient_id, date_administered DESC);

-- Indexes for vaccines table
CREATE INDEX IF NOT EXISTS idx_vaccines_name ON vaccines(name);
CREATE INDEX IF NOT EXISTS idx_vaccines_is_active ON vaccines(is_active);

-- ============================================
-- SECTION 6: Inventory-related indexes
-- ============================================

-- Indexes for vaccine_inventory table
CREATE INDEX IF NOT EXISTS idx_vaccine_inventory_vaccine_id ON vaccine_inventory(vaccine_id);
CREATE INDEX IF NOT EXISTS idx_vaccine_inventory_expiry_date ON vaccine_inventory(expiry_date);
CREATE INDEX IF NOT EXISTS idx_vaccine_inventory_quantity ON vaccine_inventory(quantity);
CREATE INDEX IF NOT EXISTS idx_vaccine_inventory_location ON vaccine_inventory(storage_location);

-- Composite index for expiring vaccines query
CREATE INDEX IF NOT EXISTS idx_vaccine_inventory_expiring ON vaccine_inventory(expiry_date, quantity) 
WHERE quantity > 0;

-- Index for low stock alerts
CREATE INDEX IF NOT EXISTS idx_vaccine_inventory_low_stock ON vaccine_inventory(quantity) 
WHERE quantity < 10;

-- ============================================
-- SECTION 7: Notification-related indexes
-- ============================================

-- Indexes for notifications table
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);

-- Composite index for unread notifications
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, is_read, created_at DESC) 
WHERE is_read = false;

-- ============================================
-- SECTION 8: Session and Security indexes
-- ============================================

-- Indexes for user_sessions table
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_token_hash ON user_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions(expires_at);

-- Index for cleaning expired sessions
CREATE INDEX IF NOT EXISTS idx_user_sessions_expired ON user_sessions(expires_at) 
WHERE expires_at < NOW();

-- Indexes for security_events table (if exists)
CREATE INDEX IF NOT EXISTS idx_security_events_user_id ON security_events(user_id);
CREATE INDEX IF NOT EXISTS idx_security_events_event_type ON security_events(event_type);
CREATE INDEX IF NOT EXISTS idx_security_events_created_at ON security_events(created_at);
CREATE INDEX IF NOT EXISTS idx_security_events_ip_address ON security_events(ip_address);

-- ============================================
-- SECTION 9: Guardian-related indexes
-- ============================================

-- Indexes for parent_guardian table
CREATE INDEX IF NOT EXISTS idx_parent_guardian_user_id ON parent_guardian(user_id);
CREATE INDEX IF NOT EXISTS idx_parent_guardian_phone ON parent_guardian(phone);
CREATE INDEX IF NOT EXISTS idx_parent_guardian_email ON parent_guardian(email);

-- ============================================
-- SECTION 10: SMS and Communication indexes
-- ============================================

-- Indexes for sms_logs table (if exists)
CREATE INDEX IF NOT EXISTS idx_sms_logs_recipient ON sms_logs(recipient);
CREATE INDEX IF NOT EXISTS idx_sms_logs_status ON sms_logs(status);
CREATE INDEX IF NOT EXISTS idx_sms_logs_created_at ON sms_logs(created_at);

-- Indexes for sms_verification_codes table (if exists)
CREATE INDEX IF NOT EXISTS idx_sms_verification_phone ON sms_verification_codes(phone_number);
CREATE INDEX IF NOT EXISTS idx_sms_verification_expires ON sms_verification_codes(expires_at);

-- ============================================
-- SECTION 11: Audit and Activity indexes
-- ============================================

-- Indexes for audit_logs table (if exists)
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);

-- Indexes for admin_activity table (if exists)
CREATE INDEX IF NOT EXISTS idx_admin_activity_user_id ON admin_activity(user_id);
CREATE INDEX IF NOT EXISTS idx_admin_activity_created_at ON admin_activity(created_at);

-- ============================================
-- SECTION 12: Growth tracking indexes
-- ============================================

-- Indexes for growth_records table (if exists)
CREATE INDEX IF NOT EXISTS idx_growth_records_infant_id ON growth_records(infant_id);
CREATE INDEX IF NOT EXISTS idx_growth_records_date ON growth_records(measurement_date);
CREATE INDEX IF NOT EXISTS idx_growth_records_infant_date ON growth_records(infant_id, measurement_date DESC);

-- ============================================
-- SECTION 13: Waitlist indexes
-- ============================================

-- Indexes for vaccine_waitlist table (if exists)
CREATE INDEX IF NOT EXISTS idx_vaccine_waitlist_infant_id ON vaccine_waitlist(infant_id);
CREATE INDEX IF NOT EXISTS idx_vaccine_waitlist_vaccine_id ON vaccine_waitlist(vaccine_id);
CREATE INDEX IF NOT EXISTS idx_vaccine_waitlist_status ON vaccine_waitlist(status);
CREATE INDEX IF NOT EXISTS idx_vaccine_waitlist_created_at ON vaccine_waitlist(created_at);

-- ============================================
-- SECTION 14: Analysis queries
-- ============================================

-- Find unused indexes (indexes that have never been used)
SELECT
  schemaname || '.' || relname AS table,
  indexrelname AS index,
  pg_size_pretty(pg_relation_size(i.indexrelid)) AS index_size,
  idx_scan AS index_scans
FROM pg_stat_user_indexes ui
JOIN pg_index i ON ui.indexrelid = i.indexrelid
WHERE NOT indisunique 
  AND idx_scan < 50 
  AND pg_relation_size(relid) > 5 * 8192
ORDER BY pg_relation_size(i.indexrelid) DESC;

-- Find missing indexes (tables with sequential scans)
SELECT
  relname AS table_name,
  seq_scan,
  idx_scan,
  seq_scan::float / GREATEST(idx_scan, 1) AS seq_ratio,
  n_live_tup AS rows
FROM pg_stat_user_tables
WHERE seq_scan > 1000
  AND seq_scan::float / GREATEST(idx_scan, 1) > 10
ORDER BY seq_ratio DESC
LIMIT 10;

-- Index bloat analysis
SELECT
  schemaname,
  tablename,
  indexname,
  pg_size_pretty(pg_relation_size(indexrelid)) AS index_size,
  idx_scan,
  idx_tup_read,
  idx_tup_fetch
FROM pg_stat_user_indexes
JOIN pg_indexes ON pg_stat_user_indexes.indexrelname = pg_indexes.indexname
ORDER BY pg_relation_size(indexrelid) DESC
LIMIT 20;

-- ============================================
-- SECTION 15: Maintenance commands
-- ============================================

-- Analyze tables to update statistics (run periodically)
ANALYZE users;
ANALYZE infants;
ANALYZE appointments;
ANALYZE immunization_records;
ANALYZE notifications;
ANALYZE vaccine_inventory;

-- Reindex if needed (run during maintenance windows)
-- REINDEX INDEX idx_users_username;
-- REINDEX INDEX idx_appointments_scheduled_date;
-- REINDEX INDEX idx_immunization_records_patient_id;

-- ============================================
-- SECTION 16: Verification queries
-- ============================================

-- Verify index creation
SELECT 
  tablename,
  COUNT(*) AS index_count
FROM pg_indexes
WHERE schemaname = 'public'
GROUP BY tablename
ORDER BY index_count DESC;

-- Check index usage for specific table
SELECT
  indexrelname AS index_name,
  idx_scan AS times_used,
  idx_tup_read AS tuples_read,
  idx_tup_fetch AS tuples_fetched
FROM pg_stat_user_indexes
WHERE relname = 'users'
ORDER BY idx_scan DESC;
