# TLS/SSL Configuration Guide

This guide provides comprehensive instructions for configuring TLS/SSL for the Immunicare backend server.

## Table of Contents

1. [Overview](#overview)
2. [Development Setup](#development-setup)
3. [Production Setup](#production-setup)
4. [Environment Variables](#environment-variables)
5. [Security Best Practices](#security-best-practices)
6. [Troubleshooting](#troubleshooting)

## Overview

The Immunicare backend supports both HTTP and HTTPS protocols. HTTPS is recommended for production environments to ensure secure communication between clients and the server.

### Key Features

- **Dual Protocol Support**: Run both HTTP and HTTPS servers simultaneously
- **TLS 1.2+**: Enforces modern TLS versions for enhanced security
- **Strong Cipher Suites**: Uses only secure cipher suites
- **Flexible Configuration**: Enable/disable HTTPS via environment variables
- **Self-Signed Certificates**: Support for development with self-signed certificates

## Development Setup

### Step 1: Generate Self-Signed Certificates

For development, you can generate self-signed SSL certificates using the provided script:

```bash
cd backend
node generate_ssl_certificates.js
```

This will create:

- `ssl/server.key` - Private key
- `ssl/server.crt` - SSL certificate
- `ssl/server.csr` - Certificate signing request

### Step 2: Configure Environment Variables

Add the following to your `.env` file:

```env
# Enable HTTPS
ENABLE_HTTPS=true

# SSL Certificate Paths
SSL_KEY_PATH=./ssl/server.key
SSL_CERT_PATH=./ssl/server.crt

# Ports
PORT=5000
HTTPS_PORT=5443
```

### Step 3: Start the Server

```bash
npm start
```

The server will now run on:

- HTTP: `http://localhost:5000`
- HTTPS: `https://localhost:5443`

### Step 4: Trust the Self-Signed Certificate (Optional)

For development, you may need to trust the self-signed certificate to avoid browser warnings:

**macOS:**

```bash
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ssl/server.crt
```

**Windows:**

1. Double-click `ssl/server.crt`
2. Click "Install Certificate"
3. Select "Local Machine" → "Place all certificates in the following store"
4. Browse to "Trusted Root Certification Authorities"
5. Complete the wizard

**Linux (Ubuntu/Debian):**

```bash
sudo cp ssl/server.crt /usr/local/share/ca-certificates/
sudo update-ca-certificates
```

## Production Setup

### Option 1: Let's Encrypt (Free SSL Certificates)

Let's Encrypt provides free, automated SSL certificates.

#### Prerequisites

- A domain name (e.g., `api.immunicare.com`)
- Server accessible from the internet
- Port 80 and 443 open

#### Installation

1. **Install Certbot:**

**Ubuntu/Debian:**

```bash
sudo apt-get update
sudo apt-get install certbot
```

**CentOS/RHEL:**

```bash
sudo yum install certbot
```

2. **Obtain Certificate:**

```bash
sudo certbot certonly --standalone -d api.immunicare.com
```

3. **Configure Environment Variables:**

```env
ENABLE_HTTPS=true
SSL_KEY_PATH=/etc/letsencrypt/live/api.immunicare.com/privkey.pem
SSL_CERT_PATH=/etc/letsencrypt/live/api.immunicare.com/fullchain.pem
HTTPS_PORT=443
```

4. **Set Up Auto-Renewal:**

```bash
sudo certbot renew --dry-run
```

Certbot automatically sets up a cron job for renewal.

### Option 2: Commercial SSL Certificates

For commercial SSL certificates (e.g., from DigiCert, Comodo, GoDaddy):

1. **Generate CSR:**

```bash
openssl req -new -newkey rsa:2048 -nodes -keyout server.key -out server.csr
```

2. **Submit CSR to Certificate Authority:**
   - Copy the contents of `server.csr`
   - Submit to your CA
   - Complete domain verification

3. **Download and Install Certificate:**
   - Download the certificate files from your CA
   - Place them in a secure directory (e.g., `/etc/ssl/immunicare/`)
   - Update environment variables:

```env
ENABLE_HTTPS=true
SSL_KEY_PATH=/etc/ssl/immunicare/server.key
SSL_CERT_PATH=/etc/ssl/immunicare/server.crt
HTTPS_PORT=443
```

### Option 3: Cloudflare SSL (Recommended for SaaS)

If using Cloudflare as a reverse proxy:

1. **Enable SSL/TLS in Cloudflare Dashboard:**
   - Go to SSL/TLS → Overview
   - Select "Full" or "Full (strict)" mode

2. **Configure Origin Certificate:**
   - Generate an Origin Certificate in Cloudflare
   - Download the certificate and private key
   - Install on your server

3. **Update Environment Variables:**

```env
ENABLE_HTTPS=true
SSL_KEY_PATH=/etc/ssl/immunicare/cloudflare.key
SSL_CERT_PATH=/etc/ssl/immunicare/cloudflare.crt
HTTPS_PORT=443
```

## Environment Variables

| Variable        | Description             | Default            | Required               |
| --------------- | ----------------------- | ------------------ | ---------------------- |
| `ENABLE_HTTPS`  | Enable HTTPS server     | `false`            | No                     |
| `SSL_KEY_PATH`  | Path to SSL private key | `./ssl/server.key` | Yes (if HTTPS enabled) |
| `SSL_CERT_PATH` | Path to SSL certificate | `./ssl/server.crt` | Yes (if HTTPS enabled) |
| `PORT`          | HTTP server port        | `5000`             | No                     |
| `HTTPS_PORT`    | HTTPS server port       | `5443`             | No                     |

## Security Best Practices

### 1. Use Strong Cipher Suites

The server is configured with strong cipher suites by default:

```javascript
ciphers: [
  'ECDHE-ECDSA-AES128-GCM-SHA256',
  'ECDHE-RSA-AES128-GCM-SHA256',
  'ECDHE-ECDSA-AES256-GCM-SHA384',
  'ECDHE-RSA-AES256-GCM-SHA384',
  'ECDHE-ECDSA-CHACHA20-POLY1305',
  'ECDHE-RSA-CHACHA20-POLY1305',
];
```

### 2. Enforce TLS 1.2+

The server enforces TLS 1.2 or higher:

```javascript
minVersion: 'TLSv1.2';
```

### 3. Secure Certificate Storage

- Store private keys with restrictive permissions (600 or 400)
- Never commit certificates to version control
- Use environment variables or secure vaults for certificate paths
- Rotate certificates regularly (Let's Encrypt auto-renews every 90 days)

### 4. HTTP to HTTPS Redirect

For production, configure your reverse proxy (nginx, Apache, Cloudflare) to redirect HTTP to HTTPS.

**Nginx Example:**

```nginx
server {
    listen 80;
    server_name api.immunicare.com;
    return 301 https://$server_name$request_uri;
}
```

### 5. HSTS (HTTP Strict Transport Security)

Enable HSTS to force browsers to use HTTPS:

```javascript
app.use((req, res, next) => {
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});
```

### 6. Certificate Monitoring

- Set up alerts for certificate expiration
- Monitor SSL/TLS configuration with tools like SSL Labs
- Regularly test your SSL configuration

## Troubleshooting

### Issue: "ENOENT: no such file or directory"

**Problem:** SSL certificate files not found.

**Solution:**

1. Check file paths in environment variables
2. Ensure certificates exist in the specified location
3. Run `node generate_ssl_certificates.js` for development

### Issue: "EACCES: permission denied"

**Problem:** Insufficient permissions to read certificate files.

**Solution:**

```bash
# Set appropriate permissions
chmod 600 ssl/server.key
chmod 644 ssl/server.crt
```

### Issue: Browser shows "Not Secure" warning

**Problem:** Self-signed certificate not trusted.

**Solution:**

1. For development: Accept the warning or trust the certificate (see Development Setup)
2. For production: Use a certificate from a trusted CA

### Issue: "ERR_SSL_PROTOCOL_ERROR"

**Problem:** TLS version mismatch or cipher suite issue.

**Solution:**

1. Ensure client supports TLS 1.2+
2. Check cipher suite compatibility
3. Verify certificate is valid

### Issue: Port already in use

**Problem:** Port 443 or 5443 is already in use.

**Solution:**

```bash
# Find process using the port
netstat -ano | findstr :5443  # Windows
lsof -i :5443                 # macOS/Linux

# Kill the process or use a different port
```

### Issue: Certificate expired

**Problem:** SSL certificate has expired.

**Solution:**

1. For Let's Encrypt: Run `sudo certbot renew`
2. For commercial certificates: Renew with your CA
3. For self-signed: Regenerate with `node generate_ssl_certificates.js`

## Testing SSL Configuration

### Using OpenSSL

```bash
# Test SSL connection
openssl s_client -connect localhost:5443 -showcerts

# Check certificate details
openssl x509 -in ssl/server.crt -text -noout

# Verify certificate chain
openssl s_client -connect localhost:5443 -verify_return_error
```

### Using SSL Labs

Visit [SSL Labs Server Test](https://www.ssllabs.com/ssltest/) and enter your domain to get a comprehensive SSL/TLS analysis.

### Using curl

```bash
# Test HTTPS endpoint
curl -k https://localhost:5443/api/health

# Test with certificate verification
curl https://api.immunicare.com/api/health
```

## Additional Resources

- [Let's Encrypt Documentation](https://letsencrypt.org/docs/)
- [Mozilla SSL Configuration Generator](https://ssl-config.mozilla.org/)
- [OWASP TLS Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Transport_Layer_Protection_Cheat_Sheet.html)
- [SSL Labs Server Test](https://www.ssllabs.com/ssltest/)

## Support

For issues or questions:

1. Check the troubleshooting section above
2. Review server logs for detailed error messages
3. Consult the main Immunicare documentation
4. Open an issue on the project repository
