# Production SMS & Email Configuration Guide
## Immunicare Vaccination Management System

This document provides instructions for configuring SMS and Email services in production.

---

## SMS Configuration (TextBee.dev)

### Sign Up for TextBee

1. Visit https://textbee.dev/
2. Create an account
3. Verify your phone number
4. Obtain your API Key from the dashboard
5. Set up a device (virtual or physical) to send SMS

### Environment Variables

Add these to your `.env` file:

```bash
# SMS Gateway Selection
SMS_GATEWAY=textbee

# TextBee Configuration
TEXTBEE_API_KEY=your_api_key_here
TEXTBEE_DEVICE_ID=your_device_id
TEXTBEE_SENDER_NAME=IMMUNICARE

# OTP Configuration (optional - defaults provided)
OTP_LENGTH=6
OTP_EXPIRY_MINUTES=5
OTP_MAX_ATTEMPTS=3
OTP_RESEND_COOLDOWN=60

# Rate Limiting (optional - defaults provided)
SMS_MAX_PER_HOUR=10
SMS_MAX_PER_DAY=50

# Testing (optional)
TEST_PHONE_NUMBER=+639123456789
```

### Alternative SMS Providers

If you prefer a different provider, you can configure:

#### Semaphore (Philippines)
```bash
SMS_GATEWAY=semaphore
SEMAPHORE_API_KEY=your_semaphore_api_key
SEMAPHORE_SENDER_NAME=Immunicare
```

#### Twilio (International)
```bash
SMS_GATEWAY=twilio
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_PHONE_NUMBER=+1234567890
```

#### AWS SNS
```bash
SMS_GATEWAY=aws-sns
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
AWS_REGION=ap-southeast-1
AWS_SNS_SENDER_ID=Immunicare
```

---

## Email Configuration (SMTP)

### Using Gmail (Recommended for Development/Small Scale)

1. Enable 2-Factor Authentication on your Google account
2. Go to Google Account > Security > App passwords
3. Generate an app password for "Mail"
4. Use that password as SMTP_PASSWORD

### Environment Variables

```bash
# SMTP Configuration
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your_email@gmail.com
SMTP_PASSWORD=your_app_password

# Email From Address
EMAIL_FROM=Immunicare <notifications@immunicare.com>

# Frontend URL (for email links)
FRONTEND_URL=https://your-domain.com

# Alternative SMTP Providers

# Outlook
SMTP_HOST=smtp-mail.outlook.com
SMTP_PORT=587
SMTP_SECURE=false

# Office 365
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_SECURE=false

# Amazon SES (Production Scale)
SMTP_HOST=email-smtp.us-east-1.amazonaws.com
SMTP_PORT=587
SMTP_SECURE=true
```

---

## Testing Your Configuration

### Test SMS

Run the verification script:

```bash
cd backend
node test_sms_email_config.js
```

This will:
- Test SMS gateway connectivity
- Send a test SMS (if configured)
- Test email SMTP connection
- Display configuration status

### Manual API Testing

#### Test TextBee API

```bash
curl -X POST https://api.textbee.dev/api/v1/messages/send \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "deviceId": "YOUR_DEVICE_ID",
    "recipient": "+639123456789",
    "message": "Test message from Immunicare",
    "sender": "IMMUNICARE"
  }'
```

#### Test Email

```bash
# Using telnet
telnet smtp.gmail.com 587
EHLO
AUTH LOGIN
# (enter base64 encoded username and password)
```

---

## SMS Message Templates

### OTP Verification
```
Immunicare: Your verification code is: {CODE}. Valid for 5 minutes. Do not share this code.
```

### Appointment Confirmation
```
Immunicare: {GuardianName}, appointment confirmed for {ChildName}'s {VaccineName} on {Date} at {Time}. Location: {Location}.
```

### Appointment Reminder (24h)
```
Immunicare Reminder: {GuardianName}, {ChildName}'s vaccination is tomorrow at {Time}. Location: {Location}. Please arrive 15 minutes early.
```

### Vaccination Due
```
Immunicare: {GuardianName}, {ChildName} is due for {VaccineName} vaccination. Please schedule an appointment at your nearest health center.
```

---

## Email Templates

The system includes HTML email templates with:
- Responsive design (mobile-friendly)
- Dark mode support
- Professional styling
- Call-to-action buttons

### Email Types

1. **Appointment Confirmation** - Sent when appointment is booked
2. **Appointment Reminder** - Sent 24 hours before appointment
3. **Vaccination Due** - Sent when next dose is due
4. **Password Reset** - For password recovery flow

---

## Rate Limiting & Best Practices

### SMS Rate Limits

- Default: 10 SMS/hour per phone number
- Daily limit: 50 SMS per phone number
- OTP cooldown: 60 seconds between requests

### Email Best Practices

1. **SPF/DKIM/DMARC**: Configure for email deliverability
2. **Unsubscribe**: Include unsubscribe links in promotional emails
3. **Bounce Handling**: Monitor bounce rates
4. **Spam Score**: Keep emails below spam score thresholds

---

## Troubleshooting

### SMS Issues

| Issue | Solution |
|-------|----------|
| "API key not configured" | Check TEXTBEE_API_KEY in .env |
| "Device not found" | Verify TEXTBEE_DEVICE_ID |
| "Rate limit exceeded" | Wait and try again later |
| "Invalid phone format" | Use +63 format (e.g., +639123456789) |

### Email Issues

| Issue | Solution |
|-------|----------|
| "Connection refused" | Check SMTP_HOST and port |
| "Authentication failed" | Verify SMTP_USER and SMTP_PASSWORD |
| "Email not delivered" | Check spam folder, verify SPF/DKIM |
| "Timeout" | Increase timeout in config |

---

## Production Checklist

- [ ] TextBee account created and verified
- [ ] API key configured in environment
- [ ] Device ID set up and active
- [ ] Test SMS sent successfully
- [ ] SMTP credentials configured
- [ ] Test email sent successfully
- [ ] Rate limits set appropriately
- [ ] Monitoring alerts configured
- [ ] Backup provider configured (optional)

---

## Support

For issues with:
- **TextBee**: https://textbee.dev/support
- **Email delivery**: Check SMTP provider docs
- **System issues**: Contact development team

---

*Last Updated: March 2026*
