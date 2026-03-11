export class SoundSystem {
  constructor(){
    this.enabled=true; this.ctx=null; this._init();
  }
  _init(){
    try{ this.ctx=new(window.AudioContext||window.webkitAudioContext)(); }catch(e){}
  }
  _resume(){ if(this.ctx&&this.ctx.state==='suspended')this.ctx.resume(); }
  _tone(freq,type,dur,vol=0.3,attack=0.01,decay=0.1){
    if(!this.enabled||!this.ctx)return;
    this._resume();
    const osc=this.ctx.createOscillator();
    const gain=this.ctx.createGain();
    osc.connect(gain); gain.connect(this.ctx.destination);
    osc.type=type; osc.frequency.setValueAtTime(freq,this.ctx.currentTime);
    gain.gain.setValueAtTime(0,this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(vol,this.ctx.currentTime+attack);
    gain.gain.exponentialRampToValueAtTime(0.001,this.ctx.currentTime+dur);
    osc.start(this.ctx.currentTime); osc.stop(this.ctx.currentTime+dur+0.05);
  }
  _noise(dur,vol=0.15){
    if(!this.enabled||!this.ctx)return;
    this._resume();
    const buf=this.ctx.createBuffer(1,this.ctx.sampleRate*dur,this.ctx.sampleRate);
    const d=buf.getChannelData(0);
    for(let i=0;i<d.length;i++)d[i]=(Math.random()*2-1);
    const src=this.ctx.createBufferSource();
    src.buffer=buf;
    const gain=this.ctx.createGain();
    const filter=this.ctx.createBiquadFilter();
    filter.type='bandpass'; filter.frequency.value=300;
    src.connect(filter); filter.connect(gain); gain.connect(this.ctx.destination);
    gain.gain.setValueAtTime(vol,this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001,this.ctx.currentTime+dur);
    src.start(); src.stop(this.ctx.currentTime+dur+0.05);
  }
  move(){ this._tone(520,'square',0.08,0.2,0.005,0.05); this._noise(0.05,0.08); }
  capture(){ this._tone(200,'sawtooth',0.15,0.2,0.005,0.1); this._noise(0.12,0.18); }
  check(){ this._tone(880,'square',0.12,0.15); setTimeout(()=>this._tone(1100,'square',0.1,0.12),80); }
  castle(){ this._tone(440,'sine',0.1,0.15); setTimeout(()=>this._tone(550,'sine',0.12,0.12),60); }
  start(){ for(let i=0;i<3;i++)setTimeout(()=>this._tone(440+i*110,'sine',0.1,0.1),i*80); }
  victory(){ const notes=[523,659,784,1047]; notes.forEach((n,i)=>setTimeout(()=>this._tone(n,'sine',0.3,0.2),i*100)); }
  illegal(){ this._tone(200,'square',0.08,0.1,0.002,0.05); }
}