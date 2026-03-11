export class S3Logger {
  log(msg,type=''){
    const el=document.getElementById('s3Log');
    const entry=document.createElement('div');
    entry.className=`log-entry ${type}`;
    const ts=new Date().toLocaleTimeString();
    entry.innerHTML=`<span class="log-ts">${ts}</span>${msg}`;
    el.appendChild(entry); el.scrollTop=el.scrollHeight;
    if(type==='ok'){ const s3=document.getElementById('s3Indicator'); s3.classList.add('live'); document.getElementById('s3Label').textContent='S3 ✓'; }
  }
}