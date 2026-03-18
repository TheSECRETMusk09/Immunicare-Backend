-- ============================================
-- Infant Documents Table Migration
-- Created: 2026-03-16
-- Purpose: Store uploaded documents for infant profiles (vaccination cards, birth certificates, medical records, images)
-- ============================================

-- Create infant_documents table
CREATE TABLE IF NOT EXISTS infant_documents (
    id SERIAL PRIMARY KEY,
    infant_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    document_type VARCHAR(50) NOT NULL CHECK (
        document_type IN (
            'vaccination_card',
            'birth_certificate',
            'medical_record',
            'image',
            'other'
        )
    ),
    file_path VARCHAR(500) NOT NULL,
    original_filename VARCHAR(255) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    file_size INTEGER NOT NULL,
    uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_infant_documents_infant_id ON infant_documents(infant_id);
CREATE INDEX IF NOT EXISTS idx_infant_documents_document_type ON infant_documents(document_type);
CREATE INDEX IF NOT EXISTS idx_infant_documents_uploaded_by ON infant_documents(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_infant_documents_is_active ON infant_documents(is_active);
CREATE INDEX IF NOT EXISTS idx_infant_documents_uploaded_at ON infant_documents(uploaded_at DESC);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Add trigger for updated_at
DROP TRIGGER IF EXISTS update_infant_documents_updated_at ON infant_documents;
CREATE TRIGGER update_infant_documents_updated_at
    BEFORE UPDATE ON infant_documents
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Add comments for documentation
COMMENT ON TABLE infant_documents IS 'Stores uploaded documents for infant profiles such as vaccination cards, birth certificates, medical records, and images';
COMMENT ON COLUMN infant_documents.infant_id IS 'Foreign key to patients table (infants)';
COMMENT ON COLUMN infant_documents.document_type IS 'Type of document: vaccination_card, birth_certificate, medical_record, image, other';
COMMENT ON COLUMN infant_documents.file_path IS 'Path to stored file in the uploads directory';
COMMENT ON COLUMN infant_documents.original_filename IS 'Original filename as uploaded by user';
COMMENT ON COLUMN infant_documents.mime_type IS 'MIME type of the file (e.g., image/jpeg, application/pdf)';
COMMENT ON COLUMN infant_documents.file_size IS 'Size of file in bytes';
COMMENT ON COLUMN infant_documents.uploaded_by IS 'User ID who uploaded the document';
COMMENT ON COLUMN infant_documents.uploaded_at IS 'Timestamp when document was uploaded';
COMMENT ON COLUMN infant_documents.description IS 'Optional description of the document';
COMMENT ON COLUMN infant_documents.is_active IS 'Soft delete flag - false indicates document is deleted';

-- Create uploads directory if it doesn't exist (handled by application)
-- Files will be stored in: uploads/infant_documents/

-- Grant appropriate permissions (adjust as needed for your setup)
-- GRANT SELECT, INSERT, UPDATE, DELETE ON infant_documents TO appropriate_roles;
-- GRANT USAGE, SELECT ON SEQUENCE infant_documents_id_seq TO appropriate_roles;
