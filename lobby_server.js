'use strict';
// Same-origin lobby service. All game/menu logic is compiled from C; this
// service pairs two numbered controller samples before releasing a frame.
const crypto=require('node:crypto');
const fs=require('node:fs');
const http=require('node:http');
const path=require('node:path');
const root=path.join(__dirname,'web');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.wasm':'application/wasm','.sfc':'application/octet-stream','.txt':'text/plain; charset=utf-8','.md':'text/markdown; charset=utf-8'};

function createServer() {
  const rooms=new Map(), peers=new Set();
  const build=crypto.createHash('sha256');
  for(const file of ['game.sfc','smash.wasm','smash.js','play.js']) build.update(fs.readFileSync(path.join(root,file)));
  build.update(fs.readFileSync(__filename));
  const buildId=build.digest('hex');
  function wire(peer,opcode,data) {
    if(peer.socket.destroyed) return;
    if(peer.socket.writableLength>4194304) return peer.socket.destroy();
    let head;
    if(data.length<126) head=Buffer.from([0x80|opcode,data.length]);
    else if(data.length<=65535) head=Buffer.from([0x80|opcode,126,data.length>>8,data.length&255]);
    else {head=Buffer.alloc(10);head[0]=0x80|opcode;head[1]=127;head.writeUInt32BE(data.length,6);}
    peer.socket.write(Buffer.concat([head,data]));
  }
  function send(peer,value) {wire(peer,1,Buffer.from(JSON.stringify(value)));}
  function broadcast(room,value) {room.players.forEach(peer=>send(peer,value));}
  function reject(peer,code) {send(peer,{type:'error',code});wire(peer,8,Buffer.alloc(0));peer.socket.end();}
  function remove(peer) {
    peers.delete(peer);
    if(!peer.room) return;
    const room=peer.room;peer.room=null;
    rooms.delete(room.code);
    for(const other of room.players) {
      other.room=null;
      if(other!==peer) reject(other,-4);
    }
  }
  const validText=(s,max)=>typeof s==='string'&&s.trim().length>0&&s.length<=max&&/^[\x20-\x7e]+$/.test(s);
  function message(peer,m) {
    if(!m || typeof m!=='object') return reject(peer,-1);
    if(m.type==='join') {
      if(peer.room||!validText(m.code,48)||!validText(m.username,20)||!Number.isInteger(m.character)||m.character<0||m.character>=20) return reject(peer,-1);
      if(m.build!==buildId) return reject(peer,-3);
      const code=m.code.trim().toUpperCase();
      let room=rooms.get(code);
      if(room?.players.length===2) return reject(peer,-2);
      if(!room) {
        if(rooms.size>=256) return reject(peer,-1);
        room={code,players:[],phase:'waiting',tick:0,pending:new Map(),hashes:new Map(),activity:Date.now()};
        rooms.set(code,room);
      }
      peer.room=room;peer.character=m.character;peer.username=m.username.trim();peer.next=0;
      peer.seat=room.players.length;room.players.push(peer);room.activity=Date.now();
      if(room.players.length===1) send(peer,{type:'room'});
      else {room.phase='sync';send(room.players[0],{type:'sync'});}
      return;
    }
    const room=peer.room;
    if(!room) return reject(peer,-1);
    if(m.type==='snapshot') {
      if(room.phase!=='sync'||peer.seat!==0||typeof m.data!=='string'||!m.data.length||m.data.length>2796204||m.data.length%4||!/^[A-Za-z0-9+/]+={0,2}$/.test(m.data)) return reject(peer,-1);
      room.phase='loading';room.activity=Date.now();
      broadcast(room,{type:'prepare',characters:room.players.map(p=>p.character),data:m.data});
    } else if(m.type==='ready') {
      if(room.phase!=='loading'||peer.ready||!Number.isInteger(m.hash)) return reject(peer,-1);
      peer.ready=true;peer.hash=m.hash;room.activity=Date.now();
      if(room.players.every(p=>p.ready)) {
        if(room.players[0].hash!==room.players[1].hash) return reject(peer,-3);
        room.phase='playing';
        room.players.forEach(p=>send(p,{type:'start',seat:p.seat,delay:2,rollback:6}));
      }
    } else if(m.type==='input') {
      if(room.phase!=='playing'||!Number.isInteger(m.frame)||m.frame!==peer.next||m.frame>room.tick+8||!Number.isInteger(m.buttons)||m.buttons<0||m.buttons>4095) return reject(peer,-1);
      peer.next++;
      const pair=room.pending.get(m.frame)||[null,null];pair[peer.seat]=m.buttons;room.pending.set(m.frame,pair);
      while(room.pending.get(room.tick)?.every(v=>v!==null)) {
        const pair=room.pending.get(room.tick);room.pending.delete(room.tick);
        broadcast(room,{type:'frame',frame:room.tick++,buttons:pair[0]|(pair[1]<<12)});
        room.activity=Date.now();
      }
    } else if(m.type==='hash') {
      if(room.phase!=='playing'||!Number.isInteger(m.frame)||m.frame<=0||m.frame%120!==0||m.frame>room.tick||m.frame<room.tick-128||!Number.isInteger(m.hash)) return reject(peer,-1);
      const hashes=room.hashes.get(m.frame)||[null,null];
      if(hashes[peer.seat]!==null) return reject(peer,-1);
      hashes[peer.seat]=m.hash;room.hashes.set(m.frame,hashes);
      if(hashes.every(v=>v!==null)) {
        room.hashes.delete(m.frame);
        if(hashes[0]!==hashes[1]) return reject(peer,-3);
      }
    } else reject(peer,-1);
  }
  function receive(peer,chunk) {
    peer.buffer=Buffer.concat([peer.buffer,chunk]);
    if(peer.buffer.length>4194304) return peer.socket.destroy();
    while(peer.buffer.length>=2) {
      const a=peer.buffer[0],b=peer.buffer[1],size=b&127,opcode=a&15;
      const final=!!(a&128);
      if((a&112)||!(b&128)||(opcode>=8&&!final)) return peer.socket.destroy();
      if(size===126&&peer.buffer.length<4) return;
      if(size===127&&peer.buffer.length<10) return;
      if(size===127&&peer.buffer.readUInt32BE(2)!==0) return peer.socket.destroy();
      const length=size===127?peer.buffer.readUInt32BE(6):size===126?peer.buffer.readUInt16BE(2):size;
      const start=size===127?14:size===126?8:6;
      const limit=peer.room?.phase==='sync'&&peer.seat===0?2796300:1024;
      if(length>limit||(opcode>=8&&length>125)) return peer.socket.destroy();
      if(peer.buffer.length<start+length) return;
      const mask=peer.buffer.subarray(start-4,start);
      let payload=Buffer.from(peer.buffer.subarray(start,start+length));
      for(let i=0;i<payload.length;i++) payload[i]^=mask[i%4];
      peer.buffer=peer.buffer.subarray(start+length);
      if(opcode===8) {wire(peer,8,Buffer.alloc(0));return peer.socket.end();}
      if(opcode===9) {wire(peer,10,payload);continue;}
      if(opcode===10) continue;
      if(opcode===0) {
        if(!peer.fragments) return peer.socket.destroy();
      } else if(opcode===1) {
        if(peer.fragments) return peer.socket.destroy();
        if(!final) {peer.fragments=[];peer.fragmentSize=0;}
      } else return peer.socket.destroy();
      if(peer.fragments) {
        peer.fragmentSize+=payload.length;
        if(peer.fragmentSize>limit) return peer.socket.destroy();
        peer.fragments.push(payload);
        if(!final) continue;
        payload=Buffer.concat(peer.fragments,peer.fragmentSize);
        peer.fragments=null;peer.fragmentSize=0;
      }
      const now=Date.now();if(now-peer.window>1000) {peer.window=now;peer.count=0;}
      if(++peer.count>500) return peer.socket.destroy();
      try {message(peer,JSON.parse(payload.toString('utf8')));} catch {return reject(peer,-1);}
    }
  }
  const server=http.createServer((request,response)=>{
    if(request.method!=='GET'&&request.method!=='HEAD') {response.writeHead(405);return response.end();}
    const pathname=new URL(request.url,'http://localhost').pathname;
    if(pathname==='/build-id') {response.writeHead(200,{'Content-Type':'text/plain','Cache-Control':'no-store'});return response.end(buildId);}
    const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
    if(!file.startsWith(root+path.sep)) {response.writeHead(403);return response.end();}
    fs.readFile(file,(error,data)=>{
      if(error) {response.writeHead(404);response.end('Not found');}
      else {response.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache'});response.end(request.method==='HEAD'?undefined:data);}
    });
  });
  server.on('upgrade',(request,socket,head)=>{
    const key=request.headers['sec-websocket-key'];
    let originOK=true;
    try {if(request.headers.origin) originOK=new URL(request.headers.origin).host===request.headers.host;} catch {originOK=false;}
    if(request.url!=='/ws'||request.headers['sec-websocket-version']!=='13'||typeof key!=='string'||!/^[A-Za-z0-9+/]{22}==$/.test(key)||!originOK||peers.size>=512) return socket.destroy();
    const accept=crypto.createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.setNoDelay(true);socket.setTimeout(180000,()=>socket.destroy());
    const peer={socket,buffer:Buffer.alloc(0),window:Date.now(),count:0};peers.add(peer);
    socket.on('data',chunk=>receive(peer,chunk));socket.on('close',()=>remove(peer));socket.on('error',()=>remove(peer));
    if(head.length) receive(peer,head);
  });
  const heartbeat=setInterval(()=>{
    for(const room of rooms.values()) {
      const limit=room.phase==='waiting'?600000:['loading','sync'].includes(room.phase)?180000:45000;
      if(Date.now()-room.activity>limit) {for(const peer of room.players) reject(peer,-4);}
      else broadcast(room,{type:'heartbeat'});
    }
  },5000);
  heartbeat.unref();server.on('close',()=>clearInterval(heartbeat));
  server.closePeers=()=>{for(const peer of peers) peer.socket.destroy();};
  return server;
}
if(require.main===module) {
  const port=Number(process.env.PORT||8000);
  createServer().listen(port,process.env.HOST||'0.0.0.0',()=>console.log(`Open http://localhost:${port}/`));
}
module.exports={createServer};
