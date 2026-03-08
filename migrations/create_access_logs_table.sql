-- Migration: Normalize access_logs table (legacy + current compatibility)
-- Date: 2026-02-25
-- Purpose: Ensure access_logs supports both old and new logging contracts

CREATE TABLE IF NOT EXISTS access_logs (
    id SERIAL PRIMARY KEY
);

ALTER TABLE access_logs ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE access_logs ADD COLUMN IF NOT EXISTS username VARCHAR(255);
ALTER TABLE access_logs ADD COLUMN IF NOT EXISTS role VARCHAR(50);
ALTER TABLE access_logs ADD COLUMN IF NOT EXISTS permission VARCHAR(100);
ALTER TABLE access_logs ADD COLUMN IF NOT EXISTS path TEXT;
ALTER TABLE access_logs ADD COLUMN IF NOT EXISTS method VARCHAR(20);

ALTER TABLE access_logs ADD COLUMN IF NOT EXISTS action VARCHAR(100);
ALTER TABLE access_logs ADD COLUMN IF NOT EXISTS resource_type VARCHAR(50);
ALTER TABLE access_logs ADD COLUMN IF NOT EXISTS resource_id INTEGER;
ALTER TABLE access_logs ADD COLUMN IF NOT EXISTS ip_address VARCHAR(45);
ALTER TABLE access_logs ADD COLUMN IF NOT EXISTS user_agent TEXT;
ALTER TABLE access_logs ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'success';
ALTER TABLE access_logs ADD COLUMN IF NOT EXISTS details JSONB;
ALTER TABLE access_logs ADD COLUMN IF NOT EXISTS accessed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE access_logs ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'access_logs' AND column_name = 'user_id'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_access_logs_user_id ON access_logs(user_id)';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'access_logs' AND column_name = 'created_at'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_access_logs_created_at ON access_logs(created_at)';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'access_logs' AND column_name = 'accessed_at'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_access_logs_accessed_at ON access_logs(accessed_at)';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'access_logs' AND column_name = 'action'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_access_logs_action ON access_logs(action)';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'access_logs' AND column_name = 'resource_type'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_access_logs_resource_type ON access_logs(resource_type)';
  END IF;
END $$;

COMMENT ON TABLE access_logs IS 'Stores user access and activity logs for auditing, RBAC, and security events';
