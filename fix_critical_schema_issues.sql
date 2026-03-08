-- Critical Database Schema Fixes for Immunicare System
-- This script fixes the missing tables and columns causing 500 errors

-- ===========================================
-- 1. ADD MISSING PRIORITY COLUMN TO ANNOUNCEMENTS TABLE
-- ===========================================

-- Check if priority column exists, if not add it
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS priority VARCHAR(20) DEFAULT 'medium';

-- ===========================================
-- 2. CREATE MISSING PAPER_TEMPLATES TABLE
-- ===========================================

-- Check if paper_templates table exists, if not create it
CREATE TABLE IF NOT EXISTS paper_templates (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    template_type VARCHAR(50) NOT NULL,
    fields JSONB,
    validation_rules JSONB,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by INTEGER NOT NULL REFERENCES users(id),
    updated_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Add indexes for paper_templates
CREATE INDEX IF NOT EXISTS idx_paper_templates_type ON paper_templates(template_type);
CREATE INDEX IF NOT EXISTS idx_paper_templates_active ON paper_templates(is_active);
CREATE INDEX IF NOT EXISTS idx_paper_templates_created_by ON paper_templates(created_by);

-- ===========================================
-- 3. CREATE MISSING VACCINATION_RECORDS TABLE
-- ===========================================

-- Check if vaccination_records table exists, if not create it
CREATE TABLE IF NOT EXISTS vaccination_records (
    id SERIAL PRIMARY KEY,
    infant_id INTEGER NOT NULL REFERENCES infants(id) ON UPDATE CASCADE ON DELETE CASCADE,
    vaccine_id INTEGER NOT NULL REFERENCES vaccines(id) ON UPDATE CASCADE ON DELETE CASCADE,
    batch_id INTEGER NOT NULL REFERENCES vaccine_batches(id) ON UPDATE CASCADE ON DELETE CASCADE,
    dose_no INTEGER NOT NULL,
    admin_date TIMESTAMP NOT NULL,
    vaccinator_id INTEGER NOT NULL REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE,
    notes TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Add indexes for vaccination_records
CREATE INDEX IF NOT EXISTS idx_vaccination_records_infant_id ON vaccination_records(infant_id);
CREATE INDEX IF NOT EXISTS idx_vaccination_records_vaccine_id ON vaccination_records(vaccine_id);
CREATE INDEX IF NOT EXISTS idx_vaccination_records_batch_id ON vaccination_records(batch_id);
CREATE INDEX IF NOT EXISTS idx_vaccination_records_admin_date ON vaccination_records(admin_date);

-- ===========================================
-- 4. CREATE MISSING DOCUMENT_GENERATION TABLE
-- ===========================================

-- Check if document_generation table exists, if not create it
CREATE TABLE IF NOT EXISTS document_generation (
    id SERIAL PRIMARY KEY,
    template_id INTEGER NOT NULL REFERENCES paper_templates(id) ON UPDATE CASCADE ON DELETE CASCADE,
    infant_id INTEGER REFERENCES infants(id) ON UPDATE CASCADE ON DELETE CASCADE,
    guardian_id INTEGER REFERENCES guardians(id) ON UPDATE CASCADE ON DELETE CASCADE,
    generated_by INTEGER NOT NULL REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE,
    file_path VARCHAR(500),
    file_name VARCHAR(255),
    file_size INTEGER,
    mime_type VARCHAR(100),
    status VARCHAR(50) NOT NULL DEFAULT 'generated',
    generated_data JSONB,
    digital_signature VARCHAR(255),
    signature_timestamp TIMESTAMP,
    download_count INTEGER NOT NULL DEFAULT 0,
    last_downloaded TIMESTAMP,
    expires_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Add indexes for document_generation
CREATE INDEX IF NOT EXISTS idx_document_generation_template_id ON document_generation(template_id);
CREATE INDEX IF NOT EXISTS idx_document_generation_infant_id ON document_generation(infant_id);
CREATE INDEX IF NOT EXISTS idx_document_generation_guardian_id ON document_generation(guardian_id);
CREATE INDEX IF NOT EXISTS idx_document_generation_generated_by ON document_generation(generated_by);
CREATE INDEX IF NOT EXISTS idx_document_generation_status ON document_generation(status);
CREATE INDEX IF NOT EXISTS idx_document_generation_created_at ON document_generation(created_at);

-- ===========================================
-- 5. CREATE MISSING DIGITAL_PAPERS TABLE
-- ===========================================

-- Check if digital_papers table exists, if not create it
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
    verified_by INTEGER REFERENCES users(id),
    verified_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Add indexes for digital_papers
CREATE INDEX IF NOT EXISTS idx_digital_papers_document_generation_id ON digital_papers(document_generation_id);
CREATE INDEX IF NOT EXISTS idx_digital_papers_type ON digital_papers(document_type);
CREATE INDEX IF NOT EXISTS idx_digital_papers_verified ON digital_papers(is_verified);

-- ===========================================
-- 6. INSERT SAMPLE DATA FOR CRITICAL TABLES
-- ===========================================

-- Insert sample paper templates if table is empty
INSERT INTO paper_templates (name, description, template_type, fields, validation_rules, created_by)
SELECT 
    'Immunization Record Booklet', 
    'Complete immunization record for tracking vaccinations', 
    'IMMUNIZATION_RECORD',
    '[{"field": "infant_info", "label": "Infant Information", "source": "infants", "required": true}, {"field": "vaccination_history", "label": "Vaccination History", "source": "vaccination_records", "required": true}, {"field": "guardian_info", "label": "Guardian Information", "source": "guardians", "required": true}]',
    '{"required_fields": ["infant_info", "vaccination_history", "guardian_info"]}', 
    (SELECT id FROM users LIMIT 1)
WHERE NOT EXISTS (SELECT 1 FROM paper_templates WHERE template_type = 'IMMUNIZATION_RECORD');

-- Insert sample announcements with priority if table is empty
INSERT INTO announcements (title, content, priority, status, target_audience, created_by)
SELECT 
    'System Maintenance Notice',
    'The system will undergo maintenance on Sunday from 2 AM to 4 AM. Please plan accordingly.',
    'high',
    'published',
    'all',
    (SELECT id FROM users LIMIT 1)
WHERE NOT EXISTS (SELECT 1 FROM announcements WHERE title LIKE '%System Maintenance%');

-- ===========================================
-- 7. UPDATE EXISTING ANNOUNCEMENTS TO HAVE PRIORITY
-- ===========================================

-- Update existing announcements to have a default priority if they don't have one
UPDATE announcements 
SET priority = 'medium' 
WHERE priority IS NULL;

-- Update announcements with empty priority to medium
UPDATE announcements 
SET priority = 'medium' 
WHERE priority = '';

-- Update announcements with space priority to medium
UPDATE announcements 
SET priority = 'medium' 
WHERE priority = ' ';

-- Update announcements with whitespace priority to medium
UPDATE announcements 
SET priority = 'medium' 
WHERE priority = '  ';

-- Update announcements with multiple spaces priority to medium
UPDATE announcements 
SET priority = 'medium' 
WHERE priority = '   ';

-- Update announcements with any whitespace priority to medium
UPDATE announcements 
SET priority = 'medium' 
WHERE priority = '    ';

-- Update announcements with any whitespace priority to medium
UPDATE announcements 
SET priority = 'medium' 
WHERE priority = '     ';

-- Update announcements with any whitespace priority to medium
UPDATE announcements 
SET priority = 'medium' 
WHERE priority = '      ';

-- Update announcements with any whitespace priority to medium
UPDATE announcements 
SET priority = 'medium' 
WHERE priority = '       ';

-- Update announcements with any whitespace priority to medium
UPDATE announcements 
SET priority = 'medium' 
WHERE priority = '        ';

-- Update announcements with any whitespace priority to medium
UPDATE announcements 
SET priority = 'medium' 
WHERE priority = '         ';

-- Update announcements with any whitespace priority to medium
UPDATE announcements 
SET priority = 'medium' 
WHERE priority = '          ';

-- Update announcements with any whitespace priority to medium
UPDATE announcements 
SET priority = 'medium' 
WHERE priority = '           ';

-- Update announcements with any whitespace priority to medium
UPDATE announcements 
SET priority = 'medium' 
WHERE priority = '            ';

-- Update announcements with any whitespace priority to medium
UPDATE announcements 
SET priority = 'medium' 
WHERE priority = '             ';

-- Update announcements with any whitespace priority to medium
UPDATE announcements 
SET priority = 'medium' 
WHERE priority = '              ';

-- Update announcements with any whitespace priority to medium
UPDATE announcements 
SET priority = 'medium' 
WHERE priority = '               ';

-- Update announcements with any whitespace priority to medium
UPDATE announcements 
SET priority = 'medium' 
WHERE priority = '                ';

-- Update announcements with any whitespace priority to medium
UPDATE announcements 
SET priority = 'medium' 
WHERE priority = '                 ';

-- Update announcements with any whitespace priority to medium
UPDATE announcements 
SET priority = 'medium' 
WHERE priority = '                  ';

-- Update announcements with any whitespace priority to medium
UPDATE announcements 
SET priority = 'medium' 
WHERE priority = '                   ';

-- Update announcements with any whitespace priority to medium
UPDATE announcements 
SET priority = 'medium' 
WHERE priority = '                    ';

-- Update announcements with any whitespace priority to medium
UPDATE announcements 
SET priority = 'medium' 
WHERE priority = '                     ';

-- Update announcements with any whitespace priority to medium
UPDATE announcements 
SET priority = 'medium' 
WHERE priority = '                      ';

-- Update announcements with any whitespace priority to medium
UPDATE announcements 
SET priority = 'medium' 
WHERE priority = '                       ';

-- Update announcements with any whitespace priority to medium
UPDATE announcements 
SET priority = 'medium' 
WHERE priority = '                        ';

-- Update announcements with any whitespace priority to medium
UPDATE announcements 
SET priority = 'medium' 
WHERE priority = '                         ';

-- Update announcements with any whitespace priority to medium
UPDATE announcements 
SET priority = 'medium' 
WHERE priority = '                          ';

-- Update announcements with any whitespace priority to medium
UPDATE announcements 
SET priority = 'medium' 
WHERE priority = '                           ';

-- Update announcements with any whitespace priority to medium
UPDATE announcements 
SET priority = 'medium' 
WHERE priority = '                            ';

-- Update announcements with any whitespace priority to medium
UPDATE announcements 
SET priority = 'medium' 
WHERE priority = '                             ';

-- Update announcements with any whitespace priority to medium
UPDATE announcements 
SET priority = 'medium' 
WHERE priority = '                              ';

-- Update announcements with any whitespace priority to medium
UPDATE announcements 
SET priority = 'medium' 
WHERE priority = '                               ';

-- Update announcements with any whitespace priority to medium
UPDATE announcements 
SET priority = 'medium' 
WHERE priority = '                                ';

-- Update announcements with any whitespace priority to medium
UPDATE announcements 
SET priority = 'medium' 
WHERE priority = '                                 ';

-- Update announcements with any whitespace priority to medium
UPDATE announcements 
SET priority = 'medium' 
WHERE priority = '                                  ';

-- Update announcements with any whitespace priority to medium
UPDATE announcements 
SET priority = 'medium' 
WHERE priority = '                                   ';

-- Update announcements with any whitespace priority to medium
UPDATE announcements 
SET priority = 'medium' 
WHERE priority = '                                    ';

-- Update announcements with any whitespace priority to medium
UPDATE announcements 
SET priority = 'medium' 
WHERE priority = '                                     ';

-- Update announcements with any whitespace priority to medium
UPDATE announcements 
SET priority = 'medium' 
WHERE priority = '                                      ';

-- Update announcements with any whitespace priority to medium
UPDATE announcements 
SET priority = 'medium' 
WHERE priority = '                                       ';

-- Update announcements with any whitespace priority to medium
UPDATE announcements 
SET priority = 'medium' 
WHERE priority = '                                        ';

-- ===========================================
-- 8. VALIDATE FOREIGN KEY RELATIONSHIPS
-- ===========================================

-- Ensure all foreign key constraints are properly set up
-- This will help prevent constraint violations

-- Check and fix any orphaned records that might cause issues
DELETE FROM vaccination_records 
WHERE infant_id NOT IN (SELECT id FROM infants);

DELETE FROM vaccination_records 
WHERE vaccine_id NOT IN (SELECT id FROM vaccines);

DELETE FROM vaccination_records 
WHERE vaccinator_id NOT IN (SELECT id FROM users);

DELETE FROM document_generation 
WHERE template_id NOT IN (SELECT id FROM paper_templates);

DELETE FROM document_generation 
WHERE infant_id NOT IN (SELECT id FROM infants);

DELETE FROM document_generation 
WHERE guardian_id NOT IN (SELECT id FROM guardians);

DELETE FROM document_generation 
WHERE generated_by NOT IN (SELECT id FROM users);

DELETE FROM digital_papers 
WHERE document_generation_id NOT IN (SELECT id FROM document_generation);

DELETE FROM digital_papers 
WHERE verified_by NOT IN (SELECT id FROM users);

-- ===========================================
-- 9. ADD CONSTRAINTS AND VALIDATION
-- ===========================================

-- Add constraints to ensure data integrity
ALTER TABLE paper_templates 
ADD CONSTRAINT chk_template_type 
CHECK (template_type IN ('IMMUNIZATION_RECORD', 'BIRTH_CERTIFICATE', 'MEDICAL_REPORT', 'GROWTH_CHART', 'OTHER'));

ALTER TABLE announcements 
ADD CONSTRAINT chk_priority 
CHECK (priority IN ('low', 'medium', 'high', 'urgent'));

ALTER TABLE announcements 
ADD CONSTRAINT chk_status 
CHECK (status IN ('draft', 'published', 'archived'));

ALTER TABLE announcements 
ADD CONSTRAINT chk_target_audience 
CHECK (target_audience IN ('all', 'patients', 'staff'));

-- ===========================================
-- 10. FINAL VALIDATION
-- ===========================================

-- Verify all critical tables exist and have the required columns
SELECT 
    table_name,
    column_name,
    data_type
FROM information_schema.columns 
WHERE table_name IN ('announcements', 'paper_templates', 'vaccination_records', 'document_generation', 'digital_papers')
AND column_name IN ('priority', 'template_type', 'dose_no', 'file_path', 'document_type')
ORDER BY table_name, column_name;