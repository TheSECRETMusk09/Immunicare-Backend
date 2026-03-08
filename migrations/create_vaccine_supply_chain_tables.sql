-- ============================================================================
-- VACCINE SUPPLY CHAIN MANAGEMENT TABLES
-- Migration Script for City-to-Baranggay Vaccine Workflow
-- Date: 2026-02-10
-- ============================================================================

-- ============================================================================
-- SECTION 1: NEW ENUM TYPES
-- ============================================================================

-- Request status enumeration
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'request_status') THEN
        CREATE TYPE request_status AS ENUM ('pending', 'under_review', 'approved', 'partially_fulfilled', 'fulfilled', 'rejected', 'cancelled');
    END IF;
    
    -- Allocation status enumeration
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'allocation_status') THEN
        CREATE TYPE allocation_status AS ENUM ('pending', 'prepared', 'in_transit', 'delivered', 'received', 'cancelled');
    END IF;
    
    -- Distribution mode enumeration
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'distribution_mode') THEN
        CREATE TYPE distribution_mode AS ENUM ('pickup', 'delivery');
    END IF;
    
    -- Temperature status enumeration
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'temperature_status') THEN
        CREATE TYPE temperature_status AS ENUM ('normal', 'warning', 'critical');
    END IF;
    
    -- Storage condition enumeration
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'storage_condition') THEN
        CREATE TYPE storage_condition AS ENUM ('good', 'damaged', 'expired', 'recalled');
    END IF;
    
    -- Report type enumeration
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'supply_report_type') THEN
        CREATE TYPE supply_report_type AS ENUM ('daily', 'weekly', 'monthly', 'special', 'consumption');
    END IF;
END $$;

-- ============================================================================
-- SECTION 2: NEW TABLES
-- ============================================================================

-- Table: vaccine_requests
-- Stores vaccine requests from barangay health centers to City Health Office
CREATE TABLE IF NOT EXISTS vaccine_requests (
    id SERIAL PRIMARY KEY,
    request_number VARCHAR(50) NOT NULL UNIQUE,
    requesting_barangay_id INTEGER NOT NULL REFERENCES healthcare_facilities(id),
    requested_vaccine_id INTEGER NOT NULL REFERENCES vaccines(id),
    requested_quantity INTEGER NOT NULL CHECK (requested_quantity > 0),
    allocated_quantity INTEGER DEFAULT 0,
    priority priority_level NOT NULL DEFAULT 'medium',
    status request_status NOT NULL DEFAULT 'pending',
    request_date DATE NOT NULL,
    needed_by_date DATE,
    purpose VARCHAR(255),
    notes TEXT,
    consumption_report JSONB,
    reviewed_by INTEGER REFERENCES admin(id),
    reviewed_at TIMESTAMP WITH TIME ZONE,
    review_notes TEXT,
    created_by INTEGER NOT NULL REFERENCES admin(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE vaccine_requests IS 'Tracks vaccine requests from barangay health centers to City Health Office';

-- Table: vaccine_allocations
-- Tracks vaccine allocations from City Health Office to barangay health centers
CREATE TABLE IF NOT EXISTS vaccine_allocations (
    id SERIAL PRIMARY KEY,
    allocation_number VARCHAR(50) NOT NULL UNIQUE,
    request_id INTEGER REFERENCES vaccine_requests(id),
    allocating_facility_id INTEGER NOT NULL REFERENCES healthcare_facilities(id),
    receiving_barangay_id INTEGER NOT NULL REFERENCES healthcare_facilities(id),
    vaccine_id INTEGER NOT NULL REFERENCES vaccines(id),
    allocated_quantity INTEGER NOT NULL CHECK (allocated_quantity > 0),
    batch_number VARCHAR(255),
    expiry_date DATE,
    allocation_date DATE NOT NULL,
    distribution_mode distribution_mode NOT NULL DEFAULT 'pickup',
    scheduled_date DATE,
    delivered_date DATE,
    delivered_by VARCHAR(255),
    received_by VARCHAR(255),
    received_signature VARCHAR(255),
    received_at TIMESTAMP WITH TIME ZONE,
    status allocation_status NOT NULL DEFAULT 'pending',
    notes TEXT,
    cold_chain_verified BOOLEAN DEFAULT FALSE,
    verified_by INTEGER REFERENCES admin(id),
    verified_at TIMESTAMP WITH TIME ZONE,
    created_by INTEGER NOT NULL REFERENCES admin(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE vaccine_allocations IS 'Tracks vaccine allocations from City Health Office to barangay health centers';

-- Table: vaccine_distribution_items
-- Line items for vaccine distributions
CREATE TABLE IF NOT EXISTS vaccine_distribution_items (
    id SERIAL PRIMARY KEY,
    distribution_id INTEGER NOT NULL REFERENCES vaccine_allocations(id),
    vaccine_id INTEGER NOT NULL REFERENCES vaccines(id),
    batch_number VARCHAR(255) NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    expiry_date DATE NOT NULL,
    unit_cost DECIMAL(10, 2),
    total_cost DECIMAL(10, 2),
    storage_requirements TEXT,
    temperature_range VARCHAR(50),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE vaccine_distribution_items IS 'Line items for vaccine distributions';

-- Table: temperature_logs
-- Tracks temperature readings for cold chain compliance
CREATE TABLE IF NOT EXISTS temperature_logs (
    id SERIAL PRIMARY KEY,
    facility_id INTEGER NOT NULL REFERENCES healthcare_facilities(id),
    storage_unit_id VARCHAR(100),
    vaccine_id INTEGER REFERENCES vaccines(id),
    temperature_celsius DECIMAL(4, 1) NOT NULL,
    humidity DECIMAL(5, 2),
    temperature_status temperature_status NOT NULL DEFAULT 'normal',
    recorded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    recorded_by INTEGER REFERENCES admin(id),
    notes TEXT,
    alert_sent BOOLEAN DEFAULT FALSE,
    alert_sent_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE temperature_logs IS 'Tracks temperature readings for cold chain compliance';

-- Table: barangay_storage
-- Tracks vaccine storage at barangay health centers
CREATE TABLE IF NOT EXISTS barangay_storage (
    id SERIAL PRIMARY KEY,
    facility_id INTEGER NOT NULL REFERENCES healthcare_facilities(id),
    vaccine_id INTEGER NOT NULL REFERENCES vaccines(id),
    batch_number VARCHAR(255) NOT NULL,
    quantity_received INTEGER NOT NULL,
    quantity_on_hand INTEGER NOT NULL DEFAULT 0,
    quantity_used INTEGER NOT NULL DEFAULT 0,
    quantity_expired INTEGER NOT NULL DEFAULT 0,
    quantity_damaged INTEGER NOT NULL DEFAULT 0,
    expiry_date DATE NOT NULL,
    storage_location VARCHAR(100),
    storage_unit VARCHAR(100),
    date_received DATE NOT NULL,
    received_from VARCHAR(255),
    received_by VARCHAR(255),
    temperature_at_receipt DECIMAL(4, 1),
    condition_at_receipt storage_condition DEFAULT 'good',
    status batch_status NOT NULL DEFAULT 'active',
    last_counted_at TIMESTAMP WITH TIME ZONE,
    last_counted_by INTEGER REFERENCES admin(id),
    notes TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE barangay_storage IS 'Tracks vaccine storage at barangay health centers';

-- Table: vaccination_reports
-- Tracks vaccination reports submitted by barangay health centers
CREATE TABLE IF NOT EXISTS vaccination_reports (
    id SERIAL PRIMARY KEY,
    report_number VARCHAR(50) NOT NULL UNIQUE,
    facility_id INTEGER NOT NULL REFERENCES healthcare_facilities(id),
    report_type supply_report_type NOT NULL,
    report_period_start DATE NOT NULL,
    report_period_end DATE NOT NULL,
    vaccines_administered JSONB NOT NULL,
    remaining_stock JSONB,
    expired_vaccines JSONB,
    damaged_vaccines JSONB,
    stock_discrepancies JSONB,
    temperature_compliance JSONB,
    activities_summary TEXT,
    issues_encountered TEXT,
    recommendations TEXT,
    submitted_by INTEGER NOT NULL REFERENCES admin(id),
    submitted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_by INTEGER REFERENCES admin(id),
    reviewed_at TIMESTAMP WITH TIME ZONE,
    review_notes TEXT,
    status report_status NOT NULL DEFAULT 'submitted',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE vaccination_reports IS 'Tracks vaccination reports submitted by barangay health centers';

-- ============================================================================
-- SECTION 3: UPDATED EXISTING TABLES
-- ============================================================================

-- Add new columns to healthcare_facilities table
ALTER TABLE healthcare_facilities ADD COLUMN IF NOT EXISTS facility_subtype VARCHAR(50);
ALTER TABLE healthcare_facilities ADD COLUMN IF NOT EXISTS is_warehouse BOOLEAN DEFAULT FALSE;
ALTER TABLE healthcare_facilities ADD COLUMN IF NOT EXISTS parent_facility_id INTEGER REFERENCES healthcare_facilities(id);
ALTER TABLE healthcare_facilities ADD COLUMN IF NOT EXISTS contact_person VARCHAR(255);
ALTER TABLE healthcare_facilities ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(20);
ALTER TABLE healthcare_facilities ADD COLUMN IF NOT EXISTS operating_hours VARCHAR(100);
ALTER TABLE healthcare_facilities ADD COLUMN IF NOT EXISTS cold_chain_capacity INTEGER DEFAULT 0;
ALTER TABLE healthcare_facilities ADD COLUMN IF NOT EXISTS has_digital_thermometer BOOLEAN DEFAULT FALSE;

-- Add new columns to vaccine_inventory table
ALTER TABLE vaccine_inventory ADD COLUMN IF NOT EXISTS emergency_threshold INTEGER DEFAULT 3;
ALTER TABLE vaccine_inventory ADD COLUMN IF NOT EXISTS buffer_days INTEGER DEFAULT 7;
ALTER TABLE vaccine_inventory ADD COLUMN IF NOT EXISTS last_reordered_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE vaccine_inventory ADD COLUMN IF NOT EXISTS reorder_point INTEGER;

-- ============================================================================
-- SECTION 4: INDEXES
-- ============================================================================

-- Indexes for vaccine_requests
CREATE INDEX IF NOT EXISTS idx_vaccine_requests_requesting_barangay ON vaccine_requests(requesting_barangay_id);
CREATE INDEX IF NOT EXISTS idx_vaccine_requests_requested_vaccine ON vaccine_requests(requested_vaccine_id);
CREATE INDEX IF NOT EXISTS idx_vaccine_requests_status ON vaccine_requests(status);
CREATE INDEX IF NOT EXISTS idx_vaccine_requests_request_date ON vaccine_requests(request_date);
CREATE INDEX IF NOT EXISTS idx_vaccine_requests_priority ON vaccine_requests(priority);

-- Indexes for vaccine_allocations
CREATE INDEX IF NOT EXISTS idx_vaccine_allocations_allocating_facility ON vaccine_allocations(allocating_facility_id);
CREATE INDEX IF NOT EXISTS idx_vaccine_allocations_receiving_barangay ON vaccine_allocations(receiving_barangay_id);
CREATE INDEX IF NOT EXISTS idx_vaccine_allocations_vaccine_id ON vaccine_allocations(vaccine_id);
CREATE INDEX IF NOT EXISTS idx_vaccine_allocations_status ON vaccine_allocations(status);
CREATE INDEX IF NOT EXISTS idx_vaccine_allocations_scheduled_date ON vaccine_allocations(scheduled_date);

-- Indexes for vaccine_distribution_items
CREATE INDEX IF NOT EXISTS idx_vaccine_distribution_items_distribution ON vaccine_distribution_items(distribution_id);
CREATE INDEX IF NOT EXISTS idx_vaccine_distribution_items_vaccine ON vaccine_distribution_items(vaccine_id);

-- Indexes for temperature_logs
CREATE INDEX IF NOT EXISTS idx_temperature_logs_facility ON temperature_logs(facility_id);
CREATE INDEX IF NOT EXISTS idx_temperature_logs_recorded_at ON temperature_logs(recorded_at);
CREATE INDEX IF NOT EXISTS idx_temperature_logs_temperature_status ON temperature_logs(temperature_status);

-- Indexes for barangay_storage
CREATE INDEX IF NOT EXISTS idx_barangay_storage_facility ON barangay_storage(facility_id);
CREATE INDEX IF NOT EXISTS idx_barangay_storage_vaccine ON barangay_storage(vaccine_id);
CREATE INDEX IF NOT EXISTS idx_barangay_storage_batch_number ON barangay_storage(batch_number);
CREATE INDEX IF NOT EXISTS idx_barangay_storage_expiry_date ON barangay_storage(expiry_date);
CREATE INDEX IF NOT EXISTS idx_barangay_storage_status ON barangay_storage(status);

-- Indexes for vaccination_reports
CREATE INDEX IF NOT EXISTS idx_vaccination_reports_facility ON vaccination_reports(facility_id);
CREATE INDEX IF NOT EXISTS idx_vaccination_reports_report_type ON vaccination_reports(report_type);
CREATE INDEX IF NOT EXISTS idx_vaccination_reports_period ON vaccination_reports(report_period_start, report_period_end);
CREATE INDEX IF NOT EXISTS idx_vaccination_reports_status ON vaccination_reports(status);
CREATE INDEX IF NOT EXISTS idx_vaccination_reports_submitted_at ON vaccination_reports(submitted_at);

-- ============================================================================
-- SECTION 5: FUNCTIONS
-- ============================================================================

-- Function: Generate request number
CREATE OR REPLACE FUNCTION fn_generate_request_number()
RETURNS VARCHAR(50) AS $$
DECLARE
    request_count INTEGER;
    request_number VARCHAR(50);
BEGIN
    SELECT COUNT(*) + 1 INTO request_count FROM vaccine_requests;
    request_number := 'REQ-' || TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD') || '-' || LPAD(request_count::TEXT, 4, '0');
    RETURN request_number;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_generate_request_number() IS 'Generates a unique request number for vaccine requests';

-- Function: Generate allocation number
CREATE OR REPLACE FUNCTION fn_generate_allocation_number()
RETURNS VARCHAR(50) AS $$
DECLARE
    allocation_count INTEGER;
    allocation_number VARCHAR(50);
BEGIN
    SELECT COUNT(*) + 1 INTO allocation_count FROM vaccine_allocations;
    allocation_number := 'ALLOC-' || TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD') || '-' || LPAD(allocation_count::TEXT, 4, '0');
    RETURN allocation_number;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_generate_allocation_number() IS 'Generates a unique allocation number for vaccine allocations';

-- Function: Generate report number
CREATE OR REPLACE FUNCTION fn_generate_report_number()
RETURNS VARCHAR(50) AS $$
DECLARE
    report_count INTEGER;
    report_number VARCHAR(50);
BEGIN
    SELECT COUNT(*) + 1 INTO report_count FROM vaccination_reports;
    report_number := 'RPT-' || TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD') || '-' || LPAD(report_count::TEXT, 4, '0');
    RETURN report_number;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_generate_report_number() IS 'Generates a unique report number for vaccination reports';

-- Function: Check temperature status
CREATE OR REPLACE FUNCTION fn_check_temperature_status(temp_celsius DECIMAL(4, 1))
RETURNS temperature_status AS $$
BEGIN
    IF temp_celsius < 2 OR temp_celsius > 8 THEN
        RETURN 'critical';
    ELSIF temp_celsius < 3 OR temp_celsius > 7 THEN
        RETURN 'warning';
    ELSE
        RETURN 'normal';
    END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_check_temperature_status(DECIMAL) IS 'Determines temperature status based on reading';

-- Function: Update allocation status when received
CREATE OR REPLACE FUNCTION fn_update_allocation_on_receive()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'received' THEN
        UPDATE vaccine_allocations
        SET received_at = CURRENT_TIMESTAMP,
            received_by = NEW.received_by,
            received_signature = NEW.received_signature,
            status = 'received',
            updated_at = CURRENT_TIMESTAMP
        WHERE id = NEW.id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function: Calculate days until expiry
CREATE OR REPLACE FUNCTION fn_days_until_expiry(expiry_date DATE)
RETURNS INTEGER AS $$
BEGIN
    RETURN EXTRACT(DAY FROM (expiry_date - CURRENT_DATE));
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_days_until_expiry(DATE) IS 'Calculates days until vaccine expiry';

-- ============================================================================
-- SECTION 6: TRIGGERS
-- ============================================================================

-- Trigger: Update timestamp for vaccine_requests
CREATE TRIGGER trg_vaccine_requests_update_timestamp
    BEFORE UPDATE ON vaccine_requests
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_timestamp();

-- Trigger: Update timestamp for vaccine_allocations
CREATE TRIGGER trg_vaccine_allocations_update_timestamp
    BEFORE UPDATE ON vaccine_allocations
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_timestamp();

-- Trigger: Update timestamp for vaccine_distribution_items
CREATE TRIGGER trg_vaccine_distribution_items_update_timestamp
    BEFORE UPDATE ON vaccine_distribution_items
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_timestamp();

-- Trigger: Update timestamp for temperature_logs
CREATE TRIGGER trg_temperature_logs_update_timestamp
    BEFORE UPDATE ON temperature_logs
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_timestamp();

-- Trigger: Update timestamp for barangay_storage
CREATE TRIGGER trg_barangay_storage_update_timestamp
    BEFORE UPDATE ON barangay_storage
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_timestamp();

-- Trigger: Update timestamp for vaccination_reports
CREATE TRIGGER trg_vaccination_reports_update_timestamp
    BEFORE UPDATE ON vaccination_reports
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_timestamp();

-- ============================================================================
-- SECTION 7: INITIAL DATA SEEDING
-- ============================================================================

-- Insert Pasig City Hall as main warehouse facility
INSERT INTO healthcare_facilities (name, region, address, contact, facility_type, facility_subtype, is_warehouse, cold_chain_capacity, has_digital_thermometer)
VALUES (
    'Pasig City Health Office',
    'Metro Manila',
    'Pasig City Hall, Caruncho Ave, Pasig City',
    '(02) 643-0000',
    'health_center',
    'city_warehouse',
    TRUE,
    1000,
    TRUE
)
ON CONFLICT (name) DO NOTHING;

-- Insert sample barangay health centers
INSERT INTO healthcare_facilities (name, region, address, contact, facility_type, facility_subtype, parent_facility_id, cold_chain_capacity, has_digital_thermometer)
SELECT 
    'Barangay San Nicolas Health Center',
    'Metro Manila',
    'San Nicolas, Pasig City',
    '(02) 643-1111',
    'health_center',
    'barangay',
    (SELECT id FROM healthcare_facilities WHERE name = 'Pasig City Health Office'),
    50,
    TRUE
WHERE NOT EXISTS (SELECT 1 FROM healthcare_facilities WHERE name = 'Barangay San Nicolas Health Center');

INSERT INTO healthcare_facilities (name, region, address, contact, facility_type, facility_subtype, parent_facility_id, cold_chain_capacity, has_digital_thermometer)
SELECT 
    'Barangay Caniogan Health Center',
    'Metro Manila',
    'Caniogan, Pasig City',
    '(02) 643-2222',
    'health_center',
    'barangay',
    (SELECT id FROM healthcare_facilities WHERE name = 'Pasig City Health Office'),
    50,
    TRUE
WHERE NOT EXISTS (SELECT 1 FROM healthcare_facilities WHERE name = 'Barangay Caniogan Health Center');

INSERT INTO healthcare_facilities (name, region, address, contact, facility_type, facility_subtype, parent_facility_id, cold_chain_capacity, has_digital_thermometer)
SELECT 
    'Barangay Santa Cruz Health Center',
    'Metro Manila',
    'Santa Cruz, Pasig City',
    '(02) 643-3333',
    'health_center',
    'barangay',
    (SELECT id FROM healthcare_facilities WHERE name = 'Pasig City Health Office'),
    50,
    TRUE
WHERE NOT EXISTS (SELECT 1 FROM healthcare_facilities WHERE name = 'Barangay Santa Cruz Health Center');

-- ============================================================================
-- SECTION 8: DATA MIGRATION (If needed)
-- ============================================================================

-- If there are existing items in vaccine_inventory that need to be moved to the city warehouse
-- This would migrate existing vaccine inventory to the new city warehouse facility
/*
UPDATE vaccine_inventory vi
SET facility_id = (SELECT id FROM healthcare_facilities WHERE name = 'Pasig City Health Office')
WHERE vi.facility_id IS NULL;
*/

-- ============================================================================
-- SECTION 9: VERIFICATION
-- ============================================================================

SELECT 'Vaccine Supply Chain Tables Created Successfully' AS status,
       CURRENT_TIMESTAMP AS created_at;

-- List all new tables
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN (
    'vaccine_requests',
    'vaccine_allocations',
    'vaccine_distribution_items',
    'temperature_logs',
    'barangay_storage',
    'vaccination_reports'
)
ORDER BY table_name;

-- ============================================================================
-- END OF MIGRATION SCRIPT
-- ============================================================================
