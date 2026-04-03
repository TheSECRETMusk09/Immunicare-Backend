const express = require('express');
const request = require('supertest');

jest.mock('../../db', () => ({
  query: jest.fn(),
}));

jest.mock('../../middleware/auth', () => ({
  authenticateToken: (req, _res, next) => {
    req.user = {
      id: 254553,
      guardian_id: 254400,
      clinic_id: 4,
    };
    next();
  },
}));

jest.mock('../../middleware/rbac', () => ({
  CANONICAL_ROLES: {
    GUARDIAN: 'GUARDIAN',
  },
  getCanonicalRole: () => 'GUARDIAN',
  requirePermission: () => (_req, _res, next) => next(),
}));

jest.mock('../../services/guardianChildRegistrationService', () => ({
  createGuardianChildRecord: jest.fn(),
}));

jest.mock('../../services/infantControlNumberService', () => ({
  resolveOrCreateInfantPatient: jest.fn(),
  INFANT_CONTROL_NUMBER_PATTERN: /.*/,
}));

jest.mock('../../services/atBirthVaccinationService', () => ({
  ensureAtBirthVaccinationRecords: jest.fn(),
}));

jest.mock('../../services/entityScopeService', () => ({
  isScopeRequestAllowed: jest.fn(() => true),
  parsePositiveInt: jest.fn((value) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }),
  resolveEffectiveScope: jest.fn(() => ({
    scopeIds: [4],
    useScope: true,
    userScopeIds: [4],
    requestedScopeIds: [],
    allowSystemScope: false,
  })),
  resolvePatientFacilityId: jest.fn(),
}));

jest.mock('../../services/socketService', () => ({
  broadcast: jest.fn(),
}));

jest.mock('../../services/adminNotificationService', () => ({}));
jest.mock('../../services/infantRuntimeSchemaService', () => ({}));

const pool = require('../../db');

describe('GET /guardian/:guardianId', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/api/infants', require('../../routes/infants'));
  });

  test('returns guardian-owned children without applying guardian clinic scope filters', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 5001,
            first_name: 'Christian',
            last_name: 'Samorin',
            guardian_id: 254400,
            facility_id: 1,
          },
        ],
      });

    const response = await request(app).get('/api/infants/guardian/254400');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: [
        expect.objectContaining({
          id: 5001,
          first_name: 'Christian',
          last_name: 'Samorin',
          guardian_id: 254400,
          facility_id: 1,
        }),
      ],
    });

    expect(pool.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('WHERE p.guardian_id = $1'),
      [254400],
    );
    expect(pool.query).not.toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      expect.arrayContaining([[4]]),
    );
  });
});
