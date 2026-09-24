export const normalize=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/&amp;/g,'&').replace(/[^a-z0-9\u4e00-\u9fff]/g,'');
export const roi=(revenue,meta,google)=>meta+google>0?revenue/(meta+google):null;
export const keyOf=r=>`${r.platform}|${r.id}|${r.title}`;
export function dateValid(s){return /^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;}
export function aggregate(data,start,end,mappings={}){
 if(!dateValid(start)||!dateValid(end)||start>end)throw Error('请选择有效的起止日期。');
 if(start<data.coverage.start||end>data.coverage.end)throw Error(`此时间段尚未完整同步。本地已有 ${data.coverage.start} 至 ${data.coverage.end}，请先补充数据。`);
 const inside=r=>r.date>=start&&r.date<=end;
 const titles=[...new Set(data.ga4.map(r=>r.title))],exact=new Map();
 for(const title of titles){const k=normalize(title);if(!exact.has(k))exact.set(k,[]);exact.get(k).push(title);}
 const resolve=r=>{let t=mappings[keyOf(r)]||data.verifiedMappings?.[keyOf(r)];if(!t){const a=exact.get(normalize(r.title));if(r.title&&r.title!=='(not set)'&&a?.length===1)t=a[0];}return t&&titles.includes(t)?t:null;};
 const fx=data.fx?.cnyPerUsd||6.8;
 const rows=new Map();const init=title=>{if(!rows.has(title))rows.set(title,{title,sessions:0,revenue:0,orders:0,meta:0,pmax:0,shopping:0,google:0,orderIds:new Set(),adRows:0,familyRows:0});return rows.get(title);};
 for(const r of data.ga4.filter(inside)){const row=init(r.title);row.sessions+=r.sessions;row.revenue+=r.revenue;}
 const orderIds=new Set();let missingOrders=0;
 for(const r of data.orders.filter(inside)){if(!r.transaction){missingOrders++;continue;}init(r.title).orderIds.add(r.transaction);orderIds.add(r.transaction);}
 for(const r of rows.values())r.orders=r.orderIds.size;
 const unmatched=new Map(),matched={meta:0,pmax:0,shopping:0},details={meta:0,pmax:0,shopping:0};
 for(const r of data.ads.filter(inside)){
  const metric=r.platform==='meta'?'meta':r.type==='PERFORMANCE_MAX'?'pmax':'shopping';details[metric]+=r.cost;const title=resolve(r),key=keyOf(r);
  if(title){const row=init(title);row[metric]+=r.cost;if(r.platform==='google')row.google+=r.cost/fx;row.adRows++;if(data.mappingEvidence?.[key]&&!mappings[key])row.familyRows++;matched[metric]+=r.cost;}
  else{if(!unmatched.has(key))unmatched.set(key,{...r,key,cost:0,candidates:data.candidates?.[key]||[]});unmatched.get(key).cost+=r.cost;}
 }
 const totals=data.totals.filter(inside),accounts=new Map();
 for(const r of totals){const key=`${r.platform}|${r.account}`;if(!accounts.has(key))accounts.set(key,{key,platform:r.platform,name:r.name,currency:r.platform==='meta'?'USD':'CNY',total:0,eligible:0,detail:0,matched:0});const a=accounts.get(key);a.total+=r.cost;if(['META_ALL','PERFORMANCE_MAX','SHOPPING'].includes(r.type))a.eligible+=r.cost;}
 for(const r of data.ads.filter(inside)){const a=accounts.get(`${r.platform}|${r.account}`);if(a){a.detail+=r.cost;if(resolve(r))a.matched+=r.cost;}}
 const nonCatalog=new Map();for(const r of data.nonCatalog.filter(inside)){const key=`${r.account}|${r.id}`;if(!nonCatalog.has(key))nonCatalog.set(key,{...r,cost:0});nonCatalog.get(key).cost+=r.cost;}
 return {rows:[...rows.values()].map(({orderIds,...r})=>({...r,roi:roi(r.revenue,r.meta,r.google)})),unmatched:[...unmatched.values()],nonCatalog:[...nonCatalog.values()],accounts:[...accounts.values()],totals,matched,details,summary:{revenue:[...rows.values()].reduce((s,r)=>s+r.revenue,0),orders:orderIds.size,meta:totals.filter(r=>r.platform==='meta').reduce((s,r)=>s+r.cost,0),google:totals.filter(r=>r.platform==='google').reduce((s,r)=>s+r.cost/fx,0),missingOrders}};
}
export function csvCell(v){const s=String(v??'');return '"'+(/^[=+@\-\t\r]/.test(s)?"'"+s:s).replace(/"/g,'""')+'"';}
