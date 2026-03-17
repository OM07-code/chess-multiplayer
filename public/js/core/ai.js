export class ChessAI {
  constructor(depth=3){
    this.depth=depth;
    this.PV={P:100,N:320,B:330,R:500,Q:900,K:20000};
    this.PT={
      P:[[0,0,0,0,0,0,0,0],[50,50,50,50,50,50,50,50],[10,10,20,30,30,20,10,10],[5,5,10,25,25,10,5,5],[0,0,0,20,20,0,0,0],[5,-5,-10,0,0,-10,-5,5],[5,10,10,-20,-20,10,10,5],[0,0,0,0,0,0,0,0]],
      N:[[-50,-40,-30,-30,-30,-30,-40,-50],[-40,-20,0,0,0,0,-20,-40],[-30,0,10,15,15,10,0,-30],[-30,5,15,20,20,15,5,-30],[-30,0,15,20,20,15,0,-30],[-30,5,10,15,15,10,5,-30],[-40,-20,0,5,5,0,-20,-40],[-50,-40,-30,-30,-30,-30,-40,-50]],
      B:[[-20,-10,-10,-10,-10,-10,-10,-20],[-10,0,0,0,0,0,0,-10],[-10,0,5,10,10,5,0,-10],[-10,5,5,10,10,5,5,-10],[-10,0,10,10,10,10,0,-10],[-10,10,10,10,10,10,10,-10],[-10,5,0,0,0,0,5,-10],[-20,-10,-10,-10,-10,-10,-10,-20]],
      R:[[0,0,0,0,0,0,0,0],[5,10,10,10,10,10,10,5],[-5,0,0,0,0,0,0,-5],[-5,0,0,0,0,0,0,-5],[-5,0,0,0,0,0,0,-5],[-5,0,0,0,0,0,0,-5],[-5,0,0,0,0,0,0,-5],[0,0,0,5,5,0,0,0]],
      Q:[[-20,-10,-10,-5,-5,-10,-10,-20],[-10,0,0,0,0,0,0,-10],[-10,0,5,5,5,5,0,-10],[-5,0,5,5,5,5,0,-5],[0,0,5,5,5,5,0,-5],[-10,5,5,5,5,5,0,-10],[-10,0,5,0,0,0,0,-10],[-20,-10,-10,-5,-5,-10,-10,-20]],
      K:[[-30,-40,-40,-50,-50,-40,-40,-30],[-30,-40,-40,-50,-50,-40,-40,-30],[-30,-40,-40,-50,-50,-40,-40,-30],[-30,-40,-40,-50,-50,-40,-40,-30],[-20,-30,-30,-40,-40,-30,-30,-20],[-10,-20,-20,-20,-20,-20,-20,-10],[20,20,0,0,0,0,20,20],[20,30,10,0,0,10,30,20]]
    };
  }
  
  eval(board){
    let s=0;
    for(let r=0;r<8;r++)for(let c=0;c<8;c++){
      const p=board[r][c];if(!p)continue;
      const co=p[0],ty=p[1],row=co==='w'?r:7-r;
      s+=(co==='w'?1:-1)*(this.PV[ty]+(this.PT[ty]?this.PT[ty][row][c]:0));
    }
    return s;
  }
  
  mm(eng,board,depth,alpha,beta,max,cas,ep){
    const co=max?'w':'b';
    const legal=eng.getLegal(board,co,cas,ep);
    
    if(depth===0||!legal.length){
      if(!legal.length){if(eng.isInCheck(board,co))return max?-100000+(this.depth-depth):100000-(this.depth-depth);return 0;}
      return this.eval(board);
    }
    
    legal.sort((a,b)=>(b.capture?1:0)-(a.capture?1:0));
    
    if(max){
      let best=-Infinity;
      for(const m of legal){
        const{board:nb,castling:nc,enPassant:nep}=eng.applyMove(board,m,cas,ep);
        const s=this.mm(eng,nb,depth-1,alpha,beta,false,nc,nep);
        best=Math.max(best,s);
        alpha=Math.max(alpha,best);
        if(beta<=alpha)break;
      }
      return best;
    }else{
      let best=Infinity;
      for(const m of legal){
        const{board:nb,castling:nc,enPassant:nep}=eng.applyMove(board,m,cas,ep);
        const s=this.mm(eng,nb,depth-1,alpha,beta,true,nc,nep);
        best=Math.min(best,s);
        beta=Math.min(beta,best);
        if(beta<=alpha)break;
      }
      return best;
    }
  }
  
  // BUG-01 FIX: Renamed from getBest to getBestMove
  getBestMove(eng){
    const co=eng.turn;
    const legal=eng.getLegal(eng.board,co,eng.castling,eng.enPassant);
    if(!legal.length)return null;
    
    // Shuffle slightly to add variety to AI moves
    for(let i=legal.length-1;i>0;i--){
      const j=Math.floor(Math.random()*(i+1));
      [legal[i],legal[j]]=[legal[j],legal[i]];
    }
    
    let best=legal[0]; 
    let bestS=co==='w'?-Infinity:Infinity;
    
    for(const m of legal){
      const{board:nb,castling:nc,enPassant:nep}=eng.applyMove(eng.board,m,eng.castling,eng.enPassant);
      const s=this.mm(eng,nb,this.depth-1,-Infinity,Infinity,co!=='w',nc,nep);
      if(co==='w'?s>bestS:s<bestS){bestS=s;best=m;}
    }
    
    return best;
  }
}