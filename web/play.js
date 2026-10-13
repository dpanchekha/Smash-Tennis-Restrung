'use strict';
const start = document.querySelector('#start');
const canvas = document.querySelector('#screen');
const context = canvas.getContext('2d', {alpha: false});
const frame = context.createImageData(512, 224);
const frameWords = new Uint32Array(frame.data.buffer);
const littleEndian = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
const keys = {KeyZ:1, KeyA:2, ShiftRight:4, Enter:8, ArrowUp:16, ArrowDown:32,
  ArrowLeft:64, ArrowRight:128, KeyX:256, KeyS:512, KeyQ:1024, KeyW:2048};
const fps = 21281370 / 425568;
let buttons = 0, engine, audio, nextAudio = 0, deadline = 0, running = false, sampleCarry = 0;
addEventListener('keydown', event => {
  if (keys[event.code]) {event.preventDefault(); buttons |= keys[event.code];}
});
addEventListener('keyup', event => {
  if (keys[event.code]) {event.preventDefault(); buttons &= ~keys[event.code];}
});
addEventListener('blur', () => {buttons = 0;});
function controller() {
  const pad = navigator.getGamepads?.()[0];
  if (!pad) return buttons;
  const mapping = [1,256,2,512,1024,2048,0,0,4,8,0,0,16,32,64,128];
  let result = buttons;
  pad.buttons.forEach((button, i) => {if (button.pressed) result |= mapping[i] || 0;});
  if (pad.axes[0] < -.5) result |= 64;
  if (pad.axes[0] > .5) result |= 128;
  if (pad.axes[1] < -.5) result |= 16;
  if (pad.axes[1] > .5) result |= 32;
  return result;
}
function fail(error) {
  running = false;
  document.querySelector('#error').hidden = false;
  document.querySelector('#error').textContent = String(error);
  console.error(error);
}
function tick(now) {
  if (!running) return;
  try {
    if (document.hidden) {deadline = now; nextAudio = 0; requestAnimationFrame(tick); return;}
    if (now - deadline > 100) deadline = now;
    let count = 0;
    while (now >= deadline && count++ < 5) {
      if (!engine._smash_frame(controller())) throw Error('The game stopped responding. Reload to restart.');
      sampleCarry += audio.sampleRate / fps;
      const samples = Math.floor(sampleCarry); sampleCarry -= samples;
      engine._smash_audio(samples);
      const pcm = engine.HEAP16.subarray(engine._smash_audio_buffer() / 2,
        engine._smash_audio_buffer() / 2 + samples * 2);
      const buffer = audio.createBuffer(2, samples, audio.sampleRate);
      for (let channel = 0; channel < 2; channel++) {
        const output = buffer.getChannelData(channel);
        for (let i = 0; i < samples; i++) output[i] = pcm[i * 2 + channel] / 32768;
      }
      const source = audio.createBufferSource(); source.buffer = buffer; source.connect(audio.destination);
      nextAudio = Math.max(nextAudio, audio.currentTime + .025);
      source.start(nextAudio); nextAudio += buffer.duration;
      deadline += 1000 / fps;
    }
    if (count) {
      const pixels = engine.HEAPU32.subarray(engine._smash_pixels() / 4, engine._smash_pixels() / 4 + 512 * 224);
      for (let i = 0; i < pixels.length; i++) {
        // Runtime words are 0x00RRGGBB; ImageData requires RGBA bytes.
        // A packed store avoids four clamped-array writes per pixel (and the
        // old unmasked green/blue values saturating to 255).
        const p = pixels[i];
        frameWords[i] = littleEndian
          ? 0xff000000 | ((p & 255) << 16) | (p & 0xff00) | ((p >>> 16) & 255)
          : (p << 8) | 255;
      }
      context.putImageData(frame, 0, 0);
    }
    requestAnimationFrame(tick);
  } catch (error) {fail(error);}
}
start.addEventListener('click', async () => {
  start.disabled = true; start.textContent = 'Loading…';
  try {
    audio = new AudioContext(); await audio.resume();
    engine = await createSmash({print: console.log, printErr: console.warn});
    const response = await fetch('game.sfc');
    if (!response.ok) throw Error('Could not load the game ROM.');
    const rom = new Uint8Array(await response.arrayBuffer());
    const ptr = engine._malloc(rom.length); engine.HEAPU8.set(rom, ptr);
    const loaded = engine._smash_init(ptr, rom.length, audio.sampleRate); engine._free(ptr);
    if (!loaded) throw Error('Could not initialize Smash Tennis.');
    start.remove(); canvas.style.display = 'block'; canvas.focus();
    running = true; deadline = performance.now(); requestAnimationFrame(tick);
  } catch (error) {fail(error);}
});
