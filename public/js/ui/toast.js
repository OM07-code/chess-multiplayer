export class ToastSystem {
  show(msg, type='info', dur=3000){
    const icons={info:'♟',success:'✓',error:'✗',warning:'⚠'};
    const el=document.createElement('div');
    el.className=`toast ${type}`;
    el.innerHTML=`<span class="toast-icon">${icons[type]||'♟'}</span> ${msg}`;
    document.getElementById('toastContainer').appendChild(el);
    setTimeout(()=>{ el.classList.add('out'); setTimeout(()=>el.remove(),300); },dur);
  }
}