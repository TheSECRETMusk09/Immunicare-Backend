-- ============================================================================
-- B0 PRE-MIGRATION PLAYBOOK: PATIENT CONTROL NUMBER DISCOVERY + CANONICAL MERGE
-- ============================================================================
-- Purpose:
--   1) Discover duplicate infant identity groups.
--   2) Compute weighted canonical scoring with deterministic tie-breakers.
--   3) Stage merge mapping (winner + loser rows).
--   4) Snapshot and update dependent references to canonical patient IDs.
--   5) Soft-deactivate loser rows with rollback scaffolding.
--
-- Safety model:
--   - This script is idempotent for object creation.
--   - Execution mode is controlled by b0_control settings table.
--   - Dry-run mode (default) writes discovery/scoring only and performs no merges.
--
-- How to use:
--   -- 1) Run dry run (default)
--   --    psql -f backend/migrations/20260305_b0_pre_migration_patient_control_number_playbook.sql
--
--   -- 2) Review staged output tables:
--   --    migration_b0_duplicate_groups
--   --    migration_b0_candidate_scores
--   --    migration_b0_winners
--   --    migration_b0_merge_plan
--
--   -- 3) Enable merge execution:
--   --    UPDATE migration_b0_control SET execute_merge = true, prepared_by = 'your_name';
--   --    Re-run this script.
--
--   -- 4) Roll back merge (if needed):
--   --    SELECT migration_b0_rollback_merge(<run_id>);
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 0) Control + run metadata
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS migration_b0_control (
  id INTEGER PRIMARY KEY DEFAULT 1,
  execute_merge BOOLEAN NOT NULL DEFAULT false,
  prepared_by TEXT,
  notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT migration_b0_control_singleton_chk CHECK (id = 1)
);

INSERT INTO migration_b0_control (id, execute_merge)
VALUES (1, false)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS migration_b0_runs (
  run_id BIGSERIAL PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  execute_merge BOOLEAN NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  prepared_by TEXT,
  notes TEXT
);

-- ----------------------------------------------------------------------------
-- 1) Discovery: identity normalization + duplicate groups
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS migration_b0_identity_base (
  run_id BIGINT NOT NULL,
  patient_id INTEGER NOT NULL,
  guardian_id INTEGER,
  first_name_norm TEXT NOT NULL,
  last_name_norm TEXT NOT NULL,
  dob DATE NOT NULL,
  identity_key TEXT NOT NULL,
  control_number TEXT,
  is_active BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  PRIMARY KEY (run_id, patient_id)
);

CREATE INDEX IF NOT EXISTS idx_b0_identity_base_run_identity_key
  ON migration_b0_identity_base(run_id, identity_key);

CREATE TABLE IF NOT EXISTS migration_b0_duplicate_groups (
  run_id BIGINT NOT NULL,
  identity_key TEXT NOT NULL,
  group_size INTEGER NOT NULL,
  active_count INTEGER NOT NULL,
  patient_ids INTEGER[] NOT NULL,
  PRIMARY KEY (run_id, identity_key)
);

-- ----------------------------------------------------------------------------
-- 2) Weighted scoring + deterministic winner selection
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS migration_b0_candidate_scores (
  run_id BIGINT NOT NULL,
  identity_key TEXT NOT NULL,
  patient_id INTEGER NOT NULL,
  score INTEGER NOT NULL,
  has_valid_inf_control BOOLEAN NOT NULL,
  dependency_count INTEGER NOT NULL,
  completed_immunization_count INTEGER NOT NULL,
  appointment_count INTEGER NOT NULL,
  growth_count INTEGER NOT NULL,
  health_record_count INTEGER NOT NULL,
  document_generation_count INTEGER NOT NULL,
  notification_count INTEGER NOT NULL,
  created_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL,
  tie_break_created_at TIMESTAMPTZ,
  tie_break_patient_id INTEGER NOT NULL,
  PRIMARY KEY (run_id, identity_key, patient_id)
);

CREATE INDEX IF NOT EXISTS idx_b0_candidate_scores_rank
  ON migration_b0_candidate_scores(run_id, identity_key, score DESC, has_valid_inf_control DESC, dependency_count DESC, tie_break_created_at ASC, tie_break_patient_id ASC);

CREATE TABLE IF NOT EXISTS migration_b0_winners (
  run_id BIGINT NOT NULL,
  identity_key TEXT NOT NULL,
  winner_patient_id INTEGER NOT NULL,
  winner_score INTEGER NOT NULL,
  reason TEXT NOT NULL,
  PRIMARY KEY (run_id, identity_key)
);

CREATE TABLE IF NOT EXISTS migration_b0_merge_plan (
  run_id BIGINT NOT NULL,
  identity_key TEXT NOT NULL,
  winner_patient_id INTEGER NOT NULL,
  loser_patient_id INTEGER NOT NULL,
  loser_score INTEGER NOT NULL,
  PRIMARY KEY (run_id, loser_patient_id)
);

-- ----------------------------------------------------------------------------
-- 3) Snapshot + rollback scaffolding
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS migration_b0_dependency_ref_backup (
  run_id BIGINT NOT NULL,
  table_name TEXT NOT NULL,
  pk_column TEXT NOT NULL,
  pk_value BIGINT NOT NULL,
  ref_column TEXT NOT NULL,
  old_patient_id INTEGER NOT NULL,
  new_patient_id INTEGER NOT NULL,
  PRIMARY KEY (run_id, table_name, pk_column, pk_value, ref_column)
);

CREATE INDEX IF NOT EXISTS idx_b0_dependency_ref_backup_run
  ON migration_b0_dependency_ref_backup(run_id);

CREATE TABLE IF NOT EXISTS migration_b0_patient_state_backup (
  run_id BIGINT NOT NULL,
  patient_id INTEGER NOT NULL,
  is_active BOOLEAN,
  control_number TEXT,
  updated_at TIMESTAMPTZ,
  PRIMARY KEY (run_id, patient_id)
);

CREATE TABLE IF NOT EXISTS migration_b0_results (
  run_id BIGINT PRIMARY KEY,
  duplicate_group_count INTEGER NOT NULL,
  merge_pair_count INTEGER NOT NULL,
  dependency_rows_repointed INTEGER NOT NULL,
  patients_soft_deactivated INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 4) Rollback helper function
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION migration_b0_rollback_merge(p_run_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_updates BIGINT := 0;
  v_restored_patients BIGINT := 0;
  v_row RECORD;
BEGIN
  -- Revert dependent references in reverse deterministic order.
  FOR v_row IN
    SELECT table_name, pk_column, pk_value, ref_column, old_patient_id
    FROM migration_b0_dependency_ref_backup
    WHERE run_id = p_run_id
    ORDER BY table_name DESC, pk_value DESC
  LOOP
    EXECUTE format(
      'UPDATE %I SET %I = $1 WHERE %I = $2',
      v_row.table_name,
      v_row.ref_column,
      v_row.pk_column
    )
    USING v_row.old_patient_id, v_row.pk_value;
    v_updates := v_updates + 1;
  END LOOP;

  -- Restore patient states.
  UPDATE patients p
  SET
    is_active = b.is_active,
    control_number = b.control_number,
    updated_at = COALESCE(b.updated_at, p.updated_at)
  FROM migration_b0_patient_state_backup b
  WHERE b.run_id = p_run_id
    AND p.id = b.patient_id;

  GET DIAGNOSTICS v_restored_patients = ROW_COUNT;

  UPDATE migration_b0_runs
  SET status = 'rolled_back', completed_at = NOW()
  WHERE run_id = p_run_id;

  RETURN jsonb_build_object(
    'run_id', p_run_id,
    'reference_rows_reverted', v_updates,
    'patients_restored', v_restored_patients,
    'status', 'rolled_back'
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 5) Main execution body
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_execute_merge BOOLEAN;
  v_prepared_by TEXT;
  v_notes TEXT;
  v_run_id BIGINT;
  v_duplicate_group_count INTEGER := 0;
  v_merge_pair_count INTEGER := 0;
  v_dependency_rows_repointed INTEGER := 0;
  v_patients_soft_deactivated INTEGER := 0;
BEGIN
  SELECT execute_merge, prepared_by, notes
  INTO v_execute_merge, v_prepared_by, v_notes
  FROM migration_b0_control
  WHERE id = 1;

  INSERT INTO migration_b0_runs (execute_merge, prepared_by, notes)
  VALUES (COALESCE(v_execute_merge, false), v_prepared_by, v_notes)
  RETURNING run_id INTO v_run_id;

  -- Build normalized identity base.
  INSERT INTO migration_b0_identity_base (
    run_id,
    patient_id,
    guardian_id,
    first_name_norm,
    last_name_norm,
    dob,
    identity_key,
    control_number,
    is_active,
    created_at,
    updated_at
  )
  SELECT
    v_run_id,
    p.id,
    p.guardian_id,
    LOWER(REGEXP_REPLACE(TRIM(COALESCE(p.first_name, '')), '\s+', ' ', 'g')) AS first_name_norm,
    LOWER(REGEXP_REPLACE(TRIM(COALESCE(p.last_name, '')), '\s+', ' ', 'g')) AS last_name_norm,
    p.dob,
    CONCAT_WS(
      '::',
      COALESCE(p.guardian_id::TEXT, 'noguardian'),
      LOWER(REGEXP_REPLACE(TRIM(COALESCE(p.first_name, '')), '\s+', ' ', 'g')),
      LOWER(REGEXP_REPLACE(TRIM(COALESCE(p.last_name, '')), '\s+', ' ', 'g')),
      TO_CHAR(p.dob, 'YYYY-MM-DD')
    ) AS identity_key,
    UPPER(TRIM(COALESCE(p.control_number, ''))),
    COALESCE(p.is_active, false),
    p.created_at,
    p.updated_at
  FROM patients p
  WHERE p.dob IS NOT NULL
    AND TRIM(COALESCE(p.first_name, '')) <> ''
    AND TRIM(COALESCE(p.last_name, '')) <> '';

  -- Duplicate groups discovery.
  INSERT INTO migration_b0_duplicate_groups (run_id, identity_key, group_size, active_count, patient_ids)
  SELECT
    v_run_id,
    b.identity_key,
    COUNT(*)::INTEGER AS group_size,
    COUNT(*) FILTER (WHERE b.is_active)::INTEGER AS active_count,
    ARRAY_AGG(b.patient_id ORDER BY b.created_at ASC NULLS LAST, b.patient_id ASC) AS patient_ids
  FROM migration_b0_identity_base b
  WHERE b.run_id = v_run_id
  GROUP BY b.identity_key
  HAVING COUNT(*) > 1;

  SELECT COUNT(*)::INTEGER
  INTO v_duplicate_group_count
  FROM migration_b0_duplicate_groups
  WHERE run_id = v_run_id;

  -- Score candidates in duplicate groups.
  INSERT INTO migration_b0_candidate_scores (
    run_id,
    identity_key,
    patient_id,
    score,
    has_valid_inf_control,
    dependency_count,
    completed_immunization_count,
    appointment_count,
    growth_count,
    health_record_count,
    document_generation_count,
    notification_count,
    created_at,
    is_active,
    tie_break_created_at,
    tie_break_patient_id
  )
  WITH dup AS (
    SELECT identity_key
    FROM migration_b0_duplicate_groups
    WHERE run_id = v_run_id
  ),
  dep AS (
    SELECT
      b.patient_id,
      COUNT(*) FILTER (WHERE ir.id IS NOT NULL) AS completed_immunization_count,
      COUNT(*) FILTER (WHERE a.id IS NOT NULL) AS appointment_count,
      COUNT(*) FILTER (WHERE pg.id IS NOT NULL) AS growth_count,
      COUNT(*) FILTER (WHERE hr.id IS NOT NULL) AS health_record_count,
      COUNT(*) FILTER (WHERE dg.id IS NOT NULL) AS document_generation_count,
      COUNT(*) FILTER (WHERE n.id IS NOT NULL) AS notification_count
    FROM migration_b0_identity_base b
    JOIN dup d ON d.identity_key = b.identity_key
    LEFT JOIN immunization_records ir
      ON ir.patient_id = b.patient_id
      AND COALESCE(ir.is_active, true)
      AND COALESCE(ir.status, 'completed') IN ('completed', 'attended')
    LEFT JOIN appointments a
      ON a.infant_id = b.patient_id
      AND COALESCE(a.is_active, true)
    LEFT JOIN patient_growth pg
      ON pg.patient_id = b.patient_id
      AND COALESCE(pg.is_active, true)
    LEFT JOIN health_records hr
      ON hr.patient_id = b.patient_id
      AND COALESCE(hr.is_active, true)
    LEFT JOIN document_generation dg
      ON dg.patient_id = b.patient_id
    LEFT JOIN notifications n
      ON n.related_entity_type = 'patient'
      AND n.related_entity_id = b.patient_id
    WHERE b.run_id = v_run_id
    GROUP BY b.patient_id
  )
  SELECT
    v_run_id,
    b.identity_key,
    b.patient_id,
    (
      CASE WHEN b.is_active THEN 500 ELSE 0 END +
      CASE WHEN UPPER(TRIM(COALESCE(b.control_number, ''))) ~ '^INF-[0-9]{4}-[0-9]{6}$' THEN 300 ELSE 0 END +
      COALESCE(dep.completed_immunization_count, 0) * 50 +
      COALESCE(dep.appointment_count, 0) * 20 +
      COALESCE(dep.growth_count, 0) * 10 +
      COALESCE(dep.health_record_count, 0) * 10 +
      COALESCE(dep.document_generation_count, 0) * 5 +
      COALESCE(dep.notification_count, 0) * 1
    )::INTEGER AS score,
    (UPPER(TRIM(COALESCE(b.control_number, ''))) ~ '^INF-[0-9]{4}-[0-9]{6}$') AS has_valid_inf_control,
    (
      COALESCE(dep.completed_immunization_count, 0) +
      COALESCE(dep.appointment_count, 0) +
      COALESCE(dep.growth_count, 0) +
      COALESCE(dep.health_record_count, 0) +
      COALESCE(dep.document_generation_count, 0) +
      COALESCE(dep.notification_count, 0)
    )::INTEGER AS dependency_count,
    COALESCE(dep.completed_immunization_count, 0)::INTEGER,
    COALESCE(dep.appointment_count, 0)::INTEGER,
    COALESCE(dep.growth_count, 0)::INTEGER,
    COALESCE(dep.health_record_count, 0)::INTEGER,
    COALESCE(dep.document_generation_count, 0)::INTEGER,
    COALESCE(dep.notification_count, 0)::INTEGER,
    b.created_at,
    b.is_active,
    COALESCE(b.created_at, TO_TIMESTAMP(0)),
    b.patient_id
  FROM migration_b0_identity_base b
  JOIN dup d ON d.identity_key = b.identity_key
  LEFT JOIN dep ON dep.patient_id = b.patient_id
  WHERE b.run_id = v_run_id;

  -- Deterministic winners.
  INSERT INTO migration_b0_winners (run_id, identity_key, winner_patient_id, winner_score, reason)
  WITH ranked AS (
    SELECT
      s.*,
      ROW_NUMBER() OVER (
        PARTITION BY s.identity_key
        ORDER BY
          s.score DESC,
          s.has_valid_inf_control DESC,
          s.dependency_count DESC,
          s.tie_break_created_at ASC,
          s.tie_break_patient_id ASC
      ) AS rn
    FROM migration_b0_candidate_scores s
    WHERE s.run_id = v_run_id
  )
  SELECT
    v_run_id,
    r.identity_key,
    r.patient_id,
    r.score,
    'winner_by_score_then_inf_pattern_then_dependency_then_oldest_created_at_then_lowest_id'
  FROM ranked r
  WHERE r.rn = 1;

  -- Merge plan (losers mapped to winner).
  INSERT INTO migration_b0_merge_plan (run_id, identity_key, winner_patient_id, loser_patient_id, loser_score)
  SELECT
    v_run_id,
    s.identity_key,
    w.winner_patient_id,
    s.patient_id,
    s.score
  FROM migration_b0_candidate_scores s
  JOIN migration_b0_winners w
    ON w.run_id = s.run_id
   AND w.identity_key = s.identity_key
  WHERE s.run_id = v_run_id
    AND s.patient_id <> w.winner_patient_id;

  SELECT COUNT(*)::INTEGER
  INTO v_merge_pair_count
  FROM migration_b0_merge_plan
  WHERE run_id = v_run_id;

  -- Snapshot patient state for all involved records.
  INSERT INTO migration_b0_patient_state_backup (run_id, patient_id, is_active, control_number, updated_at)
  SELECT
    v_run_id,
    p.id,
    p.is_active,
    p.control_number,
    p.updated_at
  FROM patients p
  WHERE p.id IN (
    SELECT winner_patient_id FROM migration_b0_merge_plan WHERE run_id = v_run_id
    UNION
    SELECT loser_patient_id FROM migration_b0_merge_plan WHERE run_id = v_run_id
  )
  ON CONFLICT (run_id, patient_id) DO NOTHING;

  -- In dry-run, stop before mutating references.
  IF NOT COALESCE(v_execute_merge, false) THEN
    INSERT INTO migration_b0_results (
      run_id,
      duplicate_group_count,
      merge_pair_count,
      dependency_rows_repointed,
      patients_soft_deactivated
    ) VALUES (
      v_run_id,
      v_duplicate_group_count,
      v_merge_pair_count,
      0,
      0
    )
    ON CONFLICT (run_id) DO NOTHING;

    UPDATE migration_b0_runs
    SET status = 'dry_run_complete', completed_at = NOW()
    WHERE run_id = v_run_id;

    RAISE NOTICE 'B0 dry-run complete. run_id=% duplicate_groups=% merge_pairs=%', v_run_id, v_duplicate_group_count, v_merge_pair_count;
    RETURN;
  END IF;

  -- --------------------------------------------------------------------------
  -- Merge execution path
  -- --------------------------------------------------------------------------
  -- Backup + repoint dependent references.
  -- immunization_records.patient_id
  INSERT INTO migration_b0_dependency_ref_backup (run_id, table_name, pk_column, pk_value, ref_column, old_patient_id, new_patient_id)
  SELECT
    v_run_id,
    'immunization_records',
    'id',
    ir.id,
    'patient_id',
    ir.patient_id,
    mp.winner_patient_id
  FROM immunization_records ir
  JOIN migration_b0_merge_plan mp
    ON mp.run_id = v_run_id
   AND mp.loser_patient_id = ir.patient_id
  WHERE COALESCE(ir.is_active, true)
  ON CONFLICT DO NOTHING;

  UPDATE immunization_records ir
  SET
    patient_id = mp.winner_patient_id,
    updated_at = NOW()
  FROM migration_b0_merge_plan mp
  WHERE mp.run_id = v_run_id
    AND ir.patient_id = mp.loser_patient_id
    AND COALESCE(ir.is_active, true);

  GET DIAGNOSTICS v_dependency_rows_repointed = ROW_COUNT;

  -- appointments.infant_id
  INSERT INTO migration_b0_dependency_ref_backup (run_id, table_name, pk_column, pk_value, ref_column, old_patient_id, new_patient_id)
  SELECT
    v_run_id,
    'appointments',
    'id',
    a.id,
    'infant_id',
    a.infant_id,
    mp.winner_patient_id
  FROM appointments a
  JOIN migration_b0_merge_plan mp
    ON mp.run_id = v_run_id
   AND mp.loser_patient_id = a.infant_id
  WHERE COALESCE(a.is_active, true)
  ON CONFLICT DO NOTHING;

  UPDATE appointments a
  SET
    infant_id = mp.winner_patient_id,
    updated_at = NOW()
  FROM migration_b0_merge_plan mp
  WHERE mp.run_id = v_run_id
    AND a.infant_id = mp.loser_patient_id
    AND COALESCE(a.is_active, true);

  v_dependency_rows_repointed := v_dependency_rows_repointed + ROW_COUNT;

  -- patient_growth.patient_id
  INSERT INTO migration_b0_dependency_ref_backup (run_id, table_name, pk_column, pk_value, ref_column, old_patient_id, new_patient_id)
  SELECT
    v_run_id,
    'patient_growth',
    'id',
    pg.id,
    'patient_id',
    pg.patient_id,
    mp.winner_patient_id
  FROM patient_growth pg
  JOIN migration_b0_merge_plan mp
    ON mp.run_id = v_run_id
   AND mp.loser_patient_id = pg.patient_id
  WHERE COALESCE(pg.is_active, true)
  ON CONFLICT DO NOTHING;

  UPDATE patient_growth pg
  SET
    patient_id = mp.winner_patient_id,
    updated_at = NOW()
  FROM migration_b0_merge_plan mp
  WHERE mp.run_id = v_run_id
    AND pg.patient_id = mp.loser_patient_id
    AND COALESCE(pg.is_active, true);

  v_dependency_rows_repointed := v_dependency_rows_repointed + ROW_COUNT;

  -- health_records.patient_id
  INSERT INTO migration_b0_dependency_ref_backup (run_id, table_name, pk_column, pk_value, ref_column, old_patient_id, new_patient_id)
  SELECT
    v_run_id,
    'health_records',
    'id',
    hr.id,
    'patient_id',
    hr.patient_id,
    mp.winner_patient_id
  FROM health_records hr
  JOIN migration_b0_merge_plan mp
    ON mp.run_id = v_run_id
   AND mp.loser_patient_id = hr.patient_id
  WHERE COALESCE(hr.is_active, true)
  ON CONFLICT DO NOTHING;

  UPDATE health_records hr
  SET
    patient_id = mp.winner_patient_id,
    updated_at = NOW()
  FROM migration_b0_merge_plan mp
  WHERE mp.run_id = v_run_id
    AND hr.patient_id = mp.loser_patient_id
    AND COALESCE(hr.is_active, true);

  v_dependency_rows_repointed := v_dependency_rows_repointed + ROW_COUNT;

  -- document_generation.patient_id
  INSERT INTO migration_b0_dependency_ref_backup (run_id, table_name, pk_column, pk_value, ref_column, old_patient_id, new_patient_id)
  SELECT
    v_run_id,
    'document_generation',
    'id',
    dg.id,
    'patient_id',
    dg.patient_id,
    mp.winner_patient_id
  FROM document_generation dg
  JOIN migration_b0_merge_plan mp
    ON mp.run_id = v_run_id
   AND mp.loser_patient_id = dg.patient_id
  ON CONFLICT DO NOTHING;

  UPDATE document_generation dg
  SET
    patient_id = mp.winner_patient_id,
    updated_at = NOW()
  FROM migration_b0_merge_plan mp
  WHERE mp.run_id = v_run_id
    AND dg.patient_id = mp.loser_patient_id;

  v_dependency_rows_repointed := v_dependency_rows_repointed + ROW_COUNT;

  -- messages.patient_id
  INSERT INTO migration_b0_dependency_ref_backup (run_id, table_name, pk_column, pk_value, ref_column, old_patient_id, new_patient_id)
  SELECT
    v_run_id,
    'messages',
    'id',
    m.id,
    'patient_id',
    m.patient_id,
    mp.winner_patient_id
  FROM messages m
  JOIN migration_b0_merge_plan mp
    ON mp.run_id = v_run_id
   AND mp.loser_patient_id = m.patient_id
  ON CONFLICT DO NOTHING;

  UPDATE messages m
  SET
    patient_id = mp.winner_patient_id,
    updated_at = NOW()
  FROM migration_b0_merge_plan mp
  WHERE mp.run_id = v_run_id
    AND m.patient_id = mp.loser_patient_id;

  v_dependency_rows_repointed := v_dependency_rows_repointed + ROW_COUNT;

  -- adoption_documents.patient_id
  INSERT INTO migration_b0_dependency_ref_backup (run_id, table_name, pk_column, pk_value, ref_column, old_patient_id, new_patient_id)
  SELECT
    v_run_id,
    'adoption_documents',
    'id',
    ad.id,
    'patient_id',
    ad.patient_id,
    mp.winner_patient_id
  FROM adoption_documents ad
  JOIN migration_b0_merge_plan mp
    ON mp.run_id = v_run_id
   AND mp.loser_patient_id = ad.patient_id
  WHERE COALESCE(ad.is_active, true)
  ON CONFLICT DO NOTHING;

  UPDATE adoption_documents ad
  SET
    patient_id = mp.winner_patient_id,
    updated_at = NOW()
  FROM migration_b0_merge_plan mp
  WHERE mp.run_id = v_run_id
    AND ad.patient_id = mp.loser_patient_id
    AND COALESCE(ad.is_active, true);

  v_dependency_rows_repointed := v_dependency_rows_repointed + ROW_COUNT;

  -- paper_completion_status.patient_id
  INSERT INTO migration_b0_dependency_ref_backup (run_id, table_name, pk_column, pk_value, ref_column, old_patient_id, new_patient_id)
  SELECT
    v_run_id,
    'paper_completion_status',
    'id',
    pcs.id,
    'patient_id',
    pcs.patient_id,
    mp.winner_patient_id
  FROM paper_completion_status pcs
  JOIN migration_b0_merge_plan mp
    ON mp.run_id = v_run_id
   AND mp.loser_patient_id = pcs.patient_id
  ON CONFLICT DO NOTHING;

  UPDATE paper_completion_status pcs
  SET
    patient_id = mp.winner_patient_id,
    last_updated = NOW()
  FROM migration_b0_merge_plan mp
  WHERE mp.run_id = v_run_id
    AND pcs.patient_id = mp.loser_patient_id;

  v_dependency_rows_repointed := v_dependency_rows_repointed + ROW_COUNT;

  -- document_downloads.patient_id
  INSERT INTO migration_b0_dependency_ref_backup (run_id, table_name, pk_column, pk_value, ref_column, old_patient_id, new_patient_id)
  SELECT
    v_run_id,
    'document_downloads',
    'id',
    dd.id,
    'patient_id',
    dd.patient_id,
    mp.winner_patient_id
  FROM document_downloads dd
  JOIN migration_b0_merge_plan mp
    ON mp.run_id = v_run_id
   AND mp.loser_patient_id = dd.patient_id
  ON CONFLICT DO NOTHING;

  UPDATE document_downloads dd
  SET patient_id = mp.winner_patient_id
  FROM migration_b0_merge_plan mp
  WHERE mp.run_id = v_run_id
    AND dd.patient_id = mp.loser_patient_id;

  v_dependency_rows_repointed := v_dependency_rows_repointed + ROW_COUNT;

  -- document_generation_logs.patient_id
  INSERT INTO migration_b0_dependency_ref_backup (run_id, table_name, pk_column, pk_value, ref_column, old_patient_id, new_patient_id)
  SELECT
    v_run_id,
    'document_generation_logs',
    'id',
    dgl.id,
    'patient_id',
    dgl.patient_id,
    mp.winner_patient_id
  FROM document_generation_logs dgl
  JOIN migration_b0_merge_plan mp
    ON mp.run_id = v_run_id
   AND mp.loser_patient_id = dgl.patient_id
  ON CONFLICT DO NOTHING;

  UPDATE document_generation_logs dgl
  SET patient_id = mp.winner_patient_id
  FROM migration_b0_merge_plan mp
  WHERE mp.run_id = v_run_id
    AND dgl.patient_id = mp.loser_patient_id;

  v_dependency_rows_repointed := v_dependency_rows_repointed + ROW_COUNT;

  -- notifications related_entity_type='patient' mapping.
  INSERT INTO migration_b0_dependency_ref_backup (run_id, table_name, pk_column, pk_value, ref_column, old_patient_id, new_patient_id)
  SELECT
    v_run_id,
    'notifications',
    'id',
    n.id,
    'related_entity_id',
    n.related_entity_id,
    mp.winner_patient_id
  FROM notifications n
  JOIN migration_b0_merge_plan mp
    ON mp.run_id = v_run_id
   AND mp.loser_patient_id = n.related_entity_id
  WHERE n.related_entity_type = 'patient'
  ON CONFLICT DO NOTHING;

  UPDATE notifications n
  SET
    related_entity_id = mp.winner_patient_id,
    updated_at = NOW()
  FROM migration_b0_merge_plan mp
  WHERE mp.run_id = v_run_id
    AND n.related_entity_type = 'patient'
    AND n.related_entity_id = mp.loser_patient_id;

  v_dependency_rows_repointed := v_dependency_rows_repointed + ROW_COUNT;

  -- Ensure winners have canonical control_number (prefer winner existing valid INF; else earliest valid loser INF).
  WITH candidate_cn AS (
    SELECT
      mp.winner_patient_id,
      cn,
      ROW_NUMBER() OVER (
        PARTITION BY mp.winner_patient_id
        ORDER BY preferred_rank ASC, source_patient_id ASC
      ) AS rn
    FROM (
      SELECT
        mp.winner_patient_id,
        mp.winner_patient_id AS source_patient_id,
        p.control_number AS cn,
        1 AS preferred_rank
      FROM migration_b0_merge_plan mp
      JOIN patients p ON p.id = mp.winner_patient_id
      WHERE mp.run_id = v_run_id

      UNION ALL

      SELECT
        mp.winner_patient_id,
        mp.loser_patient_id AS source_patient_id,
        p.control_number AS cn,
        2 AS preferred_rank
      FROM migration_b0_merge_plan mp
      JOIN patients p ON p.id = mp.loser_patient_id
      WHERE mp.run_id = v_run_id
    ) src
    WHERE UPPER(TRIM(COALESCE(cn, ''))) ~ '^INF-[0-9]{4}-[0-9]{6}$'
  )
  UPDATE patients p
  SET
    control_number = cc.cn,
    updated_at = NOW()
  FROM candidate_cn cc
  WHERE cc.rn = 1
    AND p.id = cc.winner_patient_id
    AND (p.control_number IS DISTINCT FROM cc.cn);

  -- Soft deactivate losers.
  UPDATE patients p
  SET
    is_active = false,
    updated_at = NOW()
  FROM migration_b0_merge_plan mp
  WHERE mp.run_id = v_run_id
    AND p.id = mp.loser_patient_id
    AND p.is_active = true;

  GET DIAGNOSTICS v_patients_soft_deactivated = ROW_COUNT;

  INSERT INTO migration_b0_results (
    run_id,
    duplicate_group_count,
    merge_pair_count,
    dependency_rows_repointed,
    patients_soft_deactivated
  ) VALUES (
    v_run_id,
    v_duplicate_group_count,
    v_merge_pair_count,
    v_dependency_rows_repointed,
    v_patients_soft_deactivated
  )
  ON CONFLICT (run_id) DO NOTHING;

  UPDATE migration_b0_runs
  SET status = 'merge_complete', completed_at = NOW()
  WHERE run_id = v_run_id;

  RAISE NOTICE 'B0 merge complete. run_id=% duplicate_groups=% merge_pairs=% refs_repointed=% losers_deactivated=%',
    v_run_id, v_duplicate_group_count, v_merge_pair_count, v_dependency_rows_repointed, v_patients_soft_deactivated;
END;
$$;

COMMIT;

