# Vaccination Reminder Module

This module provides automated vaccination reminder notifications for guardians in the Immunicare Healthcare Management System. It sends reminders via email and SMS when infants are due for their scheduled vaccinations.

## Overview

The vaccination reminder module consists of:

1. **Vaccination Reminder Service** (`services/vaccinationReminderService.js`) - Core logic for calculating due dates and sending reminders
2. **Vaccination Reminder Routes** (`routes/vaccinationReminders.js`) - API endpoints for managing reminders
3. **Vaccination Reminder Scheduler** (`services/vaccinationReminderScheduler.js`) - Automated scheduler for periodic reminder checks
4. **Database Models** (`models/VaccinationReminder.js`) - Database operations for reminders
5. **Database Migration** (`migrations/20240211000000_vaccination_reminders.sql`) - Schema for the reminder system

## Features

- **Automated Reminders**: Sends email and SMS notifications to guardians before scheduled vaccinations
- **Vaccination Schedule**: Follows standard infant vaccination schedule (BCG, Hep B, Pentavalent, OPV, PCV, IPV, MMR)
- **Configurable Timing**: Reminders sent 7 days before scheduled date (configurable)
- **Multi-Channel**: Supports email, SMS, and push notifications
- **First Vaccine Notification**: Sends confirmation when first vaccine is administered with next schedule
- **Guardian Preferences**: Allows guardians to customize their notification preferences

## Vaccination Schedule

The module follows this standard vaccination schedule:

| Vaccine                       | Dose | Age (Birth) | Age (Months) |
| ----------------------------- | ---- | ----------- | ------------ |
| BCG                           | 1    | At Birth    | 0            |
| Hep B                         | 1    | At Birth    | 0            |
| Hep B                         | 2    | 4 weeks     | 1            |
| Pentavalent (DPT-HepB-Hib)    | 1    | 6 weeks     | 1.5          |
| OPV (Oral Polio)              | 1    | 6 weeks     | 1.5          |
| PCV (Pneumococcal)            | 1    | 6 weeks     | 1.5          |
| Pentavalent                   | 2    | 10 weeks    | 2.5          |
| OPV                           | 2    | 10 weeks    | 2.5          |
| PCV                           | 2    | 10 weeks    | 2.5          |
| Pentavalent                   | 3    | 14 weeks    | 3.5          |
| OPV                           | 3    | 14 weeks    | 3.5          |
| PCV                           | 3    | 14 weeks    | 3.5          |
| IPV (Inactivated Polio)       | 1    | 14 weeks    | 3.5          |
| MMR (Measles, Mumps, Rubella) | 1    | 36 weeks    | 9            |
| IPV                           | 2    | 36 weeks    | 9            |
| MMR                           | 2    | 48 weeks    | 12           |

## API Endpoints

### Guardian Endpoints

#### Get Upcoming Vaccinations

```
GET /api/vaccination-reminders/upcoming
GET /api/vaccination-reminders/upcoming?days=30
```

Returns list of patients with upcoming vaccinations.

#### Get Next Scheduled Vaccine for Patient

```
GET /api/vaccination-reminders/next/:patientId
```

Returns the next scheduled vaccine for a specific patient.

#### Send Manual Reminder

```
POST /api/vaccination-reminders/send/:patientId
```

Sends a manual reminder for a specific patient.

### Admin/Staff Endpoints

#### Check and Send All Reminders

```
POST /api/vaccination-reminders/check-and-send
POST /api/vaccination-reminders/check-and-send
Body: { "daysInAdvance": 7 }
```

Triggers the automated reminder check manually.

#### Calculate Due Date

```
POST /api/vaccination-reminders/calculate-due-date
Body: { "birthDate": "2024-01-15", "vaccine": "Hep B", "dose": 2 }
```

Calculates the due date for a specific vaccine dose.

## Automated Scheduling

### Configuration

Add the following to your `.env` file:

```env
# Enable automatic vaccination reminders
AUTO_START_VACCINATION_REMINDERS=true

# How often to check for reminders (in minutes, default: 1440 = 24 hours)
VACCINATION_REMINDER_INTERVAL_MINUTES=1440

# Days in advance to send reminders (default: 7)
VACCINATION_REMINDER_DAYS_ADVANCE=7
```

### Running the Scheduler

The scheduler automatically starts if `AUTO_START_VACCINATION_REMINDERS=true` is set.

To manually start/stop the scheduler:

```javascript
const scheduler = require('./services/vaccinationReminderScheduler');

// Start with custom settings
scheduler.start(intervalMinutes, reminderDaysInAdvance);

// Stop the scheduler
scheduler.stop();

// Check scheduler status
const status = scheduler.getStatus();
```

## Database Schema

### Tables Created

1. **vaccination_reminders** - Tracks reminders sent to guardians
2. **guardian_notification_preferences** - Stores guardian notification preferences
3. **vaccination_reminder_templates** - Stores email/SMS templates
4. **vaccination_schedule_config** - Vaccination schedule configuration

### Running the Migration

```bash
# Run the migration
psql -d immunicare -f migrations/20240211000000_vaccination_reminders.sql
```

## Usage Examples

### Sending a Reminder

```javascript
const VaccinationReminderService = require('./services/vaccinationReminderService');

const reminderService = new VaccinationReminderService();

// Get next scheduled vaccine for a patient
const nextVaccine = await reminderService.getNextScheduledVaccine(patientId);
console.log('Next vaccine:', nextVaccine);

// Send reminder to guardian
await reminderService.sendVaccineReminder(guardian, patient, nextVaccine);
```

### Processing All Reminders

```javascript
// Check and send reminders for all patients
const sentReminders = await reminderService.checkAndSendReminders(7);
console.log(`Sent ${sentReminders.length} reminders`);
```

### First Vaccine Notification

When a vaccine is administered, call this to notify the guardian and provide the next schedule:

```javascript
await reminderService.sendFirstVaccineNotification(patientId, vaccineId, adminDate);
```

## Email/SMS Templates

The module includes pre-configured templates for:

1. **vaccination_reminder_email** - Email reminder template
2. **vaccination_reminder_sms** - SMS reminder template
3. **first_vaccine_email** - First vaccine confirmation email
4. **first_vaccine_sms** - First vaccine confirmation SMS

Templates support variable substitution:

- `{{patient_name}}` - Full name of the infant
- `{{guardian_name}}` - Name of the guardian
- `{{vaccine}}` - Name of the vaccine
- `{{dose}}` - Dose number
- `{{scheduled_date}}` - Due date for the vaccine
- `{{description}}` - Description of the vaccine

## Integration with Immunization Records

The module integrates with the existing [`immunization_records`](backend/schema.sql:348) table to track which vaccines have been administered and calculate the next due date.

## Error Handling

All errors are logged to the application's logging system. Failed notifications are retried up to 3 times by default.

## Security Considerations

- All API endpoints require authentication via JWT token
- Only admin, doctor, and nurse roles can trigger manual reminder checks
- Guardian notification preferences are stored securely
- No sensitive data is exposed in notifications

## Troubleshooting

### Reminders Not Being Sent

1. Check if the scheduler is running: `scheduler.getStatus()`
2. Verify database connection
3. Check email/SMS provider configuration
4. Ensure patients have valid guardian contact information

### Wrong Due Dates

1. Verify patient date of birth is correct
2. Check `vaccination_schedules` table for correct schedule configuration
3. Ensure `immunization_records` are being updated after vaccinations

## Future Enhancements

- Push notifications via mobile app
- Multi-language support
- Customizable reminder templates
- Advanced scheduling options (specific times, holidays)
- Integration with calendar applications
- SMS via Twilio or similar provider
