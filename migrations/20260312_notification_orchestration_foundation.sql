-- Notification orchestration foundation for canonical event contract + idempotent fan-out
-- Backend-only phase baseline migration

DO $$
BEGIN
  IF to_regclass('public.notifications') IS NULL THEN
    RAISE EXCEPTION 'Required table public.notifications is missing';
  END IF;

  IF to_regclass('public.notification_logs') IS NULL THEN
    RAISE EXCEPTION 'Required table public.notification_logs is missing';
  END IF;
END $$;

-- ---------- notifications table hardening ----------

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS event_type VARCHAR(100),
  ADD COLUMN IF NOT EXISTS trace_id VARCHAR(128),
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(255),
  ADD COLUMN IF NOT EXISTS channel_status JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS callback_status JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS recipient_guardian_id INTEGER,
  ADD COLUMN IF NOT EXISTS recipient_user_id INTEGER,
  ADD COLUMN IF NOT EXISTS recipient_admin_id INTEGER,
  ADD COLUMN IF NOT EXISTS orchestration_version VARCHAR(32) DEFAULT 'v1';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_notifications_channel_status_jsonb_object'
      AND conrelid = to_regclass('public.notifications')
  ) THEN
    ALTER TABLE notifications
      ADD CONSTRAINT chk_notifications_channel_status_jsonb_object
      CHECK (channel_status IS NULL OR jsonb_typeof(channel_status) = 'object');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_notifications_callback_status_jsonb_object'
      AND conrelid = to_regclass('public.notifications')
  ) THEN
    ALTER TABLE notifications
      ADD CONSTRAINT chk_notifications_callback_status_jsonb_object
      CHECK (callback_status IS NULL OR jsonb_typeof(callback_status) = 'object');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_notifications_event_type_non_empty'
      AND conrelid = to_regclass('public.notifications')
  ) THEN
    ALTER TABLE notifications
      ADD CONSTRAINT chk_notifications_event_type_non_empty
      CHECK (event_type IS NULL OR LENGTH(TRIM(event_type)) > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_notifications_idempotency_key_non_empty'
      AND conrelid = to_regclass('public.notifications')
  ) THEN
    ALTER TABLE notifications
      ADD CONSTRAINT chk_notifications_idempotency_key_non_empty
      CHECK (idempotency_key IS NULL OR LENGTH(TRIM(idempotency_key)) > 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_notifications_event_type
  ON notifications(event_type);

CREATE INDEX IF NOT EXISTS idx_notifications_trace_id
  ON notifications(trace_id)
  WHERE trace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_idempotency_key
  ON notifications(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_recipient_guardian_id
  ON notifications(recipient_guardian_id)
  WHERE recipient_guardian_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_recipient_user_id
  ON notifications(recipient_user_id)
  WHERE recipient_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_recipient_admin_id
  ON notifications(recipient_admin_id)
  WHERE recipient_admin_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_idempotency_key
  ON notifications(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ---------- notification_logs table hardening ----------

ALTER TABLE notification_logs
  ADD COLUMN IF NOT EXISTS trace_id VARCHAR(128),
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(255),
  ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_retries INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS callback_received_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS callback_payload JSONB,
  ADD COLUMN IF NOT EXISTS callback_status VARCHAR(32),
  ADD COLUMN IF NOT EXISTS correlation_id VARCHAR(128),
  ADD COLUMN IF NOT EXISTS provider_name VARCHAR(64),
  ADD COLUMN IF NOT EXISTS dedupe_key VARCHAR(255),
  ADD COLUMN IF NOT EXISTS queue_name VARCHAR(64),
  ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS processing_finished_at TIMESTAMP WITH TIME ZONE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_notification_logs_retry_count_non_negative'
      AND conrelid = to_regclass('public.notification_logs')
  ) THEN
    ALTER TABLE notification_logs
      ADD CONSTRAINT chk_notification_logs_retry_count_non_negative
      CHECK (retry_count >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_notification_logs_max_retries_non_negative'
      AND conrelid = to_regclass('public.notification_logs')
  ) THEN
    ALTER TABLE notification_logs
      ADD CONSTRAINT chk_notification_logs_max_retries_non_negative
      CHECK (max_retries >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_notification_logs_callback_payload_jsonb_object'
      AND conrelid = to_regclass('public.notification_logs')
  ) THEN
    ALTER TABLE notification_logs
      ADD CONSTRAINT chk_notification_logs_callback_payload_jsonb_object
      CHECK (callback_payload IS NULL OR jsonb_typeof(callback_payload) = 'object');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_notification_logs_trace_id
  ON notification_logs(trace_id)
  WHERE trace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notification_logs_idempotency_key
  ON notification_logs(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notification_logs_next_retry_at
  ON notification_logs(next_retry_at)
  WHERE next_retry_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notification_logs_callback_status
  ON notification_logs(callback_status)
  WHERE callback_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notification_logs_correlation_id
  ON notification_logs(correlation_id)
  WHERE correlation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notification_logs_dedupe_key
  ON notification_logs(dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_logs_dedupe_key
  ON notification_logs(dedupe_key)
  WHERE dedupe_key IS NOT NULL;

COMMENT ON COLUMN notifications.event_type IS
  'Canonical notification event type from backend orchestration contract.';

COMMENT ON COLUMN notifications.trace_id IS
  'Distributed trace identifier for cross-channel notification correlation.';

COMMENT ON COLUMN notifications.idempotency_key IS
  'Deterministic idempotency key used to suppress duplicate sends.';

COMMENT ON COLUMN notifications.channel_status IS
  'Per-channel status object tracking sms/email/in-app lifecycle.';

COMMENT ON COLUMN notification_logs.trace_id IS
  'Trace identifier propagated from orchestrated notification event.';

COMMENT ON COLUMN notification_logs.idempotency_key IS
  'Idempotency key for replay-safe notification processing.';

COMMENT ON COLUMN notification_logs.callback_payload IS
  'Normalized delivery callback payload from provider webhooks.';

