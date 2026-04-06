const inventoryCalculationService = require('../services/inventoryCalculationService');

describe('inventoryCalculationService aggregate consistency', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('keeps summary card counts aligned with live alert buckets', async () => {
    jest
      .spyOn(inventoryCalculationService, 'getInventoryAggregateRows')
      .mockResolvedValue([
        {
          vaccine_id: 1,
          vaccine_name: 'BCG',
          vaccine_code: 'BCG',
          beginning_balance: 100,
          received: 20,
          transferred_in: 0,
          transferred_out: 0,
          issued: 110,
          wasted_expired: 10,
          stock_on_hand: 0,
          calculated_total_stock: 0,
          low_stock_threshold: 10,
          critical_stock_threshold: 5,
          representative_inventory_id: 101,
          lot_batch_number: 'LOT-BCG',
          expiry_date: null,
        },
        {
          vaccine_id: 2,
          vaccine_name: 'Hepatitis B',
          vaccine_code: 'HEPB',
          beginning_balance: 100,
          received: 0,
          transferred_in: 0,
          transferred_out: 0,
          issued: 97,
          wasted_expired: 0,
          stock_on_hand: 3,
          calculated_total_stock: 3,
          low_stock_threshold: 10,
          critical_stock_threshold: 5,
          representative_inventory_id: 102,
          lot_batch_number: 'LOT-HEPB',
          expiry_date: null,
        },
        {
          vaccine_id: 3,
          vaccine_name: 'Pentavalent',
          vaccine_code: 'PENTA',
          beginning_balance: 50,
          received: 0,
          transferred_in: 0,
          transferred_out: 0,
          issued: 42,
          wasted_expired: 0,
          stock_on_hand: 8,
          calculated_total_stock: 8,
          low_stock_threshold: 10,
          critical_stock_threshold: 5,
          representative_inventory_id: 103,
          lot_batch_number: 'LOT-PENTA',
          expiry_date: null,
        },
      ]);

    const totals = await inventoryCalculationService.calculateInventoryTotals([1]);
    const alerts = await inventoryCalculationService.getStockAlerts([1]);

    expect(totals.total_vaccines).toBe(3);
    expect(totals.out_of_stock_count).toBe(alerts.out_of_stock.length);
    expect(totals.critical_count).toBe(alerts.critical.length);
    expect(totals.low_stock_count).toBe(alerts.low.length);
    expect(totals.stock_on_hand).toBe(11);
  });
});
