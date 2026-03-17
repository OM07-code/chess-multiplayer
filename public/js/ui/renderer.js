import { PIECES } from '../constants.js';

export class BoardRenderer {
  constructor(game){
    this.game=game;
    this.sq=parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sq-size'));
    this.flipped=false;
    this.pieceEls={}; 
    this.selectedSq=null; this.legalMoves=[];
    this.animEnabled=true; this.animSpeed=1;
    window.addEventListener('resize',()=>{ this.sq=parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sq-size')); });
  }
  getSqSize(){ return parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sq-size'))||72; }
  sqEl(r,c){ return document.querySelector(`#board .sq[data-r="${r}"][data-c="${c}"]`); }
  sqPos(r,c){
    const s=this.getSqSize();
    const dr=this.flipped?7-r:r, dc=this.flipped?7-c:c;
    return{left:dc*s, top:dr*s};
  }

  initBoard(){
    const board=document.getElementById('board');
    board.innerHTML='';
    const s=this.getSqSize();
    board.style.width=(s*8)+'px'; board.style.height=(s*8)+'px';
    for(let r=0;r<8;r++) for(let c=0;c<8;c++){
      const dr=this.flipped?7-r:r, dc=this.flipped?7-c:c;
      const sq=document.createElement('div');
      sq.className='sq '+((dr+dc)%2===0?'light':'dark');
      
      // Keeping the logical coordinate fix!
      sq.dataset.r=r; 
      sq.dataset.c=c; 
      
      sq.style.cssText=`left:${dc*s}px;top:${dr*s}px;position:absolute;width:${s}px;height:${s}px;`;
      board.appendChild(sq);
    }
    
    // ADD THIS LINE BACK IN! This clears the memory cache and rebuilds the pieces.
    this._rebuildPieces(); 
  }

  _rebuildPieces(){
    document.querySelectorAll('.piece-el').forEach(el=>el.remove());
    this.pieceEls={};
    const s=this.getSqSize();
    for(let r=0;r<8;r++) for(let c=0;c<8;c++){
      const p=this.game.board[r][c];
      if(p) this._createPieceEl(r,c,p,s);
    }
  }

  _createPieceEl(r,c,piece,s){
    s=s||this.getSqSize();
    const el=document.createElement('div');
    el.className='piece-el';
    el.dataset.r=r; el.dataset.c=c; el.dataset.piece=piece;
    el.textContent=PIECES[piece]||'';
    el.style.fontSize=(s*0.7)+'px';
    el.style.width=s+'px'; el.style.height=s+'px';
    const pos=this.sqPos(r,c);
    el.style.left=pos.left+'px'; el.style.top=pos.top+'px';
    document.getElementById('board').appendChild(el);
    this.pieceEls[r+','+c]=el;
    return el;
  }

  getPieceEl(r,c){ return this.pieceEls[r+','+c]||document.querySelector(`.piece-el[data-r="${r}"][data-c="${c}"]`); }

  async animateMove(move, callback){
    const s=this.getSqSize();
    const[fr,fc]=move.from,[tr,tc]=move.to;
    const el=this.getPieceEl(fr,fc);
    
    if(!el||!this.animEnabled){ if(callback)callback(); return; }
    
    const fromPos=this.sqPos(fr,fc);
    const toPos=this.sqPos(tr,tc);
    const dx=toPos.left-fromPos.left, dy=toPos.top-fromPos.top;
    
    el.classList.add('moving');
    el.style.transform=`translate(${dx}px,${dy}px)`;
    const dur=Math.round(220*this.animSpeed);
    el.style.transition=`transform ${dur}ms cubic-bezier(.4,0,.2,1)`;
    
    return new Promise(res=>{
      setTimeout(()=>{
        el.style.transition='';
        el.style.transform=''; // <-- FIX: Clears the CSS translation so it doesn't double-jump!
        el.classList.remove('moving');
        if(callback)callback();
        res();
      }, dur+10);
    });
  }

  async animateCapture(r,c, particles){
    const el=this.getPieceEl(r,c);
    if(!el)return;
    if(particles){
      const boardRect=document.getElementById('board').getBoundingClientRect();
      const s=this.getSqSize();
      const pos=this.sqPos(r,c);
      const x=boardRect.left+pos.left+s/2;
      const y=boardRect.top+pos.top+s/2;
      particles.burst(x,y,'#e05252',20);
    }
    el.classList.add('captured');
    return new Promise(res=>setTimeout(()=>{ el.remove(); delete this.pieceEls[r+','+c]; res(); },260));
  }

  render(highlightSq=null, legalMoves=[]){
    const s=this.getSqSize();
    document.querySelectorAll('#board .sq').forEach(sq=>{
      const r=parseInt(sq.dataset.r), c=parseInt(sq.dataset.c);
      sq.className='sq '+((r+c)%2===0?'light':'dark');
    });
    const last=this.game.history[this.game.history.length-1];
    if(last){
      const fm=this.sqEl(last.from[0],last.from[1]);
      const tm=this.sqEl(last.to[0],last.to[1]);
      if(fm)fm.classList.add('last-from');
      if(tm)tm.classList.add('last-to');
    }
    if(highlightSq){
      const sel=this.sqEl(highlightSq[0],highlightSq[1]);
      if(sel)sel.classList.add('selected');
    }
    for(const m of legalMoves){
      const sq=this.sqEl(m.to[0],m.to[1]);
      if(sq)sq.classList.add(m.capture?'legal-capture':'legal-dot');
    }
    if(this.game.status==='check'||this.game.status==='checkmate'){
      const k=this.game.findKing(this.game.board,this.game.turn);
      if(k){const sq=this.sqEl(k[0],k[1]);if(sq)sq.classList.add('in-check');}
    }
    for(let r=0;r<8;r++) for(let c=0;c<8;c++){
      const p=this.game.board[r][c];
      const key=r+','+c;
      const existing=this.pieceEls[key];
      if(p&&!existing){ this._createPieceEl(r,c,p,s); }
      else if(!p&&existing){ existing.remove(); delete this.pieceEls[key]; }
      else if(p&&existing&&existing.dataset.piece!==p){
        existing.textContent=PIECES[p]||''; existing.dataset.piece=p;
        existing.classList.add('promoted');
      }
      if(p&&this.pieceEls[key]){
        const pos=this.sqPos(r,c);
        const el=this.pieceEls[key];
        if(!el.classList.contains('moving')&&!el.classList.contains('lifted')){
          el.style.left=pos.left+'px'; el.style.top=pos.top+'px';
          el.dataset.r=r; el.dataset.c=c;
        }
      }
    }
  }

  flip(){ this.flipped=!this.flipped; this.initBoard(); }
}