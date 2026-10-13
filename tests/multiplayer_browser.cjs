// Requires Playwright (set SMASH_PLAYWRIGHT to an installed playwright-core).
// Real Chromium, two independent pages, real WASM and lobby WebSockets.
const assert=require('node:assert/strict');
const {once}=require('node:events');
const {createServer}=require('../lobby_server');
const {chromium}=require(process.env.SMASH_PLAYWRIGHT||'playwright-core');
(async()=>{
  const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');
  let browser;
  try {
    browser=await chromium.launch({headless:true,executablePath:process.env.SMASH_CHROMIUM,args:['--autoplay-policy=no-user-gesture-required']});
    const pages=await Promise.all([browser.newPage(),browser.newPage()]);
    const errors=[];pages.forEach(p=>p.on('pageerror',e=>errors.push(e.message)));
    pages.forEach((p,i)=>{
      p.on('console',m=>{if(m.type()==='error') console.error('Browser',i,m.text());});
      p.on('websocket',ws=>ws.on('framereceived',event=>{
        const m=JSON.parse(event.payload.toString());
        if(['error','start','sync'].includes(m.type)) console.log('Browser',i,m);
      }));
    });
    const url=`http://127.0.0.1:${server.address().port}`;
    for(const [index,page] of pages.entries()) {
      await page.goto(url);await page.click('#start');
      await page.waitForFunction(()=>typeof engine!=='undefined'&&running);
      await page.evaluate(()=>{window.originalEngine=engine;window.originalMemory=engine.HEAPU8.buffer;});
      // Fast-forward the intro; all actual menu interaction below is via keys.
      await page.evaluate(()=>{
        const step=(n,b=0)=>{for(let i=0;i<n;i++){engine._smash_frame(b);engine._smash_audio(640);}};
        step(600);step(2,8);step(60);step(2,8);step(60);
      });
      assert.equal(await page.evaluate(()=>engine._smash_ui_state()),1);
      async function key(k) {await page.keyboard.press(k,{delay:70});await page.waitForTimeout(70);}
      await key('ArrowDown');await key('ArrowDown');await key('Enter');
      assert.equal(await page.evaluate(()=>engine._smash_ui_state()),2);
      await page.keyboard.type(`PLAYER ${index+1}`);await key('Enter');
      assert.equal(await page.evaluate(()=>engine._smash_ui_state()),3);
      await key(index?'ArrowDown':'ArrowRight');await key('Enter');
      assert.equal(await page.evaluate(()=>engine._smash_ui_state()),4);
      await page.keyboard.type('BROWSER TEST');await key('Enter');
      if(!index) {
        await page.waitForTimeout(100);
        assert.equal(await page.evaluate(()=>engine._smash_ui_state()),5,'First player waits');
        await page.screenshot({path:'build/multiplayer-browser-lobby.png'});
      }
    }
    await Promise.all(pages.map(page=>page.waitForFunction(()=>[8,9].includes(engine._smash_ui_state()),null,{timeout:180000})));
    for(const page of pages) assert.equal(await page.evaluate(()=>engine._smash_ui_state()),8,'Match must start without a synchronization error');
    console.log('Both browser players loaded and started.');
    for(const page of pages) assert.equal(await page.evaluate(()=>engine===window.originalEngine),true,'Multiplayer must reuse the same game instance');
    for(const page of pages) await page.evaluate(()=>{
      window.hashes={};
      const hash=engine._smash_state_hash;
      engine._smash_state_hash=()=>{const h=hash();window.hashes[engine._smash_net_tick()]=h;return h;};
    });
    await pages[0].keyboard.down('KeyZ');await pages[1].keyboard.down('ArrowLeft');
    await Promise.all(pages.map(page=>page.waitForFunction(()=>engine._smash_net_tick()>=240,null,{timeout:45000})));
    await pages[0].keyboard.up('KeyZ');await pages[1].keyboard.up('ArrowLeft');
    const hashes=await Promise.all(pages.map(page=>page.evaluate(()=>window.hashes)));
    const shared=Object.keys(hashes[0]).filter(k=>k in hashes[1]);
    assert.ok(shared.length>=1);for(const tick of shared) assert.equal(hashes[0][tick],hashes[1][tick]);
    await pages[0].screenshot({path:'build/multiplayer-browser-match.png'});
    await pages[1].close();await pages[0].waitForFunction(()=>engine._smash_ui_state()===9);
    await pages[0].keyboard.press('Enter',{delay:100});
    await pages[0].waitForFunction(()=>engine._smash_ui_state()===1);
    assert.equal(await pages[0].evaluate(()=>engine===window.originalEngine),true,'Disconnect must keep the same instance');
    assert.deepEqual(errors,[]);
    console.log('Chromium passed: in-game menus, keyboard text, shared lobby, both loaded, matching gameplay hashes, disconnect and return to menu.');
  } finally {await browser?.close();server.closePeers();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
