// Analysis-only: requires build/stats-probe.js linked with an exported g_ram.
// Never writes to the ROM or deployed game. Captures WRAM for record mapping.
const fs = require('node:fs');
(async () => {
  const g = await require('../build/stats-probe.js')();
  const rom = fs.readFileSync('Smash Tennis (axekin.com).sfc');
  const p = g._malloc(rom.length); g.HEAPU8.set(rom, p);
  if (!g._smash_init(p, rom.length, 32040)) throw Error('Init failed');
  g._free(p);
  function step(n, buttons = 0) {
    for (let i = 0; i < n; i++) {g._smash_frame(buttons); g._smash_audio(640);}
  }
  step(600); step(2, 8); step(60);
  for (const wait of [60, 60, 300, 180]) {step(2, 8); step(wait);}
  const ram = () => Buffer.from(g.HEAPU8.subarray(g._g_ram, g._g_ram + 0x20000));
  let previous = ram();
  fs.writeFileSync('build/character-select-0.ram', previous);
  for (let i = 1; i <= 3; i++) {
    step(2, i === 3 ? 128 : 32); step(30);
    const next = ram(), changes = [];
    for (let j = 0; j < 0x2000; j++) if (previous[j] !== next[j])
      changes.push(`${j.toString(16)}:${previous[j].toString(16)}>${next[j].toString(16)}`);
    console.log('selection', i, changes.join(' '));
    fs.writeFileSync(`build/character-select-${i}.ram`, next);
    previous = next;
  }
  step(2, 8); step(180);
  const confirmed = ram();
  console.log('confirmed Mark selection', confirmed.readUInt16LE(0x110));
  fs.writeFileSync('build/character-confirmed.ram', confirmed);
})().catch(e => {console.error(e); process.exitCode = 1;});
