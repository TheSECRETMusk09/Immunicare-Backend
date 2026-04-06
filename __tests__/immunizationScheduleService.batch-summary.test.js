const immunizationScheduleService = require('../services/immunizationScheduleService');

describe('immunizationScheduleService batch schedule summaries', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-05T00:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('derives pending doses from the next overdue schedule item instead of sparse pending records', async () => {
    jest.spyOn(immunizationScheduleService, 'getAllSchedules').mockResolvedValue([
      {
        id: 1,
        vaccine_id: 10,
        vaccine_name: 'BCG',
        vaccine_full_name: 'BCG',
        vaccine_code: 'BCG',
        dose_number: 1,
        dose_name: 'Dose 1',
        total_doses: 2,
        age_months: 0,
        age_description: 'At birth',
        description: 'Birth dose',
        minimum_age_days: 0,
      },
      {
        id: 2,
        vaccine_id: 10,
        vaccine_name: 'BCG',
        vaccine_full_name: 'BCG',
        vaccine_code: 'BCG',
        dose_number: 2,
        dose_name: 'Dose 2',
        total_doses: 2,
        age_months: 1.5,
        age_description: '6 weeks',
        description: 'Follow-up dose',
        minimum_age_days: null,
      },
    ]);
    jest
      .spyOn(immunizationScheduleService, 'getAdministeredVaccinesForPatients')
      .mockResolvedValue(
        new Map([
          [
            5001,
            {
              administered: { 10: 1 },
              recordsByVaccine: {
                10: [
                  {
                    vaccine_id: 10,
                    dose_no: 1,
                    admin_date: '2026-02-15',
                    status: 'completed',
                    is_completed: true,
                  },
                ],
              },
            },
          ],
        ]),
      );

    const summaryMap = await immunizationScheduleService.getScheduleSummariesForPatients([
      {
        id: 5001,
        dob: '2026-02-15',
      },
    ]);

    expect(summaryMap.get(5001)).toEqual(
      expect.objectContaining({
        totalScheduled: 2,
        completedCount: 1,
        overdueCount: 1,
        upcomingCount: 0,
        pendingCount: 1,
        overallStatus: 'behind',
      }),
    );
  });

  test('treats a future selected appointment date as the readiness reference for next-dose eligibility', () => {
    const projection = immunizationScheduleService.buildGuardianScheduleProjection(
      [
        {
          id: 1,
          vaccineId: 10,
          vaccineCode: 'PENTA',
          vaccineName: 'Pentavalent',
          vaccineFullName: 'Pentavalent',
          doseNumber: 1,
          doseName: 'Dose 1',
          totalDoses: 3,
          dosesCompleted: 0,
          isCompleted: false,
          dueDate: '2026-05-07T00:00:00.000Z',
        },
      ],
      new Map([
        [
          10,
          {
            isReady: true,
            confirmedBy: null,
            confirmedAt: null,
            notes: null,
          },
        ],
      ]),
      {
        referenceDate: '2026-05-08',
      },
    );

    expect(projection.summary).toEqual(
      expect.objectContaining({
        ready: 0,
        overdue: 1,
        upcoming: 0,
      }),
    );
    expect(projection.readiness).toEqual(
      expect.objectContaining({
        readinessStatus: 'OVERDUE',
        overdueVaccines: [
          expect.objectContaining({
            vaccineId: 10,
            recommendedDate: '2026-05-07',
          }),
        ],
      }),
    );
  });
});
