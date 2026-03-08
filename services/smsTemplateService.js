/**
 * SMS Template Service for Immunicare
 *
 * This service provides a unified interface for generating and sending
 * SMS messages using the template system defined in smsTemplates.js
 *
 * It integrates with the existing smsService.js to send formatted messages
 * to guardians and administrators.
 *
 * Usage:
 *   const smsTemplateService = require('./smsTemplateService');
 *
 *   // Send an appointment reminder
 *   await smsTemplateService.sendAppointmentReminder({
 *     guardianPhone: '+639123456789',
 *     babyName: 'John',
 *     infantId: 'INF001',
 *     appointmentDate: '25/02',
 *     appointmentTime: '9:00 AM',
 *     clinicName: 'San Nicolas Health Center',
 *     clinicAddress: 'San Nicolas, Ilocos Norte',
 *     doctorName: 'Dr. Smith',
 *     documentsReq: 'birth cert, MC'
 *   });
 */

const smsService = require('./smsService');
const { SMS_TEMPLATES, processTemplate, TEMPLATE_CODES } = require('./smsTemplates');

class SMSTemplateService {
  /**
   * Send appointment reminder SMS
   * @param {Object} data - Appointment reminder data
   */
  async sendAppointmentReminder(data) {
    const {
      guardianPhone,
      babyName,
      infantId,
      appointmentDate,
      appointmentTime,
      clinicName,
      clinicAddress,
      doctorName,
      documentsReq,
      hoursBefore = 24
    } = data;

    const template = hoursBefore <= 24
      ? SMS_TEMPLATES.APPOINTMENT_REMINDER.template
      : SMS_TEMPLATES.APPOINTMENT_REMINDER.templateExtended;

    const variables = {
      baby_name: babyName,
      infant_id: infantId,
      appointment_date: appointmentDate,
      appointment_time: appointmentTime,
      clinic_name: clinicName,
      clinic_address: clinicAddress || '',
      doctor_name: doctorName || '',
      documents_req: documentsReq || 'vaccine card'
    };

    const message = processTemplate(template, variables);

    return smsService.sendSMS(guardianPhone, message, 'appointment_reminder', {
      templateCode: TEMPLATE_CODES.APPOINTMENT_REMINDER,
      babyName,
      infantId,
      appointmentDate,
      appointmentTime,
      clinicName
    });
  }

  /**
   * Send appointment confirmation SMS
   * @param {Object} data - Appointment confirmation data
   */
  async sendAppointmentConfirmation(data) {
    const {
      guardianPhone,
      guardianName,
      babyName,
      infantId,
      vaccineName,
      appointmentDate,
      appointmentTime,
      clinicName,
      clinicAddress,
      doctorName
    } = data;

    const variables = {
      guardian_name: guardianName,
      baby_name: babyName,
      infant_id: infantId,
      vaccine_name: vaccineName,
      appointment_date: appointmentDate,
      appointment_time: appointmentTime,
      clinic_name: clinicName,
      clinic_address: clinicAddress || '',
      doctor_name: doctorName || ''
    };

    const message = processTemplate(SMS_TEMPLATES.APPOINTMENT_CONFIRMATION.template, variables);

    return smsService.sendSMS(guardianPhone, message, 'appointment_confirmation', {
      templateCode: TEMPLATE_CODES.APPOINTMENT_CONFIRMATION,
      babyName,
      infantId,
      vaccineName,
      appointmentDate,
      appointmentTime
    });
  }

  /**
   * Send appointment rescheduled notification
   * @param {Object} data - Reschedule data
   */
  async sendAppointmentRescheduled(data) {
    const {
      guardianPhone,
      babyName,
      infantId,
      oldDate,
      newDate,
      newTime,
      clinicName,
      clinicAddress
    } = data;

    const variables = {
      baby_name: babyName,
      infant_id: infantId,
      appointment_date: oldDate,
      new_date: newDate,
      new_time: newTime,
      clinic_name: clinicName,
      clinic_address: clinicAddress || ''
    };

    const message = processTemplate(SMS_TEMPLATES.APPOINTMENT_RESCHEDULED.template, variables);

    return smsService.sendSMS(guardianPhone, message, 'appointment_rescheduled', {
      templateCode: TEMPLATE_CODES.APPOINTMENT_RESCHEDULED,
      babyName,
      infantId,
      oldDate,
      newDate,
      newTime
    });
  }

  /**
   * Send appointment cancelled notification
   * @param {Object} data - Cancellation data
   */
  async sendAppointmentCancelled(data) {
    const {
      guardianPhone,
      babyName,
      infantId,
      appointmentDate,
      appointmentTime,
      clinicName,
      cancellationReason,
      contactNumber
    } = data;

    const variables = {
      baby_name: babyName,
      infant_id: infantId,
      appointment_date: appointmentDate,
      appointment_time: appointmentTime,
      clinic_name: clinicName,
      cancellation_reason: cancellationReason || 'unavailable',
      contact_number: contactNumber
    };

    const message = processTemplate(SMS_TEMPLATES.APPOINTMENT_CANCELLED.template, variables);

    return smsService.sendSMS(guardianPhone, message, 'appointment_cancelled', {
      templateCode: TEMPLATE_CODES.APPOINTMENT_CANCELLED,
      babyName,
      infantId,
      appointmentDate
    });
  }

  /**
   * Send confirmation request
   * @param {Object} data - Confirmation request data
   */
  async sendConfirmationRequest(data) {
    const {
      guardianPhone,
      babyName,
      infantId,
      appointmentDate,
      appointmentTime
    } = data;

    const variables = {
      baby_name: babyName,
      infant_id: infantId,
      appointment_date: appointmentDate,
      appointment_time: appointmentTime
    };

    const message = processTemplate(SMS_TEMPLATES.CONFIRMATION_REQUEST.template, variables);

    return smsService.sendSMS(guardianPhone, message, 'confirmation_request', {
      templateCode: TEMPLATE_CODES.CONFIRMATION_REQUEST,
      babyName,
      infantId,
      appointmentDate
    });
  }

  /**
   * Send vaccination alert
   * @param {Object} data - Vaccination alert data
   */
  async sendVaccinationAlert(data) {
    const {
      guardianPhone,
      babyName,
      infantId,
      vaccineName,
      clinicName,
      contactNumber
    } = data;

    const variables = {
      baby_name: babyName,
      infant_id: infantId,
      vaccine_name: vaccineName,
      clinic_name: clinicName,
      contact_number: contactNumber
    };

    const message = processTemplate(SMS_TEMPLATES.VACCINATION_ALERT.template, variables);

    return smsService.sendSMS(guardianPhone, message, 'vaccination_alert', {
      templateCode: TEMPLATE_CODES.VACCINATION_ALERT,
      babyName,
      infantId,
      vaccineName
    });
  }

  /**
   * Send vaccination due soon notification
   * @param {Object} data - Vaccination due data
   */
  async sendVaccinationDueSoon(data) {
    const {
      guardianPhone,
      babyName,
      infantId,
      vaccineName,
      doseNumber,
      dueDate,
      clinicName
    } = data;

    const variables = {
      baby_name: babyName,
      infant_id: infantId,
      vaccine_name: vaccineName,
      dose_number: doseNumber,
      due_date: dueDate,
      clinic_name: clinicName
    };

    const message = processTemplate(SMS_TEMPLATES.VACCINATION_DUE_SOON.template, variables);

    return smsService.sendSMS(guardianPhone, message, 'vaccination_due', {
      templateCode: TEMPLATE_CODES.VACCINATION_DUE_SOON,
      babyName,
      infantId,
      vaccineName,
      doseNumber
    });
  }

  /**
   * Send vaccination administered notification
   * @param {Object} data - Vaccination administered data
   */
  async sendVaccinationAdministered(data) {
    const {
      guardianPhone,
      babyName,
      infantId,
      vaccineName,
      doseNumber,
      clinicName,
      nextVaccine,
      nextDate
    } = data;

    const variables = {
      baby_name: babyName,
      infant_id: infantId,
      vaccine_name: vaccineName,
      dose_number: doseNumber,
      clinic_name: clinicName,
      next_vaccine: nextVaccine || 'TBA',
      next_date: nextDate || 'TBA'
    };

    const message = processTemplate(SMS_TEMPLATES.VACCINATION_ADMINISTERED.template, variables);

    return smsService.sendSMS(guardianPhone, message, 'vaccination_administered', {
      templateCode: TEMPLATE_CODES.VACCINATION_ADMINISTERED,
      babyName,
      infantId,
      vaccineName,
      doseNumber
    });
  }

  /**
   * Send missed appointment notification
   * @param {Object} data - Missed appointment data
   */
  async sendMissedAppointment(data) {
    const {
      guardianPhone,
      babyName,
      infantId,
      appointmentDate,
      clinicName,
      contactNumber
    } = data;

    const variables = {
      baby_name: babyName,
      infant_id: infantId,
      appointment_date: appointmentDate,
      clinic_name: clinicName,
      contact_number: contactNumber
    };

    const message = processTemplate(SMS_TEMPLATES.MISSED_APPOINTMENT.template, variables);

    return smsService.sendSMS(guardianPhone, message, 'missed_appointment', {
      templateCode: TEMPLATE_CODES.MISSED_APPOINTMENT,
      babyName,
      infantId,
      appointmentDate
    });
  }

  /**
   * Send overdue vaccination alert
   * @param {Object} data - Overdue vaccination data
   */
  async sendOverdueVaccination(data) {
    const {
      guardianPhone,
      babyName,
      infantId,
      vaccineName,
      daysOverdue,
      clinicName,
      contactNumber
    } = data;

    const variables = {
      baby_name: babyName,
      infant_id: infantId,
      vaccine_name: vaccineName,
      days_overdue: daysOverdue,
      clinic_name: clinicName,
      contact_number: contactNumber
    };

    const message = processTemplate(SMS_TEMPLATES.OVERDUE_VACCINATION.template, variables);

    return smsService.sendSMS(guardianPhone, message, 'overdue_vaccination', {
      templateCode: TEMPLATE_CODES.OVERDUE_VACCINATION,
      priority: 'urgent',
      babyName,
      infantId,
      vaccineName,
      daysOverdue
    });
  }

  /**
   * Send health checkup notification
   * @param {Object} data - Health checkup data
   */
  async sendHealthCheckupNotification(data) {
    const {
      guardianPhone,
      babyName,
      infantId,
      appointmentDate,
      appointmentTime,
      clinicName,
      documentsReq
    } = data;

    const variables = {
      baby_name: babyName,
      infant_id: infantId,
      appointment_date: appointmentDate,
      appointment_time: appointmentTime,
      clinic_name: clinicName,
      documents_req: documentsReq || 'health booklet'
    };

    const message = processTemplate(SMS_TEMPLATES.HEALTH_CHECKUP_NOTIFICATION.template, variables);

    return smsService.sendSMS(guardianPhone, message, 'health_checkup', {
      templateCode: TEMPLATE_CODES.HEALTH_CHECKUP,
      babyName,
      infantId,
      appointmentDate
    });
  }

  /**
   * Send dosage reminder
   * @param {Object} data - Dosage reminder data
   */
  async sendDosageReminder(data) {
    const {
      guardianPhone,
      babyName,
      infantId,
      medicineName,
      dosageAmount,
      scheduledTime,
      instructions
    } = data;

    const variables = {
      baby_name: babyName,
      infant_id: infantId,
      medicine_name: medicineName,
      dosage_amount: dosageAmount,
      scheduled_time: scheduledTime,
      instructions: instructions || 'as directed'
    };

    const message = processTemplate(SMS_TEMPLATES.DOSAGE_REMINDER.template, variables);

    return smsService.sendSMS(guardianPhone, message, 'dosage_reminder', {
      templateCode: TEMPLATE_CODES.DOSAGE_REMINDER,
      babyName,
      infantId,
      medicineName
    });
  }

  /**
   * Send clinic update
   * @param {Object} data - Clinic update data
   */
  async sendClinicUpdate(data) {
    const {
      guardianPhone,
      clinicName,
      updateMessage,
      contactNumber
    } = data;

    const variables = {
      clinic_name: clinicName,
      update_message: updateMessage,
      contact_number: contactNumber
    };

    const message = processTemplate(SMS_TEMPLATES.CLINIC_UPDATE.template, variables);

    return smsService.sendSMS(guardianPhone, message, 'clinic_update', {
      templateCode: TEMPLATE_CODES.CLINIC_UPDATE,
      clinicName
    });
  }

  /**
   * Send emergency alert
   * @param {Object} data - Emergency alert data
   */
  async sendEmergencyAlert(data) {
    const {
      guardianPhone,
      alertMessage,
      clinicName,
      contactNumber
    } = data;

    const variables = {
      alert_message: alertMessage,
      clinic_name: clinicName,
      contact_number: contactNumber
    };

    const message = processTemplate(SMS_TEMPLATES.EMERGENCY_ALERT.template, variables);

    return smsService.sendSMS(guardianPhone, message, 'emergency_alert', {
      templateCode: TEMPLATE_CODES.EMERGENCY_ALERT,
      priority: 'urgent',
      alertMessage
    });
  }

  /**
   * Send payment notification
   * @param {Object} data - Payment notification data
   */
  async sendPaymentNotification(data) {
    const {
      guardianPhone,
      paymentMessage,
      amount,
      dueDate,
      clinicName,
      paymentLink
    } = data;

    const variables = {
      payment_message: paymentMessage,
      amount: amount,
      due_date: dueDate,
      clinic_name: clinicName,
      payment_link: paymentLink || 'visit clinic'
    };

    const message = processTemplate(SMS_TEMPLATES.PAYMENT_NOTIFICATION.template, variables);

    return smsService.sendSMS(guardianPhone, message, 'payment_notification', {
      templateCode: TEMPLATE_CODES.PAYMENT_NOTIFICATION,
      amount,
      dueDate
    });
  }

  /**
   * Send password reset SMS
   * @param {Object} data - Password reset data
   */
  async sendPasswordReset(data) {
    const {
      phoneNumber,
      verificationCode,
      expiresMinutes = 10
    } = data;

    const variables = {
      verification_code: verificationCode,
      expires_minutes: expiresMinutes
    };

    const message = processTemplate(SMS_TEMPLATES.PASSWORD_RESET.template, variables);

    return smsService.sendSMS(phoneNumber, message, 'password_reset', {
      templateCode: TEMPLATE_CODES.PASSWORD_RESET,
      purpose: 'password_reset'
    });
  }

  /**
   * Send account verification SMS
   * @param {Object} data - Account verification data
   */
  async sendAccountVerification(data) {
    const {
      phoneNumber,
      verificationCode
    } = data;

    const variables = {
      verification_code: verificationCode
    };

    const message = processTemplate(SMS_TEMPLATES.ACCOUNT_VERIFICATION.template, variables);

    return smsService.sendSMS(phoneNumber, message, 'account_verification', {
      templateCode: TEMPLATE_CODES.ACCOUNT_VERIFICATION,
      purpose: 'account_verification'
    });
  }

  /**
   * Send profile update notification
   * @param {Object} data - Profile update data
   */
  async sendProfileUpdate(data) {
    const {
      guardianPhone,
      contactNumber
    } = data;

    const variables = {
      contact_number: contactNumber
    };

    const message = processTemplate(SMS_TEMPLATES.PROFILE_UPDATE.template, variables);

    return smsService.sendSMS(guardianPhone, message, 'profile_update', {
      templateCode: TEMPLATE_CODES.PROFILE_UPDATE
    });
  }

  /**
   * Send new message notification
   * @param {Object} data - New message data
   */
  async sendNewMessageNotification(data) {
    const {
      guardianPhone,
      senderName,
      messageSubject
    } = data;

    const variables = {
      sender_name: senderName,
      message_subject: messageSubject || 'No subject'
    };

    const message = processTemplate(SMS_TEMPLATES.NEW_MESSAGE.template, variables);

    return smsService.sendSMS(guardianPhone, message, 'new_message', {
      templateCode: TEMPLATE_CODES.NEW_MESSAGE,
      senderName
    });
  }

  /**
   * Send follow-up appointment notification
   * @param {Object} data - Follow-up appointment data
   */
  async sendFollowUpAppointment(data) {
    const {
      guardianPhone,
      babyName,
      infantId,
      appointmentDate,
      appointmentTime,
      clinicName,
      doctorName
    } = data;

    const variables = {
      baby_name: babyName,
      infant_id: infantId,
      appointment_date: appointmentDate,
      appointment_time: appointmentTime,
      clinic_name: clinicName,
      doctor_name: doctorName || 'your doctor'
    };

    const message = processTemplate(SMS_TEMPLATES.FOLLOWUP_APPOINTMENT.template, variables);

    return smsService.sendSMS(guardianPhone, message, 'followup_appointment', {
      templateCode: TEMPLATE_CODES.FOLLOWUP_APPOINTMENT,
      babyName,
      infantId,
      appointmentDate
    });
  }

  /**
   * Send cancellation options
   * @param {Object} data - Cancellation options data
   */
  async sendCancellationOptions(data) {
    const {
      guardianPhone,
      babyName,
      appointmentDate,
      contactNumber
    } = data;

    const variables = {
      baby_name: babyName,
      appointment_date: appointmentDate,
      contact_number: contactNumber
    };

    const message = processTemplate(SMS_TEMPLATES.CANCELLATION_OPTIONS.template, variables);

    return smsService.sendSMS(guardianPhone, message, 'cancellation_options', {
      templateCode: TEMPLATE_CODES.CANCELLATION_OPTIONS,
      babyName,
      appointmentDate
    });
  }

  /**
   * Send rescheduling options
   * @param {Object} data - Rescheduling options data
   */
  async sendReschedulingOptions(data) {
    const {
      guardianPhone,
      babyName,
      clinicName,
      contactNumber,
      availableSlots
    } = data;

    const variables = {
      baby_name: babyName,
      clinic_name: clinicName,
      contact_number: contactNumber,
      available_slots: availableSlots || 'contact us'
    };

    const message = processTemplate(SMS_TEMPLATES.RESCHEDULING_OPTIONS.template, variables);

    return smsService.sendSMS(guardianPhone, message, 'rescheduling_options', {
      templateCode: TEMPLATE_CODES.RESCHEDULING_OPTIONS,
      babyName
    });
  }

  // ========================================
  // ADMIN-ONLY NOTIFICATIONS
  // ========================================

  /**
   * Send inventory alert (Admin)
   * @param {Object} data - Inventory alert data
   */
  async sendInventoryAlert(data) {
    const {
      adminPhone,
      vaccineName,
      currentStock,
      threshold
    } = data;

    const variables = {
      vaccine_name: vaccineName,
      current_stock: currentStock,
      threshold: threshold
    };

    const message = processTemplate(SMS_TEMPLATES.INVENTORY_ALERT.template, variables);

    return smsService.sendSMS(adminPhone, message, 'inventory_alert', {
      templateCode: TEMPLATE_CODES.INVENTORY_ALERT,
      priority: 'high',
      vaccineName,
      currentStock
    });
  }

  /**
   * Send expiry warning (Admin)
   * @param {Object} data - Expiry warning data
   */
  async sendExpiryWarning(data) {
    const {
      adminPhone,
      vaccineName,
      lotNumber,
      daysUntilExpiry
    } = data;

    const variables = {
      vaccine_name: vaccineName,
      lot_number: lotNumber,
      days_until_expiry: daysUntilExpiry
    };

    const message = processTemplate(SMS_TEMPLATES.EXPIRY_WARNING.template, variables);

    return smsService.sendSMS(adminPhone, message, 'expiry_warning', {
      templateCode: TEMPLATE_CODES.EXPIRY_WARNING,
      priority: 'high',
      vaccineName,
      lotNumber
    });
  }

  /**
   * Send critical stock alert (Admin)
   * @param {Object} data - Critical stock data
   */
  async sendCriticalStockAlert(data) {
    const {
      adminPhone,
      vaccineName,
      currentStock
    } = data;

    const variables = {
      vaccine_name: vaccineName,
      current_stock: currentStock
    };

    const message = processTemplate(SMS_TEMPLATES.CRITICAL_STOCK_ALERT.template, variables);

    return smsService.sendSMS(adminPhone, message, 'critical_stock_alert', {
      templateCode: TEMPLATE_CODES.CRITICAL_STOCK_ALERT,
      priority: 'urgent',
      vaccineName,
      currentStock
    });
  }

  /**
   * Send vaccine unavailable notification (Admin)
   * @param {Object} data - Vaccine unavailable data
   */
  async sendVaccineUnavailable(data) {
    const {
      adminPhone,
      vaccineName,
      healthCenter
    } = data;

    const variables = {
      vaccine_name: vaccineName,
      health_center: healthCenter
    };

    const message = processTemplate(SMS_TEMPLATES.VACCINE_UNAVAILABLE.template, variables);

    return smsService.sendSMS(adminPhone, message, 'vaccine_unavailable', {
      templateCode: TEMPLATE_CODES.VACCINE_UNAVAILABLE,
      priority: 'high',
      vaccineName
    });
  }

  // ========================================
  // UTILITY METHODS
  // ========================================

  /**
   * Send custom message using a template
   * @param {string} templateCode - Template code (e.g., 'G1', 'G2')
   * @param {string} phoneNumber - Recipient phone number
   * @param {Object} variables - Template variables
   */
  async sendFromTemplate(templateCode, phoneNumber, variables) {
    const template = SMS_TEMPLATES[templateCode];
    if (!template) {
      throw new Error(`Unknown template code: ${templateCode}`);
    }

    const message = processTemplate(template.template, variables);

    return smsService.sendSMS(phoneNumber, message, templateCode.toLowerCase(), {
      templateCode,
      priority: template.priority,
      ...variables
    });
  }

  /**
   * Get template preview without sending
   * @param {string} templateCode - Template code
   * @param {Object} variables - Template variables
   * @returns {Object} - Preview object with message and metadata
   */
  previewTemplate(templateCode, variables) {
    const template = SMS_TEMPLATES[templateCode];
    if (!template) {
      throw new Error(`Unknown template code: ${templateCode}`);
    }

    const message = processTemplate(template.template, variables);
    const extendedMessage = template.templateExtended
      ? processTemplate(template.templateExtended, variables)
      : null;

    return {
      code: templateCode,
      priority: template.priority,
      standard: {
        message,
        length: message.length,
        segments: Math.ceil(message.length / 153)
      },
      extended: extendedMessage ? {
        message: extendedMessage,
        length: extendedMessage.length,
        segments: Math.ceil(extendedMessage.length / 153)
      } : null,
      variables: template.variables,
      estimatedCostPHP: Math.ceil(message.length / 153) * 2.5
    };
  }
}

// Export singleton instance
module.exports = new SMSTemplateService();
module.exports.SMSTemplateService = SMSTemplateService;
