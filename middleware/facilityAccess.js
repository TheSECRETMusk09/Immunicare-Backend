const db = require('../db');

const checkFacilityAccess = async (req, res, next) => {
  try {
    const userFacilityId = req.user.facility_id || req.user.clinic_id;
    const requestedFacilityId = req.params.facilityId || req.body.facilityId;

    if (!requestedFacilityId) {
      return next();
    }

    const isCityLevel =
      req.user.role === 'super_admin' ||
      req.user.role === 'admin' ||
      req.user.role === 'city_staff';

    if (isCityLevel) {
      return next();
    }

    if (userFacilityId && parseInt(userFacilityId) === parseInt(requestedFacilityId)) {
      return next();
    }

    return res.status(403).json({
      error: 'Access denied. You can only access data for your assigned facility.',
      success: false,
    });
  } catch (error) {
    console.error('Facility access check error:', error);
    res.status(500).json({
      error: 'Failed to verify facility access',
      success: false,
    });
  }
};

const getFacilityInfo = async (req, res, next) => {
  try {
    const facilityId = req.user.facility_id || req.user.clinic_id;

    if (!facilityId) {
      req.facilityInfo = null;
      return next();
    }

    const result = await db.query(
      `SELECT id, name, facility_type, facility_subtype, is_warehouse, parent_facility_id
       FROM healthcare_facilities WHERE id = $1`,
      [facilityId],
    );

    req.facilityInfo = result.rows[0] || null;
    next();
  } catch (error) {
    console.error('Get facility info error:', error);
    req.facilityInfo = null;
    next();
  }
};

const requireBarangayAccess = (req, res, next) => {
  const facilityId = req.user.facility_id || req.user.clinic_id;

  const isCityLevel =
    req.user.role === 'super_admin' || req.user.role === 'admin' || req.user.role === 'city_staff';

  if (isCityLevel) {
    return next();
  }

  if (facilityId) {
    return next();
  }

  return res.status(403).json({
    error: 'Access denied. Barangay access required.',
    success: false,
  });
};

const requireCityAccess = (req, res, next) => {
  const isCityLevel =
    req.user.role === 'super_admin' || req.user.role === 'admin' || req.user.role === 'city_staff';

  if (isCityLevel) {
    return next();
  }

  return res.status(403).json({
    error: 'Access denied. City-level access required.',
    success: false,
  });
};

module.exports = {
  checkFacilityAccess,
  getFacilityInfo,
  requireBarangayAccess,
  requireCityAccess,
};
