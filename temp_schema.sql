-- ===========================================
-- IMMUNICARE COMPREHENSIVE DATABASE SCHEMA
-- Complete Healthcare Management System
-- PostgreSQL Database Schema
-- ===========================================

-- ===========================================
-- DATABASE SETUP AND CONFIGURATION
-- ===========================================

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ===========================================
-- ENUM TYPES DEFINITION
-- ===========================================

-- Create custom enum types used in the schema
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'infant_sex') THEN
        CREATE TYPE infant_sex AS ENUM ('M', 'F');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'record_type') THEN
        CREATE TYPE record_type AS ENUM (
            'vaccination_certificate', 'birth_certificate', 'medical_report',
            'growth_chart', 'allergy_record', 'medication_record', 'lab_result',
            'imaging_result', 'consultation_note', 'discharge_summary',
            'immunization_card', 'developmental_assessment', 'hearing_screening',
            'vision_screening', 'dental_record', 'other'
        );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'signature_status') THEN
        CREATE TYPE signature_status AS ENUM ('not_required', 'pending', 'verified', 'rejected');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vaccine_type') THEN
        CREATE TYPE vaccine_type AS ENUM (
            'live_attenuated', 'inactivated', 'subunit', 'toxoid', 'mrna',
            'viral_vector', 'conjugate', 'combination', 'other'
        );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'administration_route') THEN
        CREATE TYPE administration_route AS ENUM ('intramuscular', 'subcutaneous', 'oral', 'intranasal', 'intradermal');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'priority_level') THEN
        CREATE TYPE priority_level AS ENUM ('high', 'medium', 'low');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'approval_status') THEN
        CREATE TYPE approval_status AS ENUM ('draft', 'pending_review', 'approved', 'deprecated');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'scope_type') THEN
        CREATE TYPE scope_type AS ENUM ('global', 'clinic', 'own', 'assigned');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'item_type') THEN
        CREATE TYPE item_type AS ENUM ('Vaccine', 'Medicine');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'txn_type') THEN
        CREATE TYPE txn_type AS ENUM ('RECEIVE', 'ISSUE', 'WASTAGE', 'ADJUST');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'batch_status') THEN
        CREATE TYPE batch_status AS ENUM ('active', 'expired', 'depleted');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'appointment_status') THEN
        CREATE TYPE appointment_status AS ENUM ('scheduled', 'attended', 'no-show', 'rescheduled', 'cancelled');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'medicine_type') THEN
        CREATE TYPE medicine_type AS ENUM ('illness', 'allergies', 'antibiotics', 'vitamins', 'other');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'medicine_form') THEN
        CREATE TYPE medicine_form AS ENUM ('pills', 'creams', 'injections', 'inhalers', 'syrup', 'other');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'target_audience') THEN
        CREATE TYPE target_audience AS ENUM ('all', 'patients', 'staff');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'announcement_priority') THEN
        CREATE TYPE announcement_priority AS ENUM ('low', 'medium', 'high', 'urgent');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'channel_type') THEN
        CREATE TYPE channel_type AS ENUM ('sms', 'email', 'push', 'both');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_priority') THEN
        CREATE TYPE notification_priority AS ENUM ('low', 'normal', 'high', 'urgent');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_status') THEN
        CREATE TYPE notification_status AS ENUM ('pending', 'queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'cancelled');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'frequency_type') THEN
        CREATE TYPE frequency_type AS ENUM ('immediate', 'daily', 'weekly', 'monthly');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'report_type') THEN
        CREATE TYPE report_type AS ENUM ('vaccination', 'inventory', 'appointment', 'guardian', 'infant', 'system', 'custom');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'report_status') THEN
        CREATE TYPE report_status AS ENUM ('generating', 'completed', 'failed');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'file_format') THEN
        CREATE TYPE file_format AS ENUM ('pdf', 'excel', 'csv', 'json');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'supplier_type') THEN
        CREATE TYPE supplier_type AS ENUM (
            'pharmaceutical', 'medical_supplies', 'equipment', 'vaccines',
            'laboratory', 'distributor', 'manufacturer', 'wholesaler', 'other'
        );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_method') THEN
        CREATE TYPE payment_method AS ENUM ('check', 'bank_transfer', 'credit_card', 'cash', 'other');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'login_method') THEN
        CREATE TYPE login_method AS ENUM ('password', 'social', 'impersonation', 'api');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'measurement_method') THEN
        CREATE TYPE measurement_method AS ENUM ('digital_scale', 'manual_scale', 'length_board', 'tape_measure', 'other');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'feeding_status') THEN
        CREATE TYPE feeding_status AS ENUM ('before_feeding', 'after_feeding', 'fasting', 'unknown');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'health_status') THEN
        CREATE TYPE health_status AS ENUM ('well', 'minor_illness', 'acute_illness', 'chronic_condition');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'growth_pattern') THEN
        CREATE TYPE growth_pattern AS ENUM ('normal', 'slow', 'rapid', 'irregular', 'concerning');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'nutritional_status') THEN
        CREATE TYPE nutritional_status AS ENUM ('normal', 'underweight', 'overweight', 'obese', 'wasted', 'stunted');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'template_type') THEN
        CREATE TYPE template_type AS ENUM ('VACCINE_SCHEDULE', 'IMMUNIZATION_RECORD', 'INVENTORY_LOGBOOK', 'GROWTH_CHART');
    END IF;
END $$;

-- ===========================================
-- CORE SYSTEM TABLES
-- ===========================================

-- Roles table with hierarchical permissions
CREATE TABLE IF NOT EXISTS roles (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    permissions JSONB,
    display_name VARCHAR(255),
    is_system_role BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    hierarchy_level INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Clinics table for multi-tenant support
CREATE TABLE IF NOT EXISTS clinics (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    region VARCHAR(255),
    address TEXT,
    contact VARCHAR(255),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Users table with role-based access control
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role_id INTEGER NOT NULL REFERENCES roles(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    clinic_id INTEGER NOT NULL REFERENCES clinics(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    contact VARCHAR(255),
    last_login TIMESTAMP,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Guardians table for infant care management
CREATE TABLE IF NOT EXISTS guardians (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    address TEXT,
    relationship VARCHAR(255),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Infants table with comprehensive health data
CREATE TABLE IF NOT EXISTS infants (
    id SERIAL PRIMARY KEY,
    first_name VARCHAR(255) NOT NULL,
    last_name VARCHAR(255) NOT NULL,
    dob DATE NOT NULL,
    sex infant_sex NOT NULL,
    national_id VARCHAR(255),
    address TEXT,
    contact VARCHAR(255),
    guardian_id INTEGER NOT NULL REFERENCES guardians(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    -- Extended fields for digital infant personal information record
    birth_height DECIMAL(5, 2), -- cm
    birth_weight DECIMAL(5, 3), -- kg
    mother_name VARCHAR(255),
    father_name VARCHAR(255),
    barangay VARCHAR(255),
    health_center VARCHAR(255),
    family_no VARCHAR(50),
    place_of_birth VARCHAR(255),
    time_of_delivery TIME,
    type_of_delivery VARCHAR(10), -- NSD/CS
    doctor_midwife_nurse VARCHAR(20), -- Doctor/Midwife/Nurse/Hilot
    nbs_done BOOLEAN DEFAULT FALSE, -- Newborn Screening
    nbs_date DATE,
    cellphone_number VARCHAR(20),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Vaccines table with comprehensive vaccine information
CREATE TABLE IF NOT EXISTS vaccines (
    id SERIAL PRIMARY KEY,
    code VARCHAR(255) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    manufacturer VARCHAR(255),
    doses_required INTEGER NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Vaccine batches table for inventory tracking
CREATE TABLE IF NOT EXISTS vaccine_batches (
    id SERIAL PRIMARY KEY,
    vaccine_id INTEGER NOT NULL REFERENCES vaccines(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    lot_no VARCHAR(255) NOT NULL,
    expiry_date DATE NOT NULL,
    qty_received INTEGER NOT NULL,
    qty_current INTEGER NOT NULL DEFAULT 0,
    clinic_id INTEGER NOT NULL REFERENCES clinics(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Vaccination records table for tracking immunizations
CREATE TABLE IF NOT EXISTS vaccination_records (
    id SERIAL PRIMARY KEY,
    infant_id INTEGER NOT NULL REFERENCES infants(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    vaccine_id INTEGER NOT NULL REFERENCES vaccines(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    batch_id INTEGER NOT NULL REFERENCES vaccine_batches(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    dose_no INTEGER NOT NULL,
    admin_date TIMESTAMP NOT NULL,
    vaccinator_id INTEGER NOT NULL REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    notes TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Vaccination schedules table for immunization planning
CREATE TABLE IF NOT EXISTS vaccination_schedules (
    id SERIAL PRIMARY KEY,
    vaccine_name VARCHAR(255) NOT NULL,
    vaccine_code VARCHAR(50),
    disease_prevented VARCHAR(255) NOT NULL,
    vaccine_type vaccine_type NOT NULL,
    manufacturer VARCHAR(255),
    target_age_weeks INTEGER NOT NULL,
    target_age_months INTEGER NOT NULL,
    min_age_weeks INTEGER NOT NULL,
    max_age_weeks INTEGER,
    dose_number INTEGER NOT NULL,
    total_doses INTEGER NOT NULL,
    interval_weeks INTEGER,
    is_mandatory BOOLEAN NOT NULL DEFAULT TRUE,
    is_routine BOOLEAN NOT NULL DEFAULT TRUE,
    priority_level priority_level NOT NULL DEFAULT 'medium',
    contraindications TEXT,
    precautions TEXT,
    side_effects TEXT,
    administration_route administration_route NOT NULL,
    administration_site VARCHAR(100),
    dosage_ml DECIMAL(4, 2),
    diluent_info TEXT,
    storage_requirements TEXT,
    who_recommendation TEXT,
    philippine_doh_guideline TEXT,
    catch_up_schedule JSONB,
    booster_schedule JSONB,
    special_populations JSONB,
    combination_vaccines JSONB,
    incompatible_vaccines JSONB,
    minimum_interval_same_vaccine INTEGER,
    minimum_interval_different_vaccines INTEGER,
    grace_period_weeks INTEGER DEFAULT 4,
    validity_period_years INTEGER,
    seasonal_availability JSONB,
    cost_per_dose DECIMAL(8, 2),
    insurance_coverage BOOLEAN,
    documentation_required JSONB,
    monitoring_requirements TEXT,
    efficacy_rate DECIMAL(5, 2),
    effectiveness_data JSONB,
    research_references TEXT,
    last_updated DATE,
    updated_by INTEGER REFERENCES users(id),
    approval_status approval_status NOT NULL DEFAULT 'draft',
    approved_by INTEGER REFERENCES users(id),
    approved_at TIMESTAMP,
    version INTEGER NOT NULL DEFAULT 1,
    effective_date DATE NOT NULL,
    expiry_date DATE,
    notes TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Appointments table for scheduling
CREATE TABLE IF NOT EXISTS appointments (
    id SERIAL PRIMARY KEY,
    infant_id INTEGER NOT NULL REFERENCES infants(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    scheduled_date TIMESTAMP NOT NULL,
    type VARCHAR(255),
    status appointment_status NOT NULL DEFAULT 'scheduled',
    notes TEXT,
    created_by INTEGER NOT NULL REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Health records table for medical documentation
CREATE TABLE IF NOT EXISTS health_records (
    id SERIAL PRIMARY KEY,
    infant_id INTEGER NOT NULL REFERENCES infants(id) ON UPDATE CASCADE ON DELETE RESTRICT,
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
    signed_by INTEGER REFERENCES users(id),
    signed_at TIMESTAMP,
    signature_notes TEXT,
    tags JSONB DEFAULT '[]',
    metadata JSONB,
    ocr_text TEXT,
    thumbnail_path VARCHAR(500),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    version INTEGER NOT NULL DEFAULT 1,
    parent_record_id INTEGER REFERENCES health_records(id),
    uploaded_by INTEGER NOT NULL REFERENCES users(id),
    reviewed_by INTEGER REFERENCES users(id),
    reviewed_at TIMESTAMP,
    review_notes TEXT,
    expiry_date DATE,
    reminder_date DATE,
    access_count INTEGER NOT NULL DEFAULT 0,
    last_accessed TIMESTAMP,
    access_log JSONB DEFAULT '[]',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Infant growth table for monitoring development
CREATE TABLE IF NOT EXISTS infant_growth (
    id SERIAL PRIMARY KEY,
    infant_id INTEGER NOT NULL REFERENCES infants(id) ON UPDATE CASCADE ON DELETE RESTRICT,
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
    measured_by INTEGER REFERENCES users(id),
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
    created_by INTEGER REFERENCES users(id),
    updated_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Items table for inventory management
CREATE TABLE IF NOT EXISTS items (
    id SERIAL PRIMARY KEY,
    type item_type NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    doses_required INTEGER,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Item batches table for batch tracking
CREATE TABLE IF NOT EXISTS item_batches (
    id SERIAL PRIMARY KEY,
    item_id INTEGER NOT NULL REFERENCES items(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    lot_number VARCHAR(255) NOT NULL,
    expiry_date DATE NOT NULL,
    qty_received INTEGER NOT NULL,
    qty_available INTEGER NOT NULL,
    status batch_status NOT NULL DEFAULT 'active',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Medicines table for pharmaceutical management
CREATE TABLE IF NOT EXISTS medicines (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    generic_name VARCHAR(255),
    type medicine_type NOT NULL,
    form medicine_form NOT NULL,
    manufacturer VARCHAR(255),
    uses TEXT,
    storage_instructions TEXT,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Medicine batches table for medicine inventory
CREATE TABLE IF NOT EXISTS medicine_batches (
    id SERIAL PRIMARY KEY,
    medicine_id INTEGER NOT NULL REFERENCES medicines(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    lot_no VARCHAR(255) NOT NULL,
    expiry_date DATE NOT NULL,
    qty_received INTEGER NOT NULL,
    qty_current INTEGER NOT NULL DEFAULT 0,
    clinic_id INTEGER NOT NULL REFERENCES clinics(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Inventory transactions table for tracking movements
CREATE TABLE IF NOT EXISTS inventory_transactions (
    id SERIAL PRIMARY KEY,
    batch_id INTEGER NOT NULL REFERENCES vaccine_batches(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    txn_type txn_type NOT NULL,
    qty INTEGER NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    notes TEXT
);

-- Suppliers table for vendor management
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
    created_by INTEGER REFERENCES users(id),
    updated_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Paper templates configuration table
CREATE TABLE IF NOT EXISTS paper_templates (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    template_type template_type NOT NULL,
    fields JSONB NOT NULL, -- Field configuration with mapping to database fields
    validation_rules JSONB, -- Validation rules for required fields
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER REFERENCES users(id),
    updated_by INTEGER REFERENCES users(id)
);

-- Document downloads tracking table
CREATE TABLE IF NOT EXISTS document_downloads (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    infant_id INTEGER REFERENCES infants(id),
    template_id INTEGER REFERENCES paper_templates(id),
    download_type VARCHAR(50) DEFAULT 'PDF', -- 'PDF', 'EXCEL', 'PRINT'
    download_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    file_path VARCHAR(500),
    download_status VARCHAR(20) DEFAULT 'COMPLETED', -- 'PENDING', 'COMPLETED', 'FAILED'
    ip_address INET,
    user_agent TEXT,
    download_reason VARCHAR(100), -- 'USER_REQUEST', 'ADMIN_GENERATION', 'SCHEDULED'
    file_size INTEGER, -- File size in bytes
    expires_at TIMESTAMP, -- Optional expiration for temporary files
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Paper completion status tracking table
CREATE TABLE IF NOT EXISTS paper_completion_status (
    id SERIAL PRIMARY KEY,
    infant_id INTEGER REFERENCES infants(id),
    template_id INTEGER REFERENCES paper_templates(id),
    completion_status VARCHAR(20) DEFAULT 'PENDING', -- 'PENDING', 'COMPLETED', 'EXPIRED', 'NOT_APPLICABLE'
    last_updated TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_by INTEGER REFERENCES users(id),
    notes TEXT,
    required_fields_count INTEGER DEFAULT 0,
    completed_fields_count INTEGER DEFAULT 0,
    completion_percentage INTEGER DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Document access permissions table
CREATE TABLE IF NOT EXISTS document_access_permissions (
    id SERIAL PRIMARY KEY,
    template_id INTEGER REFERENCES paper_templates(id),
    role_id INTEGER REFERENCES roles(id),
    can_view BOOLEAN DEFAULT true,
    can_download BOOLEAN DEFAULT true,
    can_generate BOOLEAN DEFAULT true,
    can_share BOOLEAN DEFAULT false,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Document templates library table
CREATE TABLE IF NOT EXISTS document_templates_library (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    template_type template_type NOT NULL,
    template_content JSONB NOT NULL, -- Complete template structure
    version VARCHAR(20) DEFAULT '1.0',
    is_public BOOLEAN DEFAULT true, -- Whether template is available to all users
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER REFERENCES users(id)
);

-- Document generation logs table
CREATE TABLE IF NOT EXISTS document_generation_logs (
    id SERIAL PRIMARY KEY,
    template_id INTEGER REFERENCES paper_templates(id),
    infant_id INTEGER REFERENCES infants(id),
    user_id INTEGER REFERENCES users(id),
    generation_type VARCHAR(50) NOT NULL, -- 'MANUAL', 'AUTOMATIC', 'BATCH'
    generation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20) DEFAULT 'SUCCESS', -- 'SUCCESS', 'FAILED', 'PARTIAL'
    error_message TEXT,
    generated_files JSONB, -- Array of generated file paths and types
    processing_time INTEGER, -- Processing time in milliseconds
    data_source JSONB, -- Source data used for generation
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Permissions table for fine-grained access control
CREATE TABLE IF NOT EXISTS permissions (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    resource VARCHAR(255) NOT NULL,
    action VARCHAR(255) NOT NULL,
    scope scope_type NOT NULL DEFAULT 'global',
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP
);

-- Role permissions junction table
CREATE TABLE IF NOT EXISTS role_permissions (
    id SERIAL PRIMARY KEY,
    role_id INTEGER NOT NULL REFERENCES roles(id) ON UPDATE CASCADE ON DELETE CASCADE,
    permission_id INTEGER NOT NULL REFERENCES permissions(id) ON UPDATE CASCADE ON DELETE CASCADE,
    granted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    granted_by INTEGER REFERENCES users(id),
    restrictions JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(role_id, permission_id)
);

-- Notifications table for system messaging
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
    scheduled_for TIMESTAMP,
    sent_at TIMESTAMP,
    delivered_at TIMESTAMP,
    read_at TIMESTAMP,
    failed_at TIMESTAMP,
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
    response_deadline TIMESTAMP,
    response_received TEXT,
    response_at TIMESTAMP,
    tags JSONB,
    metadata JSONB,
    created_by INTEGER REFERENCES users(id),
    cancelled_by INTEGER REFERENCES users(id),
    cancelled_at TIMESTAMP,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Notification preferences table
CREATE TABLE IF NOT EXISTS notification_preferences (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE,
    notification_type VARCHAR(50) NOT NULL,
    channel channel_type NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    frequency frequency_type NOT NULL DEFAULT 'immediate',
    quiet_hours_start TIME,
    quiet_hours_end TIME,
    timezone VARCHAR(50) DEFAULT 'UTC',
    custom_message TEXT,
    conditions JSONB,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP
);

-- Reports table for system reporting
CREATE TABLE IF NOT EXISTS reports (
    report_id SERIAL PRIMARY KEY,
    type report_type NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    parameters JSONB,
    file_path VARCHAR(500),
    file_format file_format,
    status report_status NOT NULL DEFAULT 'generating',
    generated_by INTEGER NOT NULL REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
    date_generated TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP,
    download_count INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Announcements table for system communications
CREATE TABLE IF NOT EXISTS announcements (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    priority announcement_priority NOT NULL DEFAULT 'medium',
    target_audience target_audience NOT NULL DEFAULT 'all',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    expires_at TIMESTAMP,
    created_by INTEGER NOT NULL REFERENCES users(id),
    is_published BOOLEAN NOT NULL DEFAULT FALSE,
    published_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP
);

-- Audit logs table for security and compliance
CREATE TABLE IF NOT EXISTS audit_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
    event_type VARCHAR(255) NOT NULL,
    entity_type VARCHAR(255),
    entity_id INTEGER,
    old_values TEXT,
    new_values TEXT,
    metadata TEXT,
    timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ip_address VARCHAR(45),
    user_agent TEXT,
    session_id VARCHAR(255)
);

-- User sessions table for session management
CREATE TABLE IF NOT EXISTS user_sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE,
    session_token VARCHAR(255) NOT NULL UNIQUE,
    ip_address VARCHAR(45),
    user_agent TEXT,
    device_info JSONB,
    location_info JSONB,
    login_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    logout_time TIMESTAMP,
    last_activity TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    session_duration INTEGER,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    login_method login_method NOT NULL DEFAULT 'password',
    impersonated_by INTEGER REFERENCES users(id),
    security_events JSONB DEFAULT '[]',
    metadata JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Cache entries table for performance optimization
CREATE TABLE IF NOT EXISTS cache_entries (
    key VARCHAR(255) PRIMARY KEY,
    value TEXT NOT NULL,
    expires_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- System configuration table
CREATE TABLE IF NOT EXISTS system_config (
    id SERIAL PRIMARY KEY,
    config_key VARCHAR(255) NOT NULL UNIQUE,
    config_value JSONB,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Adoption documents table for legal documentation
CREATE TABLE IF NOT EXISTS adoption_documents (
    id SERIAL PRIMARY KEY,
    infant_id INTEGER NOT NULL REFERENCES infants(id) ON UPDATE CASCADE ON DELETE CASCADE,
    document_type VARCHAR(255) NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    uploaded_by INTEGER NOT NULL REFERENCES users(id),
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    verified_by INTEGER REFERENCES users(id),
    verified_at TIMESTAMP,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Feedback table for system improvement
CREATE TABLE IF NOT EXISTS feedback (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
    subject VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    category VARCHAR(100),
    priority VARCHAR(50) DEFAULT 'normal',
    status VARCHAR(50) DEFAULT 'open',
    assigned_to INTEGER REFERENCES users(id),
    resolved_at TIMESTAMP,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Vaccine inventory tracking table (based on ITEMS_vaccines.docx structure)
CREATE TABLE IF NOT EXISTS vaccine_inventory (
    id SERIAL PRIMARY KEY,
    vaccine_id INTEGER NOT NULL REFERENCES vaccines(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    clinic_id INTEGER NOT NULL REFERENCES clinics(id) ON UPDATE CASCADE ON DELETE RESTRICT,

    -- Beginning Balance (VIALS PCS)
    beginning_balance INTEGER NOT NULL DEFAULT 0,

    -- Received During the Period (VIALS PCS)
    received_during_period INTEGER NOT NULL DEFAULT 0,

    -- Lot of Batch Number
    lot_batch_number VARCHAR(255),

    -- Transferred In/Out
    transferred_in INTEGER NOT NULL DEFAULT 0,
    transferred_out INTEGER NOT NULL DEFAULT 0,

    -- Expired/Wasted
    expired_wasted INTEGER NOT NULL DEFAULT 0,

    -- Total Available (VIALS PCS) (B+C)
    total_available INTEGER GENERATED ALWAYS AS (beginning_balance + received_during_period) STORED,

    -- Issuance (VIALS PCS)
    issuance INTEGER NOT NULL DEFAULT 0,

    -- Stock on Hand as of _____ (VIALS PCS) (I+J)
    stock_on_hand INTEGER GENERATED ALWAYS AS (total_available + transferred_in - transferred_out - expired_wasted - issuance) STORED,

    -- Low Stock Alert Configuration
    low_stock_threshold INTEGER NOT NULL DEFAULT 10,
    critical_stock_threshold INTEGER NOT NULL DEFAULT 5,

    -- Stock Status
    is_low_stock BOOLEAN NOT NULL DEFAULT FALSE,
    is_critical_stock BOOLEAN NOT NULL DEFAULT FALSE,

    -- Period tracking
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,

    -- Tracking fields
    created_by INTEGER NOT NULL REFERENCES users(id),
    updated_by INTEGER REFERENCES users(id),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Vaccine inventory transaction logs
CREATE TABLE IF NOT EXISTS vaccine_inventory_transactions (
    id SERIAL PRIMARY KEY,
    vaccine_inventory_id INTEGER NOT NULL REFERENCES vaccine_inventory(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    vaccine_id INTEGER NOT NULL REFERENCES vaccines(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    clinic_id INTEGER NOT NULL REFERENCES clinics(id) ON UPDATE CASCADE ON DELETE RESTRICT,

    transaction_type VARCHAR(50) NOT NULL, -- 'RECEIVE', 'TRANSFER_IN', 'TRANSFER_OUT', 'ISSUE', 'EXPIRE', 'WASTE', 'ADJUST'
    quantity INTEGER NOT NULL,
    previous_balance INTEGER NOT NULL,
    new_balance INTEGER NOT NULL,

    -- Transaction details
    lot_number VARCHAR(255),
    batch_number VARCHAR(255),
    expiry_date DATE,
    supplier_name VARCHAR(255),
    reference_number VARCHAR(255),

    -- User and notes
    performed_by INTEGER NOT NULL REFERENCES users(id),
    approved_by INTEGER REFERENCES users(id),
    notes TEXT,

    -- Alert flags
    triggered_low_stock_alert BOOLEAN NOT NULL DEFAULT FALSE,
    triggered_critical_stock_alert BOOLEAN NOT NULL DEFAULT FALSE,

    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Low stock alerts table
CREATE TABLE IF NOT EXISTS vaccine_stock_alerts (
    id SERIAL PRIMARY KEY,
    vaccine_inventory_id INTEGER NOT NULL REFERENCES vaccine_inventory(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    vaccine_id INTEGER NOT NULL REFERENCES vaccines(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    clinic_id INTEGER NOT NULL REFERENCES clinics(id) ON UPDATE CASCADE ON DELETE RESTRICT,

    alert_type VARCHAR(50) NOT NULL, -- 'LOW_STOCK', 'CRITICAL_STOCK', 'EXPIRY_WARNING'
    current_stock INTEGER NOT NULL,
    threshold_value INTEGER NOT NULL,

    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED'

    -- Alert details
    message TEXT NOT NULL,
    priority VARCHAR(20) NOT NULL DEFAULT 'MEDIUM', -- 'LOW', 'MEDIUM', 'HIGH', 'URGENT'

    -- Resolution tracking
    acknowledged_by INTEGER REFERENCES users(id),
    acknowledged_at TIMESTAMP,
    resolved_by INTEGER REFERENCES users(id),
    resolved_at TIMESTAMP,
    resolution_notes TEXT,

    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ===========================================
-- COMPREHENSIVE INDEXES FOR PERFORMANCE
-- ===========================================

-- Roles indexes
CREATE INDEX IF NOT EXISTS idx_roles_is_active ON roles(is_active);
CREATE INDEX IF NOT EXISTS idx_roles_hierarchy_level ON roles(hierarchy_level);
CREATE INDEX IF NOT EXISTS idx_roles_is_system_role ON roles(is_system_role);

-- Users indexes
CREATE INDEX IF NOT EXISTS idx_users_role_id ON users(role_id);
CREATE INDEX IF NOT EXISTS idx_users_clinic_id ON users(clinic_id);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active);

-- Infants indexes
CREATE INDEX IF NOT EXISTS idx_infants_guardian_id ON infants(guardian_id);
CREATE INDEX IF NOT EXISTS idx_infants_dob ON infants(dob);
CREATE INDEX IF NOT EXISTS idx_infants_national_id ON infants(national_id);

-- Vaccination records indexes
CREATE INDEX IF NOT EXISTS idx_vaccination_records_infant_id ON vaccination_records(infant_id);
CREATE INDEX IF NOT EXISTS idx_vaccination_records_vaccine_id ON vaccination_records(vaccine_id);
CREATE INDEX IF NOT EXISTS idx_vaccination_records_batch_id ON vaccination_records(batch_id);
CREATE INDEX IF NOT EXISTS idx_vaccination_records_admin_date ON vaccination_records(admin_date);
CREATE INDEX IF NOT EXISTS idx_vaccination_records_vaccinator_id ON vaccination_records(vaccinator_id);

-- Vaccination schedules indexes
CREATE INDEX IF NOT EXISTS idx_vaccination_schedules_name ON vaccination_schedules(vaccine_name);
CREATE INDEX IF NOT EXISTS idx_vaccination_schedules_code ON vaccination_schedules(vaccine_code);
CREATE INDEX IF NOT EXISTS idx_vaccination_schedules_disease ON vaccination_schedules(disease_prevented);
CREATE INDEX IF NOT EXISTS idx_vaccination_schedules_target_age ON vaccination_schedules(target_age_months);
CREATE INDEX IF NOT EXISTS idx_vaccination_schedules_dose ON vaccination_schedules(dose_number);
CREATE INDEX IF NOT EXISTS idx_vaccination_schedules_mandatory ON vaccination_schedules(is_mandatory);
CREATE INDEX IF NOT EXISTS idx_vaccination_schedules_routine ON vaccination_schedules(is_routine);
CREATE INDEX IF NOT EXISTS idx_vaccination_schedules_priority ON vaccination_schedules(priority_level);
CREATE INDEX IF NOT EXISTS idx_vaccination_schedules_active ON vaccination_schedules(is_active);
CREATE INDEX IF NOT EXISTS idx_vaccination_schedules_approval ON vaccination_schedules(approval_status);
CREATE INDEX IF NOT EXISTS idx_vaccination_schedules_effective_date ON vaccination_schedules(effective_date);
CREATE INDEX IF NOT EXISTS idx_vaccination_schedules_expiry_date ON vaccination_schedules(expiry_date);
CREATE INDEX IF NOT EXISTS idx_vaccination_schedules_type ON vaccination_schedules(vaccine_type);
CREATE INDEX IF NOT EXISTS idx_vaccination_schedules_route ON vaccination_schedules(administration_route);
CREATE INDEX IF NOT EXISTS idx_vaccination_schedules_age_dose ON vaccination_schedules(target_age_months, dose_number);
CREATE INDEX IF NOT EXISTS idx_vaccination_schedules_mandatory_active ON vaccination_schedules(is_mandatory, is_active);

-- Appointments indexes
CREATE INDEX IF NOT EXISTS idx_appointments_infant_id ON appointments(infant_id);
CREATE INDEX IF NOT EXISTS idx_appointments_scheduled_date ON appointments(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);
CREATE INDEX IF NOT EXISTS idx_appointments_type ON appointments(type);

-- Health records indexes
CREATE INDEX IF NOT EXISTS idx_health_records_infant_id ON health_records(infant_id);
CREATE INDEX IF NOT EXISTS idx_health_records_type ON health_records(record_type);
CREATE INDEX IF NOT EXISTS idx_health_records_document_date ON health_records(document_date);
CREATE INDEX IF NOT EXISTS idx_health_records_visit_date ON health_records(visit_date);
CREATE INDEX IF NOT EXISTS idx_health_records_confidential ON health_records(is_confidential);
CREATE INDEX IF NOT EXISTS idx_health_records_active ON health_records(is_active);
CREATE INDEX IF NOT EXISTS idx_health_records_uploaded_by ON health_records(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_health_records_reviewed_by ON health_records(reviewed_by);
CREATE INDEX IF NOT EXISTS idx_health_records_expiry_date ON health_records(expiry_date);
CREATE INDEX IF NOT EXISTS idx_health_records_reminder_date ON health_records(reminder_date);
CREATE INDEX IF NOT EXISTS idx_health_records_infant_type ON health_records(infant_id, record_type);
CREATE INDEX IF NOT EXISTS idx_health_records_infant_active ON health_records(infant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_health_records_type_active ON health_records(record_type, is_active);
CREATE INDEX IF NOT EXISTS idx_health_records_uploader_date ON health_records(uploaded_by, created_at);

-- Infant growth indexes
CREATE INDEX IF NOT EXISTS idx_infant_growth_infant_id ON infant_growth(infant_id);
CREATE INDEX IF NOT EXISTS idx_infant_growth_date ON infant_growth(measurement_date);
CREATE INDEX IF NOT EXISTS idx_infant_growth_age ON infant_growth(age_in_days);
CREATE INDEX IF NOT EXISTS idx_infant_growth_active ON infant_growth(is_active);
CREATE INDEX IF NOT EXISTS idx_infant_growth_measured_by ON infant_growth(measured_by);
CREATE INDEX IF NOT EXISTS idx_infant_growth_follow_up ON infant_growth(follow_up_required);
CREATE INDEX IF NOT EXISTS idx_infant_growth_infant_date ON infant_growth(infant_id, measurement_date);
CREATE INDEX IF NOT EXISTS idx_infant_growth_infant_active ON infant_growth(infant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_infant_growth_date_active ON infant_growth(measurement_date, is_active);
CREATE INDEX IF NOT EXISTS idx_infant_growth_age_active ON infant_growth(age_in_days, is_active);

-- Item batches indexes
CREATE INDEX IF NOT EXISTS idx_item_batches_item_id ON item_batches(item_id);
CREATE INDEX IF NOT EXISTS idx_item_batches_expiry_date ON item_batches(expiry_date);
CREATE INDEX IF NOT EXISTS idx_item_batches_status ON item_batches(status);

-- Medicine batches indexes
CREATE INDEX IF NOT EXISTS idx_medicine_batches_medicine_id ON medicine_batches(medicine_id);
CREATE INDEX IF NOT EXISTS idx_medicine_batches_expiry_date ON medicine_batches(expiry_date);
CREATE INDEX IF NOT EXISTS idx_medicine_batches_clinic_id ON medicine_batches(clinic_id);

-- Suppliers indexes
CREATE INDEX IF NOT EXISTS idx_suppliers_name ON suppliers(name);
CREATE INDEX IF NOT EXISTS idx_suppliers_code ON suppliers(supplier_code);
CREATE INDEX IF NOT EXISTS idx_suppliers_type ON suppliers(supplier_type);
CREATE INDEX IF NOT EXISTS idx_suppliers_active ON suppliers(is_active);
CREATE INDEX IF NOT EXISTS idx_suppliers_preferred ON suppliers(is_preferred);
CREATE INDEX IF NOT EXISTS idx_suppliers_city ON suppliers(city);
CREATE INDEX IF NOT EXISTS idx_suppliers_country ON suppliers(country);
CREATE INDEX IF NOT EXISTS idx_suppliers_quality_rating ON suppliers(quality_rating);
CREATE INDEX IF NOT EXISTS idx_suppliers_last_order ON suppliers(last_order_date);
CREATE INDEX IF NOT EXISTS idx_suppliers_contract_end ON suppliers(contract_end_date);
CREATE INDEX IF NOT EXISTS idx_suppliers_type_active ON suppliers(supplier_type, is_active);
CREATE INDEX IF NOT EXISTS idx_suppliers_preferred_active ON suppliers(is_preferred, is_active);

-- Permissions indexes
CREATE INDEX IF NOT EXISTS idx_permissions_resource_action_scope ON permissions(resource, action, scope);
CREATE INDEX IF NOT EXISTS idx_permissions_resource ON permissions(resource);
CREATE INDEX IF NOT EXISTS idx_permissions_is_active ON permissions(is_active);

-- Role permissions indexes
CREATE INDEX IF NOT EXISTS idx_role_permissions_role_permission ON role_permissions(role_id, permission_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_role_id ON role_permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_permission_id ON role_permissions(permission_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_granted_by ON role_permissions(granted_by);

-- Notifications indexes
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(notification_type);
CREATE INDEX IF NOT EXISTS idx_notifications_target ON notifications(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_notifications_channel ON notifications(channel);
CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status);
CREATE INDEX IF NOT EXISTS idx_notifications_priority ON notifications(priority);
CREATE INDEX IF NOT EXISTS idx_notifications_scheduled ON notifications(scheduled_for);
CREATE INDEX IF NOT EXISTS idx_notifications_sent ON notifications(sent_at);
CREATE INDEX IF NOT EXISTS idx_notifications_related ON notifications(related_entity_type, related_entity_id);
CREATE INDEX IF NOT EXISTS idx_notifications_email ON notifications(recipient_email);
CREATE INDEX IF NOT EXISTS idx_notifications_phone ON notifications(recipient_phone);
CREATE INDEX IF NOT EXISTS idx_notifications_status_scheduled ON notifications(status, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_notifications_type_status ON notifications(notification_type, status);

-- Notification preferences indexes
CREATE INDEX IF NOT EXISTS idx_notification_preferences_user_id ON notification_preferences(user_id);
CREATE INDEX IF NOT EXISTS idx_notification_preferences_type ON notification_preferences(notification_type);
CREATE INDEX IF NOT EXISTS idx_notification_preferences_channel ON notification_preferences(channel);
CREATE INDEX IF NOT EXISTS idx_notification_preferences_user_type ON notification_preferences(user_id, notification_type);

-- Reports indexes
CREATE INDEX IF NOT EXISTS idx_reports_type ON reports(type);
CREATE INDEX IF NOT EXISTS idx_reports_generated_by ON reports(generated_by);
CREATE INDEX IF NOT EXISTS idx_reports_date_generated ON reports(date_generated);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_expires_at ON reports(expires_at);

-- User sessions indexes
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_user_sessions_active ON user_sessions(is_active);
CREATE INDEX IF NOT EXISTS idx_user_sessions_login_time ON user_sessions(login_time);
CREATE INDEX IF NOT EXISTS idx_user_sessions_last_activity ON user_sessions(last_activity);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_active ON user_sessions(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_user_sessions_login_method ON user_sessions(login_method);
CREATE INDEX IF NOT EXISTS idx_user_sessions_impersonated_by ON user_sessions(impersonated_by);

-- Cache entries indexes
CREATE INDEX IF NOT EXISTS idx_cache_entries_expires_at ON cache_entries(expires_at);
CREATE INDEX IF NOT EXISTS idx_cache_entries_key ON cache_entries(key);

-- Digital papers indexes
CREATE INDEX IF NOT EXISTS idx_paper_templates_type ON paper_templates(template_type);
CREATE INDEX IF NOT EXISTS idx_paper_templates_active ON paper_templates(is_active);
CREATE INDEX IF NOT EXISTS idx_document_downloads_user ON document_downloads(user_id);
CREATE INDEX IF NOT EXISTS idx_document_downloads_infant ON document_downloads(infant_id);
CREATE INDEX IF NOT EXISTS idx_document_downloads_template ON document_downloads(template_id);
CREATE INDEX IF NOT EXISTS idx_document_downloads_date ON document_downloads(download_date);
CREATE INDEX IF NOT EXISTS idx_completion_status_infant ON paper_completion_status(infant_id);
CREATE INDEX IF NOT EXISTS idx_completion_status_template ON paper_completion_status(template_id);
CREATE INDEX IF NOT EXISTS idx_completion_status_status ON paper_completion_status(completion_status);

-- Vaccine inventory indexes
CREATE INDEX IF NOT EXISTS idx_vaccine_inventory_vaccine_id ON vaccine_inventory(vaccine_id);
CREATE INDEX IF NOT EXISTS idx_vaccine_inventory_clinic_id ON vaccine_inventory(clinic_id);
CREATE INDEX IF NOT EXISTS idx_vaccine_inventory_period ON vaccine_inventory(period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_vaccine_inventory_low_stock ON vaccine_inventory(is_low_stock);
CREATE INDEX IF NOT EXISTS idx_vaccine_inventory_critical_stock ON vaccine_inventory(is_critical_stock);

-- Vaccine inventory transactions indexes
CREATE INDEX IF NOT EXISTS idx_vaccine_inventory_transactions_inventory_id ON vaccine_inventory_transactions(vaccine_inventory_id);
CREATE INDEX IF NOT EXISTS idx_vaccine_inventory_transactions_vaccine_id ON vaccine_inventory_transactions(vaccine_id);
CREATE INDEX IF NOT EXISTS idx_vaccine_inventory_transactions_type ON vaccine_inventory_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_vaccine_inventory_transactions_date ON vaccine_inventory_transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_vaccine_inventory_transactions_performed_by ON vaccine_inventory_transactions(performed_by);

-- Vaccine stock alerts indexes
CREATE INDEX IF NOT EXISTS idx_vaccine_stock_alerts_inventory_id ON vaccine_stock_alerts(vaccine_inventory_id);
CREATE INDEX IF NOT EXISTS idx_vaccine_stock_alerts_vaccine_id ON vaccine_stock_alerts(vaccine_id);
CREATE INDEX IF NOT EXISTS idx_vaccine_stock_alerts_clinic_id ON vaccine_stock_alerts(clinic_id);
CREATE INDEX IF NOT EXISTS idx_vaccine_stock_alerts_status ON vaccine_stock_alerts(status);
CREATE INDEX IF NOT EXISTS idx_vaccine_stock_alerts_type ON vaccine_stock_alerts(alert_type);
CREATE INDEX IF NOT EXISTS idx_vaccine_stock_alerts_priority ON vaccine_stock_alerts(priority);

-- ===========================================
-- TRIGGERS FOR AUTOMATIC UPDATES
-- ===========================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply trigger to all tables with updated_at column
CREATE TRIGGER update_roles_updated_at
    BEFORE UPDATE ON roles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_clinics_updated_at
    BEFORE UPDATE ON clinics
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_guardians_updated_at
    BEFORE UPDATE ON guardians
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_infants_updated_at
    BEFORE UPDATE ON infants
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_vaccines_updated_at
    BEFORE UPDATE ON vaccines
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_vaccine_batches_updated_at
    BEFORE UPDATE ON vaccine_batches
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_vaccination_records_updated_at
    BEFORE UPDATE ON vaccination_records
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_vaccination_schedules_updated_at
    BEFORE UPDATE ON vaccination_schedules
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_appointments_updated_at
    BEFORE UPDATE ON appointments
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_health_records_updated_at
    BEFORE UPDATE ON health_records
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_infant_growth_updated_at
    BEFORE UPDATE ON infant_growth
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_items_updated_at
    BEFORE UPDATE ON items
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_item_batches_updated_at
    BEFORE UPDATE ON item_batches
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_medicines_updated_at
    BEFORE UPDATE ON medicines
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_medicine_batches_updated_at
    BEFORE UPDATE ON medicine_batches
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_suppliers_updated_at
    BEFORE UPDATE ON suppliers
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_permissions_updated_at
    BEFORE UPDATE ON permissions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_notifications_updated_at
    BEFORE UPDATE ON notifications
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_notification_preferences_updated_at
    BEFORE UPDATE ON notification_preferences
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_reports_updated_at
    BEFORE UPDATE ON reports
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_announcements_updated_at
    BEFORE UPDATE ON announcements
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_sessions_updated_at
    BEFORE UPDATE ON user_sessions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_system_config_updated_at
    BEFORE UPDATE ON system_config
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_adoption_documents_updated_at
    BEFORE UPDATE ON adoption_documents
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_feedback_updated_at
    BEFORE UPDATE ON feedback
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_paper_templates_updated_at
    BEFORE UPDATE ON paper_templates
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_document_downloads_updated_at
    BEFORE UPDATE ON document_downloads
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_paper_completion_status_updated_at
    BEFORE UPDATE ON paper_completion_status
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_document_access_permissions_updated_at
    BEFORE UPDATE ON document_access_permissions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_document_templates_library_updated_at
    BEFORE UPDATE ON document_templates_library
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_document_generation_logs_updated_at
    BEFORE UPDATE ON document_generation_logs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_vaccine_inventory_updated_at
    BEFORE UPDATE ON vaccine_inventory
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_vaccine_inventory_transactions_updated_at
    BEFORE UPDATE ON vaccine_inventory_transactions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_vaccine_stock_alerts_updated_at
    BEFORE UPDATE ON vaccine_stock_alerts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ===========================================
-- STORED PROCEDURES AND FUNCTIONS
-- ===========================================

-- Function to calculate vaccine inventory stock status
CREATE OR REPLACE FUNCTION update_vaccine_inventory_status()
RETURNS TRIGGER AS $$
BEGIN
    -- Update stock status based on thresholds
    UPDATE vaccine_inventory
    SET
        is_low_stock = (stock_on_hand <= low_stock_threshold),
        is_critical_stock = (stock_on_hand <= critical_stock_threshold),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.vaccine_inventory_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update stock status
CREATE TRIGGER trigger_update_vaccine_inventory_status
    AFTER INSERT OR UPDATE ON vaccine_inventory_transactions
    FOR EACH ROW
    EXECUTE FUNCTION update_vaccine_inventory_status();

-- Function to create stock alerts
CREATE OR REPLACE FUNCTION create_stock_alerts()
RETURNS TRIGGER AS $$
BEGIN
    -- Create alert if stock is below threshold
    IF NEW.is_critical_stock OR NEW.is_low_stock THEN
        INSERT INTO vaccine_stock_alerts (
            vaccine_inventory_id, vaccine_id, clinic_id,
            alert_type, current_stock, threshold_value, message, priority
        ) VALUES (
            NEW.id, NEW.vaccine_id, NEW.clinic_id,
            CASE
                WHEN NEW.is_critical_stock THEN 'CRITICAL_STOCK'
                WHEN NEW.is_low_stock THEN 'LOW_STOCK'
                ELSE 'EXPIRY_WARNING'
            END,
            NEW.stock_on_hand,
            CASE
                WHEN NEW.is_critical_stock THEN NEW.critical_stock_threshold
                WHEN NEW.is_low_stock THEN NEW.low_stock_threshold
                ELSE 0
            END,
            CASE
                WHEN NEW.is_critical_stock THEN 'Critical: ' || NEW.stock_on_hand || ' units remaining'
                WHEN NEW.is_low_stock THEN 'Low stock: ' || NEW.stock_on_hand || ' units remaining'
                ELSE 'Expiry warning'
            END,
            CASE
                WHEN NEW.is_critical_stock THEN 'URGENT'
                WHEN NEW.is_low_stock THEN 'HIGH'
                ELSE 'MEDIUM'
            END
        )
        ON CONFLICT DO NOTHING;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to create stock alerts
CREATE TRIGGER trigger_create_stock_alerts
    AFTER UPDATE ON vaccine_inventory
    FOR EACH ROW
    EXECUTE FUNCTION create_stock_alerts();

-- Function to calculate infant growth percentiles
CREATE OR REPLACE FUNCTION calculate_growth_percentiles(
    p_weight_kg DECIMAL,
    p_length_cm DECIMAL,
    p_head_circumference_cm DECIMAL,
    p_age_months INTEGER,
    p_sex infant_sex
) RETURNS JSONB AS $$
DECLARE
    result JSONB;
BEGIN
    -- This is a simplified calculation
    -- In production, this would use WHO growth charts
    result := jsonb_build_object(
        'weight_percentile', CASE
            WHEN p_weight_kg < 5 THEN 10
            WHEN p_weight_kg < 7 THEN 25
            WHEN p_weight_kg < 9 THEN 50
            WHEN p_weight_kg < 11 THEN 75
            ELSE 90
        END,
        'length_percentile', CASE
            WHEN p_length_cm < 60 THEN 10
            WHEN p_length_cm < 65 THEN 25
            WHEN p_length_cm < 70 THEN 50
            WHEN p_length_cm < 75 THEN 75
            ELSE 90
        END,
        'head_circumference_percentile', CASE
            WHEN p_head_circumference_cm < 40 THEN 10
            WHEN p_head_circumference_cm < 43 THEN 25
            WHEN p_head_circumference_cm < 45 THEN 50
            WHEN p_head_circumference_cm < 47 THEN 75
            ELSE 90
        END
    );

    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Function to generate vaccination schedule
CREATE OR REPLACE FUNCTION generate_vaccination_schedule(p_infant_id INTEGER)
RETURNS TABLE(
    schedule_id INTEGER,
    vaccine_name VARCHAR,
    dose_number INTEGER,
    recommended_age_months INTEGER,
    status VARCHAR
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        vs.id,
        vs.vaccine_name,
        vs.dose_number,
        vs.target_age_months,
        CASE
            WHEN vr.id IS NOT NULL THEN 'COMPLETED'
            WHEN vs.target_age_months <= (SELECT EXTRACT(MONTH FROM AGE(CURRENT_DATE, i.dob)) FROM infants i WHERE i.id = p_infant_id) THEN 'DUE'
            ELSE 'PENDING'
        END as status
    FROM vaccination_schedules vs
    LEFT JOIN vaccination_records vr ON vs.vaccine_name = (SELECT name FROM vaccines WHERE id = vr.vaccine_id)
        AND vs.dose_number = vr.dose_no
        AND vr.infant_id = p_infant_id
    WHERE vs.is_active = true
    ORDER BY vs.target_age_months, vs.dose_number;
END;
$$ LANGUAGE plpgsql;

-- ===========================================
-- INITIAL DATA SEEDING
-- ===========================================

-- Insert basic roles
INSERT INTO roles (name, display_name, is_system_role, hierarchy_level, permissions) VALUES
('super_admin', 'Super Administrator', true, 100, '{"can_manage_system": true, "can_access_all_data": true}'),
('admin', 'Administrator', true, 80, '{"can_manage_users": true, "can_manage_clinics": true}'),
('clinic_manager', 'Clinic Manager', false, 60, '{"can_manage_clinic": true, "can_view_reports": true}'),
('guardian', 'Guardian', false, 20, '{"can_view_own_children": true, "can_view_appointments": true}'),
('physician', 'Physician', false, 50, '{"can_administer_vaccines": true, "can_prescribe_medication": true}'),
('nurse', 'Nurse', false, 35, '{"can_administer_vaccines": true, "can_record_vitals": true}'),
('midwife', 'Midwife', false, 30, '{"can_assist_deliveries": true, "can_record_births": true}')
ON CONFLICT (name) DO NOTHING;

-- Insert basic permissions
INSERT INTO permissions (name, resource, action, scope, description) VALUES
('users.create', 'users', 'create', 'global', 'Create new users'),
('users.read', 'users', 'read', 'global', 'View users'),
('users.update', 'users', 'update', 'global', 'Update user information'),
('users.delete', 'users', 'delete', 'global', 'Delete users'),
('infants.create', 'infants', 'create', 'clinic', 'Create infant records'),
('infants.read', 'infants', 'read', 'clinic', 'View infant records'),
('infants.update', 'infants', 'update', 'clinic', 'Update infant information'),
('infants.delete', 'infants', 'delete', 'clinic', 'Delete infant records'),
('vaccinations.create', 'vaccinations', 'create', 'clinic', 'Administer vaccinations'),
('vaccinations.read', 'vaccinations', 'read', 'clinic', 'View vaccination records'),
('vaccinations.update', 'vaccinations', 'update', 'clinic', 'Update vaccination records'),
('reports.generate', 'reports', 'create', 'clinic', 'Generate reports'),
('reports.read', 'reports', 'read', 'clinic', 'View reports'),
('inventory.manage', 'inventory', 'create', 'clinic', 'Manage inventory'),
('inventory.read', 'inventory', 'read', 'clinic', 'View inventory'),
('documents.generate', 'documents', 'create', 'clinic', 'Generate documents'),
('documents.read', 'documents', 'read', 'clinic', 'View documents')
ON CONFLICT (name) DO NOTHING;

-- Insert the specific vaccines for healthcare center
INSERT INTO vaccines (code, name, manufacturer, doses_required) VALUES
('BCG', 'BCG', 'Various', 1),
('BCG-DIL', 'BCG, Diluent', 'Various', 1),
('HEP-B', 'Hepa B', 'Various', 3),
('PENTA', 'Penta Valent', 'Various', 3),
('OPV-20', 'OPV 20-doses', 'Various', 4),
('PCV-13-10', 'PCV 13 / PCV 10', 'Various', 3),
('MR', 'Measles & Rubella (MR)', 'Various', 2),
('MMR', 'MMR', 'Various', 2),
('IPV-MULTI', 'IPV multi dose', 'Various', 4)
ON CONFLICT (code) DO NOTHING;

-- Insert default clinic
INSERT INTO clinics (name, region, address, contact)
VALUES ('Main Health Center', 'Region 1', 'Main Health Center Address', 'Contact Number')
ON CONFLICT (name) DO NOTHING;

-- Create default admin user
INSERT INTO users (username, password_hash, role_id, clinic_id, contact, last_login)
SELECT
    'admin',
    '$2b$10$rOz8QK.hVv7YJHQv5tKQ9uJjRrQw5b9wN6mH8pC2xY7zA1kL3mN9q', -- password: Admin2024!
    r.id,
    c.id,
    'admin@immunicare.com',
    NULL
FROM roles r, clinics c
WHERE r.name = 'super_admin' AND c.name = 'Main Health Center'
ON CONFLICT (username) DO NOTHING;

-- Grant permissions to roles
INSERT INTO role_permissions (role_id, permission_id, granted_by)
SELECT r.id, p.id,
    (SELECT u.id FROM users u WHERE u.username = 'admin' LIMIT 1)
FROM roles r, permissions p
WHERE r.name = 'super_admin'
AND p.name IN (
    'users.create', 'users.read', 'users.update', 'users.delete',
    'infants.create', 'infants.read', 'infants.update', 'infants.delete',
    'vaccinations.create', 'vaccinations.read', 'vaccinations.update',
    'reports.generate', 'reports.read', 'inventory.manage', 'inventory.read',
    'documents.generate', 'documents.read'
)
ON CONFLICT DO NOTHING;

-- Insert sample paper templates
INSERT INTO paper_templates (name, description, template_type, fields, validation_rules, created_by) VALUES
('Vaccine Schedule Booklet', 'WHO-standard vaccination schedule for infants', 'VACCINE_SCHEDULE',
'[{"field": "infant_name", "label": "Child Name", "source": "infants.full_name", "required": true}, {"field": "dob", "label": "Date of Birth", "source": "infants.dob", "required": true}, {"field": "vaccines", "label": "Vaccination Schedule", "source": "vaccination_schedules", "required": true}]',
'{"required_fields": ["infant_name", "dob", "vaccines"]}',
(SELECT id FROM users WHERE username = 'admin')),
('Immunization Record Booklet', 'Complete immunization record for tracking vaccinations', 'IMMUNIZATION_RECORD',
'[{"field": "infant_info", "label": "Infant Information", "source": "infants", "required": true}, {"field": "vaccination_history", "label": "Vaccination History", "source": "vaccination_records", "required": true}, {"field": "guardian_info", "label": "Guardian Information", "source": "guardians", "required": true}]',
'{"required_fields": ["infant_info", "vaccination_history", "guardian_info"]}',
(SELECT id FROM users WHERE username = 'admin')),
('Vaccine Inventory Logbook', 'Stock monitoring logbook for vaccines', 'INVENTORY_LOGBOOK',
'[{"field": "inventory_data", "label": "Inventory Data", "source": "inventory_items", "required": true}, {"field": "transactions", "label": "Stock Transactions", "source": "inventory_transactions", "required": true}, {"field": "alerts", "label": "Stock Alerts", "source": "stock_alerts", "required": false}]',
'{"required_fields": ["inventory_data", "transactions"]}',
(SELECT id FROM users WHERE username = 'admin')),
('Growth Chart', 'Infant growth monitoring chart', 'GROWTH_CHART',
'[{"field": "growth_records", "label": "Growth Records", "source": "growth_records", "required": true}, {"field": "percentiles", "label": "Growth Percentiles", "source": "calculated_percentiles", "required": true}, {"field": "alerts", "label": "Growth Alerts", "source": "growth_alerts", "required": false}]',
'{"required_fields": ["growth_records", "percentiles"]}',
(SELECT id FROM users WHERE username = 'admin'))
ON CONFLICT DO NOTHING;

-- ===========================================
-- SYSTEM CONFIGURATION
-- ===========================================

-- Insert system configuration
INSERT INTO system_config (config_key, config_value, description) VALUES
('system_version', '{"major": 1, "minor": 0, "patch": 0}', 'System version information'),
('working_hours', '{"start": "08:00", "end": "17:00", "days": ["monday", "tuesday", "wednesday", "thursday", "friday"]}', 'Standard working hours for health center'),
('max_file_size', '{"documents": 10485760, "images": 5242880}', 'Maximum file sizes in bytes'),
('notification_settings', '{"email_enabled": true, "sms_enabled": false, "push_enabled": true}', 'Notification system settings'),
('security_settings', '{"session_timeout": 1800, "max_login_attempts": 5, "password_expiry_days": 90}', 'Security configuration')
ON CONFLICT (config_key) DO NOTHING;
