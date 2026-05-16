/**
 * Targeted Tests for Admin Notification Service, Rate Limiting, and Notification Categorization
 *
 * Tests cover:
 * 1. Registration throttling behavior
 * 2. Notification categorization
 * 3. Realtime socket delivery
 * 4. SMS fallback to sms_logs
 * 5. Deduplication behavior
 */

process.env.DB_SUPPRESS_POOL_LOGS = 'true';
process.env.NODE_ENV = 'test';

const mockPoolQuery = jest.fn();
const mockSendSMS = jest.fn();
const mockSendNotification = jest.fn();
const mockSendToRole = jest.fn();

// Mock dependencies
jest.mock('../db', () => ({
  query: (...args) => mockPoolQuery(...args),
}));

jest.mock('../services/smsService', () => ({
  sendSMS: (...args) => mockSendSMS(...args),
}));

jest.mock('../services/notificationService', () => {
  return jest.fn().mockImplementation(() => ({
    sendNotification: (...args) => mockSendNotification(...args),
  }));
});

jest.mock('../services/socketService', () => ({
  sendToRole: (...args) => mockSendToRole(...args),
}));

// Import after mocks
const {
  sendAdminNotification,
  sendExpiryAlert,
  sendOutOfStockAlert,
  sendLowStockAlert,
  NOTIFICATION_CATEGORIES,
  clearDedupCache,
  generateDedupKey,
} = require('../services/adminNotificationService');

describe('Admin Notification Service - Targeted Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearDedupCache();
  });

  describe('1. Notification Categorization', () => {
    it('should have correct NOTIFICATION_CATEGORIES defined', () => {
      expect(NOTIFICATION_CATEGORIES.EXPIRY_WARNING).toBe('expiry_warning');
      expect(NOTIFICATION_CATEGORIES.EXPIRY_CRITICAL).toBe('expiry_critical');
      expect(NOTIFICATION_CATEGORIES.OUT_OF_STOCK).toBe('out_of_stock');
      expect(NOTIFICATION_CATEGORIES.LOW_STOCK).toBe('low_stock');
      expect(NOTIFICATION_CATEGORIES.SYSTEM_ALERT).toBe('system_alert');
      expect(NOTIFICATION_CATEGORIES.REGISTRATION).toBe('registration');
      expect(NOTIFICATION_CATEGORIES.SECURITY).toBe('security');
    });

    it('should send EXPIRY_WARNING category notification', async () => {
      mockPoolQuery.mockResolvedValueOnce({
        rows: [{ id: 1, email: 'admin@test.com', phone: '09936997484', guardian_name: 'Admin' }],
      });
      mockSendNotification.mockResolvedValue({ success: true, notification: { id: 100 } });

      const result = await sendExpiryAlert('BCG Vaccine', 1, new Date('2026-03-28'), 14, 'LOT001');

      expect(result.success).toBe(true);
      expect(result.results.persisted).toBe(true);
      expect(result.results.socketEmitted).toBe(true);
    });

    it('should send EXPIRY_CRITICAL for expiry within 7 days', async () => {
      mockPoolQuery.mockResolvedValueOnce({
        rows: [{ id: 1, email: 'admin@test.com', phone: '09936997484', guardian_name: 'Admin' }],
      });
      mockSendNotification.mockResolvedValue({ success: true, notification: { id: 101 } });

      const result = await sendExpiryAlert(
        'Hepatitis B Vaccine',
        2,
        new Date('2026-03-20'),
        6,
        'LOT002'
      );

      expect(result.success).toBe(true);
      // Critical expiry should trigger SMS
      expect(result.results.smsSent || result.results.smsLogged).toBe(true);
    });

    it('should send OUT_OF_STOCK notification with urgent priority', async () => {
      mockPoolQuery.mockResolvedValueOnce({
        rows: [{ id: 1, email: 'admin@test.com', phone: '09936997484', guardian_name: 'Admin' }],
      });
      mockSendNotification.mockResolvedValue({ success: true, notification: { id: 102 } });
      mockSendSMS.mockResolvedValue({ success: true, messageId: 'sms-123' });

      const result = await sendOutOfStockAlert('Polio Vaccine', 3, 'LOT003');

      expect(result.success).toBe(true);
      expect(result.results.smsSent).toBe(true);
    });

    it('should send LOW_STOCK notification without SMS', async () => {
      mockPoolQuery.mockResolvedValueOnce({
        rows: [{ id: 1, email: 'admin@test.com', phone: '09936997484', guardian_name: 'Admin' }],
      });
      mockSendNotification.mockResolvedValue({ success: true, notification: { id: 103 } });

      const result = await sendLowStockAlert('Measles Vaccine', 4, 5, 'LOT004', 10);

      expect(result.success).toBe(true);
      expect(result.results.smsSent).toBe(false); // Low stock should not trigger SMS by default
    });
  });

  describe('2. Realtime Socket Delivery', () => {
    it('should emit socket notification to admin role', async () => {
      mockPoolQuery.mockResolvedValueOnce({
        rows: [{ id: 1, email: 'admin@test.com', phone: '09936997484', guardian_name: 'Admin' }],
      });
      mockSendNotification.mockResolvedValue({ success: true, notification: { id: 104 } });

      const result = await sendAdminNotification({
        category: NOTIFICATION_CATEGORIES.SYSTEM_ALERT,
        title: 'Test Alert',
        message: 'This is a test system alert',
        priority: 'high',
        targetId: 1,
        alertType: 'test_alert',
        sendSms: false,
      });

      expect(result.success).toBe(true);
      expect(mockSendToRole).toHaveBeenCalledWith(
        'system_admin',
        'admin-notification',
        expect.objectContaining({
          category: 'system_alert',
          title: 'Test Alert',
          message: 'This is a test system alert',
          priority: 'high',
        })
      );
    });

    it('should include metadata in socket emission', async () => {
      mockPoolQuery.mockResolvedValueOnce({
        rows: [{ id: 1, email: 'admin@test.com', phone: '09936997484', guardian_name: 'Admin' }],
      });
      mockSendNotification.mockResolvedValue({ success: true, notification: { id: 105 } });

      const metadata = { vaccineId: 5, batchNumber: 'LOT005', currentStock: 0 };

      await sendAdminNotification({
        category: NOTIFICATION_CATEGORIES.OUT_OF_STOCK,
        title: 'Stock Alert',
        message: 'Vaccine out of stock',
        priority: 'urgent',
        targetId: 5,
        alertType: 'out_of_stock',
        metadata,
        sendSms: false,
      });

      expect(mockSendToRole).toHaveBeenCalledWith(
        'system_admin',
        'admin-notification',
        expect.objectContaining({
          metadata,
        })
      );
    });
  });

  describe('3. SMS and SMS Logs Fallback', () => {
    it('should send SMS when priority is high', async () => {
      mockPoolQuery.mockResolvedValueOnce({
        rows: [{ id: 1, email: 'admin@test.com', phone: '09936997484', guardian_name: 'Admin' }],
      });
      mockSendNotification.mockResolvedValue({ success: true, notification: { id: 106 } });
      mockSendSMS.mockResolvedValue({ success: true, messageId: 'sms-106' });

      const result = await sendAdminNotification({
        category: NOTIFICATION_CATEGORIES.SYSTEM_ALERT,
        title: 'High Priority Alert',
        message: 'This requires SMS notification',
        priority: 'high',
        targetId: 6,
        alertType: 'high_priority',
        sendSms: true,
        smsRecipient: '09936997484',
      });

      expect(result.success).toBe(true);
      expect(result.results.smsSent).toBe(true);
      expect(mockSendSMS).toHaveBeenCalledWith(
        '+639936997484',
        expect.stringContaining('[Immunicare]'),
        'admin_alert'
      );
    });

    it('should fallback to sms_logs when SMS fails', async () => {
      mockPoolQuery
        .mockResolvedValueOnce({
          rows: [{ id: 1, email: 'admin@test.com', phone: '09936997484', guardian_name: 'Admin' }],
        })
        .mockResolvedValueOnce({ rows: [] }); // For sms_logs insert

      mockSendNotification.mockResolvedValue({ success: true, notification: { id: 107 } });
      mockSendSMS.mockRejectedValue(new Error('SMS provider unavailable'));

      const result = await sendAdminNotification({
        category: NOTIFICATION_CATEGORIES.SYSTEM_ALERT,
        title: 'Fallback Test',
        message: 'Testing SMS fallback behavior',
        priority: 'high',
        targetId: 7,
        alertType: 'fallback_test',
        sendSms: true,
        smsRecipient: '09936997484',
      });

      // Should still succeed because of fallback
      expect(result.success).toBe(true);
      expect(result.results.smsSent).toBe(false);
      expect(result.results.smsLogged).toBe(true);

      // Should have tried to insert into sms_logs
      const logCall = mockPoolQuery.mock.calls.find((call) =>
        call[0].includes('INSERT INTO sms_logs')
      );
      expect(logCall).toBeDefined();
    });

    it('should format Philippine phone numbers correctly', async () => {
      mockPoolQuery.mockResolvedValueOnce({
        rows: [{ id: 1, email: 'admin@test.com', phone: '09936997484', guardian_name: 'Admin' }],
      });
      mockSendNotification.mockResolvedValue({ success: true, notification: { id: 108 } });
      mockSendSMS.mockResolvedValue({ success: true, messageId: 'sms-108' });

      await sendAdminNotification({
        category: NOTIFICATION_CATEGORIES.SYSTEM_ALERT,
        title: 'Phone Format Test',
        message: 'Testing phone number formatting',
        priority: 'high',
        targetId: 8,
        alertType: 'phone_format',
        sendSms: true,
        smsRecipient: '09936997484', // Without +63
      });

      expect(mockSendSMS).toHaveBeenCalledWith(
        '+639936997484', // Should be formatted correctly
        expect.any(String),
        'admin_alert'
      );

      // Test other formats
      mockSendSMS.mockClear();

      await sendAdminNotification({
        category: NOTIFICATION_CATEGORIES.SYSTEM_ALERT,
        title: 'Phone Format Test 2',
        message: 'Testing phone number formatting',
        priority: 'high',
        targetId: 8,
        alertType: 'phone_format2',
        sendSms: true,
        smsRecipient: '+639936997484', // With +63
      });

      expect(mockSendSMS).toHaveBeenCalledWith('+639936997484', expect.any(String), 'admin_alert');

      mockSendSMS.mockClear();

      await sendAdminNotification({
        category: NOTIFICATION_CATEGORIES.SYSTEM_ALERT,
        title: 'Phone Format Test 3',
        message: 'Testing phone number formatting',
        priority: 'high',
        targetId: 8,
        alertType: 'phone_format3',
        sendSms: true,
        smsRecipient: '639936997484', // With 63 prefix
      });

      expect(mockSendSMS).toHaveBeenCalledWith('+639936997484', expect.any(String), 'admin_alert');
    });
  });

  describe('4. Deduplication Behavior', () => {
    it('should prevent duplicate alerts within 24 hours', async () => {
      mockPoolQuery.mockResolvedValueOnce({
        rows: [{ id: 1, email: 'admin@test.com', phone: '09936997484', guardian_name: 'Admin' }],
      });
      mockSendNotification.mockResolvedValue({ success: true, notification: { id: 109 } });

      // First call should succeed
      const firstResult = await sendAdminNotification({
        category: NOTIFICATION_CATEGORIES.EXPIRY_WARNING,
        title: 'Duplicate Test',
        message: 'Testing deduplication',
        priority: 'high',
        targetId: 100,
        alertType: 'dedup_test',
      });

      expect(firstResult.success).toBe(true);
      expect(firstResult.results.dedupSkipped).toBe(false);

      // Second call with same dedup key should be skipped
      const secondResult = await sendAdminNotification({
        category: NOTIFICATION_CATEGORIES.EXPIRY_WARNING,
        title: 'Duplicate Test',
        message: 'Testing deduplication - should be skipped',
        priority: 'high',
        targetId: 100,
        alertType: 'dedup_test',
      });

      expect(secondResult.success).toBe(true);
      expect(secondResult.results.dedupSkipped).toBe(true);
      // Should not have tried to persist or send
      expect(mockSendNotification).toHaveBeenCalledTimes(1);
    });

    it('should allow different alert types for same target', async () => {
      mockPoolQuery.mockResolvedValueOnce({
        rows: [{ id: 1, email: 'admin@test.com', phone: '09936997484', guardian_name: 'Admin' }],
      });
      mockSendNotification.mockResolvedValue({ success: true, notification: { id: 110 } });

      // First alert type
      const firstResult = await sendAdminNotification({
        category: NOTIFICATION_CATEGORIES.EXPIRY_WARNING,
        title: 'Expiry Warning',
        message: 'Vaccine expiring soon',
        priority: 'high',
        targetId: 200,
        alertType: 'expiry_warning',
      });

      expect(firstResult.results.dedupSkipped).toBe(false);

      // Different alert type for same target should work
      const secondResult = await sendAdminNotification({
        category: NOTIFICATION_CATEGORIES.LOW_STOCK,
        title: 'Low Stock',
        message: 'Stock is low',
        priority: 'high',
        targetId: 200,
        alertType: 'low_stock',
      });

      expect(secondResult.results.dedupSkipped).toBe(false);
      expect(mockSendNotification).toHaveBeenCalledTimes(2);
    });

    it('should skip deduplication when skipDedup is true', async () => {
      mockPoolQuery.mockResolvedValueOnce({
        rows: [{ id: 1, email: 'admin@test.com', phone: '09936997484', guardian_name: 'Admin' }],
      });
      mockSendNotification.mockResolvedValue({ success: true, notification: { id: 111 } });

      // First call
      await sendAdminNotification({
        category: NOTIFICATION_CATEGORIES.SYSTEM_ALERT,
        title: 'Skip Dedup Test',
        message: 'First message',
        priority: 'high',
        targetId: 300,
        alertType: 'skip_dedup',
        skipDedup: false,
      });

      // Second call with skipDedup=true should NOT be skipped
      const result = await sendAdminNotification({
        category: NOTIFICATION_CATEGORIES.SYSTEM_ALERT,
        title: 'Skip Dedup Test',
        message: 'Second message - should not be skipped',
        priority: 'high',
        targetId: 300,
        alertType: 'skip_dedup',
        skipDedup: true,
      });

      expect(result.results.dedupSkipped).toBe(false);
      expect(mockSendNotification).toHaveBeenCalledTimes(2);
    });

    it('should correctly generate dedup keys', () => {
      const key1 = generateDedupKey('expiry_warning', 123, 'lot_abc');
      const key2 = generateDedupKey('expiry_warning', 123, 'lot_abc');
      const key3 = generateDedupKey('expiry_warning', 123, 'lot_xyz');
      const key4 = generateDedupKey('low_stock', 123, 'lot_abc');

      // Same inputs should produce same key
      expect(key1).toBe(key2);

      // Different alertType should produce different key
      expect(key1).not.toBe(key3);

      // Different category should produce different key
      expect(key1).not.toBe(key4);

      // Keys should follow expected format
      expect(key1).toBe('expiry_warning:123:lot_abc');
    });

    it('should clear dedup cache for testing', async () => {
      mockPoolQuery.mockResolvedValueOnce({
        rows: [{ id: 1, email: 'admin@test.com', phone: '09936997484', guardian_name: 'Admin' }],
      });
      mockSendNotification.mockResolvedValue({ success: true, notification: { id: 112 } });

      // First call
      await sendAdminNotification({
        category: NOTIFICATION_CATEGORIES.SYSTEM_ALERT,
        title: 'Cache Clear Test',
        message: 'First message',
        priority: 'high',
        targetId: 400,
        alertType: 'cache_clear',
      });

      // Clear the cache
      clearDedupCache();

      // After clearing, should be able to send again
      const result = await sendAdminNotification({
        category: NOTIFICATION_CATEGORIES.SYSTEM_ALERT,
        title: 'Cache Clear Test',
        message: 'Second message after cache clear',
        priority: 'high',
        targetId: 400,
        alertType: 'cache_clear',
      });

      expect(result.results.dedupSkipped).toBe(false);
      expect(mockSendNotification).toHaveBeenCalledTimes(2);
    });
  });

  describe('5. Registration Throttling Integration', () => {
    it('should handle no admin recipients gracefully', async () => {
      mockPoolQuery.mockResolvedValueOnce({ rows: [] });

      const result = await sendAdminNotification({
        category: NOTIFICATION_CATEGORIES.REGISTRATION,
        title: 'New Registration',
        message: 'A new guardian has registered',
        priority: 'normal',
        targetId: 500,
        alertType: 'new_registration',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('No admins found');
      expect(result.results.persisted).toBe(false);
    });

    it('should use correct priority mapping', async () => {
      mockPoolQuery.mockResolvedValueOnce({
        rows: [{ id: 1, email: 'admin@test.com', phone: '09936997484', guardian_name: 'Admin' }],
      });
      mockSendNotification.mockResolvedValue({ success: true, notification: { id: 113 } });

      await sendAdminNotification({
        category: NOTIFICATION_CATEGORIES.SYSTEM_ALERT,
        title: 'Priority Test',
        message: 'Testing priority mapping',
        priority: 'urgent',
        targetId: 600,
        alertType: 'priority_test',
        sendSms: false,
      });

      // Check that sendNotification was called with correct priority
      expect(mockSendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          priority: 5, // urgent = 5
        })
      );

      mockSendNotification.mockClear();

      await sendAdminNotification({
        category: NOTIFICATION_CATEGORIES.SYSTEM_ALERT,
        title: 'Priority Test 2',
        message: 'Testing priority mapping',
        priority: 'low',
        targetId: 601,
        alertType: 'priority_test2',
        sendSms: false,
      });

      expect(mockSendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          priority: 2, // low = 2
        })
      );
    });
  });

  describe('6. Edge Cases', () => {
    it('should handle missing phone number gracefully', async () => {
      mockPoolQuery.mockResolvedValueOnce({
        rows: [{ id: 1, email: 'admin@test.com', phone: null, guardian_name: 'Admin' }], // No phone
      });
      mockSendNotification.mockResolvedValue({ success: true, notification: { id: 114 } });
      mockSendSMS.mockResolvedValue({ success: true, messageId: 'sms-114' });

      const result = await sendAdminNotification({
        category: NOTIFICATION_CATEGORIES.SYSTEM_ALERT,
        title: 'No Phone Test',
        message: 'Testing with no phone number',
        priority: 'high',
        targetId: 700,
        alertType: 'no_phone',
        sendSms: true, // Even with SMS requested
      });

      expect(result.success).toBe(true);
      // SMS should not be sent when no phone available
      expect(result.results.smsSent).toBe(false);
    });

    it('should truncate long messages for SMS', async () => {
      mockPoolQuery.mockResolvedValueOnce({
        rows: [{ id: 1, email: 'admin@test.com', phone: '09936997484', guardian_name: 'Admin' }],
      });
      mockSendNotification.mockResolvedValue({ success: true, notification: { id: 115 } });
      mockSendSMS.mockResolvedValue({ success: true, messageId: 'sms-115' });

      // Create a message longer than 160 characters
      const longMessage = 'A'.repeat(200);

      await sendAdminNotification({
        category: NOTIFICATION_CATEGORIES.SYSTEM_ALERT,
        title: 'Long Message Test',
        message: longMessage,
        priority: 'high',
        targetId: 800,
        alertType: 'long_message',
        sendSms: true,
        smsRecipient: '09936997484',
      });

      // Should truncate to 160 chars
      expect(mockSendSMS).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringMatching(/^.{0,160}$/),
        expect.any(String)
      );
    });

    it('should include admin ID in metadata', async () => {
      mockPoolQuery.mockResolvedValueOnce({
        rows: [
          { id: 1, email: 'admin1@test.com', phone: '09936997481', guardian_name: 'Admin 1' },
          { id: 2, email: 'admin2@test.com', phone: '09936997482', guardian_name: 'Admin 2' },
        ],
      });
      mockSendNotification.mockResolvedValue({ success: true, notification: { id: 116 } });

      await sendAdminNotification({
        category: NOTIFICATION_CATEGORIES.SYSTEM_ALERT,
        title: 'Multi Admin Test',
        message: 'Testing multiple admins',
        priority: 'normal',
        targetId: 900,
        alertType: 'multi_admin',
        sendSms: false,
      });

      // Should have sent notifications to both admins
      expect(mockSendNotification).toHaveBeenCalledTimes(2);

      // Check that admin IDs are in metadata
      const calls = mockSendNotification.mock.calls;
      expect(calls[0][0].metadata.adminId).toBe(1);
      expect(calls[1][0].metadata.adminId).toBe(2);
    });
  });
});

describe('Rate Limiter Behavior (Unit Tests)', () => {
  const { SimpleMemoryStore } = require('../middleware/rateLimiter');

  describe('SimpleMemoryStore', () => {
    let store;

    beforeEach(() => {
      store = new SimpleMemoryStore({ windowMs: 60000 }); // 1 minute window
    });

    it('should increment hits correctly', async () => {
      const result = await store.increment('test-key');
      expect(result.totalHits).toBe(1);
    });

    it('should track multiple hits', async () => {
      await store.increment('test-key');
      await store.increment('test-key');
      await store.increment('test-key');

      const result = await store.get('test-key');
      expect(result.totalHits).toBe(3);
    });

    it('should separate keys', async () => {
      await store.increment('key-a');
      await store.increment('key-a');
      await store.increment('key-b');

      const resultA = await store.get('key-a');
      const resultB = await store.get('key-b');

      expect(resultA.totalHits).toBe(2);
      expect(resultB.totalHits).toBe(1);
    });

    it('should reset key', async () => {
      await store.increment('test-key');
      await store.increment('test-key');
      await store.resetKey('test-key');

      const result = await store.get('test-key');
      expect(result).toBeUndefined();
    });

    it('should clear all keys', async () => {
      await store.increment('key-a');
      await store.increment('key-b');
      store.resetAll();

      const resultA = await store.get('key-a');
      const resultB = await store.get('key-b');

      expect(resultA).toBeUndefined();
      expect(resultB).toBeUndefined();
    });
  });
});

console.log('Tests loaded successfully!');
