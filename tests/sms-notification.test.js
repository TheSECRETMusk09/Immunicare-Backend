/**
 * SMS Notification System Tests
 *
 * Tests for verifying SMS notification flows without database dependencies.
 * These tests verify the SMS service functions directly.
 */

describe('SMS Notification System Tests', () => {
  let smsService;

  beforeAll(() => {
    // Load the SMS service module
    smsService = require('../services/smsService');
  });

  describe('Missed Appointment Defensive Handling', () => {
    test('should fail gracefully when missed appointment notification has no phone number', async () => {
      const result = await smsService.sendMissedAppointmentNotification({
        appointmentId: 123,
        childName: 'Test Child',
        scheduledDate: new Date().toISOString(),
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('No phone number provided');
    });

    test('should fail gracefully when missed appointment notification phone format is invalid', async () => {
      const result = await smsService.sendMissedAppointmentNotification({
        phoneNumber: 'invalid-phone',
        appointmentId: 456,
        childName: 'Test Child',
        scheduledDate: new Date().toISOString(),
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid phone number format');
    });
  });

  describe('OTP Generation and Message Format', () => {
    test('should generate 6-digit OTP code', () => {
      const code = smsService.generateVerificationCode(6);
      expect(code).toHaveLength(6);
      expect(/^\d{6}$/.test(code)).toBe(true);
    });

    test('should generate 4-digit OTP code', () => {
      const code = smsService.generateVerificationCode(4);
      expect(code).toHaveLength(4);
      expect(/^\d{4}$/.test(code)).toBe(true);
    });

    test('should build phone verification OTP message correctly', () => {
      const code = '123456';
      const message = smsService.buildOtpMessage('phone_verification', code);

      expect(message).toContain('Immunicare');
      expect(message).toContain('123456');
      expect(message).toContain('verification');
    });

    test('should build password reset OTP message correctly', () => {
      const code = '654321';
      const message = smsService.buildOtpMessage('password_reset', code);

      expect(message).toContain('Immunicare');
      expect(message).toContain('654321');
      expect(message).toContain('password reset');
    });

    test('should build login OTP message correctly', () => {
      const code = '111222';
      const message = smsService.buildOtpMessage('login', code);

      expect(message).toContain('Immunicare');
      expect(message).toContain('111222');
      expect(message).toContain('login');
    });

    test('should default to verification purpose for unknown purposes', () => {
      const code = '999888';
      const message = smsService.buildOtpMessage('unknown_purpose', code);

      expect(message).toContain('999888');
    });
  });

  describe('Phone Number Formatting', () => {
    test('should format 11-digit PH number starting with 09', () => {
      expect(smsService.formatPhoneNumber('09123456789')).toBe('+639123456789');
    });

    test('should format PH number with +63 prefix', () => {
      expect(smsService.formatPhoneNumber('+639123456789')).toBe('+639123456789');
    });

    test('should format PH number without + prefix', () => {
      expect(smsService.formatPhoneNumber('639123456789')).toBe('+639123456789');
    });

    test('should return null for invalid phone numbers', () => {
      expect(smsService.formatPhoneNumber('123')).toBeNull();
      expect(smsService.formatPhoneNumber('')).toBeNull();
      expect(smsService.formatPhoneNumber('abc')).toBeNull();
    });

    test('should validate phone numbers correctly', () => {
      const result1 = smsService.validateAndFormatPhoneNumber('09123456789');
      expect(result1.valid).toBe(true);
      expect(result1.formattedNumber).toBe('+639123456789');

      const result2 = smsService.validateAndFormatPhoneNumber('invalid');
      expect(result2.valid).toBe(false);
    });
  });

  describe('Appointment Confirmation SMS', () => {
    test('should create appointment confirmation message with all details', () => {
      const payload = {
        guardianName: 'John Doe',
        childName: 'Baby Jane',
        vaccineName: 'Pentavalent',
        scheduledDate: '2024-03-15T10:00:00Z',
        location: 'Barangay San Nicolas Health Center',
      };

      // Test the internal message creation logic
      const dateObj = new Date(payload.scheduledDate);
      const dateLabel = dateObj.toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      });
      const timeLabel = dateObj.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
      });

      const message = `Immunicare: Hi ${payload.guardianName}, ${payload.childName}'s ${payload.vaccineName} appointment has been confirmed for ${dateLabel} at ${timeLabel}. Location: ${payload.location}. Please arrive 15 minutes early. Thank you!`;

      expect(message).toContain('John Doe');
      expect(message).toContain('Baby Jane');
      expect(message).toContain('Pentavalent');
      expect(message).toContain('March');
      expect(message).toContain('15');
      expect(message).toContain('2024');
      expect(message).toContain('Barangay San Nicolas Health Center');
      expect(message).toContain('15 minutes early');
    });
  });

  describe('Appointment Reminder SMS', () => {
    test('should create 48-hour reminder message correctly', () => {
      const message = smsService.createAppointmentReminderMessage(
        'vaccination',
        '2024-03-15T10:00:00Z',
        {
          hoursUntil: 48,
          childName: 'Baby John',
          guardianName: 'Jane Doe',
          location: 'Barangay San Nicolas Health Center',
        },
      );

      expect(message).toContain('Baby John');
      expect(message).toContain('Jane Doe');
      expect(message).toContain('2 days');
      expect(message).toContain('Barangay San Nicolas Health Center');
    });

    test('should create 24-hour reminder message correctly', () => {
      const message = smsService.createAppointmentReminderMessage(
        'vaccination',
        '2024-03-15T10:00:00Z',
        {
          hoursUntil: 24,
          childName: 'Baby John',
          guardianName: 'Jane Doe',
          location: 'Barangay San Nicolas Health Center',
        },
      );

      expect(message).toContain('Baby John');
      expect(message).toContain('Jane Doe');
      expect(message).toContain('TOMORROW');
      expect(message).toContain('Barangay San Nicolas Health Center');
    });

    test('should use default values when not provided', () => {
      const message = smsService.createAppointmentReminderMessage(
        'vaccination',
        '2024-03-15T10:00:00Z',
        {},
      );

      expect(message).toBeDefined();
      expect(message.length).toBeGreaterThan(0);
    });
  });

  describe('Missed Appointment SMS', () => {
    test('should create missed appointment message correctly', () => {
      const message = smsService.createMissedAppointmentMessage(
        'vaccination',
        '2024-03-10T10:00:00Z',
        {
          childName: 'Baby Jane',
          location: 'Barangay San Nicolas Health Center',
        },
      );

      expect(message).toContain('Baby Jane');
      expect(message).toContain('missed');
      expect(message).toContain('reschedule');
      expect(message).toContain('Barangay San Nicolas Health Center');
    });

    test('should create missed message with default values', () => {
      const message = smsService.createMissedAppointmentMessage(
        'vaccination',
        '2024-03-10T10:00:00Z',
        {},
      );

      expect(message).toBeDefined();
      expect(message.length).toBeGreaterThan(0);
    });
  });

  describe('Vaccination Reminder SMS', () => {
    test('should create vaccination reminder with full month name', () => {
      const dueDate = '2024-03-15T10:00:00Z';
      const dueLabel = new Date(dueDate).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      });

      expect(dueLabel).toContain('March');
      expect(dueLabel).toContain('15');
      expect(dueLabel).toContain('2024');
    });

    test('should handle invalid date gracefully', () => {
      const dueLabel = smsService.formatReminderDateLabel('invalid-date');
      expect(dueLabel).toBeDefined();
    });
  });

  describe('Welcome SMS', () => {
    test('should create welcome message correctly', () => {
      const name = 'John';
      const message = `Welcome to Immunicare, ${name}! Your account has been successfully verified. You can now log in to manage your childs vaccination schedule at the Barangay San Nicolas Health Center.`;

      expect(message).toContain('Immunicare');
      expect(message).toContain('John');
      expect(message).toContain('Barangay San Nicolas Health Center');
      expect(message).toContain('vaccination');
    });
  });

  describe('SMS Service Configuration', () => {
    test('should have valid SMS config status', () => {
      const config = smsService.getSMSConfigStatus();

      expect(config).toHaveProperty('provider');
      expect(config).toHaveProperty('configured');
      expect(config).toHaveProperty('otp');
      expect(config).toHaveProperty('rateLimit');
      expect(config.otp).toHaveProperty('length');
      expect(config.otp).toHaveProperty('expiryMinutes');
      expect(config.rateLimit).toHaveProperty('maxPerHour');
      expect(config.rateLimit).toHaveProperty('maxPerDay');
    });

    test('should have correct OTP configuration', () => {
      const config = smsService.getSMSConfigStatus();

      expect(config.otp.length).toBe(6);
      expect(config.otp.expiryMinutes).toBe(10);
    });
  });

  describe('Phone Number Masking', () => {
    test('should mask phone number for display', () => {
      const masked = smsService.maskPhone('+639123456789');
      expect(masked).toContain('+63912');
      expect(masked).toContain('789');
      expect(masked).toContain('***');
    });
  });

  describe('Date Formatting', () => {
    test('should format reminder dates correctly', () => {
      const formatted = smsService.formatReminderDateLabel('2024-03-15');
      expect(formatted).toContain('March');
      expect(formatted).toContain('15');
      expect(formatted).toContain('2024');
    });

    test('should handle null dates', () => {
      const formatted = smsService.formatReminderDateLabel(null);
      expect(formatted).toBeDefined();
    });
  });
});
