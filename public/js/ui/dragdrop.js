import { PIECES } from '../constants.js';

export class DragDrop {
  constructor(renderer, onDrop){
    this.renderer=renderer; this.onDrop=onDrop;
    this.dragging=false; this.dragEl=null; this.fromR=null; this.fromC=null;
    this.ghost=document.getElementById('dragGhost');
    this._bind();
  }
  _bind(){
    document.getElementById('board').addEventListener('mousedown', e=>this._start(e));
    document.addEventListener('mousemove', e=>this._move(e));
    document.addEventListener('mouseup', e=>this._end(e));
    document.getElementById('board').addEventListener('touchstart', e=>this._start(e),{passive:false});
    document.addEventListener('touchmove', e=>this._move(e),{passive:false});
    document.addEventListener('touchend', e=>this._end(e));
  }
  _getClientXY(e){ return e.touches?{x:e.touches[0].clientX,y:e.touches[0].clientY}:{x:e.clientX,y:e.clientY}; }
  _getPieceAt(r,c){ return document.querySelector(`.piece-el[data-r="${r}"][data-c="${c}"]`); }
  _sqFromPoint(x,y){
    const board=document.getElementById('board');
    const rect=board.getBoundingClientRect();
    const s=this.renderer.getSqSize();
    const bx=x-rect.left, by=y-rect.top;
    if(bx<0||by<0||bx>s*8||by>s*8)return null;
    const dc=Math.floor(bx/s), dr=Math.floor(by/s);
    const c=this.renderer.flipped?7-dc:dc, r=this.renderer.flipped?7-dr:dr;
    if(r<0||r>7||c<0||c>7)return null;
    return[r,c];
  }
  _start(e){
    if(e.button!==undefined&&e.button!==0)return;
    // PREVENT DRAGGING IF ANIMATION IN PROGRESS
    if(window.App && window.App.boardLocked) return; 

    const{x,y}=this._getClientXY(e);
    const sq=this._sqFromPoint(x,y);
    if(!sq)return;
    const[r,c]=sq;
    const piece=window.App.game.board[r][c];
    if(!piece)return;
    if(window.App.game.col(piece)!==window.App.game.turn)return;
    if(window.App.mode==='online'&&window.App.game.turn!==window.App.myColor)return;
    if(window.App.mode==='ai'&&window.App.game.turn===window.App.aiColor)return;
    if(!window.App.gameActive)return;
    e.preventDefault();
    this.dragging=true; this.fromR=r; this.fromC=c;
    this.dragEl=this._getPieceAt(r,c);
    if(this.dragEl){ this.dragEl.classList.add('lifted'); this.dragEl.style.opacity='0.3'; }
    this.ghost.textContent=PIECES[piece]||'';
    const s=this.renderer.getSqSize();
    this.ghost.style.fontSize=(s*0.78)+'px';
    this.ghost.style.display='block';
    this.ghost.style.left=x+'px'; this.ghost.style.top=y+'px';
    window.App.selectSquare(r,c);
  }
  _move(e){
    if(!this.dragging)return;
    e.preventDefault();
    const{x,y}=this._getClientXY(e);
    this.ghost.style.left=x+'px'; this.ghost.style.top=y+'px';
  }
  _end(e){
    if(!this.dragging)return;
    this.dragging=false;
    this.ghost.style.display='none';
    if(this.dragEl){ this.dragEl.classList.remove('lifted'); this.dragEl.style.opacity=''; }
    const{x,y}=this._getClientXY(e.changedTouches?{changedTouches:e.changedTouches}:e);
    const toSq=this._sqFromPoint(x||e.clientX,y||e.clientY);
    if(toSq){ this.onDrop(this.fromR,this.fromC,toSq[0],toSq[1]); }
    else { window.App.clearSelection(); window.App.renderer.render(); }
    this.dragEl=null; this.fromR=null; this.fromC=null;
  }
}