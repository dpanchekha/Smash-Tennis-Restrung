// Real WASM: two rollback peers (opposite seats) against a lockstep oracle.
// Ordered delayed delivery models WebSocket jitter and head-of-line blocking.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const create=require('../web/smash.js');
const rom=fs.readFileSync('web/game.sfc');
const input=(frame,seat)=>frame<2?0:((frame%(seat?19:13)<6?1:256)|(frame%(seat?31:23)<11?64:128));
const pair=frame=>input(frame,0)|(input(frame,1)<<12);
function step(g,n,b=0) {for(let i=0;i<n;i++){assert.ok(g._smash_frame(b));g._smash_audio(640);}}
async function core() {
  const g=await create(),p=g._malloc(rom.length);g.HEAPU8.set(rom,p);
  assert.equal(g._smash_init(p,rom.length,32040),1);g._free(p);
  step(g,600);step(g,2,8);step(g,60);step(g,2,8);step(g,60);
  return g;
}
(async()=>{
  const oracle=await core(),peers=[await core(),await core()];
  const size=oracle._smash_capture_menu();assert.ok(size>0);
  const bytes=Buffer.from(oracle.HEAPU8.subarray(oracle._smash_menu_snapshot(),oracle._smash_menu_snapshot()+size));
  for(const g of [oracle,...peers]) {
    const p=g._malloc(size);g.HEAPU8.set(bytes,p);assert.equal(g._smash_apply_menu(p,size),1);g._free(p);
    assert.equal(g._smash_prepare_match(1,18),1);
    for(let i=0;g._smash_ui_state()===6;i++) {assert.ok(i<3000);step(g,1);}
    assert.equal(g._smash_ui_state(),7);
    assert.equal(g._smash_state_hash(),oracle._smash_state_hash());
  }
  assert.equal(oracle._smash_start_match(),1);
  peers.forEach((g,s)=>assert.equal(g._smash_start_rollback(s),1));
  const total=360,next=[0,0],incoming=[[],[]],checked=[0,0],hashes=[oracle._smash_state_hash()];
  // Exhaust prediction, then deliver another input between two replay chunks.
  // The corrected prefix must survive when that input is in the pending suffix.
  for(let f=0;f<6;f++) {
    assert.equal(oracle._smash_receive_frame(f,pair(f)),1);step(oracle,1);hashes.push(oracle._smash_state_hash());
    peers.forEach((g,s)=>{
      while(next[s]<=f+2) {assert.equal(g._smash_local_input(next[s],input(next[s],s)),1);next[s]++;}
      assert.equal(g._smash_frame(0),1);g._smash_audio(640);
    });
  }
  for(const g of peers) {
    assert.equal(g._smash_frame(0),2,'Stop at six unconfirmed frames');
    for(let f=0;f<4;f++) assert.equal(g._smash_receive_frame(f,pair(f)),1);
    assert.equal(g._smash_frame(0),3);
    assert.equal(g._smash_receive_frame(4,pair(4)),1);
    assert.equal(g._smash_frame(0),3);
    assert.equal(g._smash_receive_frame(5,pair(5)),1);
    for(let i=0;g._smash_confirmed_tick()<6;i++) {assert.ok(i<5);assert.equal(g._smash_frame(0),3);}
    assert.equal(g._smash_state_hash(),hashes[6],'New input during replay preserves corrected prefix');
  }
  let released=6,iteration=0;const forward=[],replay=[];
  while(peers.some(g=>g._smash_confirmed_tick()<total)) {
    assert.ok(iteration++<5000,'Recovery must terminate');
    peers.forEach((g,s)=>{
      while(next[s]<total && next[s]<=g._smash_net_tick()+2) {
        assert.equal(g._smash_local_input(next[s],input(next[s],s)),1);next[s]++;
      }
    });
    while(released<Math.min(...next)) {
      const f=released++;
      assert.equal(oracle._smash_receive_frame(f,pair(f)),1);step(oracle,1);
      hashes.push(oracle._smash_state_hash());
      peers.forEach((g,s)=>incoming[s].push({frame:f,at:iteration+(f===180?24:f>60?(s?5:3):0)}));
    }
    peers.forEach((g,s)=>{
      while(incoming[s].length && incoming[s][0].at<=iteration) {
        const f=incoming[s].shift().frame;
        assert.equal(g._smash_receive_frame(f,pair(f)),1);
        assert.equal(g._smash_receive_frame(f,pair(f)),0,'Reject duplicate authoritative input');
      }
      if(g._smash_net_tick()<total || g._smash_confirmed_tick()<g._smash_net_tick()) {
        const before=g._smash_net_tick(),t=performance.now(),result=g._smash_frame(4095),ms=performance.now()-t;
        assert.ok(result>0);
        if(result===1) {g._smash_audio(640);forward.push(ms);assert.equal(g._smash_net_tick(),before+1);}
        else {assert.equal(g._smash_net_tick(),before);if(result===3) replay.push(ms);}
      }
      while(checked[s]<g._smash_confirmed_tick()) {
        const f=++checked[s];
        assert.equal(g._smash_confirmed_hash(f),hashes[f],`Peer ${s}, confirmed frame ${f}`);
      }
    });
  }
  for(const g of peers) {
    assert.ok(g._smash_rollback_count()>0);assert.ok(g._smash_replayed_frames()>0);
    assert.ok(g._smash_rollback_stalls()>0,'Long jitter must stall at the bounded window');
    assert.equal(g._smash_state_hash(),oracle._smash_state_hash());
  }
  // First visible frame after the final correction must match a normally drawn oracle.
  assert.equal(oracle._smash_receive_frame(total,pair(total)),1);step(oracle,1);
  peers.forEach((g,s)=>{
    assert.equal(g._smash_local_input(total,input(total,s)),1);
    assert.equal(g._smash_receive_frame(total,pair(total)),1);assert.equal(g._smash_frame(0),1);g._smash_audio(640);
    assert.deepEqual(Buffer.from(g.HEAPU8.subarray(g._smash_pixels(),g._smash_pixels()+512*224*4)),
      Buffer.from(oracle.HEAPU8.subarray(oracle._smash_pixels(),oracle._smash_pixels()+512*224*4)));
    assert.equal(g._smash_local_input(total+2,0),0,'Reject skipped local frames');
    g._smash_net_status(-4);assert.equal(g._smash_ui_state(),9);
  });
  const stats=a=>({count:a.length,meanMs:a.reduce((x,y)=>x+y,0)/a.length,p95Ms:a.sort((x,y)=>x-y)[Math.floor(a.length*.95)]});
  console.log('Rollback passed: prediction, both seats, corrections, 360 confirmed hashes, bounded stalls, pixel equality, disconnect.');
  console.log('Node timing (not a browser/device guarantee):',JSON.stringify({forward:stats(forward),replayCallbacks:stats(replay)}));
})().catch(e=>{console.error(e);process.exitCode=1;});
