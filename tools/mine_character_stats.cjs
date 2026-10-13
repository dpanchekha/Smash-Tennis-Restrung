// Reproducible read-only ROM extraction. No image/chart ratings are inputs.
// Default: emit JSON filename->CSV content for artifact creation. --check verifies.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const rom = fs.readFileSync('Smash Tennis (axekin.com).sfc');
const sha = crypto.createHash('sha256').update(rom).digest('hex');
assert.equal(sha, '09fdef0c959e7275563f65d8267d95a20104f054e9438e9ac739ef7f46120a2d');
const names = ['Mike','Dan','John','Darren','Matt','Mark','Peter','Paul','Ian','Tony',
  'Brian','Steve','Helen','Susan','Julie','Rose','Carol','Marina','Kirsty','Nina'];
const hex = n => `0x${n.toString(16).toUpperCase().padStart(6, '0')}`;
const csv = rows => rows.map(row => row.map(v => {
  const s = String(v); return /[",\n]/.test(s) ? `"${s.replaceAll('"','""')}"` : s;
}).join(',')).join('\n') + '\n';
function bytes(offset, expected) {
  assert.equal(rom.subarray(offset, offset + expected.length / 2).toString('hex'), expected);
}
// Guard the instructions underlying key semantic mappings, not just table shape.
bytes(0x8d4e, 'b9b810c93c009003e91400aabd858d');
bytes(0xb0ed, 'b974101869170060b9741018691b0060b9741018691f0060b974101869230060');
bytes(0xb189, '64d0b9741018690f006064d0b974101869130060');
bytes(0x0b49, '08e220a5308f024200a5328f034200');
bytes(0xa0e9, 'bd0d0029ff0085500a0a0a0a991e10');
bytes(0xa0f8, 'bd0e0029ff0085520a0a0a0a992210');
bytes(0xa154, 'bd3000998210bd3100998410');
for (const [id, routine, label] of [
  [0x00,0xb0ed,'FORE-A'],[0x02,0xb0f5,'FORE-B'],
  [0x04,0xb0fd,'BACK-A'],[0x06,0xb105,'BACK-B'],
  [0x3c,0xb15e,'SMASH'],[0x3e,0xb172,'SMASH'],
  [0x40,0xb189,'SERVICE'],[0x42,0xb193,'SERVICE'],
]) {
  assert.equal(rom.readUInt16LE(0xb061 + id), routine);
  const textAddress = rom.readUInt16LE(0x8d85 + (id >= 0x3c ? id - 0x14 : id));
  const text = rom.subarray(textAddress,textAddress+32).toString('ascii').replaceAll(' ','').replaceAll('@','');
  assert.ok(text.includes(label), `ROM debug label mismatch for shot ${id}`);
}
const definitions = [
  ['serve_A', 0x0f, null, 'character record'],
  ['serve_B', 0x13, null, 'character record'],
  ['forehand_A', 0x17, null, 'character record; shared profiles also exist'],
  ['forehand_B', 0x1b, null, 'character record; shared profiles also exist'],
  ['backhand_A', 0x1f, null, 'character record; shared profiles also exist'],
  ['backhand_B', 0x23, null, 'character record; shared profiles also exist'],
  ['volley_A', 0x8631, 0x2c, 'both forehand and backhand'],
  ['volley_B', 0x8645, 0x2c, 'ball height >= 14'],
  ['volley_low_B_forehand', 0x8611, 0x2b, 'ball height < 14'],
  ['volley_low_B_backhand', 0x8621, 0x2b, 'ball height < 14'],
  ['lob_forehand', 0x8661, 0x2d, 'shot ID 0x38; lob semantic inferred from input and arc'],
  ['lob_backhand', 0x8671, 0x2d, 'shot ID 0x3A; lob semantic inferred from input and arc'],
  ['smash_A', 0x8681, 0x2e, 'outside alternate timing window'],
  ['smash_B', 0x8691, 0x2e, 'normal B profile'],
  ['smash_timed_A', 0x86a1, 0x2f, 'unsigned(player[0x1088]-8) < 4'],
  ['shared_forehand_A', 0x8601, -1, 'shared shot ID 0x08'],
  ['shared_forehand_B', 0x8605, -1, 'shared shot ID 0x0A'],
  ['shared_backhand_A', 0x8609, -1, 'shared shot ID 0x0C'],
  ['shared_backhand_B', 0x860d, -1, 'shared shot ID 0x0E'],
];
const detailed = [['character','record_index','profile','power_coefficient_u8',
  'initial_vertical_coefficient_s8','initial_vertical_velocity_raw',
  'initial_vertical_deceleration_u8','falling_vertical_deceleration_u8',
  'profile_rom_offset','selector_record_offset','selector_value','raw_profile_hex','condition']];
const characters = names.map((name, index) => {
  const ptr = rom.readUInt16LE(0x8000 + index * 2);
  assert.equal(ptr, 0x806b + index * 55);
  const r = rom.subarray(ptr, ptr + 55), profiles = {};
  for (const [label, base, selector, condition] of definitions) {
    if (selector !== null && selector >= 0)
      assert.ok(r[selector] < (selector === 0x2c ? 5 : 4));
    const address = selector === null ? ptr + base : base + (selector < 0 ? 0 : 4 * r[selector]);
    const data = rom.subarray(address, address + 4);
    const vertical = data.readInt8(1);
    profiles[label] = Array.from(data);
    detailed.push([name,index,label,data[0],vertical,vertical*16,data[2],data[3],
      hex(address),selector === null || selector < 0 ? '' : hex(selector),
      selector === null || selector < 0 ? '' : r[selector],data.toString('hex'),condition]);
  }
  assert.ok(r[0x0a] <= 1 && r[0x30] <= 1 && r[0x31] <= 1);
  const spans = [0,8].map(sideOffset => {
    const start = 0xb207 + (r[0x31] ? 32 : 0) + sideOffset;
    const targets = Array.from({length:4}, (_,i) => rom.readUInt16LE(start+i*2));
    return Math.max(...targets)-Math.min(...targets);
  });
  return {name,r,profiles,spans};
});
const matrix = [['Stat','Meaning / units',...names]];
const add = (label, units, fn) => matrix.push([label,units,...characters.map(fn)]);
const pair = (a,b) => c => `${c.profiles[a][0]} / ${c.profiles[b][0]}`;
add('Speed','horizontal / vertical movement coefficients; not a 1-10 rating',c=>`${c.r[13]} / ${c.r[14]}`);
add('Serve','A / B raw power coefficients',pair('serve_A','serve_B'));
add('Volley','A / B raw power; B for height >= 14',pair('volley_A','volley_B'));
add('Forehand','character A / B raw power coefficients',pair('forehand_A','forehand_B'));
add('Backhand','character A / B raw power coefficients',pair('backhand_A','backhand_B'));
add('Smash','normal A / B raw power coefficients',pair('smash_A','smash_B'));
add('Lob','forehand / backhand raw power; semantic inference',pair('lob_forehand','lob_backhand'));
add('Diving','enable flag; 0=no / 1=yes',c=>c.r[0x30] ? 'Yes (1)' : 'No (0)');
add('Amplitude','base aim-table span: singles side 0 / side 1; not final landing spread',c=>c.spans.join(' / '));
add('Handedness','record flag; 0=right / 1=left',c=>c.r[0x0a] ? 'Left (1)' : 'Right (0)');
add('Volley low B','height < 14: forehand / backhand raw power',pair('volley_low_B_forehand','volley_low_B_backhand'));
add('Smash timed A','alternate timing profile raw power',c=>c.profiles.smash_timed_A[0]);
add('Shared forehand','shared A / B raw power; see profile conditions',pair('shared_forehand_A','shared_forehand_B'));
add('Shared backhand','shared A / B raw power; see profile conditions',pair('shared_backhand_A','shared_backhand_B'));
add('Speed X side 0','base internal horizontal coordinate units per movement update',c=>c.r[13]/16);
add('Speed Y side 0','base internal vertical coordinate units per movement update',c=>c.r[14]/16);
add('Speed X side 1','base internal horizontal coordinate units per movement update',c=>c.r[13]*15/256);
add('Speed Y side 1','base internal vertical coordinate units per movement update',c=>c.r[14]*15/256);
add('Aim-width selector','record byte 0x31',c=>c.r[0x31]);
add('Unique moves','not established as a separate universal ROM stat',()=> 'Unresolved');
const files = {
  'character_stats_mined.csv': csv(matrix),
  'character_shot_profiles_mined.csv': csv(detailed),
};
// Spot checks independently inspected in the original Mike record.
assert.deepEqual(characters[0].profiles.serve_A,[95,252,41,41]);
assert.deepEqual(characters[0].profiles.forehand_A,[73,33,33,50]);
if (process.argv.includes('--check')) {
  for (const [file,contents] of Object.entries(files)) assert.equal(fs.readFileSync(file,'utf8'),contents);
  assert.deepEqual(fs.readFileSync('web/game.sfc'),rom);
  console.log(`Verified 20 characters, ${detailed.length-1} profile rows, opcode guards and unchanged ROM copies.`);
} else process.stdout.write(JSON.stringify(files));
