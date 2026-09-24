import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {configuration,publicConfiguration,makeClient,collectReports,mergeReports,checkRange,SyncError} from '../sync.mjs';
import {SyncJobs} from '../sync-jobs.mjs';
import {saveReport,readReport} from '../data-store.mjs';
import {aggregate} from '../dist/model.js';
const env={GOOGLE_CLIENT_ID:'test-client',GOOGLE_CLIENT_SECRET:'test-secret',GOOGLE_REFRESH_TOKEN:'test-refresh',META_ACCESS_TOKEN:'test-meta',GA4_PROPERTY_ID:'1',GOOGLE_ADS_CUSTOMER_ID:'2',META_AD_ACCOUNT_IDS:'3'};
const cfg=configuration(env);
const day='2026-09-01';
const response=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body});
function fixture(date=day,revenue=100){return {version:2,updatedAt:new Date().toISOString(),coverage:{start:date,end:date},fx:{cnyPerUsd:6.8},sources:{ga4:{property:'1',currency:'USD',timezone:'America/Los_Angeles'},google:{account:'2',currency:'CNY',timezone:'Asia/Shanghai'},meta:{accounts:['3'],currency:'USD',timezone:'Asia/Shanghai'}},ga4:[{date,title:'Product',sessions:2,revenue}],orders:[],ads:[],totals:[],nonCatalog:[],sourceAudit:[],candidates:{},verifiedMappings:{},mappingEvidence:{}};}
async function temporary(run){const dir=await fs.mkdtemp(path.resolve('.test-data-'));try{await run(dir);}finally{await fs.rm(dir,{recursive:true,force:true});}}

test('configuration exposes missing names but never credentials',()=>{
 const publicCfg=publicConfiguration(cfg);assert.equal(publicCfg.ready,true);assert.equal(JSON.stringify(publicCfg).includes('test-secret'),false);
 assert.ok(publicConfiguration(configuration({})).missing.includes('GOOGLE_REFRESH_TOKEN'));
 assert.equal(publicConfiguration(configuration({...env,META_AD_ACCOUNT_IDS:'3,3'})).ready,false);
});
test('Google and GA4 pagination uses offsets/tokens and refreshes once',async()=>{
 let oauth=0;const seen=[];
 const client=makeClient(cfg,{fetchImpl:async(url,options)=>{
  if(url.includes('oauth2')){oauth++;return response({access_token:'token',expires_in:3600});}
  const body=JSON.parse(options.body);seen.push(body);
  if(url.includes('analyticsdata'))return response({rowCount:2,rows:[{n:body.offset}],metadata:{}});
  return response(body.pageToken?{results:[{n:2}]}:{results:[{n:1}],nextPageToken:'next'});
 }});
 assert.equal((await client.ga4(day,day,['date'],['sessions'])).rows.length,2);
 assert.deepEqual((await client.google('SELECT test')).map(x=>x.n),[1,2]);assert.equal(oauth,1);
 assert.deepEqual(seen.slice(0,2).map(x=>x.offset),['0','1']);assert.equal(seen[3].pageToken,'next');
});
test('GA4 incomplete and thresholded reports fail rather than commit partial data',async()=>{
 for(const report of [{rowCount:2,rows:[]},{rowCount:0,metadata:{subjectToThresholding:true}}]){
  const client=makeClient(cfg,{fetchImpl:async url=>response(url.includes('oauth2')?{access_token:'token'}:report)});
  await assert.rejects(client.ga4(day,day,['date'],['sessions']),SyncError);
 }
});
test('Meta pagination uses cursor on trusted host, never follows upstream next URL',async()=>{
 const urls=[];const client=makeClient(cfg,{fetchImpl:async(url,options)=>{
  urls.push(url);assert.equal(options.headers.Authorization,'Bearer test-meta');
  return response(urls.length===1?{data:[{id:1}],paging:{next:'https://untrusted.example/?access_token=secret',cursors:{after:'page2'}}}:{data:[{id:2}]});
 }});
 assert.equal((await client.meta('3','insights',{})).length,2);assert.ok(urls.every(x=>x.startsWith('https://graph.facebook.com/')));assert.ok(urls[1].includes('after=page2'));assert.ok(urls.every(x=>!x.includes('test-meta')));
});
test('upstream errors do not disclose credentials in status',async()=>{
 const client=makeClient(cfg,{fetchImpl:async()=>response({error:{code:190,message:'token=test-meta'}},401)});
 await assert.rejects(client.meta('3','',{}),error=>error instanceof SyncError&&!error.message.includes('test-meta')&&error.message.includes('401'));
});
function platformClient({currency='CNY',metaTotal=10}={}){return {
 ga4:async(start,end,dims)=>({metadata:{timeZone:'America/Los_Angeles',currencyCode:'USD'},rows:[{dimensionValues:[{value:start.replaceAll('-','')},{value:'Product'},...(dims.length===3?[{value:'private-order-id'}]:[])],metricValues:dims.length===3?[{value:'2'}]:[{value:'4'},{value:'100'}]}]}),
 google:async query=>query.includes('FROM customer')?[{customer:{currencyCode:currency,timeZone:'Asia/Shanghai'}}]:query.includes('shopping_performance_view')?[{segments:{date:day,productItemId:'sku',productTitle:'Product'},campaign:{advertisingChannelType:'SHOPPING'},metrics:{costMicros:'6800000'}}]:[{segments:{date:day},campaign:{name:'Campaign',advertisingChannelType:'SHOPPING'},metrics:{costMicros:'13600000'}}],
 meta:async(id,edge,params)=>!edge?{currency:'USD',timezone_name:'Asia/Shanghai'}:params.breakdowns?[{date_start:day,ad_id:'a',product_id:'sku, Product',spend:'6'}]:params.level==='account'?[{date_start:day,spend:String(metaTotal)}]:[{date_start:day,ad_id:'a',ad_name:'Ad',spend:'10'}]
};}
test('three sources retain order deduplication, FX and unallocated Meta spend',async()=>{
 const data=await collectReports(cfg,day,day,{client:platformClient()});
 assert.match(data.orders[0].transaction,/^[0-9a-f]{64}$/);assert.equal(JSON.stringify(data).includes('private-order-id'),false);
 const report=aggregate(data,day,day);assert.equal(report.summary.orders,1);assert.equal(report.summary.google,2);assert.equal(report.rows[0].google,1);assert.equal(report.rows[0].meta,6);assert.equal(report.nonCatalog[0].cost,4);assert.equal(data.sourceAudit[0].difference,0);
});
test('wrong currencies and inconsistent Meta totals stop the entire sync',async()=>{
 await assert.rejects(collectReports(cfg,day,day,{client:platformClient({currency:'USD'})}),/CNY/);
 await assert.rejects(collectReports(cfg,day,day,{client:platformClient({metaTotal:20})}),/未对齐/);
});
test('overlap replaces instead of duplicating; adjacent days extend; gaps/accounts rejected',()=>{
 const old=fixture();const updated=mergeReports(old,fixture(day,120));assert.equal(updated.ga4.length,1);assert.equal(updated.ga4[0].revenue,120);
 const extended=mergeReports(updated,fixture('2026-09-02'));assert.equal(extended.ga4.length,2);assert.deepEqual(extended.coverage,{start:day,end:'2026-09-02'});
 assert.throws(()=>mergeReports(old,fixture('2026-09-04')),/缺口/);
 const another=fixture();another.sources.ga4.property='99';assert.throws(()=>mergeReports(old,another),/账户/);
 assert.throws(()=>checkRange('2026-08-01','2026-09-01'),/31/);
});
test('failed job leaves previous report intact and persists safe error',async()=>temporary(async dir=>{
 const old=fixture();await saveReport(dir,old);
 const jobs=new SyncJobs(dir,{env,collect:async()=>{throw Error('private upstream test-secret');}});await jobs.initialize();jobs.start(day,day);await jobs.completion;
 assert.equal(jobs.job.status,'failed');assert.equal(jobs.job.message.includes('test-secret'),false);assert.deepEqual(await readReport(dir),old);
 const restarted=new SyncJobs(dir,{env});await restarted.initialize();assert.equal(restarted.job.status,'failed');
}));
test('successful job saves backup and prevents concurrent job starts',async()=>temporary(async dir=>{
 const old=fixture();await saveReport(dir,old);
 const jobs=new SyncJobs(dir,{env,collect:async()=>fixture(day,150)});await jobs.initialize();jobs.start(day,day);assert.throws(()=>jobs.start(day,day),/正在运行/);await jobs.completion;
 assert.equal(jobs.job.status,'succeeded');assert.equal((await readReport(dir)).ga4[0].revenue,150);assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir,'dashboard.previous.json'),'utf8')),old);
}));
test('cancelled job cannot publish partial data; interrupted jobs recover as failed',async()=>temporary(async dir=>{
 const old=fixture();await saveReport(dir,old);
 const jobs=new SyncJobs(dir,{env,collect:async()=>fixture(day,900)});await jobs.initialize();jobs.start(day,day);jobs.cancel();await jobs.completion;
 assert.equal(jobs.job.status,'failed');assert.deepEqual(await readReport(dir),old);
 await fs.writeFile(path.join(dir,'sync-status.json'),JSON.stringify({status:'running'}));const restarted=new SyncJobs(dir,{env});await restarted.initialize();assert.equal(restarted.job.status,'failed');assert.match(restarted.job.message,/重启/);
}));
