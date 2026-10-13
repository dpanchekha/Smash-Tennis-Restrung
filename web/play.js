'use strict';
// Presentation and browser I/O. Menu and match rules live in multiplayer.c.
const start=document.querySelector('#start'), canvas=document.querySelector('#screen');
const context=canvas.getContext('2d',{alpha:false});
const frame=context.createImageData(512,224), frameWords=new Uint32Array(frame.data.buffer);
const littleEndian=new Uint8Array(new Uint32Array([1]).buffer)[0]===1;
const keys={KeyZ:1,KeyA:2,ShiftRight:4,Enter:8,ArrowUp:16,ArrowDown:32,ArrowLeft:64,ArrowRight:128,KeyX:256,KeyS:512,KeyQ:1024,KeyW:2048};
const fps=21281370/425568, RATE=32040;
const MP={OFF:0,MENU:1,NAME:2,CHARACTER:3,CODE:4,JOIN:5,LOADING:6,READY:7,PLAY:8,ERROR:9,ENDED:10};
let buttons=0,engine,rom,audio,nextAudio=0,deadline=0,running=false,sampleCarry=0;
let socket=null,readySent=false,nextInput=0,connecting=false,buildId;
let lastNetwork=0,lastState=MP.OFF;
addEventListener('keydown',event=>{
  const state=engine?._smash_ui_state();
  if((state===MP.NAME||state===MP.CODE)&&!event.ctrlKey&&!event.metaKey&&!event.altKey) {
    const key=event.key==='Backspace'?8:event.key==='Enter'?13:event.key?.length===1?event.key.charCodeAt(0):0;
    if(key) {event.preventDefault();if(!event.repeat||key===8) engine._smash_text_key(key);return;}
  }
  if(event.code==='Escape'&&state>=MP.NAME&&state<=MP.JOIN) {event.preventDefault();buttons|=4;return;}
  if(keys[event.code]) {event.preventDefault();buttons|=keys[event.code];}
});
addEventListener('keyup',event=>{
  if(event.code==='Escape') buttons&=~4;
  if(keys[event.code]) {event.preventDefault();buttons&=~keys[event.code];}
});
addEventListener('blur',()=>{buttons=0;});
function padButtons(pad) {
  if(!pad||pad.connected===false) return 0;
  const mapping=[1,256,2,512,1024,2048,0,0,4,8,0,0,16,32,64,128];
  let result=0;
  pad.buttons.forEach((button,i)=>{if(button.pressed) result|=mapping[i]||0;});
  if(pad.axes[0]<-.5) result|=64;
  if(pad.axes[0]>.5) result|=128;
  if(pad.axes[1]<-.5) result|=16;
  if(pad.axes[1]>.5) result|=32;
  return result;
}
function controller() {
  const pads=Array.from(navigator.getGamepads?.()||[]).filter(pad=>pad&&pad.connected!==false);
  const first=(buttons|padButtons(pads[0]))&0xfff;
  return socket?first:first|(padButtons(pads[1])<<12);
}
function cstring(pointer) {
  let end=pointer;while(engine.HEAPU8[end]) end++;
  return new TextDecoder().decode(engine.HEAPU8.subarray(pointer,end));
}
async function newCore() {
  const core=await createSmash({print:console.log,printErr:console.warn});
  const ptr=core._malloc(rom.length);core.HEAPU8.set(rom,ptr);
  const loaded=core._smash_init(ptr,rom.length,RATE);core._free(ptr);
  if(!loaded) throw Error('Could not initialize Smash Tennis.');
  return core;
}
function closeLobby() {
  const old=socket;socket=null;old?.close();connecting=false;readySent=false;nextInput=0;
}
function networkError(code=-4) {
  closeLobby();
  engine._smash_net_status(code);buttons=0;nextAudio=0;
}
function send(message) {if(socket?.readyState===1) socket.send(JSON.stringify(message));}
async function connectLobby() {
  if(connecting||socket) return;
  connecting=true;
  const identity={username:cstring(engine._smash_username()),code:cstring(engine._smash_lobby_code()),character:engine._smash_character(),build:buildId};
  try {
    const ws=new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}/ws`);
    socket=ws;lastNetwork=performance.now();
    ws.addEventListener('open',()=>{if(socket===ws) send({type:'join',...identity});});
    ws.addEventListener('error',()=>{if(socket===ws) networkError(-1);});
    ws.addEventListener('close',()=>{if(socket===ws) networkError(-4);});
    ws.addEventListener('message',event=>{
      if(socket!==ws) return;
      lastNetwork=performance.now();
      try {
        const m=JSON.parse(event.data);
        if(m.type==='error') {networkError(m.code||-1);return;}
        if(m.type==='room') engine._smash_net_status(1);
        if(m.type==='sync') {
          const size=engine._smash_capture_menu();
          if(!size) throw Error('Could not capture the current menu');
          const ptr=engine._smash_menu_snapshot();
          let bytes='';
          for(let i=0;i<size;i+=8192) bytes+=String.fromCharCode(...engine.HEAPU8.subarray(ptr+i,ptr+Math.min(size,i+8192)));
          send({type:'snapshot',data:btoa(bytes)});
        }
        if(m.type==='prepare') {
          if(typeof m.data!=='string'||m.data.length>2796204) throw Error('Invalid snapshot size');
          const bytes=atob(m.data),ptr=engine._malloc(bytes.length);
          try {
            for(let i=0;i<bytes.length;i++) engine.HEAPU8[ptr+i]=bytes.charCodeAt(i);
            if(!engine._smash_apply_menu(ptr,bytes.length)) throw Error('Could not synchronize the current menu');
          } finally {engine._free(ptr);}
          sampleCarry=0;nextAudio=0;readySent=false;
          if(!engine._smash_prepare_match(m.characters[0],m.characters[1])) throw Error('Invalid match setup');
        }
        if(m.type==='start') {
          if(!engine._smash_start_match()) throw Error('Match started before loading');
          nextInput=0;deadline=performance.now();nextAudio=0;
        }
        if(m.type==='frame'&&!engine._smash_receive_frame(m.frame,m.buttons)) throw Error('Invalid frame order');
      } catch(error) {console.error(error);if(socket===ws) networkError(-3);}
    });
  } catch(error) {console.error(error);networkError(-1);}
}
function pumpNetwork() {
  const state=engine._smash_ui_state();
  if(state===MP.JOIN) connectLobby();
  if(socket&&state<MP.JOIN) closeLobby();
  if(socket&&state===MP.ERROR) {networkError(-3);return;}
  if(socket&&state===MP.ENDED) {networkError(-5);return;}
  if(socket&&performance.now()-lastNetwork>20000) {networkError(-4);return;}
  if(state===MP.READY&&!readySent) {readySent=true;send({type:'ready',hash:engine._smash_state_hash()>>>0});}
  if(state===MP.PLAY) {
    // Four-frame window; C advances only after the server pairs both inputs.
    const limit=engine._smash_net_tick()+4;
    while(nextInput<limit) send({type:'input',frame:nextInput++,buttons:controller()&0xfff});
  }
  if(state!==lastState) {buttons=0;lastState=state;}
}
function fail(error) {
  running=false;closeLobby();
  document.querySelector('#error').hidden=false;
  document.querySelector('#error').textContent=String(error);console.error(error);
}
function queueAudio() {
  sampleCarry+=RATE/fps;
  const samples=Math.floor(sampleCarry);sampleCarry-=samples;
  engine._smash_audio(samples);
  const pcm=engine.HEAP16.subarray(engine._smash_audio_buffer()/2,engine._smash_audio_buffer()/2+samples*2);
  const buffer=audio.createBuffer(2,samples,RATE);
  for(let channel=0;channel<2;channel++) {
    const output=buffer.getChannelData(channel);
    for(let i=0;i<samples;i++) output[i]=pcm[i*2+channel]/32768;
  }
  const source=audio.createBufferSource();source.buffer=buffer;source.connect(audio.destination);
  nextAudio=Math.max(nextAudio,audio.currentTime+.025);source.start(nextAudio);nextAudio+=buffer.duration;
}
function paint() {
  const pixels=engine.HEAPU32.subarray(engine._smash_pixels()/4,engine._smash_pixels()/4+512*224);
  for(let i=0;i<pixels.length;i++) {
    const p=pixels[i];
    frameWords[i]=littleEndian?0xff000000|((p&255)<<16)|(p&0xff00)|((p>>>16)&255):(p<<8)|255;
  }
  context.putImageData(frame,0,0);
}
function tick(now) {
  if(!running) return;
  try {
    pumpNetwork();
    if(document.hidden) {deadline=now;nextAudio=0;requestAnimationFrame(tick);return;}
    if(now-deadline>100) deadline=now;
    let count=0;
    const loading=engine._smash_ui_state()===MP.LOADING;
    while((loading||now>=deadline)&&count++<(loading?8:5)) {
      const result=engine._smash_frame(controller());
      if(!result) throw Error('The game stopped responding. Reload to restart.');
      if(result===1) {
        if(loading) engine._smash_audio(640);else queueAudio();
        const frameNumber=engine._smash_net_tick();
        if(engine._smash_ui_state()===MP.PLAY&&frameNumber%120===0)
          send({type:'hash',frame:frameNumber,hash:engine._smash_state_hash()>>>0});
      } else nextAudio=0;
      deadline+=1000/fps;
      if(loading&&engine._smash_ui_state()!==MP.LOADING) break;
    }
    if(loading) deadline=now;
    if(count) paint();
    pumpNetwork();requestAnimationFrame(tick);
  } catch(error) {fail(error);}
}
start.addEventListener('click',async()=>{
  start.disabled=true;start.textContent='Loading…';
  try {
    audio=new AudioContext();await audio.resume();
    const response=await fetch('game.sfc');
    if(!response.ok) throw Error('Could not load the game ROM.');
    rom=new Uint8Array(await response.arrayBuffer());
    try {const response=await fetch('build-id');if(response.ok) buildId=await response.text();} catch {}
    engine=await newCore();
    start.remove();canvas.style.display='block';canvas.focus();
    running=true;deadline=performance.now();requestAnimationFrame(tick);
  } catch(error) {fail(error);}
});
