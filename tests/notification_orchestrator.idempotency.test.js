process.env.DB_SUPPRESS_POOL_LOGS = 'true';

const mockPoolQuery = jest.fn();
const mockSendSMS = jest.fn();
const mockSendEmail = jest.fn();
const mockSendNotification = jest.fn();

jest.mock('../db', () => ({
  query: (...args) => mockPoolQuery(...args),
}));

jest.mock('../services/smsService', () => ({
  sendSMS: (...args) => mockSendSMS(...args),
}));

jest.mock('../services/emailService', () => ({
  sendEmail: (...args) => mockSendEmail(...args),
}));

jest.mock('../services/notificationService', () => {
  return jest.fn().mockImplementation(() => ({
    sendNotification: (...args) => mockSendNotification(...args),
  }));
});

const { orchestrateNotificationEvent } = require('../services/notificationOrchestrator');

const buildAppointmentEvent = (overrides = {}) => ({
  eventType: 'appointment_confirmation',
  recipient: {
    targetType: 'guardian',
    targetId: 44,
    guardianId: 44,
    name: 'Guardian Sample',
    email: 'guardian@example.com',
    phone: '+639171234567',
  },
  payload: {
    childName: 'Baby Sample',
    vaccineName: 'BCG',
    appointmentAt: '2026-03-12T10:00:00.000Z',
    appointmentStatus: 'scheduled',
  },
  occurredAt: '2026-03-12T09:00:00.000Z',
  ...overrides,
});

describe('notificationOrchestrator idempotency + dedupe foundations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns duplicate_in_progress when advisory lock is not acquired', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ locked: false }] });

    const result = await orchestrateNotificationEvent(buildAppointmentEvent());

    expect(result).toMatchObject({
      success: false,
      idempotent: true,
      reason: 'duplicate_in_progress',
    });
    expect(mockPoolQuery).toHaveBeenCalledTimes(1);
    expect(mockSendSMS).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it('returns idempotent response when a prior notification exists for the same key', async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ locked: true }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 901,
            status: 'sent',
            within_dedupe_window: true,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ pg_advisory_unlock: true }] });

    const result = await orchestrateNotificationEvent(buildAppointmentEvent());

    expect(result).toMatchObject({
      success: true,
      idempotent: true,
      previousNotificationId: 901,
      previousStatus: 'sent',
      withinDedupeWindow: true,
    });
    expect(mockSendSMS).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it('fans out notification and persists idempotency + dedupe fields for all channels', async () => {
    mockSendSMS.mockResolvedValue({
      provider: 'textbee',
      messageId: 'sms-001',
      raw: { ok: true },
    });
    mockSendEmail.mockResolvedValue({
      success: true,
      messageId: 'email-001',
    });
    mockSendNotification.mockResolvedValue({
      notification: {
        id: 321,
        status: 'pending',
      },
    });

    mockPoolQuery.mockImplementation(async (queryText) => {
      if (/pg_try_advisory_lock/i.test(queryText)) {
        return { rows: [{ locked: true }] };
      }

      if (/FROM notifications/i.test(queryText)) {
        return { rows: [] };
      }

      if (/FROM notification_logs/i.test(queryText)) {
        return { rows: [] };
      }

      if (/INSERT INTO notification_logs/i.test(queryText)) {
        return { rows: [] };
      }

      if (/pg_advisory_unlock/i.test(queryText)) {
        return { rows: [{ pg_advisory_unlock: true }] };
      }

      throw new Error(`Unexpected query: ${queryText}`);
    });

    const result = await orchestrateNotificationEvent(buildAppointmentEvent());

    expect(result).toMatchObject({
      success: true,
      idempotent: false,
      eventType: 'appointment_confirmation',
      inAppNotificationId: 321,
    });
    expect(result.idempotencyKey).toMatch(/^[a-f0-9]{64}$/);
    expect(result.traceId).toEqual(expect.any(String));

    expect(mockSendSMS).toHaveBeenCalledTimes(1);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        notification_type: 'appointment_confirmation',
        event_type: 'appointment_confirmation',
        idempotency_key: result.idempotencyKey,
        trace_id: result.traceId,
        skipImmediateProcessing: true,
      }),
    );

    const notificationLogInsertCalls = mockPoolQuery.mock.calls.filter(
      ([queryText]) => /INSERT INTO notification_logs/i.test(queryText),
    );

    expect(notificationLogInsertCalls).toHaveLength(3);

    const insertedDedupeKeys = notificationLogInsertCalls.map(([, params]) => params[params.length - 1]);
    expect(insertedDedupeKeys).toEqual(
      expect.arrayContaining([
        `sms:${result.idempotencyKey}`,
        `email:${result.idempotencyKey}`,
        `inapp:${result.idempotencyKey}`,
      ]),
    );

    const insertedIdempotencyKeys = notificationLogInsertCalls.map(
      ([, params]) => params[params.length - 2],
    );
    expect(new Set(insertedIdempotencyKeys)).toEqual(new Set([result.idempotencyKey]));
  });

  it('skips a channel when a dedupe log already exists', async () => {
    let dedupeChecks = 0;

    mockSendEmail.mockResolvedValue({ success: true, messageId: 'email-201' });
    mockSendNotification.mockResolvedValue({ notification: { id: 401, status: 'pending' } });

    mockPoolQuery.mockImplementation(async (queryText) => {
      if (/pg_try_advisory_lock/i.test(queryText)) {
        return { rows: [{ locked: true }] };
      }

      if (/FROM notifications/i.test(queryText)) {
        return { rows: [] };
      }

      if (/FROM notification_logs/i.test(queryText)) {
        dedupeChecks += 1;
        if (dedupeChecks === 1) {
          return {
            rows: [
              {
                id: 17,
                status: 'sent',
                within_dedupe_window: true,
              },
            ],
          };
        }
        return { rows: [] };
      }

      if (/INSERT INTO notification_logs/i.test(queryText)) {
        return { rows: [] };
      }

      if (/pg_advisory_unlock/i.test(queryText)) {
        return { rows: [{ pg_advisory_unlock: true }] };
      }

      throw new Error(`Unexpected query: ${queryText}`);
    });

    const result = await orchestrateNotificationEvent(buildAppointmentEvent());

    expect(result.success).toBe(true);
    expect(result.channelStatus.sms).toMatchObject({
      status: 'skipped',
      error: 'skipped due to deduplication',
    });
    expect(mockSendSMS).not.toHaveBeenCalled();
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendNotification).toHaveBeenCalledTimes(1);
  });
});
