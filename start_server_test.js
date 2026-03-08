const { spawn } = require('child_process');
const path = require('path');

const serverProcess = spawn('node', ['server.js'], {
  cwd: path.join(__dirname, 'backend'),
  stdio: ['pipe', 'pipe', 'pipe']
});

serverProcess.stdout.on('data', (data) => {
  console.log(`[stdout] ${data}`);
});

serverProcess.stderr.on('data', (data) => {
  console.error(`[stderr] ${data}`);
});

serverProcess.on('error', (error) => {
  console.error(`[error] Failed to start server: ${error.message}`);
});

serverProcess.on('close', (code) => {
  console.log(`[exit] Server process exited with code ${code}`);
});

// Keep the script running for 10 seconds to let the server start
setTimeout(() => {
  console.log('Server startup check complete');
}, 10000);
