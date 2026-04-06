const {
  buildPatientLookupKey,
  diffPatientAndInfantSources,
  mapPatientToLegacyInfantRecord,
  parseArgs,
} = require('../scripts/reconcile_patient_infant_sources');

describe('reconcile patient and infant source utilities', () => {
  test('parses audit and apply arguments', () => {
    expect(parseArgs([])).toEqual({
      apply: false,
      sample: 10,
    });

    expect(parseArgs(['--apply', '--sample=3'])).toEqual({
      apply: true,
      sample: 3,
    });
  });

  test('creates a stable lookup key across canonical and legacy rows', () => {
    expect(
      buildPatientLookupKey({
        first_name: 'Christian',
        middle_name: 'A.',
        last_name: 'Samorin',
        dob: '2026-03-26',
        guardian_id: 254400,
      }),
    ).toBe('christian|a.|samorin|2026-03-26|254400');
  });

  test('identifies rows missing from legacy infants and flags mismatched control numbers', () => {
    const diff = diffPatientAndInfantSources(
      [
        {
          id: 5001,
          first_name: 'Christian',
          last_name: 'Samorin',
          middle_name: '',
          dob: '2026-03-26',
          guardian_id: 254400,
          control_number: 'INF-2026-357447',
        },
        {
          id: 6001,
          first_name: 'Bianca',
          last_name: 'Villanueva',
          middle_name: '',
          dob: '2026-03-20',
          guardian_id: 2001,
          control_number: 'INF-2026-357448',
        },
      ],
      [
        {
          id: 6001,
          first_name: 'Bianca',
          last_name: 'Villanueva',
          middle_name: '',
          dob: '2026-03-20',
          guardian_id: 2001,
          patient_control_number: 'INF-2026-000001',
        },
      ],
    );

    expect(diff.missingInLegacyInfants).toHaveLength(1);
    expect(diff.missingInLegacyInfants[0]).toEqual(
      expect.objectContaining({
        id: 5001,
        first_name: 'Christian',
        last_name: 'Samorin',
      }),
    );
    expect(diff.mismatchedRecords).toHaveLength(1);
    expect(diff.mismatchedRecords[0].reasons).toContain('control_number');
  });

  test('maps canonical patient fields into the legacy infants compatibility shape', () => {
    expect(
      mapPatientToLegacyInfantRecord(
        {
          id: 5001,
          first_name: 'Christian',
          last_name: 'Samorin',
          dob: '2026-03-26',
          guardian_id: 254400,
          facility_id: 1,
          cellphone_number: '09936997484',
          control_number: 'INF-2026-357447',
          is_active: true,
        },
        [
          'id',
          'first_name',
          'last_name',
          'dob',
          'guardian_id',
          'clinic_id',
          'cellphone_number',
          'patient_control_number',
          'is_active',
        ],
      ),
    ).toEqual({
      id: 5001,
      first_name: 'Christian',
      last_name: 'Samorin',
      dob: '2026-03-26',
      guardian_id: 254400,
      clinic_id: 1,
      cellphone_number: '09936997484',
      patient_control_number: 'INF-2026-357447',
      is_active: true,
    });
  });
});
