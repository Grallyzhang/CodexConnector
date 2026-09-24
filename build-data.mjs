import fs from 'node:fs';
import crypto from 'node:crypto';
import {normalize,keyOf,aggregate} from './dist/model.js';
import {familyMatch,ruleDiagnostics} from './family-rules.mjs';
const read=n=>JSON.parse(fs.readFileSync('data/'+n,'utf8'));
const money=s=>{const n=Number(String(s).replace(/[^0-9.\-]/g,''));if(!Number.isFinite(n))throw Error('Invalid amount');return n;};
const iso=s=>s.slice(0,4)+'-'+s.slice(4,6)+'-'+s.slice(6,8);
const raw=read('ga4-google.json');
for(const key of ['ga4Products','ga4Orders'])if(raw[key].rowCount!==raw[key].rows.length)throw Error('Incomplete GA4 report: '+key);
const ga4=raw.ga4Products.rows.map(r=>({date:iso(r.dimensionValues[0].value),title:r.dimensionValues[1].value,sessions:Number(r.metricValues[0].value),revenue:Number(r.metricValues[1].value)}));
const orders=raw.ga4Orders.rows.filter(r=>Number(r.metricValues[0].value)>0).map(r=>{const id=r.dimensionValues[2].value;return {date:iso(r.dimensionValues[0].value),title:r.dimensionValues[1].value,transaction:id&&id!=='(not set)'?crypto.createHash('sha256').update(id).digest('hex'):null};});
const gp=read('google-products.json');
const ads=gp.rows.map(([date,i,v])=>({date,platform:'google',account:'9347478419',id:gp.dictionary[i][0],title:gp.dictionary[i][1],type:gp.dictionary[i][2],cost:v/1e6}));
const totals=raw.googleCampaigns.results.map(r=>({date:r.segments.date,platform:'google',account:'9347478419',name:'Google Ads · Advanblack',type:r.campaign.advertisingChannelType,cost:Number(r.metrics.costMicros)/1e6,campaign:r.campaign.name}));
const creatives=fs.readdirSync('data').filter(f=>f.startsWith('creatives-')).flatMap(f=>read(f).ad_creatives);const creativeMap=new Map(creatives.map(c=>[c.id,c]));
const nonCatalog=[],titles=[...new Set(ga4.map(r=>r.title))];
const stop=new Set(['advanblack','harley','davidson','for','the','with','and','of','to','in','up','models','model','color','matched']);
const tokens=s=>new Set(String(s).toLowerCase().match(/[a-z0-9]+/g)?.filter(t=>t.length>1&&!stop.has(t))||[]);
const titleTokens=titles.map(title=>({title,t:tokens(title)}));
function suggest(input){const a=tokens(input);return titleTokens.map(({title,t})=>{let n=0;for(const v of a)if(t.has(v))n++;return {title,score:(2*n)/(a.size+t.size||1)};}).filter(r=>r.score>=.32).sort((a,b)=>b.score-a.score).slice(0,3).map(r=>({title:r.title,score:Math.round(r.score*100)}));}
const sourceAudit=[];
for(const account of ['222947167250427','844151987085048']){
 const all=read('meta-'+account+'.json'),adReport=read('meta-ads-'+account+'.json'),cat=read(account==='222947167250427'?'meta-allproducts-complete-'+account+'.json':'meta-allproducts-'+account+'.json');
 if(adReport.pagination?.next_cursor||cat.pagination?.next_cursor)throw Error('Incomplete Meta report: '+account);
 const adRows=JSON.parse(adReport.ad_entities),productRows=JSON.parse(cat.ad_entities),productByAdDay=new Map();
 for(const r of productRows){const k=r.date_start+'|'+r.id;productByAdDay.set(k,(productByAdDay.get(k)||0)+money(r.amount_spent));}
 const byDay=new Map();for(const r of adRows){const k=r.date_start;byDay.set(k,(byDay.get(k)||0)+money(r.amount_spent));const productCost=productByAdDay.get(k+'|'+r.id)||0,residual=money(r.amount_spent)-productCost;if(residual>0.005){const c=creativeMap.get(String(r.creative_id)),links=[...new Set([c?.link_url,...(c?.child_attachments||[]).map(x=>x.link)].filter(Boolean))];nonCatalog.push({date:r.date_start,account,id:r.id,name:r.name,cost:residual,adTotal:money(r.amount_spent),productCost,title:c?.title||'',links,candidates:suggest([r.name,c?.title,links.join(' ')].join(' ')),classification:'扣除已返回 Product ID 消耗后的未拆分余额'});}}
 for(const r of JSON.parse(all.account.ad_entities)){
  const total=money(r.amount_spent),adTotal=byDay.get(r.date_start)||0;sourceAudit.push({date:r.date_start,account,accountTotal:total,adTotal,difference:total-adTotal});
  const common={date:r.date_start,platform:'meta',account,name:account==='222947167250427'?'Meta · Advanblack-03':'Meta · Advanblack-04'};
  totals.push({...common,type:'META_ALL',cost:total});
 }
 for(const r of productRows){const p=String(r.product_id||''),comma=p.indexOf(', ');ads.push({date:r.date_start,platform:'meta',account,type:'META_PRODUCT',id:comma>=0?p.slice(0,comma):p,title:comma>=0?p.slice(comma+2):'',cost:money(r.amount_spent)});}
}
const candidates={},verifiedMappings={},mappingEvidence={},exact=new Set(titles.map(normalize));
for(const r of ads){const k=keyOf(r);if(!exact.has(normalize(r.title))){const m=familyMatch(r,titles);if(m){verifiedMappings[k]=m.title;mappingEvidence[k]={method:'型号归并（规则推断）',rule:m.rule,title:m.title};}else if(!candidates[k])candidates[k]=suggest(r.title);}}
const data={version:2,dataNote:'9 月 23 日 GA4 为洛杉矶当日暂定数据，尚未结束且可能补报。',updatedAt:new Date().toISOString(),coverage:{start:'2026-09-04',end:'2026-09-23'},fx:{cnyPerUsd:6.8,source:'用户指定固定核算汇率',method:'Google 人民币消耗 ÷ 6.8'},sources:{ga4:{property:'378788930',name:'advanblack - GA4',currency:'USD',timezone:raw.ga4Products.metadata.timeZone},google:{account:'9347478419',currency:'CNY',timezone:'Asia/Shanghai'},meta:{accounts:['222947167250427','844151987085048'],currency:'USD',timezone:'Asia/Shanghai'}},ga4,orders,ads,totals,nonCatalog,candidates,sourceAudit,verifiedMappings,mappingEvidence};
fs.writeFileSync('data/dashboard.json',JSON.stringify(data));const result=aggregate(data,data.coverage.start,data.coverage.end);
console.log(JSON.stringify({ga4Rows:ga4.length,products:result.rows.length,orders:orders.length,adRows:ads.length,summary:result.summary,accounts:result.accounts,unmatched:result.unmatched.length,maxMetaDailyDifference:Math.max(...sourceAudit.map(x=>Math.abs(x.difference)))},null,2));
console.log('Rule targets needing review:',JSON.stringify(ruleDiagnostics(titles)));
console.log('King:',JSON.stringify(result.rows.find(x=>/^Advanblack King Rear Tour Trunk Pack For/.test(x.title))));
