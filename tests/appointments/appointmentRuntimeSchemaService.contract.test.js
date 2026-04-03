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
      .mockResolvedValueOnce({
        rows: [{ column_name: 'infant_id' }],
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

    expect(pool.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('ALTER TABLE appointments'),
    );
    expect(pool.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('DROP CONSTRAINT IF EXISTS "appointments_infant_id_fkey"'),
    );
    expect(pool.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('REFERENCES patients(id)'),
    );
    expect(pool.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('NOT VALID'),
    );
    expect(pool.query).toHaveBeenNthCalledWith(
      4,
      'ALTER TABLE appointments VALIDATE CONSTRAINT appointments_infant_id_fkey',
    );
  });
});
