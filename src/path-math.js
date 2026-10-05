/* Pure path/curve math: no DOM access, safe to import in Node. */
export const lerp=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
export const dc=(p,t)=>p.length===1?p[0]:dc(p.slice(1).map((q,k)=>lerp(p[k],q,t)),t);
export const split=(p,t)=>{const L=[],R=[];let q=p;while(q.length){L.push(q[0]);R.unshift(q.at(-1));q=q.slice(1).map((v,k)=>lerp(q[k],v,t))}return [L,R]};
export const NARGS={M:2,L:2,H:1,V:1,C:6,S:4,Q:4,T:2,A:7,Z:0};
/* d string -> absolute segments {t:M|L|C|Q|A|Z, pts:[[x,y]..], arc?}. H/V->L, S->C, T->Q. */
export function parsePath(d){
  const tk=d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g)||[],out=[];
  let i=0,cmd=null,x=0,y=0,sx=0,sy=0,lc=null,lq=null;
  while(i<tk.length){
    if(/[a-zA-Z]/.test(tk[i]))cmd=tk[i++];
    const U=cmd&&cmd.toUpperCase(),n=NARGS[U]; if(n===undefined)break;
    const rel=cmd!==U,a=tk.slice(i,i+n).map(Number); i+=n; if(a.length<n||a.some(isNaN))break;
    const X=v=>rel?x+v:v,Y=v=>rel?y+v:v; let nc=null,nq=null;
    switch(U){
      case 'Z': out.push({t:'Z',pts:[]});x=sx;y=sy;cmd=null;break;
      case 'M': x=X(a[0]);y=Y(a[1]);sx=x;sy=y;out.push({t:'M',pts:[[x,y]]});cmd=rel?'l':'L';break;
      case 'L': x=X(a[0]);y=Y(a[1]);out.push({t:'L',pts:[[x,y]]});break;
      case 'H': x=X(a[0]);out.push({t:'L',pts:[[x,y]]});break;
      case 'V': y=Y(a[0]);out.push({t:'L',pts:[[x,y]]});break;
      case 'C': {const p=[[X(a[0]),Y(a[1])],[X(a[2]),Y(a[3])],[X(a[4]),Y(a[5])]];out.push({t:'C',pts:p});nc=p[1];[x,y]=p[2];break}
      case 'S': {const p=[lc?[2*x-lc[0],2*y-lc[1]]:[x,y],[X(a[0]),Y(a[1])],[X(a[2]),Y(a[3])]];out.push({t:'C',pts:p});nc=p[1];[x,y]=p[2];break}
      case 'Q': {const p=[[X(a[0]),Y(a[1])],[X(a[2]),Y(a[3])]];out.push({t:'Q',pts:p});nq=p[0];[x,y]=p[1];break}
      case 'T': {const c=lq?[2*x-lq[0],2*y-lq[1]]:[x,y],p=[c,[X(a[0]),Y(a[1])]];out.push({t:'Q',pts:p});nq=c;[x,y]=p[1];break}
      case 'A': x=X(a[5]);y=Y(a[6]);out.push({t:'A',arc:a.slice(0,5),pts:[[x,y]]});break;
    }
    lc=nc;lq=nq;
  }
  return out;
}
/* SVG arc endpoint -> centre parameterization (SVG spec F.6.5). Returns null for degenerate arcs. */
export function arcGeom(p,e,rx,ry,deg,fa,fs){
  rx=Math.abs(rx);ry=Math.abs(ry);if(!rx||!ry||(p[0]===e[0]&&p[1]===e[1]))return null;
  const phi=deg*Math.PI/180,c=Math.cos(phi),s=Math.sin(phi),dx=(p[0]-e[0])/2,dy=(p[1]-e[1])/2;
  const x1=c*dx+s*dy,y1=-s*dx+c*dy,lam=x1*x1/(rx*rx)+y1*y1/(ry*ry);
  if(lam>1){const k=Math.sqrt(lam);rx*=k;ry*=k}
  const den=rx*rx*y1*y1+ry*ry*x1*x1;let co=den?Math.sqrt(Math.max(0,(rx*rx*ry*ry-den)/den)):0;
  if(!!fa===!!fs)co=-co;
  const cxp=co*rx*y1/ry,cyp=-co*ry*x1/rx,cx=c*cxp-s*cyp+(p[0]+e[0])/2,cy=s*cxp+c*cyp+(p[1]+e[1])/2;
  const ang=(ux,uy,vx,vy)=>Math.atan2(ux*vy-uy*vx,ux*vx+uy*vy);
  const ux=(x1-cxp)/rx,uy=(y1-cyp)/ry,th1=ang(1,0,ux,uy);let dth=ang(ux,uy,(-x1-cxp)/rx,(-y1-cyp)/ry);
  if(!fs&&dth>0)dth-=2*Math.PI;else if(fs&&dth<0)dth+=2*Math.PI;
  return {cx,cy,rx,ry,phi,c,s,th1,dth,pt:t=>[cx+rx*Math.cos(t)*c-ry*Math.sin(t)*s,cy+rx*Math.cos(t)*s+ry*Math.sin(t)*c]};
}
