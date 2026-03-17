import { PIECES } from './constants.js';
import { Chess } from './core/engine.js';
import { ChessAI } from './core/ai.js';
import { SoundSystem } from './systems/audio.js';
import { ParticleSystem } from './systems/particles.js';
import { APIService } from './systems/api.js';
import { BoardRenderer } from './ui/renderer.js';
import { DragDrop } from './ui/dragdrop.js';
import { ToastSystem } from './ui/toast.js';
import { S3Logger } from './ui/logger.js';

const App = {
  game: new Chess(),
  ai: new ChessAI(2),
  sound: new SoundSystem(),
  particles: null,
  toast: new ToastSystem(),
  s3log: new S3Logger(),
  api: new APIService(),
  renderer: null,
  dnd: null,

  mode: 'ai',
  playerColor: 'w',
  aiColor: 'b',
  myColor: null,
  gameActive: false,
  clocks: {w:600,b:600},
  clockBase: 600,
  clockInterval: null,
  selectedSq: null,
  legalMoves: [],
  pendingPromo: null,
  boardLocked: false,
  socket: null,
  roomId: null,
  replayMode: false,
  replayIdx: 0,
  replayPlaying: false,
  replayTimer: null,
  _fullHistory: [], // BUG-04 FIX: Preserve history
  profile: {userId:'',username:'Guest',wins:0,losses:0,draws:0,rating:1200},
  settings: {sound:true,anim:true,particles:true,animSpeed:1,theme:'classic',clock:600},

  init(){
    try{ const s=localStorage.getItem('cm_settings'); if(s)this.settings={...this.settings,...JSON.parse(s)}; }catch(e){}
    try{ const p=localStorage.getItem('cm_profile'); if(p)this.profile={...this.profile,...JSON.parse(p)}; }catch(e){}
    
    // BUG-06 FIX: Stable Identity Generation
    let storedId = null;
    try { storedId = localStorage.getItem('cm_userId'); } catch(e) {}
    if (!storedId) {
      storedId = window.crypto && crypto.randomUUID ? crypto.randomUUID() : 'u_' + Math.random().toString(36).slice(2,8);
      try { localStorage.setItem('cm_userId', storedId); } catch(e) {}
    }
    this.profile.userId = storedId;

    this.applySettings();

    this.renderer=new BoardRenderer(this.game);
    this.renderer.animEnabled=this.settings.anim;
    this.renderer.animSpeed=this.settings.animSpeed;

    const canvas=document.getElementById('particleCanvas');
    this.particles=new ParticleSystem(canvas);
    this.particles.enabled=this.settings.particles;

    this.dnd=new DragDrop(this.renderer,(fr,fc,tr,tc)=>this.handleDrop(fr,fc,tr,tc));

    this.renderer.initBoard();
    this._staggerBoardEntrance();
    this.updateProfileUI();
    this.updateClocks();
    this.s3log.log('App initialized. Server: '+window.location.origin,'info');
    this.s3log.log('S3 Bucket configured in server .env','info');
    this.toast.show('Welcome to ChessMaster! Click New Game ▶', 'info');
  },

  _staggerBoardEntrance(){
    const sqs=document.querySelectorAll('#board .sq');
    sqs.forEach((sq,i)=>{
      sq.style.opacity='0';
      sq.style.transform='scale(0.8)';
      setTimeout(()=>{ sq.style.transition='opacity 0.2s,transform 0.2s cubic-bezier(.25,.8,.25,1.2)'; sq.style.opacity='1'; sq.style.transform=''; },i*8);
    });
    // BUG-12 FIX: Removed this.renderer._rebuildPieces() to prevent duplicates
    setTimeout(()=>{ this.renderer.render(null,[]); },200);
  },

  selectSquare(r,c){
    this.selectedSq=[r,c];
    this.legalMoves=this.game.getMovesFrom(r,c);
    this.renderer.render([r,c],this.legalMoves);
  },

  clearSelection(){
    this.selectedSq=null; this.legalMoves=[];
  },

  handleSquareClick(r,c){
    if(!this.gameActive || this.boardLocked) return; 
    if(this.replayMode)return;
    if(this.mode==='online'&&this.game.turn!==this.myColor)return;
    if(this.mode==='ai'&&this.game.turn===this.aiColor)return;

    const sq=this.renderer.sqEl(r,c);
    if(sq){ const rp=document.createElement('div'); rp.className='ripple'; const rc=document.createElement('div'); rc.className='ripple-circle'; rc.style.cssText=`width:${this.renderer.getSqSize()*1.4}px;height:${this.renderer.getSqSize()*1.4}px;left:50%;top:50%;margin-left:-${this.renderer.getSqSize()*0.7}px;margin-top:-${this.renderer.getSqSize()*0.7}px;`; rp.appendChild(rc); sq.appendChild(rp); setTimeout(()=>rp.remove(),500); }

    if(this.selectedSq){
      const move=this.legalMoves.find(m=>m.to[0]===r&&m.to[1]===c);
      if(move){ if(move.special==='promo'){this.showPromoModal(move);return;} this.executeMove(move); return; }
    }
    const piece=this.game.board[r][c];
    if(piece&&this.game.col(piece)===this.game.turn){ this.selectSquare(r,c); }
    else { this.clearSelection(); this.renderer.render(null,[]); }
  },

  handleDrop(fr,fc,tr,tc){
    // BUG-08 FIX: Added this.boardLocked guard
    if(!this.gameActive || this.boardLocked || this.replayMode) return; 
    const move=this.legalMoves.find(m=>m.to[0]===tr&&m.to[1]===tc);
    if(move){ if(move.special==='promo'){this.showPromoModal(move);return;} this.executeMove(move); }
    else { this.sound.illegal(); this.clearSelection(); this.renderer.render(null,[]); }
  },

  async executeMove(move, fromOpponent=false){
    this.boardLocked = true;
    this.clearSelection();
    this.renderer.render(null, []);

    const wasCapture=!!move.capture;
    const wasCheck=this.game.status==='check';

    await this.renderer.animateMove(move);

    if(wasCapture){
      const cr=move.special==='ep'?(move.from[0]+(move.piece[0]==='w'?1:-1)):move.to[0];
      const cc=move.special==='ep'?move.to[1]:move.to[1];
      await this.renderer.animateCapture(cr,cc,this.particles);
    }

    this.game.makeMove(move);
    this._fullHistory = [...this.game.history]; // BUG-04 FIX: Snapshot full history

    if(move.special==='castleK'||move.special==='castleQ') this.sound.castle();
    else if(wasCapture) this.sound.capture();
    else this.sound.move();

    const[fr,fc]=move.from,[tr,tc]=move.to;
    const key=fr+','+fc;
    const el=this.renderer.pieceEls[key];
    if(el){
      delete this.renderer.pieceEls[key];
      el.dataset.r=tr; el.dataset.c=tc;
      const pos=this.renderer.sqPos(tr,tc);
      el.style.left=pos.left+'px'; el.style.top=pos.top+'px';
      this.renderer.pieceEls[tr+','+tc]=el;
      const piece=this.game.board[tr][tc];
      if(piece&&el.dataset.piece!==piece){ el.textContent=PIECES[piece]; el.dataset.piece=piece; el.classList.add('promoted'); }
    }
    if(move.special==='castleK'||move.special==='castleQ'){
      const row=move.piece[0]==='w'?7:0;
      const oldC=move.special==='castleK'?7:0;
      const newC=move.special==='castleK'?5:3;
      const rook=this.renderer.pieceEls[row+','+oldC];
      if(rook){ delete this.renderer.pieceEls[row+','+oldC]; rook.dataset.r=row; rook.dataset.c=newC; const pos=this.renderer.sqPos(row,newC); rook.style.left=pos.left+'px'; rook.style.top=pos.top+'px'; this.renderer.pieceEls[row+','+newC]=rook; }
    }

    this.renderer.render(null,[]);
    this.updateMoveList();
    this.updateCaptured();
    this.updateStatus();
    this.updatePlayerBars();

    if(this.mode==='online'&&!fromOpponent&&this.socket){ 
      this.socket.emit('move',{roomId:this.roomId,move}); 
    }

    if(this.game.status==='check'){
      this.sound.check();
      document.getElementById('boardWrap').classList.add('check-shake');
      setTimeout(()=>document.getElementById('boardWrap').classList.remove('check-shake'),500);
    }

    this.boardLocked = false; 

    if(this.game.status==='checkmate'||this.game.status==='stalemate'||this.game.status==='draw'){ this.endGame(); return; }

    if(this.mode==='ai'&&this.game.turn===this.aiColor&&this.gameActive){ this.scheduleAI(); }
  },

  scheduleAI(){
    if (this.mode !== 'ai' || this.replayMode) return; 

    this.setStatus('AI thinking...','ai-thinking');
    
    setTimeout(()=>{ 
      if(!this.gameActive || this.game.turn !== this.aiColor) return; 
      
      const move = this.ai.getBest(this.game); 
      if(move) {
        this.executeMove(move); 
      }
    }, 500);
  },

  newGame(){
    // BUG-07 FIX: Prevent breaking online games
    if (this.mode === 'online') {
      this.toast.show('Start a new game from the Online tab', 'info');
      return;
    }

    this._fullHistory = []; // BUG-04 Reset
    this.replayMode = false; 
    this.replayIdx = 0;
    this.stopReplayPlay();
    this.stopClock();
    this.game.reset();
    this.clearSelection();
    this.boardLocked = false;
    this.gameActive = true;

    const sel = document.getElementById('colorSel').value;
    if(sel === 'r') {
      this.playerColor = Math.random() < 0.5 ? 'w' : 'b';
    } else {
      this.playerColor = sel;
    }
    this.myColor = this.playerColor; 
    this.aiColor = this.game.opp(this.playerColor);

    this.renderer.flipped = (this.playerColor === 'b');

    this.clocks = { w: this.settings.clock, b: this.settings.clock };
    this.updateClocks(); 
    this.startClock();
    
    this.renderer.initBoard();
    this._staggerBoardEntrance();

    setTimeout(() => {
      document.getElementById('resignBtn').disabled = false;
      this.updateMoveList(); 
      this.updateCaptured(); 
      this.updateStatus(); 
      this.updatePlayerBars();
      this.setNamesForMode(); // BUG-18 FIX
      this.sound.start();
      
      document.getElementById('boardWrap').classList.remove('victory');
      document.getElementById('boardOverlay').classList.remove('checkmate');
      
      if(this.aiColor === 'w') {
        this.scheduleAI();
      }
    }, 200);
  },

  setNamesForMode(){
    const pname=this.profile.username;
    if(this.mode==='ai'){
      const aiNames=['Stockfish Jr','Deep Thought','HAL 9000','Kasparov Bot'];
      const aiN=aiNames[Math.floor(Math.random()*aiNames.length)];
      const playerIsWhite=this.playerColor==='w';
      document.getElementById('namePlayer').textContent=playerIsWhite?pname:'AI';
      document.getElementById('nameOpponent').textContent=playerIsWhite?aiN:pname;
      document.getElementById('eloPlayer').textContent=playerIsWhite?this.profile.rating:1200+this.ai.depth*150;
      document.getElementById('eloOpponent').textContent=playerIsWhite?1200+this.ai.depth*150:this.profile.rating;
    }else{
      document.getElementById('namePlayer').textContent='White';
      document.getElementById('nameOpponent').textContent='Black';
    }
  },

  flipBoard(){ this.renderer.flip(); this.renderer.render(null,[]); },

  // Shared end-game helper for saving records properly
  _onGameEnd() {
    this.saveReplay();
    this.pushLeaderboard();
    this.updateProfileUI();
  },

  resign(){
    if(!this.gameActive)return;
    this.gameActive=false; this.stopClock();
    const winner=this.game.opp(this.game.turn);
    this.showGameOver(winner==='w'?'White Wins':'Black Wins','by resignation ✦',false);
    this.profile.losses++; this.saveSettingsLocal();
    this._onGameEnd(); // BUG-09 FIX
    document.getElementById('resignBtn').disabled=true;
  },

  offerDraw(){
    if(!this.gameActive)return;
    if(this.mode==='online'&&this.socket){ this.socket.emit('offer_draw',{roomId:this.roomId}); this.toast.show('Draw offered to opponent','info'); return; }
    if(confirm('Accept draw?')){ 
      this.gameActive=false; this.stopClock(); 
      this.showGameOver('Draw','by agreement',false); 
      this.profile.draws++; this.saveSettingsLocal(); 
      this._onGameEnd(); // BUG-10 FIX
    }
  },

  endGame(){
    this.gameActive = false; 
    this.stopClock();
    document.getElementById('resignBtn').disabled = true;
    document.getElementById('boardOverlay').classList.add('checkmate');
    
    let title = '', sub = '', isWin = false;
    
    if(this.game.status === 'checkmate'){
      const winnerColor = this.game.opp(this.game.turn);
      title = (winnerColor === 'w' ? 'White' : 'Black') + ' Wins!';
      sub = 'Checkmate ✦';
      
      const localPlayerWon = (this.mode === 'ai' && winnerColor === this.playerColor) || 
                             (this.mode === 'online' && winnerColor === this.myColor);
      
      if(localPlayerWon){
        this.profile.wins++;
        isWin = true;
      } else if (this.mode !== 'local') {
        this.profile.losses++;
      }
    } else {
      title = this.game.status === 'stalemate' ? 'Stalemate' : 'Draw';
      sub = this.game.status === 'stalemate' ? 'The game is a draw' : '50-move rule';
      this.profile.draws++;
    }
    
    this.saveSettingsLocal();
    
    if(isWin){ 
      document.getElementById('boardWrap').classList.add('victory'); 
      this.sound.victory(); 
      const rect = document.getElementById('board').getBoundingClientRect(); 
      this.particles.confetti(rect.left + rect.width/2, rect.top); 
    }
    
    setTimeout(() => this.showGameOver(title, sub, isWin), 600);
    
    this._onGameEnd(); 
  },

  startClock(){
    this.stopClock();
    this.clockInterval=setInterval(()=>{
      if(!this.gameActive)return;
      this.clocks[this.game.turn]--;
      this.updateClocks();
      if(this.clocks[this.game.turn]<=0){ this.gameActive=false; this.stopClock(); const w=this.game.opp(this.game.turn); this.showGameOver(w==='w'?'White Wins':'Black Wins','on time'); }
    },1000);
  },
  stopClock(){ clearInterval(this.clockInterval); this.clockInterval=null; },
  
  updateClocks(){
    // BUG-17 FIX: Removed unused variables
    ['w','b'].forEach(co=>{
      const isPlayerWhite=(this.playerColor==='w'||this.mode!=='ai');
      const clockId=(co==='w')?(isPlayerWhite?'clockPlayer':'clockOpponent'):(isPlayerWhite?'clockOpponent':'clockPlayer');
      const el=document.getElementById(clockId);
      if(!el)return;
      const t=Math.max(0,this.clocks[co]);
      const m=Math.floor(t/60),s=t%60;
      el.textContent=`${m}:${s.toString().padStart(2,'0')}`;
      el.className='clock-display'+(this.game.turn===co&&this.gameActive?' active':'')+(t<=30?' low':'');
    });
  },

  setStatus(html,type=''){
    const el=document.getElementById('statusBar');
    el.innerHTML=html;
    el.className='status-bar'+(type?' '+type:'');
  },
  updateStatus(){
    const msgs={
      playing:`${this.game.turn==='w'?'♔ White':'♚ Black'} to move`,
      check:`${this.game.turn==='w'?'♔ White':'♚ Black'} is in check! ⚡`,
      checkmate:'Checkmate',stalemate:'Stalemate — Draw',draw:'Draw (50-move rule)'
    };
    const types={check:'check',checkmate:'checkmate',stalemate:'',draw:''};
    this.setStatus(msgs[this.game.status]||'',types[this.game.status]||'');
  },

  updatePlayerBars(){
    const isWhiteTurn=this.game.turn==='w';
    const playerIsWhite=(this.playerColor==='w'||this.mode==='local');
    const playerTurn=playerIsWhite?isWhiteTurn:!isWhiteTurn;
    document.getElementById('barPlayer').classList.toggle('active-turn',playerTurn);
    document.getElementById('barOpponent').classList.toggle('active-turn',!playerTurn);
    document.getElementById('indicatorPlayer').classList.toggle('active',playerTurn);
    document.getElementById('indicatorOpponent').classList.toggle('active',!playerTurn);
    this.updateClocks();
  },

  updateMoveList(){
    const el=document.getElementById('moveList');
    const h=this.game.history;
    el.innerHTML='';
    const frag=document.createDocumentFragment();
    for(let i=0;i<h.length;i+=2){
      const row=document.createElement('div'); row.className='move-pair';
      const num=document.createElement('span'); num.className='move-num'; num.textContent=(i/2+1)+'.';
      const mw=document.createElement('span'); mw.className='move-cell'+(this.replayIdx===i+1?' current':''); mw.textContent=this.game.toAlg(h[i]); mw.onclick=()=>this.jumpToMove(i+1);
      row.appendChild(num); row.appendChild(mw);
      if(h[i+1]){const mb=document.createElement('span');mb.className='move-cell'+(this.replayIdx===i+2?' current':'');mb.textContent=this.game.toAlg(h[i+1]);mb.onclick=()=>this.jumpToMove(i+2);row.appendChild(mb);}
      frag.appendChild(row);
    }
    el.appendChild(frag);
    el.scrollTop=el.scrollHeight;
    const slider=document.getElementById('replaySlider');
    slider.max=h.length; slider.value=this.replayIdx||h.length;
  },

  updateCaptured(){
    const V={Q:9,R:5,B:3,N:3,P:1};
    const ws=this.game.captured.w.reduce((s,p)=>s+(V[p[1]]||0),0);
    const bs=this.game.captured.b.reduce((s,p)=>s+(V[p[1]]||0),0);
    const pl=this.game.captured.b.map(p=>PIECES[p]).join('')+(ws>bs?`<span class="material-adv">+${ws-bs}</span>`:'');
    const op=this.game.captured.w.map(p=>PIECES[p]).join('')+(bs>ws?`<span class="material-adv">+${bs-ws}</span>`:'');
    const playerIsWhite=(this.playerColor==='w'||this.mode==='local');
    document.getElementById('capturedPlayer').innerHTML=playerIsWhite?pl:op;
    document.getElementById('capturedOpponent').innerHTML=playerIsWhite?op:pl;
  },

  jumpToMove(idx){
    // BUG-04 FIX: Use _fullHistory
    const allMoves = this._fullHistory && this._fullHistory.length > 0 ? this._fullHistory : [...this.game.history];
    this.game.reset();
    for(let i=0;i<Math.min(idx,allMoves.length);i++) this.game.makeMove(allMoves[i]);
    this.replayIdx=idx;
    this.renderer.initBoard();
    setTimeout(()=>{ this.renderer.render(null,[]); this.updateStatus(); this.updateCaptured(); this.updateMoveList(); },50);
  },
  replayFirst(){ if(this.game.history.length)this.jumpToMove(0); },
  replayLast(){ this.jumpToMove((this._fullHistory && this._fullHistory.length > 0 ? this._fullHistory : this.game.history).length); },
  replayPrev(){ if(this.replayIdx>0)this.jumpToMove(this.replayIdx-1); },
  replayNext(){ 
    const max = (this._fullHistory && this._fullHistory.length > 0 ? this._fullHistory : this.game.history).length;
    if(this.replayIdx < max) this.jumpToMove(this.replayIdx+1); 
  },
  scrubReplay(val){ this.jumpToMove(parseInt(val)); },
  toggleReplayPlay(){
    this.replayPlaying=!this.replayPlaying;
    document.getElementById('replayPlayBtn').textContent=this.replayPlaying?'⏸':'▶';
    if(this.replayPlaying)this._playReplayStep();
  },
  stopReplayPlay(){ this.replayPlaying=false; clearTimeout(this.replayTimer); document.getElementById('replayPlayBtn').textContent='▶'; },
  _playReplayStep(){
    if(!this.replayPlaying)return;
    if(this.replayIdx>=this.game.history.length){ this.stopReplayPlay(); return; }
    this.replayNext();
    this.replayTimer=setTimeout(()=>this._playReplayStep(),600*this.settings.animSpeed);
  },

  showPromoModal(move){
    this.pendingPromo=move;
    const grid=document.getElementById('promoGrid');
    grid.innerHTML='';
    for(const t of['Q','R','B','N']){
      const btn=document.createElement('div'); btn.className='promo-btn';
      btn.textContent=PIECES[move.piece[0]+t];
      btn.onclick=()=>{ this.pendingPromo.promoteTo=t; this.closeModal('promoModal'); this.executeMove(this.pendingPromo); };
      grid.appendChild(btn);
    }
    document.getElementById('promoModal').classList.add('open');
  },

  showGameOver(title,sub,isWin=false){
    const icons={win:'🏆',loss:'♟',draw:'🤝'};
    document.getElementById('resultCrown').textContent=isWin?icons.win:(title.includes('Draw')?icons.draw:'♚');
    document.getElementById('resultTitle').textContent=title;
    document.getElementById('resultSub').textContent=sub;
    document.getElementById('gameOverModal').classList.add('open');
  },

  closeModal(id){ document.getElementById(id).classList.remove('open'); },

  setMode(m){
    this.mode=m;
    ['ai','local','online'].forEach(x=>{
      const el=document.getElementById('mode'+x.charAt(0).toUpperCase()+x.slice(1));
      if(el)el.classList.toggle('active',x===m);
    });
    document.getElementById('aiSection').style.display=m==='ai'?'flex':'none';
    document.getElementById('aiSection').style.flexDirection='column';
    document.getElementById('aiSection').style.gap='8px';
    if(m==='online')this.switchTab('online');
  },
  setDiff(d,el){ this.ai.depth=d; document.querySelectorAll('#diffCtrl .seg-btn').forEach(x=>x.classList.remove('active')); el.classList.add('active'); },

  switchTab(name){
    const names=['game','online','replays','leaders','profile'];
    document.querySelectorAll('.tab').forEach((t,i)=>t.classList.toggle('active',names[i]===name));
    document.querySelectorAll('.tab-pane').forEach(p=>p.classList.remove('active'));
    const pane=document.getElementById('pane-'+name);
    if(pane)pane.classList.add('active');
    if(name==='leaders')this.loadLeaderboard();
  },

  openSettings(){ document.getElementById('settingsModal').classList.add('open'); },
  setTheme(theme,el){
    this.settings.theme=theme;
    document.querySelectorAll('.theme-btn').forEach(x=>x.classList.remove('active'));
    if(el)el.classList.add('active');
    const themes=['classic','marble','cyber','mono','emerald'];
    document.body.className=themes.includes(theme)?'theme-'+theme:'';
    this.renderer.initBoard(); this.renderer.render(null,[]);
    this.saveSettingsLocal();
  },
  toggleSound(){ this.settings.sound=!this.settings.sound; this.sound.enabled=this.settings.sound; document.getElementById('soundToggle').classList.toggle('on',this.settings.sound); this.saveSettingsLocal(); },
  toggleAnim(){ this.settings.anim=!this.settings.anim; this.renderer.animEnabled=this.settings.anim; document.getElementById('animToggle').classList.toggle('on',this.settings.anim); this.saveSettingsLocal(); },
  toggleParticles(){ this.settings.particles=!this.settings.particles; this.particles.enabled=this.settings.particles; document.getElementById('particleToggle').classList.toggle('on',this.settings.particles); this.saveSettingsLocal(); },
  setAnimSpeed(s,el){ this.settings.animSpeed=s; this.renderer.animSpeed=s; document.querySelectorAll('#settingsModal .seg-btn').forEach(x=>x.classList.remove('active')); if(el)el.classList.add('active'); this.saveSettingsLocal(); },
  applySettings(){
    this.sound.enabled=this.settings.sound;
    document.getElementById('soundToggle')?.classList.toggle('on',this.settings.sound);
    document.getElementById('animToggle')?.classList.toggle('on',this.settings.anim);
    document.getElementById('particleToggle')?.classList.toggle('on',this.settings.particles);
    if(this.settings.theme){ const themes=['classic','marble','cyber','mono','emerald']; document.body.className=themes.includes(this.settings.theme)?'theme-'+this.settings.theme:''; }
    document.getElementById('clockSel').value=this.settings.clock||600;
    this.clockBase=this.settings.clock||600;
  },
  saveSettingsLocal(){ try{localStorage.setItem('cm_settings',JSON.stringify(this.settings));}catch(e){} },

  updateProfileUI(){
    const u=this.profile;
    document.getElementById('profileName').textContent=u.username;
    document.getElementById('profileInput').value=u.username;
    document.getElementById('stWins').textContent=u.wins;
    document.getElementById('stLoss').textContent=u.losses;
    document.getElementById('stDraw').textContent=u.draws;
    const r=Math.max(800,Math.floor(1200+u.wins*15-u.losses*12+u.draws*3));
    this.profile.rating=r;
    document.getElementById('profileElo').textContent=r;
    document.getElementById('headerUser').textContent=u.username;
    document.getElementById('headerRating').textContent=r;
  },
  async saveProfile(){
    this.profile.username=document.getElementById('profileInput').value||'Guest';
    try{localStorage.setItem('cm_profile',JSON.stringify(this.profile));}catch(e){}
    try{
      await this.api.post('/api/user/'+this.profile.userId,this.profile);
      this.s3log.log(`✅ Profile → S3: users/${this.profile.userId}.json`,'ok');
      this.toast.show('Profile saved to S3 ☁','success');
    }catch(e){ this.s3log.log('❌ Profile save failed','err'); this.toast.show('Server offline — saved locally','error'); }
    this.updateProfileUI();
  },
  async loadProfile(){
    const targetName = prompt("Enter the Username you want to recover:");
    
    if (!targetName) return;

    try {
      this.s3log.log(`Searching for ${targetName}...`, 'info');
      
      const d = await this.api.get('/api/user/by-name/' + targetName);
      
      if (!d || d.error) {
        throw new Error("Username not found on S3");
      }
      
      this.profile = { ...this.profile, ...d };
      localStorage.setItem('cm_profile', JSON.stringify(this.profile));
      
      this.updateProfileUI();
      this.s3log.log(`✅ Account ${targetName} recovered!`, 'ok');
      this.toast.show(`Welcome back, ${targetName}!`, 'success');
    } catch(e) {
      this.s3log.log('❌ Load failed', 'err');
      this.toast.show('That username does not exist on S3.', 'error');
    }
  },

  async saveReplay(){
    if(this.game.history.length<4)return;
    try{
      const d=await this.api.post('/api/replay',{userId:this.profile.userId,username:this.profile.username,moves:this.game.history,result:this.game.status,mode:this.mode,date:new Date().toISOString()});
      this.s3log.log(`✅ Replay → S3: replays/${d.gameId}.json`,'ok');
      this.toast.show('Game replay saved to S3 ☁','success');
    }catch(e){ this.s3log.log('❌ Replay save failed','err'); }
  },
  async loadReplays(){
    try{
      const data=await this.api.get('/api/replays');
      const el=document.getElementById('replayList');
      if(!data.length){el.innerHTML='<div style="text-align:center;color:var(--t-muted);padding:20px">No replays on S3 yet.</div>';return;}
      el.innerHTML='';
      const frag=document.createDocumentFragment();
      data.slice(0,15).forEach(rep=>{
        const item=document.createElement('div'); item.className='replay-item';
        item.innerHTML=`<div><div style="font-weight:600;font-size:0.88rem">${rep.gameId.slice(0,12)}...</div><div class="replay-id">${new Date(rep.date||0).toLocaleDateString()}</div></div><div class="replay-arrow">→</div>`;
        item.onclick=()=>this.loadReplay(rep.gameId);
        frag.appendChild(item);
      });
      el.appendChild(frag);
      this.s3log.log(`✅ Loaded ${data.length} replays from S3`,'ok');
    }catch(e){ this.s3log.log('❌ Replay list failed','err'); this.toast.show('Server offline','error'); }
  },
  async loadReplay(gameId){
    try{
      const d=await this.api.get('/api/replay/'+gameId);
      const allMoves=d.moves||[];
      this.game.reset(); this.replayMode=true; this.replayIdx=0;
      for(const m of allMoves)this.game.makeMove(m);
      this.replayIdx=allMoves.length;
      this.gameActive=false;
      this.renderer.initBoard();
      setTimeout(()=>{ this.renderer.render(null,[]); this.updateMoveList(); this.updateStatus(); this.updateCaptured(); },100);
      this.s3log.log(`✅ Replay loaded: ${allMoves.length} moves`,'ok');
      this.toast.show(`Replay loaded! ${allMoves.length} moves`,'success');
      this.switchTab('game');
    }catch(e){ this.toast.show('Failed to load replay','error'); }
  },

  async pushLeaderboard(){
    try{
      const d=await this.api.post('/api/leaderboard',{userId:this.profile.userId,username:this.profile.username,wins:this.profile.wins,losses:this.profile.losses,draws:this.profile.draws});
      this.s3log.log(`✅ Leaderboard updated on S3`,'ok');
    }catch(e){ this.s3log.log('❌ Leaderboard update failed','err'); }
  },
  async loadLeaderboard(){
    try{
      const data=await this.api.get('/api/leaderboard');
      const tbody=document.getElementById('lbBody');
      if(!data.length){tbody.innerHTML='<tr><td colspan="4" style="text-align:center;color:var(--t-muted);padding:16px">No entries yet</td></tr>';return;}
      tbody.innerHTML=data.slice(0,20).map((p,i)=>`<tr><td><span class="rank-icon ${i<3?'rank-'+(i+1):''}">${i+1}</span></td><td style="font-weight:600">${p.username}</td><td class="elo-val">${p.rating}</td><td style="color:var(--t-secondary)">${p.wins}/${p.losses}/${p.draws}</td></tr>`).join('');
      this.s3log.log('✅ Leaderboard loaded from S3','ok');
    }catch(e){ this.s3log.log('❌ Leaderboard failed','err'); }
  },

  initSocket(){
    if(this.socket)return;
    this.socket=io();
    
    let pingStart=0;
    this.socket.on('connect',()=>{ 
      this.s3log.log('✅ WebSocket connected','ok'); 
      pingStart=Date.now(); 
      this.socket.emit('ping_check'); 
      // BUG-13 FIX: Store interval ID
      this.pingInterval = setInterval(()=>{ if(this.socket){pingStart=Date.now();this.socket.emit('ping_check');} },3000);
    });
    
    // BUG-13 FIX: Clear interval on disconnect
    this.socket.on('disconnect', () => { clearInterval(this.pingInterval); });

    this.socket.on('pong_check',()=>{ const ms=Date.now()-pingStart; const el=document.getElementById('pingDisplay'); if(el){el.textContent=ms+'ms'; el.className='latency '+(ms<100?'good':'bad');} });
    
    this.socket.on('room_created',({color,roomId:rid})=>{
      this.myColor=color; this.playerColor=color; this.roomId=rid;
      document.getElementById('roomCodeDisplay').textContent=rid;
      document.getElementById('roomCreated').style.display='block';
    });
    
    this.socket.on('room_joined',({color, roomId:rid})=>{ 
      this.myColor=color; this.playerColor=color; this.roomId=rid; 
    });
    
    this.socket.on('room_error',msg=>this.toast.show('❌ '+msg,'error'));
    
    this.socket.on('game_start',({white,black})=>{
      this.mode = 'online'; 
      this.game.reset(); this.gameActive=true; 
      this.renderer.flipped=(this.myColor==='b');
      this.renderer.initBoard(); setTimeout(()=>this.renderer.render(null,[]),50);
      this.startClock();
      document.getElementById('namePlayer').textContent=this.myColor==='w'?white:black;
      document.getElementById('nameOpponent').textContent=this.myColor==='w'?black:white;
      document.getElementById('waitMsg').className='mp-status-msg connected'; document.getElementById('waitMsg').textContent='✓ Game started!';
      document.getElementById('mpGameControls').style.display='block';
      this.updateStatus(); this.toast.show(`Game started! You play ${this.myColor==='w'?'White ♔':'Black ♚'}`,'success');
      this.sound.start();
    });
    
    this.socket.on('opponent_move',move=>{ this.executeMove(move,true); });
    
    this.socket.on('opponent_disconnected',({username})=>{ 
      this.gameActive=false; this.stopClock(); 
      this.toast.show(`${username} disconnected — you win!`,'info'); 
      this.profile.wins++; 
      this._onGameEnd(); // BUG-11 FIX
    });
    
    this.socket.on('game_over_mp',({reason})=>{ this.gameActive=false; this.stopClock(); this.showGameOver('Game Over',reason==='resign'?'Opponent resigned':'Draw agreed'); });
    this.socket.on('draw_offered',()=>{ if(confirm('Opponent offers a draw. Accept?'))this.socket.emit('accept_draw',{roomId:this.roomId}); });
  },
  
  createRoom(){
    this.initSocket();
    const name=document.getElementById('mpName').value||'Player';
    this.profile.username=name;
    const rid=Math.random().toString(36).slice(2,8).toUpperCase();
    this.socket.emit('create_room',{roomId:rid,username:name});
    this.toast.show('Room created! Share the code.','info');
  },
  
  joinRoom(){
    this.initSocket();
    const code=document.getElementById('joinCode').value.trim().toUpperCase();
    if(!code){this.toast.show('Enter a room code','error');return;}
    const name=document.getElementById('mpName').value||'Player';
    this.socket.emit('join_room',{roomId:code,username:name});
  },
  
  resignOnline(){ 
    if(this.socket && this.roomId){
      // 1. Tell the server to notify opponent
      this.socket.emit('resign', {roomId: this.roomId}); 
      
      // 2. Instantly end the game locally
      this.gameActive = false; 
      this.stopClock();
      
      const winner = this.game.opp(this.myColor);
      this.showGameOver(winner === 'w' ? 'White Wins' : 'Black Wins', 'by resignation ✦', false);
      
      this.profile.losses++; 
      this.saveSettingsLocal();
      this._onGameEnd();
    }
  },
};

// Expose App globally so inline HTML triggers (onclick="App...") still work perfectly
window.App = App;

// Event Listeners
document.getElementById('board').addEventListener('click', e=>{
  const sq=e.target.closest('.sq');
  if(!sq)return;
  App.handleSquareClick(parseInt(sq.dataset.r),parseInt(sq.dataset.c));
});

document.querySelectorAll('.overlay').forEach(o=>o.addEventListener('click',e=>{if(e.target===o)App.closeModal(o.id);}));

document.getElementById('clockSel').addEventListener('change',function(){ App.settings.clock=parseInt(this.value); App.clockBase=App.settings.clock; App.saveSettingsLocal(); });

let touchStartX=0;
document.getElementById('board').addEventListener('touchstart',e=>{ touchStartX=e.touches[0].clientX; },{passive:true});
document.getElementById('board').addEventListener('touchend',e=>{
  const dx=e.changedTouches[0].clientX-touchStartX;
  if(Math.abs(dx)>80){ App.flipBoard(); App.toast.show('Board flipped','info',1500); }
},{passive:true});

document.addEventListener('keydown',e=>{
  if(e.target.tagName==='INPUT')return;
  if(e.key==='ArrowLeft')App.replayPrev();
  if(e.key==='ArrowRight')App.replayNext();
  if(e.key==='f'||e.key==='F')App.flipBoard();
  if(e.key==='n'||e.key==='N')App.newGame();
});

// Initialize
App.init();