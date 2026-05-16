const fs = require('fs');
let lines = fs.readFileSync('src/App.tsx', 'utf8').split('\n');

const startTarget = '{/* Hook Selection Section */}';
const startIdx = lines.findIndex(l => l.includes(startTarget));

if (startIdx === -1) {
  console.log("Start not found");
  process.exit(1);
}

// find the next {config.copy.finalScript && (
const endTarget = '{config.copy.finalScript && (';
const afterEndIdx = lines.findIndex((l, i) => i > startIdx && l.includes(endTarget));

if (afterEndIdx === -1) {
  console.log("End not found");
  process.exit(1);
}

// we want to delete from startIdx up to the line before afterEndIdx, where it is `)}`
// let's look backwards from afterEndIdx to find the first `)}`
let endIdx = -1;
for (let i = afterEndIdx - 1; i >= startIdx; i--) {
  if (lines[i].trim() === ')}' || lines[i].includes(')}')) {
    endIdx = i;
    break;
  }
}

if (endIdx === -1) {
  console.log("closing bracket not found");
  process.exit(1);
}

console.log(`Deleting lines ${startIdx + 1} to ${endIdx + 1}`);
lines.splice(startIdx, endIdx - startIdx + 1);

fs.writeFileSync('src/App.tsx', lines.join('\n'));
console.log("Done");
