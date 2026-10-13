// Real C/WASM menu, actual two-human setup, load barrier and deterministic
// frame admission. No DOM or fake game engine.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const createSmash=require('../web/smash.js');
const rom=fs.readFileSync('web/game.sfc');
async function core() {
  const g=await createSmash();const p=g._malloc(rom.length);g.HEAPU8.set(rom,p);
  assert.equal(g._smash_init(p,rom.length,32040),1);g._free(p);return g;
}
function steps(g,n,b=0) {for(let i=0;i<n;i++) {assert.ok(g._smash_frame(b));g._smash_audio(640);}}
function press(g,b,n=2) {steps(g,2,b);steps(g,n);}
function capture(g,name) {
  const pixels=g.HEAPU32.subarray(g._smash_pixels()/4,g._smash_pixels()/4+512*224);
  const rgb=Buffer.alloc(pixels.length*3);
  pixels.forEach((p,i)=>{rgb[i*3]=p>>>16;rgb[i*3+1]=p>>>8;rgb[i*3+2]=p;});
  fs.writeFileSync(`build/${name}.ppm`,Buffer.concat([Buffer.from('P6\n512 224\n255\n'),rgb]));
}
(async()=>{
  const menu=await core();steps(menu,600);press(menu,8,60);press(menu,8,60);
  assert.equal(menu._smash_ui_state(),1);capture(menu,'multiplayer-menu');
  const initialMenu=Buffer.from(menu.HEAPU8.subarray(menu._smash_pixels(),menu._smash_pixels()+512*224*4));
  press(menu,32);press(menu,32);capture(menu,'multiplayer-menu-selected');
  assert.deepEqual(Buffer.from(menu.HEAPU8.subarray(menu._smash_pixels(),menu._smash_pixels()+512*127*4)),
    initialMenu.subarray(0,512*127*4),'Selection preserves the original logo and stadium');
  press(menu,16);press(menu,16);
  assert.deepEqual(Buffer.from(menu.HEAPU8.subarray(menu._smash_pixels(),menu._smash_pixels()+512*224*4)),
    initialMenu,'Title styling must not accumulate or alter its saved backdrop');
  press(menu,32);press(menu,32);press(menu,8);
  assert.equal(menu._smash_ui_state(),2);
  for(const ch of 'Player One') menu._smash_text_key(ch.charCodeAt(0));
  capture(menu,'multiplayer-name');menu._smash_text_key(13);
  assert.equal(menu._smash_ui_state(),3);press(menu,128);press(menu,32);
  assert.equal(menu._smash_character(),3);capture(menu,'multiplayer-roster');press(menu,256);
  assert.equal(menu._smash_ui_state(),4);
  for(const ch of 'Tennis Club') menu._smash_text_key(ch.charCodeAt(0));
  menu._smash_text_key(13);assert.equal(menu._smash_ui_state(),5);
  press(menu,1);assert.equal(menu._smash_ui_state(),1);
  press(menu,16);press(menu,16);press(menu,8,300);
  assert.equal(menu._smash_ui_state(),0,'Original exhibition remains accessible');
  console.log('In-game menu, text entry, actual roster, cancellation and original exhibition passed.');
  const a=await core(),b=await core();
  steps(a,600);press(a,8,60);press(a,8,60);
  steps(b,620);press(b,8,60);press(b,8,60);
  assert.equal(a._smash_ui_state(),1);assert.equal(b._smash_ui_state(),1);
  const localHashes=[a,b].map(g=>g._smash_state_hash());
  assert.notEqual(localHashes[0],localHashes[1],'Players reach the menu with different histories');
  const size=a._smash_capture_menu();assert.ok(size>0);console.log('Menu snapshot bytes:',size);
  const snapshot=Buffer.from(a.HEAPU8.subarray(a._smash_menu_snapshot(),a._smash_menu_snapshot()+size));
  for(const g of [a,b]) {
    const ptr=g._malloc(size);g.HEAPU8.set(snapshot,ptr);
    assert.equal(g._smash_apply_menu(ptr,size),1);g._free(ptr);
  }
  for(const g of [a,b]) assert.equal(g._smash_prepare_match(1,18),1);
  let loading=0;
  while(a._smash_ui_state()===6 || b._smash_ui_state()===6) {
    for(const g of [a,b]) {assert.ok(g._smash_frame(4095));g._smash_audio(640);}
    assert.ok(++loading<5000,'Match setup terminates');
  }
  console.log('Loaded at',loading,'frames, states',a._smash_ui_state(),b._smash_ui_state());
  assert.ok(loading<2000,'Setup skips the original boot/intro');
  capture(a,'multiplayer-ready');
  assert.equal(a._smash_ui_state(),7);assert.equal(b._smash_ui_state(),7);
  assert.equal(a._smash_state_hash(),b._smash_state_hash());
  const hash=a._smash_state_hash();steps(a,10,4095);assert.equal(a._smash_state_hash(),hash,'Wait for ready freezes simulation');
  for(const g of [a,b]) assert.equal(g._smash_start_match(),1);
  assert.equal(a._smash_frame(4095),2);assert.equal(a._smash_net_tick(),0);
  assert.equal(a._smash_receive_frame(1,0),0,'Reject future frame');
  for(let i=0;i<360;i++) {
    const input=(i%60<20?1:128)|((i%90<40?64:256)<<12);
    for(const g of [a,b]) {
      assert.equal(g._smash_receive_frame(i,input),1);
      assert.equal(g._smash_receive_frame(i,input),0,'Reject duplicate');
      assert.equal(g._smash_frame(0),1);g._smash_audio(640);
    }
    assert.equal(a._smash_state_hash(),b._smash_state_hash(),`State divergence at ${i}`);
  }
  capture(a,'multiplayer-match');
  for(const [i,g] of [a,b].entries()) {
    g._smash_net_status(-4);
    assert.equal(g._smash_state_hash(),localHashes[i],'Restore each original local menu in the same instance');
    press(g,8);assert.equal(g._smash_ui_state(),1);
  }
  console.log('Two-player setup, chosen character records, load barrier, frame ordering and 360 synchronized gameplay frames passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
