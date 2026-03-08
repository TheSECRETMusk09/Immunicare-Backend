-- ============================================================================
-- IMMUNICARE DATABASE SCHEMA
-- PostgreSQL Database for Immunicare Healthcare Management System
-- Version: 2.1.0
-- Date: 2026-02-04
-- Description: Consolidated production-ready schema (canonical source of truth)
-- Changes: Renamed users to admin, added admin_role column
-- ============================================================================

-- ============================================================================
-- SECTION A: EXTENSIONS
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- SECTION B: ENUM TYPE DEFINITIONS
-- ============================================================================

DO $$
BEGIN
    -- Admin role enumeration
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'admin_role') THEN
        CREATE TYPE admin_role AS ENUM ('admin', 'super_admin', 'doctor', 'nurse');
    END IF;

    -- Infant sex enumeration
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'infant_sex') THEN
        CREATE TYPE infant_sex AS ENUM ('male', 'female');
    END IF;

    -- Record type enumeration
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'record_type') THEN
        CREATE TYPE record_type AS ENUM (
            'vaccination_certificate', 'birth_certificate', 'medical_report',
            'growth_chart', 'allergy_record', 'medication_record', 'lab_result',
            'imaging_result', 'consultation_note', 'discharge_summary',
            'immunization_card', 'developmental_assessment', 'hearing_screening',
            'vision_screening', 'dental_record', 'other'
        );
    END IF;

    -- Signature status enumeration
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'signature_status') THEN
        CREATE TYPE signature_status AS ENUM ('not_required', 'pending', 'verified', 'rejected');
    END IF;

    -- Vaccine type enumeration
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vaccine_type') THEN
        CREATE TYPE vaccine_type AS ENUM (
            'live_attenuated', 'inactivated', 'subunit', 'toxoid', 'mrna',
            'viral_vector', 'conjugate', 'combination', 'other'
        );
    END IF;

    -- Administration route enumeration
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'administration_route') THEN
        CREATE TYPE administration_route AS ENUM ('intramuscular', 'subcutaneous', 'oral', 'intranasal', 'intradermal');
    END IF;

    -- Priority level enumeration
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'priority_level') THEN
        CREATE TYPE priority_level AS ENUM ('high', 'medium', 'low');
    END IF;

    -- Approval status enumeration
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'approval_status') THEN
        CREATE TYPE approval_status AS ENUM ('draft', 'pending_review', 'approved', 'deprecated');
    END IF;

    -- Scope type enumeration
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'scope_type') THEN
        CREATE TYPE scope_type AS ENUM ('global', 'clinic', 'own', 'assigned');
    END IF;

    -- Item type enumeration
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'item_type') THEN
        CREATE TYPE item_type AS ENUM ('vaccine', 'medicine');
    END IF;

    -- Transaction type enumeration
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transaction_type') THEN
        CREATE TYPE transaction_type AS ENUM ('receive', 'issue', 'wastage', 'adjust');
    END IF;

    -- Batch status enumeration
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'batch_status') THEN
        CREATE TYPE batch_status AS ENUM ('active', 'expired', 'depleted');
    END IF;

    -- Appointment status enumeration
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'appointment_status') THEN
        CREATE TYPE appointment_status AS ENUM ('scheduled', 'attended', 'no_show', 'rescheduled', 'cancelled');
    END IF;

    -- Medicine type enumeration (REMOVED - system focuses on vaccines only)
    -- IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'medicine_type') THEN
    --     CREATE TYPE medicine_type AS ENUM ('illness', 'allergies', 'antibiotics', 'vitamins', 'other');
    -- END IF;

    -- Medicine form enumeration (REMOVED - system focuses on vaccines only)
    -- IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'medicine_form') THEN
    --     CREATE TYPE medicine_form AS ENUM ('pills', 'creams', 'injections', 'inhalers', 'syrup', 'other');
    -- END IF;

    -- Target audience enumeration
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'target_audience') THEN
        CREATE TYPE target_audience AS ENUM ('all', 'patients', 'staff');
    END IF;

    -- Announcement priority enumeration
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'announcement_priority') THEN
        CREATE TYPE announcement_priority AS ENUM ('low', 'medium', 'high', 'urgent');
    END IF;

    -- Channel type enumeration
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'channel_type') THEN
        CREATE TYPE channel_type AS ENUM ('sms', 'email', 'push', 'both');
    END IF;

    -- Notification priority enumeration
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_priority') THEN
        CREATE TYPE notification_priority AS ENUM ('low', 'normal', 'high', 'urgent');
    END IF;

    -- Notification status enumeration
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_status') THEN
        CREATE TYPE notification_status AS ENUM ('pending', 'queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'cancelled');
    END IF;

    -- Frequency type enumeration
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'frequency_type') THEN
        CREATE TYPE frequency_type AS ENUM ('immediate', 'daily', 'weekly', 'monthly');
    END IF;

    -- Report type enumeration
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'report_type') THEN
        CREATE TYPE report_type AS ENUM ('vaccination', 'inventory', 'appointment', 'guardian', 'infant', 'system', 'custom');
    END IF;

    -- Report status enumeration
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'report_status') THEN
        CREATE TYPE report_status AS ENUM ('generating', 'completed', 'failed');
    END IF;

    -- File format enumeration
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'file_format') THEN
        CREATE TYPE file_format AS ENUM ('pdf', 'excel', 'csv', 'json');
    END IF;

    -- Supplier type enumeration
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'supplier_type') THEN
        CREATE TYPE supplier_type AS ENUM (
            'pharmaceutical', 'medical_supplies', 'equipment', 'vaccines',
            'laboratory', 'distributor', 'manufacturer', 'wholesaler', 'other'
        );
    END IF;

    -- Payment method enumeration
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_method') THEN
        CREATE TYPE payment_method AS ENUM ('check', 'bank_transfer', 'credit_card', 'cash', 'other');
    END IF;

    -- Login method enumeration
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'login_method') THEN
        CREATE TYPE login_method AS ENUM ('password', 'social', 'impersonation', 'api');
    END IF;

    -- Measurement method enumeration
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'measurement_method') THEN
        CREATE TYPE measurement_method AS ENUM ('digital_scale', 'manual_scale', 'length_board', 'tape_measure', 'other');
    END IF;

    -- Feeding status enumeration
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'feeding_status') THEN
        CREATE TYPE feeding_status AS ENUM ('before_feeding', 'after_feeding', 'fasting', 'unknown');
    END IF;

    -- Health status enumeration
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'health_status') THEN
        CREATE TYPE health_status AS ENUM ('well', 'minor_illness', 'acute_illness', 'chronic_condition');
    END IF;

    -- Growth pattern enumeration
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'growth_pattern') THEN
        CREATE TYPE growth_pattern AS ENUM ('normal', 'slow', 'rapid', 'irregular', 'concerning');
    END IF;

    -- Nutritional status enumeration
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'nutritional_status') THEN
        CREATE TYPE nutritional_status AS ENUM ('normal', 'underweight', 'overweight', 'obese', 'wasted', 'stunted');
    END IF;

    -- Vaccination status enumeration
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vaccination_status') THEN
        CREATE TYPE vaccination_status AS ENUM ('scheduled', 'completed', 'overdue', 'cancelled');
    END IF;

    -- Patient sex enumeration
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'patient_sex') THEN
        CREATE TYPE patient_sex AS ENUM ('male', 'female', 'other');
    END IF;

    -- Inventory status enumeration
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inventory_status') THEN
        CREATE TYPE inventory_status AS ENUM ('good', 'low', 'critical', 'expired');
    END IF;

    -- Certificate type enumeration
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'certificate_type') THEN
        CREATE TYPE certificate_type AS ENUM ('official', 'digital_wallet', 'print_friendly', 'summary_report');
    END IF;
END $$;

-- ============================================================================
-- SECTION C: CORE REFERENCE TABLES
-- ============================================================================

-- Healthcare facilities (clinics) table
CREATE TABLE IF NOT EXISTS healthcare_facilities (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    region VARCHAR(255),
    address TEXT,
    contact VARCHAR(255),
    facility_type VARCHAR(50) DEFAULT 'health_center',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE healthcare_facilities IS 'Stores healthcare facility/clinic information';

-- Admins table (formerly users)
CREATE TABLE IF NOT EXISTS admin (
    id SERIAL PRIMARY KEY,
    username VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role admin_role NOT NULL DEFAULT 'admin',
    facility_id INTEGER NOT NULL REFERENCES healthcare_facilities(id) ON UPDATE CASCADE ON DELETE CASCADE,
    contact VARCHAR(255),
    email VARCHAR(255),
    last_login TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE admin IS 'Stores admin/staff user account information and authentication data';

-- Guardians table
CREATE TABLE IF NOT EXISTS guardians (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    address TEXT,
    relationship VARCHAR(255),
    password_hash VARCHAR(255),
    is_password_set BOOLEAN DEFAULT FALSE,
    last_login TIMESTAMP WITH TIME ZONE,
    must_change_password BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE guardians IS 'Stores guardian/parent information for patients';

-- Patients table (formerly infants)
CREATE TABLE IF NOT EXISTS patients (
    id SERIAL PRIMARY KEY,
    first_name VARCHAR(255) NOT NULL,
    last_name VARCHAR(255) NOT NULL,
    middle_name VARCHAR(255),
    dob DATE NOT NULL,
    sex infant_sex NOT NULL,
    national_id VARCHAR(255),
    address TEXT,
    contact VARCHAR(255),
    guardian_id INTEGER NOT NULL REFERENCES guardians(id) ON UPDATE CASCADE ON DELETE CASCADE,
    facility_id INTEGER REFERENCES healthcare_facilities(id) ON UPDATE CASCADE ON DELETE SET NULL,
    birth_height DECIMAL(5, 2),
    birth_weight DECIMAL(5, 3),
    mother_name VARCHAR(255),
    father_name VARCHAR(255),
    barangay VARCHAR(255),
    health_center VARCHAR(255),
    family_no VARCHAR(50),
    place_of_birth VARCHAR(255),
    time_of_delivery TIME,
    type_of_delivery VARCHAR(10),
    doctor_midwife_nurse VARCHAR(20),
    nbs_done BOOLEAN DEFAULT FALSE,
    nbs_date DATE,
    cellphone_number VARCHAR(20),
    photo_url VARCHAR(500),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE patients IS 'Stores patient demographic and medical information';

-- ============================================================================
-- SECTION D: DOMAIN TABLES
-- ============================================================================

-- Vaccines table
CREATE TABLE IF NOT EXISTS vaccines (
    id SERIAL PRIMARY KEY,
    code VARCHAR(255) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    manufacturer VARCHAR(255),
    recommended_age VARCHAR(255),
    dosage VARCHAR(255),
    doses_required INTEGER NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE vaccines IS 'Stores vaccine information and specifications';

-- Vaccine batches table
CREATE TABLE IF NOT EXISTS vaccine_batches (
    id SERIAL PRIMARY KEY,
    vaccine_id INTEGER NOT NULL REFERENCES vaccines(id) ON UPDATE CASCADE ON DELETE CASCADE,
    lot_no VARCHAR(255) NOT NULL,
    expiry_date DATE NOT NULL,
    manufacture_date DATE,
    qty_received INTEGER NOT NULL,
    qty_current INTEGER NOT NULL DEFAULT 0,
    qty_initial INTEGER,
    supplier_id INTEGER,
    facility_id INTEGER NOT NULL REFERENCES healthcare_facilities(id) ON UPDATE CASCADE ON DELETE CASCADE,
    storage_conditions TEXT,
    status batch_status NOT NULL DEFAULT 'active',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE vaccine_batches IS 'Tracks vaccine batch inventory and expiry information';

-- Vaccination records table
CREATE TABLE IF NOT EXISTS immunization_records (
    id SERIAL PRIMARY KEY,
    patient_id INTEGER NOT NULL REFERENCES patients(id) ON UPDATE CASCADE ON DELETE CASCADE,
    vaccine_id INTEGER NOT NULL REFERENCES vaccines(id) ON UPDATE CASCADE ON DELETE CASCADE,
    batch_id INTEGER NOT NULL REFERENCES vaccine_batches(id) ON UPDATE CASCADE ON DELETE CASCADE,
    dose_no INTEGER NOT NULL,
    admin_date TIMESTAMP WITH TIME ZONE NOT NULL,
    administered_by INTEGER REFERENCES admin(id) ON UPDATE CASCADE ON DELETE SET NULL,
    vaccinator_id INTEGER REFERENCES admin(id) ON UPDATE CASCADE ON DELETE SET NULL,
    dosage VARCHAR(255),
    site_of_injection VARCHAR(255),
    reactions TEXT,
    next_due_date DATE,
    notes TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE immunization_records IS 'Records individual vaccination administrations';

-- Vaccination schedules table
CREATE TABLE IF NOT EXISTS vaccination_schedules (
    id SERIAL PRIMARY KEY,
    vaccine_id INTEGER REFERENCES vaccines(id) ON UPDATE CASCADE ON DELETE CASCADE,
    vaccine_name VARCHAR(255) NOT NULL,
    vaccine_code VARCHAR(50),
    disease_prevented VARCHAR(255),
    vaccine_type vaccine_type,
    manufacturer VARCHAR(255),
    age_in_weeks INTEGER,
    age_in_months INTEGER,
    target_age_weeks INTEGER,
    target_age_months INTEGER,
    min_age_weeks INTEGER,
    max_age_weeks INTEGER,
    dose_number INTEGER NOT NULL,
    total_doses INTEGER,
    interval_weeks INTEGER,
    description TEXT,
    is_mandatory BOOLEAN NOT NULL DEFAULT TRUE,
    is_routine BOOLEAN NOT NULL DEFAULT TRUE,
    priority_level priority_level NOT NULL DEFAULT 'medium',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE vaccination_schedules IS 'Defines standard vaccination schedules by age';

-- Appointments table
CREATE TABLE IF NOT EXISTS appointments (
    id SERIAL PRIMARY KEY,
    patient_id INTEGER NOT NULL REFERENCES patients(id) ON UPDATE CASCADE ON DELETE CASCADE,
    scheduled_date TIMESTAMP WITH TIME ZONE NOT NULL,
    type VARCHAR(255),
    status appointment_status NOT NULL DEFAULT 'scheduled',
    notes TEXT,
    cancellation_reason TEXT,
    completion_notes TEXT,
    duration_minutes INTEGER DEFAULT 30,
    location VARCHAR(255),
    created_by INTEGER NOT NULL REFERENCES admin(id) ON UPDATE CASCADE ON DELETE CASCADE,
    facility_id INTEGER REFERENCES healthcare_facilities(id) ON UPDATE CASCADE ON DELETE CASCADE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE appointments IS 'Manages vaccination and medical appointments';

-- Schedules table (unified scheduling)
CREATE TABLE IF NOT EXISTS schedules (
    id SERIAL PRIMARY KEY,
    patient_id INTEGER REFERENCES patients(id) ON UPDATE CASCADE ON DELETE CASCADE,
    facility_id INTEGER REFERENCES healthcare_facilities(id) ON UPDATE CASCADE ON DELETE CASCADE,
    schedule_type VARCHAR(50) NOT NULL DEFAULT 'vaccination',
    scheduled_date TIMESTAMP WITH TIME ZONE NOT NULL,
    end_date TIMESTAMP WITH TIME ZONE,
    status VARCHAR(20) NOT NULL DEFAULT 'scheduled',
    notes TEXT,
    created_by INTEGER REFERENCES admin(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE schedules IS 'Unified scheduling table for all appointment types';

-- Notifications table
CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    notification_type VARCHAR(255) NOT NULL,
    target_type VARCHAR(255) NOT NULL,
    target_id INTEGER NOT NULL,
    recipient_name VARCHAR(255),
    recipient_email VARCHAR(255),
    recipient_phone VARCHAR(20),
    channel channel_type NOT NULL,
    priority notification_priority NOT NULL DEFAULT 'normal',
    status notification_status NOT NULL DEFAULT 'pending',
    scheduled_for TIMESTAMP WITH TIME ZONE,
    sent_at TIMESTAMP WITH TIME ZONE,
    delivered_at TIMESTAMP WITH TIME ZONE,
    read_at TIMESTAMP WITH TIME ZONE,
    failed_at TIMESTAMP WITH TIME ZONE,
    failure_reason TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 3,
    subject VARCHAR(255),
    message TEXT NOT NULL,
    template_id VARCHAR(100),
    template_data JSONB,
    related_entity_type VARCHAR(50),
    related_entity_id INTEGER,
    external_message_id VARCHAR(255),
    provider_response JSONB,
    delivery_status JSONB,
    cost DECIMAL(8, 4),
    language VARCHAR(10) NOT NULL DEFAULT 'en',
    timezone VARCHAR(50),
    requires_response BOOLEAN NOT NULL DEFAULT FALSE,
    response_deadline TIMESTAMP WITH TIME ZONE,
    response_received TEXT,
    response_at TIMESTAMP WITH TIME ZONE,
    tags JSONB,
    metadata JSONB,
    created_by INTEGER REFERENCES admin(id),
    cancelled_by INTEGER REFERENCES admin(id),
    cancelled_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE notifications IS 'Stores notification messages and delivery status';

-- Audit logs table
CREATE TABLE IF NOT EXISTS audit_logs (
    id SERIAL PRIMARY KEY,
    admin_id INTEGER REFERENCES admin(id) ON UPDATE CASCADE ON DELETE CASCADE,
    username VARCHAR(255),
    role VARCHAR(50),
    event_type VARCHAR(255) NOT NULL,
    entity_type VARCHAR(255),
    entity_id INTEGER,
    old_values TEXT,
    new_values TEXT,
    metadata TEXT,
    details JSONB,
    severity VARCHAR(20) DEFAULT 'INFO',
    ip_address VARCHAR(45),
    user_agent TEXT,
    success BOOLEAN DEFAULT TRUE,
    error_message TEXT,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE audit_logs IS 'Stores audit trail for all system events';

-- Security events table
CREATE TABLE IF NOT EXISTS security_events (
    id SERIAL PRIMARY KEY,
    admin_id INTEGER REFERENCES admin(id) ON DELETE SET NULL,
    event_type VARCHAR(100) NOT NULL,
    severity VARCHAR(20) NOT NULL,
    ip_address VARCHAR(45),
    user_agent TEXT,
    resource_type VARCHAR(100),
    resource_id INTEGER,
    details JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE security_events IS 'Stores security-related events for monitoring';

-- Health records table
CREATE TABLE IF NOT EXISTS health_records (
    id SERIAL PRIMARY KEY,
    patient_id INTEGER NOT NULL REFERENCES patients(id),
    record_type record_type NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    file_path VARCHAR(500) NOT NULL,
    original_filename VARCHAR(255) NOT NULL,
    file_size INTEGER NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    file_extension VARCHAR(10) NOT NULL,
    document_date DATE,
    visit_date DATE,
    healthcare_provider VARCHAR(255),
    provider_contact VARCHAR(255),
    is_confidential BOOLEAN NOT NULL DEFAULT FALSE,
    requires_signature BOOLEAN NOT NULL DEFAULT FALSE,
    signature_status signature_status NOT NULL DEFAULT 'not_required',
    signed_by INTEGER REFERENCES admin(id),
    signed_at TIMESTAMP WITH TIME ZONE,
    signature_notes TEXT,
    tags JSONB DEFAULT '[]',
    metadata JSONB,
    ocr_text TEXT,
    thumbnail_path VARCHAR(500),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    version INTEGER NOT NULL DEFAULT 1,
    parent_record_id INTEGER REFERENCES health_records(id),
    uploaded_by INTEGER NOT NULL REFERENCES admin(id),
    reviewed_by INTEGER REFERENCES admin(id),
    reviewed_at TIMESTAMP WITH TIME ZONE,
    review_notes TEXT,
    expiry_date DATE,
    reminder_date DATE,
    access_count INTEGER NOT NULL DEFAULT 0,
    last_accessed TIMESTAMP WITH TIME ZONE,
    access_log JSONB DEFAULT '[]',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE health_records IS 'Stores medical documents and health records';

-- Patient growth table
CREATE TABLE IF NOT EXISTS patient_growth (
    id SERIAL PRIMARY KEY,
    patient_id INTEGER NOT NULL REFERENCES patients(id),
    measurement_date DATE NOT NULL,
    age_in_days INTEGER NOT NULL,
    weight_kg DECIMAL(5, 3),
    length_cm DECIMAL(5, 1),
    head_circumference_cm DECIMAL(5, 1),
    bmi DECIMAL(5, 2),
    weight_for_age_percentile DECIMAL(5, 2),
    length_for_age_percentile DECIMAL(5, 2),
    weight_for_length_percentile DECIMAL(5, 2),
    head_circumference_percentile DECIMAL(5, 2),
    weight_z_score DECIMAL(4, 2),
    length_z_score DECIMAL(4, 2),
    bmi_z_score DECIMAL(4, 2),
    head_circumference_z_score DECIMAL(4, 2),
    measurement_method measurement_method,
    measured_by INTEGER REFERENCES admin(id),
    measurement_location VARCHAR(255),
    notes TEXT,
    clothing_weight_kg DECIMAL(4, 3) DEFAULT 0,
    diaper_weight_kg DECIMAL(4, 3) DEFAULT 0,
    measurement_time TIME,
    feeding_status feeding_status,
    health_status health_status,
    temperature_celsius DECIMAL(4, 1),
    is_outlier BOOLEAN NOT NULL DEFAULT FALSE,
    outlier_reason TEXT,
    previous_weight_kg DECIMAL(5, 3),
    previous_length_cm DECIMAL(5, 1),
    weight_velocity DECIMAL(6, 3),
    length_velocity DECIMAL(5, 2),
    growth_pattern growth_pattern,
    nutritional_status nutritional_status,
    development_milestones JSONB,
    parent_concerns TEXT,
    healthcare_worker_notes TEXT,
    follow_up_required BOOLEAN NOT NULL DEFAULT FALSE,
    follow_up_date DATE,
    follow_up_reason TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by INTEGER REFERENCES admin(id),
    updated_by INTEGER REFERENCES admin(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE patient_growth IS 'Tracks patient growth measurements and developmental data';

-- Items table
CREATE TABLE IF NOT EXISTS items (
    id SERIAL PRIMARY KEY,
    type item_type NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    doses_required INTEGER,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE items IS 'Stores inventory items (vaccines only - medicine support removed for vaccination-focused system)';

-- Item batches table
CREATE TABLE IF NOT EXISTS item_batches (
    id SERIAL PRIMARY KEY,
    item_id INTEGER NOT NULL REFERENCES items(id) ON UPDATE CASCADE ON DELETE CASCADE,
    lot_number VARCHAR(255) NOT NULL,
    expiry_date DATE NOT NULL,
    qty_received INTEGER NOT NULL,
    qty_available INTEGER NOT NULL,
    status batch_status NOT NULL DEFAULT 'active',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE item_batches IS 'Tracks batch information for inventory items';

-- Medicines table (REMOVED - system focuses on vaccines only for vaccination tracking)
-- CREATE TABLE IF NOT EXISTS medicines (
--     id SERIAL PRIMARY KEY,
--     name VARCHAR(255) NOT NULL,
--     generic_name VARCHAR(255),
--     type medicine_type NOT NULL,
--     form medicine_form NOT NULL,
--     manufacturer VARCHAR(255),
--     uses TEXT,
--     storage_instructions TEXT,
--     description TEXT,
--     is_active BOOLEAN NOT NULL DEFAULT TRUE,
--     created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
--     updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
-- );

-- COMMENT ON TABLE medicines IS 'Stores medicine information and specifications';

-- Medicine batches table (REMOVED - system focuses on vaccines only for vaccination tracking)
-- CREATE TABLE IF NOT EXISTS medicine_batches (
--     id SERIAL PRIMARY KEY,
--     medicine_id INTEGER NOT NULL REFERENCES medicines(id) ON UPDATE CASCADE ON DELETE CASCADE,
--     lot_no VARCHAR(255) NOT NULL,
--     expiry_date DATE NOT NULL,
--     qty_received INTEGER NOT NULL,
--     qty_current INTEGER NOT NULL DEFAULT 0,
--     facility_id INTEGER NOT NULL REFERENCES healthcare_facilities(id) ON UPDATE CASCADE ON DELETE CASCADE,
--     is_active BOOLEAN NOT NULL DEFAULT TRUE,
--     created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
--     updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
-- );

-- COMMENT ON TABLE medicine_batches IS 'Tracks medicine batch inventory';

-- Inventory transactions table
CREATE TABLE IF NOT EXISTS inventory_transactions (
    id SERIAL PRIMARY KEY,
    batch_id INTEGER NOT NULL REFERENCES vaccine_batches(id) ON UPDATE CASCADE ON DELETE CASCADE,
    txn_type transaction_type NOT NULL,
    qty INTEGER NOT NULL,
    admin_id INTEGER NOT NULL REFERENCES admin(id) ON UPDATE CASCADE ON DELETE CASCADE,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE inventory_transactions IS 'Tracks inventory movement transactions';

-- Suppliers table
CREATE TABLE IF NOT EXISTS suppliers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    supplier_code VARCHAR(50) UNIQUE,
    contact_person VARCHAR(255),
    position VARCHAR(100),
    email VARCHAR(255),
    phone VARCHAR(20),
    mobile VARCHAR(20),
    fax VARCHAR(20),
    website VARCHAR(255),
    address_line_1 VARCHAR(255),
    address_line_2 VARCHAR(255),
    city VARCHAR(100),
    province VARCHAR(100),
    postal_code VARCHAR(20),
    country VARCHAR(100) DEFAULT 'Philippines',
    tax_id VARCHAR(50),
    business_registration VARCHAR(100),
    license_number VARCHAR(100),
    supplier_type supplier_type NOT NULL DEFAULT 'other',
    specialization JSONB,
    payment_terms VARCHAR(255),
    credit_limit DECIMAL(12, 2),
    lead_time_days INTEGER,
    minimum_order_amount DECIMAL(10, 2),
    delivery_schedule JSONB,
    preferred_delivery_days JSONB,
    delivery_cutoff_time TIME,
    delivery_contact VARCHAR(255),
    delivery_phone VARCHAR(20),
    delivery_email VARCHAR(255),
    special_instructions TEXT,
    quality_rating DECIMAL(3, 2),
    reliability_rating DECIMAL(3, 2),
    service_rating DECIMAL(3, 2),
    rating_count INTEGER NOT NULL DEFAULT 0,
    average_rating DECIMAL(3, 2),
    is_preferred BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    contract_start_date DATE,
    contract_end_date DATE,
    contract_terms TEXT,
    notes TEXT,
    bank_name VARCHAR(255),
    bank_account_number VARCHAR(100),
    bank_routing_number VARCHAR(50),
    payment_method payment_method,
    last_order_date DATE,
    total_orders INTEGER NOT NULL DEFAULT 0,
    total_order_value DECIMAL(12, 2) NOT NULL DEFAULT 0,
    average_order_value DECIMAL(10, 2),
    on_time_delivery_rate DECIMAL(5, 2),
    product_quality_score DECIMAL(5, 2),
    response_time_hours DECIMAL(4, 1),
    created_by INTEGER REFERENCES admin(id),
    updated_by INTEGER REFERENCES admin(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE suppliers IS 'Stores supplier information and performance metrics';

-- Vaccine inventory table
CREATE TABLE IF NOT EXISTS vaccine_inventory (
    id SERIAL PRIMARY KEY,
    vaccine_id INTEGER NOT NULL REFERENCES vaccines(id) ON UPDATE CASCADE ON DELETE CASCADE,
    facility_id INTEGER NOT NULL REFERENCES healthcare_facilities(id) ON UPDATE CASCADE ON DELETE CASCADE,
    beginning_balance INTEGER NOT NULL DEFAULT 0,
    received_during_period INTEGER NOT NULL DEFAULT 0,
    lot_batch_number VARCHAR(255),
    transferred_in INTEGER NOT NULL DEFAULT 0,
    transferred_out INTEGER NOT NULL DEFAULT 0,
    expired_wasted INTEGER NOT NULL DEFAULT 0,
    issuance INTEGER NOT NULL DEFAULT 0,
    low_stock_threshold INTEGER NOT NULL DEFAULT 10,
    critical_stock_threshold INTEGER NOT NULL DEFAULT 5,
    is_low_stock BOOLEAN NOT NULL DEFAULT FALSE,
    is_critical_stock BOOLEAN NOT NULL DEFAULT FALSE,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    created_by INTEGER NOT NULL REFERENCES admin(id),
    updated_by INTEGER NOT NULL REFERENCES admin(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE vaccine_inventory IS 'Tracks vaccine inventory levels and stock alerts';

-- Vaccine inventory transactions table
CREATE TABLE IF NOT EXISTS vaccine_inventory_transactions (
    id SERIAL PRIMARY KEY,
    vaccine_inventory_id INTEGER NOT NULL REFERENCES vaccine_inventory(id) ON UPDATE CASCADE ON DELETE CASCADE,
    vaccine_id INTEGER NOT NULL REFERENCES vaccines(id) ON UPDATE CASCADE ON DELETE CASCADE,
    facility_id INTEGER NOT NULL REFERENCES healthcare_facilities(id) ON UPDATE CASCADE ON DELETE CASCADE,
    transaction_type VARCHAR(50) NOT NULL,
    quantity INTEGER NOT NULL,
    previous_balance INTEGER NOT NULL,
    new_balance INTEGER NOT NULL,
    lot_number VARCHAR(255),
    batch_number VARCHAR(255),
    expiry_date DATE,
    supplier_name VARCHAR(255),
    reference_number VARCHAR(255),
    performed_by INTEGER NOT NULL REFERENCES admin(id),
    approved_by INTEGER REFERENCES admin(id),
    notes TEXT,
    triggered_low_stock_alert BOOLEAN NOT NULL DEFAULT FALSE,
    triggered_critical_stock_alert BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE vaccine_inventory_transactions IS 'Tracks vaccine inventory movement and transactions';

-- Vaccine stock alerts table
CREATE TABLE IF NOT EXISTS vaccine_stock_alerts (
    id SERIAL PRIMARY KEY,
    vaccine_inventory_id INTEGER NOT NULL REFERENCES vaccine_inventory(id) ON UPDATE CASCADE ON DELETE CASCADE,
    vaccine_id INTEGER NOT NULL REFERENCES vaccines(id) ON UPDATE CASCADE ON DELETE CASCADE,
    facility_id INTEGER NOT NULL REFERENCES healthcare_facilities(id) ON UPDATE CASCADE ON DELETE CASCADE,
    alert_type VARCHAR(50) NOT NULL,
    current_stock INTEGER NOT NULL,
    threshold_value INTEGER NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
    message TEXT NOT NULL,
    priority VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
    acknowledged_by INTEGER REFERENCES admin(id),
    acknowledged_at TIMESTAMP WITH TIME ZONE,
    resolved_by INTEGER REFERENCES admin(id),
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolution_notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE vaccine_stock_alerts IS 'Stores vaccine stock level alerts';

-- ============================================================================
-- SECTION E: RELATIONSHIP / JUNCTION TABLES
-- ============================================================================

-- Permissions table
CREATE TABLE IF NOT EXISTS permissions (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    resource VARCHAR(255) NOT NULL,
    action VARCHAR(255) NOT NULL,
    scope scope_type NOT NULL DEFAULT 'global',
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP WITH TIME ZONE
);

COMMENT ON TABLE permissions IS 'Defines system permissions for role-based access control';

-- Admin sessions table
CREATE TABLE IF NOT EXISTS admin_sessions (
    id SERIAL PRIMARY KEY,
    admin_id INTEGER NOT NULL REFERENCES admin(id),
    session_token TEXT NOT NULL UNIQUE,
    ip_address VARCHAR(45),
    user_agent TEXT,
    device_info JSONB,
    location_info JSONB,
    login_time TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    logout_time TIMESTAMP WITH TIME ZONE,
    last_activity TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    session_duration INTEGER,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    login_method login_method NOT NULL DEFAULT 'password',
    impersonated_by INTEGER REFERENCES admin(id),
    security_events JSONB DEFAULT '[]',
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE admin_sessions IS 'Tracks admin login sessions for security monitoring';

-- Failed login attempts table (for brute force protection)
CREATE TABLE IF NOT EXISTS failed_login_attempts (
    id SERIAL PRIMARY KEY,
    identifier VARCHAR(255) NOT NULL,
    ip_address VARCHAR(45),
    user_agent TEXT,
    attempt_count INTEGER DEFAULT 1,
    last_attempt TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    locked_until TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE failed_login_attempts IS 'Tracks failed login attempts for brute force protection';

-- IP whitelist table
CREATE TABLE IF NOT EXISTS ip_whitelist (
    id SERIAL PRIMARY KEY,
    ip_address VARCHAR(45) NOT NULL UNIQUE,
    description VARCHAR(255),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE ip_whitelist IS 'Stores trusted IP addresses for security';

-- Notification preferences table
CREATE TABLE IF NOT EXISTS notification_preferences (
    id SERIAL PRIMARY KEY,
    admin_id INTEGER NOT NULL REFERENCES admin(id) ON UPDATE CASCADE ON DELETE CASCADE,
    notification_type VARCHAR(50) NOT NULL,
    channel channel_type NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    frequency frequency_type NOT NULL DEFAULT 'immediate',
    quiet_hours_start TIME,
    quiet_hours_end TIME,
    timezone VARCHAR(50) DEFAULT 'UTC',
    custom_message TEXT,
    conditions JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP WITH TIME ZONE
);

COMMENT ON TABLE notification_preferences IS 'Stores admin notification preferences';

-- Reports table
CREATE TABLE IF NOT EXISTS reports (
    id SERIAL PRIMARY KEY,
    type report_type NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    parameters JSONB,
    file_path VARCHAR(500),
    file_format file_format,
    status report_status NOT NULL DEFAULT 'generating',
    generated_by INTEGER REFERENCES admin(id) ON UPDATE CASCADE ON DELETE SET NULL,
    date_generated TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE,
    download_count INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE reports IS 'Stores generated reports and their status';

-- Announcements table
CREATE TABLE IF NOT EXISTS announcements (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    priority announcement_priority NOT NULL DEFAULT 'medium',
    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    target_audience target_audience NOT NULL DEFAULT 'all',
    start_date DATE,
    end_date DATE,
    published_at TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_by INTEGER NOT NULL REFERENCES admin(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP WITH TIME ZONE
);

COMMENT ON TABLE announcements IS 'Stores system announcements and notices';

-- Paper templates table
CREATE TABLE IF NOT EXISTS paper_templates (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    template_type VARCHAR(50) NOT NULL,
    fields JSONB,
    validation_rules JSONB,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by INTEGER NOT NULL REFERENCES admin(id),
    updated_by INTEGER REFERENCES admin(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE paper_templates IS 'Stores document template configurations';

-- Document generation table
CREATE TABLE IF NOT EXISTS document_generation (
    id SERIAL PRIMARY KEY,
    template_id INTEGER NOT NULL REFERENCES paper_templates(id) ON UPDATE CASCADE ON DELETE CASCADE,
    patient_id INTEGER REFERENCES patients(id) ON UPDATE CASCADE ON DELETE CASCADE,
    guardian_id INTEGER REFERENCES guardians(id) ON UPDATE CASCADE ON DELETE CASCADE,
    generated_by INTEGER NOT NULL REFERENCES admin(id) ON UPDATE CASCADE ON DELETE CASCADE,
    file_path VARCHAR(500),
    file_name VARCHAR(255),
    file_size INTEGER,
    mime_type VARCHAR(100),
    status VARCHAR(50) NOT NULL DEFAULT 'generated',
    generated_data JSONB,
    digital_signature VARCHAR(255),
    signature_timestamp TIMESTAMP WITH TIME ZONE,
    download_count INTEGER NOT NULL DEFAULT 0,
    last_downloaded TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE document_generation IS 'Tracks document generation requests and results';

-- Digital papers table
CREATE TABLE IF NOT EXISTS digital_papers (
    id SERIAL PRIMARY KEY,
    document_generation_id INTEGER NOT NULL REFERENCES document_generation(id) ON UPDATE CASCADE ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    document_type VARCHAR(50) NOT NULL,
    content TEXT,
    metadata JSONB,
    qr_code VARCHAR(255),
    verification_hash VARCHAR(255),
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    verified_by INTEGER REFERENCES admin(id),
    verified_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE digital_papers IS 'Stores generated digital documents';

-- Document downloads table
CREATE TABLE IF NOT EXISTS document_downloads (
    id SERIAL PRIMARY KEY,
    admin_id INTEGER REFERENCES admin(id),
    patient_id INTEGER REFERENCES patients(id),
    template_id INTEGER REFERENCES paper_templates(id),
    download_type VARCHAR(50) DEFAULT 'PDF',
    download_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    file_path VARCHAR(500),
    download_status VARCHAR(20) DEFAULT 'COMPLETED',
    ip_address INET,
    user_agent TEXT,
    download_reason VARCHAR(100),
    file_size INTEGER,
    expires_at TIMESTAMP WITH TIME ZONE
);

COMMENT ON TABLE document_downloads IS 'Tracks document download history';

-- Paper completion status table
CREATE TABLE IF NOT EXISTS paper_completion_status (
    id SERIAL PRIMARY KEY,
    patient_id INTEGER REFERENCES patients(id),
    template_id INTEGER REFERENCES paper_templates(id),
    completion_status VARCHAR(20) DEFAULT 'PENDING',
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_by INTEGER REFERENCES admin(id),
    notes TEXT,
    required_fields_count INTEGER DEFAULT 0,
    completed_fields_count INTEGER DEFAULT 0,
    completion_percentage INTEGER DEFAULT 0
);

COMMENT ON TABLE paper_completion_status IS 'Tracks document completion status for patients';

-- Document access permissions table
CREATE TABLE IF NOT EXISTS document_access_permissions (
    id SERIAL PRIMARY KEY,
    template_id INTEGER REFERENCES paper_templates(id),
    role_id INTEGER REFERENCES permissions(id),
    can_view BOOLEAN DEFAULT TRUE,
    can_download BOOLEAN DEFAULT TRUE,
    can_generate BOOLEAN DEFAULT TRUE,
    can_share BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE document_access_permissions IS 'Defines document access permissions by role';

-- Document templates library table
CREATE TABLE IF NOT EXISTS document_templates_library (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    template_type VARCHAR(50) NOT NULL,
    template_content JSONB NOT NULL,
    version VARCHAR(20) DEFAULT '1.0',
    is_public BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER REFERENCES admin(id)
);

COMMENT ON TABLE document_templates_library IS 'Stores reusable document templates';

-- Document generation logs table
CREATE TABLE IF NOT EXISTS document_generation_logs (
    id SERIAL PRIMARY KEY,
    template_id INTEGER REFERENCES paper_templates(id),
    patient_id INTEGER REFERENCES patients(id),
    admin_id INTEGER REFERENCES admin(id),
    generation_type VARCHAR(50) NOT NULL,
    generation_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20) DEFAULT 'SUCCESS',
    error_message TEXT,
    generated_files JSONB,
    processing_time INTEGER,
    data_source JSONB
);

COMMENT ON TABLE document_generation_logs IS 'Logs document generation activities';

-- Admin preferences table
CREATE TABLE IF NOT EXISTS admin_preferences (
    id SERIAL PRIMARY KEY,
    admin_id INTEGER NOT NULL REFERENCES admin(id) ON UPDATE CASCADE ON DELETE CASCADE,
    preference_key VARCHAR(255) NOT NULL,
    preference_value JSONB,
    preference_type VARCHAR(50) NOT NULL DEFAULT 'notification',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(admin_id, preference_key)
);

COMMENT ON TABLE admin_preferences IS 'Stores admin-specific preferences';

-- Admin settings table
CREATE TABLE IF NOT EXISTS admin_settings (
    id SERIAL PRIMARY KEY,
    admin_id INTEGER NOT NULL REFERENCES admin(id) ON DELETE CASCADE,
    category VARCHAR(50) NOT NULL,
    settings_key VARCHAR(100) NOT NULL,
    settings_value TEXT,
    value_type VARCHAR(20) DEFAULT 'string',
    is_encrypted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(admin_id, category, settings_key)
);

COMMENT ON TABLE admin_settings IS 'Stores admin-specific settings categorized by type';

-- Settings audit log table
CREATE TABLE IF NOT EXISTS settings_audit_log (
    id SERIAL PRIMARY KEY,
    admin_id INTEGER NOT NULL REFERENCES admin(id) ON DELETE CASCADE,
    setting_id INTEGER REFERENCES admin_settings(id) ON DELETE SET NULL,
    category VARCHAR(50) NOT NULL,
    settings_key VARCHAR(100) NOT NULL,
    old_value TEXT,
    new_value TEXT,
    action VARCHAR(20) NOT NULL,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE settings_audit_log IS 'Audit log for tracking settings changes';

-- System config table
CREATE TABLE IF NOT EXISTS system_config (
    id SERIAL PRIMARY KEY,
    config_key VARCHAR(255) NOT NULL UNIQUE,
    config_value JSONB,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE system_config IS 'Stores system-wide configuration settings';

-- Messages table
CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    sender_id INTEGER NOT NULL REFERENCES admin(id) ON UPDATE CASCADE ON DELETE CASCADE,
    recipient_id INTEGER REFERENCES admin(id) ON UPDATE CASCADE ON DELETE CASCADE,
    guardian_id INTEGER REFERENCES guardians(id) ON UPDATE CASCADE ON DELETE CASCADE,
    patient_id INTEGER REFERENCES patients(id) ON UPDATE CASCADE ON DELETE CASCADE,
    conversation_id INTEGER REFERENCES conversations(id) ON UPDATE CASCADE ON DELETE CASCADE,
    subject VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    message_type VARCHAR(50) NOT NULL DEFAULT 'general',
    priority VARCHAR(20) NOT NULL DEFAULT 'normal',
    status VARCHAR(20) NOT NULL DEFAULT 'sent',
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    read_at TIMESTAMP WITH TIME ZONE,
    parent_message_id INTEGER REFERENCES messages(id),
    attachments JSONB,
    metadata JSONB,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE messages IS 'Stores user messages and communications';

-- Conversations table
CREATE TABLE IF NOT EXISTS conversations (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE conversations IS 'Stores conversation threads for messaging';

-- Conversation participants table
CREATE TABLE IF NOT EXISTS conversation_participants (
    id SERIAL PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON UPDATE CASCADE ON DELETE CASCADE,
    admin_id INTEGER NOT NULL REFERENCES admin(id) ON UPDATE CASCADE ON DELETE CASCADE,
    joined_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    left_at TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE(conversation_id, admin_id)
);

COMMENT ON TABLE conversation_participants IS 'Maps admins to conversations';

-- Healthcare workers table
CREATE TABLE IF NOT EXISTS healthcare_workers (
    id SERIAL PRIMARY KEY,
    admin_id INTEGER NOT NULL REFERENCES admin(id) ON UPDATE CASCADE ON DELETE CASCADE,
    license_number VARCHAR(255),
    specialization VARCHAR(255),
    years_experience INTEGER,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE healthcare_workers IS 'Stores healthcare worker professional information';

-- Adoption documents table
CREATE TABLE IF NOT EXISTS adoption_documents (
    id SERIAL PRIMARY KEY,
    patient_id INTEGER NOT NULL REFERENCES patients(id) ON UPDATE CASCADE ON DELETE CASCADE,
    document_type VARCHAR(255) NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    uploaded_by INTEGER NOT NULL REFERENCES admin(id),
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    verified_by INTEGER REFERENCES admin(id),
    verified_at TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE adoption_documents IS 'Stores adoption-related documents';

-- Feedback table
CREATE TABLE IF NOT EXISTS feedback (
    id SERIAL PRIMARY KEY,
    admin_id INTEGER REFERENCES admin(id) ON DELETE SET NULL,
    subject VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    category VARCHAR(100),
    priority VARCHAR(50) DEFAULT 'normal',
    status VARCHAR(50) DEFAULT 'open',
    assigned_to INTEGER REFERENCES admin(id),
    resolved_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE feedback IS 'Stores user feedback and support requests';

-- Alerts table
CREATE TABLE IF NOT EXISTS alerts (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    severity VARCHAR(50) NOT NULL,
    category VARCHAR(50) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
    acknowledged_by INTEGER REFERENCES admin(id) ON DELETE SET NULL,
    acknowledged_at TIMESTAMP WITH TIME ZONE,
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolution_notes TEXT,
    threshold_value DECIMAL,
    current_value DECIMAL,
    trigger_condition TEXT,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE alerts IS 'Stores system alerts and notifications';

-- ============================================================================
-- SECTION F: INDEXES & PERFORMANCE OPTIMIZATION
-- ============================================================================

-- Admin tables indexes
CREATE INDEX IF NOT EXISTS idx_admin_username ON admin(username);
CREATE INDEX IF NOT EXISTS idx_admin_role ON admin(role);
CREATE INDEX IF NOT EXISTS idx_admin_facility_id ON admin(facility_id);
CREATE INDEX IF NOT EXISTS idx_admin_email ON admin(email);
CREATE INDEX IF NOT EXISTS idx_admin_is_active ON admin(is_active);

CREATE INDEX IF NOT EXISTS idx_healthcare_facilities_name ON healthcare_facilities(name);
CREATE INDEX IF NOT EXISTS idx_healthcare_facilities_region ON healthcare_facilities(region);

CREATE INDEX IF NOT EXISTS idx_guardians_name ON guardians(name);
CREATE INDEX IF NOT EXISTS idx_guardians_phone ON guardians(phone);
CREATE INDEX IF NOT EXISTS idx_guardians_email ON guardians(email);

CREATE INDEX IF NOT EXISTS idx_patients_guardian_id ON patients(guardian_id);
CREATE INDEX IF NOT EXISTS idx_patients_facility_id ON patients(facility_id);
CREATE INDEX IF NOT EXISTS idx_patients_dob ON patients(dob);
CREATE INDEX IF NOT EXISTS idx_patients_name ON patients(first_name, last_name);
CREATE INDEX IF NOT EXISTS idx_patients_is_active ON patients(is_active);

-- Vaccination tables indexes
CREATE INDEX IF NOT EXISTS idx_vaccines_code ON vaccines(code);
CREATE INDEX IF NOT EXISTS idx_vaccines_name ON vaccines(name);
CREATE INDEX IF NOT EXISTS idx_vaccines_is_active ON vaccines(is_active);

CREATE INDEX IF NOT EXISTS idx_vaccine_batches_vaccine_id ON vaccine_batches(vaccine_id);
CREATE INDEX IF NOT EXISTS idx_vaccine_batches_facility_id ON vaccine_batches(facility_id);
CREATE INDEX IF NOT EXISTS idx_vaccine_batches_lot_no ON vaccine_batches(lot_no);
CREATE INDEX IF NOT EXISTS idx_vaccine_batches_expiry_date ON vaccine_batches(expiry_date);
CREATE INDEX IF NOT EXISTS idx_vaccine_batches_status ON vaccine_batches(status);

CREATE INDEX IF NOT EXISTS idx_immunization_records_patient_id ON immunization_records(patient_id);
CREATE INDEX IF NOT EXISTS idx_immunization_records_vaccine_id ON immunization_records(vaccine_id);
CREATE INDEX IF NOT EXISTS idx_immunization_records_batch_id ON immunization_records(batch_id);
CREATE INDEX IF NOT EXISTS idx_immunization_records_admin_date ON immunization_records(admin_date);
CREATE INDEX IF NOT EXISTS idx_immunization_records_is_active ON immunization_records(is_active);

CREATE INDEX IF NOT EXISTS idx_vaccination_schedules_vaccine_id ON vaccination_schedules(vaccine_id);
CREATE INDEX IF NOT EXISTS idx_vaccination_schedules_vaccine_name ON vaccination_schedules(vaccine_name);
CREATE INDEX IF NOT EXISTS idx_vaccination_schedules_is_active ON vaccination_schedules(is_active);

-- Appointment tables indexes
CREATE INDEX IF NOT EXISTS idx_appointments_patient_id ON appointments(patient_id);
CREATE INDEX IF NOT EXISTS idx_appointments_scheduled_date ON appointments(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);
CREATE INDEX IF NOT EXISTS idx_appointments_facility_id ON appointments(facility_id);
CREATE INDEX IF NOT EXISTS idx_appointments_location ON appointments(location);
CREATE INDEX IF NOT EXISTS idx_appointments_created_by ON appointments(created_by);
CREATE INDEX IF NOT EXISTS idx_appointments_is_active ON appointments(is_active);

CREATE INDEX IF NOT EXISTS idx_schedules_patient_id ON schedules(patient_id);
CREATE INDEX IF NOT EXISTS idx_schedules_facility_id ON schedules(facility_id);
CREATE INDEX IF NOT EXISTS idx_schedules_scheduled_date ON schedules(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_schedules_status ON schedules(status);

-- Notification tables indexes
CREATE INDEX IF NOT EXISTS idx_notifications_target ON notifications(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status);
CREATE INDEX IF NOT EXISTS idx_notifications_priority ON notifications(priority);
CREATE INDEX IF NOT EXISTS idx_notifications_scheduled_for ON notifications(scheduled_for);
CREATE INDEX IF NOT EXISTS idx_notifications_created_by ON notifications(created_by);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at);

CREATE INDEX IF NOT EXISTS idx_notification_preferences_admin_id ON notification_preferences(admin_id);
CREATE INDEX IF NOT EXISTS idx_notification_preferences_notification_type ON notification_preferences(notification_type);
CREATE INDEX IF NOT EXISTS idx_notification_preferences_channel ON notification_preferences(channel);

-- Audit and security tables indexes
CREATE INDEX IF NOT EXISTS idx_audit_logs_admin_id ON audit_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_username ON audit_logs(username);
CREATE INDEX IF NOT EXISTS idx_audit_logs_event_type ON audit_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_logs_severity ON audit_logs(severity);

CREATE INDEX IF NOT EXISTS idx_security_events_admin_id ON security_events(admin_id);
CREATE INDEX IF NOT EXISTS idx_security_events_event_type ON security_events(event_type);
CREATE INDEX IF NOT EXISTS idx_security_events_severity ON security_events(severity);
CREATE INDEX IF NOT EXISTS idx_security_events_ip_address ON security_events(ip_address);
CREATE INDEX IF NOT EXISTS idx_security_events_created_at ON security_events(created_at);

CREATE INDEX IF NOT EXISTS idx_failed_login_attempts_identifier ON failed_login_attempts(identifier);
CREATE INDEX IF NOT EXISTS idx_failed_login_attempts_locked_until ON failed_login_attempts(locked_until);
CREATE INDEX IF NOT EXISTS idx_ip_whitelist_ip_address ON ip_whitelist(ip_address);

-- Health records tables indexes
CREATE INDEX IF NOT EXISTS idx_health_records_patient_id ON health_records(patient_id);
CREATE INDEX IF NOT EXISTS idx_health_records_record_type ON health_records(record_type);
CREATE INDEX IF NOT EXISTS idx_health_records_uploaded_by ON health_records(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_health_records_document_date ON health_records(document_date);
CREATE INDEX IF NOT EXISTS idx_health_records_is_active ON health_records(is_active);

CREATE INDEX IF NOT EXISTS idx_patient_growth_patient_id ON patient_growth(patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_growth_measurement_date ON patient_growth(measurement_date);
CREATE INDEX IF NOT EXISTS idx_patient_growth_is_active ON patient_growth(is_active);

-- Inventory tables indexes
CREATE INDEX IF NOT EXISTS idx_items_type ON items(type);
CREATE INDEX IF NOT EXISTS idx_items_name ON items(name);
CREATE INDEX IF NOT EXISTS idx_items_is_active ON items(is_active);

CREATE INDEX IF NOT EXISTS idx_item_batches_item_id ON item_batches(item_id);
CREATE INDEX IF NOT EXISTS idx_item_batches_expiry_date ON item_batches(expiry_date);
CREATE INDEX IF NOT EXISTS idx_item_batches_status ON item_batches(status);

-- Medicine indexes (REMOVED - medicine tables removed for vaccination-focused system)
-- CREATE INDEX IF NOT EXISTS idx_medicines_name ON medicines(name);
-- CREATE INDEX IF NOT EXISTS idx_medicines_type ON medicines(type);
-- CREATE INDEX IF NOT EXISTS idx_medicines_is_active ON medicines(is_active);

-- CREATE INDEX IF NOT EXISTS idx_medicine_batches_medicine_id ON medicine_batches(medicine_id);
-- CREATE INDEX IF NOT EXISTS idx_medicine_batches_facility_id ON medicine_batches(facility_id);
-- CREATE INDEX IF NOT EXISTS idx_medicine_batches_expiry_date ON medicine_batches(expiry_date);

CREATE INDEX IF NOT EXISTS idx_inventory_transactions_batch_id ON inventory_transactions(batch_id);
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_admin_id ON inventory_transactions(admin_id);
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_created_at ON inventory_transactions(created_at);

CREATE INDEX IF NOT EXISTS idx_suppliers_name ON suppliers(name);
CREATE INDEX IF NOT EXISTS idx_suppliers_supplier_code ON suppliers(supplier_code);
CREATE INDEX IF NOT EXISTS idx_suppliers_is_active ON suppliers(is_active);
CREATE INDEX IF NOT EXISTS idx_suppliers_is_preferred ON suppliers(is_preferred);

CREATE INDEX IF NOT EXISTS idx_vaccine_inventory_vaccine_id ON vaccine_inventory(vaccine_id);
CREATE INDEX IF NOT EXISTS idx_vaccine_inventory_facility_id ON vaccine_inventory(facility_id);
CREATE INDEX IF NOT EXISTS idx_vaccine_inventory_period_start ON vaccine_inventory(period_start);
CREATE INDEX IF NOT EXISTS idx_vaccine_inventory_is_low_stock ON vaccine_inventory(is_low_stock);
CREATE INDEX IF NOT EXISTS idx_vaccine_inventory_is_critical_stock ON vaccine_inventory(is_critical_stock);

CREATE INDEX IF NOT EXISTS idx_vaccine_inventory_transactions_vaccine_inventory_id ON vaccine_inventory_transactions(vaccine_inventory_id);
CREATE INDEX IF NOT EXISTS idx_vaccine_inventory_transactions_vaccine_id ON vaccine_inventory_transactions(vaccine_id);
CREATE INDEX IF NOT EXISTS idx_vaccine_inventory_transactions_facility_id ON vaccine_inventory_transactions(facility_id);
CREATE INDEX IF NOT EXISTS idx_vaccine_inventory_transactions_created_at ON vaccine_inventory_transactions(created_at);

CREATE INDEX IF NOT EXISTS idx_vaccine_stock_alerts_vaccine_inventory_id ON vaccine_stock_alerts(vaccine_inventory_id);
CREATE INDEX IF NOT EXISTS idx_vaccine_stock_alerts_vaccine_id ON vaccine_stock_alerts(vaccine_id);
CREATE INDEX IF NOT EXISTS idx_vaccine_stock_alerts_facility_id ON vaccine_stock_alerts(facility_id);
CREATE INDEX IF NOT EXISTS idx_vaccine_stock_alerts_status ON vaccine_stock_alerts(status);
CREATE INDEX IF NOT EXISTS idx_vaccine_stock_alerts_created_at ON vaccine_stock_alerts(created_at);

-- Permissions tables indexes
CREATE INDEX IF NOT EXISTS idx_permissions_name ON permissions(name);
CREATE INDEX IF NOT EXISTS idx_permissions_resource ON permissions(resource);
CREATE INDEX IF NOT EXISTS idx_permissions_is_active ON permissions(is_active);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin_id ON admin_sessions(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_session_token ON admin_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_is_active ON admin_sessions(is_active);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_last_activity ON admin_sessions(last_activity);

-- Reports and announcements tables indexes
CREATE INDEX IF NOT EXISTS idx_reports_type ON reports(type);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_generated_by ON reports(generated_by);
CREATE INDEX IF NOT EXISTS idx_reports_date_generated ON reports(date_generated);
CREATE INDEX IF NOT EXISTS idx_reports_is_active ON reports(is_active);

CREATE INDEX IF NOT EXISTS idx_announcements_status ON announcements(status);
CREATE INDEX IF NOT EXISTS idx_announcements_priority ON announcements(priority);
CREATE INDEX IF NOT EXISTS idx_announcements_target_audience ON announcements(target_audience);
CREATE INDEX IF NOT EXISTS idx_announcements_start_date ON announcements(start_date);
CREATE INDEX IF NOT EXISTS idx_announcements_end_date ON announcements(end_date);
CREATE INDEX IF NOT EXISTS idx_announcements_created_by ON announcements(created_by);
CREATE INDEX IF NOT EXISTS idx_announcements_is_active ON announcements(is_active);

-- Document tables indexes
CREATE INDEX IF NOT EXISTS idx_paper_templates_template_type ON paper_templates(template_type);
CREATE INDEX IF NOT EXISTS idx_paper_templates_is_active ON paper_templates(is_active);
CREATE INDEX IF NOT EXISTS idx_paper_templates_created_by ON paper_templates(created_by);

CREATE INDEX IF NOT EXISTS idx_document_generation_template_id ON document_generation(template_id);
CREATE INDEX IF NOT EXISTS idx_document_generation_patient_id ON document_generation(patient_id);
CREATE INDEX IF NOT EXISTS idx_document_generation_guardian_id ON document_generation(guardian_id);
CREATE INDEX IF NOT EXISTS idx_document_generation_generated_by ON document_generation(generated_by);
CREATE INDEX IF NOT EXISTS idx_document_generation_status ON document_generation(status);
CREATE INDEX IF NOT EXISTS idx_document_generation_created_at ON document_generation(created_at);

CREATE INDEX IF NOT EXISTS idx_digital_papers_document_generation_id ON digital_papers(document_generation_id);
CREATE INDEX IF NOT EXISTS idx_digital_papers_document_type ON digital_papers(document_type);
CREATE INDEX IF NOT EXISTS idx_digital_papers_is_verified ON digital_papers(is_verified);

CREATE INDEX IF NOT EXISTS idx_document_downloads_admin_id ON document_downloads(admin_id);
CREATE INDEX IF NOT EXISTS idx_document_downloads_patient_id ON document_downloads(patient_id);
CREATE INDEX IF NOT EXISTS idx_document_downloads_template_id ON document_downloads(template_id);
CREATE INDEX IF NOT EXISTS idx_document_downloads_download_date ON document_downloads(download_date);

CREATE INDEX IF NOT EXISTS idx_paper_completion_status_patient_id ON paper_completion_status(patient_id);
CREATE INDEX IF NOT EXISTS idx_paper_completion_status_template_id ON paper_completion_status(template_id);
CREATE INDEX IF NOT EXISTS idx_paper_completion_status_status ON paper_completion_status(completion_status);

CREATE INDEX IF NOT EXISTS idx_document_access_permissions_template_id ON document_access_permissions(template_id);
CREATE INDEX IF NOT EXISTS idx_document_access_permissions_role_id ON document_access_permissions(role_id);

CREATE INDEX IF NOT EXISTS idx_document_templates_library_template_type ON document_templates_library(template_type);
CREATE INDEX IF NOT EXISTS idx_document_templates_library_is_public ON document_templates_library(is_public);

CREATE INDEX IF NOT EXISTS idx_document_generation_logs_template_id ON document_generation_logs(template_id);
CREATE INDEX IF NOT EXISTS idx_document_generation_logs_patient_id ON document_generation_logs(patient_id);
CREATE INDEX IF NOT EXISTS idx_document_generation_logs_admin_id ON document_generation_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_document_generation_logs_generation_date ON document_generation_logs(generation_date);

-- Admin preferences and settings tables indexes
CREATE INDEX IF NOT EXISTS idx_admin_preferences_admin_id ON admin_preferences(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_preferences_preference_key ON admin_preferences(preference_key);
CREATE INDEX IF NOT EXISTS idx_admin_preferences_is_active ON admin_preferences(is_active);

CREATE INDEX IF NOT EXISTS idx_admin_settings_admin_id ON admin_settings(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_settings_category ON admin_settings(category);
CREATE INDEX IF NOT EXISTS idx_admin_settings_settings_key ON admin_settings(settings_key);

CREATE INDEX IF NOT EXISTS idx_settings_audit_log_admin_id ON settings_audit_log(admin_id);
CREATE INDEX IF NOT EXISTS idx_settings_audit_log_created_at ON settings_audit_log(created_at);

CREATE INDEX IF NOT EXISTS idx_system_config_config_key ON system_config(config_key);
CREATE INDEX IF NOT EXISTS idx_system_config_is_active ON system_config(is_active);

-- Messaging tables indexes
CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_recipient_id ON messages(recipient_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_guardian_id ON messages(guardian_id);
CREATE INDEX IF NOT EXISTS idx_messages_patient_id ON messages(patient_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status);
CREATE INDEX IF NOT EXISTS idx_messages_is_read ON messages(is_read);

CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at);

CREATE INDEX IF NOT EXISTS idx_conversation_participants_conversation_id ON conversation_participants(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversation_participants_admin_id ON conversation_participants(admin_id);
CREATE INDEX IF NOT EXISTS idx_conversation_participants_is_active ON conversation_participants(is_active);

-- Healthcare workers tables indexes
CREATE INDEX IF NOT EXISTS idx_healthcare_workers_admin_id ON healthcare_workers(admin_id);
CREATE INDEX IF NOT EXISTS idx_healthcare_workers_specialization ON healthcare_workers(specialization);
CREATE INDEX IF NOT EXISTS idx_healthcare_workers_is_active ON healthcare_workers(is_active);

CREATE INDEX IF NOT EXISTS idx_adoption_documents_patient_id ON adoption_documents(patient_id);
CREATE INDEX IF NOT EXISTS idx_adoption_documents_uploaded_by ON adoption_documents(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_adoption_documents_is_verified ON adoption_documents(is_verified);

CREATE INDEX IF NOT EXISTS idx_feedback_admin_id ON feedback(admin_id);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status);
CREATE INDEX IF NOT EXISTS idx_feedback_assigned_to ON feedback(assigned_to);
CREATE INDEX IF NOT EXISTS idx_feedback_category ON feedback(category);

-- Alerts tables indexes
CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts(severity);
CREATE INDEX IF NOT EXISTS idx_alerts_category ON alerts(category);
CREATE INDEX IF NOT EXISTS idx_alerts_is_active ON alerts(is_active);
CREATE INDEX IF NOT EXISTS idx_alerts_is_acknowledged ON alerts(is_acknowledged);
CREATE INDEX IF NOT EXISTS idx_alerts_expires_at ON alerts(expires_at);

-- ============================================================================
-- SECTION G: FUNCTIONS
-- ============================================================================

-- Timestamp update function
CREATE OR REPLACE FUNCTION fn_update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_update_timestamp() IS 'Automatically updates the updated_at column on row modification';

-- Cache cleanup function
CREATE OR REPLACE FUNCTION fn_cache_cleanup_expired()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM cache WHERE expires_at < CURRENT_TIMESTAMP;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_cache_cleanup_expired() IS 'Removes expired cache entries and returns count of deleted entries';

-- Settings audit function
CREATE OR REPLACE FUNCTION fn_log_settings_change()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO settings_audit_log (admin_id, setting_id, category, settings_key, old_value, new_value, action)
        VALUES (NEW.admin_id, NEW.id, NEW.category, NEW.settings_key, NULL, NEW.settings_value, 'create');
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO settings_audit_log (admin_id, setting_id, category, settings_key, old_value, new_value, action)
        VALUES (NEW.admin_id, NEW.id, NEW.category, NEW.settings_key, OLD.settings_value, NEW.settings_value, 'update');
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        INSERT INTO settings_audit_log (admin_id, setting_id, category, settings_key, old_value, new_value, action)
        VALUES (OLD.admin_id, OLD.id, OLD.category, OLD.settings_key, OLD.settings_value, NULL, 'delete');
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_log_settings_change() IS 'Logs settings changes to audit table';

-- Full name function
CREATE OR REPLACE FUNCTION fn_get_full_name(first_name VARCHAR, last_name VARCHAR, middle_name VARCHAR DEFAULT NULL)
RETURNS VARCHAR AS $$
BEGIN
    IF middle_name IS NOT NULL AND middle_name != '' THEN
        RETURN first_name || ' ' || middle_name || ' ' || last_name;
    ELSE
        RETURN first_name || ' ' || last_name;
    END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_get_full_name(VARCHAR, VARCHAR, VARCHAR) IS 'Combines name parts into full name';

-- Calculate age function
CREATE OR REPLACE FUNCTION fn_calculate_age(dob DATE)
RETURNS INTEGER AS $$
BEGIN
    RETURN EXTRACT(YEAR FROM AGE(CURRENT_DATE, dob));
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_calculate_age(DATE) IS 'Calculates age in years from date of birth';

-- Calculate age in months function
CREATE OR REPLACE FUNCTION fn_calculate_age_months(dob DATE)
RETURNS INTEGER AS $$
BEGIN
    RETURN EXTRACT(YEAR FROM AGE(CURRENT_DATE, dob)) * 12 + EXTRACT(MONTH FROM AGE(CURRENT_DATE, dob));
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_calculate_age_months(DATE) IS 'Calculates age in months from date of birth';

-- ============================================================================
-- SECTION H: TRIGGERS
-- ============================================================================

-- Timestamp update triggers for all tables
CREATE TRIGGER trg_healthcare_facilities_update_timestamp
    BEFORE UPDATE ON healthcare_facilities
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_timestamp();

CREATE TRIGGER trg_admin_update_timestamp
    BEFORE UPDATE ON admin
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_timestamp();

CREATE TRIGGER trg_guardians_update_timestamp
    BEFORE UPDATE ON guardians
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_timestamp();

CREATE TRIGGER trg_patients_update_timestamp
    BEFORE UPDATE ON patients
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_timestamp();

CREATE TRIGGER trg_vaccines_update_timestamp
    BEFORE UPDATE ON vaccines
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_timestamp();

CREATE TRIGGER trg_vaccine_batches_update_timestamp
    BEFORE UPDATE ON vaccine_batches
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_timestamp();

CREATE TRIGGER trg_immunization_records_update_timestamp
    BEFORE UPDATE ON immunization_records
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_timestamp();

CREATE TRIGGER trg_vaccination_schedules_update_timestamp
    BEFORE UPDATE ON vaccination_schedules
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_timestamp();

CREATE TRIGGER trg_appointments_update_timestamp
    BEFORE UPDATE ON appointments
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_timestamp();

CREATE TRIGGER trg_schedules_update_timestamp
    BEFORE UPDATE ON schedules
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_timestamp();

CREATE TRIGGER trg_notifications_update_timestamp
    BEFORE UPDATE ON notifications
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_timestamp();

CREATE TRIGGER trg_audit_logs_update_timestamp
    BEFORE UPDATE ON audit_logs
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_timestamp();

CREATE TRIGGER trg_security_events_update_timestamp
    BEFORE UPDATE ON security_events
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_timestamp();

CREATE TRIGGER trg_failed_login_attempts_update_timestamp
    BEFORE UPDATE ON failed_login_attempts
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_timestamp();

CREATE TRIGGER trg_ip_whitelist_update_timestamp
    BEFORE UPDATE ON ip_whitelist
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_timestamp();

CREATE TRIGGER trg_health_records_update_timestamp
    BEFORE UPDATE ON health_records
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_timestamp();

CREATE TRIGGER trg_patient_growth_update_timestamp
    BEFORE UPDATE ON patient_growth
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_timestamp();

CREATE TRIGGER trg_items_update_timestamp
    BEFORE UPDATE ON items
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_timestamp();

CREATE TRIGGER trg_item_batches_update_timestamp
    BEFORE UPDATE ON item_batches
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_timestamp();

-- Medicine triggers (REMOVED - medicine tables removed for vaccination-focused system)
-- CREATE TRIGGER trg_medicines_update_timestamp
--     BEFORE UPDATE ON medicines
--     FOR EACH ROW
--     EXECUTE FUNCTION fn_update_timestamp();

-- CREATE TRIGGER trg_medicine_batches_update_timestamp
--     BEFORE UPDATE ON medicine_batches
--     FOR EACH ROW
--     EXECUTE FUNCTION fn_update_timestamp();

CREATE TRIGGER trg_suppliers_update_timestamp
    BEFORE UPDATE ON suppliers
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_timestamp();

CREATE TRIGGER trg_vaccine_inventory_update_timestamp
    BEFORE UPDATE ON vaccine_inventory
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_timestamp();

CREATE TRIGGER trg_vaccine_stock_alerts_update_timestamp
    BEFORE UPDATE ON vaccine_stock_alerts
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_timestamp();

CREATE TRIGGER trg_permissions_update_timestamp
    BEFORE UPDATE ON permissions
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_timestamp();

CREATE TRIGGER trg_admin_sessions_update_timestamp
    BEFORE UPDATE ON admin_sessions
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_timestamp();

CREATE TRIGGER trg_notification_preferences_update_timestamp
    BEFORE UPDATE ON notification_preferences
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_timestamp();

CREATE TRIGGER trg_reports_update_timestamp
    BEFORE UPDATE ON reports
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_timestamp();

CREATE TRIGGER trg_announcements_update_timestamp
    BEFORE UPDATE ON announcements
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_timestamp();

CREATE TRIGGER trg_paper_templates_update_timestamp
    BEFORE UPDATE ON paper_templates
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_timestamp();

CREATE TRIGGER trg_document_generation_update_timestamp
    BEFORE UPDATE ON document_generation
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_timestamp();

CREATE TRIGGER trg_digital_papers_update_timestamp
    BEFORE UPDATE ON digital_papers
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_timestamp();

CREATE TRIGGER trg_admin_preferences_update_timestamp
    BEFORE UPDATE ON admin_preferences
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_timestamp();

CREATE TRIGGER trg_admin_settings_update_timestamp
    BEFORE UPDATE ON admin_settings
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_timestamp();

CREATE TRIGGER trg_system_config_update_timestamp
    BEFORE UPDATE ON system_config
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_timestamp();

CREATE TRIGGER trg_messages_update_timestamp
    BEFORE UPDATE ON messages
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_timestamp();

CREATE TRIGGER trg_conversations_update_timestamp
    BEFORE UPDATE ON conversations
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_timestamp();

CREATE TRIGGER trg_healthcare_workers_update_timestamp
    BEFORE UPDATE ON healthcare_workers
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_timestamp();

CREATE TRIGGER trg_adoption_documents_update_timestamp
    BEFORE UPDATE ON adoption_documents
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_timestamp();

CREATE TRIGGER trg_feedback_update_timestamp
    BEFORE UPDATE ON feedback
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_timestamp();

CREATE TRIGGER trg_alerts_update_timestamp
    BEFORE UPDATE ON alerts
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_timestamp();

-- Settings audit trigger
CREATE TRIGGER trg_admin_settings_audit_log
    AFTER INSERT OR UPDATE OR DELETE ON admin_settings
    FOR EACH ROW
    EXECUTE FUNCTION fn_log_settings_change();

-- ============================================================================
-- SECTION I: INITIAL DATA SEEDING
-- ============================================================================

-- Insert default healthcare facility
INSERT INTO healthcare_facilities (name, region, address, contact) VALUES
    ('Main Health Center', 'Region 1', 'Main Health Center Address', 'Contact Number'),
    ('Guardian Portal', 'Virtual', 'Online Portal', 'portal@immunicare.com')
ON CONFLICT (name) DO NOTHING;

-- Insert default admin users with roles
INSERT INTO admin (username, password_hash, role, facility_id, contact, email, is_active) VALUES
    ('admin', '$2b$10$rOz8QK.hVv7YJHQv5tKQ9uJjRrQw5b9wN6mH8pC2xY7zA1kL3mN9q', 'super_admin', 1, 'admin@immunicare.com', 'admin@immunicare.com', TRUE),
    ('doctor1', '$2b$10$rOz8QK.hVv7YJHQv5tKQ9uJjRrQw5b9wN6mH8pC2xY7zA1kL3mN9q', 'doctor', 1, 'doctor@immunicare.com', 'doctor@immunicare.com', TRUE),
    ('nurse1', '$2b$10$rOz8QK.hVv7YJHQv5tKQ9uJjRrQw5b9wN6mH8pC2xY7zA1kL3mN9q', 'nurse', 1, 'nurse@immunicare.com', 'nurse@immunicare.com', TRUE)
ON CONFLICT (username) DO NOTHING;

-- Insert default vaccines
INSERT INTO vaccines (code, name, manufacturer, doses_required) VALUES
    ('BCG', 'BCG', 'Various', 1),
    ('BCG-DIL', 'BCG, Diluent', 'Various', 1),
    ('HEP-B', 'Hepa B', 'Various', 3),
    ('PENTA', 'Penta Valent', 'Various', 3),
    ('OPV-20', 'OPV 20-doses', 'Various', 4),
    ('PCV-13-10', 'PCV 13 / PCV 10', 'Various', 3),
    ('MR', 'Measles & Rubella (MR)', 'Various', 2),
    ('MMR', 'MMR', 'Various', 2),
    ('MMR-DIL', 'MMR, Diluent 5ml', 'Various', 2),
    ('IPV-MULTI', 'IPV multi dose', 'Various', 4)
ON CONFLICT (code) DO NOTHING;

-- Insert default vaccination schedules
INSERT INTO vaccination_schedules (vaccine_name, dose_number, dose_name, age_months, age_description, description) VALUES
    ('BCG Vaccine', 1, 'BCG', 0, 'At Birth', 'Tuberculosis vaccine given at birth'),
    ('Hepatitis B Vaccine', 1, 'Hep B Birth Dose', 0, 'At Birth', 'Hepatitis B vaccine given at birth'),
    ('Hepatitis B Vaccine', 2, 'Hep B 1', 1, '1 month', 'Second dose of Hepatitis B vaccine'),
    ('Hepatitis B Vaccine', 3, 'Hep B 2', 6, '6 months', 'Third dose of Hepatitis B vaccine'),
    ('Pentavalent Vaccine', 1, 'DPT 1', 1.5, '1½ months', 'First dose of Pentavalent vaccine (DPT-HepB-HIB)'),
    ('Pentavalent Vaccine', 2, 'DPT 2', 2.5, '2½ months', 'Second dose of Pentavalent vaccine'),
    ('Pentavalent Vaccine', 3, 'DPT 3', 3.5, '3½ months', 'Third dose of Pentavalent vaccine'),
    ('Oral Polio Vaccine', 1, 'OPV 1', 1.5, '1½ months', 'First dose of Oral Polio vaccine'),
    ('Oral Polio Vaccine', 2, 'OPV 2', 2.5, '2½ months', 'Second dose of Oral Polio vaccine'),
    ('Oral Polio Vaccine', 3, 'OPV 3', 3.5, '3½ months', 'Third dose of Oral Polio vaccine'),
    ('Inactivated Polio Vaccine', 1, 'IPV 1', 3.5, '3½ months', 'First dose of Inactivated Polio vaccine'),
    ('Inactivated Polio Vaccine', 2, 'IPV 2', 9, '9 months', 'Second dose of Inactivated Polio vaccine'),
    ('Pneumococcal Conjugate Vaccine', 1, 'PCV 1', 1.5, '1½ months', 'First dose of Pneumococcal Conjugate vaccine'),
    ('Pneumococcal Conjugate Vaccine', 2, 'PCV 2', 2.5, '2½ months', 'Second dose of Pneumococcal Conjugate vaccine'),
    ('Pneumococcal Conjugate Vaccine', 3, 'PCV 3', 3.5, '3½ months', 'Third dose of Pneumococcal Conjugate vaccine'),
    ('Measles, Mumps, Rubella', 1, 'MMR 1', 9, '9 months', 'First dose of MMR vaccine'),
    ('Measles, Mumps, Rubella', 2, 'MMR 2', 12, '12 months', 'Second dose of MMR vaccine')
ON CONFLICT (vaccine_name, dose_number) DO NOTHING;

-- Insert default system configuration
INSERT INTO system_config (config_key, config_value, description) VALUES
    ('working_hours', '{"start": "08:00", "end": "17:00", "days": ["monday", "tuesday", "wednesday", "thursday", "friday"]}', 'Standard working hours for health center'),
    ('system_version', '"1.0.0"', 'Current system version'),
    ('maintenance_mode', 'false', 'System maintenance mode flag')
ON CONFLICT (config_key) DO NOTHING;

-- Insert sample trusted IPs
INSERT INTO ip_whitelist (ip_address, description) VALUES
    ('127.0.0.1', 'Localhost'),
    ('::1', 'IPv6 Localhost')
ON CONFLICT (ip_address) DO NOTHING;

-- ============================================================================
-- SECTION J: CONSTRAINTS AND VALIDATIONS
-- ============================================================================

-- Check constraints for data integrity
ALTER TABLE paper_templates
ADD CONSTRAINT chk_paper_templates_type
CHECK (template_type IN ('IMMUNIZATION_RECORD', 'BIRTH_CERTIFICATE', 'MEDICAL_REPORT', 'GROWTH_CHART', 'OTHER'));

ALTER TABLE announcements
ADD CONSTRAINT chk_announcements_priority
CHECK (priority IN ('low', 'medium', 'high', 'urgent'));

ALTER TABLE announcements
ADD CONSTRAINT chk_announcements_status
CHECK (status IN ('draft', 'published', 'archived'));

ALTER TABLE announcements
ADD CONSTRAINT chk_announcements_target_audience
CHECK (target_audience IN ('all', 'patients', 'staff'));

-- Admin role check constraint
ALTER TABLE admin
ADD CONSTRAINT chk_admin_role
CHECK (role IN ('admin', 'super_admin', 'doctor', 'nurse'));

-- ============================================================================
-- END OF SCHEMA
-- ============================================================================

-- Verification query to confirm schema creation
SELECT
    'Immunicare Database Schema' AS schema_name,
    '2.1.0' AS version,
    CURRENT_TIMESTAMP AS created_at,
    COUNT(*) AS total_tables
FROM information_schema.tables
WHERE table_schema = 'public'
AND table_type = 'BASE TABLE';
