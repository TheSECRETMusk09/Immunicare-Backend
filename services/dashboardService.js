const pool = require('../db');
const appointmentService = require('./appointmentSchedulingService');

/**
 * Aggregates high-level statistics for the admin dashboard.
 */
const getDashboardStats = async () => {
  try {
    const [infantsRes, guardiansRes, appointmentsRes, stockRes] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM patients WHERE COALESCE(is_active, true) = true'),
      pool.query('SELECT COUNT(*) FROM guardians'),
      pool.query('SELECT COUNT(*) FROM appointments WHERE status = \'scheduled\' AND scheduled_date >= CURRENT_DATE'),
      appointmentService.getVaccineStockSummary(),
    ]);

    // Calculate low stock items (threshold < 20)
    const lowStockCount = (stockRes.vaccines || []).filter(v => parseInt(v.available_stock, 10) < 20).length;

    return {
      infants: parseInt(infantsRes.rows[0].count, 10),
      guardians: parseInt(guardiansRes.rows[0].count, 10),
      appointments: parseInt(appointmentsRes.rows[0].count, 10),
      lowStock: lowStockCount,
    };
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    throw error;
  }
};

/**
 * Fetches recent system activity (audit logs or notifications).
 */
const getRecentActivity = async (limit = 5) => {
  try {
    // Assuming a notifications or audit_logs table exists.
    // Fallback to appointments if no specific audit table.
    const query = `
      SELECT
        'Appointment Scheduled' as description,
        created_at as time
      FROM appointments
      ORDER BY created_at DESC
      LIMIT $1
    `;
    const result = await pool.query(query, [limit]);

    return result.rows.map(row => ({
      description: row.description,
      time: new Date(row.time).toLocaleString(),
    }));
  } catch (error) {
    console.error('Error fetching recent activity:', error);
    return [];
  }
};

/**
 * Fetches upcoming appointments for the dashboard list.
 */
const getUpcomingAppointments = async (limit = 5) => {
  try {
    const query = `
      SELECT
        a.scheduled_date,
        a.status,
        p.first_name || ' ' || p.last_name as patient_name,
        COALESCE(a.type, 'Appointment') as vaccine_name
      FROM appointments a
      JOIN patients p ON a.infant_id = p.id
      WHERE a.scheduled_date >= CURRENT_DATE
      ORDER BY a.scheduled_date ASC
      LIMIT $1
    `;

    const result = await pool.query(query, [limit]);

    return result.rows.map(row => {
      const date = new Date(row.scheduled_date);
      return {
        month: date.toLocaleString('default', { month: 'short' }),
        day: date.getDate(),
        patientName: row.patient_name,
        time: date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        type: row.vaccine_name || 'Checkup',
      };
    });
  } catch (error) {
    console.error('Error fetching upcoming appointments:', error);
    return [];
  }
};

/**
 * Aggregates analytics data for charts.
 */
const getAnalytics = async (type, range = 'month') => {
  try {
    let interval = 'day';
    let limit = 30;

    if (range === 'week') {
      limit = 7;
    }
    if (range === 'year') {
      interval = 'month';
      limit = 12;
    }

    let query = '';
    if (type === 'vaccinations') {
      // Count completed appointments as vaccinations
      query = `
        SELECT
          TO_CHAR(scheduled_date, ${interval === 'month' ? '\'Mon\'' : '\'Mon DD\''}) as label,
          COUNT(*) as value
        FROM appointments
        WHERE status = 'completed'
        AND scheduled_date >= CURRENT_DATE - INTERVAL '1 ${range}'
        GROUP BY 1, scheduled_date
        ORDER BY scheduled_date ASC
      `;
    } else if (type === 'appointments') {
      query = `
        SELECT
          TO_CHAR(scheduled_date, ${interval === 'month' ? '\'Mon\'' : '\'Mon DD\''}) as label,
          COUNT(*) as value
        FROM appointments
        WHERE scheduled_date >= CURRENT_DATE - INTERVAL '1 ${range}'
        GROUP BY 1, scheduled_date
        ORDER BY scheduled_date ASC
      `;
    }

    const result = await pool.query(query);

    // Fill in gaps or return as is (simplified for now)
    return {
      labels: result.rows.map(r => r.label),
      values: result.rows.map(r => parseInt(r.value, 10)),
    };
  } catch (error) {
    console.error(`Error fetching ${type} analytics:`, error);
    return { labels: [], values: [] };
  }
};

/**
 * Aggregates statistics for a specific guardian's dashboard.
 * @param {number} guardianId - The ID of the guardian.
 */
const getGuardianStats = async (guardianId) => {
  try {
    const [childrenRes, appointmentsRes, vaccinationsRes] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM patients WHERE guardian_id = $1 AND COALESCE(is_active, true) = true', [guardianId]),
      pool.query('SELECT COUNT(*) FROM appointments a JOIN patients p ON a.infant_id = p.id WHERE p.guardian_id = $1 AND a.status IN (\'scheduled\', \'pending\') AND a.scheduled_date >= CURRENT_DATE', [guardianId]),
      pool.query('SELECT COUNT(*) FROM immunization_records ir JOIN patients p ON ir.patient_id = p.id WHERE p.guardian_id = $1', [guardianId]),
    ]);

    return {
      childrenCount: parseInt(childrenRes.rows[0].count, 10),
      upcomingAppointments: parseInt(appointmentsRes.rows[0].count, 10),
      completedVaccinations: parseInt(vaccinationsRes.rows[0].count, 10),
    };
  } catch (error) {
    console.error('Error fetching guardian stats:', error);
    throw error;
  }
};

module.exports = {
  getDashboardStats,
  getRecentActivity,
  getUpcomingAppointments,
  getAnalytics,
  getGuardianStats,
};
