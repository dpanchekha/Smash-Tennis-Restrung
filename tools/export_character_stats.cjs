// Read-only, lossless export. Unknown field meanings deliberately stay unnamed.
const fs = require('node:fs');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const rom = fs.readFileSync('Smash Tennis (axekin.com).sfc');
const sha = crypto.createHash('sha256').update(rom).digest('hex');
assert.equal(sha, '09fdef0c959e7275563f65d8267d95a20104f054e9438e9ac739ef7f46120a2d',
  'Refusing to describe a different or modified ROM as the original');
const names = ['Mike', 'Dan', 'John', 'Darren', 'Matt', 'Mark', 'Peter', 'Paul',
  'Ian', 'Tony', 'Brian', 'Steve', 'Helen', 'Susan', 'Julie', 'Rose', 'Carol',
  'Marina', 'Kirsty', 'Nina'];
const hex = (n, width = 2) => n.toString(16).toUpperCase().padStart(width, '0');
const header = ['record_index', 'character', 'name_status', 'rom_offset_hex',
  'snes_address_hex', 'record_length_bytes', 'record_sha256',
  ...Array.from({length: 55}, (_, i) => `raw_byte_0x${hex(i)}`)];
const rows = [header.join(',')];
for (let i = 0; i < 26; i++) {
  const offset = rom.readUInt16LE(0x8000 + i * 2);
  assert.equal(offset, 0x806b + i * 55);
  const record = rom.subarray(offset, offset + 55);
  rows.push([i, names[i] || '', names[i] ? 'normal_roster' : 'unverified_extra_record',
    `0x${hex(offset, 6)}`, `81:${hex(offset, 4)}`, 55,
    crypto.createHash('sha256').update(record).digest('hex'), ...record].join(','));
}
const csv = rows.join('\n') + '\n';
if (process.argv.includes('--check')) {
  assert.equal(fs.readFileSync('character_stats_original.csv', 'utf8'), csv);
  assert.deepEqual(fs.readFileSync('web/game.sfc'), rom, 'Deployed ROM differs');
  console.log('26 original records / 1,430 bytes verified; both ROM copies unchanged.');
} else process.stdout.write(csv);
