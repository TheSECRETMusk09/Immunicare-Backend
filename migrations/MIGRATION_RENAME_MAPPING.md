# Migration Rename Mapping (Old → New)

This log tracks the filename refactor from numeric-prefixed migration files to descriptive names.

## Mapping Table

| Old filename | New filename |
|---|---|
| `001_add_appointment_location.js` | `deprecated_add_appointment_location.js` |
| `002_add_password_guardian.js` | `add_guardian_force_password_change.js` |
| `003_alter_appointment_location.sql` | `deprecated_alter_appointment_location.sql` |
| `004_alter_guardian_password.sql` | `add_guardian_password_columns.sql` |
| `005_alter_location_photo.sql` | `deprecated_add_patient_photo_and_appointment_location.sql` |
| `006_alter_notification_role.sql` | `add_notification_target_role_and_guardian_link.sql` |
| `007_alter_password_reset.sql` | `add_user_force_password_change_columns.sql` |
| `008_create_audit_log.sql` | `deprecated_create_audit_logs_table.sql` |
| `009_create_infant_allergies_vaccine_waitlist.sql` | `create_infant_allergies_and_vaccine_waitlist.sql` |
| `010_create_message_conversation.sql` | `deprecated_create_message_conversations.sql` |
| `011_create_security_events.sql` | `deprecated_create_security_events_tables.sql` |
| `012_create_access_logs.sql` | `create_access_logs_table.sql` |
| `012_create_vaccination_reminder.sql` | `create_vaccination_reminder_system.sql` |
| `013_create_vaccine_requests.sql` | `create_vaccine_supply_chain_tables.sql` |

## Newly Added Descriptive Migrations

| New migration id | File |
|---|---|
| `add_guardian_password_visibility_columns` | `add_guardian_password_visibility_columns.sql` |

## Deterministic Ordering

Execution order is now controlled by [`manifest.json`](backend/migrations/manifest.json), not by filename prefix.

Use:

```bash
npm run migrate:manifest
```
