-- Vaccination Management System Database Schema
-- Comprehensive schema for Immunicare Vaccination Management Module

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create enum types for better data integrity
CREATE TYPE vaccination_status AS ENUM ('scheduled', 'completed', 'overdue', 'cancelled');
CREATE TYPE appointment_status AS ENUM ('scheduled', 'completed', 'cancelled', 'no-show');
CREATE TYPE patient_sex AS ENUM ('male', 'female', 'other');
CREATE TYPE inventory_status AS ENUM ('good', 'low', 'critical', 'expired');
CREATE TYPE certificate_type AS ENUM ('official', 'digital_wallet', 'print_friendly', 'summary_report');

-- Patients table - stores patient information
CREATE TABLE patients (
    id SERIAL PRIMARY KEY,
    patient_id VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    date_of_birth DATE NOT NULL,
    sex patient_sex NOT NULL,
    address TEXT,
    mother_name VARCHAR(255),
    father_name VARCHAR(255),
    contact_number VARCHAR(20),
    medical_history TEXT,
    allergies TEXT,
    guardian_consent BOOLEAN DEFAULT false,
    health_center_id INTEGER REFERENCES health_centers(id),
    family_number VARCHAR(50),
    birth_weight DECIMAL(5,2),
    birth_height DECIMAL(5,2),
    place_of_birth VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Vaccination schedules table - defines standard vaccination schedules
CREATE TABLE vaccination_schedules (
    id SERIAL PRIMARY KEY,
    vaccine_name VARCHAR(100) NOT NULL,
    dose_number INTEGER NOT NULL,
    dose_name VARCHAR(100),
    age_months INTEGER NOT NULL,
    age_description VARCHAR(100),
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(vaccine_name, dose_number)
);

-- Vaccinations table - tracks individual vaccination records
CREATE TABLE vaccinations (
    id SERIAL PRIMARY KEY,
    patient_id INTEGER REFERENCES patients(id) ON DELETE CASCADE,
    vaccine_name VARCHAR(100) NOT NULL,
    dose VARCHAR(100),
    schedule VARCHAR(255),
    due_date DATE,
    date_given DATE,
    batch_number VARCHAR(100),
    administered_by VARCHAR(255),
    site VARCHAR(100),
    side_effects TEXT,
    status vaccination_status DEFAULT 'scheduled',
    notes TEXT,
    health_center_id INTEGER REFERENCES health_centers(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_vaccinations_patient_id (patient_id),
    INDEX idx_vaccinations_date_given (date_given),
    INDEX idx_vaccinations_status (status)
);

-- Inventory table - manages vaccine stock
CREATE TABLE inventory (
    id SERIAL PRIMARY KEY,
    vaccine_name VARCHAR(100) NOT NULL,
    batch_number VARCHAR(100) NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity >= 0),
    min_level INTEGER DEFAULT 10,
    reorder_level INTEGER DEFAULT 25,
    expiry_date DATE NOT NULL,
    supplier VARCHAR(255),
    cost_per_unit DECIMAL(10,2),
    storage_location VARCHAR(100),
    temperature VARCHAR(50),
    manufacturer VARCHAR(255),
    health_center_id INTEGER REFERENCES health_centers(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(batch_number, health_center_id),
    INDEX idx_inventory_expiry_date (expiry_date),
    INDEX idx_inventory_quantity (quantity),
    INDEX idx_inventory_vaccine_name (vaccine_name)
);

-- Appointments table - manages vaccination appointments
CREATE TABLE appointments (
    id SERIAL PRIMARY KEY,
    patient_id INTEGER REFERENCES patients(id) ON DELETE CASCADE,
    vaccine VARCHAR(100) NOT NULL,
    appointment_date DATE NOT NULL,
    appointment_time TIME NOT NULL,
    location VARCHAR(100),
    status appointment_status DEFAULT 'scheduled',
    notes TEXT,
    reminder_sent BOOLEAN DEFAULT false,
    nurse_id INTEGER REFERENCES users(id),
    health_center_id INTEGER REFERENCES health_centers(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_appointments_patient_id (patient_id),
    INDEX idx_appointments_date (appointment_date),
    INDEX idx_appointments_status (status),
    UNIQUE(patient_id, appointment_date, appointment_time)
);

-- Certificates table - manages generated certificates
CREATE TABLE certificates (
    id SERIAL PRIMARY KEY,
    patient_id INTEGER REFERENCES patients(id) ON DELETE CASCADE,
    certificate_type certificate_type NOT NULL,
    certificate_number VARCHAR(100) UNIQUE NOT NULL,
    date_issued DATE NOT NULL,
    valid_until DATE NOT NULL,
    status VARCHAR(50) DEFAULT 'active',
    digital_signature TEXT,
    qr_code_url VARCHAR(500),
    generated_by INTEGER REFERENCES users(id),
    health_center_id INTEGER REFERENCES health_centers(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_certificates_patient_id (patient_id),
    INDEX idx_certificates_certificate_number (certificate_number),
    INDEX idx_certificates_date_issued (date_issued)
);

-- Stock transactions table - tracks inventory movements
CREATE TABLE stock_transactions (
    id SERIAL PRIMARY KEY,
    inventory_id INTEGER REFERENCES inventory(id) ON DELETE CASCADE,
    transaction_type VARCHAR(50) NOT NULL CHECK (transaction_type IN ('received', 'issued', 'transferred', 'expired', 'damaged')),
    quantity_change INTEGER NOT NULL,
    transaction_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    from_location VARCHAR(100),
    to_location VARCHAR(100),
    reason TEXT,
    performed_by INTEGER REFERENCES users(id),
    health_center_id INTEGER REFERENCES health_centers(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_transactions_inventory_id (inventory_id),
    INDEX idx_transactions_date (transaction_date),
    INDEX idx_transactions_type (transaction_type)
);

-- Vaccine batch tracking table - detailed batch information
CREATE TABLE vaccine_batches (
    id SERIAL PRIMARY KEY,
    vaccine_name VARCHAR(100) NOT NULL,
    batch_number VARCHAR(100) NOT NULL,
    manufacturer VARCHAR(255),
    production_date DATE,
    expiry_date DATE NOT NULL,
    total_quantity INTEGER NOT NULL,
    received_quantity INTEGER DEFAULT 0,
    remaining_quantity INTEGER DEFAULT 0,
    storage_conditions TEXT,
    health_center_id INTEGER REFERENCES health_centers(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(batch_number, health_center_id),
    INDEX idx_batches_expiry_date (expiry_date),
    INDEX idx_batches_vaccine_name (vaccine_name)
);

-- Immunization records table - comprehensive patient immunization history
CREATE TABLE immunization_records (
    id SERIAL PRIMARY KEY,
    patient_id INTEGER REFERENCES patients(id) ON DELETE CASCADE,
    vaccination_id INTEGER REFERENCES vaccinations(id) ON DELETE CASCADE,
    certificate_id INTEGER REFERENCES certificates(id),
    record_type VARCHAR(50) DEFAULT 'vaccination',
    record_date DATE NOT NULL,
    details JSONB,
    verified BOOLEAN DEFAULT false,
    verified_by INTEGER REFERENCES users(id),
    health_center_id INTEGER REFERENCES health_centers(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_records_patient_id (patient_id),
    INDEX idx_records_record_date (record_date)
);

-- Notifications table - vaccination-related notifications
CREATE TABLE vaccination_notifications (
    id SERIAL PRIMARY KEY,
    patient_id INTEGER REFERENCES patients(id) ON DELETE CASCADE,
    notification_type VARCHAR(50) NOT NULL CHECK (notification_type IN ('appointment_reminder', 'vaccination_due', 'follow_up', 'stock_alert')),
    message TEXT NOT NULL,
    scheduled_date DATE,
    sent_date TIMESTAMP,
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
    channel VARCHAR(50) DEFAULT 'email' CHECK (channel IN ('email', 'sms', 'push')),
    health_center_id INTEGER REFERENCES health_centers(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_notifications_patient_id (patient_id),
    INDEX idx_notifications_type (notification_type),
    INDEX idx_notifications_status (status)
);

-- Coverage tracking table - tracks vaccination coverage rates
CREATE TABLE coverage_tracking (
    id SERIAL PRIMARY KEY,
    health_center_id INTEGER REFERENCES health_centers(id),
    vaccine_name VARCHAR(100) NOT NULL,
    target_population INTEGER NOT NULL,
    vaccinated_count INTEGER DEFAULT 0,
    coverage_rate DECIMAL(5,2) DEFAULT 0.00,
    reporting_period DATE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(health_center_id, vaccine_name, reporting_period),
    INDEX idx_coverage_health_center (health_center_id),
    INDEX idx_coverage_vaccine (vaccine_name),
    INDEX idx_coverage_period (reporting_period)
);

-- Audit log table - tracks all vaccination-related changes
CREATE TABLE vaccination_audit_log (
    id SERIAL PRIMARY KEY,
    table_name VARCHAR(100) NOT NULL,
    record_id INTEGER NOT NULL,
    action VARCHAR(50) NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
    old_values JSONB,
    new_values JSONB,
    changed_by INTEGER REFERENCES users(id),
    health_center_id INTEGER REFERENCES health_centers(id),
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_audit_table_record (table_name, record_id),
    INDEX idx_audit_action (action),
    INDEX idx_audit_changed_by (changed_by),
    INDEX idx_audit_date (created_at)
);

-- Create triggers for automatic timestamp updates
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply triggers to relevant tables
CREATE TRIGGER update_patients_updated_at BEFORE UPDATE ON patients FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_vaccinations_updated_at BEFORE UPDATE ON vaccinations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_inventory_updated_at BEFORE UPDATE ON inventory FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_appointments_updated_at BEFORE UPDATE ON appointments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_certificates_updated_at BEFORE UPDATE ON certificates FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_vaccine_batches_updated_at BEFORE UPDATE ON vaccine_batches FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_immunization_records_updated_at BEFORE UPDATE ON immunization_records FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_vaccination_notifications_updated_at BEFORE UPDATE ON vaccination_notifications FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_coverage_tracking_updated_at BEFORE UPDATE ON coverage_tracking FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create indexes for performance optimization
CREATE INDEX idx_patients_health_center ON patients(health_center_id);
CREATE INDEX idx_patients_date_of_birth ON patients(date_of_birth);
CREATE INDEX idx_vaccinations_health_center ON vaccinations(health_center_id);
CREATE INDEX idx_vaccinations_patient_status ON vaccinations(patient_id, status);
CREATE INDEX idx_inventory_health_center ON inventory(health_center_id);
CREATE INDEX idx_appointments_health_center ON appointments(health_center_id);
CREATE INDEX idx_appointments_patient_status ON appointments(patient_id, status);
CREATE INDEX idx_certificates_health_center ON certificates(health_center_id);
CREATE INDEX idx_stock_transactions_health_center ON stock_transactions(health_center_id);
CREATE INDEX idx_vaccine_batches_health_center ON vaccine_batches(health_center_id);
CREATE INDEX idx_immunization_records_health_center ON immunization_records(health_center_id);
CREATE INDEX idx_vaccination_notifications_health_center ON vaccination_notifications(health_center_id);

-- Create views for common queries

-- View for patient vaccination summary
CREATE VIEW patient_vaccination_summary AS
SELECT 
    p.id as patient_id,
    p.name as patient_name,
    p.date_of_birth,
    p.sex,
    p.contact_number,
    COUNT(v.id) as total_vaccinations_scheduled,
    COUNT(CASE WHEN v.status = 'completed' THEN 1 END) as completed_vaccinations,
    COUNT(CASE WHEN v.status = 'overdue' THEN 1 END) as overdue_vaccinations,
    ROUND(
        (COUNT(CASE WHEN v.status = 'completed' THEN 1 END) * 100.0 / NULLIF(COUNT(v.id), 0)), 2
    ) as vaccination_coverage_rate,
    MAX(v.date_given) as last_vaccination_date,
    p.health_center_id
FROM patients p
LEFT JOIN vaccinations v ON p.id = v.patient_id
GROUP BY p.id, p.name, p.date_of_birth, p.sex, p.contact_number, p.health_center_id;

-- View for inventory status summary
CREATE VIEW inventory_status_summary AS
SELECT 
    i.vaccine_name,
    SUM(i.quantity) as total_quantity,
    COUNT(*) as total_batches,
    COUNT(CASE WHEN i.quantity <= i.min_level THEN 1 END) as low_stock_batches,
    COUNT(CASE WHEN i.expiry_date <= CURRENT_DATE THEN 1 END) as expired_batches,
    COUNT(CASE WHEN i.expiry_date <= CURRENT_DATE + INTERVAL '30 days' THEN 1 END) as expiring_soon_batches,
    MIN(i.expiry_date) as nearest_expiry_date,
    i.health_center_id
FROM inventory i
GROUP BY i.vaccine_name, i.health_center_id;

-- View for appointment summary
CREATE VIEW appointment_summary AS
SELECT 
    DATE(a.appointment_date) as appointment_date,
    COUNT(*) as total_appointments,
    COUNT(CASE WHEN a.status = 'completed' THEN 1 END) as completed_appointments,
    COUNT(CASE WHEN a.status = 'scheduled' THEN 1 END) as scheduled_appointments,
    COUNT(CASE WHEN a.status = 'no-show' THEN 1 END) as no_show_appointments,
    COUNT(CASE WHEN a.status = 'cancelled' THEN 1 END) as cancelled_appointments,
    a.health_center_id
FROM appointments a
GROUP BY DATE(a.appointment_date), a.health_center_id
ORDER BY appointment_date DESC;

-- Insert sample data for vaccination schedules
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
('Measles, Mumps, Rubella', 2, 'MMR 2', 12, '12 months', 'Second dose of MMR vaccine');

-- Grant permissions
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO immunicare_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO immunicare_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO immunicare_user;

-- Add comments for documentation
COMMENT ON TABLE patients IS 'Stores patient demographic and contact information';
COMMENT ON TABLE vaccinations IS 'Tracks individual vaccination records and administration details';
COMMENT ON TABLE inventory IS 'Manages vaccine stock levels and batch information';
COMMENT ON TABLE appointments IS 'Manages vaccination appointment scheduling';
COMMENT ON TABLE certificates IS 'Stores generated immunization certificates';
COMMENT ON TABLE vaccination_schedules IS 'Defines standard vaccination schedules by age and vaccine type';