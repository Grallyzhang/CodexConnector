const input=document.getElementById('reportFile');
const button=document.getElementById('importReport');
button.onclick=()=>input.click();
input.onchange=async()=>{
 const file=input.files[0];if(!file)return;
 if(!confirm('导入将替换服务器上的整份报表，上一版会自动备份。继续？')){input.value='';return;}
 button.disabled=true;
 try{
  if(file.size>50*1024*1024)throw Error('文件不能超过 50 MB。');
  const response=await fetch('/api/import',{method:'POST',headers:{'Content-Type':'application/json','X-Dashboard-Request':'import'},body:await file.text()});
  const result=await response.json();if(!response.ok)throw Error(result.error||'导入失败');
  document.getElementById('reload').click();
 }catch(e){document.getElementById('notice').textContent=e.message;}
 finally{button.disabled=false;input.value='';}
};
