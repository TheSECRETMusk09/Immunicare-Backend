const smsService = require('./services/smsService');

async function testSmsReminder() {
  console.log('=== SMS Reminder Test ===');

  try {
    const testAppointment = {
      phoneNumber: '09945640538',
      vaccineName: 'Pentavalent',
      scheduledDate: new Date('2026-03-10'),
    };

    console.log('Recipient Phone:', testAppointment.phoneNumber);
    console.log('Vaccine Type:', testAppointment.vaccineName);
    console.log('Scheduled Date:', testAppointment.scheduledDate);

    // Test message creation
    const formattedDate = testAppointment.scheduledDate.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
    const message = smsService.createAppointmentReminderMessage(
      testAppointment.vaccineName,
      formattedDate,
    );
    console.log('Message to Send:', message);

    // Send the SMS
    const result = await smsService.sendAppointmentReminder(testAppointment);
    console.log('=== Success ===');
    console.log('Provider:', result.provider);
    console.log('Message ID:', result.messageId);
    console.log('Raw Response:', JSON.stringify(result, null, 2));

  } catch (error) {
    console.log('=== Error ===');
    console.log('Message:', error.message);
    console.log('Stack:', error.stack);
  }
}

testSmsReminder();
