const express = require('express');
const patientService = require('../services/patientService');
const { authenticateToken } = require('../middleware/auth');
const {
  CANONICAL_ROLES,
  getCanonicalRole,
  requirePermission,
} = require('../middleware/rbac');
const {
  isScopeRequestAllowed,
  resolveEffectiveScope,
  resolvePatientFacilityId,
} = require('../services/entityScopeService');
const socketService = require('../services/socketService');
const adminNotificationService = require('../services/adminNotificationService');

const router = express.Router();

router.use(authenticateToken);

const isGuardian = (req) => getCanonicalRole(req) === CANONICAL_ROLES.GUARDIAN;

const guardianOwnsPatient = async (guardianId, patientId) => {
  const patient = await patientService.getPatientById(patientId);
  return patient && patient.guardianId === guardianId;
};

// Middleware to check guardian ownership
const requireGuardianOwnership = async (req, res, next) => {
  if (isGuardian(req)) {
    const patientId = parseInt(req.params.id || req.params.patientId);
    const guardianId = req.user?.id;

    if (!await guardianOwnsPatient(guardianId, patientId)) {
      return res.status(403).json({
        error: 'Access denied',
        message: 'You can only access your own patients'
      });
    }
  }
  next();
};

// GET /api/patients - Get patients with filtering and pagination
router.get('/', async (req, res) => {
  try {
    // Check scope permissions
    const effectiveScope = await resolveEffectiveScope(req.user, req.query);
    if (!isScopeRequestAllowed(req.user, 'patients', 'read', effectiveScope)) {
      return res.status(403).json({
        error: 'Insufficient permissions',
        message: 'You do not have permission to read patients'
      });
    }

    // Build filters from query parameters
    const filters = {
      search: req.query.search,
      guardianId: req.query.guardianId ? parseInt(req.query.guardianId) : undefined,
      facilityId: await resolvePatientFacilityId(req.user, effectiveScope),
      sex: req.query.sex,
      minAgeMonths: req.query.minAgeMonths ? parseInt(req.query.minAgeMonths) : undefined,
      maxAgeMonths: req.query.maxAgeMonths ? parseInt(req.query.maxAgeMonths) : undefined,
      dateFrom: req.query.dateFrom,
      dateTo: req.query.dateTo,
      isActive: req.query.isActive !== undefined ? req.query.isActive === 'true' : undefined,
      limit: Math.min(parseInt(req.query.limit) || 25, 100), // Cap at 100 for performance
      offset: parseInt(req.query.offset) || 0,
      orderBy: req.query.orderBy || 'created_at',
      orderDirection: req.query.orderDirection || 'DESC'
    };

    // Guardian can only see their own patients
    if (isGuardian(req)) {
      filters.guardianId = req.user.id;
    }

    const result = await patientService.getPatients(filters);

    res.json({
      success: true,
      data: result.patients || [],
      pagination: result.pagination || {
        limit: filters.limit,
        offset: filters.offset,
        total: result.total,
      },
      summary: result.summary || null,
    });

  } catch (error) {
    console.error('Error fetching patients:', error);
    res.status(500).json({
      error: 'Failed to fetch patients',
      message: error.message
    });
  }
});

// GET /api/patients/:id - Get single patient
router.get('/:id', requireGuardianOwnership, async (req, res) => {
  try {
    // Check scope permissions
    const effectiveScope = await resolveEffectiveScope(req.user, req.query);
    if (!isScopeRequestAllowed(req.user, 'patients', 'read', effectiveScope)) {
      return res.status(403).json({
        error: 'Insufficient permissions',
        message: 'You do not have permission to read patients'
      });
    }

    const patientId = parseInt(req.params.id);
    if (isNaN(patientId)) {
      return res.status(400).json({
        error: 'Invalid patient ID',
        message: 'Patient ID must be a valid number'
      });
    }

    const patient = await patientService.getPatientById(patientId);
    
    if (!patient) {
      return res.status(404).json({
        error: 'Patient not found',
        message: 'Patient with the specified ID was not found'
      });
    }

    res.json({
      success: true,
      data: patient
    });

  } catch (error) {
    console.error('Error fetching patient:', error);
    res.status(500).json({
      error: 'Failed to fetch patient',
      message: error.message
    });
  }
});

// GET /api/patients/guardian/:guardianId - Get patients by guardian
router.get('/guardian/:guardianId', async (req, res) => {
  try {
    // Check scope permissions
    const effectiveScope = await resolveEffectiveScope(req.user, req.query);
    if (!isScopeRequestAllowed(req.user, 'patients', 'read', effectiveScope)) {
      return res.status(403).json({
        error: 'Insufficient permissions',
        message: 'You do not have permission to read patients'
      });
    }

    const guardianId = parseInt(req.params.guardianId);
    if (isNaN(guardianId)) {
      return res.status(400).json({
        error: 'Invalid guardian ID',
        message: 'Guardian ID must be a valid number'
      });
    }

    // Guardian can only access their own patients
    if (isGuardian(req) && guardianId !== req.user.id) {
      return res.status(403).json({
        error: 'Access denied',
        message: 'You can only access your own patients'
      });
    }

    const filters = {
      search: req.query.search,
      sex: req.query.sex,
      minAgeMonths: req.query.minAgeMonths ? parseInt(req.query.minAgeMonths) : undefined,
      maxAgeMonths: req.query.maxAgeMonths ? parseInt(req.query.maxAgeMonths) : undefined,
      dateFrom: req.query.dateFrom,
      dateTo: req.query.dateTo,
      isActive: req.query.isActive !== undefined ? req.query.isActive === 'true' : undefined,
      limit: Math.min(parseInt(req.query.limit) || 25, 100),
      offset: parseInt(req.query.offset) || 0,
      orderBy: req.query.orderBy || 'created_at',
      orderDirection: req.query.orderDirection || 'DESC'
    };

    const patients = await patientService.getPatientsByGuardianId(guardianId, filters);

    res.json({
      success: true,
      data: patients.patients || [],
      pagination: patients.pagination || {
        limit: filters.limit,
        offset: filters.offset,
        total: patients.total || (patients.patients || []).length,
      },
      summary: patients.summary || null,
    });

  } catch (error) {
    console.error('Error fetching patients by guardian:', error);
    res.status(500).json({
      error: 'Failed to fetch patients',
      message: error.message
    });
  }
});

// GET /api/patients/stats - Get patient statistics
router.get('/stats', async (req, res) => {
  try {
    // Check scope permissions
    const effectiveScope = await resolveEffectiveScope(req.user, req.query);
    if (!isScopeRequestAllowed(req.user, 'patients', 'read', effectiveScope)) {
      return res.status(403).json({
        error: 'Insufficient permissions',
        message: 'You do not have permission to read patient statistics'
      });
    }

    const filters = {
      facilityId: await resolvePatientFacilityId(req.user, effectiveScope),
      guardianId: isGuardian(req) ? req.user.id : req.query.guardianId ? parseInt(req.query.guardianId) : undefined
    };

    const stats = await patientService.getPatientStats(filters);

    res.json({
      success: true,
      data: stats
    });

  } catch (error) {
    console.error('Error fetching patient stats:', error);
    res.status(500).json({
      error: 'Failed to fetch patient statistics',
      message: error.message
    });
  }
});

// POST /api/patients - Create new patient
router.post('/', async (req, res) => {
  try {
    // Check scope permissions
    const effectiveScope = await resolveEffectiveScope(req.user, req.body);
    if (!isScopeRequestAllowed(req.user, 'patients', 'create', effectiveScope)) {
      return res.status(403).json({
        error: 'Insufficient permissions',
        message: 'You do not have permission to create patients'
      });
    }

    const {
      firstName,
      lastName,
      middleName,
      dob,
      sex,
      nationalId,
      address,
      contact,
      guardianId,
      facilityId,
      birthHeight,
      birthWeight,
      motherName,
      fatherName,
      barangay,
      healthCenter,
      purok,
      streetColor,
      familyNo,
      placeOfBirth,
      timeOfDelivery,
      typeOfDelivery,
      doctorMidwifeNurse,
      nbsDone,
      nbsDate,
      cellphoneNumber,
      photoUrl
    } = req.body;

    // Validate required fields
    if (!firstName || !lastName || !dob || !sex || !guardianId) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'First name, last name, date of birth, sex, and guardian ID are required'
      });
    }

    // Guardian can only create patients for themselves
    if (isGuardian(req) && guardianId !== req.user.id) {
      return res.status(403).json({
        error: 'Access denied',
        message: 'You can only create patients for yourself'
      });
    }

    const patientData = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      middleName: middleName ? middleName.trim() : null,
      dob: new Date(dob),
      sex: sex.toLowerCase(),
      nationalId: nationalId ? nationalId.trim() : null,
      address: address ? address.trim() : null,
      contact: contact ? contact.trim() : null,
      guardianId: parseInt(guardianId),
      facilityId: facilityId ? parseInt(facilityId) : null,
      birthHeight: birthHeight ? parseFloat(birthHeight) : null,
      birthWeight: birthWeight ? parseFloat(birthWeight) : null,
      motherName: motherName ? motherName.trim() : null,
      fatherName: fatherName ? fatherName.trim() : null,
      barangay: barangay ? barangay.trim() : null,
      healthCenter: healthCenter ? healthCenter.trim() : null,
      purok: purok ? purok.trim() : null,
      streetColor: streetColor ? streetColor.trim() : null,
      familyNo: familyNo ? familyNo.trim() : null,
      placeOfBirth: placeOfBirth ? placeOfBirth.trim() : null,
      timeOfDelivery: timeOfDelivery || null,
      typeOfDelivery: typeOfDelivery ? typeOfDelivery.trim() : null,
      doctorMidwifeNurse: doctorMidwifeNurse ? doctorMidwifeNurse.trim() : null,
      nbsDone: nbsDone === true || nbsDone === 'true',
      nbsDate: nbsDate ? new Date(nbsDate) : null,
      cellphoneNumber: cellphoneNumber ? cellphoneNumber.trim() : null,
      photoUrl: photoUrl ? photoUrl.trim() : null,
      isActive: true
    };

    const patient = await patientService.createPatient(patientData, req.user.id);

    // Send real-time update
    socketService.emitPatientUpdate(patient);

    // Send notification to admins
    await adminNotificationService.sendPatientCreatedNotification(patient, req.user);

    res.status(201).json({
      success: true,
      data: patient,
      message: 'Patient created successfully'
    });

  } catch (error) {
    console.error('Error creating patient:', error);
    res.status(500).json({
      error: 'Failed to create patient',
      message: error.message
    });
  }
});

// PUT /api/patients/:id - Update patient
router.put('/:id', requireGuardianOwnership, async (req, res) => {
  try {
    // Check scope permissions
    const effectiveScope = await resolveEffectiveScope(req.user, req.body);
    if (!isScopeRequestAllowed(req.user, 'patients', 'update', effectiveScope)) {
      return res.status(403).json({
        error: 'Insufficient permissions',
        message: 'You do not have permission to update patients'
      });
    }

    const patientId = parseInt(req.params.id);
    if (isNaN(patientId)) {
      return res.status(400).json({
        error: 'Invalid patient ID',
        message: 'Patient ID must be a valid number'
      });
    }

    // Check if patient exists
    const existingPatient = await patientService.getPatientById(patientId);
    if (!existingPatient) {
      return res.status(404).json({
        error: 'Patient not found',
        message: 'Patient with the specified ID was not found'
      });
    }

    const {
      firstName,
      lastName,
      middleName,
      dob,
      sex,
      nationalId,
      address,
      contact,
      facilityId,
      birthHeight,
      birthWeight,
      motherName,
      fatherName,
      barangay,
      healthCenter,
      purok,
      streetColor,
      familyNo,
      placeOfBirth,
      timeOfDelivery,
      typeOfDelivery,
      doctorMidwifeNurse,
      nbsDone,
      nbsDate,
      cellphoneNumber,
      photoUrl,
      isActive
    } = req.body;

    const patientData = {};

    // Only include provided fields
    if (firstName !== undefined) patientData.firstName = firstName.trim();
    if (lastName !== undefined) patientData.lastName = lastName.trim();
    if (middleName !== undefined) patientData.middleName = middleName ? middleName.trim() : null;
    if (dob !== undefined) patientData.dob = new Date(dob);
    if (sex !== undefined) patientData.sex = sex.toLowerCase();
    if (nationalId !== undefined) patientData.nationalId = nationalId ? nationalId.trim() : null;
    if (address !== undefined) patientData.address = address ? address.trim() : null;
    if (contact !== undefined) patientData.contact = contact ? contact.trim() : null;
    if (facilityId !== undefined) patientData.facilityId = facilityId ? parseInt(facilityId) : null;
    if (birthHeight !== undefined) patientData.birthHeight = birthHeight ? parseFloat(birthHeight) : null;
    if (birthWeight !== undefined) patientData.birthWeight = birthWeight ? parseFloat(birthWeight) : null;
    if (motherName !== undefined) patientData.motherName = motherName ? motherName.trim() : null;
    if (fatherName !== undefined) patientData.fatherName = fatherName ? fatherName.trim() : null;
    if (barangay !== undefined) patientData.barangay = barangay ? barangay.trim() : null;
    if (healthCenter !== undefined) patientData.healthCenter = healthCenter ? healthCenter.trim() : null;
    if (purok !== undefined) patientData.purok = purok ? purok.trim() : null;
    if (streetColor !== undefined) patientData.streetColor = streetColor ? streetColor.trim() : null;
    if (familyNo !== undefined) patientData.familyNo = familyNo ? familyNo.trim() : null;
    if (placeOfBirth !== undefined) patientData.placeOfBirth = placeOfBirth ? placeOfBirth.trim() : null;
    if (timeOfDelivery !== undefined) patientData.timeOfDelivery = timeOfDelivery || null;
    if (typeOfDelivery !== undefined) patientData.typeOfDelivery = typeOfDelivery ? typeOfDelivery.trim() : null;
    if (doctorMidwifeNurse !== undefined) patientData.doctorMidwifeNurse = doctorMidwifeNurse ? doctorMidwifeNurse.trim() : null;
    if (nbsDone !== undefined) patientData.nbsDone = nbsDone === true || nbsDone === 'true';
    if (nbsDate !== undefined) patientData.nbsDate = nbsDate ? new Date(nbsDate) : null;
    if (cellphoneNumber !== undefined) patientData.cellphoneNumber = cellphoneNumber ? cellphoneNumber.trim() : null;
    if (photoUrl !== undefined) patientData.photoUrl = photoUrl ? photoUrl.trim() : null;
    if (isActive !== undefined) patientData.isActive = isActive === true || isActive === 'true';

    const patient = await patientService.updatePatient(patientId, patientData, req.user.id);

    // Compatibility hook only; canonical child records stay in patients.
    await patientService.syncToLegacyInfants(patient);

    // Send real-time update
    socketService.emitPatientUpdate(patient);

    // Send notification to admins
    await adminNotificationService.sendPatientUpdatedNotification(patient, req.user);

    res.json({
      success: true,
      data: patient,
      message: 'Patient updated successfully'
    });

  } catch (error) {
    console.error('Error updating patient:', error);
    res.status(500).json({
      error: 'Failed to update patient',
      message: error.message
    });
  }
});

// DELETE /api/patients/:id - Soft delete patient
router.delete('/:id', requireGuardianOwnership, async (req, res) => {
  try {
    // Check scope permissions
    const effectiveScope = await resolveEffectiveScope(req.user, req.query);
    if (!isScopeRequestAllowed(req.user, 'patients', 'delete', effectiveScope)) {
      return res.status(403).json({
        error: 'Insufficient permissions',
        message: 'You do not have permission to delete patients'
      });
    }

    const patientId = parseInt(req.params.id);
    if (isNaN(patientId)) {
      return res.status(400).json({
        error: 'Invalid patient ID',
        message: 'Patient ID must be a valid number'
      });
    }

    const patient = await patientService.deletePatient(patientId, req.user.id);

    if (!patient) {
      return res.status(404).json({
        error: 'Patient not found',
        message: 'Patient with the specified ID was not found'
      });
    }

    // Send real-time update
    socketService.emitPatientUpdate(patient);

    // Send notification to admins
    await adminNotificationService.sendPatientDeletedNotification(patient, req.user);

    res.json({
      success: true,
      data: patient,
      message: 'Patient deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting patient:', error);
    res.status(500).json({
      error: 'Failed to delete patient',
      message: error.message
    });
  }
});

module.exports = router;
