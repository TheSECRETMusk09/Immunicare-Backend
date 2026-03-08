const db = require('../db');

/**
 * Middleware to check facility access
 * Ensures users can only access data for their assigned facility
 * except for city-level users who can access all facilities
 */
const checkFacilityAccess = async (req, res, next) => {
  try {
    // Get facility ID from user token
    const userFacilityId = req.user.facility_id || req.user.clinic_id;
    const requestedFacilityId = req.params.facilityId || req.body.facilityId;

    // If no facility ID in request, continue
    if (!requestedFacilityId) {
      return next();
    }

    // City-level users can access all facilities
    const isCityLevel =
      req.user.role === 'super_admin' ||
      req.user.role === 'admin' ||
      req.user.role === 'city_staff';

    if (isCityLevel) {
      return next();
    }

    // Check if user belongs to the requested facility
    if (userFacilityId && parseInt(userFacilityId) === parseInt(requestedFacilityId)) {
      return next();
    }

    // User is trying to access a facility they don't belong to
    return res.status(403).json({
      error: 'Access denied. You can only access data for your assigned facility.',
      success: false
    });
  } catch (error) {
    console.error('Facility access check error:', error);
    res.status(500).json({
      error: 'Failed to verify facility access',
      success: false
    });
  }
};

/**
 * Middleware to get user's facility information
 */
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
      [facilityId]
    );

    req.facilityInfo = result.rows[0] || null;
    next();
  } catch (error) {
    console.error('Get facility info error:', error);
    req.facilityInfo = null;
    next();
  }
};

/**
 * Middleware to ensure user is at a barangay-level facility
 */
const requireBarangayAccess = (req, res, next) => {
  const facilityId = req.user.facility_id || req.user.clinic_id;

  // City-level users can also access barangay data
  const isCityLevel =
    req.user.role === 'super_admin' || req.user.role === 'admin' || req.user.role === 'city_staff';

  if (isCityLevel) {
    return next();
  }

  // For non-city users, they must be at a barangay
  // This can be extended to check facility_subtype
  if (facilityId) {
    return next();
  }

  return res.status(403).json({
    error: 'Access denied. Barangay access required.',
    success: false
  });
};

/**
 * Middleware to ensure user is at a city-level facility (warehouse/admin)
 */
const requireCityAccess = (req, res, next) => {
  const isCityLevel =
    req.user.role === 'super_admin' || req.user.role === 'admin' || req.user.role === 'city_staff';

  if (isCityLevel) {
    return next();
  }

  return res.status(403).json({
    error: 'Access denied. City-level access required.',
    success: false
  });
};

module.exports = {
  checkFacilityAccess,
  getFacilityInfo,
  requireBarangayAccess,
  requireCityAccess
};
