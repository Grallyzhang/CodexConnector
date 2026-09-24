import crypto from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {dateValid,normalize,keyOf} from './dist/model.js';
import {familyMatch} from './family-rules.mjs';

export class SyncError extends Error {}
const fail=message=>{throw new SyncError(message);};
const required=['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GOOGLE_REFRESH_TOKEN','META_ACCESS_TOKEN'];
export function configuration(env=process.env){
 const cfg={property:env.GA4_PROPERTY_ID||'378788930',customer:(env.GOOGLE_ADS_CUSTOMER_ID||'9347478419').replaceAll('-',''),accounts:(env.META_AD_ACCOUNT_IDS||'222947167250427,844151987085048').split(',').map(x=>x.trim().replace(/^act_/,'')),googleVersion:env.GOOGLE_ADS_API_VERSION||'v25',metaVersion:env.META_API_VERSION||'v26.0',env};
 cfg.missing=required.filter(k=>!env[k]?.trim());
 cfg.errors=[];
 if(!/^\d+$/.test(cfg.property)||!/^\d+$/.test(cfg.customer)||!cfg.accounts.length||cfg.accounts.some(x=>!/^\d+$/.test(x))||new Set(cfg.accounts).size!==cfg.accounts.length)cfg.errors.push('账户编号必须是数字，Meta 账户不能重复。');
 if(!/^v\d+$/.test(cfg.googleVersion)||!/^v\d+\.\d+$/.test(cfg.metaVersion))cfg.errors.push('API 版本格式无效。');
 if(env.GOOGLE_ADS_LOGIN_CUSTOMER_ID&&!/^\d+$/.test(env.GOOGLE_ADS_LOGIN_CUSTOMER_ID.replaceAll('-','')))cfg.errors.push('Google 管理员账户编号无效。');
 return cfg;
}
export function publicConfiguration(cfg){return {ready:!cfg.missing.length&&!cfg.errors.length,missing:cfg.missing,errors:cfg.errors};}
const nextDay=date=>new Date(Date.parse(date+'T00:00:00Z')+86400000).toISOString().slice(0,10);
export function checkRange(start,end,old){
 if(!dateValid(start)||!dateValid(end)||start>end)fail('请选择有效的起止日期。');
 if((Date.parse(end)-Date.parse(start))/86400000>=31)fail('每次最多同步 31 天，请分批补齐历史数据。');
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 if(end>today)fail('结束日期不能晚于洛杉矶今天。');
 if(old&&(start>nextDay(old.coverage.end)||nextDay(end)<old.coverage.start))fail('同步日期必须与已有日期重叠或相邻，请先补齐中间日期。');
}
const number=value=>{if(value==null||value===''||!Number.isFinite(Number(value)))fail('平台返回了无效数值，旧报表保持不变。');return Number(value);};
const iso=value=>{if(!/^\d{8}$/.test(value||''))fail('GA4 返回日期无效。');return value.slice(0,4)+'-'+value.slice(4,6)+'-'+value.slice(6);};
export function makeClient(cfg,{fetchImpl=fetch,signal,onProgress=()=>{}}={}){
 let token,expires=0;
 async function request(url,options={},label='平台'){
  for(let attempt=0;attempt<3;attempt++){
   signal?.throwIfAborted();let response,body;
   try{response=await fetchImpl(url,{...options,redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(60000)]):AbortSignal.timeout(60000)});body=await response.json();}
   catch{if(signal?.aborted)fail('同步已取消或超过 30 分钟，请缩小日期范围后重试。');if(attempt<2){await sleep(1000*2**attempt,undefined,{signal});continue;}fail(label+' 网络请求失败或超时，请重试。');}
   if(response.ok&&!body.error)return body;
   const code=body.error?.code;
   if(attempt<2&&(response.status===429||response.status>=500||[1,2,4,17,32,613].includes(code))){onProgress(label+' 请求受限，正在重试…');await sleep(1000*2**attempt,undefined,{signal});continue;}
   // Never expose response text or request URLs: upstream errors can contain credentials.
   const suffix=response.status===401||response.status===403||code===190?'请检查令牌有效期、授权范围及账户访问权限。':'请检查 API 版本、账户权限和查询范围，或缩小到一天后重试。';
   fail(`${label} 请求失败（HTTP ${response.status}${Number.isInteger(code)?' / '+code:''}）。${suffix}`);
  }
 }
 async function googleToken(){
  if(token&&Date.now()<expires)return token;
  const body=await request('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',client_id:cfg.env.GOOGLE_CLIENT_ID,client_secret:cfg.env.GOOGLE_CLIENT_SECRET,refresh_token:cfg.env.GOOGLE_REFRESH_TOKEN})},'Google 授权');
  if(!body.access_token)fail('Google 授权未返回访问令牌。');token=body.access_token;expires=Date.now()+Math.max(0,Number(body.expires_in||3600)-120)*1000;return token;
 }
 async function ga4(start,end,dimensions,metrics){
  const rows=[];let expected,metadata;
  for(let page=0;page<1000;page++){
   const body=await request(`https://analyticsdata.googleapis.com/v1beta/properties/${cfg.property}:runReport`,{method:'POST',headers:{Authorization:'Bearer '+await googleToken(),'Content-Type':'application/json'},body:JSON.stringify({dateRanges:[{startDate:start,endDate:end}],dimensions:dimensions.map(name=>({name})),metrics:metrics.map(name=>({name})),currencyCode:'USD',orderBys:dimensions.map(dimensionName=>({dimension:{dimensionName}})),limit:'100000',offset:String(rows.length)})},'GA4');
   const count=Number(body.rowCount||0);
   if(expected!==undefined&&count!==expected)fail('GA4 分页期间数据变化，请重试。');expected=count;metadata=body.metadata||{};
   if(metadata.dataLossFromOtherRow||metadata.subjectToThresholding||metadata.samplingMetadatas?.some(x=>Number(x.samplesReadCount)<Number(x.samplingSpaceSize)))fail('GA4 报表存在阈值、采样或数据截断，请缩小日期范围。');
   const batch=body.rows||[];rows.push(...batch);
   if(rows.length===expected)return {rows,metadata};
   if(!batch.length||rows.length>expected)fail('GA4 分页不完整，请重试。');
  }fail('GA4 分页超过安全上限，请缩小日期范围。');
 }
 async function google(query){
  const rows=[],seen=new Set();let pageToken;
  do{
   const headers={Authorization:'Bearer '+await googleToken(),'Content-Type':'application/json'};
   if(cfg.env.GOOGLE_ADS_DEVELOPER_TOKEN)headers['developer-token']=cfg.env.GOOGLE_ADS_DEVELOPER_TOKEN;
   if(cfg.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID)headers['login-customer-id']=cfg.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID.replaceAll('-','');
   const body=await request(`https://googleads.googleapis.com/${cfg.googleVersion}/customers/${cfg.customer}/googleAds:search`,{method:'POST',headers,body:JSON.stringify({query,...(pageToken?{pageToken}:{})})},'Google Ads');
   if(body.results&&!Array.isArray(body.results))fail('Google Ads 返回格式无效。');rows.push(...(body.results||[]));pageToken=body.nextPageToken;
   if(pageToken){if(seen.has(pageToken)||seen.size>=1000)fail('Google Ads 分页异常。');seen.add(pageToken);}
  }while(pageToken);return rows;
 }
 async function meta(account,edge,params){
  const base=`https://graph.facebook.com/${cfg.metaVersion}/act_${account}${edge?'/'+edge:''}`;
  const url=new URL(base);for(const [key,value]of Object.entries(params))url.searchParams.set(key,String(value));
  if(cfg.env.META_APP_SECRET)url.searchParams.set('appsecret_proof',crypto.createHmac('sha256',cfg.env.META_APP_SECRET).update(cfg.env.META_ACCESS_TOKEN).digest('hex'));
  const rows=[],seen=new Set();let after;
  do{
   if(after)url.searchParams.set('after',after);
   const body=await request(url.toString(),{headers:{Authorization:'Bearer '+cfg.env.META_ACCESS_TOKEN}},'Meta');
   if(!edge)return body;
   if(!Array.isArray(body.data))fail('Meta 返回格式无效。');rows.push(...body.data);
   if(!body.paging?.next)return rows;
   after=body.paging.cursors?.after;
   if(!after||seen.has(after)||seen.size>=10000)fail('Meta 分页异常。');seen.add(after);
  }while(after);return rows;
 }
 return {ga4,google,meta};
}
export function rebuildMappings(data){
 const titles=[...new Set(data.ga4.map(r=>r.title))],exact=new Set(titles.map(normalize));
 const stop=new Set(['advanblack','harley','davidson','for','the','with','and','of','to','in','up','models','model','color','matched']);
 const tokens=s=>new Set(String(s).toLowerCase().match(/[a-z0-9]+/g)?.filter(t=>t.length>1&&!stop.has(t))||[]);
 const indexed=titles.map(title=>({title,t:tokens(title)}));
 const suggest=input=>{const a=tokens(input);return indexed.map(({title,t})=>{let n=0;for(const value of a)if(t.has(value))n++;return {title,score:2*n/(a.size+t.size||1)};}).filter(r=>r.score>=.32).sort((a,b)=>b.score-a.score).slice(0,3).map(r=>({title:r.title,score:Math.round(r.score*100)}));};
 data.candidates={};data.verifiedMappings={};data.mappingEvidence={};
 for(const row of data.ads){if(exact.has(normalize(row.title)))continue;const match=familyMatch(row,titles);if(match){const key=keyOf(row);data.verifiedMappings[key]=match.title;data.mappingEvidence[key]={method:'型号归并（规则推断）',rule:match.rule,title:match.title};}else if(!data.candidates[keyOf(row)])data.candidates[keyOf(row)]=suggest(row.title);}
 for(const row of data.nonCatalog)row.candidates=suggest([row.name,row.title,...(row.links||[])].join(' '));
 return data;
}
export function mergeReports(old,fresh){
 if(!old)return rebuildMappings(fresh);
 if(old.sources.ga4.property!==fresh.sources.ga4.property||old.sources.google.account!==fresh.sources.google.account||JSON.stringify([...old.sources.meta.accounts].sort())!==JSON.stringify([...fresh.sources.meta.accounts].sort()))fail('平台账户与已有报表不同，不能合并。请为新账户使用独立的数据目录。');
 if(old.fx.cnyPerUsd!==fresh.fx.cnyPerUsd||['ga4','google','meta'].some(k=>old.sources[k].currency!==fresh.sources[k].currency||old.sources[k].timezone!==fresh.sources[k].timezone))fail('新旧报表的币种、时区或汇率不同，不能合并。');
 const {start,end}=fresh.coverage;
 if(start>nextDay(old.coverage.end)||nextDay(end)<old.coverage.start)fail('不能合并中间有缺口的日期范围。');
 const merged={...fresh,coverage:{start:old.coverage.start<start?old.coverage.start:start,end:old.coverage.end>end?old.coverage.end:end}};
 for(const key of ['ga4','orders','ads','totals','nonCatalog','sourceAudit'])merged[key]=[...old[key].filter(row=>row.date<start||row.date>end),...fresh[key]];
 return rebuildMappings(merged);
}
export async function collectReports(cfg,start,end,{client=makeClient(cfg),onProgress=()=>{},signal}={}){
 const data={version:2,updatedAt:new Date().toISOString(),coverage:{start,end},fx:{cnyPerUsd:6.8,source:'用户指定固定核算汇率',method:'Google 人民币消耗 ÷ 6.8'},sources:{ga4:{property:cfg.property,name:'advanblack - GA4',currency:'USD',timezone:'America/Los_Angeles'},google:{account:cfg.customer,currency:'CNY',timezone:'Asia/Shanghai'},meta:{accounts:cfg.accounts,currency:'USD',timezone:'Asia/Shanghai'}},ga4:[],orders:[],ads:[],totals:[],nonCatalog:[],sourceAudit:[],dataNote:'平台近期数据可能补报；可再次同步同一日期更新。Meta 商品明细按平台返回范围统计，未拆分余额保留待归因。'};
 onProgress('核对 Google Ads 账户币种与时区…');
 const account=(await client.google('SELECT customer.currency_code, customer.time_zone FROM customer LIMIT 1'))[0]?.customer;
 if(account?.currencyCode!=='CNY'||account?.timeZone!=='Asia/Shanghai')fail('当前口径要求 Google Ads 为 CNY、Asia/Shanghai；账户配置不符，已停止同步。');
 for(const id of cfg.accounts){const info=await client.meta(id,'',{fields:'currency,timezone_name'});if(info.currency!=='USD'||info.timezone_name!=='Asia/Shanghai')fail('当前口径要求 Meta 为 USD、Asia/Shanghai；账户配置不符，已停止同步。');}
 let dayIndex=0;const dayCount=1+(Date.parse(end)-Date.parse(start))/86400000;
 for(let day=start;day<=end;day=nextDay(day)){
  signal?.throwIfAborted();dayIndex++;
  onProgress(`${dayIndex}/${dayCount} 天 · ${day} · GA4 商品与订单`);
  const products=await client.ga4(day,day,['date','itemName'],['sessions','itemRevenue']);
  const orders=await client.ga4(day,day,['date','itemName','transactionId'],['itemsPurchased']);
  if(products.metadata.timeZone!=='America/Los_Angeles'||orders.metadata.timeZone!=='America/Los_Angeles'||products.metadata.currencyCode!=='USD')fail('GA4 时区或币种与当前口径不符，已停止同步。');
  for(const row of products.rows)data.ga4.push({date:iso(row.dimensionValues[0].value),title:row.dimensionValues[1].value,sessions:number(row.metricValues[0].value),revenue:number(row.metricValues[1].value)});
  for(const row of orders.rows){if(number(row.metricValues[0].value)<=0)continue;const id=row.dimensionValues[2].value;data.orders.push({date:iso(row.dimensionValues[0].value),title:row.dimensionValues[1].value,transaction:id&&id!=='(not set)'?crypto.createHash('sha256').update(id).digest('hex'):null});}
  onProgress(`${dayIndex}/${dayCount} 天 · ${day} · Google Ads`);
  const campaigns=await client.google(`SELECT segments.date, campaign.name, campaign.advertising_channel_type, metrics.cost_micros FROM campaign WHERE segments.date = '${day}'`);
  for(const row of campaigns)data.totals.push({date:row.segments.date,platform:'google',account:cfg.customer,name:'Google Ads · Advanblack',type:row.campaign.advertisingChannelType,campaign:row.campaign.name,cost:number(row.metrics?.costMicros??0)/1e6});
  const shopping=await client.google(`SELECT segments.date, segments.product_item_id, segments.product_title, campaign.advertising_channel_type, metrics.cost_micros FROM shopping_performance_view WHERE segments.date = '${day}' AND campaign.advertising_channel_type IN ('PERFORMANCE_MAX', 'SHOPPING')`);
  for(const row of shopping)data.ads.push({date:row.segments.date,platform:'google',account:cfg.customer,id:row.segments.productItemId||'',title:row.segments.productTitle||'',type:row.campaign.advertisingChannelType,cost:number(row.metrics?.costMicros??0)/1e6});
  for(const id of cfg.accounts){
   onProgress(`${dayIndex}/${dayCount} 天 · ${day} · Meta ${id}`);
   const params={time_range:JSON.stringify({since:day,until:day}),time_increment:'1',limit:'1000'};
   const totals=await client.meta(id,'insights',{...params,level:'account',fields:'date_start,spend'});
   const ads=await client.meta(id,'insights',{...params,level:'ad',fields:'date_start,ad_id,ad_name,spend'});
   const products=await client.meta(id,'insights',{...params,level:'ad',fields:'date_start,ad_id,spend',breakdowns:'product_id',product_id_limit:'10000'});
   const productCosts=new Map(),counts=new Map();
   for(const row of products){const count=(counts.get(row.ad_id)||0)+1;counts.set(row.ad_id,count);if(count>=10000)fail('Meta 单广告商品数达到返回上限，请检查报表完整性。');const cost=number(row.spend);productCosts.set(row.ad_id,(productCosts.get(row.ad_id)||0)+cost);const text=String(row.product_id||''),comma=text.indexOf(',');data.ads.push({date:row.date_start,platform:'meta',account:id,type:'META_PRODUCT',id:comma>=0?text.slice(0,comma):text,title:comma>=0?text.slice(comma+1).trim():'',cost});}
   let adTotal=0;const ids=new Set();
   for(const row of ads){const cost=number(row.spend),productCost=productCosts.get(row.ad_id)||0;ids.add(row.ad_id);adTotal+=cost;if(productCost>cost+.1)fail('Meta 商品消耗超过广告消耗，已保留旧报表，请稍后重试。');if(cost-productCost>.005)data.nonCatalog.push({date:row.date_start,account:id,id:row.ad_id,name:row.ad_name||'',cost:cost-productCost,adTotal:cost,productCost,title:'',links:[],candidates:[],classification:'扣除已返回 Product ID 消耗后的未拆分余额'});}
   for(const id of productCosts.keys())if(!ids.has(id))fail('Meta 商品明细缺少对应广告，已停止同步。');
   const accountTotal=totals.reduce((sum,row)=>sum+number(row.spend),0);
   if(Math.abs(accountTotal-adTotal)>.1)fail('Meta 账户与广告消耗未对齐，请稍后重试。');
   data.sourceAudit.push({date:day,account:id,accountTotal,adTotal,difference:accountTotal-adTotal});
   data.totals.push({date:day,platform:'meta',account:id,name:'Meta · '+id,type:'META_ALL',cost:accountTotal});
  }
 }
 const googleTotal=data.totals.filter(r=>r.platform==='google'&&['PERFORMANCE_MAX','SHOPPING'].includes(r.type)).reduce((s,r)=>s+r.cost,0);
 if(data.ads.filter(r=>r.platform==='google').reduce((s,r)=>s+r.cost,0)>googleTotal+.1)fail('Google 商品消耗超过对应系列消耗，请重试。');
 return rebuildMappings(data);
}
