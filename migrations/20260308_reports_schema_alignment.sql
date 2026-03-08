-- Align reports schema, enums, constraints, and indexes for Admin Dashboard Reports module.
-- Safe and idempotent migration for existing environments.

DO $$
DECLARE
  v_reports_table text;
  v_users_table text;
  v_file_format_type text;
BEGIN
  -- Resolve reports table candidates.
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'reports'
  ) THEN
    v_reports_table := 'reports';
  END IF;

  IF v_reports_table IS NULL THEN
    RAISE NOTICE 'No reports table found in current schema; skipping reports schema alignment.';
    RETURN;
  END IF;

  -- Resolve user/admin reference table (schema varies by deployment).
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'users'
  ) THEN
    v_users_table := 'users';
  ELSIF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'admin'
  ) THEN
    v_users_table := 'admin';
  END IF;

  -- Ensure report_type enum contains all admin report module types.
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'report_type') THEN
    EXECUTE '
      CREATE TYPE report_type AS ENUM (
        ''vaccination'',
        ''inventory'',
        ''appointment'',
        ''guardian'',
        ''infant'',
        ''system'',
        ''barangay'',
        ''compliance'',
        ''healthcenter'',
        ''consolidated'',
        ''custom''
      )
    ';
  ELSE
    IF NOT EXISTS (
      SELECT 1
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'report_type'
        AND e.enumlabel = 'barangay'
    ) THEN
      ALTER TYPE report_type ADD VALUE 'barangay';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'report_type'
        AND e.enumlabel = 'compliance'
    ) THEN
      ALTER TYPE report_type ADD VALUE 'compliance';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'report_type'
        AND e.enumlabel = 'healthcenter'
    ) THEN
      ALTER TYPE report_type ADD VALUE 'healthcenter';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'report_type'
        AND e.enumlabel = 'consolidated'
    ) THEN
      ALTER TYPE report_type ADD VALUE 'consolidated';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'report_type'
        AND e.enumlabel = 'custom'
    ) THEN
      ALTER TYPE report_type ADD VALUE 'custom';
    END IF;
  END IF;

  -- Ensure file_format enum exists and includes all allowed values.
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'file_format') THEN
    EXECUTE 'CREATE TYPE file_format AS ENUM (''pdf'', ''excel'', ''csv'', ''json'')';
  ELSE
    IF NOT EXISTS (
      SELECT 1
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'file_format'
        AND e.enumlabel = 'pdf'
    ) THEN
      ALTER TYPE file_format ADD VALUE 'pdf';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'file_format'
        AND e.enumlabel = 'excel'
    ) THEN
      ALTER TYPE file_format ADD VALUE 'excel';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'file_format'
        AND e.enumlabel = 'csv'
    ) THEN
      ALTER TYPE file_format ADD VALUE 'csv';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'file_format'
        AND e.enumlabel = 'json'
    ) THEN
      ALTER TYPE file_format ADD VALUE 'json';
    END IF;
  END IF;

  -- Ensure report_status enum exists.
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'report_status') THEN
    EXECUTE 'CREATE TYPE report_status AS ENUM (''generating'', ''completed'', ''failed'')';
  END IF;

  -- Add required columns if missing.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = v_reports_table
      AND column_name = 'title'
  ) THEN
    EXECUTE format('ALTER TABLE %I ADD COLUMN title VARCHAR(255)', v_reports_table);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = v_reports_table
      AND column_name = 'description'
  ) THEN
    EXECUTE format('ALTER TABLE %I ADD COLUMN description TEXT', v_reports_table);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = v_reports_table
      AND column_name = 'parameters'
  ) THEN
    EXECUTE format('ALTER TABLE %I ADD COLUMN parameters JSONB', v_reports_table);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = v_reports_table
      AND column_name = 'file_path'
  ) THEN
    EXECUTE format('ALTER TABLE %I ADD COLUMN file_path VARCHAR(500)', v_reports_table);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = v_reports_table
      AND column_name = 'file_format'
  ) THEN
    EXECUTE format('ALTER TABLE %I ADD COLUMN file_format file_format', v_reports_table);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = v_reports_table
      AND column_name = 'file_size'
  ) THEN
    EXECUTE format('ALTER TABLE %I ADD COLUMN file_size BIGINT NOT NULL DEFAULT 0', v_reports_table);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = v_reports_table
      AND column_name = 'status'
  ) THEN
    EXECUTE format(
      'ALTER TABLE %I ADD COLUMN status report_status NOT NULL DEFAULT ''generating''',
      v_reports_table
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = v_reports_table
      AND column_name = 'generated_by'
  ) THEN
    EXECUTE format('ALTER TABLE %I ADD COLUMN generated_by INTEGER', v_reports_table);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = v_reports_table
      AND column_name = 'date_generated'
  ) THEN
    EXECUTE format(
      'ALTER TABLE %I ADD COLUMN date_generated TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP',
      v_reports_table
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = v_reports_table
      AND column_name = 'download_count'
  ) THEN
    EXECUTE format(
      'ALTER TABLE %I ADD COLUMN download_count INTEGER NOT NULL DEFAULT 0',
      v_reports_table
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = v_reports_table
      AND column_name = 'error_message'
  ) THEN
    EXECUTE format('ALTER TABLE %I ADD COLUMN error_message TEXT', v_reports_table);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = v_reports_table
      AND column_name = 'is_active'
  ) THEN
    EXECUTE format(
      'ALTER TABLE %I ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE',
      v_reports_table
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = v_reports_table
      AND column_name = 'created_at'
  ) THEN
    EXECUTE format(
      'ALTER TABLE %I ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP',
      v_reports_table
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = v_reports_table
      AND column_name = 'updated_at'
  ) THEN
    EXECUTE format(
      'ALTER TABLE %I ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP',
      v_reports_table
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = v_reports_table
      AND column_name = 'expires_at'
  ) THEN
    EXECUTE format('ALTER TABLE %I ADD COLUMN expires_at TIMESTAMPTZ', v_reports_table);
  END IF;

  -- Ensure title fallback and constraints.
  EXECUTE format(
    'UPDATE %I
     SET title = COALESCE(NULLIF(title, ''''), INITCAP(COALESCE(type::text, ''report'')) || '' Report'')
     WHERE title IS NULL OR BTRIM(title) = ''''',
    v_reports_table
  );

  BEGIN
    EXECUTE format('ALTER TABLE %I ALTER COLUMN title SET NOT NULL', v_reports_table);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Could not enforce title NOT NULL on %.%', 'public', v_reports_table;
  END;

  BEGIN
    EXECUTE format('ALTER TABLE %I ALTER COLUMN parameters SET DEFAULT ''{}''::jsonb', v_reports_table);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Could not enforce parameters default on %.%', 'public', v_reports_table;
  END;

  EXECUTE format(
    'UPDATE %I SET parameters = ''{}''::jsonb WHERE parameters IS NULL',
    v_reports_table
  );

  -- Normalize file format aliases where present.
  EXECUTE format(
    'UPDATE %I
     SET file_format = ''excel''::file_format
     WHERE file_format::text = ''xlsx''',
    v_reports_table
  );

  -- Convert type, status, and file_format columns to canonical enums if needed.
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = v_reports_table
      AND column_name = 'type'
      AND udt_name <> 'report_type'
  ) THEN
    EXECUTE format(
      'ALTER TABLE %I
       ALTER COLUMN type TYPE report_type
       USING CASE
         WHEN type::text IN (
           ''vaccination'', ''inventory'', ''appointment'', ''guardian'', ''infant'',
           ''system'', ''barangay'', ''compliance'', ''healthcenter'', ''consolidated'', ''custom''
         ) THEN type::text::report_type
         ELSE ''custom''::report_type
       END',
      v_reports_table
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = v_reports_table
      AND column_name = 'status'
      AND udt_name <> 'report_status'
  ) THEN
    EXECUTE format(
      'ALTER TABLE %I
       ALTER COLUMN status TYPE report_status
       USING CASE
         WHEN LOWER(status::text) IN (''generating'', ''completed'', ''failed'')
           THEN LOWER(status::text)::report_status
         ELSE ''failed''::report_status
       END',
      v_reports_table
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = v_reports_table
      AND column_name = 'file_format'
      AND udt_name <> 'file_format'
  ) THEN
    EXECUTE format(
      'ALTER TABLE %I
       ALTER COLUMN file_format TYPE file_format
       USING CASE
         WHEN LOWER(file_format::text) = ''xlsx'' THEN ''excel''::file_format
         WHEN LOWER(file_format::text) IN (''pdf'', ''excel'', ''csv'', ''json'')
           THEN LOWER(file_format::text)::file_format
         ELSE NULL
       END',
      v_reports_table
    );
  END IF;

  -- Enforce file_size constraints.
  EXECUTE format(
    'UPDATE %I SET file_size = 0 WHERE file_size IS NULL OR file_size < 0',
    v_reports_table
  );

  BEGIN
    EXECUTE format('ALTER TABLE %I ALTER COLUMN file_size SET NOT NULL', v_reports_table);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Could not enforce file_size NOT NULL on %.%', 'public', v_reports_table;
  END;

  BEGIN
    EXECUTE format('ALTER TABLE %I ALTER COLUMN file_size SET DEFAULT 0', v_reports_table);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Could not enforce file_size default on %.%', 'public', v_reports_table;
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_reports_file_size_non_negative'
      AND conrelid = to_regclass(format('public.%I', v_reports_table))
  ) THEN
    EXECUTE format(
      'ALTER TABLE %I
       ADD CONSTRAINT chk_reports_file_size_non_negative CHECK (file_size >= 0)',
      v_reports_table
    );
  END IF;

  -- Enforce generated_by reference where possible.
  IF v_users_table IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'fk_reports_generated_by'
        AND conrelid = to_regclass(format('public.%I', v_reports_table))
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I
         ADD CONSTRAINT fk_reports_generated_by
         FOREIGN KEY (generated_by) REFERENCES %I(id)
         ON UPDATE CASCADE ON DELETE SET NULL',
        v_reports_table,
        v_users_table
      );
    END IF;
  ELSE
    RAISE NOTICE 'No users/admin table resolved; skipping reports.generated_by FK creation.';
  END IF;

  -- Ensure common report indexes exist.
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%s_type ON %I(type)', v_reports_table, v_reports_table);
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%s_status ON %I(status)', v_reports_table, v_reports_table);
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS idx_%s_generated_by ON %I(generated_by)',
    v_reports_table,
    v_reports_table
  );
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS idx_%s_date_generated ON %I(date_generated DESC)',
    v_reports_table,
    v_reports_table
  );
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS idx_%s_file_format ON %I(file_format)',
    v_reports_table,
    v_reports_table
  );
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS idx_%s_active ON %I(is_active)',
    v_reports_table,
    v_reports_table
  );
END $$;

