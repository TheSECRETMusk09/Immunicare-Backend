const db = require('./db');

async function setupDigitalPapers() {
  try {
    console.log('Setting up Digital Papers System...');

    // Create tables
    const createTablesQuery = `
      -- Paper templates configuration table
      CREATE TABLE IF NOT EXISTS paper_templates (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        template_type VARCHAR(50) NOT NULL,
        fields JSONB NOT NULL,
        validation_rules JSONB,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        created_by INTEGER REFERENCES users(id),
        updated_by INTEGER REFERENCES users(id)
      );

      -- Document downloads tracking table
      CREATE TABLE IF NOT EXISTS document_downloads (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        infant_id INTEGER REFERENCES infants(id),
        template_id INTEGER REFERENCES paper_templates(id),
        download_type VARCHAR(50) DEFAULT 'PDF',
        download_date TIMESTAMP DEFAULT NOW(),
        file_path VARCHAR(500),
        download_status VARCHAR(20) DEFAULT 'COMPLETED',
        ip_address INET,
        user_agent TEXT,
        download_reason VARCHAR(100),
        file_size INTEGER,
        expires_at TIMESTAMP
      );

      -- Paper completion status tracking table
      CREATE TABLE IF NOT EXISTS paper_completion_status (
        id SERIAL PRIMARY KEY,
        infant_id INTEGER REFERENCES infants(id),
        template_id INTEGER REFERENCES paper_templates(id),
        completion_status VARCHAR(20) DEFAULT 'PENDING',
        last_updated TIMESTAMP DEFAULT NOW(),
        completed_by INTEGER REFERENCES users(id),
        notes TEXT,
        required_fields_count INTEGER DEFAULT 0,
        completed_fields_count INTEGER DEFAULT 0,
        completion_percentage INTEGER DEFAULT 0
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
        created_at TIMESTAMP DEFAULT NOW()
      );

      -- Document templates library table
      CREATE TABLE IF NOT EXISTS document_templates_library (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        template_type VARCHAR(50) NOT NULL,
        template_content JSONB NOT NULL,
        version VARCHAR(20) DEFAULT '1.0',
        is_public BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        created_by INTEGER REFERENCES users(id)
      );

      -- Document generation logs table
      CREATE TABLE IF NOT EXISTS document_generation_logs (
        id SERIAL PRIMARY KEY,
        template_id INTEGER REFERENCES paper_templates(id),
        infant_id INTEGER REFERENCES infants(id),
        user_id INTEGER REFERENCES users(id),
        generation_type VARCHAR(50) NOT NULL,
        generation_date TIMESTAMP DEFAULT NOW(),
        status VARCHAR(20) DEFAULT 'SUCCESS',
        error_message TEXT,
        generated_files JSONB,
        processing_time INTEGER,
        data_source JSONB
      );

      -- Indexes for performance optimization
      CREATE INDEX IF NOT EXISTS idx_paper_templates_type ON paper_templates(template_type);
      CREATE INDEX IF NOT EXISTS idx_paper_templates_active ON paper_templates(is_active);
      CREATE INDEX IF NOT EXISTS idx_document_downloads_user ON document_downloads(user_id);
      CREATE INDEX IF NOT EXISTS idx_document_downloads_infant ON document_downloads(infant_id);
      CREATE INDEX IF NOT EXISTS idx_document_downloads_template ON document_downloads(template_id);
      CREATE INDEX IF NOT EXISTS idx_document_downloads_date ON document_downloads(download_date);
      CREATE INDEX IF NOT EXISTS idx_completion_status_infant ON paper_completion_status(infant_id);
      CREATE INDEX IF NOT EXISTS idx_completion_status_template ON paper_completion_status(template_id);
      CREATE INDEX IF NOT EXISTS idx_completion_status_status ON paper_completion_status(completion_status);
    `;

    await db.query(createTablesQuery);
    console.log('✓ Tables created successfully');

    // Create triggers
    const createTriggersQuery = `
      -- Function to update updated_at timestamp
      CREATE OR REPLACE FUNCTION update_paper_templates_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
          NEW.updated_at = NOW();
          RETURN NEW;
      END;
      $$ language 'plpgsql';

      -- Trigger for paper_templates
      DROP TRIGGER IF EXISTS update_paper_templates_updated_at ON paper_templates;
      CREATE TRIGGER update_paper_templates_updated_at 
          BEFORE UPDATE ON paper_templates 
          FOR EACH ROW 
          EXECUTE FUNCTION update_paper_templates_updated_at();
    `;

    await db.query(createTriggersQuery);
    console.log('✓ Triggers created successfully');

    // Insert sample data
    const sampleDataQuery = `
      -- Insert sample templates if they don't exist
      INSERT INTO paper_templates (name, description, template_type, fields, validation_rules, created_by)
      VALUES 
        ('Vaccine Schedule Booklet', 'WHO-standard vaccination schedule for infants', 'VACCINE_SCHEDULE', 
         '[{"field": "infant_name", "label": "Child Name", "source": "infants.full_name", "required": true}, {"field": "dob", "label": "Date of Birth", "source": "infants.dob", "required": true}, {"field": "vaccines", "label": "Vaccination Schedule", "source": "vaccination_schedules", "required": true}]', 
         '{"required_fields": ["infant_name", "dob", "vaccines"]}', 1),
        ('Immunization Record Booklet', 'Complete immunization record for tracking vaccinations', 'IMMUNIZATION_RECORD',
         '[{"field": "infant_info", "label": "Infant Information", "source": "infants", "required": true}, {"field": "vaccination_history", "label": "Vaccination History", "source": "vaccination_records", "required": true}, {"field": "guardian_info", "label": "Guardian Information", "source": "guardians", "required": true}]',
         '{"required_fields": ["infant_info", "vaccination_history", "guardian_info"]}', 1),
        ('Vaccine Inventory Logbook', 'Stock monitoring logbook for vaccines', 'INVENTORY_LOGBOOK',
         '[{"field": "inventory_data", "label": "Inventory Data", "source": "inventory_items", "required": true}, {"field": "transactions", "label": "Stock Transactions", "source": "inventory_transactions", "required": true}, {"field": "alerts", "label": "Stock Alerts", "source": "stock_alerts", "required": false}]',
         '{"required_fields": ["inventory_data", "transactions"]}', 1),
        ('Growth Chart', 'Infant growth monitoring chart', 'GROWTH_CHART',
         '[{"field": "growth_records", "label": "Growth Records", "source": "growth_records", "required": true}, {"field": "percentiles", "label": "Growth Percentiles", "source": "calculated_percentiles", "required": true}, {"field": "alerts", "label": "Growth Alerts", "source": "growth_alerts", "required": false}]',
         '{"required_fields": ["growth_records", "percentiles"]}', 1)
      ON CONFLICT DO NOTHING;
    `;

    await db.query(sampleDataQuery);
    console.log('✓ Sample data inserted successfully');

    // Create documents directory
    const fs = require('fs');
    const path = require('path');
    const documentsDir = path.join(__dirname, 'documents');

    if (!fs.existsSync(documentsDir)) {
      fs.mkdirSync(documentsDir, { recursive: true });
      console.log('✓ Documents directory created');
    }

    console.log('\n🎉 Digital Papers System setup completed successfully!');
    console.log('\nNext steps:');
    console.log('1. Restart your backend server');
    console.log('2. Access the new Digital Papers section in the admin dashboard');
    console.log('3. Configure document templates as needed');
    console.log('4. Test document generation and download functionality');

  } catch (error) {
    console.error('❌ Error setting up Digital Papers System:', error);
    process.exit(1);
  }
}

// Run setup if called directly
if (require.main === module) {
  setupDigitalPapers();
}

module.exports = { setupDigitalPapers };