# Immunicare Database Table Connections Documentation

## Overview

This document describes the table relationships and connections configured in the Immunicare healthcare management system database.

## Database Configuration

- **Database**: PostgreSQL (`immunicare_dev`)
- **Host**: localhost
- **Port**: 5432
- **Connection Pool**: max 20 connections, 30s idle timeout

## Connection Verification Commands

```bash
# Verify database connections
npm run db:verify

# Alternative command
npm run db:connections
```

## Core Reference Tables

### 1. Healthcare Facilities (`healthcare_facilities`)

**Purpose**: Stores healthcare facility/clinic information

**Referenced By**:

- `admin` (facility_id) - Links staff to facilities
- `vaccine_batches` (facility_id) - Tracks vaccine inventory per facility
- `appointments` (facility_id) - Appointments at specific facilities
- `schedules` (facility_id) - Facility schedules
- `vaccine_inventory` (facility_id) - Vaccine stock levels
- `vaccine_inventory_transactions` (facility_id) - Transaction records
- `vaccine_stock_alerts` (facility_id) - Stock alerts per facility

### 2. Admin Users (`admin`)

**Purpose**: Admin/staff user accounts and authentication

**References**:

- `healthcare_facilities` (facility_id) - Assigned facility

**Referenced By** (27+ tables):

- `immunization_records` (administered_by, vaccinator_id)
- `appointments` (created_by)
- `schedules` (created_by)
- `notifications` (created_by, cancelled_by)
- `audit_logs` (admin_id)
- `security_events` (admin_id)
- `health_records` (uploaded_by, reviewed_by, signed_by)
- `patient_growth` (measured_by, created_by, updated_by)
- `inventory_transactions` (admin_id)
- `admin_sessions` (admin_id)
- `notification_preferences` (admin_id)
- `reports` (generated_by)
- `announcements` (created_by)
- `paper_templates` (created_by, updated_by)
- `document_generation` (generated_by)
- `digital_papers` (verified_by)
- `admin_preferences` (admin_id)
- `admin_settings` (admin_id)
- `messages` (sender_id, recipient_id)
- `conversation_participants` (admin_id)
- `healthcare_workers` (admin_id)
- `adoption_documents` (uploaded_by, verified_by)
- `feedback` (admin_id, assigned_to)
- `alerts` (acknowledged_by)
- `vaccine_inventory` (created_by, updated_by)
- `vaccine_inventory_transactions` (performed_by, approved_by)
- `vaccine_stock_alerts` (acknowledged_by, resolved_by)
- `suppliers` (created_by, updated_by)

### 3. Guardians (`guardians`)

**Purpose**: Guardian/parent information for patients

**Referenced By**:

- `patients` (guardian_id) - Links patients to guardians
- `messages` (guardian_id) - Messages to guardians
- `document_generation` (guardian_id) - Documents for guardians

### 4. Patients (`patients`)

**Purpose**: Patient demographic and medical information

**References**:

- `guardians` (guardian_id) - Assigned guardian
- `healthcare_facilities` (facility_id) - Assigned facility

**Referenced By**:

- `immunization_records` (patient_id) - Vaccination history
- `appointments` (patient_id) - Patient appointments
- `schedules` (patient_id) - Patient schedules
- `health_records` (patient_id) - Medical documents
- `patient_growth` (patient_id) - Growth measurements
- `messages` (patient_id) - Patient messages
- `adoption_documents` (patient_id) - Adoption documents
- `document_generation` (patient_id) - Generated documents
- `document_downloads` (patient_id) - Download records
- `paper_completion_status` (patient_id) - Document completion
- `document_generation_logs` (patient_id) - Generation logs

## Domain Tables

### 5. Vaccines (`vaccines`)

**Purpose**: Vaccine information and specifications

**Referenced By**:

- `vaccine_batches` (vaccine_id) - Batch tracking
- `immunization_records` (vaccine_id) - Vaccination records
- `vaccination_schedules` (vaccine_id) - Schedule definitions
- `vaccine_inventory` (vaccine_id) - Inventory levels
- `vaccine_inventory_transactions` (vaccine_id) - Transactions
- `vaccine_stock_alerts` (vaccine_id) - Stock alerts

### 6. Vaccine Batches (`vaccine_batches`)

**Purpose**: Vaccine batch inventory and expiry

**References**:

- `vaccines` (vaccine_id) - Associated vaccine
- `healthcare_facilities` (facility_id) - Facility location

**Referenced By**:

- `immunization_records` (batch_id) - Administered doses
- `inventory_transactions` (batch_id) - Inventory movements

### 7. Immunization Records (`immunization_records`)

**Purpose**: Individual vaccination administrations

**References**:

- `patients` (patient_id) - Patient
- `vaccines` (vaccine_id) - Vaccine administered
- `vaccine_batches` (batch_id) - Batch used
- `admin` (administered_by, vaccinator_id) - Staff

### 8. Vaccination Schedules (`vaccination_schedules`)

**Purpose**: Standard vaccination schedules by age

**References**:

- `vaccines` (vaccine_id) - Associated vaccine

### 9. Appointments (`appointments`)

**Purpose**: Vaccination and medical appointments

**References**:

- `patients` (patient_id) - Patient
- `admin` (created_by) - Created by staff
- `healthcare_facilities` (facility_id) - Facility

### 10. Schedules (`schedules`)

**Purpose**: Unified scheduling for all appointment types

**References**:

- `patients` (patient_id) - Patient
- `healthcare_facilities` (facility_id) - Facility
- `admin` (created_by) - Created by staff

### 11. Patient Growth (`patient_growth`)

**Purpose**: Growth measurements and developmental data

**References**:

- `patients` (patient_id) - Patient
- `admin` (measured_by, created_by, updated_by) - Staff

### 12. Notifications (`notifications`)

**Purpose**: Notification messages and delivery status

**References**:

- `admin` (created_by, cancelled_by) - Staff

### 13. Audit Logs (`audit_logs`)

**Purpose**: Audit trail for all system events

**References**:

- `admin` (admin_id) - User who performed action

### 14. Security Events (`security_events`)

**Purpose**: Security-related events for monitoring

**References**:

- `admin` (admin_id) - Related user

### 15. Health Records (`health_records`)

**Purpose**: Medical documents and health records

**References**:

- `patients` (patient_id) - Patient
- `admin` (uploaded_by, reviewed_by, signed_by) - Staff

## Inventory Tables

### 16. Items (`items`)

**Purpose**: Inventory items (vaccines and supplies only - medicine support removed)

**Referenced By**:

- `item_batches` (item_id) - Batch tracking

### 17. Item Batches (`item_batches`)

**Purpose**: Batch information for inventory items

**References**:

- `items` (item_id) - Associated item

### 18. Inventory Transactions (`inventory_transactions`)

**Purpose**: Inventory movement transactions

**References**:

- `vaccine_batches` (batch_id) - Batch
- `admin` (admin_id) - Staff

### 19. Suppliers (`suppliers`)

**Purpose**: Supplier information and performance metrics

**References**:

- `admin` (created_by, updated_by) - Staff

### 20. Vaccine Inventory (`vaccine_inventory`)

**Purpose**: Vaccine inventory levels and stock alerts

**References**:

- `vaccines` (vaccine_id) - Vaccine
- `healthcare_facilities` (facility_id) - Facility
- `admin` (created_by, updated_by) - Staff

**Referenced By**:

- `vaccine_inventory_transactions` (vaccine_inventory_id)
- `vaccine_stock_alerts` (vaccine_inventory_id)

### 21. Vaccine Inventory Transactions (`vaccine_inventory_transactions`)

**Purpose**: Vaccine inventory movements and transactions

**References**:

- `vaccine_inventory` (vaccine_inventory_id) - Inventory record
- `vaccines` (vaccine_id) - Vaccine
- `healthcare_facilities` (facility_id) - Facility
- `admin` (performed_by, approved_by) - Staff

### 22. Vaccine Stock Alerts (`vaccine_stock_alerts`)

**Purpose**: Vaccine stock level alerts

**References**:

- `vaccine_inventory` (vaccine_inventory_id) - Inventory record
- `vaccines` (vaccine_id) - Vaccine
- `healthcare_facilities` (facility_id) - Facility
- `admin` (acknowledged_by, resolved_by) - Staff

## Relationship/Junction Tables

### 25. Permissions (`permissions`)

**Purpose**: System permissions for RBAC

**Referenced By**:

- `role_permissions` (permission_id) - Role-permission mapping

### 26. Admin Sessions (`admin_sessions`)

**Purpose**: Admin login sessions for security

**References**:

- `admin` (admin_id, impersonated_by) - User

### 27. Notification Preferences (`notification_preferences`)

**Purpose**: Admin notification preferences

**References**:

- `admin` (admin_id) - Admin user

### 28. Reports (`reports`)

**Purpose**: Generated reports and status

**References**:

- `admin` (generated_by) - Generated by

### 29. Announcements (`announcements`)

**Purpose**: System announcements and notices

**References**:

- `admin` (created_by) - Created by

### 30. Paper Templates (`paper_templates`)

**Purpose**: Document template configurations

**References**:

- `admin` (created_by, updated_by) - Staff

**Referenced By**:

- `document_generation` (template_id)
- `document_downloads` (template_id)
- `paper_completion_status` (template_id)
- `document_access_permissions` (template_id)
- `document_templates_library` (referenced by template_id)
- `document_generation_logs` (template_id)

### 31. Document Generation (`document_generation`)

**Purpose**: Document generation requests

**References**:

- `paper_templates` (template_id) - Template used
- `patients` (patient_id) - Patient
- `guardians` (guardian_id) - Guardian
- `admin` (generated_by) - Generated by

**Referenced By**:

- `digital_papers` (document_generation_id)

### 32. Digital Papers (`digital_papers`)

**Purpose**: Generated digital documents

**References**:

- `document_generation` (document_generation_id) - Source document
- `admin` (verified_by) - Verified by

### 33. Document Downloads (`document_downloads`)

**Purpose**: Document download history

**References**:

- `admin` (admin_id) - Downloader
- `patients` (patient_id) - Patient
- `paper_templates` (template_id) - Template

### 34. Paper Completion Status (`paper_completion_status`)

**Purpose**: Document completion tracking

**References**:

- `patients` (patient_id) - Patient
- `paper_templates` (template_id) - Template
- `admin` (completed_by) - Completed by

### 35. Document Access Permissions (`document_access_permissions`)

**Purpose**: Document access by role

**References**:

- `paper_templates` (template_id) - Template
- `permissions` (role_id) - Role/permission

### 36. Document Templates Library (`document_templates_library`)

**Purpose**: Reusable document templates

**References**:

- `admin` (created_by) - Created by

### 37. Document Generation Logs (`document_generation_logs`)

**Purpose**: Generation activity logs

**References**:

- `paper_templates` (template_id) - Template
- `patients` (patient_id) - Patient
- `admin` (admin_id) - Staff

### 38. Admin Preferences (`admin_preferences`)

**Purpose**: Admin-specific preferences

**References**:

- `admin` (admin_id) - Admin user

### 39. Admin Settings (`admin_settings`)

**Purpose**: Admin-specific settings

**References**:

- `admin` (admin_id) - Admin user

**Referenced By**:

- `settings_audit_log` (setting_id)

### 40. Settings Audit Log (`settings_audit_log`)

**Purpose**: Settings change audit

**References**:

- `admin` (admin_id) - Admin user
- `admin_settings` (setting_id) - Settings record

### 41. System Config (`system_config`)

**Purpose**: System-wide configuration

### 42. Messages (`messages`)

**Purpose**: User messages and communications

**References**:

- `admin` (sender_id, recipient_id) - Users
- `guardians` (guardian_id) - Guardian
- `patients` (patient_id) - Patient
- `conversations` (conversation_id) - Conversation
- `messages` (parent_message_id) - Self-reference (replies)

### 43. Conversations (`conversations`)

**Purpose**: Conversation threads for messaging

**Referenced By**:

- `messages` (conversation_id) - Messages in conversation
- `conversation_participants` (conversation_id) - Participants

### 44. Conversation Participants (`conversation_participants`)

**Purpose**: Maps admins to conversations

**References**:

- `conversations` (conversation_id) - Conversation
- `admin` (admin_id) - Admin user

### 45. Healthcare Workers (`healthcare_workers`)

**Purpose**: Healthcare worker professional information

**References**:

- `admin` (admin_id) - Admin user

### 46. Adoption Documents (`adoption_documents`)

**Purpose**: Adoption-related documents

**References**:

- `patients` (patient_id) - Patient
- `admin` (uploaded_by, verified_by) - Staff

### 47. Feedback (`feedback`)

**Purpose**: User feedback and support requests

**References**:

- `admin` (admin_id, assigned_to) - Staff

### 48. Alerts (`alerts`)

**Purpose**: System alerts and notifications

**References**:

- `admin` (acknowledged_by) - Staff

## Relationship Diagrams

### Patient-Doctor-Vaccine Relationship

```
patients (1) ←--------→ (N) guardians
    ↓
immunization_records ←→ vaccines
    ↓
vaccine_batches ←→ healthcare_facilities
```

### Document Generation Flow

```
paper_templates (1) → (N) document_generation (1) → (N) digital_papers
                                              ↓
                                        admin (verified_by)
```

### Notification Flow

```
admin (N) → (N) notification_preferences
    ↓
notifications (references admin)
```

### Messaging Flow

```
admin (N) ↔ conversation_participants ↔ conversations (N) ↔ messages (N)
                                                  ↓
                                            patients/guardians
```

## Key Statistics

| Metric                       | Count |
| ---------------------------- | ----- |
| Total Tables                 | 52    |
| Foreign Key Relationships    | 83    |
| Indexed Columns              | 95    |
| Core Reference Tables        | 4     |
| Domain Tables                | 20    |
| Inventory Tables             | 9     |
| Junction/Relationship Tables | 19    |

## Running Database Verification

Before any database update, run:

```bash
cd backend
npm run db:verify
```

This will verify:

1. Database connection
2. Table existence
3. Foreign key relationships
4. Index configurations

## Notes

- Some legacy tables (`users`, `infants`, `clinics`) still exist for backward compatibility
- The new schema uses `admin`, `patients`, `healthcare_facilities` naming convention
- All timestamps use `TIMESTAMP WITH TIME ZONE`
- Soft delete is implemented via `is_active` flags on most tables
- UUID generation via `uuid-ossp` and `pgcrypto` extensions
