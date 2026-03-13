const fs = require('fs');

const filePath = 'routes/vaccination-management.js';
let content = fs.readFileSync(filePath, 'utf8');

console.log('Original content around line 467:');
console.log(content.split('\n')[466]);

// Replace specific lines
const lines = content.split('\n');
for (let i = 0; i < lines.length; i++) {
  const lineNum = i + 1;
  // Fix lines 122, 467, 473, 479 - change ${paramIndex} to $${paramIndex}
  if ([122, 467, 473, 479].includes(lineNum)) {
    if (lines[i].includes('${paramIndex}')) {
      lines[i] = lines[i].replace(/\$\{paramIndex\}/g, '$${paramIndex}');
      console.log(`Fixed line ${lineNum}: ${lines[i]}`);
    }
  }
}

content = lines.join('\n');
fs.writeFileSync(filePath, content);
console.log('File updated successfully');
