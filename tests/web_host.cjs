// Browser-host contract test with small DOM/audio mocks and the real WASM.
// Does not claim to exercise Chromium, speakers, or browser permission policy.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const createSmash = require('../web/smash.js');
(async () => {
  const events = {}, masks = [], audioBuffers = [];
  let click, scheduled, painted = 0, removed = false, focused = false;
  const colors = [0, 0xff0000, 0x00ff00, 0x0000ff, 0x123456, 0xffffff, 0x876543];
  const start = {addEventListener: (name, fn) => {click = fn;}, remove: () => {removed = true;}};
  const canvas = {style: {}, focus: () => {focused = true;}, getContext: () => ({
    createImageData: (w, h) => ({data: new Uint8ClampedArray(w * h * 4)}),
    putImageData: image => {
      assert.equal(image.data.length, 512 * 224 * 4);
      colors.forEach((color, i) => assert.deepEqual(Array.from(image.data.slice(i * 4, i * 4 + 4)),
        [(color >>> 16) & 255, (color >>> 8) & 255, color & 255, 255]));
      painted++;
    }
  })};
  const error = {hidden: true};
  class AudioContext {
    sampleRate = 48000; currentTime = 0;
    async resume() {}
    createBuffer(channels, samples, rate) {
      assert.equal(channels, 2); assert.equal(rate, 32040);
      const data = [new Float32Array(samples), new Float32Array(samples)];
      audioBuffers.push(data);
      return {duration: samples / rate, getChannelData: channel => data[channel]};
    }
    createBufferSource() {return {connect() {}, start(time) {assert.ok(time >= 0);}};}
  }
  const rom = fs.readFileSync('web/game.sfc');
  let pads=[];
  const scope = {console, performance, AudioContext, Uint8Array, Uint32Array,
    document: {hidden: false, querySelector: selector => ({'#start': start, '#screen': canvas, '#error': error})[selector]},
    navigator: {getGamepads: () => pads},
    addEventListener: (name, fn) => {events[name] = fn;},
    requestAnimationFrame: callback => {scheduled = callback;},
    fetch: async url => {
      if (url === 'build-id') return {ok: true, text: async () => 'test-build'};
      assert.equal(url, 'game.sfc');
      return {ok: true, arrayBuffer: async () => rom.buffer.slice(rom.byteOffset, rom.byteOffset + rom.length)};
    },
    createSmash: async options => {
      const game = await createSmash(options);
      const step = game._smash_frame;
      game._smash_frame = mask => {
        masks.push(mask);
        const result = step(mask);
        // Test the actual browser conversion, not Buffer's truncating writes.
        game.HEAPU32.set(colors, game._smash_pixels() / 4);
        return result;
      };
      return game;
    }
  };
  vm.runInNewContext(fs.readFileSync('web/play.js', 'utf8'), scope);
  await click(); assert.ok(removed && focused); assert.equal(error.hidden, true);
  const now = performance.now();
  events.keydown({code: 'ArrowRight', preventDefault() {}});
  scheduled(now + 21); assert.equal(masks.at(-1), 128);
  events.keyup({code: 'ArrowRight', preventDefault() {}});
  scheduled(now + 41); assert.equal(masks.at(-1), 0);
  events.keydown({code: 'KeyZ', preventDefault() {}});
  scheduled(now + 61); assert.equal(masks.at(-1), 1);
  events.blur(); scheduled(now + 81); assert.equal(masks.at(-1), 0);
  pads=[null,{connected:true,axes:[1,0],buttons:[{pressed:true}]}];
  scheduled(now+101);assert.equal(masks.at(-1),129,'First connected pad works even after slot zero disconnects');
  pads.push({connected:true,axes:[-1,0],buttons:[]});
  scheduled(now+121);assert.equal(masks.at(-1),129|(64<<12),'Offline player two has an independent pad');
  pads=[];scheduled(now+141);assert.equal(masks.at(-1),0,'Disconnected pads do not leave stuck buttons');
  assert.ok(painted >= 4 && audioBuffers.length >= 4);
  assert.equal(error.hidden, true);
  console.log('Web host passed: ROM loading, Start, video, audio scheduling, keyboard and focus reset.');
})().catch(error => {console.error(error); process.exitCode = 1;});
