const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken: auth } = require('../middleware/auth');
const appointmentSchedulingService = require('../services/appointmentSchedulingService');
const smsService = require('../services/smsService');
const { validateApprovedVaccineName } = require('../utils/approvedVaccines');

// Root route - return API info
router.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Vaccination Management API',
    endpoints: [
      '/dashboard',
      '/patients',
      '/inventory',
      '/appointments',
      '/vaccinations',
      '/reports/coverage',
      '/reports/inventory',
    ],
  });
});

// GET /api/vaccination-management/dashboard
// Get comprehensive dashboard statistics
router.get('/dashboard', auth, async (req, res) => {
  try {

    // Get vaccination statistics - use immunization_records table (no clinic_id filter as table doesn't have it)
    const statsQuery = `
      SELECT
        COUNT(*) as total_vaccinations,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_vaccinations,
        COUNT(CASE WHEN status = 'scheduled' THEN 1 END) as scheduled_vaccinations,
        COUNT(CASE WHEN status = 'overdue' THEN 1 END) as overdue_vaccinations,
        ROUND(
          (COUNT(CASE WHEN status = 'completed' THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0)), 2
        ) as coverage_rate
      FROM immunization_records
    `;

    // Get today's appointments
    const appointmentsQuery = `
      SELECT
        COUNT(*) as today_appointments,
        COUNT(CASE WHEN status = 'attended' THEN 1 END) as completed_appointments
      FROM appointments
      WHERE DATE(scheduled_date) = CURRENT_DATE
    `;

    // Get inventory status
    const inventoryQuery = `
      SELECT
        COUNT(*) as total_vaccines,
        COUNT(CASE WHEN quantity <= 10 THEN 1 END) as low_stock_alerts,
        COUNT(CASE WHEN expiry_date <= CURRENT_DATE + INTERVAL '30 days' THEN 1 END) as expiry_alerts
      FROM inventory
    `;

    const [statsResult, appointmentsResult, inventoryResult] = await Promise.all([
      db.query(statsQuery),
      db.query(appointmentsQuery),
      db.query(inventoryQuery),
    ]);

    res.json({
      stats: {
        ...statsResult.rows[0],
        appointmentsToday: appointmentsResult.rows[0]?.today_appointments || 0,
        lowStockAlerts: inventoryResult.rows[0]?.low_stock_alerts || 0,
        coverageRate: parseFloat(statsResult.rows[0]?.coverage_rate || 0),
      },
      success: true,
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({
      error: 'Failed to load dashboard data',
      success: false,
    });
  }
});

// GET /api/vaccination-management/patients
// Get all patients with vaccination history
router.get('/patients', auth, async (req, res) => {
  try {
    const clinicId = req.user.clinic_id;
    const { search } = req.query;

    let query = `
      SELECT
        p.id,
        p.first_name || ' ' || COALESCE(p.middle_name, '') || ' ' || p.last_name as name,
        p.dob,
        p.sex,
        p.address,
        p.mother_name,
        p.father_name,
        p.cellphone_number as contact_number,
        p.health_center as clinic_id,
        p.created_at,
        p.updated_at,
        COUNT(ir.id) as total_vaccinations,
        COUNT(CASE WHEN ir.status = 'completed' THEN 1 END) as completed_vaccinations,
        COUNT(CASE WHEN ir.status = 'overdue' THEN 1 END) as overdue_vaccinations,
        MAX(ir.admin_date) as last_vaccination_date
      FROM patients p
      LEFT JOIN immunization_records ir ON p.id = ir.patient_id AND ir.is_active = true
      WHERE p.is_active = true
    `;

    const params = [];
    let paramIndex = 1;

    // Filter by facility if user has clinic_id - use direct string interpolation to avoid param issues
    if (clinicId) {
      query += ` AND p.facility_id = '${clinicId}'`;
    }

    if (search) {
      query += ` AND (p.first_name ILIKE $${paramIndex} OR p.last_name ILIKE $${paramIndex} OR p.mother_name ILIKE $${paramIndex} OR p.cellphone_number ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    query += ' GROUP BY p.id ORDER BY p.last_name, p.first_name';

    const result = await db.query(query, params);

    res.json({
      patients: result.rows,
      success: true,
    });
  } catch (error) {
    console.error('Patients error:', error);
    res.status(500).json({
      error: 'Failed to load patients',
      success: false,
    });
  }
});

// POST /api/vaccination-management/patients
// Add new patient
router.post('/patients', auth, async (req, res) => {
  try {
    const {
      name,
      dateOfBirth,
      sex,
      address,
      motherName,
      fatherName,
      contactNumber,
      medicalHistory,
      allergies,
      guardianConsent,
    } = req.body;

    const clinicId = req.user.clinic_id;

    const query = `
      INSERT INTO patients (
        name, date_of_birth, sex, address, mother_name, father_name,
        contact_number, medical_history, allergies, guardian_consent, clinic_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `;

    const values = [
      name,
      dateOfBirth,
      sex,
      address,
      motherName,
      fatherName,
      contactNumber,
      medicalHistory,
      allergies,
      guardianConsent,
      clinicId,
    ];

    const result = await db.query(query, values);

    res.json({
      patient: result.rows[0],
      message: 'Patient added successfully',
      success: true,
    });
  } catch (error) {
    console.error('Add patient error:', error);
    res.status(500).json({
      error: 'Failed to add patient',
      success: false,
    });
  }
});

// PUT /api/vaccination-management/patients/:id
// Update patient
router.put('/patients/:id', auth, async (req, res) => {
  try {
    const patientId = req.params.id;
    const updates = req.body;

    // Build dynamic update query
    const setClause = Object.keys(updates)
      .map((key, index) => `${key} = $${index + 2}`)
      .join(', ');

    const query = `
      UPDATE patients
      SET ${setClause}, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND clinic_id = $${Object.keys(updates).length + 2}
      RETURNING *
    `;

    const values = [patientId, ...Object.values(updates), req.user.clinic_id];

    const result = await db.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Patient not found',
        success: false,
      });
    }

    res.json({
      patient: result.rows[0],
      message: 'Patient updated successfully',
      success: true,
    });
  } catch (error) {
    console.error('Update patient error:', error);
    res.status(500).json({
      error: 'Failed to update patient',
      success: false,
    });
  }
});

// DELETE /api/vaccination-management/patients/:id
// Delete patient
router.delete('/patients/:id', auth, async (req, res) => {
  try {
    const patientId = req.params.id;
    const clinicId = req.user.clinic_id;

    const query = 'DELETE FROM patients WHERE id = $1 AND clinic_id = $2';
    const result = await db.query(query, [patientId, clinicId]);

    if (result.rowCount === 0) {
      return res.status(404).json({
        error: 'Patient not found',
        success: false,
      });
    }

    res.json({
      message: 'Patient deleted successfully',
      success: true,
    });
  } catch (error) {
    console.error('Delete patient error:', error);
    res.status(500).json({
      error: 'Failed to delete patient',
      success: false,
    });
  }
});

// GET /api/vaccination-management/inventory
// Get vaccine inventory with alerts
router.get('/inventory', auth, async (req, res) => {
  try {
    const query = `
      SELECT
        i.id,
        v.name as vaccine_name,
        i.batch_number,
        i.quantity,
        i.expiry_date,
        i.manufacturer,
        s.name as supplier,
        i.location as storage_location,
        i.status,
        i.created_at,
        i.updated_at,
        CASE
          WHEN i.quantity <= 10 THEN 'danger'
          WHEN i.quantity <= 20 THEN 'warning'
          ELSE 'success'
        END as stock_status,
        CASE
          WHEN i.expiry_date <= CURRENT_DATE THEN 'expired'
          WHEN i.expiry_date <= CURRENT_DATE + INTERVAL '7 days' THEN 'critical'
          WHEN i.expiry_date <= CURRENT_DATE + INTERVAL '30 days' THEN 'warning'
          ELSE 'good'
        END as expiry_status
      FROM inventory i
      JOIN vaccines v ON v.id = i.vaccine_id
      LEFT JOIN suppliers s ON s.id = i.supplier_id
      ORDER BY i.expiry_date ASC
    `;

    const result = await db.query(query);

    // Get low stock alerts
    const lowStockAlerts = result.rows.filter((item) => item.stock_status === 'danger');

    // Get expiry alerts
    const expiryAlerts = result.rows.filter(
      (item) => item.expiry_status === 'critical' || item.expiry_status === 'expired',
    );

    res.json({
      inventory: result.rows,
      lowStockAlerts,
      expiryAlerts,
      success: true,
    });
  } catch (error) {
    console.error('Inventory error:', error);
    res.status(500).json({
      error: 'Failed to load inventory',
      success: false,
    });
  }
});

// POST /api/vaccination-management/inventory
// Add new stock
router.post('/inventory', auth, async (req, res) => {
  try {
    const {
      vaccineName,
      batchNumber,
      quantity,
      expiryDate,
      supplier,
      costPerUnit,
      storageLocation,
      temperature,
      manufacturer,
    } = req.body;

    const clinicId = req.user.clinic_id;

    const vaccineNameValidation = validateApprovedVaccineName(vaccineName, {
      fieldName: 'vaccineName',
    });
    if (!vaccineNameValidation.valid) {
      return res.status(400).json({
        error: vaccineNameValidation.error,
        success: false,
      });
    }

    const query = `
      INSERT INTO inventory (
        vaccine_name, batch_number, quantity, expiry_date, supplier,
        cost_per_unit, storage_location, temperature, manufacturer, clinic_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `;

    const values = [
      vaccineNameValidation.vaccineName,
      batchNumber,
      quantity,
      expiryDate,
      supplier,
      costPerUnit,
      storageLocation,
      temperature,
      manufacturer,
      clinicId,
    ];

    const result = await db.query(query, values);

    res.json({
      item: result.rows[0],
      message: 'Stock added successfully',
      success: true,
    });
  } catch (error) {
    console.error('Add stock error:', error);
    res.status(500).json({
      error: 'Failed to add stock',
      success: false,
    });
  }
});

// PUT /api/vaccination-management/inventory/:id
// Update stock
router.put('/inventory/:id', auth, async (req, res) => {
  try {
    const itemId = req.params.id;
    const updates = { ...req.body };

    const vaccineNameCandidate =
      Object.prototype.hasOwnProperty.call(updates, 'vaccine_name')
        ? updates.vaccine_name
        : Object.prototype.hasOwnProperty.call(updates, 'vaccineName')
          ? updates.vaccineName
          : undefined;

    if (vaccineNameCandidate !== undefined) {
      const vaccineNameValidation = validateApprovedVaccineName(vaccineNameCandidate, {
        fieldName: 'vaccine_name',
      });
      if (!vaccineNameValidation.valid) {
        return res.status(400).json({
          error: vaccineNameValidation.error,
          success: false,
        });
      }

      delete updates.vaccineName;
      updates.vaccine_name = vaccineNameValidation.vaccineName;
    }

    const setClause = Object.keys(updates)
      .map((key, index) => `${key} = $${index + 2}`)
      .join(', ');

    const query = `
      UPDATE inventory
      SET ${setClause}, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND clinic_id = $${Object.keys(updates).length + 2}
      RETURNING *
    `;

    const values = [itemId, ...Object.values(updates), req.user.clinic_id];

    const result = await db.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Inventory item not found',
        success: false,
      });
    }

    res.json({
      item: result.rows[0],
      message: 'Stock updated successfully',
      success: true,
    });
  } catch (error) {
    console.error('Update stock error:', error);
    res.status(500).json({
      error: 'Failed to update stock',
      success: false,
    });
  }
});

// GET /api/vaccination-management/appointments
// Get appointments with filters
router.get('/appointments', auth, async (req, res) => {
  try {
    const { date, status, vaccine } = req.query;

    let query = `
      SELECT
        a.id,
        a.infant_id,
        i.first_name as patient_name,
        a.type as vaccine,
        a.scheduled_date as appointment_date,
        a.created_at as appointment_time,
        a.location,
        a.status,
        a.notes,
        a.created_by as nurse_id,
        u.username as nurse_name,
        a.created_at,
        a.updated_at
      FROM appointments a
      LEFT JOIN patients i ON a.infant_id = i.id
      LEFT JOIN users u ON a.created_by = u.id
      WHERE a.is_active = true
    `;

    const params = [];
    let paramIndex = 1;

    if (date) {
      query += ` AND DATE(a.scheduled_date) = $${paramIndex}`;
      params.push(date);
      paramIndex++;
    }

    if (status) {
      query += ` AND a.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    if (vaccine) {
      query += ` AND a.type ILIKE $${paramIndex}`;
      params.push(`%${vaccine}%`);
      paramIndex++;
    }

    query += ' ORDER BY a.scheduled_date DESC LIMIT 100';

    const result = await db.query(query, params);

    res.json({
      appointments: result.rows,
      success: true,
    });
  } catch (error) {
    console.error('Appointments error:', error);
    res.status(500).json({
      error: 'Failed to load appointments',
      success: false,
    });
  }
});

// POST /api/vaccination-management/appointments
// Schedule new appointment
router.post('/appointments', auth, async (req, res) => {
  try {
    const {
      patientId,
      vaccine,
      appointmentDate,
      appointmentTime,
      location,
      status,
      notes,
      nurseId,
    } = req.body;

    const clinicId = req.user.clinic_id;

    const vaccineValidation = validateApprovedVaccineName(vaccine, {
      fieldName: 'vaccine',
    });
    if (!vaccineValidation.valid) {
      return res.status(400).json({
        error: vaccineValidation.error,
        success: false,
      });
    }

    if (appointmentDate) {
      const scheduledDateForValidation = appointmentTime
        ? `${appointmentDate}T${appointmentTime}:00`
        : appointmentDate;
      const availability = await appointmentSchedulingService.checkBookingAvailability({
        scheduledDate: scheduledDateForValidation,
        clinicId,
        appointmentType: 'Vaccination',
      });

      if (!availability.available) {
        return res.status(400).json({
          error: availability.message,
          code: availability.code,
          availability,
          success: false,
        });
      }
    }

    const query = `
      INSERT INTO appointments (
        patient_id, vaccine, appointment_date, appointment_time,
        location, status, notes, nurse_id, clinic_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `;

    const values = [
      patientId,
      vaccineValidation.vaccineName,
      appointmentDate,
      appointmentTime,
      location,
      status || 'scheduled',
      notes,
      nurseId,
      clinicId,
    ];

    const result = await db.query(query, values);

    res.json({
      appointment: result.rows[0],
      message: 'Appointment scheduled successfully',
      success: true,
    });
  } catch (error) {
    console.error('Schedule appointment error:', error);
    res.status(500).json({
      error: 'Failed to schedule appointment',
      success: false,
    });
  }
});

// PUT /api/vaccination-management/appointments/:id
// Update appointment
router.put('/appointments/:id', auth, async (req, res) => {
  try {
    const appointmentId = req.params.id;
    const updates = req.body;

    const scheduledDateInput = updates.scheduled_date || updates.appointmentDate || updates.date;
    if (scheduledDateInput) {
      const scheduledDateForValidation = updates.appointmentTime
        ? `${scheduledDateInput}T${updates.appointmentTime}:00`
        : scheduledDateInput;
      const availability = await appointmentSchedulingService.checkBookingAvailability({
        scheduledDate: scheduledDateForValidation,
        clinicId: req.user.clinic_id,
        appointmentType: 'Vaccination',
      });

      if (!availability.available) {
        return res.status(400).json({
          error: availability.message,
          code: availability.code,
          availability,
          success: false,
        });
      }
    }

    const setClause = Object.keys(updates)
      .map((key, index) => `${key} = $${index + 2}`)
      .join(', ');

    const query = `
      UPDATE appointments
      SET ${setClause}, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND clinic_id = $${Object.keys(updates).length + 2}
      RETURNING *
    `;

    const values = [appointmentId, ...Object.values(updates), req.user.clinic_id];

    const result = await db.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Appointment not found',
        success: false,
      });
    }

    // If appointment is confirmed, send SMS reminder
    if (updates.status === 'confirmed') {
      try {
        const appointmentDetailsQuery = `
          SELECT
            i.first_name as "infantName",
            g.phone as "phoneNumber",
            a.scheduled_date as "date"
          FROM appointments a
          JOIN infants i ON a.infant_id = i.id
          JOIN guardians g ON i.guardian_id = g.id
          WHERE a.id = $1
        `;
        const appointmentDetailsResult = await db.query(appointmentDetailsQuery, [appointmentId]);
        if (appointmentDetailsResult.rows.length > 0) {
          await smsService.sendAppointmentReminderSms(appointmentDetailsResult.rows[0]);
        }
      } catch (smsError) {
        console.error('Failed to send SMS reminder:', smsError);
        // Do not block the main response for SMS failure
      }
    }

    res.json({
      appointment: result.rows[0],
      message: 'Appointment updated successfully',
      success: true,
    });
  } catch (error) {
    console.error('Update appointment error:', error);
    res.status(500).json({
      error: 'Failed to update appointment',
      success: false,
    });
  }
});

// GET /api/vaccination-management/vaccinations
// Get vaccination records
router.get('/vaccinations', auth, async (req, res) => {
  try {
    const { patientId, status } = req.query;

    let query = `
      SELECT
        ir.id,
        ir.patient_id,
        p.first_name as patient_name,
        v.name as vaccine,
        ir.dose_no as dose,
        ir.next_due_date as due_date,
        ir.admin_date as date_given,
        vb.lot_no as batch_number,
        ir.administered_by,
        ir.site_of_injection as site,
        ir.reactions as side_effects,
        ir.status,
        ir.notes,
        ir.created_at,
        ir.updated_at
      FROM immunization_records ir
      LEFT JOIN patients p ON ir.patient_id = p.id
      JOIN vaccines v ON ir.vaccine_id = v.id
      LEFT JOIN vaccine_batches vb ON ir.batch_id = vb.id
      WHERE ir.is_active = true
    `;

    const params = [];
    let paramIndex = 1;

    if (patientId) {
      query += ` AND ir.patient_id = $${paramIndex}`;
      params.push(patientId);
      paramIndex++;
    }

    if (status) {
      query += ` AND ir.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    query += ' ORDER BY ir.admin_date DESC NULLS LAST, ir.created_at DESC';

    const result = await db.query(query, params);

    res.json({
      vaccinations: result.rows,
      success: true,
    });
  } catch (error) {
    console.error('Vaccinations error:', error);
    res.status(500).json({
      error: 'Failed to load vaccinations',
      success: false,
    });
  }
});

// POST /api/vaccination-management/vaccinations
// Record new vaccination
router.post('/vaccinations', auth, async (req, res) => {
  try {
    const {
      patientId,
      vaccine,
      dose,
      schedule,
      dueDate,
      dateGiven,
      batchNumber,
      administeredBy,
      site,
      sideEffects,
      status,
      notes,
    } = req.body;

    const clinicId = req.user.clinic_id;

    const vaccineValidation = validateApprovedVaccineName(vaccine, {
      fieldName: 'vaccine',
    });
    if (!vaccineValidation.valid) {
      return res.status(400).json({
        error: vaccineValidation.error,
        success: false,
      });
    }

    const query = `
      INSERT INTO vaccinations (
        patient_id, vaccine, dose, schedule, due_date, date_given,
        batch_number, administered_by, site, side_effects, status, notes, clinic_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *
    `;

    const values = [
      patientId,
      vaccineValidation.vaccineName,
      dose,
      schedule,
      dueDate,
      dateGiven,
      batchNumber,
      administeredBy,
      site,
      sideEffects,
      status || 'completed',
      notes,
      clinicId,
    ];

    const result = await db.query(query, values);

    res.json({
      vaccination: result.rows[0],
      message: 'Vaccination recorded successfully',
      success: true,
    });
  } catch (error) {
    console.error('Record vaccination error:', error);
    res.status(500).json({
      error: 'Failed to record vaccination',
      success: false,
    });
  }
});

// GET /api/vaccination-management/reports/coverage
// Get vaccination coverage report
router.get('/reports/coverage', auth, async (req, res) => {
  try {
    const { vaccineType } = req.query;

    let normalizedVaccineType = null;
    if (vaccineType) {
      const vaccineValidation = validateApprovedVaccineName(vaccineType, {
        fieldName: 'vaccineType',
      });
      if (!vaccineValidation.valid) {
        return res.status(400).json({
          error: vaccineValidation.error,
          success: false,
        });
      }

      normalizedVaccineType = vaccineValidation.vaccineName;
    }

    // Get coverage by vaccine type
    const coverageQuery = `
      SELECT
        v.name as vaccine,
        COUNT(*) as total_scheduled,
        COUNT(CASE WHEN ir.status = 'completed' THEN 1 END) as completed,
        COUNT(CASE WHEN ir.status = 'overdue' THEN 1 END) as overdue,
        ROUND(
          (COUNT(CASE WHEN ir.status = 'completed' THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0)), 2
        ) as coverage_rate
      FROM immunization_records ir
      JOIN vaccines v ON ir.vaccine_id = v.id
      WHERE ir.is_active = true
      ${vaccineType ? 'AND v.name = $1' : ''}
      GROUP BY v.name
      ORDER BY coverage_rate DESC
    `;

    const coverageParams = normalizedVaccineType ? [normalizedVaccineType] : [];
    const result = await db.query(coverageQuery, coverageParams);

    res.json({
      coverageData: result.rows,
      success: true,
    });
  } catch (error) {
    console.error('Coverage report error:', error);
    res.status(500).json({
      error: 'Failed to generate coverage report',
      success: false,
    });
  }
});

// GET /api/vaccination-management/reports/inventory
// Get inventory report
router.get('/reports/inventory', auth, async (req, res) => {
  try {
    const query = `
      SELECT
        v.name as vaccine_name,
        SUM(i.quantity) as total_quantity,
        COUNT(*) as batch_count,
        MIN(i.expiry_date) as nearest_expiry,
        COUNT(CASE WHEN i.quantity <= 10 THEN 1 END) as low_stock_count,
        COUNT(CASE WHEN i.expiry_date <= CURRENT_DATE + INTERVAL '30 days' THEN 1 END) as expiring_soon_count
      FROM inventory i
      JOIN vaccines v ON i.vaccine_id = v.id
      GROUP BY v.name
      ORDER BY total_quantity DESC
    `;

    const result = await db.query(query);

    res.json({
      inventoryReport: result.rows,
      success: true,
    });
  } catch (error) {
    console.error('Inventory report error:', error);
    res.status(500).json({
      error: 'Failed to generate inventory report',
      success: false,
    });
  }
});

module.exports = router;
