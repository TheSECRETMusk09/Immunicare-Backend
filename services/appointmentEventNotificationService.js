const pool = require('../db');
const socketService = require('./socketService');
const { formatClinicDateTime } = require('../utils/appointmentDateTime');

let cachedNotificationColumns = null;
let cachedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

const getNotificationColumns = async () => {
  const now = Date.now();
  if (cachedNotificationColumns && now - cachedAt < CACHE_TTL_MS) {
    return cachedNotificationColumns;
  }

  const result = await pool.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'notifications'
    `,
  );

  cachedNotificationColumns = new Set(result.rows.map((row) => row.column_name));
  cachedAt = now;
  return cachedNotificationColumns;
};

const getActiveAdminRecipients = async () => {
  try {
    const result = await pool.query(
      `
        SELECT id, username, role
        FROM admin
        WHERE is_active = true
      `,
    );

    if (result.rows.length > 0) {
      return result.rows;
    }
  } catch {
    // fallback below
  }

  return [];
};

const buildInsertPayload = ({
  adminId,
  actorUserId,
  eventType,
  title,
  message,
  appointmentId,
  guardianId,
  actionUrl,
  metadata,
}) => {
  const payload = {
    user_id: adminId,
    title,
    message,
    type: 'appointment',
    category: 'appointment',
    is_read: false,
    notification_type: eventType,
    target_type: 'user',
    target_id: adminId,
    channel: 'push',
    priority: 'high',
    status: 'pending',
    related_entity_type: 'appointment',
    related_entity_id: appointmentId,
    action_required: true,
    action_url: actionUrl || '/appointments',
    guardian_id: guardianId || null,
    target_role: 'admin',
    created_by: actorUserId || null,
    metadata: metadata || null,
  };

  return payload;
};

const insertNotificationRow = async (payload) => {
  const columns = await getNotificationColumns();
  const keys = Object.keys(payload).filter((key) => columns.has(key));

  if (keys.length === 0) {
    return null;
  }

  const placeholders = keys.map((_, index) => `$${index + 1}`);
  const values = keys.map((key) => payload[key]);

  try {
    const result = await pool.query(
      `
        INSERT INTO notifications (${keys.join(', ')})
        VALUES (${placeholders.join(', ')})
        RETURNING *
      `,
      values,
    );
    return result.rows[0] || null;
  } catch {
    return null;
  }
};

const formatGuardianAppointmentEvent = ({
  event,
  appointment,
  guardianName,
  infantName,
  previousAppointment = null,
}) => {
  const readableEvent =
    event === 'created'
      ? 'created'
      : event === 'updated'
        ? 'updated'
        : event === 'cancelled'
          ? 'cancelled'
          : 'updated';

  const title = `Guardian ${readableEvent} appointment`;
  const guardianLabel = guardianName || `Guardian #${appointment.owner_guardian_id || 'N/A'}`;
  const infantLabel = infantName || `${appointment.first_name || ''} ${appointment.last_name || ''}`.trim() || 'Unknown infant';
  const formattedSchedule = formatClinicDateTime(appointment.scheduled_date) || 'Unknown schedule';

  let message = `${guardianLabel} ${readableEvent} an appointment for ${infantLabel} on ${formattedSchedule}.`;

  if (event === 'updated' && previousAppointment?.scheduled_date) {
    message = `${guardianLabel} updated appointment #${appointment.id} for ${infantLabel}. New schedule: ${formattedSchedule}.`;
  }

  if (event === 'cancelled') {
    const reason = appointment.cancellation_reason ? ` Reason: ${appointment.cancellation_reason}.` : '';
    message = `${guardianLabel} cancelled appointment #${appointment.id} for ${infantLabel}.${reason}`;
  }

  return { title, message };
};

const notifyAdminsOfGuardianAppointmentEvent = async ({
  event,
  appointment,
  actorUserId,
  guardianName,
  infantName,
  previousAppointment,
}) => {
  const admins = await getActiveAdminRecipients();
  if (admins.length === 0) {
    return { delivered: 0, stored: 0 };
  }

  const { title, message } = formatGuardianAppointmentEvent({
    event,
    appointment,
    guardianName,
    infantName,
    previousAppointment,
  });
  const metadata = {
    appointment_id: appointment.id || null,
    infant_id: appointment.infant_id || appointment.patient_id || null,
    infant_name:
      infantName || `${appointment.first_name || ''} ${appointment.last_name || ''}`.trim() || null,
    guardian_name: guardianName || appointment.guardian_name || null,
    scheduled_date: appointment.scheduled_date || null,
    previous_scheduled_date: previousAppointment?.scheduled_date || null,
  };

  let delivered = 0;
  let stored = 0;

  for (const admin of admins) {
    const payload = buildInsertPayload({
      adminId: admin.id,
      actorUserId,
      eventType: `appointment_${event}`,
      title,
      message,
      appointmentId: appointment.id,
      guardianId: appointment.owner_guardian_id || null,
      metadata,
    });

    const storedNotification = await insertNotificationRow(payload);
    if (storedNotification) {
      stored += 1;
    }

    socketService.sendToUser(admin.id, 'notification', {
      notification: {
        id: storedNotification?.id || `appt-${event}-${appointment.id}-${admin.id}`,
        title,
        message,
        type: 'appointment',
        category: 'appointment',
        priority: 'high',
        isRead: false,
        relatedEntityType: 'appointment',
        relatedEntityId: appointment.id,
      },
      sound: true,
    });

    delivered += 1;
  }

  socketService.sendToRole('SYSTEM_ADMIN', 'notification', {
    notification: {
      title,
      message,
      type: 'appointment',
      category: 'appointment',
      priority: 'high',
    },
    sound: true,
  });

  socketService.sendToRole('admin', 'notification', {
    notification: {
      title,
      message,
      type: 'appointment',
      category: 'appointment',
      priority: 'high',
    },
    sound: true,
  });

  return { delivered, stored };
};

module.exports = {
  notifyAdminsOfGuardianAppointmentEvent,
};
