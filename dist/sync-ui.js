const $=id=>document.getElementById(id);
let timer,active=false,seenCompleted;
async function request(url,options){const response=await fetch(url,options);const body=await response.json();if(!response.ok)throw Error(body.error||'请求失败');return body;}
function show(status){
 const {configuration,job}=status;active=job.status==='running';
 $('syncNow').disabled=!configuration.ready||active;
 $('cancelSync').hidden=!active;
 $('importReport').disabled=active;
 $('syncConfig').textContent=configuration.ready?'平台授权参数已配置；实际连接和权限将在同步时校验。':`请在 Zeabur 配置：${configuration.missing.join('、')}${configuration.errors.length?'。'+configuration.errors.join(' '):''}`;
 $('syncProgress').textContent=job.message||'选择日期后点击“同步平台数据”。单次最多 31 天。';
 if(job.status==='succeeded'&&seenCompleted!==job.id){if(seenCompleted!==undefined||job.id===sessionStorage.getItem('dashboard-active-sync'))$('reload').click();seenCompleted=job.id;sessionStorage.removeItem('dashboard-active-sync');}
 clearTimeout(timer);timer=setTimeout(poll,active?2000:15000);
}
async function poll(){try{show(await request('/api/sync'));}catch(e){$('syncProgress').textContent='同步状态读取失败：'+e.message;clearTimeout(timer);timer=setTimeout(poll,5000);}}
$('syncNow').onclick=async()=>{
 $('syncNow').disabled=true;
 try{const body=await request('/api/sync',{method:'POST',headers:{'Content-Type':'application/json','X-Dashboard-Request':'sync'},body:JSON.stringify({start:$('start').value,end:$('end').value})});sessionStorage.setItem('dashboard-active-sync',body.job.id);await poll();}
 catch(e){$('syncProgress').textContent=e.message;$('syncNow').disabled=false;}
};
$('cancelSync').onclick=async()=>{try{await request('/api/sync/cancel',{method:'POST',headers:{'X-Dashboard-Request':'sync'}});$('syncProgress').textContent='正在取消，请稍候…';}catch(e){$('syncProgress').textContent=e.message;}};
poll();
