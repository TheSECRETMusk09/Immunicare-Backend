const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

console.log('Environment loaded:');
console.log('DB_HOST:', process.env.DB_HOST);
console.log('DB_PORT:', process.env.DB_PORT);
console.log('DB_NAME:', process.env.DB_NAME);
console.log('PORT:', process.env.PORT);
console.log('NODE_ENV:', process.env.NODE_ENV);

try {
  console.log('\nAttempting to load server.js...');
  const server = require('./server');
  console.log('Server module loaded successfully');
} catch (error) {
  console.error('Error loading server:', error.message);
  console.error('Stack:', error.stack);
  process.exit(1);
}
