/**
 * Pre-start port availability check
 * Run this before starting the server to ensure port is available
 *
 * Usage:
 *   node check-port.js
 *   npm run prestart
 *   npm run start:safe
 */
const net = require('net');

const PORT = parseInt(process.env.PORT, 10) || 5000;
const HOST = '0.0.0.0';

/**
 * Check if a specific port is available
 * @param {number} port - Port number to check
 * @returns {Promise<boolean>} - True if port is available
 */
function checkPort(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve(false);
      } else {
        reject(err);
      }
    });

    server.once('listening', () => {
      server.close(() => {
        console.log(`Port ${port} is available`);
        resolve(true);
      });
    });

    server.listen(port, HOST);
  });
}

/**
 * Find an available port starting from basePort
 * @param {number} basePort - Starting port number
 * @param {number} maxAttempts - Maximum number of ports to try
 * @returns {Promise<number|null>} - Available port or null
 */
async function findAvailablePort(basePort, maxAttempts = 10) {
  for (let i = 0; i < maxAttempts; i++) {
    const port = basePort + i;
    const available = await checkPort(port).catch(() => false);
    if (available) {
      return port;
    }
    console.log(`Port ${port} is in use, trying next port...`);
  }
  return null;
}

async function main() {
  try {
    console.log('========================================');
    console.log('Checking port availability...');
    console.log(`Target port: ${PORT}`);
    console.log('========================================');

    const isAvailable = await checkPort(PORT);

    if (isAvailable) {
      console.log(`\n✅ Port ${PORT} is available!\n`);
      process.exit(0);
    } else {
      console.log(`\n⚠️  Port ${PORT} is already in use`);

      // Try to find an alternative port
      console.log('\nSearching for an available port...');
      const availablePort = await findAvailablePort(PORT + 1, 10);

      if (availablePort) {
        console.log(`\n✅ Found available port: ${availablePort}`);
        console.log(`   Set PORT=${availablePort} in backend/.env to use this port\n`);
        process.exit(0);
      } else {
        console.error('\n❌ ERROR: Could not find an available port');
        console.error(`   Ports ${PORT} to ${PORT + 10} are all in use`);
        console.error('\nTo resolve:');
        console.error('   Windows CMD: netstat -ano | findstr :5000');
        console.error('   Then: taskkill /PID <PID> /F');
        console.error('   Or: taskkill /IM node.exe /F\n');
        process.exit(1);
      }
    }
  } catch (err) {
    console.error(`Error checking port: ${err.message}`);
    process.exit(1);
  }
}

main();
