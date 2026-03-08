/**
 * IMMUNICARE SMS MESSAGE TEMPLATE FORMAT
 * ========================================
 *
 * Comprehensive SMS message format template for the Guardian Dashboard System
 * Optimized for API credit usage while providing complete information
 *
 * ============================================================================
 * MESSAGE TYPE CODES:
 * ============================================================================
 * G1 - Appointment Reminder (48h/24h before)
 * G2 - Appointment Confirmation
 * G3 - Appointment Rescheduled
 * G4 - Appointment Cancelled
 * G5 - Confirmation Request
 * G6 - Vaccination Alert
 * G7 - Vaccination Due Soon
 * G8 - Vaccination Administered
 * G9 - Missed Appointment
 * G10 - Overdue Vaccination
 * G11 - Health Checkup Notification
 * G12 - Dosage Reminder
 * G13 - Clinic Update
 * G14 - Emergency Alert
 * G15 - Payment Notification
 * G16 - Password Reset Code
 * G17 - Account Verification
 * G18 - Profile Update
 * G19 - New Message Received
 * G20 - Follow-up Appointment
 * G21 - Cancellation Options
 * G22 - Rescheduling Options
 *
 * ============================================================================
 * OPTIMIZATION GUIDELINES:
 * ============================================================================
 * 1. Maximum SMS length: 160 characters (single segment)
 * 2. Concatenated SMS: 153 characters per segment (for multi-segment)
 * 3. Use abbreviations for common terms
 * 4. Omit non-essential words
 * 5. Use standard date/time formats
 * 6. Include only critical contact info
 *
 * ============================================================================
 * DATE/TIME FORMATS:
 * ============================================================================
 * Date: DD/MM (e.g., 25/02)
 * Time: HH:MM AM/PM (e.g., 9:00 AM)
 * DateTime: DD/MM @ HH:MM AM/PM (e.g., 25/02 @ 9:00 AM)
 *
 * ============================================================================
 * ABBREVIATIONS:
 * ============================================================================
 * IMMUNICARE -> IMMU
 * Guardian -> Gdn
 * Child/Baby -> Baby
 * Infant -> Baby
 * Vaccination -> Vax
 * Vaccine -> Vax
 * Appointment -> Appt
 * Schedule -> Sched
 * Reminder -> Rmdr
 * Confirmation -> Conf
 * Hospital/Health Center -> HC
 * Clinic -> Clinic
 * Doctor -> Dr
 * Nurse -> RN
 * Required -> Req
 * Please -> Pls
 * Thank you -> Ty
 * Bring -> Bring
 * Minutes -> min
 * Hours -> hrs
 * Days -> days
 *
 * ============================================================================
 * TEMPLATE VARIABLES:
 * ============================================================================
 * {guardian_name} - Guardian's name
 * {baby_name} - Baby/Infant name
 * {infant_id} - Infant ID number
 * {appointment_date} - Date of appointment (DD/MM)
 * {appointment_time} - Time of appointment (HH:MM AM/PM)
 * {vaccine_name} - Vaccine/immunization name
 * {clinic_name} - Health center/clinic name
 * {clinic_address} - Clinic address
 * {doctor_name} - Doctor or nurse assigned
 * {location_address} - Full location address
 * {documents_req} - Required documents
 * {items_req} - Items to bring
 * {preparation_instructions} - Pre-appointment instructions
 * {follow_up_date} - Next appointment date
 * {contact_number} - Support contact number
 * {verification_code} - OTP verification code
 * {status} - Appointment/vaccination status
 * {cancellation_reason} - Reason for cancellation
 * {reschedule_link} - Link to reschedule
 *
 * ============================================================================
 */

const SMS_TEMPLATES = {
  // ========================================
  // GUARDIAN MODULE NOTIFICATIONS
  // ========================================

  /**
   * G1: Appointment Reminder (48h/24h before)
   * Purpose: Remind guardian about upcoming appointment
   * Priority: High
   * Character Count: ~150 chars optimized
   */
  APPOINTMENT_REMINDER: {
    code: 'G1',
    priority: 'high',
    template: 'IMMU Rmdr: {baby_name}\'s vax appt is on {appointment_date} @ {appointment_time} at {clinic_name}. Pls arrive 15min early. Reply STOP to unsubscribe.',
    // Full version (if more detail needed):
    templateExtended: 'IMMU Rmdr: {baby_name} (ID:{infant_id}) has vax appt on {appointment_date} @ {appointment_time} at {clinic_name}, {clinic_address}. Dr:{doctor_name}. Pls arrive 15min early. Bring:{documents_req}. Reply STOP.',
    variables: [
      'baby_name',
      'infant_id',
      'appointment_date',
      'appointment_time',
      'clinic_name',
      'clinic_address',
      'doctor_name',
      'documents_req'
    ],
    estimatedLength: 150
  },

  /**
   * G2: Appointment Confirmation
   * Purpose: Confirm appointment has been booked
   * Priority: High
   */
  APPOINTMENT_CONFIRMATION: {
    code: 'G2',
    priority: 'high',
    template: 'IMMU Conf: {baby_name}\'s {vaccine_name} vax appt confirmed for {appointment_date} @ {appointment_time} at {clinic_name}. Thank you! Reply STOP to unsubscribe.',
    templateExtended: 'IMMU Conf: {baby_name} (ID:{infant_id}) {vaccine_name} vax appt confirmed for {appointment_date} @ {appointment_time} at {clinic_name}, {clinic_address}. Dr:{doctor_name}. Pls arrive 15min early. Reply STOP.',
    variables: [
      'baby_name',
      'infant_id',
      'vaccine_name',
      'appointment_date',
      'appointment_time',
      'clinic_name',
      'clinic_address',
      'doctor_name'
    ],
    estimatedLength: 155
  },

  /**
   * G3: Appointment Rescheduled
   * Purpose: Notify guardian of schedule change
   * Priority: High
   */
  APPOINTMENT_RESCHEDULED: {
    code: 'G3',
    priority: 'high',
    template: 'IMMU Alert: {baby_name}\'s vax appt on {appointment_date} has been rescheduled to {new_date} @ {new_time} at {clinic_name}. Reply STOP.',
    templateExtended: 'IMMU Alert: {baby_name} (ID:{infant_id})\'s vax appt on {appointment_date} has been rescheduled to {new_date} @ {new_time} at {clinic_name}, {clinic_address}. We apologize for the inconvenience. Reply STOP.',
    variables: [
      'baby_name',
      'infant_id',
      'appointment_date',
      'new_date',
      'new_time',
      'clinic_name',
      'clinic_address'
    ],
    estimatedLength: 145
  },

  /**
   * G4: Appointment Cancelled
   * Purpose: Notify guardian of cancelled appointment
   * Priority: High
   */
  APPOINTMENT_CANCELLED: {
    code: 'G4',
    priority: 'high',
    template: 'IMMU Alert: {baby_name}\'s vax appt on {appointment_date} @ {appointment_time} at {clinic_name} has been cancelled. Reason: {cancellation_reason}. To reschedule, contact {contact_number}. Reply STOP.',
    variables: [
      'baby_name',
      'infant_id',
      'appointment_date',
      'appointment_time',
      'clinic_name',
      'cancellation_reason',
      'contact_number'
    ],
    estimatedLength: 160
  },

  /**
   * G5: Confirmation Request
   * Purpose: Request guardian to confirm appointment
   * Priority: High
   */
  CONFIRMATION_REQUEST: {
    code: 'G5',
    priority: 'high',
    template: 'IMMU: Please confirm {baby_name}\'s vax appt on {appointment_date} @ {appointment_time}. Reply CONFIRM to accept or CANCEL to decline. Reply STOP.',
    variables: ['baby_name', 'infant_id', 'appointment_date', 'appointment_time'],
    estimatedLength: 120
  },

  /**
   * G6: Vaccination Alert
   * Purpose: Alert about specific vaccination
   * Priority: High
   */
  VACCINATION_ALERT: {
    code: 'G6',
    priority: 'high',
    template: 'IMMU Alert: {vaccine_name} vax for {baby_name} is due soon. Please schedule an appt at {clinic_name}. Contact {contact_number} for assistance. Reply STOP.',
    variables: ['baby_name', 'infant_id', 'vaccine_name', 'clinic_name', 'contact_number'],
    estimatedLength: 130
  },

  /**
   * G7: Vaccination Due Soon
   * Purpose: Reminder about upcoming vaccination
   * Priority: High
   */
  VACCINATION_DUE_SOON: {
    code: 'G7',
    priority: 'high',
    template: 'IMMU: {baby_name}\'s {vaccine_name} (Dose {dose_number}) is due on {due_date}. Please schedule appointment at {clinic_name}. Reply STOP.',
    variables: ['baby_name', 'infant_id', 'vaccine_name', 'dose_number', 'due_date', 'clinic_name'],
    estimatedLength: 130
  },

  /**
   * G8: Vaccination Administered
   * Purpose: Confirm vaccination has been given
   * Priority: Normal
   */
  VACCINATION_ADMINISTERED: {
    code: 'G8',
    priority: 'normal',
    template: 'IMMU: {baby_name} received {vaccine_name} (Dose {dose_number}) today at {clinic_name}. Next vax: {next_vaccine} on {next_date}. Reply STOP.',
    variables: [
      'baby_name',
      'infant_id',
      'vaccine_name',
      'dose_number',
      'clinic_name',
      'next_vaccine',
      'next_date'
    ],
    estimatedLength: 140
  },

  /**
   * G9: Missed Appointment
   * Purpose: Notify guardian about missed appointment
   * Priority: High
   */
  MISSED_APPOINTMENT: {
    code: 'G9',
    priority: 'high',
    template: 'IMMU: {baby_name}\'s vax appt on {appointment_date} was missed. Please contact {clinic_name} at {contact_number} to reschedule. Reply STOP.',
    variables: ['baby_name', 'infant_id', 'appointment_date', 'clinic_name', 'contact_number'],
    estimatedLength: 130
  },

  /**
   * G10: Overdue Vaccination
   * Purpose: Alert about overdue vaccination
   * Priority: Urgent
   */
  OVERDUE_VACCINATION: {
    code: 'G10',
    priority: 'urgent',
    template: 'IMMU URGENT: {baby_name}\'s {vaccine_name} vax is {days_overdue} days overdue. Please schedule appt ASAP at {clinic_name}. Contact {contact_number}. Reply STOP.',
    variables: [
      'baby_name',
      'infant_id',
      'vaccine_name',
      'days_overdue',
      'clinic_name',
      'contact_number'
    ],
    estimatedLength: 140
  },

  /**
   * G11: Health Checkup Notification
   * Purpose: Notify about health checkup schedule
   * Priority: Normal
   */
  HEALTH_CHECKUP_NOTIFICATION: {
    code: 'G11',
    priority: 'normal',
    template: 'IMMU: {baby_name}\'s health checkup is scheduled for {appointment_date} @ {appointment_time} at {clinic_name}. Bring: {documents_req}. Reply STOP.',
    variables: [
      'baby_name',
      'infant_id',
      'appointment_date',
      'appointment_time',
      'clinic_name',
      'documents_req'
    ],
    estimatedLength: 130
  },

  /**
   * G12: Dosage Reminder
   * Purpose: Reminder about medication dosage
   * Priority: Normal
   */
  DOSAGE_REMINDER: {
    code: 'G12',
    priority: 'normal',
    template: 'IMMU: Reminder to give {baby_name} {medicine_name} {dosage_amount} at {scheduled_time}. Follow instructions: {instructions}. Reply STOP.',
    variables: [
      'baby_name',
      'infant_id',
      'medicine_name',
      'dosage_amount',
      'scheduled_time',
      'instructions'
    ],
    estimatedLength: 130
  },

  /**
   * G13: Clinic Update
   * Purpose: General clinic updates
   * Priority: Normal
   */
  CLINIC_UPDATE: {
    code: 'G13',
    priority: 'normal',
    template: 'IMMU Update: {clinic_name} - {update_message}. For details, visit or call {contact_number}. Reply STOP to unsubscribe.',
    variables: ['clinic_name', 'update_message', 'contact_number'],
    estimatedLength: 120
  },

  /**
   * G14: Emergency Alert
   * Purpose: Urgent health alerts
   * Priority: Urgent
   */
  EMERGENCY_ALERT: {
    code: 'G14',
    priority: 'urgent',
    template: 'IMMU URGENT: {alert_message}. Please contact {clinic_name} immediately at {contact_number} or go to nearest emergency room. Reply STOP.',
    variables: ['alert_message', 'clinic_name', 'contact_number'],
    estimatedLength: 130
  },

  /**
   * G15: Payment Notification
   * Purpose: Payment-related notifications
   * Priority: Normal
   */
  PAYMENT_NOTIFICATION: {
    code: 'G15',
    priority: 'normal',
    template: 'IMMU Payment: {payment_message}. Amount: {amount}. Due: {due_date}. Pay at {clinic_name} or via {payment_link}. Reply STOP.',
    variables: ['payment_message', 'amount', 'due_date', 'clinic_name', 'payment_link'],
    estimatedLength: 130
  },

  /**
   * G16: Password Reset Code
   * Purpose: Send OTP for password reset
   * Priority: High
   */
  PASSWORD_RESET: {
    code: 'G16',
    priority: 'high',
    template: 'IMMU: Your password reset code is {verification_code}. Valid for {expires_minutes} mins. Do not share this code. Reply STOP.',
    variables: ['verification_code', 'expires_minutes'],
    estimatedLength: 110
  },

  /**
   * G17: Account Verification
   * Purpose: Verify phone number for account
   * Priority: High
   */
  ACCOUNT_VERIFICATION: {
    code: 'G17',
    priority: 'high',
    template: 'IMMU: Your verification code is {verification_code}. Valid for 30 mins. Do not share. Reply STOP.',
    variables: ['verification_code'],
    estimatedLength: 90
  },

  /**
   * G18: Profile Update
   * Purpose: Notify about profile changes
   * Priority: Normal
   */
  PROFILE_UPDATE: {
    code: 'G18',
    priority: 'normal',
    template: 'IMMU: Your profile has been updated. If you did not make this change, contact {contact_number} immediately. Reply STOP.',
    variables: ['contact_number'],
    estimatedLength: 110
  },

  /**
   * G19: New Message Received
   * Purpose: Notify about new message in portal
   * Priority: Normal
   */
  NEW_MESSAGE: {
    code: 'G19',
    priority: 'normal',
    template: 'IMMU: You have a new message from {sender_name}. Subject: {message_subject}. Login to view. Reply STOP.',
    variables: ['sender_name', 'message_subject'],
    estimatedLength: 100
  },

  /**
   * G20: Follow-up Appointment
   * Purpose: Schedule follow-up after treatment
   * Priority: Normal
   */
  FOLLOWUP_APPOINTMENT: {
    code: 'G20',
    priority: 'normal',
    template: 'IMMU: Follow-up appt for {baby_name} is on {appointment_date} @ {appointment_time} at {clinic_name}. Dr:{doctor_name}. Reply STOP.',
    variables: [
      'baby_name',
      'infant_id',
      'appointment_date',
      'appointment_time',
      'clinic_name',
      'doctor_name'
    ],
    estimatedLength: 130
  },

  /**
   * G21: Cancellation Options
   * Purpose: Provide cancellation information
   * Priority: Normal
   */
  CANCELLATION_OPTIONS: {
    code: 'G21',
    priority: 'normal',
    template: 'IMMU: To cancel {baby_name}\'s appt on {appointment_date}, reply CANCEL or call {contact_number}. Reply STOP.',
    variables: ['baby_name', 'appointment_date', 'contact_number'],
    estimatedLength: 100
  },

  /**
   * G22: Rescheduling Options
   * Purpose: Provide rescheduling options
   * Priority: Normal
   */
  RESCHEDULING_OPTIONS: {
    code: 'G22',
    priority: 'normal',
    template: 'IMMU: To reschedule {baby_name}\'s appt, visit {clinic_name} or call {contact_number}. Available slots: {available_slots}. Reply STOP.',
    variables: ['baby_name', 'clinic_name', 'contact_number', 'available_slots'],
    estimatedLength: 120
  },

  // ========================================
  // ADMIN MODULE NOTIFICATIONS (for reference)
  // ========================================

  /**
   * A1: Inventory Alert (Admin)
   * Purpose: Alert admin about low vaccine stock
   */
  INVENTORY_ALERT: {
    code: 'A1',
    priority: 'high',
    template: 'IMMU Admin: {vaccine_name} stock low. Current: {current_stock}, Threshold: {threshold}. Please arrange restocking.',
    variables: ['vaccine_name', 'current_stock', 'threshold'],
    estimatedLength: 110
  },

  /**
   * A2: Expiry Warning (Admin)
   * Purpose: Alert about expiring vaccines
   */
  EXPIRY_WARNING: {
    code: 'A2',
    priority: 'high',
    template: 'IMMU Admin: {vaccine_name} (Lot:{lot_number}) expires in {days_until_expiry} days. Please use or dispose properly.',
    variables: ['vaccine_name', 'lot_number', 'days_until_expiry'],
    estimatedLength: 100
  },

  /**
   * A3: Critical Stock Alert (Admin)
   * Purpose: Critical stock level alert
   */
  CRITICAL_STOCK_ALERT: {
    code: 'A3',
    priority: 'urgent',
    template: 'IMMU URGENT Admin: {vaccine_name} CRITICAL! Only {current_stock} doses left. Immediate restocking required!',
    variables: ['vaccine_name', 'current_stock'],
    estimatedLength: 90
  },

  /**
   * A4: Vaccine Unavailable (Admin)
   * Purpose: Notify admin about vaccine unavailability
   */
  VACCINE_UNAVAILABLE: {
    code: 'A4',
    priority: 'high',
    template: 'IMMU Alert: {vaccine_name} unavailable at {health_center}. Guardians notified. Action required.',
    variables: ['vaccine_name', 'health_center'],
    estimatedLength: 90
  }
};

// ========================================
// TEMPLATE PROCESSOR FUNCTIONS
// ========================================

/**
 * Process template with provided variables
 * @param {string} template - Template string
 * @param {Object} variables - Object containing variable values
 * @returns {string} - Processed message
 */
function processTemplate(template, variables) {
  let message = template;
  for (const [key, value] of Object.entries(variables)) {
    const placeholder = `{${key}}`;
    message = message.split(placeholder).join(value || '');
  }
  return message;
}

/**
 * Get template by code
 * @param {string} code - Template code (e.g., 'G1', 'G2')
 * @returns {Object} - Template object
 */
function getTemplate(code) {
  return SMS_TEMPLATES[code] || null;
}

/**
 * Calculate estimated SMS segments
 * @param {string} message - Message content
 * @returns {number} - Number of segments
 */
function calculateSegments(message) {
  const length = message.length;
  if (length <= 160) {
    return 1;
  }
  return Math.ceil(length / 153);
}

/**
 * Estimate API credit cost
 * @param {string} code - Template code
 * @returns {Object} - Cost estimation
 */
function estimateCost(code) {
  const template = getTemplate(code);
  if (!template) {
    return null;
  }

  const segments = calculateSegments(template.template);
  return {
    templateCode: code,
    priority: template.priority,
    estimatedCharacters: template.estimatedLength,
    segments: segments,
    // Assuming $0.05 per segment (Twilio standard)
    estimatedCostUSD: segments * 0.05,
    estimatedCostPHP: segments * 2.5 // ~50 PHP per SMS segment locally
  };
}

/**
 * Get all templates for a module
 * @param {string} module - 'guardian' or 'admin'
 * @returns {Array} - Array of template objects
 */
function getTemplatesByModule(module) {
  const prefix = module === 'guardian' ? 'G' : 'A';
  return Object.values(SMS_TEMPLATES).filter((t) => t.code.startsWith(prefix));
}

/**
 * Get all templates sorted by priority
 * @returns {Array} - Sorted array of templates
 */
function getTemplatesByPriority() {
  const priorityOrder = { urgent: 1, high: 2, normal: 3, low: 4 };
  return Object.values(SMS_TEMPLATES).sort(
    (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]
  );
}

// ========================================
// EXPORTS
// ========================================

module.exports = {
  SMS_TEMPLATES,
  processTemplate,
  getTemplate,
  calculateSegments,
  estimateCost,
  getTemplatesByModule,
  getTemplatesByPriority,

  // Quick access to commonly used templates
  TEMPLATE_CODES: {
    APPOINTMENT_REMINDER: 'G1',
    APPOINTMENT_CONFIRMATION: 'G2',
    APPOINTMENT_RESCHEDULED: 'G3',
    APPOINTMENT_CANCELLED: 'G4',
    CONFIRMATION_REQUEST: 'G5',
    VACCINATION_ALERT: 'G6',
    VACCINATION_DUE_SOON: 'G7',
    VACCINATION_ADMINISTERED: 'G8',
    MISSED_APPOINTMENT: 'G9',
    OVERDUE_VACCINATION: 'G10',
    HEALTH_CHECKUP: 'G11',
    DOSAGE_REMINDER: 'G12',
    CLINIC_UPDATE: 'G13',
    EMERGENCY_ALERT: 'G14',
    PAYMENT_NOTIFICATION: 'G15',
    PASSWORD_RESET: 'G16',
    ACCOUNT_VERIFICATION: 'G17',
    PROFILE_UPDATE: 'G18',
    NEW_MESSAGE: 'G19',
    FOLLOWUP_APPOINTMENT: 'G20',
    CANCELLATION_OPTIONS: 'G21',
    RESCHEDULING_OPTIONS: 'G22',
    INVENTORY_ALERT: 'A1',
    EXPIRY_WARNING: 'A2',
    CRITICAL_STOCK_ALERT: 'A3',
    VACCINE_UNAVAILABLE: 'A4'
  }
};
