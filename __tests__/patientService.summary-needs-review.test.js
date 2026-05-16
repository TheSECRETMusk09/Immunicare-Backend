process.env.DB_SUPPRESS_POOL_LOGS = "true";

const mockDbQuery = jest.fn();

jest.mock("../db", () => ({
  query: (...args) => mockDbQuery(...args),
}));

jest.mock("../services/immunizationScheduleService", () => ({
  getScheduleSummariesForPatients: jest.fn(),
}));

let immunizationScheduleService;
let patientService;

describe("patientService.getPatients needs review summary alignment", () => {
  beforeEach(() => {
    jest.resetModules();
    mockDbQuery.mockReset();
    immunizationScheduleService = require("../services/immunizationScheduleService");
    patientService = require("../services/patientService");
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
        rows: [{ column_name: "is_active" }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            total: "3",
            needs_review: "2",
            with_imported_history: "2",
            pending_vaccinations: "3",
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
    expect(String(mockDbQuery.mock.calls[2][0])).toContain("vaccination_schedules");
    expect(mockDbQuery.mock.calls[2][1]).toBeUndefined();
    expect(mockDbQuery.mock.calls[3][1]).toEqual([
      true,
      "2026-04-01",
      "2026-04-30",
      ["for_validation", "needs_clarification", "pending_validation"],
    ]);
    expect(String(mockDbQuery.mock.calls[3][0])).toContain("p.validation_status");
    expect(String(mockDbQuery.mock.calls[3][0])).toContain("completed_schedule_doses");
  });

  test("excludes broader review statuses that are not rendered as needs review badges in the infant table", async () => {
    immunizationScheduleService.getScheduleSummariesForPatients.mockResolvedValue(
      new Map([
        [201, { pendingCount: 1 }],
        [202, { pendingCount: 1 }],
        [203, { pendingCount: 1 }],
        [204, { pendingCount: 1 }],
      ]),
    );

    mockDbQuery
      .mockResolvedValueOnce({
        rows: [{ column_name: "is_imported" }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 201,
            first_name: "Una",
            last_name: "Visible",
            validation_status: "for_validation",
            latest_transfer_case_status: null,
            latest_transfer_case_id: null,
          },
          {
            id: 202,
            first_name: "Pia",
            last_name: "Pending",
            validation_status: "pending",
            latest_transfer_case_status: null,
            latest_transfer_case_id: null,
          },
          {
            id: 203,
            first_name: "Uri",
            last_name: "Review",
            validation_status: "under_review",
            latest_transfer_case_status: null,
            latest_transfer_case_id: null,
          },
          {
            id: 204,
            first_name: "Nia",
            last_name: "Named",
            validation_status: "needs_review",
            latest_transfer_case_status: null,
            latest_transfer_case_id: null,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ column_name: "is_active" }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            total: "4",
            needs_review: "1",
            with_imported_history: "0",
            pending_vaccinations: "4",
          },
        ],
      });

    const result = await patientService.getPatients({
      isActive: true,
      dateFrom: "2026-05-01",
      dateTo: "2026-05-31",
      page: 1,
      limit: 20,
    });

    expect(result.summary).toEqual({
      total: 4,
      needsReview: 1,
      withImportedHistory: 0,
      pendingVaccinations: 4,
    });
  });
});
