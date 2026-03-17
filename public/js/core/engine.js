export class Chess {
  constructor() { this.reset(); }
  reset() {
    this.board=[
      ['bR','bN','bB','bQ','bK','bB','bN','bR'],
      ['bP','bP','bP','bP','bP','bP','bP','bP'],
      [null,null,null,null,null,null,null,null],[null,null,null,null,null,null,null,null],
      [null,null,null,null,null,null,null,null],[null,null,null,null,null,null,null,null],
      ['wP','wP','wP','wP','wP','wP','wP','wP'],
      ['wR','wN','wB','wQ','wK','wB','wN','wR']
    ];
    this.turn='w'; this.castling={wK:true,wQ:true,bK:true,bQ:true};
    this.enPassant=null; 
    this.moveHistory=[]; // BUG-03 FIX
    this.status='playing';
    this.half=0; 
    this.capturedPieces={w:[],b:[]}; // BUG-02 FIX
  }
  col(p){return p?p[0]:null;}
  opp(c){return c==='w'?'b':'w';}
  inB(r,c){return r>=0&&r<8&&c>=0&&c<8;}
  clone(){
    const g=new Chess();
    g.board=this.board.map(r=>[...r]); g.turn=this.turn;
    g.castling={...this.castling}; g.enPassant=this.enPassant?[...this.enPassant]:null;
    g.moveHistory=[...this.moveHistory]; g.status=this.status; g.half=this.half;
    g.capturedPieces={w:[...this.capturedPieces.w],b:[...this.capturedPieces.b]};
    return g;
  }
  findKing(board,color){
    for(let r=0;r<8;r++)for(let c=0;c<8;c++)if(board[r][c]===color+'K')return[r,c];
    return null;
  }
  
  isAttacked(board,row,col,by){
    const op=by;
    const pr=op==='w'?row+1:row-1;
    
    for(const dc of[-1,1]) if(this.inB(pr,col+dc) && board[pr][col+dc]===op+'P') return true;
    
    for(const[dr,dc]of[[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
      if(this.inB(row+dr,col+dc) && board[row+dr][col+dc]===op+'N') return true;
    }
    
    for(const[dr,dc]of[[-1,0],[1,0],[0,-1],[0,1]]){
      let nr=row+dr, nc=col+dc;
      while(this.inB(nr,nc)){
        const piece = board[nr][nc];
        if(piece){
          if(piece===op+'R' || piece===op+'Q') return true;
          break;
        }
        nr+=dr; nc+=dc;
      }
    }
    
    for(const[dr,dc]of[[-1,-1],[-1,1],[1,-1],[1,1]]){
      let nr=row+dr, nc=col+dc;
      while(this.inB(nr,nc)){
        const piece = board[nr][nc];
        if(piece){
          if(piece===op+'B' || piece===op+'Q') return true;
          break;
        }
        nr+=dr; nc+=dc;
      }
    }
    
    for(const[dr,dc]of[[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) {
      if(this.inB(row+dr,col+dc) && board[row+dr][col+dc]===op+'K') return true;
    }
      
    return false;
  }
  
  isInCheck(board,color){const k=this.findKing(board,color);return k?this.isAttacked(board,k[0],k[1],this.opp(color)):false;}
  pseudoMoves(board,r,c,ep,cas){
    const p=board[r][c];if(!p)return[];
    const co=p[0],ty=p[1],op=this.opp(co),moves=[];
    const add=(tr,tc,sp,pt)=>{
      if(!this.inB(tr,tc))return;
      if(board[tr][tc]&&this.col(board[tr][tc])===co)return;
      moves.push({from:[r,c],to:[tr,tc],piece:p,capture:board[tr][tc]||null,special:sp,promoteTo:pt});
    };
    const slide=dirs=>{for(const[dr,dc]of dirs){let nr=r+dr,nc=c+dc;while(this.inB(nr,nc)){if(board[nr][nc]){if(this.col(board[nr][nc])!==co)add(nr,nc);break;}add(nr,nc);nr+=dr;nc+=dc;}}};
    if(ty==='P'){
      const d=co==='w'?-1:1,sr=co==='w'?6:1,pr=co==='w'?0:7;
      if(this.inB(r+d,c)&&!board[r+d][c]){
        if(r+d===pr)for(const q of['Q','R','B','N'])moves.push({from:[r,c],to:[r+d,c],piece:p,capture:null,special:'promo',promoteTo:q});
        else{add(r+d,c);if(r===sr&&!board[r+2*d][c])moves.push({from:[r,c],to:[r+2*d,c],piece:p,capture:null,special:'double'});}
      }
      for(const dc of[-1,1]){
        const tr=r+d,tc=c+dc;if(!this.inB(tr,tc))continue;
        if(board[tr][tc]&&this.col(board[tr][tc])===op){
          if(tr===pr)for(const q of['Q','R','B','N'])moves.push({from:[r,c],to:[tr,tc],piece:p,capture:board[tr][tc],special:'promo',promoteTo:q});
          else moves.push({from:[r,c],to:[tr,tc],piece:p,capture:board[tr][tc]});
        }
        if(ep&&ep[0]===tr&&ep[1]===tc)moves.push({from:[r,c],to:[tr,tc],piece:p,capture:op+'P',special:'ep'});
      }
    }else if(ty==='R')slide([[-1,0],[1,0],[0,-1],[0,1]]);
    else if(ty==='B')slide([[-1,-1],[-1,1],[1,-1],[1,1]]);
    else if(ty==='Q')slide([[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]]);
    else if(ty==='N'){for(const[dr,dc]of[[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]])if(this.inB(r+dr,c+dc)&&this.col(board[r+dr][c+dc])!==co)add(r+dr,c+dc);}
    else if(ty==='K'){
      for(const[dr,dc]of[[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]])add(r+dr,c+dc);
      const row=co==='w'?7:0;
      if(r===row&&c===4&&!this.isInCheck(board,co)){
        if(cas[co+'K']&&!board[row][5]&&!board[row][6]&&board[row][7]===co+'R'&&!this.isAttacked(board,row,5,op)&&!this.isAttacked(board,row,6,op))
          moves.push({from:[r,c],to:[row,6],piece:p,capture:null,special:'castleK'});
        if(cas[co+'Q']&&!board[row][3]&&!board[row][2]&&!board[row][1]&&board[row][0]===co+'R'&&!this.isAttacked(board,row,3,op)&&!this.isAttacked(board,row,2,op))
          moves.push({from:[r,c],to:[row,2],piece:p,capture:null,special:'castleQ'});
      }
    }
    return moves;
  }
  applyMove(board,move,cas,ep){
    const nb=board.map(r=>[...r]),nc={...cas};
    let nep=null;
    const[fr,fc]=move.from,[tr,tc]=move.to,p=nb[fr][fc];
    nb[fr][fc]=null;nb[tr][tc]=p;
    if(move.special==='ep')nb[p[0]==='w'?tr+1:tr-1][tc]=null;
    if(move.special==='double')nep=[p[0]==='w'?tr+1:tr-1,tc];
    if(move.special==='promo')nb[tr][tc]=p[0]+move.promoteTo;
    if(move.special==='castleK'){const row=p[0]==='w'?7:0;nb[row][5]=nb[row][7];nb[row][7]=null;}
    if(move.special==='castleQ'){const row=p[0]==='w'?7:0;nb[row][3]=nb[row][0];nb[row][0]=null;}
    if(p==='wK'){nc.wK=false;nc.wQ=false;}if(p==='bK'){nc.bK=false;nc.bQ=false;}
    if(p==='wR'){if(fr===7&&fc===0)nc.wQ=false;if(fr===7&&fc===7)nc.wK=false;}
    if(p==='bR'){if(fr===0&&fc===0)nc.bQ=false;if(fr===0&&fc===7)nc.bK=false;}
    return{board:nb,castling:nc,enPassant:nep};
  }
  getLegal(board,color,cas,ep){
    const legal=[];
    for(let r=0;r<8;r++)for(let c=0;c<8;c++){
      if(!board[r][c]||this.col(board[r][c])!==color)continue;
      for(const m of this.pseudoMoves(board,r,c,ep,cas)){
        const{board:nb}=this.applyMove(board,m,cas,ep);
        if(!this.isInCheck(nb,color))legal.push(m);
      }
    }
    return legal;
  }
  getMovesFrom(r,c){
    if(!this.board[r][c]||this.col(this.board[r][c])!==this.turn)return[];
    return this.getLegal(this.board,this.turn,this.castling,this.enPassant).filter(m=>m.from[0]===r&&m.from[1]===c);
  }
  makeMove(move){
    const{board:nb,castling:nc,enPassant:nep}=this.applyMove(this.board,move,this.castling,this.enPassant);
    this.board=nb;this.castling=nc;this.enPassant=nep;
    
    // BUG-02 FIX: updated property name
    if(move.capture)this.capturedPieces[this.turn].push(move.capture);
    
    // BUG-03 FIX: updated property name
    this.moveHistory.push(move);
    
    this.turn=this.opp(this.turn);
    const legal=this.getLegal(this.board,this.turn,this.castling,this.enPassant);
    const inCk=this.isInCheck(this.board,this.turn);
    if(!legal.length)this.status=inCk?'checkmate':'stalemate';
    else this.status=inCk?'check':'playing';
    this.half=(move.capture||move.piece[1]==='P')?0:this.half+1;
    if(this.half>=100)this.status='draw';
    return legal;
  }
  toAlg(move){
    const f='abcdefgh',r='87654321';
    if(move.special==='castleK')return'O-O';
    if(move.special==='castleQ')return'O-O-O';
    const p=move.piece[1]==='P'?'':(move.piece[1]);
    const ff=move.capture&&move.piece[1]==='P'?f[move.from[1]]:'';
    const cap=move.capture?'x':'';
    return p+ff+cap+f[move.to[1]]+r[move.to[0]]+(move.promoteTo?'='+move.promoteTo:'');
  }
}