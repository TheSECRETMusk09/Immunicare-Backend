jest.mock('../db', () => ({
  query: jest.fn(),
}));

const db = require('../db');
const analyticsRepository = require('../repositories/analyticsRepository');

describe('analytics repository schema column mapping', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    analyticsRepository.resetSchemaColumnMappingCache();
  });

  test('detects dual scope columns and keeps fallback mapping', async () => {
    db.query.mockResolvedValueOnce({
      rows: [
        { table_name: 'appointments', column_name: 'patient_id' },
        { table_name: 'appointments', column_name: 'infant_id' },
        { table_name: 'appointments', column_name: 'facility_id' },
        { table_name: 'appointments', column_name: 'clinic_id' },
        { table_name: 'patients', column_name: 'facility_id' },
        { table_name: 'patients', column_name: 'clinic_id' },
        { table_name: 'vaccine_inventory', column_name: 'facility_id' },
        { table_name: 'vaccine_inventory', column_name: 'clinic_id' },
        { table_name: 'vaccine_inventory_transactions', column_name: 'facility_id' },
        { table_name: 'vaccine_inventory_transactions', column_name: 'clinic_id' },
        { table_name: 'vaccine_stock_alerts', column_name: 'facility_id' },
        { table_name: 'vaccine_stock_alerts', column_name: 'clinic_id' },
        { table_name: 'notifications', column_name: 'facility_id' },
        { table_name: 'notifications', column_name: 'clinic_id' },
      ],
    });

    const mappings = await analyticsRepository.getSchemaColumnMappings();

    expect(mappings.appointmentsPatient).toBe('patient_id');
    expect(mappings.appointmentsPatientFallback).toBe('infant_id');
    expect(mappings.appointmentsScope).toBe('facility_id');
    expect(mappings.appointmentsScopeFallback).toBe('clinic_id');
    expect(mappings.patientsScope).toBe('facility_id');
    expect(mappings.patientsScopeFallback).toBe('clinic_id');
    expect(mappings.notificationsScope).toBe('facility_id');
    expect(mappings.notificationsScopeFallback).toBe('clinic_id');
  });

  test('reuses cached mapping lookup between calls until reset', async () => {
    db.query.mockResolvedValueOnce({
      rows: [
        { table_name: 'appointments', column_name: 'patient_id' },
        { table_name: 'appointments', column_name: 'facility_id' },
        { table_name: 'patients', column_name: 'facility_id' },
      ],
    });

    const first = await analyticsRepository.getSchemaColumnMappings();
    const second = await analyticsRepository.getSchemaColumnMappings();

    expect(first).toEqual(second);
    expect(db.query).toHaveBeenCalledTimes(1);

    analyticsRepository.resetSchemaColumnMappingCache();

    db.query.mockResolvedValueOnce({
      rows: [
        { table_name: 'appointments', column_name: 'infant_id' },
        { table_name: 'appointments', column_name: 'clinic_id' },
        { table_name: 'patients', column_name: 'clinic_id' },
      ],
    });

    const afterReset = await analyticsRepository.getSchemaColumnMappings();

    expect(afterReset.appointmentsPatient).toBe('infant_id');
    expect(afterReset.appointmentsScope).toBe('clinic_id');
    expect(afterReset.patientsScope).toBe('clinic_id');
    expect(db.query).toHaveBeenCalledTimes(2);
  });
});

