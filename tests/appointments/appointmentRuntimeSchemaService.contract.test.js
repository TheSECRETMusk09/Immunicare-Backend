jest.mock('../../db', () => ({
  query: jest.fn(),
}));

const pool = require('../../db');
const {
  ensureAppointmentRuntimeSchemaInitialized,
} = require('../../services/appointmentRuntimeSchemaService');

describe('appointmentRuntimeSchemaService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('repoints appointments.infant_id foreign key to patients(id) when legacy infants(id) constraint is present', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ column_name: 'infant_id' }],
      })
      .mockResolvedValueOnce({
        rows: [
          { column_name: 'reminder_sent_24h' },
          { column_name: 'reminder_sent_48h' },
          { column_name: 'sms_missed_notification_sent' },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            conname: 'appointments_infant_id_fkey',
            target_table: 'infants',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(ensureAppointmentRuntimeSchemaInitialized()).resolves.toBe(true);

    const alterCalls = pool.query.mock.calls
      .map((args) => args[0])
      .filter((sql) => typeof sql === 'string' && sql.includes('ALTER TABLE appointments'));

    const fkAlterCall = alterCalls.find((sql) =>
      sql.includes('DROP CONSTRAINT IF EXISTS "appointments_infant_id_fkey"') &&
      sql.includes('REFERENCES patients(id)') &&
      sql.includes('NOT VALID'),
    );

    expect(fkAlterCall).toBeDefined();
    expect(pool.query).toHaveBeenCalledWith(
      'ALTER TABLE appointments VALIDATE CONSTRAINT appointments_infant_id_fkey',
    );
  });
});
