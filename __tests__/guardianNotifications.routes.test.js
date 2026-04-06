jest.mock('../services/guardianNotificationService', () => ({
  getGuardianNotifications: jest.fn(),
  getUnreadCount: jest.fn(),
}));

jest.mock('../middleware/guardianAuth', () => ({
  authenticateGuardian: jest.fn((req, _res, next) => {
    req.guardian = { id: 7 };
    next();
  }),
}));

jest.mock('../services/socketService', () => ({
  sendToGuardian: jest.fn(),
}));

jest.mock('../config/logger', () => ({
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const guardianNotificationService = require('../services/guardianNotificationService');
const guardianNotificationsRouter = require('../routes/guardianNotifications');

describe('guardian notification routes', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/api/guardian/notifications', guardianNotificationsRouter);
  });

  test('lists guardian notifications for the authenticated guardian', async () => {
    guardianNotificationService.getGuardianNotifications.mockResolvedValue([
      { id: 11, title: 'Upcoming Appointment', notification_type: 'appointment_confirmation' },
    ]);

    const response = await request(app).get('/api/guardian/notifications');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      count: 1,
    });
    expect(response.body.data[0]).toMatchObject({
      id: 11,
      title: 'Upcoming Appointment',
    });
    expect(guardianNotificationService.getGuardianNotifications).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        limit: 50,
        offset: 0,
        unreadOnly: false,
      }),
    );
  });

  test('returns guardian unread notification count', async () => {
    guardianNotificationService.getUnreadCount.mockResolvedValue(3);

    const response = await request(app).get('/api/guardian/notifications/unread-count');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      count: 3,
    });
    expect(guardianNotificationService.getUnreadCount).toHaveBeenCalledWith(7);
  });
});
