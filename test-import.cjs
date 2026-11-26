const fs = require('fs');
const assert = require('assert');
const {parsePromptImport} = require('./import.js');
const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8').replace(/^\uFEFF/, ''));
let n = 0;
const first = parsePromptImport(data, [], () => `test-${++n}`);
assert.strictEqual(first.added.length, Object.keys(data.userData.customPrompts).length);
assert.strictEqual(first.added.length, 6);
assert(first.added.every(p => p.title && p.content && p.tags.length));
const second = parsePromptImport(data, first.added, () => `test-${++n}`);
assert.strictEqual(second.added.length, 0);
assert.strictEqual(second.skipped, 6);
console.log('Actual backup: 6 prompts imported, 6 duplicates skipped on second import.');

