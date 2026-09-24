import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {configuration,publicConfiguration,checkRange,SyncError,collectReports,makeClient,mergeReports} from './sync.mjs';
import {readReport,saveReport} from './data-store.mjs';
export class SyncJobs{
 constructor(directory,{env=process.env,collect=collectReports,fetchImpl=fetch}={}){this.directory=directory;this.cfg=configuration(env);this.collect=collect;this.fetchImpl=fetchImpl;this.job={status:'idle'};this.running=false;}
 async initialize(){
  try{this.job=JSON.parse(await fs.readFile(path.join(this.directory,'sync-status.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')this.job={status:'failed',message:'上次同步状态无法读取，可重新发起同步。'};}
  if(this.job.status==='running'){this.job={...this.job,status:'failed',finishedAt:new Date().toISOString(),message:'服务重启，上次任务已中断；请重新同步该日期范围。'};await this.persist();}
 }
 status(){return {configuration:publicConfiguration(this.cfg),job:this.job};}
 async persist(){const target=path.join(this.directory,'sync-status.json');await fs.writeFile(target+'.tmp',JSON.stringify(this.job),{mode:0o600});await fs.rename(target+'.tmp',target);}
 start(start,end){
  if(this.running)throw new SyncError('已有同步任务正在运行。');
  const config=publicConfiguration(this.cfg);
  if(!config.ready)throw new SyncError('请先配置页面列出的环境变量，并修正配置错误。');
  checkRange(start,end);
  this.running=true;this.controller=new AbortController();
  this.job={id:crypto.randomUUID(),status:'running',start,end,startedAt:new Date().toISOString(),message:'正在准备同步…'};
  this.completion=this.run(start,end);return this.job;
 }
 async run(start,end){
  const timer=setTimeout(()=>this.controller.abort(),30*60*1000);timer.unref();
  try{
   await this.persist();
   const old=await readReport(this.directory);checkRange(start,end,old);
   const onProgress=message=>{this.job.message=message;};
   const signal=this.controller.signal;
   const fresh=await this.collect(this.cfg,start,end,{client:makeClient(this.cfg,{fetchImpl:this.fetchImpl,signal,onProgress}),onProgress,signal});
   signal.throwIfAborted();
   const merged=mergeReports(old,fresh);
   this.job.message='正在校验并保存报表…';
   await saveReport(this.directory,merged);
   this.job={...this.job,status:'succeeded',finishedAt:new Date().toISOString(),message:'同步完成，所选日期已更新，其他历史日期已保留。',coverage:merged.coverage};
  }catch(e){this.job={...this.job,status:'failed',finishedAt:new Date().toISOString(),message:e instanceof SyncError?e.message:this.controller.signal.aborted?'同步已取消或超时，原报表未被替换。':'同步或保存失败，原报表未被替换。请检查存储空间、平台返回格式及账户配置。'};}
  finally{
   clearTimeout(timer);
   try{await this.persist();}catch{this.job.message+=' 同步状态未能写入磁盘，请检查持久化存储。';}
   this.running=false;
  }
 }
 cancel(){if(this.running)this.controller.abort();}
}
