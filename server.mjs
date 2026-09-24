import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {validate,saveReport} from './data-store.mjs';
import {SyncJobs} from './sync-jobs.mjs';
import {SyncError} from './sync.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const port=Number(process.env.PORT||4318);
const host=process.env.HOST||(process.env.NODE_ENV==='production'?'0.0.0.0':'127.0.0.1');
const password=process.env.DASHBOARD_PASSWORD||'';
const username=process.env.DASHBOARD_USERNAME||'admin';
if((process.env.NODE_ENV==='production'||!['127.0.0.1','localhost','::1'].includes(host))&&password.length<16)throw Error('Set DASHBOARD_PASSWORD to at least 16 characters before public deployment.');
const dataDir=path.resolve(process.env.DATA_DIR||path.join(root,'data'));
await fs.mkdir(dataDir,{recursive:true});
const jobs=new SyncJobs(dataDir);
await jobs.initialize();
const digest=s=>crypto.createHash('sha256').update(s).digest();
let importing=false;
const server=http.createServer(async(req,res)=>{
 res.setHeader('Cache-Control','no-store');
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self'; img-src 'self' data:; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
 const json=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body));};
 try{
  const url=new URL(req.url,'http://localhost');
  if(req.method==='GET'&&url.pathname==='/health')return json(200,{service:'advanblack-local-dashboard'});
  if(password){
   const expected='Basic '+Buffer.from(username+':'+password).toString('base64');
   if(!crypto.timingSafeEqual(digest(req.headers.authorization||''),digest(expected))){res.setHeader('WWW-Authenticate','Basic realm="Dashboard", charset="UTF-8"');return json(401,{error:'请登录看板。'});}
  }else if(!['127.0.0.1:'+port,'localhost:'+port,'[::1]:'+port].includes(req.headers.host))return json(403,{error:'Host forbidden'});
  if(req.method==='GET'&&url.pathname==='/api/sync')return json(200,jobs.status());
  if(req.method==='POST'&&url.pathname==='/api/sync'){
   if(req.headers['x-dashboard-request']!=='sync'||req.headers['content-type']!=='application/json')return json(403,{error:'请通过看板同步。'});
   const chunks=[];let size=0;
   for await(const chunk of req){size+=chunk.length;if(size>4096)return json(413,{error:'请求过大。'});chunks.push(chunk);}
   if(importing||jobs.running)return json(409,{error:'已有导入或同步任务，请等待完成。'});
   let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return json(400,{error:'请求格式无效。'});}
   try{const job=jobs.start(input?.start,input?.end);return json(202,{job});}catch(e){if(e instanceof SyncError)return json(400,{error:e.message});throw e;}
  }
  if(req.method==='POST'&&url.pathname==='/api/sync/cancel'){
   if(req.headers['x-dashboard-request']!=='sync')return json(403,{error:'请通过看板操作。'});
   jobs.cancel();return json(200,{ok:true});
  }
  if(req.method==='POST'&&url.pathname==='/api/import'){

   if(req.headers['x-dashboard-request']!=='import'||req.headers['content-type']!=='application/json')return json(403,{error:'请通过看板导入。'});
   if(importing||jobs.running)return json(409,{error:'正在保存或同步报表，请稍后重试。'});
   importing=true;
   try{
    const chunks=[];let size=0;
    for await(const chunk of req){size+=chunk.length;if(size>50*1024*1024){json(413,{error:'文件不能超过 50 MB。'});req.resume();return;}chunks.push(chunk);}
    let data;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));validate(data);}catch{return json(400,{error:'报表格式无效，请选择本项目生成的 dashboard.json。'});}
    await saveReport(dataDir,data);
    return json(200,{ok:true,coverage:data.coverage});
   }finally{importing=false;}
  }
  if(req.method!=='GET')return json(405,{error:'Method not allowed'});
  const files={'/':'dist/index.html','/app.js':'dist/app.js','/style.css':'dist/style.css','/model.js':'dist/model.js','/import.js':'dist/import.js','/sync-ui.js':'dist/sync-ui.js'};
  const file=url.pathname==='/data.json'?path.join(dataDir,'dashboard.json'):files[url.pathname]?path.join(root,files[url.pathname]):null;
  if(!file)return json(404,{error:'Not found'});
  let content;try{content=await fs.readFile(file);}catch(e){if(e.code==='ENOENT')return json(404,{error:'尚无报表，请配置平台授权后同步数据，或使用“导入报表”上传 dashboard.json。'});throw e;}
  res.writeHead(200,{'Content-Type':file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':file.endsWith('.js')?'text/javascript; charset=utf-8':'application/json; charset=utf-8'});res.end(content);
 }catch(e){console.error('Request failed:',e.code||e.name);if(!res.headersSent)json(500,{error:'保存或读取失败，请检查服务器存储。'});else res.end();}
});
server.listen(port,host,()=>console.log(`Dashboard listening on ${host}:${port}`));
