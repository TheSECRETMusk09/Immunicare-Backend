-- Digital Papers System Database Schema
-- Extensions to the existing Immunicare system

-- Paper templates configuration table
CREATE TABLE paper_templates (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  template_type VARCHAR(50) NOT NULL, -- 'VACCINE_SCHEDULE', 'IMMUNIZATION_RECORD', 'INVENTORY_LOGBOOK', 'GROWTH_CHART'
  fields JSONB NOT NULL, -- Field configuration with mapping to database fields
  validation_rules JSONB, -- Validation rules for required fields
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_by INTEGER REFERENCES users(id),
  updated_by INTEGER REFERENCES users(id)
);

-- Document downloads tracking table
CREATE TABLE document_downloads (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  infant_id INTEGER REFERENCES infants(id),
  template_id INTEGER REFERENCES paper_templates(id),
  download_type VARCHAR(50) DEFAULT 'PDF', -- 'PDF', 'EXCEL', 'PRINT'
  download_date TIMESTAMP DEFAULT NOW(),
  file_path VARCHAR(500),
  download_status VARCHAR(20) DEFAULT 'COMPLETED', -- 'PENDING', 'COMPLETED', 'FAILED'
  ip_address INET,
  user_agent TEXT,
  download_reason VARCHAR(100), -- 'USER_REQUEST', 'ADMIN_GENERATION', 'SCHEDULED'
  file_size INTEGER, -- File size in bytes
  expires_at TIMESTAMP -- Optional expiration for temporary files
);

-- Paper completion status tracking table
CREATE TABLE paper_completion_status (
  id SERIAL PRIMARY KEY,
  infant_id INTEGER REFERENCES infants(id),
  template_id INTEGER REFERENCES paper_templates(id),
  completion_status VARCHAR(20) DEFAULT 'PENDING', -- 'PENDING', 'COMPLETED', 'EXPIRED', 'NOT_APPLICABLE'
  last_updated TIMESTAMP DEFAULT NOW(),
  completed_by INTEGER REFERENCES users(id),
  notes TEXT,
  required_fields_count INTEGER DEFAULT 0,
  completed_fields_count INTEGER DEFAULT 0,
  completion_percentage INTEGER DEFAULT 0
);

-- Document access permissions table
CREATE TABLE document_access_permissions (
  id SERIAL PRIMARY KEY,
  template_id INTEGER REFERENCES paper_templates(id),
  role_id INTEGER REFERENCES roles(id),
  can_view BOOLEAN DEFAULT true,
  can_download BOOLEAN DEFAULT true,
  can_generate BOOLEAN DEFAULT true,
  can_share BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Document templates library table
CREATE TABLE document_templates_library (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  template_type VARCHAR(50) NOT NULL,
  template_content JSONB NOT NULL, -- Complete template structure
  version VARCHAR(20) DEFAULT '1.0',
  is_public BOOLEAN DEFAULT true, -- Whether template is available to all users
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_by INTEGER REFERENCES users(id)
);

-- Document generation logs table
CREATE TABLE document_generation_logs (
  id SERIAL PRIMARY KEY,
  template_id INTEGER REFERENCES paper_templates(id),
  infant_id INTEGER REFERENCES infants(id),
  user_id INTEGER REFERENCES users(id),
  generation_type VARCHAR(50) NOT NULL, -- 'MANUAL', 'AUTOMATIC', 'BATCH'
  generation_date TIMESTAMP DEFAULT NOW(),
  status VARCHAR(20) DEFAULT 'SUCCESS', -- 'SUCCESS', 'FAILED', 'PARTIAL'
  error_message TEXT,
  generated_files JSONB, -- Array of generated file paths and types
  processing_time INTEGER, -- Processing time in milliseconds
  data_source JSONB -- Source data used for generation
);

-- Indexes for performance optimization
CREATE INDEX idx_paper_templates_type ON paper_templates(template_type);
CREATE INDEX idx_paper_templates_active ON paper_templates(is_active);
CREATE INDEX idx_document_downloads_user ON document_downloads(user_id);
CREATE INDEX idx_document_downloads_infant ON document_downloads(infant_id);
CREATE INDEX idx_document_downloads_template ON document_downloads(template_id);
CREATE INDEX idx_document_downloads_date ON document_downloads(download_date);
CREATE INDEX idx_completion_status_infant ON paper_completion_status(infant_id);
CREATE INDEX idx_completion_status_template ON paper_completion_status(template_id);
CREATE INDEX idx_completion_status_status ON paper_completion_status(completion_status);

-- Triggers for automatic updates
CREATE OR REPLACE FUNCTION update_paper_templates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_paper_templates_updated_at 
    BEFORE UPDATE ON paper_templates 
    FOR EACH ROW 
    EXECUTE FUNCTION update_paper_templates_updated_at();

-- Sample data for initial templates
INSERT INTO paper_templates (name, description, template_type, fields, validation_rules, created_by) VALUES
('Vaccine Schedule Booklet', 'WHO-standard vaccination schedule for infants', 'VACCINE_SCHEDULE', 
'[
  {"field": "infant_name", "label": "Child Name", "source": "infants.full_name", "required": true},
  {"field": "dob", "label": "Date of Birth", "source": "infants.dob", "required": true},
  {"field": "vaccines", "label": "Vaccination Schedule", "source": "vaccination_schedules", "required": true}
]', 
'{"required_fields": ["infant_name", "dob", "vaccines"]}', 1),

('Immunization Record Booklet', 'Complete immunization record for tracking vaccinations', 'IMMUNIZATION_RECORD',
'[
  {"field": "infant_info", "label": "Infant Information", "source": "infants", "required": true},
  {"field": "vaccination_history", "label": "Vaccination History", "source": "vaccination_records", "required": true},
  {"field": "guardian_info", "label": "Guardian Information", "source": "guardians", "required": true}
]',
'{"required_fields": ["infant_info", "vaccination_history", "guardian_info"]}', 1),

('Vaccine Inventory Logbook', 'Stock monitoring logbook for vaccines', 'INVENTORY_LOGBOOK',
'[
  {"field": "inventory_data", "label": "Inventory Data", "source": "inventory_items", "required": true},
  {"field": "transactions", "label": "Stock Transactions", "source": "inventory_transactions", "required": true},
  {"field": "alerts", "label": "Stock Alerts", "source": "stock_alerts", "required": false}
]',
'{"required_fields": ["inventory_data", "transactions"]}', 1),

('Growth Chart', 'Infant growth monitoring chart', 'GROWTH_CHART',
'[
  {"field": "growth_records", "label": "Growth Records", "source": "growth_records", "required": true},
  {"field": "percentiles", "label": "Growth Percentiles", "source": "calculated_percentiles", "required": true},
  {"field": "alerts", "label": "Growth Alerts", "source": "growth_alerts", "required": false}
]',
'{"required_fields": ["growth_records", "percentiles"]}', 1);