jest.mock('../db', () => ({
  query: jest.fn(),
}));

jest.mock('../services/smsService', () => ({
  formatPhoneNumber: jest.fn(),
  sendSMS: jest.fn(),
}));

jest.mock('../config/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../services/socketService', () => ({
  sendToUser: jest.fn(),
}));

const pool = require('../db');
const socketService = require('../services/socketService');
const appointmentConfirmationService = require('../services/appointmentConfirmationService');

describe('appointment confirmation guardian notifications', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pool.query.mockResolvedValue({
      rows: [{ id: 501 }],
    });
  });

  test('creates an in-app upcoming appointment notification independent of SMS delivery', async () => {
    const result = await appointmentConfirmationService.notifyGuardianAppointmentBooked({
      guardianId: 14,
      guardianName: 'Parent One',
      infantName: 'Child One',
      appointmentId: 99,
      scheduledDate: '2030-03-04T09:00:00.000Z',
      clinicName: 'San Nicolas Health Center',
      appointmentType: 'Vaccination',
    });

    expect(result).toMatchObject({
      success: true,
      notificationId: 501,
    });

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO notifications'),
      expect.arrayContaining([
        14,
        'Upcoming Appointment Booked',
        expect.stringContaining('Child One'),
        'appointment',
        'appointment',
        false,
        'appointment_confirmation',
      ]),
    );

    expect(socketService.sendToUser).toHaveBeenCalledWith(
      14,
      'notification',
      expect.objectContaining({
        notification: expect.objectContaining({
          title: 'Upcoming Appointment Booked',
          relatedEntityId: 99,
        }),
      }),
    );
  });
});
