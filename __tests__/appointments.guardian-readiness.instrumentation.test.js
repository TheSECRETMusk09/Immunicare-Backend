process.env.APPOINTMENT_READINESS_WARN_MS = '1';

const mockCalculateVaccineReadiness = jest.fn();
const mockLogger = {
  logPerformance: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
};

jest.mock('../db', () => ({
  query: jest.fn(),
}));

jest.mock('../middleware/auth', () => ({
  authenticateToken: (_req, _res, next) => next(),
}));

jest.mock('../middleware/rbac', () => ({
  CANONICAL_ROLES: {
    GUARDIAN: 'GUARDIAN',
    SYSTEM_ADMIN: 'SYSTEM_ADMIN',
  },
  getCanonicalRole: jest.fn(() => 'GUARDIAN'),
  requirePermission: jest.fn(() => (_req, _res, next) => next()),
}));

jest.mock('../services/appointmentConfirmationService', () => ({}));
jest.mock('../services/appointmentSchedulingService', () => ({}));
jest.mock('../services/appointmentControlNumberService', () => ({}));
jest.mock('../services/appointmentSuggestionService', () => ({}));
jest.mock('../services/blockedDatesService', () => ({}));
jest.mock('../services/appointmentRuntimeSchemaService', () => ({
  ensureAppointmentRuntimeSchemaInitialized: jest.fn(),
}));
jest.mock('../services/appointmentEventNotificationService', () => ({
  notifyAdminsOfGuardianAppointmentEvent: jest.fn(),
}));
jest.mock('../services/smsService', () => ({
  sendAppointmentConfirmation: jest.fn(),
  sendAppointmentRescheduledNotification: jest.fn(),
  sendScheduleDateChangedNotification: jest.fn(),
  hasNotificationBeenSent: jest.fn(),
}));
jest.mock('../services/socketService', () => ({
  broadcast: jest.fn(),
}));
jest.mock('../services/infantControlNumberService', () => ({
  getPatientControlNumberById: jest.fn(),
  INFANT_CONTROL_NUMBER_PATTERN: /^INF-\d{4}-\d{6}$/,
}));
jest.mock('../services/auditLogService', () => ({
  writeAuditLog: jest.fn(),
}));
jest.mock('../services/vaccineRulesEngine', () => ({
  calculateVaccineReadiness: (...args) => mockCalculateVaccineReadiness(...args),
}));
jest.mock('../config/logger', () => mockLogger);
jest.mock('../utils/clinicCalendar', () => ({
  CLINIC_TODAY_SQL: 'CURRENT_DATE',
  excludeWeekendVaccinationAppointmentsSql: jest.fn(() => ''),
  getClinicTodayDateKey: jest.fn(() => '2030-03-01'),
  toClinicDateKey: jest.fn((value) => {
    const date = new Date(value);
    return date.toISOString().slice(0, 10);
  }),
  toClinicDateSql: jest.fn(() => 'CURRENT_DATE'),
}));

const appointmentsRouter = require('../routes/appointments');

describe('guardian appointment readiness instrumentation', () => {
  const { enforceGuardianVaccinationEligibility } = appointmentsRouter.__testables;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('logs timing metadata when guardian booking stays pending confirmation', async () => {
    mockCalculateVaccineReadiness.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));

      return {
        success: true,
        data: {
          readinessStatus: 'PENDING_CONFIRMATION',
          dueVaccines: [],
          overdueVaccines: [],
          blockedVaccines: [
            { vaccineId: 12, reason: 'Pending admin confirmation' },
          ],
        },
      };
    });

    await expect(
      enforceGuardianVaccinationEligibility({
        infantId: 44,
        vaccineId: 12,
        appointmentType: 'Vaccination',
        scheduledDate: '2030-03-04',
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'PENDING_CONFIRMATION',
    });

    expect(mockLogger.logPerformance).toHaveBeenCalledWith(
      'guardian_appointment_booking_readiness',
      expect.any(Number),
      expect.objectContaining({
        infantId: 44,
        vaccineId: 12,
        appointmentType: 'Vaccination',
        scheduledDate: '2030-03-04',
        readinessStatus: 'PENDING_CONFIRMATION',
        blockedVaccineCount: 1,
        success: true,
      }),
    );
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Guardian appointment readiness check exceeded expected duration',
      expect.objectContaining({
        infantId: 44,
        readinessStatus: 'PENDING_CONFIRMATION',
        thresholdMs: 1,
      }),
    );
  });
});
