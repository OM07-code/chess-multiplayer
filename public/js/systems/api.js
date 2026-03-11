export class APIService {
  constructor(){ 

    this.base = ''; 
  }
  
  async post(path,data){ 
    const r=await fetch(this.base+path,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(data)
    }); 
    return r.json(); 
  }
  
  async get(path){ 
    const r=await fetch(this.base+path); 
    return r.json(); 
  }
}