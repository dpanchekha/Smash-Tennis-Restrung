// Runs the actual browser WebAssembly binary, without requiring browser sockets.
const fs = require('node:fs');
const crypto = require('node:crypto');
const createSmash = require('../web/smash.js');
(async () => {
  const started = performance.now();
  const game = await createSmash({preRun: [module => {
    for (const [key, value] of Object.entries(process.env))
      if (key.startsWith('SNESRECOMP_')) module.ENV[key] = value;
  }]});
  const rom = fs.readFileSync('Smash Tennis (axekin.com).sfc');
  const ptr = game._malloc(rom.length); game.HEAPU8.set(rom, ptr);
  if (!game._smash_init(ptr, rom.length, 32040)) throw Error('ROM initialization failed');
  game._free(ptr);
  if (process.env.SMASH_TEST_INTERPRETER) game._smash_test_interpreter(1);
  let frames = 0, peak = 0;
  function step(count, buttons = 0) {
    for (let i = 0; i < count; i++) {
      if (!game._smash_frame(buttons)) throw Error(`Watchdog at frame ${frames}`);
      game._smash_audio(640);
      const audio = game.HEAP16.subarray(game._smash_audio_buffer() / 2, game._smash_audio_buffer() / 2 + 1280);
      for (const sample of audio) peak = Math.max(peak, Math.abs(sample));
      frames++;
    }
  }
  function capture(name) {
    game._smash_diagnostics();
    if (process.env.SMASH_ASSERT_STACK && game._smash_stack() !== 0x1ffb)
      throw Error(`Stack drift at ${name}: ${game._smash_stack().toString(16)}`);
    const pixels = game.HEAPU32.subarray(game._smash_pixels() / 4, game._smash_pixels() / 4 + 512 * 224);
    const rgb = Buffer.alloc(pixels.length * 3);
    pixels.forEach((p, i) => {rgb[i*3] = p >>> 16; rgb[i*3+1] = p >>> 8; rgb[i*3+2] = p;});
    fs.writeFileSync(`build/${name}.ppm`, Buffer.concat([Buffer.from('P6\n512 224\n255\n'), rgb]));
    console.log(name, frames, crypto.createHash('sha256').update(rgb).digest('hex'), 'audio peak', peak);
  }
  step(600); capture('wasm-title');
  step(2, 8); step(60); capture('wasm-menu');
  const actions = process.argv.slice(2).filter(arg => arg !== '--interactive');
  for (let i = 0; i < actions.length; i++) {
    const [button, duration = '60', held = '2'] = actions[i].split(':');
    step(Number(held), Number(button)); step(Number(duration)); capture(`wasm-step${i}`);
  }
  if (!peak) throw Error('No audio samples were produced');
  console.log(`${frames} frames in ${((performance.now() - started) / 1000).toFixed(2)}s; audio peak ${peak}`);
  if (process.argv.includes('--interactive')) {
    console.log('Ready: button:idleFrames, or quit');
    const input = require('node:readline').createInterface({input: process.stdin});
    let index = 0;
    for await (const line of input) {
      if (line === 'quit') break;
      const [button, duration = '120'] = line.split(':');
      step(2, Number(button)); step(Number(duration)); capture(`interactive${index++}`);
    }
    input.close();
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
