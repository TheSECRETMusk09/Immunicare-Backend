process.env.DB_SUPPRESS_POOL_LOGS = "true";

const mockDbQuery = jest.fn();

jest.mock("../db", () => ({
  query: (...args) => mockDbQuery(...args),
}));

jest.mock("../services/immunizationScheduleService", () => ({
  getScheduleSummariesForPatients: jest.fn(),
}));

const immunizationScheduleService = require("../services/immunizationScheduleService");
const patientService = require("../services/patientService");

describe("patientService.getPatients needs review summary alignment", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("counts needs review using the same validation-status fallback chain as infant table workflows", async () => {
    immunizationScheduleService.getScheduleSummariesForPatients.mockResolvedValue(
      new Map([
        [101, { pendingCount: 2 }],
        [102, { pendingCount: 0 }],
        [103, { pendingCount: 1 }],
      ]),
    );

    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{ column_name: "is_imported" }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 101,
            first_name: "Ana",
            last_name: "Lopez",
            validation_status: "for_validation",
            latest_transfer_case_status: null,
            latest_transfer_case_id: null,
          },
          {
            id: 102,
            first_name: "Bea",
            last_name: "Cruz",
            validation_status: null,
            latest_transfer_case_status: "needs_clarification",
            latest_transfer_case_id: 12,
          },
          {
            id: 103,
            first_name: "Cara",
            last_name: "Tan",
            validation_status: "approved",
            latest_transfer_case_status: "for_validation",
            latest_transfer_case_id: 13,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ total: "3" }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 101,
            dob: "2026-04-01",
            facility_id: 1,
            validation_status: "for_validation",
            latest_transfer_case_id: null,
            latest_transfer_case_status: null,
          },
          {
            id: 102,
            dob: "2026-04-02",
            facility_id: 1,
            validation_status: null,
            latest_transfer_case_id: 12,
            latest_transfer_case_status: "needs_clarification",
          },
          {
            id: 103,
            dob: "2026-04-03",
            facility_id: 1,
            validation_status: "approved",
            latest_transfer_case_id: 13,
            latest_transfer_case_status: "for_validation",
          },
        ],
      });

    const result = await patientService.getPatients({
      isActive: true,
      dateFrom: "2026-04-01",
      dateTo: "2026-04-30",
      page: 1,
      limit: 20,
    });

    expect(result.summary).toEqual({
      total: 3,
      needsReview: 2,
      withImportedHistory: 2,
      pendingVaccinations: 3,
    });

    expect(mockDbQuery.mock.calls[1][1]).toEqual([
      true,
      "2026-04-01",
      "2026-04-30",
      20,
      0,
    ]);
    expect(mockDbQuery.mock.calls[2][1]).toEqual([
      true,
      "2026-04-01",
      "2026-04-30",
    ]);
    expect(mockDbQuery.mock.calls[3][1]).toEqual([
      true,
      "2026-04-01",
      "2026-04-30",
    ]);
    expect(String(mockDbQuery.mock.calls[3][0])).toContain("p.validation_status");
  });
});
