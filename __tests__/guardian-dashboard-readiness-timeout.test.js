jest.mock('../db', () => ({
  query: jest.fn(),
}));

jest.mock('../middleware/auth', () => ({
  authenticateToken: jest.fn((_req, _res, next) => next()),
}));

jest.mock('../middleware/rbac', () => ({
  requirePermission: jest.fn(() => (_req, _res, next) => next()),
  requireHealthCenterAccess: jest.fn(() => (_req, _res, next) => next()),
  getCanonicalRole: jest.fn(() => 'guardian'),
  CANONICAL_ROLES: {
    GUARDIAN: 'guardian',
    SYSTEM_ADMIN: 'system_admin',
  },
}));

jest.mock('../routes/analytics', () => {
  const express = require('express');
  return express.Router();
});

jest.mock('../utils/schemaHelpers', () => ({
  resolvePatientColumn: jest.fn(),
  resolvePatientTable: jest.fn(),
  resolvePatientScopeExpression: jest.fn(),
}));

jest.mock('../middleware/guardianScope', () => ({
  resolveGuardianId: jest.fn(() => 1),
}));

jest.mock('../services/entityScopeService', () => ({
  resolveEffectiveScope: jest.fn(),
  resolveUserScopeIds: jest.fn(),
}));

jest.mock('../services/adminMetricsService', () => ({
  getDashboardMetrics: jest.fn(),
}));

jest.mock('../services/immunizationScheduleService', () => ({
  getGuardianScheduleProjection: jest.fn(),
}));

const immunizationScheduleService = require('../services/immunizationScheduleService');
const dashboardRouter = require('../routes/dashboard');

describe('guardian dashboard readiness timeout safeguard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('collects available due vaccines without hanging on a stalled readiness lookup', async () => {
    const { collectGuardianDueVaccines } = dashboardRouter.__testables;

    immunizationScheduleService.getGuardianScheduleProjection
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValueOnce({
        schedules: [
          {
            vaccineId: 1,
            vaccineName: 'BCG',
            doseNumber: 1,
            dueDate: '2000-01-01',
            dueDateKey: '2000-01-01',
            isCompleted: false,
            isNextDueDose: true,
          },
        ],
      });

    const result = await collectGuardianDueVaccines(
      [
        { id: 100, first_name: 'Slow', last_name: 'Child' },
        { id: 200, first_name: 'Ready', last_name: 'Child' },
      ],
      5,
      10,
    );

    expect(result.readinessFailures).toBe(1);
    expect(result.readinessProcessed).toBe(1);
    expect(result.allDueVaccines).toHaveLength(1);
    expect(result.visibleDueVaccines[0]).toMatchObject({
      childId: 200,
      childName: 'Ready Child',
      vaccineName: 'BCG (Dose 1)',
      status: 'overdue',
    });
  });
});
