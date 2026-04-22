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

  test('keeps Christian Samorin baseline consistent across completed birth doses and one-month overdue doses', async () => {
    jest.setSystemTime(new Date('2026-04-22T00:00:00.000Z'));

    jest.spyOn(immunizationScheduleService, 'getAllSchedules').mockResolvedValue([
      {
        id: 153,
        vaccine_id: 1,
        vaccine_name: 'BCG Vaccine',
        vaccine_full_name: 'BCG Vaccine',
        vaccine_code: 'BCG',
        dose_number: 1,
        dose_name: 'Dose 1',
        total_doses: 1,
        age_months: 0,
        age_description: 'At birth',
        description: 'Birth dose',
        minimum_age_days: 0,
      },
      {
        id: 154,
        vaccine_id: 3,
        vaccine_name: 'Hepatitis B Vaccine',
        vaccine_full_name: 'Hepatitis B Vaccine',
        vaccine_code: 'HEPB',
        dose_number: 1,
        dose_name: 'Dose 1',
        total_doses: 2,
        age_months: 0,
        age_description: 'At birth',
        description: 'Birth dose',
        minimum_age_days: 0,
      },
      {
        id: 155,
        vaccine_id: 3,
        vaccine_name: 'Hepatitis B Vaccine',
        vaccine_full_name: 'Hepatitis B Vaccine',
        vaccine_code: 'HEPB',
        dose_number: 2,
        dose_name: 'Dose 2',
        total_doses: 2,
        age_months: 1,
        age_description: '1 month',
        description: 'One-month dose',
        minimum_age_days: null,
      },
      {
        id: 156,
        vaccine_id: 4,
        vaccine_name: 'OPV 20-doses',
        vaccine_full_name: 'OPV 20-doses',
        vaccine_code: 'OPV',
        dose_number: 1,
        dose_name: 'Dose 1',
        total_doses: 3,
        age_months: 1,
        age_description: '1 month',
        description: 'One-month dose',
        minimum_age_days: null,
      },
      {
        id: 157,
        vaccine_id: 5,
        vaccine_name: 'PCV 10',
        vaccine_full_name: 'PCV 10',
        vaccine_code: 'PCV',
        dose_number: 1,
        dose_name: 'Dose 1',
        total_doses: 3,
        age_months: 1,
        age_description: '1 month',
        description: 'One-month dose',
        minimum_age_days: null,
      },
      {
        id: 158,
        vaccine_id: 6,
        vaccine_name: 'Penta Valent',
        vaccine_full_name: 'Penta Valent',
        vaccine_code: 'PENTA',
        dose_number: 1,
        dose_name: 'Dose 1',
        total_doses: 3,
        age_months: 1,
        age_description: '1 month',
        description: 'One-month dose',
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
              administered: { 1: 1, 3: 1 },
              recordsByVaccine: {
                1: [
                  {
                    id: 57049,
                    vaccine_id: 1,
                    dose_no: 1,
                    admin_date: '2026-03-19',
                    status: 'completed',
                    is_completed: true,
                  },
                ],
                3: [
                  {
                    id: 57050,
                    vaccine_id: 3,
                    dose_no: 1,
                    admin_date: '2026-03-19',
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
        first_name: 'Christian',
        last_name: 'Samorin',
        control_number: 'INF-2026-357447',
        dob: '2026-03-17',
      },
    ]);

    expect(summaryMap.get(5001)).toEqual(
      expect.objectContaining({
        totalScheduled: 6,
        completedCount: 2,
        overdueCount: 4,
        upcomingCount: 0,
        pendingCount: 4,
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

  test('labels past-due next doses as overdue even when readiness is not confirmed', () => {
    const projection = immunizationScheduleService.buildGuardianScheduleProjection(
      [
        {
          id: 1,
          vaccineId: 10,
          vaccineCode: 'OPV',
          vaccineName: 'OPV 20-doses',
          vaccineFullName: 'OPV 20-doses',
          doseNumber: 1,
          doseName: 'Dose 1',
          totalDoses: 3,
          dosesCompleted: 0,
          isCompleted: false,
          dueDate: '2026-04-17T00:00:00.000Z',
        },
      ],
      new Map([
        [
          10,
          {
            isReady: false,
            confirmedBy: null,
            confirmedAt: null,
            notes: null,
          },
        ],
      ]),
      {
        referenceDate: '2026-04-22',
      },
    );

    expect(projection.schedules[0]).toEqual(
      expect.objectContaining({
        status: 'overdue',
        isReady: false,
        isPastDue: true,
      }),
    );
    expect(projection.summary).toEqual(
      expect.objectContaining({
        overdue: 1,
        pendingConfirmation: 0,
      }),
    );
  });
});
