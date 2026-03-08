-- Create missing immunization_records table
-- This table is referenced in dashboard routes and is critical for guardian dashboard functionality

-- Check if table exists, if not create it
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'immunization_records') THEN
        CREATE TABLE immunization_records (
            id SERIAL PRIMARY KEY,
            patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
            vaccine_id INTEGER REFERENCES vaccines(id) ON DELETE SET NULL,
            batch_id INTEGER REFERENCES vaccine_batches(id) ON DELETE SET NULL,
            admin_date DATE,
            next_due_date DATE,
            status VARCHAR(50) DEFAULT 'scheduled',
            notes TEXT,
            administered_by INTEGER REFERENCES users(id),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            is_active BOOLEAN DEFAULT true
        );
        
        -- Create indexes for better performance
        CREATE INDEX idx_immunization_records_patient_id ON immunization_records(patient_id);
        CREATE INDEX idx_immunization_records_vaccine_id ON immunization_records(vaccine_id);
        CREATE INDEX idx_immunization_records_status ON immunization_records(status);
        CREATE INDEX idx_immunization_records_next_due_date ON immunization_records(next_due_date);
        
        RAISE NOTICE 'Created immunization_records table';
    ELSE
        RAISE NOTICE 'immunization_records table already exists';
    END IF;
END $$;

-- Also check if patient_growth table exists (needed for health charts)
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'patient_growth') THEN
        CREATE TABLE patient_growth (
            id SERIAL PRIMARY KEY,
            patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
            measurement_date DATE NOT NULL,
            weight DECIMAL(10,2), -- in kg
            height DECIMAL(10,2), -- in cm
            head_circumference DECIMAL(10,2), -- in cm
            weight_for_age_percentile DECIMAL(5,2),
            height_for_age_percentile DECIMAL(5,2),
            weight_for_height_percentile DECIMAL(5,2),
            notes TEXT,
            measured_by INTEGER REFERENCES users(id),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            is_active BOOLEAN DEFAULT true
        );
        
        -- Create indexes
        CREATE INDEX idx_patient_growth_patient_id ON patient_growth(patient_id);
        CREATE INDEX idx_patient_growth_measurement_date ON patient_growth(measurement_date);
        
        RAISE NOTICE 'Created patient_growth table';
    ELSE
        RAISE NOTICE 'patient_growth table already exists';
    END IF;
END $$;

-- Check if vaccine_batches table exists
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'vaccine_batches') THEN
        CREATE TABLE vaccine_batches (
            id SERIAL PRIMARY KEY,
            vaccine_id INTEGER NOT NULL REFERENCES vaccines(id) ON DELETE CASCADE,
            lot_no VARCHAR(100) UNIQUE NOT NULL,
            manufacturer VARCHAR(255),
            production_date DATE,
            expiry_date DATE,
            initial_quantity INTEGER DEFAULT 0,
            current_quantity INTEGER DEFAULT 0,
            clinic_id INTEGER REFERENCES clinics(id),
            received_date DATE,
            supplier VARCHAR(255),
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            is_active BOOLEAN DEFAULT true
        );
        
        -- Create indexes
        CREATE INDEX idx_vaccine_batches_vaccine_id ON vaccine_batches(vaccine_id);
        CREATE INDEX idx_vaccine_batches_lot_no ON vaccine_batches(lot_no);
        CREATE INDEX idx_vaccine_batches_expiry_date ON vaccine_batches(expiry_date);
        
        RAISE NOTICE 'Created vaccine_batches table';
    ELSE
        RAISE NOTICE 'vaccine_batches table already exists';
    END IF;
END $$;

-- Display summary
SELECT 
    'immunization_records' as table_name,
    EXISTS(SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'immunization_records') as exists
UNION ALL
SELECT 
    'patient_growth' as table_name,
    EXISTS(SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'patient_growth') as exists
UNION ALL
SELECT 
    'vaccine_batches' as table_name,
    EXISTS(SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'vaccine_batches') as exists;
