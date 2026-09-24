import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {aggregate,dateValid} from './dist/model.js';
export function validate(data){
 if(data?.version!==2||!dateValid(data.coverage?.start)||!dateValid(data.coverage?.end)||data.coverage.start>data.coverage.end)throw Error('Invalid coverage/version');
 for(const key of ['ga4','orders','ads','totals','nonCatalog','sourceAudit'])if(!Array.isArray(data[key]))throw Error('Invalid '+key);
 if(!data.sources?.ga4||!data.sources?.google||!data.sources?.meta||!Number.isFinite(data.fx?.cnyPerUsd)||data.fx.cnyPerUsd<=0||!Number.isFinite(Date.parse(data.updatedAt)))throw Error('Invalid metadata');
 for(const key of ['ga4','orders','ads','totals','nonCatalog','sourceAudit'])for(const row of data[key])if(!row||!dateValid(row.date)||row.date<data.coverage.start||row.date>data.coverage.end)throw Error('Invalid row date');
 for(const row of data.ga4)if(typeof row.title!=='string'||!Number.isFinite(row.sessions)||!Number.isFinite(row.revenue))throw Error('Invalid GA4 row');
 for(const row of [...data.ads,...data.totals,...data.nonCatalog])if(!Number.isFinite(row.cost))throw Error('Invalid cost');
 aggregate(data,data.coverage.start,data.coverage.end);
}
export async function readReport(directory){try{return JSON.parse(await fs.readFile(path.join(directory,'dashboard.json'),'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
export async function saveReport(directory,data){
 validate(data);const temp=path.join(directory,'dashboard-'+crypto.randomUUID()+'.tmp');
 try{
  await fs.writeFile(temp,JSON.stringify(data),{mode:0o600});
  try{await fs.copyFile(path.join(directory,'dashboard.json'),path.join(directory,'dashboard.previous.json'));}catch(e){if(e.code!=='ENOENT')throw e;}
  await fs.rename(temp,path.join(directory,'dashboard.json'));
 }finally{await fs.rm(temp,{force:true});}
}
