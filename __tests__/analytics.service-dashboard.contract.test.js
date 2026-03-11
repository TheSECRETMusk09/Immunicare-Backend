jest.mock('../repositories/analyticsRepository', () => ({
  REQUIRED_VACCINE_KEYS: ['BCG', 'HEPB', 'PENTA', 'OPV', 'IPV', 'PCV', 'MMR'],
  getVaccineDimension: jest.fn(),
  getInfantGuardianTotals: jest.fn(),
  getVaccinationSnapshot: jest.fn(),
  getVaccinationStatusBreakdown: jest.fn(),
  getAppointmentSnapshot: jest.fn(),
  getAppointmentStatusBreakdown: jest.fn(),
  getInventorySnapshot: jest.fn(),
  getInventoryByVaccine: jest.fn(),
  getVaccineProgress: jest.fn(),
  getDailyVaccinationTrend: jest.fn(),
  getDailyAppointmentTrend: jest.fn(),
  getDemographics: jest.fn(),
  getReminderStats: jest.fn(),
  getRecentActivity: jest.fn(),
  getLowStockAlerts: jest.fn(),
  getFailedSmsCount: jest.fn(),
}));

const analyticsService = require('../services/analyticsService');
const analyticsRepository = require('../repositories/analyticsRepository');

describe('analytics service dashboard contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    analyticsRepository.getVaccineDimension.mockResolvedValue([
      { vaccine_id: 1, vaccine_key: 'BCG', vaccine_name: 'BCG' },
      { vaccine_id: 2, vaccine_key: 'HEPB', vaccine_name: 'Hepatitis B' },
    ]);

    analyticsRepository.getInfantGuardianTotals.mockResolvedValue({
      total_infants: 143,
      total_guardians: 118,
    });

    analyticsRepository.getVaccinationSnapshot.mockResolvedValue({
      completed_today: 27,
      administered_in_period: 61,
      due_in_period: 39,
      overdue_count: 12,
      unique_infants_served: 55,
    });

    analyticsRepository.getVaccinationStatusBreakdown.mockResolvedValue([
      { status: 'completed', count: 61 },
      { status: 'scheduled', count: 39 },
    ]);

    analyticsRepository.getAppointmentSnapshot.mockResolvedValue({
      total_in_period: 44,
      today_total: 8,
      attended_in_period: 16,
      pending_in_period: 15,
      cancelled_in_period: 3,
      upcoming_7_days: 10,
      overdue_followups: 4,
      followups_today: 2,
      followups_in_period: 9,
    });

    analyticsRepository.getAppointmentStatusBreakdown.mockResolvedValue([
      { status: 'scheduled', count: 10 },
      { status: 'attended', count: 16 },
    ]);

    analyticsRepository.getInventorySnapshot.mockResolvedValue({
      total_items: 9,
      total_available_doses: 920,
      low_stock_count: 4,
      critical_stock_count: 2,
      out_of_stock_count: 1,
    });

    analyticsRepository.getInventoryByVaccine.mockResolvedValue([
      {
        vaccine_key: 'BCG',
        vaccine_name: 'BCG',
        available_doses: 45,
        low_stock: false,
        critical_stock: false,
      },
    ]);

    analyticsRepository.getVaccineProgress.mockResolvedValue([
      {
        vaccine_key: 'BCG',
        vaccine_name: 'BCG',
        infants_covered: 70,
        doses_administered: 72,
        due_count: 10,
        overdue_count: 3,
      },
    ]);

    analyticsRepository.getDailyVaccinationTrend.mockResolvedValue([
      { day: '2026-03-01', count: 0 },
      { day: '2026-03-02', count: 4 },
    ]);

    analyticsRepository.getDailyAppointmentTrend.mockResolvedValue([
      { day: '2026-03-01', count: 3 },
      { day: '2026-03-02', count: 0 },
    ]);

    analyticsRepository.getDemographics.mockResolvedValue({
      ageGroups: [
        { label: '0-5 months', count: 20 },
        { label: '6-11 months', count: 30 },
      ],
      genderBreakdown: [
        { label: 'Male', count: 74 },
        { label: 'Female', count: 69 },
      ],
      coverage: { infants: 143, guardians: 118 },
    });

    analyticsRepository.getReminderStats.mockResolvedValue({
      sms_sent: 50,
      sms_delivered: 44,
      sms_failed: 3,
      unread_notifications: 7,
      sms_log_failed: 2,
      sms_log_total: 11,
    });

    analyticsRepository.getRecentActivity.mockResolvedValue([
      {
        id: 'activity-1',
        type: 'vaccination',
        title: 'Vaccination update',
        description: 'Recorded BCG',
        severity: 'info',
        activity_at: '2026-03-10T10:30:00.000Z',
      },
    ]);

    analyticsRepository.getLowStockAlerts.mockResolvedValue([
      {
        id: 'stock-101',
        type: 'inventory',
        severity: 'critical',
        message: 'BCG stock is low (3 remaining)',
        alert_at: '2026-03-10T08:00:00.000Z',
      },
    ]);

    analyticsRepository.getFailedSmsCount.mockResolvedValue(7);
  });

  test('maps canonical KPI summary fields and emits strict alert shape', async () => {
    const payload = await analyticsService.getDashboardAnalytics({
      query: {
        period: 'month',
        vaccineType: 'ALL',
        vaccinationStatus: 'all',
      },
      user: {
        role: 'ADMIN',
        facility_id: 1,
      },
    });

    expect(payload.summary.totalRegisteredInfants).toBe(143);
    expect(payload.summary.totalGuardians).toBe(118);
    expect(payload.summary.vaccinationsCompletedToday).toBe(27);
    expect(payload.summary.infantsDueForVaccination).toBe(39);
    expect(payload.summary.overdueVaccinations).toBe(12);
    expect(payload.summary.lowStockVaccines).toBe(4);
    expect(payload.summary.totalAvailableVaccineDoses).toBe(920);

    expect(Array.isArray(payload.alerts)).toBe(true);
    expect(payload.alerts.length).toBeGreaterThan(0);
    payload.alerts.forEach((alert) => {
      expect(typeof alert.id).toBe('string');
      expect(typeof alert.type).toBe('string');
      expect(typeof alert.message).toBe('string');
      expect(['critical', 'warning']).toContain(alert.severity);
      expect(typeof alert.timestamp).toBe('string');
      expect(Number.isNaN(new Date(alert.timestamp).getTime())).toBe(false);
    });

    expect(Array.isArray(payload.criticalAlerts)).toBe(true);
    payload.criticalAlerts.forEach((alert) => {
      expect(alert.severity).toBe('critical');
    });
  });

  test('supports stock alerts with missing id and timestamp using safe fallback values', async () => {
    analyticsRepository.getLowStockAlerts.mockResolvedValueOnce([
      {
        id: null,
        type: null,
        severity: null,
        message: '',
        alert_at: null,
      },
    ]);
    analyticsRepository.getFailedSmsCount.mockResolvedValueOnce(0);
    analyticsRepository.getVaccinationSnapshot.mockResolvedValueOnce({
      completed_today: 1,
      administered_in_period: 2,
      due_in_period: 1,
      overdue_count: 0,
      unique_infants_served: 2,
    });

    const payload = await analyticsService.getDashboardAnalytics({
      query: {
        period: 'month',
        vaccineType: 'ALL',
        vaccinationStatus: 'all',
      },
      user: {
        role: 'ADMIN',
        facility_id: 1,
      },
    });

    const inventoryAlert = payload.alerts.find((item) => item.type === 'inventory');

    expect(inventoryAlert).toBeDefined();
    expect(inventoryAlert.id).toMatch(/^inventory-alert-\d+$/);
    expect(inventoryAlert.message).toBe('Low stock alert');
    expect(inventoryAlert.severity).toBe('warning');
    expect(Number.isNaN(new Date(inventoryAlert.timestamp).getTime())).toBe(false);
  });
});
