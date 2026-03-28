process.env.DB_SUPPRESS_POOL_LOGS = 'true';

const express = require('express');
const request = require('supertest');

const mockClientQuery = jest.fn();
const mockPoolQuery = jest.fn();
const mockPoolConnect = jest.fn();
const mockSecurityLogEvent = jest.fn();
const mockBroadcast = jest.fn();
const mockWriteAuditLog = jest.fn();
const mockEncryptPassword = jest.fn(() => 'encrypted-password-payload');
const mockBcryptHash = jest.fn(async () => 'hashed-password');

jest.mock('../../db', () => ({
  connect: (...args) => mockPoolConnect(...args),
  query: (...args) => mockPoolQuery(...args),
}));

jest.mock('../../middleware/auth', () => ({
  authenticateToken: (req, _res, next) => {
    req.user = {
      id: 99,
      username: 'admin.user',
      role: 'SYSTEM_ADMIN',
      role_type: 'SYSTEM_ADMIN',
      runtime_role: 'SYSTEM_ADMIN',
    };
    next();
  },
}));

jest.mock('../../middleware/rbac', () => ({
  CANONICAL_ROLES: {
    SYSTEM_ADMIN: 'SYSTEM_ADMIN',
    GUARDIAN: 'GUARDIAN',
  },
  getCanonicalRole: () => 'SYSTEM_ADMIN',
  requirePermission: () => (_req, _res, next) => next(),
  requireSystemAdmin: (_req, _res, next) => next(),
}));

jest.mock('../../services/securityEventService', () => ({
  EVENT_TYPES: {
    PASSWORD_CHANGED: 'PASSWORD_CHANGED',
    SENSITIVE_DATA_ACCESSED: 'SENSITIVE_DATA_ACCESSED',
    SYSTEM_CONFIG_CHANGED: 'SYSTEM_CONFIG_CHANGED',
  },
  SEVERITY: {
    CRITICAL: 'CRITICAL',
    WARNING: 'WARNING',
    ERROR: 'ERROR',
    INFO: 'INFO',
  },
  logEvent: (...args) => mockSecurityLogEvent(...args),
}));

jest.mock('../../services/socketService', () => ({
  broadcast: (...args) => mockBroadcast(...args),
}));

jest.mock('../../services/auditLogService', () => ({
  writeAuditLog: (...args) => mockWriteAuditLog(...args),
}));

jest.mock('../../utils/passwordVisibilityCrypto', () => ({
  encryptPasswordForVisibility: (...args) => mockEncryptPassword(...args),
  decryptPasswordVisibilityPayload: jest.fn(),
}));

jest.mock('bcryptjs', () => ({
  hash: (...args) => mockBcryptHash(...args),
}));

const usersRouter = require('../../routes/users');

describe('Guardian password reset route contract', () => {
  let app;
  let mockClient;

  beforeEach(() => {
    jest.clearAllMocks();

    mockClient = {
      query: mockClientQuery,
      release: jest.fn(),
    };

    mockPoolConnect.mockResolvedValue(mockClient);

    mockClientQuery
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        rows: [
          {
            id: 42,
            name: 'Diana Panganiban Reyes',
            email: 'diana.reyes@example.com',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ id: 42 }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 501,
            username: 'diana.panganiban.reyes',
            email: 'diana.reyes@example.com',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 42,
            name: 'Diana Panganiban Reyes',
            email: 'diana.reyes@example.com',
            is_password_set: true,
            must_change_password: false,
            password_visibility_updated_at: '2026-03-28T12:00:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({});

    mockPoolQuery.mockResolvedValue({
      rows: [
        {
          id: 501,
          username: 'diana.panganiban.reyes',
          contact: null,
          last_login: null,
          created_at: '2026-03-28T10:00:00.000Z',
          updated_at: '2026-03-28T12:00:00.000Z',
          is_active: true,
          guardian_id: 42,
          role_id: 7,
          role_name: 'guardian',
          display_name: 'Guardian',
          clinic_id: 1,
          clinic_name: 'Guardian Portal',
        },
      ],
    });

    app = express();
    app.use(express.json());
    app.use('/api/users', usersRouter);
  });

  test('updates the linked guardian user password and returns canonical success payload', async () => {
    const response = await request(app)
      .put('/api/users/guardians/42/password')
      .set('Authorization', 'Bearer test-token')
      .send({
        password: 'Guardian2026!',
        isPasswordSet: true,
        mustChangePassword: false,
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      code: 'GUARDIAN_PASSWORD_RESET',
      message: 'Guardian password reset successfully',
      guardian: expect.objectContaining({
        id: 42,
        is_password_set: true,
        must_change_password: false,
      }),
      user: expect.objectContaining({
        id: 501,
        guardian_id: 42,
        username: 'diana.panganiban.reyes',
      }),
    });

    const updateUsersCall = mockClientQuery.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('UPDATE users'),
    );

    expect(updateUsersCall).toBeDefined();
    expect(updateUsersCall[1]).toEqual(['hashed-password', false, 501]);
    expect(mockEncryptPassword).toHaveBeenCalledWith('Guardian2026!');
    expect(mockBroadcast).toHaveBeenCalledWith(
      'guardian_updated',
      expect.objectContaining({ id: 42 }),
    );
    expect(mockBroadcast).toHaveBeenCalledWith(
      'system_user_updated',
      expect.objectContaining({ id: 501, guardian_id: 42 }),
    );
    expect(mockSecurityLogEvent).toHaveBeenCalled();
    expect(mockClient.release).toHaveBeenCalled();
  });
});
