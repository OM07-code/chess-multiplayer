export class ParticleSystem {
  constructor(canvas){
    this.canvas=canvas; this.ctx=canvas.getContext('2d');
    this.particles=[]; this.enabled=true;
    this.resize(); window.addEventListener('resize',()=>this.resize());
    this._loop();
  }
  resize(){ this.canvas.width=window.innerWidth; this.canvas.height=window.innerHeight; }
  _loop(){
    requestAnimationFrame(()=>this._loop());
    if(!this.enabled||!this.particles.length){ this.ctx.clearRect(0,0,this.canvas.width,this.canvas.height); return; }
    this.ctx.clearRect(0,0,this.canvas.width,this.canvas.height);
    this.particles=this.particles.filter(p=>{
      p.x+=p.vx; p.y+=p.vy; p.vy+=p.gravity; p.life-=p.decay;
      if(p.life<=0)return false;
      this.ctx.save();
      this.ctx.globalAlpha=Math.max(0,p.life);
      this.ctx.fillStyle=p.color;
      this.ctx.beginPath();
      this.ctx.arc(p.x,p.y,p.size*p.life,0,Math.PI*2);
      this.ctx.fill();
      this.ctx.restore();
      return true;
    });
  }
  burst(x,y,color='#c9a84c',count=18){
    if(!this.enabled)return;
    for(let i=0;i<count;i++){
      const angle=(Math.PI*2/count)*i+Math.random()*0.5;
      const speed=2+Math.random()*4;
      this.particles.push({x,y,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed-2,
        gravity:0.15,life:1,decay:0.025+Math.random()*0.02,size:3+Math.random()*3,color});
    }
  }
  confetti(x,y){
    if(!this.enabled)return;
    const colors=['#c9a84c','#f0c96a','#4a8fe8','#3ecf8e','#e05252','#ffffff'];
    for(let i=0;i<40;i++){
      const c=colors[Math.floor(Math.random()*colors.length)];
      this.particles.push({x:x+(Math.random()-0.5)*60,y:y-(Math.random()*30),
        vx:(Math.random()-0.5)*6,vy:-3-Math.random()*4,
        gravity:0.12,life:1,decay:0.012,size:4+Math.random()*4,color:c});
    }
  }
}