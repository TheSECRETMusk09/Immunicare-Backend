/**
 * Database Setup and Initialization Script
 * Creates the core schema required for local development and tests,
 * then ensures baseline reference data exists.
 */

const pool = require('./db');

const logIfVisible = (silent, ...args) => {
  if (!silent) {
    console.log(...args);
  }
};

const ensureCoreSchema = async ({ silent = false } = {}) => {
  logIfVisible(silent, 'Ensuring core database schema...');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS roles (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      permissions JSONB DEFAULT '{}'::jsonb,
      display_name VARCHAR(255),
      is_system_role BOOLEAN NOT NULL DEFAULT FALSE,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      hierarchy_level INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS clinics (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      region VARCHAR(255),
      address TEXT,
      contact VARCHAR(255),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS guardians (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      phone VARCHAR(255) NOT NULL DEFAULT '',
      email VARCHAR(255),
      address TEXT,
      relationship VARCHAR(255),
      emergency_contact VARCHAR(255),
      emergency_phone VARCHAR(50),
      clinic_id INTEGER REFERENCES clinics(id) ON DELETE SET NULL,
      is_password_set BOOLEAN NOT NULL DEFAULT FALSE,
      must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
      last_login TIMESTAMP,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(255) NOT NULL UNIQUE,
      email VARCHAR(255),
      password_hash VARCHAR(255) NOT NULL,
      role_id INTEGER REFERENCES roles(id) ON DELETE SET NULL,
      clinic_id INTEGER REFERENCES clinics(id) ON DELETE SET NULL,
      guardian_id INTEGER REFERENCES guardians(id) ON DELETE SET NULL,
      contact VARCHAR(255),
      first_name VARCHAR(255),
      last_name VARCHAR(255),
      role VARCHAR(50),
      last_login TIMESTAMP,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      force_password_change BOOLEAN NOT NULL DEFAULT FALSE,
      password_changed_at TIMESTAMP WITH TIME ZONE,
      notification_settings JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_sessions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_token TEXT NOT NULL UNIQUE,
      ip_address VARCHAR(45),
      user_agent TEXT,
      device_info JSONB DEFAULT '{}'::jsonb,
      login_method VARCHAR(50),
      login_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_activity TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      logout_time TIMESTAMP,
      session_duration INTEGER,
      expires_at TIMESTAMP WITH TIME ZONE,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT UNIQUE NOT NULL,
      user_agent TEXT,
      ip_address VARCHAR(45),
      is_revoked BOOLEAN DEFAULT false,
      revoked_at TIMESTAMP WITH TIME ZONE,
      expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, token)
    );

    CREATE TABLE IF NOT EXISTS admin_activity_log (
      id SERIAL PRIMARY KEY,
      admin_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      action VARCHAR(100) NOT NULL,
      ip_address VARCHAR(45),
      user_agent TEXT,
      details JSONB,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS patients (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255),
      first_name VARCHAR(255),
      last_name VARCHAR(255),
      middle_name VARCHAR(255),
      dob DATE,
      sex VARCHAR(20),
      national_id VARCHAR(255),
      address TEXT,
      contact VARCHAR(255),
      allergy_information TEXT,
      health_care_provider VARCHAR(255),
      photo_url TEXT,
      guardian_id INTEGER REFERENCES guardians(id) ON DELETE SET NULL,
      clinic_id INTEGER REFERENCES clinics(id) ON DELETE SET NULL,
      facility_id INTEGER REFERENCES clinics(id) ON DELETE SET NULL,
      control_number VARCHAR(40) UNIQUE,
      birth_height DECIMAL(5, 2),
      birth_weight DECIMAL(5, 3),
      mother_name VARCHAR(255),
      father_name VARCHAR(255),
      barangay VARCHAR(255),
      health_center VARCHAR(255),
      purok VARCHAR(50),
      street_color VARCHAR(255),
      family_no VARCHAR(50),
      place_of_birth VARCHAR(255),
      time_of_delivery TIME,
      type_of_delivery VARCHAR(100),
      doctor_midwife_nurse VARCHAR(255),
      nbs_done BOOLEAN DEFAULT FALSE,
      nbs_date DATE,
      cellphone_number VARCHAR(50),
      transfer_in_source VARCHAR(255),
      validation_status VARCHAR(50),
      auto_computed_next_vaccine VARCHAR(255),
      age_months INTEGER,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS infant_allergies (
      id SERIAL PRIMARY KEY,
      infant_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      allergy_type VARCHAR(100),
      allergen VARCHAR(255),
      severity VARCHAR(50),
      reaction_description TEXT,
      onset_date DATE,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS vaccines (
      id SERIAL PRIMARY KEY,
      code VARCHAR(100) NOT NULL UNIQUE,
      name VARCHAR(255) NOT NULL,
      manufacturer VARCHAR(255),
      doses_required INTEGER NOT NULL DEFAULT 1,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS vaccination_schedules (
      id SERIAL PRIMARY KEY,
      vaccine_id INTEGER REFERENCES vaccines(id) ON DELETE SET NULL,
      vaccine_name VARCHAR(255),
      vaccine_code VARCHAR(100),
      dose_number INTEGER NOT NULL DEFAULT 1,
      total_doses INTEGER NOT NULL DEFAULT 1,
      age_in_months INTEGER NOT NULL DEFAULT 0,
      minimum_age_days INTEGER NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS immunization_records (
      id SERIAL PRIMARY KEY,
      patient_id INTEGER REFERENCES patients(id) ON DELETE CASCADE,
      infant_id INTEGER,
      vaccine_id INTEGER REFERENCES vaccines(id) ON DELETE SET NULL,
      batch_id INTEGER,
      dose_no INTEGER NOT NULL DEFAULT 1,
      admin_date TIMESTAMP,
      status VARCHAR(50) DEFAULT 'completed',
      source_facility VARCHAR(255),
      is_imported BOOLEAN NOT NULL DEFAULT FALSE,
      transfer_case_id INTEGER,
      notes TEXT,
      schedule_id INTEGER,
      administered_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      vaccinator_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS infant_vaccine_readiness (
      id SERIAL PRIMARY KEY,
      infant_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      vaccine_id INTEGER NOT NULL REFERENCES vaccines(id) ON DELETE CASCADE,
      is_ready BOOLEAN NOT NULL DEFAULT FALSE,
      ready_confirmed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      ready_confirmed_at TIMESTAMP,
      notes TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT unique_infant_vaccine_readiness UNIQUE (infant_id, vaccine_id, is_active)
    );

    CREATE TABLE IF NOT EXISTS transfer_in_cases (
      id SERIAL PRIMARY KEY,
      guardian_id INTEGER REFERENCES guardians(id) ON DELETE SET NULL,
      infant_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      validation_status VARCHAR(50),
      source_facility VARCHAR(255),
      submitted_vaccines JSONB,
      vaccination_card_url TEXT,
      remarks TEXT,
      validation_priority VARCHAR(50),
      triage_category VARCHAR(100),
      auto_approved BOOLEAN NOT NULL DEFAULT FALSE,
      validation_summary JSONB,
      approved_vaccines JSONB,
      vaccines_imported BOOLEAN NOT NULL DEFAULT FALSE,
      vaccines_imported_at TIMESTAMP,
      validation_notes TEXT,
      next_recommended_vaccine VARCHAR(255),
      auto_computed_next_vaccine VARCHAR(255),
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS appointments (
      id SERIAL PRIMARY KEY,
      infant_id INTEGER REFERENCES patients(id) ON DELETE SET NULL,
      patient_id INTEGER,
      scheduled_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      type VARCHAR(255),
      status VARCHAR(50) NOT NULL DEFAULT 'scheduled',
      notes TEXT,
      cancellation_reason TEXT,
      completion_notes TEXT,
      duration_minutes INTEGER DEFAULT 30,
      location VARCHAR(255),
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      guardian_id INTEGER REFERENCES guardians(id) ON DELETE SET NULL,
      clinic_id INTEGER REFERENCES clinics(id) ON DELETE SET NULL,
      facility_id INTEGER REFERENCES clinics(id) ON DELETE SET NULL,
      vaccine_id INTEGER REFERENCES vaccines(id) ON DELETE SET NULL,
      control_number VARCHAR(20) UNIQUE,
      sms_confirmation_sent BOOLEAN NOT NULL DEFAULT FALSE,
      sms_confirmation_sent_at TIMESTAMP,
      confirmation_status VARCHAR(50),
      confirmed_at TIMESTAMP,
      confirmation_method VARCHAR(50),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS appointment_control_numbers (
      id SERIAL PRIMARY KEY,
      control_date DATE NOT NULL UNIQUE,
      sequence_number INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS blocked_dates (
      id SERIAL PRIMARY KEY,
      blocked_date DATE NOT NULL UNIQUE,
      is_blocked BOOLEAN NOT NULL DEFAULT TRUE,
      reason TEXT,
      blocked_by INTEGER,
      clinic_id INTEGER REFERENCES clinics(id) ON DELETE SET NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS vaccine_batches (
      id SERIAL PRIMARY KEY,
      vaccine_id INTEGER NOT NULL REFERENCES vaccines(id) ON DELETE CASCADE,
      clinic_id INTEGER REFERENCES clinics(id) ON DELETE SET NULL,
      facility_id INTEGER REFERENCES clinics(id) ON DELETE SET NULL,
      lot_number VARCHAR(100),
      qty_current INTEGER NOT NULL DEFAULT 0,
      status VARCHAR(50) NOT NULL DEFAULT 'active',
      expiry_date DATE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS appointment_confirmations (
      id SERIAL PRIMARY KEY,
      appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
      guardian_id INTEGER,
      message TEXT,
      status VARCHAR(50) NOT NULL DEFAULT 'sent',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS incoming_sms (
      id SERIAL PRIMARY KEY,
      phone_number VARCHAR(20) NOT NULL,
      message TEXT NOT NULL,
      keyword VARCHAR(50),
      processed BOOLEAN NOT NULL DEFAULT FALSE,
      processed_at TIMESTAMP,
      related_appointment_id INTEGER,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      guardian_id INTEGER,
      title VARCHAR(255),
      type VARCHAR(100),
      category VARCHAR(100),
      is_read BOOLEAN NOT NULL DEFAULT FALSE,
      notification_type VARCHAR(255),
      target_type VARCHAR(255),
      target_id INTEGER,
      recipient_name VARCHAR(255),
      recipient_email VARCHAR(255),
      recipient_phone VARCHAR(50),
      channel VARCHAR(50) DEFAULT 'sms',
      priority VARCHAR(50) DEFAULT 'normal',
      status VARCHAR(50) DEFAULT 'pending',
      scheduled_for TIMESTAMP WITH TIME ZONE,
      sent_at TIMESTAMP WITH TIME ZONE,
      delivered_at TIMESTAMP WITH TIME ZONE,
      read_at TIMESTAMP WITH TIME ZONE,
      failed_at TIMESTAMP WITH TIME ZONE,
      failure_reason TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      max_retries INTEGER NOT NULL DEFAULT 3,
      subject VARCHAR(255),
      message TEXT NOT NULL DEFAULT '',
      template_id VARCHAR(100),
      template_data JSONB,
      related_entity_type VARCHAR(100),
      related_entity_id INTEGER,
      external_message_id VARCHAR(255),
      provider_response JSONB,
      delivery_status JSONB,
      cost DECIMAL(10, 2),
      language VARCHAR(10) DEFAULT 'en',
      timezone VARCHAR(50),
      target_role VARCHAR(100),
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sms_logs (
      id SERIAL PRIMARY KEY,
      phone_number VARCHAR(20) NOT NULL,
      message TEXT,
      message_content TEXT,
      message_type VARCHAR(50) NOT NULL DEFAULT 'general',
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      provider VARCHAR(20) NOT NULL DEFAULT 'log',
      external_message_id VARCHAR(100),
      message_id VARCHAR(100),
      metadata JSONB,
      attempts JSONB,
      sent_at TIMESTAMP,
      failed_at TIMESTAMP,
      error_details TEXT,
      error_message TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS vaccine_inventory (
      id SERIAL PRIMARY KEY,
      vaccine_id INTEGER NOT NULL REFERENCES vaccines(id) ON DELETE CASCADE,
      clinic_id INTEGER REFERENCES clinics(id) ON DELETE SET NULL,
      facility_id INTEGER REFERENCES clinics(id) ON DELETE SET NULL,
      beginning_balance INTEGER NOT NULL DEFAULT 0,
      received_during_period INTEGER NOT NULL DEFAULT 0,
      lot_batch_number VARCHAR(100),
      transferred_in INTEGER NOT NULL DEFAULT 0,
      transferred_out INTEGER NOT NULL DEFAULT 0,
      expired_wasted INTEGER NOT NULL DEFAULT 0,
      ending_balance INTEGER NOT NULL DEFAULT 0,
      stock_on_hand INTEGER NOT NULL DEFAULT 0,
      doses_administered INTEGER NOT NULL DEFAULT 0,
      doses_wasted INTEGER NOT NULL DEFAULT 0,
      period_start DATE,
      period_end DATE,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS vaccine_inventory_transactions (
      id SERIAL PRIMARY KEY,
      vaccine_inventory_id INTEGER REFERENCES vaccine_inventory(id) ON DELETE CASCADE,
      vaccine_id INTEGER REFERENCES vaccines(id) ON DELETE SET NULL,
      clinic_id INTEGER REFERENCES clinics(id) ON DELETE SET NULL,
      transaction_type VARCHAR(50) NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 0,
      lot_number VARCHAR(100),
      batch_number VARCHAR(100),
      expiry_date DATE,
      supplier_name VARCHAR(255),
      reference_number VARCHAR(255),
      notes TEXT,
      transaction_date DATE,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS vaccine_stock_alerts (
      id SERIAL PRIMARY KEY,
      vaccine_inventory_id INTEGER REFERENCES vaccine_inventory(id) ON DELETE CASCADE,
      vaccine_id INTEGER REFERENCES vaccines(id) ON DELETE SET NULL,
      clinic_id INTEGER REFERENCES clinics(id) ON DELETE SET NULL,
      facility_id INTEGER REFERENCES clinics(id) ON DELETE SET NULL,
      alert_type VARCHAR(100) NOT NULL DEFAULT 'LOW_STOCK',
      current_stock INTEGER NOT NULL DEFAULT 0,
      threshold_value INTEGER NOT NULL DEFAULT 0,
      status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
      priority VARCHAR(50) NOT NULL DEFAULT 'HIGH',
      message TEXT,
      acknowledged_at TIMESTAMP,
      resolved_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id SERIAL PRIMARY KEY,
      admin_id INTEGER,
      username VARCHAR(255),
      role VARCHAR(100),
      event_type VARCHAR(255) NOT NULL,
      entity_type VARCHAR(255),
      entity_id INTEGER,
      old_values JSONB,
      new_values JSONB,
      metadata JSONB,
      details JSONB,
      severity VARCHAR(20) DEFAULT 'INFO',
      ip_address VARCHAR(45),
      user_agent TEXT,
      success BOOLEAN NOT NULL DEFAULT TRUE,
      error_message TEXT,
      timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS paper_templates (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      template_type VARCHAR(100) NOT NULL,
      fields JSONB,
      validation_rules JSONB,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS document_generation (
      id SERIAL PRIMARY KEY,
      template_id INTEGER REFERENCES paper_templates(id) ON DELETE SET NULL,
      infant_id INTEGER REFERENCES patients(id) ON DELETE SET NULL,
      guardian_id INTEGER REFERENCES guardians(id) ON DELETE SET NULL,
      generated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      file_path TEXT,
      file_name VARCHAR(255),
      file_size INTEGER,
      mime_type VARCHAR(255),
      status VARCHAR(50) NOT NULL DEFAULT 'generated',
      title VARCHAR(255),
      notes TEXT,
      tags JSONB,
      generated_data JSONB,
      download_count INTEGER NOT NULL DEFAULT 0,
      last_downloaded TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS first_name VARCHAR(255),
      ADD COLUMN IF NOT EXISTS last_name VARCHAR(255);

    CREATE TABLE IF NOT EXISTS digital_papers (
      id SERIAL PRIMARY KEY,
      document_generation_id INTEGER NOT NULL REFERENCES document_generation(id) ON DELETE CASCADE,
      title VARCHAR(255),
      document_type VARCHAR(100),
      content TEXT,
      metadata JSONB,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS document_shares (
      id SERIAL PRIMARY KEY,
      document_id INTEGER NOT NULL REFERENCES document_generation(id) ON DELETE CASCADE,
      shared_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      shared_with_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      shared_with_guardian_id INTEGER REFERENCES guardians(id) ON DELETE SET NULL,
      access_type VARCHAR(50) NOT NULL DEFAULT 'view',
      expires_at TIMESTAMP,
      shared_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS paper_completion_status (
      id SERIAL PRIMARY KEY,
      infant_id INTEGER REFERENCES patients(id) ON DELETE CASCADE,
      template_id INTEGER REFERENCES paper_templates(id) ON DELETE CASCADE,
      completion_status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
      completed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      completion_percentage NUMERIC(5, 2),
      last_updated TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    ALTER TABLE paper_completion_status
      ADD COLUMN IF NOT EXISTS patient_id INTEGER REFERENCES patients(id) ON DELETE CASCADE,
      ADD COLUMN IF NOT EXISTS completion_percentage NUMERIC(5, 2),
      ADD COLUMN IF NOT EXISTS completed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS last_updated TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;

    CREATE TABLE IF NOT EXISTS document_downloads (
      id SERIAL PRIMARY KEY,
      template_id INTEGER REFERENCES paper_templates(id) ON DELETE SET NULL,
      infant_id INTEGER REFERENCES patients(id) ON DELETE SET NULL,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      download_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      download_status VARCHAR(50) NOT NULL DEFAULT 'COMPLETED',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    ALTER TABLE document_downloads
      ADD COLUMN IF NOT EXISTS patient_id INTEGER REFERENCES patients(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS download_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS download_status VARCHAR(50) NOT NULL DEFAULT 'COMPLETED',
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;

    CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(session_token);
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token ON refresh_tokens(token);
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);
    CREATE INDEX IF NOT EXISTS idx_admin_activity_log_admin_id ON admin_activity_log(admin_id);
    CREATE INDEX IF NOT EXISTS idx_admin_activity_log_action ON admin_activity_log(action);
    CREATE INDEX IF NOT EXISTS idx_admin_activity_log_created_at ON admin_activity_log(created_at);
    CREATE INDEX IF NOT EXISTS idx_sms_logs_phone ON sms_logs(phone_number);
    CREATE INDEX IF NOT EXISTS idx_sms_logs_status ON sms_logs(status);
    CREATE INDEX IF NOT EXISTS idx_sms_logs_created ON sms_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_patients_guardian_id ON patients(guardian_id);
    CREATE INDEX IF NOT EXISTS idx_patients_clinic_id ON patients(clinic_id);
    CREATE INDEX IF NOT EXISTS idx_infant_allergies_infant_id ON infant_allergies(infant_id);
    CREATE INDEX IF NOT EXISTS idx_transfer_in_cases_infant_id ON transfer_in_cases(infant_id);
    CREATE INDEX IF NOT EXISTS idx_document_shares_document_id ON document_shares(document_id);
    CREATE INDEX IF NOT EXISTS idx_document_shares_shared_with_user_id ON document_shares(shared_with_user_id);
    CREATE INDEX IF NOT EXISTS idx_document_shares_shared_with_guardian_id ON document_shares(shared_with_guardian_id);
    CREATE INDEX IF NOT EXISTS idx_paper_completion_status_infant_id ON paper_completion_status(infant_id);
    CREATE INDEX IF NOT EXISTS idx_paper_completion_status_patient_id ON paper_completion_status(patient_id);
    CREATE INDEX IF NOT EXISTS idx_paper_completion_status_template_id ON paper_completion_status(template_id);
    CREATE INDEX IF NOT EXISTS idx_paper_completion_status_status ON paper_completion_status(completion_status);
    CREATE INDEX IF NOT EXISTS idx_document_downloads_infant_id ON document_downloads(infant_id);
    CREATE INDEX IF NOT EXISTS idx_document_downloads_patient_id ON document_downloads(patient_id);
    CREATE INDEX IF NOT EXISTS idx_document_downloads_template_id ON document_downloads(template_id);
    CREATE INDEX IF NOT EXISTS idx_document_downloads_user_id ON document_downloads(user_id);
    CREATE INDEX IF NOT EXISTS idx_appointments_infant_id ON appointments(infant_id);
    CREATE INDEX IF NOT EXISTS idx_appointment_control_numbers_date ON appointment_control_numbers(control_date);
    CREATE INDEX IF NOT EXISTS idx_blocked_dates_date ON blocked_dates(blocked_date);
    CREATE INDEX IF NOT EXISTS idx_vaccine_batches_vaccine_id ON vaccine_batches(vaccine_id);
    CREATE INDEX IF NOT EXISTS idx_vaccine_batches_status ON vaccine_batches(status);
    CREATE INDEX IF NOT EXISTS idx_appointment_confirmations_appointment_id ON appointment_confirmations(appointment_id);
    CREATE INDEX IF NOT EXISTS idx_incoming_sms_phone_number ON incoming_sms(phone_number);
    CREATE INDEX IF NOT EXISTS idx_immunization_records_patient_id ON immunization_records(patient_id);
    CREATE INDEX IF NOT EXISTS idx_vaccine_inventory_clinic_id ON vaccine_inventory(clinic_id);
    CREATE INDEX IF NOT EXISTS idx_vaccine_stock_alerts_inventory_id ON vaccine_stock_alerts(vaccine_inventory_id);
    CREATE INDEX IF NOT EXISTS idx_vaccine_stock_alerts_status ON vaccine_stock_alerts(status);
    CREATE INDEX IF NOT EXISTS idx_vaccine_stock_alerts_clinic_id ON vaccine_stock_alerts(clinic_id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_event_type ON audit_logs(event_type);

    ALTER TABLE guardians ADD COLUMN IF NOT EXISTS emergency_contact VARCHAR(255);
    ALTER TABLE guardians ADD COLUMN IF NOT EXISTS emergency_phone VARCHAR(50);
    ALTER TABLE patients ADD COLUMN IF NOT EXISTS allergy_information TEXT;
    ALTER TABLE patients ADD COLUMN IF NOT EXISTS health_care_provider VARCHAR(255);
    ALTER TABLE appointments ADD COLUMN IF NOT EXISTS guardian_id INTEGER REFERENCES guardians(id) ON DELETE SET NULL;
    ALTER TABLE appointments ADD COLUMN IF NOT EXISTS control_number VARCHAR(20);
    ALTER TABLE appointments ADD COLUMN IF NOT EXISTS sms_confirmation_sent BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE appointments ADD COLUMN IF NOT EXISTS sms_confirmation_sent_at TIMESTAMP;
    ALTER TABLE appointments ADD COLUMN IF NOT EXISTS confirmation_status VARCHAR(50);
    ALTER TABLE appointments ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMP;
    ALTER TABLE appointments ADD COLUMN IF NOT EXISTS confirmation_method VARCHAR(50);
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS user_id INTEGER;
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS guardian_id INTEGER;
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS title VARCHAR(255);
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS type VARCHAR(100);
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS category VARCHAR(100);
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS is_read BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS target_role VARCHAR(100);
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS delivery_attempts INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMP WITH TIME ZONE;
    ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS login_method VARCHAR(50);
    ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS session_duration INTEGER;
    ALTER TABLE immunization_records ADD COLUMN IF NOT EXISTS next_due_date DATE;
  `);
};

const ensureCoreReferenceData = async ({ silent = false } = {}) => {
  logIfVisible(silent, 'Ensuring core reference data...');

  await pool.query(`
    INSERT INTO roles (name, display_name, is_system_role, hierarchy_level, permissions)
    VALUES
      ('super_admin', 'Super Admin', true, 100, '{"system":{"all":true}}'::jsonb),
      ('system_admin', 'System Administrator', true, 95, '{"system":{"all":true}}'::jsonb),
      ('admin', 'Administrator', true, 90, '{"system":{"all":true}}'::jsonb),
      ('clinic_manager', 'Clinic Manager', true, 50, '{"clinic":{"all":true}}'::jsonb),
      ('guardian', 'Guardian', false, 20, '{"guardian":{"own_children":true}}'::jsonb)
    ON CONFLICT (name) DO NOTHING;
  `);

  await pool.query(`
    INSERT INTO vaccines (code, name, manufacturer, doses_required, is_active)
    VALUES
      ('BCG', 'BCG', 'Default', 1, true),
      ('HEPA_B', 'Hepa B', 'Default', 1, true)
    ON CONFLICT (code) DO NOTHING;
  `);
};

/**
 * Initialize database tables and default data
 * @param {Object} options - Configuration options
 * @param {boolean} options.closePool - Whether to close the pool after initialization (default: true for CLI, false for tests)
 * @param {boolean} options.silent - Suppress console output (useful for tests)
 */
async function initializeDatabase(options = {}) {
  const { closePool = false, silent = false } = options;

  if (!silent) {
    console.log('='.repeat(70));
    console.log('IMMUNICARE DATABASE INITIALIZATION');
    console.log('='.repeat(70));
    console.log();
  }

  try {
    await ensureCoreSchema({ silent });
    await ensureCoreReferenceData({ silent });

    // Create security_events table
    logIfVisible(silent, 'Creating security_events table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS security_events (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        event_type VARCHAR(100) NOT NULL,
        severity VARCHAR(20) NOT NULL,
        ip_address VARCHAR(45),
        user_agent TEXT,
        resource_type VARCHAR(100),
        resource_id INTEGER,
        details JSONB,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_security_events_user_id ON security_events(user_id);
      CREATE INDEX IF NOT EXISTS idx_security_events_ip_address ON security_events(ip_address);
      CREATE INDEX IF NOT EXISTS idx_security_events_event_type ON security_events(event_type);
      CREATE INDEX IF NOT EXISTS idx_security_events_severity ON security_events(severity);
      CREATE INDEX IF NOT EXISTS idx_security_events_created_at ON security_events(created_at);
    `);
    logIfVisible(silent, 'security_events table created/verified');

    // Create Guardian Portal clinic if not exists
    logIfVisible(silent, 'Creating Guardian Portal clinic...');
    await pool.query(`
      INSERT INTO clinics (name, region, address, contact)
      VALUES ('Guardian Portal', 'Virtual', 'Online Portal', 'portal@immunicare.com')
      ON CONFLICT (name) DO NOTHING
    `);
    logIfVisible(silent, 'Guardian Portal clinic created/verified');

    // Create guardian role if not exists
    logIfVisible(silent, 'Creating guardian role...');
    await pool.query(`
      INSERT INTO roles (name, display_name, is_system_role, hierarchy_level, permissions)
      VALUES ('guardian', 'Guardian', false, 20, '{"can_view_own_children": true, "can_view_appointments": true}'::jsonb)
      ON CONFLICT (name) DO NOTHING
    `);
    logIfVisible(silent, 'guardian role created/verified');

    // Ensure admin user exists with correct password
    logIfVisible(silent, 'Verifying admin user...');
    const adminPasswordHash = '$2b$10$rOz8QK.hVv7YJHQv5tKQ9uJjRrQw5b9wN6mH8pC2xY7zA1kL3mN9q'; // Admin2024!

    const adminCheck = await pool.query('SELECT id FROM users WHERE username = \'admin\'');
    if (adminCheck.rows.length === 0) {
      const roleResult = await pool.query(
        'SELECT id FROM roles WHERE name = \'super_admin\' LIMIT 1',
      );
      const clinicResult = await pool.query(
        'SELECT id FROM clinics WHERE name = \'Guardian Portal\' LIMIT 1',
      );

      if (roleResult.rows.length > 0 && clinicResult.rows.length > 0) {
        await pool.query(
          `INSERT INTO users (username, password_hash, role_id, clinic_id, email, contact, is_active, role)
           VALUES ($1, $2, $3, $4, $5, $6, true, $7)`,
          [
            'admin',
            adminPasswordHash,
            roleResult.rows[0].id,
            clinicResult.rows[0].id,
            'admin@immunicare.com',
            'admin@immunicare.com',
            'super_admin',
          ],
        );
        logIfVisible(silent, 'Admin user created with password: Admin2024!');
      } else {
        logIfVisible(silent, 'Could not create admin user - role or clinic not found');
      }
    } else {
      logIfVisible(silent, 'Admin user already exists');
    }

    if (!silent) {
      console.log('='.repeat(70));
      console.log('DATABASE INITIALIZATION COMPLETE');
      console.log('='.repeat(70));
      console.log();
      console.log('Admin Credentials:');
      console.log('  Username: admin');
      console.log('  Password: Admin2024!');
      console.log();
    }
  } catch (error) {
    if (!silent) {
      console.error('Database initialization error:', error);
    }
    throw error;
  } finally {
    if (closePool) {
      await pool.end();
    }
  }
}

// Run if called directly
if (require.main === module) {
  initializeDatabase({ closePool: true })
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = { initializeDatabase };
