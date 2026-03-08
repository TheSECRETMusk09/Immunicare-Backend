-- ===========================================
-- VACCINE DISTRIBUTION & ENHANCED INVENTORY MANAGEMENT
-- City → Barangay Distribution Flow
-- Barangay → City Feedback Loop
-- Excel-based Digitalization
-- ===========================================

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ===========================================
-- DISTRIBUTION TABLES (City → Barangay)
-- ===========================================

-- Vaccine Distribution Requests (Barangay requests to City)
CREATE TABLE vaccine_distribution_requests (
    id SERIAL PRIMARY KEY,
    request_number VARCHAR(50) UNIQUE NOT NULL,
    
    -- Requesting Barangay Health Center
    requesting_barangay_id INTEGER NOT NULL REFERENCES clinics(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    requesting_barangay_name VARCHAR(255) NOT NULL,
    
    -- Request Details
    vaccine_id INTEGER NOT NULL REFERENCES vaccines(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    requested_quantity INTEGER NOT NULL,
    urgency_level VARCHAR(20) NOT NULL DEFAULT 'normal', -- 'low', 'normal', 'high', 'urgent'
    reason_for_request TEXT,
    
    -- Request Status
    status VARCHAR(30) NOT NULL DEFAULT 'pending', -- 'pending', 'approved', 'rejected', 'partial', 'completed', 'cancelled'
    priority INTEGER NOT NULL DEFAULT 5,
    
    -- City Health Office Approval
    approved_by INTEGER REFERENCES users(id),
    approved_at TIMESTAMP,
    approval_notes TEXT,
    
    -- Requested By (BHC Staff)
    requested_by INTEGER NOT NULL REFERENCES users(id),
    
    -- Target Delivery Date
    target_delivery_date DATE,
    actual_delivery_date DATE,
    
    -- Tracking
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

-- Vaccine Distributions (City to Barangay transfers)
CREATE TABLE vaccine_distributions (
    id SERIAL PRIMARY KEY,
    distribution_number VARCHAR(50) UNIQUE NOT NULL,
    
    -- Source (City Health Office)
    source_clinic_id INTEGER NOT NULL REFERENCES clinics(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    source_clinic_name VARCHAR(255) NOT NULL,
    
    -- Destination (Barangay Health Center)
    destination_barangay_id INTEGER NOT NULL REFERENCES clinics(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    destination_barangay_name VARCHAR(255) NOT NULL,
    
    -- Distribution Details
    vaccine_id INTEGER NOT NULL REFERENCES vaccines(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    batch_number VARCHAR(255) NOT NULL,
    quantity_distributed INTEGER NOT NULL,
    expiry_date DATE NOT NULL,
    
    -- Storage Requirements During Transport
    storage_requirement VARCHAR(100), -- 'refrigerated', 'frozen', 'ultra-frozen'
    temperature_during_transport DECIMAL(5, 2),
    
    -- Distribution Status
    status VARCHAR(30) NOT NULL DEFAULT 'pending', -- 'pending', 'in_transit', 'delivered', 'received', 'verified'
    
    -- Dispatch Information
    dispatched_by INTEGER NOT NULL REFERENCES users(id),
    dispatched_at TIMESTAMP,
    vehicle_number VARCHAR(50),
    courier_name VARCHAR(255),
    
    -- Receipt Information
    received_by INTEGER REFERENCES users(id),
    received_at TIMESTAMP,
    received_condition VARCHAR(100), -- 'good', 'damaged', 'temperature_excursion'
    receipt_notes TEXT,
    
    -- Related Request
    distribution_request_id INTEGER REFERENCES vaccine_distribution_requests(id),
    
    -- Tracking
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

-- Cold Chain Monitoring During Transport
CREATE TABLE cold_chain_readings (
    id SERIAL PRIMARY KEY,
    distribution_id INTEGER NOT NULL REFERENCES vaccine_distributions(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    
    -- Reading Details
    reading_timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    temperature_reading DECIMAL(5, 2) NOT NULL, -- Temperature in Celsius
    humidity_reading DECIMAL(5, 2), -- Humidity percentage
    
    -- Sensor Information
    sensor_id VARCHAR(100),
    sensor_location VARCHAR(100), -- 'ambient', 'vaccine_compartment', 'external'
    
    -- Reading Status
    is_within_range BOOLEAN NOT NULL DEFAULT TRUE,
    min_threshold DECIMAL(5, 2),
    max_threshold DECIMAL(5, 2),
    
    -- Alert Information
    alert_triggered BOOLEAN NOT NULL DEFAULT FALSE,
    alert_type VARCHAR(50), -- 'low_temp', 'high_temp', 'excursion'
    alert_message TEXT,
    
    -- Recorded By
    recorded_by INTEGER REFERENCES users(id),
    
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ===========================================
-- BARANGAY → CITY FEEDBACK TABLES
-- ===========================================

-- BHC Periodic Reports (Weekly/Monthly)
CREATE TABLE bhc_periodic_reports (
    id SERIAL PRIMARY KEY,
    report_number VARCHAR(50) UNIQUE NOT NULL,
    
    -- Reporting BHC
    barangay_clinic_id INTEGER NOT NULL REFERENCES clinics(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    barangay_clinic_name VARCHAR(255) NOT NULL,
    
    -- Report Period
    report_type VARCHAR(20) NOT NULL, -- 'weekly', 'monthly', 'quarterly', 'special'
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    
    -- Vaccination Statistics
    total_infants_served INTEGER DEFAULT 0,
    total_vaccinations_administered INTEGER DEFAULT 0,
    bcg_administered INTEGER DEFAULT 0,
    hepb_administered INTEGER DEFAULT 0,
    pentavalent_administered INTEGER DEFAULT 0,
    opv_administered INTEGER DEFAULT 0,
    ipv_administered INTEGER DEFAULT 0,
    pcv_administered INTEGER DEFAULT 0,
    mr_administered INTEGER DEFAULT 0,
    mmr_administered INTEGER DEFAULT 0,
    other_vaccines_administered INTEGER DEFAULT 0,
    
    -- Dropout Analysis
    infants_started_series INTEGER DEFAULT 0,
    infants_completed_series INTEGER DEFAULT 0,
    dropout_rate DECIMAL(5, 2) DEFAULT 0,
    
    -- Defaulter Tracking
    defaulters_identified INTEGER DEFAULT 0,
    defaulters_traced INTEGER DEFAULT 0,
    defaulters_vaccinated INTEGER DEFAULT 0,
    
    -- Adverse Events
    aefi_reported INTEGER DEFAULT 0,
    aefi_serious INTEGER DEFAULT 0,
    aefi_investigated INTEGER DEFAULT 0,
    
    -- Coverage Rates
    bcg_coverage DECIMAL(5, 2) DEFAULT 0,
    penta3_coverage DECIMAL(5, 2) DEFAULT 0,
    mcv1_coverage DECIMAL(5, 2) DEFAULT 0,
    full_immunization_coverage DECIMAL(5, 2) DEFAULT 0,
    
    -- Cold Chain Status
    refrigerator_working BOOLEAN DEFAULT TRUE,
    refrigerator_temperature_avg DECIMAL(5, 2),
    temperature_excursions INTEGER DEFAULT 0,
    generator_working BOOLEAN DEFAULT TRUE,
    
    -- Challenges and Issues
    stockouts_occurred INTEGER DEFAULT 0,
    stockout_vaccines TEXT, -- JSON array of vaccine names
    power_outages INTEGER DEFAULT 0,
    equipment_issues TEXT,
    
    -- Technical Issues
    data_system_issues TEXT,
    internet_connectivity_days INTEGER DEFAULT 0,
    
    -- Comments and Recommendations
    challenges_encountered TEXT,
    recommendations TEXT,
    follow_up_actions TEXT,
    
    -- Report Status
    status VARCHAR(20) NOT NULL DEFAULT 'draft', -- 'draft', 'submitted', 'reviewed', 'approved'
    submitted_by INTEGER NOT NULL REFERENCES users(id),
    submitted_at TIMESTAMP,
    reviewed_by INTEGER REFERENCES users(id),
    reviewed_at TIMESTAMP,
    review_notes TEXT,
    
    -- City Health Office Feedback
    cho_feedback TEXT,
    cho_action_required TEXT,
    
    -- Attachments (JSON array of file paths)
    attachments JSONB DEFAULT '[]',
    
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

-- Daily Activity Log (BHC Daily Operations)
CREATE TABLE bhc_daily_activity_logs (
    id SERIAL PRIMARY KEY,
    
    -- BHC Identification
    barangay_clinic_id INTEGER NOT NULL REFERENCES clinics(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    
    -- Activity Date
    activity_date DATE NOT NULL DEFAULT CURRENT_DATE,
    
    -- Staff on Duty
    staff_on_duty JSONB NOT NULL DEFAULT '[]', -- Array of staff names and roles
    
    -- Patient Statistics
    total_patients_served INTEGER DEFAULT 0,
    new_patients INTEGER DEFAULT 0,
    returning_patients INTEGER DEFAULT 0,
    
    -- Vaccination Activity
    total_vaccinations INTEGER DEFAULT 0,
    vaccinations_by_vaccine JSONB DEFAULT '{}', -- { "BCG": 5, "HEPB": 3, ... }
    vaccinations_by_age_group JSONB DEFAULT '{}', -- { "0-11m": 10, "12-23m": 5, ... }
    
    -- Walk-in vs Scheduled
    walk_in_patients INTEGER DEFAULT 0,
    scheduled_patients INTEGER DEFAULT 0,
    no_shows INTEGER DEFAULT 0,
    
    -- Inventory Impact
    inventory_issued JSONB DEFAULT '[]', -- Array of {vaccine, quantity}
    inventory_received JSONB DEFAULT '[]', -- Array of {vaccine, quantity, source}
    waste_reporting JSONB DEFAULT '[]', -- Array of {vaccine, quantity, reason}
    
    -- Cold Chain Log
    morning_temperature DECIMAL(5, 2),
    afternoon_temperature DECIMAL(5, 2),
    temperature_compliant BOOLEAN DEFAULT TRUE,
    cold_chain_incidents TEXT,
    
    -- Equipment Status
    refrigerator_status VARCHAR(50) DEFAULT 'operational',
    generator_status VARCHAR(50) DEFAULT 'operational',
    other_equipment_issues TEXT,
    
    -- Incidents and Issues
    incidents_reported TEXT,
    complaints_received TEXT,
    
    -- Weather and External Factors
    weather_conditions VARCHAR(100),
    power_status VARCHAR(50), -- 'normal', 'interrupted', 'outage'
    internet_status VARCHAR(50), -- 'available', 'unavailable', 'intermittent'
    
    -- Notes
    operational_notes TEXT,
    supervisor_notes TEXT,
    
    -- Log Status
    submitted_by INTEGER NOT NULL REFERENCES users(id),
    submitted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    verified_by INTEGER REFERENCES users(id),
    verified_at TIMESTAMP,
    
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

-- ===========================================
-- ENHANCED VACCINE INVENTORY (Excel-aligned)
-- ===========================================

-- Enhanced Vaccine Inventory (matches Excel table structure)
CREATE TABLE vaccine_inventory_excel (
    id SERIAL PRIMARY KEY,
    clinic_id INTEGER NOT NULL REFERENCES clinics(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    vaccine_id INTEGER NOT NULL REFERENCES vaccines(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    
    -- Excel Column: VACCINE NAME
    vaccine_name VARCHAR(255) NOT NULL,
    
    -- Excel Column: BEGINNING BALANCE (VIALS PCS)
    beginning_balance INTEGER NOT NULL DEFAULT 0,
    
    -- Excel Column: RECEIVED DURING THE PERIOD (VIALS PCS)
    received_during_period INTEGER NOT NULL DEFAULT 0,
    received_date DATE,
    received_from VARCHAR(255), -- Source of received vaccines
    received_reference VARCHAR(100), -- Reference number (DO, invoice, etc.)
    
    -- Excel Column: LOT/BATCH NUMBER
    lot_batch_number VARCHAR(255),
    expiry_date DATE,
    
    -- Excel Column: TRANSFERRED IN/OUT
    transferred_in INTEGER NOT NULL DEFAULT 0,
    transferred_in_source VARCHAR(255),
    transferred_in_date DATE,
    transferred_out INTEGER NOT NULL DEFAULT 0,
    transferred_out_destination VARCHAR(255),
    transferred_out_date DATE,
    
    -- Excel Column: EXPIRED/WASTED
    expired_wasted INTEGER NOT NULL DEFAULT 0,
    expired_wasted_reason VARCHAR(100), -- 'expired', 'damaged', 'cold_chain_break', 'other'
    expired_wasted_date DATE,
    
    -- Excel Column: TOTAL AVAILABLE (VIALS PCS) (B+C)
    -- Calculated: beginning_balance + received_during_period + transferred_in
    
    -- Excel Column: ISSUANCE (VIALS PCS)
    issuance INTEGER NOT NULL DEFAULT 0,
    issuance_date DATE,
    issuance_recipient VARCHAR(255), -- Patient name or service rendered
    issuance_purpose VARCHAR(100), -- 'vaccination', 'transfer', 'replacement'
    
    -- Excel Column: STOCK ON HAND (VIALS PCS) (I+J)
    -- Calculated: Total Available - Expired/Wasted - Issuance - Transferred Out
    
    -- Stock Status (Computed)
    current_stock INTEGER GENERATED ALWAYS AS (
        beginning_balance + received_during_period + transferred_in - transferred_out - expired_wasted - issuance
    ) STORED,
    
    -- Stock Level Alerts
    low_stock_threshold INTEGER NOT NULL DEFAULT 10,
    critical_stock_threshold INTEGER NOT NULL DEFAULT 5,
    is_low_stock BOOLEAN GENERATED ALWAYS AS (current_stock <= low_stock_threshold AND current_stock > critical_stock_threshold) STORED,
    is_critical_stock BOOLEAN GENERATED ALWAYS AS (current_stock <= critical_stock_threshold) STORED,
    
    -- Period Tracking
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    
    -- Storage Information
    storage_location VARCHAR(100), -- 'main_refrigerator', 'freezer', 'cold_box_slot_a', etc.
    temperature_storage DECIMAL(5, 2), -- Required storage temperature
    current_temperature DECIMAL(5, 2), -- Current storage temperature
    
    -- Supplier Information
    supplier_name VARCHAR(255),
    supplier_contact VARCHAR(255),
    purchase_order_number VARCHAR(100),
    unit_cost DECIMAL(10, 2),
    
    -- Documentation
    delivery_receipt_number VARCHAR(100),
    inspection_status VARCHAR(50), -- 'pending', 'passed', 'failed'
    inspection_date DATE,
    inspection_notes TEXT,
    
    -- Timestamps and User Tracking
    created_by INTEGER NOT NULL REFERENCES users(id),
    updated_by INTEGER REFERENCES users(id),
    
    -- Status
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Vaccine Inventory Transaction Log (for audit trail)
CREATE TABLE vaccine_inventory_transactions_excel (
    id SERIAL PRIMARY KEY,
    inventory_id INTEGER NOT NULL REFERENCES vaccine_inventory_excel(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    
    -- Transaction Identification
    transaction_number VARCHAR(50) UNIQUE NOT NULL,
    transaction_type VARCHAR(30) NOT NULL, -- 'receive', 'transfer_in', 'transfer_out', 'issue', 'expire', 'waste', 'adjust', 'return'
    
    -- Transaction Details
    vaccine_id INTEGER NOT NULL REFERENCES vaccines(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    clinic_id INTEGER NOT NULL REFERENCES clinics(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    
    -- Quantity Changes
    quantity_change INTEGER NOT NULL, -- Positive for additions, negative for deductions
    quantity_before INTEGER NOT NULL,
    quantity_after INTEGER NOT NULL,
    
    -- Batch Information
    lot_number VARCHAR(255),
    expiry_date DATE,
    
    -- Reference Information
    reference_type VARCHAR(50), -- 'distribution', 'request', 'vaccination_record', 'adjustment'
    reference_id INTEGER, -- ID of related record
    reference_number VARCHAR(100), -- DR, PO, PR number, etc.
    
    -- Source/Destination
    source_type VARCHAR(50), -- 'supplier', 'city_cho', 'other_bhc', 'internal'
    source_name VARCHAR(255),
    source_id INTEGER,
    destination_type VARCHAR(50), -- 'patient', 'other_bhc', 'city_cho', 'wastage'
    destination_name VARCHAR(255),
    destination_id INTEGER,
    
    -- Reason and Notes
    transaction_reason VARCHAR(255),
    notes TEXT,
    
    -- Authorization
    requested_by INTEGER REFERENCES users(id),
    approved_by INTEGER REFERENCES users(id),
    approval_status VARCHAR(20) DEFAULT 'approved', -- 'pending', 'approved', 'rejected'
    approval_date TIMESTAMP,
    approval_notes TEXT,
    
    -- Compliance
    cold_chain_maintained BOOLEAN DEFAULT TRUE,
    temperature_reading DECIMAL(5, 2),
    documentation_complete BOOLEAN DEFAULT TRUE,
    
    -- User Tracking
    performed_by INTEGER NOT NULL REFERENCES users(id),
    performed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

-- ===========================================
-- INFANT VACCINATION SCHEDULE TRACKING
-- ===========================================

-- Infant Vaccination Schedule Template
CREATE TABLE infant_vaccination_schedule_templates (
    id SERIAL PRIMARY KEY,
    vaccine_name VARCHAR(255) NOT NULL,
    vaccine_code VARCHAR(50),
    disease_prevented VARCHAR(255) NOT NULL,
    
    -- Schedule Information
    dose_number INTEGER NOT NULL,
    total_doses INTEGER NOT NULL,
    target_age_weeks INTEGER,
    target_age_months INTEGER NOT NULL,
    min_age_weeks INTEGER,
    max_age_weeks INTEGER,
    
    -- Administration Details
    route_of_administration VARCHAR(50) NOT NULL, -- 'IM', 'SC', 'Oral', 'ID'
    administration_site VARCHAR(100), -- 'Left deltoid', 'Right thigh', etc.
    dosage DECIMAL(6, 2), -- in mL or units
    diluent_required BOOLEAN DEFAULT FALSE,
    diluent_volume DECIMAL(6, 2),
    
    -- Storage Requirements
    storage_temperature_min DECIMAL(5, 2), -- Minimum storage temp
    storage_temperature_max DECIMAL(5, 2), -- Maximum storage temp
    
    -- Scheduling Rules
    minimum_interval_weeks INTEGER, -- Interval between doses
    grace_period_weeks INTEGER DEFAULT 4,
    can_co_administer BOOLEAN DEFAULT TRUE, -- Can be given with other vaccines
    co_administration_rules TEXT,
    
    -- Precautions and Contraindications
    contraindications TEXT,
    precautions TEXT,
    common_side_effects TEXT,
    
    -- Catch-up Schedule
    catch_up_guidance TEXT,
    
    -- Status
    is_mandatory BOOLEAN DEFAULT TRUE,
    is_routine BOOLEAN DEFAULT TRUE,
    priority_level VARCHAR(20) DEFAULT 'medium', -- 'low', 'medium', 'high'
    
    -- Documentation
    reference_guidelines TEXT, -- DOH, WHO guidelines reference
    effective_date DATE NOT NULL,
    expiry_date DATE,
    
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Individual Infant Vaccination Schedule
CREATE TABLE infant_vaccination_schedules (
    id SERIAL PRIMARY KEY,
    infant_id INTEGER NOT NULL REFERENCES infants(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    schedule_template_id INTEGER NOT NULL REFERENCES infant_vaccination_schedule_templates(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    
    -- Schedule Details
    dose_number INTEGER NOT NULL,
    scheduled_date DATE NOT NULL,
    scheduled_age_months INTEGER NOT NULL,
    
    -- Status Tracking
    status VARCHAR(30) NOT NULL DEFAULT 'scheduled', -- 'scheduled', 'due', 'overdue', 'administered', 'deferred', 'contraindicated', 'refused'
    
    -- Administration Details (filled when administered)
    administered_date DATE,
    administered_age_months INTEGER,
    batch_number VARCHAR(255),
    lot_number VARCHAR(255),
    expiry_date DATE,
    administered_by INTEGER REFERENCES users(id),
    administration_site VARCHAR(100),
    site_reaction VARCHAR(255),
    
    -- Vaccination Record Link
    vaccination_record_id INTEGER REFERENCES vaccination_records(id),
    
    -- Follow-up
    next_dose_id INTEGER REFERENCES infant_vaccination_schedules(id),
    next_scheduled_date DATE,
    
    -- Notes
    notes TEXT,
    parent_guardian_notified BOOLEAN DEFAULT FALSE,
    parent_guardian_notified_at TIMESTAMP,
    
    -- Tracking
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

-- Schedule Reminders and Notifications
CREATE TABLE schedule_reminders (
    id SERIAL PRIMARY KEY,
    schedule_id INTEGER NOT NULL REFERENCES infant_vaccination_schedules(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    infant_id INTEGER NOT NULL REFERENCES infants(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    
    -- Reminder Configuration
    reminder_type VARCHAR(30) NOT NULL, -- 'appointment', 'due_date', 'overdue', 'follow_up'
    reminder_date DATE NOT NULL,
    days_before_due INTEGER DEFAULT 7, -- Days before scheduled date
    
    -- Notification Details
    notification_channel VARCHAR(20) NOT NULL, -- 'sms', 'email', 'push', 'phone'
    notification_sent BOOLEAN DEFAULT FALSE,
    notification_sent_at TIMESTAMP,
    notification_confirmed BOOLEAN DEFAULT FALSE,
    notification_confirmed_at TIMESTAMP,
    
    -- Message
    message_subject VARCHAR(255),
    message_body TEXT,
    
    -- Response
    guardian_response VARCHAR(50), -- 'confirmed', 'rescheduled', 'cancelled', 'no_response'
    response_date DATE,
    preferred_new_date DATE,
    response_notes TEXT,
    
    -- Tracking
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

-- ===========================================
-- INDEXES FOR PERFORMANCE
-- ===========================================

-- Distribution Request Indexes
CREATE INDEX idx_dist_requests_barangay ON vaccine_distribution_requests(requesting_barangay_id);
CREATE INDEX idx_dist_requests_status ON vaccine_distribution_requests(status);
CREATE INDEX idx_dist_requests_date ON vaccine_distribution_requests(created_at);
CREATE INDEX idx_dist_requests_priority ON vaccine_distribution_requests(priority);

-- Distribution Indexes
CREATE INDEX idx_distributions_source ON vaccine_distributions(source_clinic_id);
CREATE INDEX idx_distributions_destination ON vaccine_distributions(destination_barangay_id);
CREATE INDEX idx_distributions_status ON vaccine_distributions(status);
CREATE INDEX idx_distributions_vaccine ON vaccine_distributions(vaccine_id);

-- Cold Chain Indexes
CREATE INDEX idx_cold_chain_distribution ON cold_chain_readings(distribution_id);
CREATE INDEX idx_cold_chain_timestamp ON cold_chain_readings(reading_timestamp);

-- BHC Reports Indexes
CREATE INDEX idx_bhc_reports_barangay ON bhc_periodic_reports(barangay_clinic_id);
CREATE INDEX idx_bhc_reports_period ON bhc_periodic_reports(period_start, period_end);
CREATE INDEX idx_bhc_reports_status ON bhc_periodic_reports(status);
CREATE INDEX idx_bhc_reports_type ON bhc_periodic_reports(report_type);

-- Daily Activity Indexes
CREATE INDEX idx_bhc_daily_barangay ON bhc_daily_activity_logs(barangay_clinic_id);
CREATE INDEX idx_bhc_daily_date ON bhc_daily_activity_logs(activity_date);

-- Excel Inventory Indexes
CREATE INDEX idx_inv_excel_clinic ON vaccine_inventory_excel(clinic_id);
CREATE INDEX idx_inv_excel_vaccine ON vaccine_inventory_excel(vaccine_id);
CREATE INDEX idx_inv_excel_period ON vaccine_inventory_excel(period_start, period_end);
CREATE INDEX idx_inv_excel_low_stock ON vaccine_inventory_excel(is_low_stock);
CREATE INDEX idx_inv_excel_critical ON vaccine_inventory_excel(is_critical_stock);

-- Transaction Indexes
CREATE INDEX idx_inv_txn_inventory ON vaccine_inventory_transactions_excel(inventory_id);
CREATE INDEX idx_inv_txn_type ON vaccine_inventory_transactions_excel(transaction_type);
CREATE INDEX idx_inv_txn_date ON vaccine_inventory_transactions_excel(performed_at);
CREATE INDEX idx_inv_txn_clinic ON vaccine_inventory_transactions_excel(clinic_id);

-- Schedule Template Indexes
CREATE INDEX idx_sched_temp_vaccine ON infant_vaccination_schedule_templates(vaccine_name);
CREATE INDEX idx_sched_temp_age ON infant_vaccination_schedule_templates(target_age_months);
CREATE INDEX idx_sched_temp_active ON infant_vaccination_schedule_templates(is_active);

-- Infant Schedule Indexes
CREATE INDEX idx_infant_sched_infant ON infant_vaccination_schedules(infant_id);
CREATE INDEX idx_infant_sched_status ON infant_vaccination_schedules(status);
CREATE INDEX idx_infant_sched_date ON infant_vaccination_schedules(scheduled_date);

-- Reminder Indexes
CREATE INDEX idx_reminders_schedule ON schedule_reminders(schedule_id);
CREATE INDEX idx_reminders_date ON schedule_reminders(reminder_date);
CREATE INDEX idx_reminders_sent ON schedule_reminders(notification_sent);

-- ===========================================
-- TRIGGER FUNCTIONS
-- ===========================================

-- Function to generate request number
CREATE OR REPLACE FUNCTION generate_request_number()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.request_number IS NULL THEN
        NEW.request_number := 'REQ-' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD') || '-' || 
            LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to generate distribution number
CREATE OR REPLACE FUNCTION generate_distribution_number()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.distribution_number IS NULL THEN
        NEW.distribution_number := 'DIST-' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD') || '-' || 
            LPAD(Floor(RANDOM() * 10000)::TEXT, 4, '0');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to generate report number
CREATE OR REPLACE FUNCTION generate_report_number()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.report_number IS NULL THEN
        NEW.report_number := 'RPT-' || UPPER(NEW.report_type) || '-' || 
            TO_CHAR(CURRENT_DATE, 'YYYYMMDD') || '-' || 
            LPAD(Floor(RANDOM() * 1000)::TEXT, 3, '0');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to generate transaction number
CREATE OR REPLACE FUNCTION generate_txn_number()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.transaction_number IS NULL THEN
        NEW.transaction_number := 'TXN-' || UPPER(LEFT(NEW.transaction_type, 3)) || '-' || 
            TO_CHAR(CURRENT_TIMESTAMP, 'YYYYMMDDHH24MI') || '-' || 
            LPAD(Floor(RANDOM() * 10000)::TEXT, 4, '0');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply triggers
CREATE TRIGGER trigger_generate_request_number
    BEFORE INSERT ON vaccine_distribution_requests
    FOR EACH ROW
    EXECUTE FUNCTION generate_request_number();

CREATE TRIGGER trigger_generate_distribution_number
    BEFORE INSERT ON vaccine_distributions
    FOR EACH ROW
    EXECUTE FUNCTION generate_distribution_number();

CREATE TRIGGER trigger_generate_report_number
    BEFORE INSERT ON bhc_periodic_reports
    FOR EACH ROW
    EXECUTE FUNCTION generate_report_number();

CREATE TRIGGER trigger_generate_txn_number
    BEFORE INSERT ON vaccine_inventory_transactions_excel
    FOR EACH ROW
    EXECUTE FUNCTION generate_txn_number();

-- Function to update timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply update triggers
CREATE TRIGGER update_dist_requests_updated_at
    BEFORE UPDATE ON vaccine_distribution_requests
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_distributions_updated_at
    BEFORE UPDATE ON vaccine_distributions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_bhc_reports_updated_at
    BEFORE UPDATE ON bhc_periodic_reports
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_bhc_daily_updated_at
    BEFORE UPDATE ON bhc_daily_activity_logs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_inv_excel_updated_at
    BEFORE UPDATE ON vaccine_inventory_excel
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_infant_sched_updated_at
    BEFORE UPDATE ON infant_vaccination_schedules
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ===========================================
-- VIEWS FOR REPORTING
-- ===========================================

-- View: Distribution Summary by Vaccine
CREATE OR REPLACE VIEW view_distribution_summary AS
SELECT 
    vd.vaccine_id,
    v.name AS vaccine_name,
    vd.source_clinic_id,
    c1.name AS source_clinic,
    vd.destination_barangay_id,
    c2.name AS destination_barangay,
    COUNT(*) AS total_distributions,
    SUM(vd.quantity_distributed) AS total_quantity,
    SUM(CASE WHEN vd.status = 'delivered' THEN 1 ELSE 0 END) AS delivered_count,
    SUM(CASE WHEN vd.status = 'in_transit' THEN 1 ELSE 0 END) AS in_transit_count
FROM vaccine_distributions vd
JOIN vaccines v ON vd.vaccine_id = v.id
JOIN clinics c1 ON vd.source_clinic_id = c1.id
JOIN clinics c2 ON vd.destination_barangay_id = c2.id
WHERE vd.is_active = TRUE
GROUP BY vd.vaccine_id, v.name, vd.source_clinic_id, c1.name, vd.destination_barangay_id, c2.name;

-- View: BHC Performance Summary
CREATE OR REPLACE VIEW view_bhc_performance AS
SELECT 
    br.barangay_clinic_id,
    c.name AS barangay_name,
    br.period_start,
    br.period_end,
    br.report_type,
    br.total_vaccinations_administered,
    br.bcg_coverage,
    br.penta3_coverage,
    br.mcv1_coverage,
    br.full_immunization_coverage,
    br.dropout_rate,
    br.aefi_reported,
    br.stockouts_occurred,
    br.status
FROM bhc_periodic_reports br
JOIN clinics c ON br.barangay_clinic_id = c.id
WHERE br.is_active = TRUE;

-- View: Infant Schedule Compliance
CREATE OR REPLACE VIEW view_infant_schedule_compliance AS
SELECT 
    i.id AS infant_id,
    i.first_name,
    i.last_name,
    i.dob,
    g.name AS guardian_name,
    g.phone AS guardian_phone,
    COUNT(iss.id) AS total_scheduled_doses,
    COUNT(CASE WHEN iss.status = 'administered' THEN 1 END) AS administered_doses,
    COUNT(CASE WHEN iss.status IN ('scheduled', 'due') THEN 1 END) AS pending_doses,
    COUNT(CASE WHEN iss.status = 'overdue' THEN 1 END) AS overdue_doses,
    ROUND(
        COUNT(CASE WHEN iss.status = 'administered' THEN 1 END)::NUMERIC / 
        NULLIF(COUNT(iss.id), 0) * 100, 2
    ) AS compliance_rate
FROM infants i
JOIN guardians g ON i.guardian_id = g.id
LEFT JOIN infant_vaccination_schedules iss ON i.id = iss.infant_id
WHERE i.is_active = TRUE
GROUP BY i.id, i.first_name, i.last_name, i.dob, g.name, g.phone;

-- ===========================================
-- SAMPLE DATA SEEDING
-- ===========================================

-- Insert Standard Vaccination Schedule Templates
INSERT INTO infant_vaccination_schedule_templates (
    vaccine_name, vaccine_code, disease_prevented, dose_number, total_doses,
    target_age_months, min_age_weeks, max_age_weeks, route_of_administration,
    storage_temperature_min, storage_temperature_max, is_mandatory, is_routine,
    priority_level, effective_date
) VALUES
('BCG', 'BCG', 'Tuberculosis', 1, 1, 0, 0, 12, 'ID', 2, 8, TRUE, TRUE, 'high', CURRENT_DATE),
('Hepatitis B', 'HEPB', 'Hepatitis B', 1, 3, 0, 0, 12, 'IM', 2, 8, TRUE, TRUE, 'high', CURRENT_DATE),
('Hepatitis B', 'HEPB', 'Hepatitis B', 2, 3, 1.5, 6, 24, 'IM', 2, 8, TRUE, TRUE, 'high', CURRENT_DATE),
('Hepatitis B', 'HEPB', 'Hepatitis B', 3, 3, 6, 24, 36, 'IM', 2, 8, TRUE, TRUE, 'high', CURRENT_DATE),
('Pentavalent', 'PENTA', 'DPT, Hep B, Hib', 1, 3, 1.5, 6, 24, 'IM', 2, 8, TRUE, TRUE, 'high', CURRENT_DATE),
('Pentavalent', 'PENTA', 'DPT, Hep B, Hib', 2, 3, 2.5, 10, 40, 'IM', 2, 8, TRUE, TRUE, 'high', CURRENT_DATE),
('Pentavalent', 'PENTA', 'DPT, Hep B, Hib', 3, 3, 3.5, 14, 52, 'IM', 2, 8, TRUE, TRUE, 'high', CURRENT_DATE),
('OPV', 'OPV', 'Poliomyelitis', 1, 4, 1.5, 6, 24, 'Oral', -20, -15, TRUE, TRUE, 'high', CURRENT_DATE),
('OPV', 'OPV', 'Poliomyelitis', 2, 4, 2.5, 10, 40, 'Oral', -20, -15, TRUE, TRUE, 'high', CURRENT_DATE),
('OPV', 'OPV', 'Poliomyelitis', 3, 4, 3.5, 14, 52, 'Oral', -20, -15, TRUE, TRUE, 'high', CURRENT_DATE),
('IPV', 'IPV', 'Poliomyelitis', 1, 1, 3.5, 14, 52, 'IM', 2, 8, TRUE, TRUE, 'medium', CURRENT_DATE),
('PCV', 'PCV', 'Pneumococcal', 1, 3, 1.5, 6, 24, 'IM', 2, 8, TRUE, TRUE, 'high', CURRENT_DATE),
('PCV', 'PCV', 'Pneumococcal', 2, 3, 2.5, 10, 40, 'IM', 2, 8, TRUE, TRUE, 'high', CURRENT_DATE),
('PCV', 'PCV', 'Pneumococcal', 3, 3, 3.5, 14, 52, 'IM', 2, 8, TRUE, TRUE, 'high', CURRENT_DATE),
('MR', 'MR', 'Measles, Rubella', 1, 2, 9, 36, 72, 'SC', 2, 8, TRUE, TRUE, 'high', CURRENT_DATE),
('MR', 'MR', 'Measles, Rubella', 2, 2, 15, 60, 120, 'SC', 2, 8, TRUE, TRUE, 'high', CURRENT_DATE);

-- ===========================================
-- END OF SCHEMA
-- ===========================================
