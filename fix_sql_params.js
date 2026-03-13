const fs = require('fs');

const filePath = 'routes/vaccination-management.js';
let content = fs.readFileSync(filePath, 'utf8');

// Fix line 122 - patients search
// Find the specific line and replace
const lines = content.split('\n');
const newLines = lines.map((line, idx) => {
  const lineNum = idx + 1;
  if (lineNum === 122 && line.includes('${paramIndex}')) {
    // Replace ${paramIndex} with $${paramIndex}
    return line.split('${paramIndex}').join('$${paramIndex}');
  }
  return line;
});

content = newLines.join('\n');
fs.writeFileSync(filePath, content);
console.log('Fixed line 122');
