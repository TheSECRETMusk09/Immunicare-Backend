process.env.DB_SUPPRESS_POOL_LOGS = "true";

const express = require("express");
const request = require("supertest");

const mockDbQuery = jest.fn();
const mockResolvePatientTable = jest.fn();
const mockResolvePatientScopeExpression = jest.fn();
const mockResolveFirstExistingColumn = jest.fn();
const mockResolveUserScopeIds = jest.fn(() => []);

jest.mock("../db", () => ({
  query: (...args) => mockDbQuery(...args),
}));

jest.mock("../middleware/auth", () => ({
  authenticateToken: (req, _res, next) => {
    req.user = {
      id: 1,
      role: "SYSTEM_ADMIN",
      role_type: "SYSTEM_ADMIN",
      runtime_role: "SYSTEM_ADMIN",
      clinic_id: 1,
      facility_id: 1,
    };
    next();
  },
}));

jest.mock("../middleware/rbac", () => ({
  requirePermission: () => (_req, _res, next) => next(),
  getCanonicalRole: () => "SYSTEM_ADMIN",
  CANONICAL_ROLES: {
    GUARDIAN: "guardian",
    SYSTEM_ADMIN: "SYSTEM_ADMIN",
    CLINIC_MANAGER: "CLINIC_MANAGER",
  },
}));

jest.mock("../routes/analytics", () => {
  const express = require("express");
  return express.Router();
});

jest.mock("../services/adminMetricsService", () => ({
  getDashboardMetrics: jest.fn(),
}));

jest.mock("../services/entityScopeService", () => ({
  resolveEffectiveScope: jest.fn(),
  resolveUserScopeIds: (...args) => mockResolveUserScopeIds(...args),
}));

jest.mock("../utils/schemaHelpers", () => ({
  resolvePatientColumn: jest.fn(),
  resolvePatientTable: (...args) => mockResolvePatientTable(...args),
  resolvePatientScopeExpression: (...args) =>
    mockResolvePatientScopeExpression(...args),
}));

jest.mock("../utils/queryCompatibility", () => ({
  resolveFirstExistingColumn: (...args) =>
    mockResolveFirstExistingColumn(...args),
}));

const dashboardRouter = require("../routes/dashboard");

describe("GET /api/dashboard/infants control-number schema regression", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();

    mockResolvePatientTable.mockResolvedValue("infants");
    mockResolvePatientScopeExpression.mockResolvedValue(null);
    mockResolveFirstExistingColumn.mockResolvedValue("clinic_id");
    mockResolveUserScopeIds.mockReturnValue([]);

    mockDbQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: 10,
            first_name: "Ana",
            last_name: "Lopez",
            patient_control_number: "INF-2026-000010",
            control_number: "INF-2026-000010",
            dob: "2026-01-01",
            guardian_id: 1,
            facility_id: 2,
            sex: "F",
            is_active: true,
            created_at: "2026-01-02T00:00:00Z",
            updated_at: "2026-01-02T00:00:00Z",
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ total: "1" }],
      });

    app = express();
    app.use(express.json());
    app.use("/api/dashboard", dashboardRouter);
  });

  test("returns infant rows without referencing a missing control_number column", async () => {
    const response = await request(app).get(
      "/api/dashboard/infants?scope=system&fields=lite&page=1&limit=20&search=Ana",
    );

    expect(response.status).toBe(200);
    expect(response.body.pagination).toMatchObject({
      total: 1,
      page: 1,
      limit: 20,
    });
    expect(response.body.data).toHaveLength(1);

    const [selectSql] = mockDbQuery.mock.calls[0];
    expect(String(selectSql)).toContain(
      "i.patient_control_number AS control_number",
    );
    expect(String(selectSql)).toContain(
      "COALESCE(i.patient_control_number, '') ILIKE",
    );
    expect(String(selectSql)).toContain(
      "i.clinic_id AS facility_id",
    );
    expect(String(selectSql)).not.toContain("i.control_number,");
  });
});
