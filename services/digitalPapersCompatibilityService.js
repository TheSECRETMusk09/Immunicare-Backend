const pool = require('../db');
const { resetSchemaCompatibilityCache } = require('../utils/queryCompatibility');

let ensureDigitalPapersCompatibilityPromise = null;

const ensureDigitalPapersCompatibility = async () => {
  if (!ensureDigitalPapersCompatibilityPromise) {
    ensureDigitalPapersCompatibilityPromise = pool.query(`
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

      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS first_name VARCHAR(255),
        ADD COLUMN IF NOT EXISTS last_name VARCHAR(255);

      ALTER TABLE document_generation
        ADD COLUMN IF NOT EXISTS title VARCHAR(255),
        ADD COLUMN IF NOT EXISTS notes TEXT,
        ADD COLUMN IF NOT EXISTS tags JSONB;

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
    `)
      .then(() => {
        resetSchemaCompatibilityCache();
      })
      .catch((error) => {
        ensureDigitalPapersCompatibilityPromise = null;
        throw error;
      });
  }

  return ensureDigitalPapersCompatibilityPromise;
};

module.exports = {
  ensureDigitalPapersCompatibility,
};
