import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {once} from 'node:events';
import net from 'node:net';

test('protected deployment imports atomically and persists across restarts',async()=>{
 const directory=await fs.mkdtemp(path.resolve('.test-data-'));
 const probe=net.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
 const base=`http://127.0.0.1:${port}`;
 const authorization='Basic '+Buffer.from('admin:test-password-long-enough').toString('base64');
 let child;
 const start=async()=>{
  child=spawn(process.execPath,['server.mjs'],{env:{...process.env,NODE_ENV:'production',HOST:'127.0.0.1',PORT:String(port),DATA_DIR:directory,DASHBOARD_PASSWORD:'test-password-long-enough',DASHBOARD_USERNAME:'admin'},stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('startup timeout')),10000);child.stdout.once('data',()=>{clearTimeout(timer);resolve();});child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);reject(Error('startup exit '+code));});});
 };
 const stop=async()=>{if(child&&child.exitCode===null){const done=once(child,'exit');child.kill();await done;}};
 const fixture={version:2,updatedAt:new Date().toISOString(),coverage:{start:'2026-09-01',end:'2026-09-01'},fx:{cnyPerUsd:6.8},sources:{ga4:{},google:{},meta:{}},ga4:[],orders:[],ads:[],totals:[],nonCatalog:[],sourceAudit:[]};
 const send=body=>fetch(base+'/api/import',{method:'POST',headers:{authorization,'Content-Type':'application/json','X-Dashboard-Request':'import'},body:JSON.stringify(body)});
 try{
  await start();
  assert.equal((await fetch(base+'/health')).status,200);
  assert.equal((await fetch(base+'/data.json')).status,401);
  assert.equal((await fetch(base+'/')).status,401);
  assert.equal((await fetch(base+'/',{headers:{authorization}})).status,200);
  assert.equal((await fetch(base+'/data.json',{headers:{authorization}})).status,404);
  assert.equal((await fetch(base+'/api/import',{method:'POST',headers:{authorization}})).status,403);
  assert.equal((await send(fixture)).status,200);
  assert.equal((await send({})).status,400);
  assert.deepEqual(await (await fetch(base+'/data.json',{headers:{authorization}})).json(),fixture);
  assert.equal((await send(fixture)).status,200);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory,'dashboard.previous.json'),'utf8')),fixture);
  assert.equal((await fetch(base+'/data/dashboard.previous.json',{headers:{authorization}})).status,404);
  await stop();await start();
  assert.deepEqual(await (await fetch(base+'/data.json',{headers:{authorization}})).json(),fixture);
 }finally{await stop();await fs.rm(directory,{recursive:true,force:true});}
});
