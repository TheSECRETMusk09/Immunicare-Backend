jest.mock('../db', () => ({
  query: jest.fn(),
}));

const db = require('../db');
const { getDashboardMetrics } = require('../services/adminMetricsService');

describe('adminMetricsService scope handling', () => {
  beforeEach(() => {
    db.query.mockReset();
  });

  test('supports mixed clinic_id and facility_id scope fallbacks without zeroing dashboard totals', async () => {
    db.query
      .mockResolvedValueOnce({
        rows: [
          { table_name: 'patients', column_name: 'facility_id' },
          { table_name: 'patients', column_name: 'clinic_id' },
          { table_name: 'patients', column_name: 'is_active' },
          { table_name: 'appointments', column_name: 'clinic_id' },
          { table_name: 'appointments', column_name: 'is_active' },
          { table_name: 'guardians', column_name: 'clinic_id' },
          { table_name: 'guardians', column_name: 'is_active' },
          { table_name: 'vaccine_inventory', column_name: 'clinic_id' },
          { table_name: 'vaccine_inventory', column_name: 'stock_on_hand' },
          { table_name: 'vaccine_inventory', column_name: 'low_stock_threshold' },
          { table_name: 'vaccine_inventory', column_name: 'is_active' },
          { table_name: 'vaccine_batches', column_name: 'clinic_id' },
          { table_name: 'vaccine_batches', column_name: 'is_active' },
          { table_name: 'users', column_name: 'clinic_id' },
          { table_name: 'users', column_name: 'is_active' },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ total: '11', completed: '9', pending: '2', cancelled: '0' }],
      })
      .mockResolvedValueOnce({
        rows: [{ total_items: '6', low_stock_items: '2', total_value: '0' }],
      })
      .mockResolvedValueOnce({
        rows: [{ expired_items: '1' }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            total: '5',
            scheduled: '1',
            completed: '3',
            cancelled: '1',
            no_show: '1',
            missed_follow_up_load: '1',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ total: '4', active: '4', new_last_30_days: '1' }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            total: '7',
            active: '7',
            up_to_date: '5',
            partially_vaccinated: '1',
            not_vaccinated: '1',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ total: '3', staff: '2' }],
      });

    const metrics = await getDashboardMetrics({
      scopeIds: [7, 9],
    });

    expect(metrics.total_vaccinations).toBe(11);
    expect(metrics.inventory_items).toBe(6);
    expect(metrics.low_stock_items).toBe(2);
    expect(metrics.expired_lots).toBe(1);
    expect(metrics.total_appointments).toBe(5);
    expect(metrics.total_guardians).toBe(4);
    expect(metrics.total_infants).toBe(7);
    expect(metrics.staff_users).toBe(2);
    expect(metrics.scope).toBe('clinic');
    expect(metrics.clinicId).toBe(7);

    const vaccinationQuery = db.query.mock.calls[1][0];
    const vaccinationParams = db.query.mock.calls[1][1];
    expect(vaccinationQuery).toContain('COALESCE(p.facility_id, p.clinic_id) = ANY');
    expect(vaccinationQuery).toContain('g.clinic_id = ANY');
    expect(vaccinationParams[0]).toEqual([7, 9]);

    const inventoryQuery = db.query.mock.calls[2][0];
    const inventoryParams = db.query.mock.calls[2][1];
    expect(inventoryQuery).toContain('vi.clinic_id = ANY');
    expect(inventoryParams[0]).toEqual([7, 9]);
  });
});
