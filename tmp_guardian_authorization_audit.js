const axios = require('axios');

const BASE_URL = 'http://localhost:5000/api';
const GUARDIAN_EMAIL = 'guardian.verify.1772869154582@example.com';
const GUARDIAN_PASSWORD = 'guardian123';

function pickError(body) {
  if (!body) {
    return null;
  }
  if (typeof body === 'string') {
    return body.slice(0, 280);
  }
  if (typeof body.error === 'string') {
    return body.error;
  }
  if (typeof body.message === 'string') {
    return body.message;
  }
  if (body.error && typeof body.error.message === 'string') {
    return body.error.message;
  }
  return null;
}

function summarizeBody(body) {
  if (Array.isArray(body)) {
    return {
      type: 'array',
      length: body.length,
      firstKeys: body[0] ? Object.keys(body[0]).slice(0, 8) : [],
    };
  }

  if (body && typeof body === 'object') {
    const summary = {
      type: 'object',
      keys: Object.keys(body).slice(0, 12),
    };

    if (typeof body.success === 'boolean') {
      summary.success = body.success;
    }
    if (typeof body.count === 'number') {
      summary.count = body.count;
    }
    if (typeof body.unreadCount === 'number') {
      summary.unreadCount = body.unreadCount;
    }
    if (Array.isArray(body.data)) {
      summary.dataLength = body.data.length;
    }
    if (Array.isArray(body.notifications)) {
      summary.notificationsLength = body.notifications.length;
    }

    const err = pickError(body);
    if (err) {
      summary.error = err;
    }

    return summary;
  }

  return {
    type: typeof body,
    value: String(body).slice(0, 280),
  };
}

async function call(name, method, path, token = null, data = undefined) {
  try {
    const response = await axios({
      method,
      url: `${BASE_URL}${path}`,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      data,
      timeout: 15000,
      validateStatus: () => true,
    });

    return {
      name,
      method: method.toUpperCase(),
      path,
      status: response.status,
      body: response.data,
    };
  } catch (error) {
    return {
      name,
      method: method.toUpperCase(),
      path,
      status: 0,
      body: {
        error: error.message,
      },
    };
  }
}

function simplify(result) {
  const error = pickError(result.body);
  return {
    name: result.name,
    method: result.method,
    path: result.path,
    status: result.status,
    summary: summarizeBody(result.body),
    ...(error ? { error } : {}),
  };
}

(async () => {
  const report = {
    timestamp: new Date().toISOString(),
    scope: 'guardian_authorization_matrix',
    login: null,
    guardianId: null,
    ownInfantId: null,
    ownAppointmentId: null,
    ownVaccinationId: null,
    ownGrowthId: null,
    results: [],
  };

  const loginResult = await call(
    'login_guardian',
    'post',
    '/auth/login',
    null,
    { email: GUARDIAN_EMAIL, password: GUARDIAN_PASSWORD },
  );

  report.login = simplify(loginResult);

  const token = loginResult.body?.token || null;
  const guardianId = loginResult.body?.user?.guardian_id || loginResult.body?.user?.id || null;
  report.guardianId = guardianId;

  if (!token || !guardianId) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(0);
  }

  const otherGuardianId = Number(guardianId) + 1;
  const results = [];

  results.push(await call('auth_verify', 'get', '/auth/verify', token));

  results.push(await call('dashboard_stats_own', 'get', `/dashboard/guardian/${guardianId}/stats`, token));
  results.push(await call('dashboard_stats_other', 'get', `/dashboard/guardian/${otherGuardianId}/stats`, token));

  results.push(await call('dashboard_appointments_own', 'get', `/dashboard/guardian/${guardianId}/appointments`, token));
  results.push(await call('dashboard_appointments_other', 'get', `/dashboard/guardian/${otherGuardianId}/appointments`, token));

  results.push(await call('dashboard_children_own', 'get', `/dashboard/guardian/${guardianId}/children`, token));
  results.push(await call('dashboard_children_other', 'get', `/dashboard/guardian/${otherGuardianId}/children`, token));

  results.push(await call('dashboard_vaccinations_own', 'get', `/dashboard/guardian/${guardianId}/vaccinations`, token));
  results.push(await call('dashboard_vaccinations_other', 'get', `/dashboard/guardian/${otherGuardianId}/vaccinations`, token));

  results.push(await call('dashboard_growth_own', 'get', `/dashboard/guardian/${guardianId}/health-charts`, token));
  results.push(await call('dashboard_growth_other', 'get', `/dashboard/guardian/${otherGuardianId}/health-charts`, token));

  results.push(await call('dashboard_notifications_own', 'get', `/dashboard/guardian/${guardianId}/notifications`, token));
  results.push(await call('dashboard_notifications_other', 'get', `/dashboard/guardian/${otherGuardianId}/notifications`, token));

  const infantsOwn = await call('infants_guardian_own', 'get', `/infants/guardian/${guardianId}`, token);
  results.push(infantsOwn);
  results.push(await call('infants_guardian_other', 'get', `/infants/guardian/${otherGuardianId}`, token));
  results.push(await call('infants_root', 'get', '/infants', token));

  let ownInfantId = null;
  if (infantsOwn.status === 200) {
    if (Array.isArray(infantsOwn.body?.data) && infantsOwn.body.data.length > 0) {
      ownInfantId = infantsOwn.body.data[0].id;
    } else if (Array.isArray(infantsOwn.body) && infantsOwn.body.length > 0) {
      ownInfantId = infantsOwn.body[0].id;
    }
  }
  report.ownInfantId = ownInfantId;

  results.push(await call('appointments_list', 'get', '/appointments', token));
  const appointmentByOne = await call('appointment_by_id_1', 'get', '/appointments/1', token);
  results.push(appointmentByOne);

  results.push(await call('notifications_list', 'get', '/notifications', token));
  results.push(await call('notifications_unread_count', 'get', '/notifications/unread-count', token));

  results.push(await call('guardian_profile_own_get', 'get', `/users/guardian/profile/${guardianId}`, token));
  results.push(await call('guardian_profile_other_get', 'get', `/users/guardian/profile/${otherGuardianId}`, token));

  results.push(
    await call(
      'guardian_profile_own_put',
      'put',
      `/users/guardian/profile/${guardianId}`,
      token,
      {
        name: 'Maria Santos',
        phone: '09123456789',
        email: GUARDIAN_EMAIL,
        address: 'No Change',
        emergency_contact: 'No Change',
        emergency_phone: '09123456789',
      },
    ),
  );

  results.push(await call('guardian_notifications_dedicated', 'get', '/guardian/notifications', token));
  results.push(await call('guardian_notifications_unread_dedicated', 'get', '/guardian/notifications/unread-count', token));

  results.push(await call('admin_dashboard_stats_guardian_forbidden', 'get', '/dashboard/stats', token));

  if (ownInfantId) {
    const otherInfantId = Number(ownInfantId) + 1;

    const vaccOwn = await call('vaccination_records_own_infant', 'get', `/vaccinations/records/infant/${ownInfantId}`, token);
    const vaccOther = await call('vaccination_records_other_infant', 'get', `/vaccinations/records/infant/${otherInfantId}`, token);
    results.push(vaccOwn, vaccOther);

    results.push(await call('vaccination_schedule_own_infant', 'get', `/vaccinations/schedules/infant/${ownInfantId}`, token));
    results.push(await call('vaccination_schedule_other_infant', 'get', `/vaccinations/schedules/infant/${otherInfantId}`, token));

    const growthOwn = await call('growth_records_own_infant', 'get', `/growth/infant/${ownInfantId}`, token);
    const growthOther = await call('growth_records_other_infant', 'get', `/growth/infant/${otherInfantId}`, token);
    results.push(growthOwn, growthOther);

    results.push(await call('growth_stats_own_infant', 'get', `/growth/infant/${ownInfantId}/stats`, token));
    results.push(await call('growth_stats_other_infant', 'get', `/growth/infant/${otherInfantId}/stats`, token));

    results.push(await call('growth_chart_own_infant', 'get', `/growth/infant/${ownInfantId}/chart`, token));
    results.push(await call('growth_chart_other_infant', 'get', `/growth/infant/${otherInfantId}/chart`, token));

    let ownVaccinationId = null;
    if (vaccOwn.status === 200 && Array.isArray(vaccOwn.body) && vaccOwn.body.length > 0) {
      ownVaccinationId = vaccOwn.body[0].id;
    }
    report.ownVaccinationId = ownVaccinationId;

    let ownGrowthId = null;
    if (growthOwn.status === 200 && Array.isArray(growthOwn.body) && growthOwn.body.length > 0) {
      ownGrowthId = growthOwn.body[0].id;
    }
    report.ownGrowthId = ownGrowthId;

    if (ownVaccinationId) {
      results.push(await call('vaccination_record_by_id_own', 'get', `/vaccinations/${ownVaccinationId}`, token));
      results.push(await call('vaccination_record_by_id_other_guess', 'get', `/vaccinations/${Number(ownVaccinationId) + 1}`, token));
    }

    if (ownGrowthId) {
      results.push(await call('growth_record_by_id_own', 'get', `/growth/${ownGrowthId}`, token));
      results.push(await call('growth_record_by_id_other_guess', 'get', `/growth/${Number(ownGrowthId) + 1}`, token));
    }
  }

  const ownAppointmentsResult = results.find((r) => r.name === 'dashboard_appointments_own');
  if (ownAppointmentsResult && ownAppointmentsResult.status === 200 && Array.isArray(ownAppointmentsResult.body) && ownAppointmentsResult.body.length > 0) {
    report.ownAppointmentId = ownAppointmentsResult.body[0].id;
  }

  if (report.ownAppointmentId) {
    results.push(await call('appointment_by_id_own', 'get', `/appointments/${report.ownAppointmentId}`, token));
    results.push(await call('appointment_by_id_other_guess', 'get', `/appointments/${Number(report.ownAppointmentId) + 1}`, token));
  }

  report.results = results.map(simplify);
  console.log(JSON.stringify(report, null, 2));
})();
