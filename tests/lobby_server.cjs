const assert=require('node:assert/strict');
const {once}=require('node:events');
const net=require('node:net');
const {createServer}=require('../lobby_server');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
  const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');
  const port=server.address().port,base=`http://127.0.0.1:${port}`;
  const build=await (await fetch(base+'/build-id')).text();
  const sockets=[];
  async function peer(code,character=0,version=build) {
    const ws=new WebSocket(`ws://127.0.0.1:${port}/ws`);sockets.push(ws);
    const messages=[];ws.addEventListener('message',event=>messages.push(JSON.parse(event.data)));
    await once(ws,'open');
    const send=m=>ws.send(JSON.stringify(m));
    send({type:'join',code,character,username:'TEST',build:version});
    async function take(type) {
      for(let n=0;n<200;n++) {const i=messages.findIndex(m=>m.type===type);if(i>=0) return messages.splice(i,1)[0];await delay(5);}
      throw Error(`No ${type}: ${JSON.stringify(messages)}`);
    }
    return {ws,messages,send,take};
  }
  try {
    const a=await peer('shared code',1);await a.take('room');
    a.send({type:'ready',hash:1});assert.equal((await a.take('error')).code,-1,'Cannot ready alone');
    await delay(30);
    const p=await peer('shared code',1);await p.take('room');
    const q=await peer('SHARED CODE',18);
    await p.take('sync');
    const snapshot=Buffer.alloc(100000,42).toString('base64');
    p.send({type:'snapshot',data:snapshot});
    assert.deepEqual((await p.take('prepare')).characters,[1,18]);
    assert.equal((await q.take('prepare')).data,snapshot,'Relay a snapshot using a 64-bit WebSocket length');
    const full=await peer('shared code');assert.equal((await full.take('error')).code,-2);
    p.send({type:'ready',hash:99});await delay(30);
    assert.ok(!p.messages.some(m=>m.type==='start'),'Wait for both loads');
    q.send({type:'ready',hash:99});
    assert.deepEqual(await p.take('start'),{type:'start',seat:0,delay:2,rollback:6});
    assert.deepEqual(await q.take('start'),{type:'start',seat:1,delay:2,rollback:6});
    p.send({type:'input',frame:0,buttons:128});await delay(30);
    assert.ok(!p.messages.some(m=>m.type==='frame'),'Wait for both inputs');
    q.send({type:'input',frame:0,buttons:64});
    assert.deepEqual(await p.take('frame'),{type:'frame',frame:0,buttons:128|(64<<12)});
    assert.deepEqual(await q.take('frame'),{type:'frame',frame:0,buttons:128|(64<<12)});
    q.ws.close();assert.equal((await p.take('error')).code,-4);
    await delay(30);
    const reuse=await peer('shared code');await reuse.take('room');reuse.ws.close();
    const wrong=await peer('version',0,'wrong');assert.equal((await wrong.take('error')).code,-3);
    const x=await peer('mismatch'),y=await peer('mismatch');
    await x.take('sync');x.send({type:'snapshot',data:'AQIDBA=='});await x.take('prepare');await y.take('prepare');
    x.send({type:'ready',hash:1});y.send({type:'ready',hash:2});
    assert.equal((await y.take('error')).code,-3);
    // Split extended length headers must wait for more bytes, not crash Node.
    const raw=net.connect(port,'127.0.0.1');await once(raw,'connect');
    raw.write(`GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: MDEyMzQ1Njc4OWFiY2RlZg==\r\n\r\n`);
    await once(raw,'data');raw.write(Buffer.from([0x81,0xfe]));await delay(20);
    assert.equal((await fetch(base+'/')).status,200);raw.destroy();
    console.log('Lobby tests passed: shared codes, two-seat cap, load/input barriers, version/state mismatch, disconnect/reuse and partial WebSocket header.');
  } finally {for(const ws of sockets) ws.close();server.closePeers();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
