// Analysis-only runtime corroboration; the production build is untouched.
const fs = require('node:fs');
const assert = require('node:assert/strict');
(async () => {
  const game = await require('../build/stats-probe.js')();
  const rom = fs.readFileSync('Smash Tennis (axekin.com).sfc');
  const ptr = game._malloc(rom.length); game.HEAPU8.set(rom, ptr);
  assert.ok(game._smash_init(ptr, rom.length, 32040)); game._free(ptr);
  function step(n, buttons = 0) {
    for (let i = 0; i < n; i++) {assert.ok(game._smash_frame(buttons)); game._smash_audio(640);}
  }
  step(600); step(2, 8); step(60);
  for (const idle of [60, 60, 300, 180, 180, 180, 500, 500]) {
    step(2, 8); step(idle);
  }
  const ram = () => Buffer.from(game.HEAPU8.subarray(game._g_ram, game._g_ram + 0x20000));
  let r = ram();
  const players = [];
  for (let base = 0x1000; base < 0x1400; base += 0x100) {
    const record = r.readUInt16LE(base + 0x74);
    if (record < 0x806b || record > 0x85ca || (record - 0x806b) % 55) continue;
    const side = r.readUInt16LE(base + 0x6e) & 1;
    assert.equal(r.readUInt16LE(base + 0x1e), rom[record + 0x0d] * (side ? 15 : 16));
    assert.equal(r.readUInt16LE(base + 0x22), rom[record + 0x0e] * (side ? 15 : 16));
    assert.equal(r[base + 0x0c], rom[record + 0x0a]);
    assert.equal(r[base + 0x82], rom[record + 0x30]);
    assert.equal(r[base + 0x84], rom[record + 0x31]);
    players.push({base: base.toString(16), record: record.toString(16), side,
      xStep: r.readUInt16LE(base + 0x1e), yStep: r.readUInt16LE(base + 0x22)});
  }
  assert.ok(players.length >= 2);
  console.log(JSON.stringify({players, status: 'ROM-to-live movement and trait loads verified'}, null, 2));
})().catch(e => {console.error(e); process.exitCode = 1;});
