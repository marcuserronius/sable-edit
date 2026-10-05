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
/* Arc editing: given the fixed endpoints P,E and the current arc params [rx,ry,phi,fa,fs], return new params after
   dragging one handle to point p (local coords). Pure so it can be unit-tested.
   kind: 'rx' | 'ry' (that radius only), 'rot' (rotation only), 'flip' (pick the large-arc/sweep combo nearest p).
   opts.gap: how far the rx/ry handles sit beyond the ellipse (the rotation handle sits that far out on the -x side);
   opts.shift: keep circular (rx/ry) or snap to 15 degrees (rot).
   The centre is derived from the endpoints, so it moves whenever a parameter changes. Rather than aim the handle at the
   pointer from the old centre (which makes it lag and wobble), we solve for the value that puts the handle under it. */
export function arcFit(P,E,arc,kind,p,opts={}){
  const gap=opts.gap||0,r3=v=>+v.toFixed(3);let [rx,ry,phi,fa,fs]=arc;
  const g0=arcGeom(P,E,rx,ry,phi,fa,fs);if(!g0)return arc;
  if(kind==='flip'){
    const dist=q=>{const m=q.pt(q.th1+q.dth/2);return Math.hypot(m[0]-p[0],m[1]-p[1])};
    let best=[fa,fs],bd=dist(g0);
    for(const a of [0,1])for(const s of [0,1]){const q=arcGeom(P,E,rx,ry,phi,a,s);if(q&&dist(q)<bd-1e-6){bd=dist(q);best=[a,s]}}
    return [rx,ry,phi,best[0],best[1]];
  }
  rx=g0.rx;ry=g0.ry; // bake in radii the SVG spec scaled up to fit, so the drag starts from what is drawn
  if(kind==='rot'){
    for(let n=0;n<12;n++){const q=arcGeom(P,E,rx,ry,phi,fa,fs);if(!q)break;phi=Math.atan2(p[1]-q.cy,p[0]-q.cx)*180/Math.PI+180}
    if(opts.shift)phi=Math.round(phi/15)*15;
  }else{
    const X=kind==='rx',t0=X?rx:ry,sh=opts.shift;
    /* Smallest value the dragged radius can take before the SVG spec starts scaling the whole ellipse up to span the
       chord. Below that the drawn shape no longer depends on the handle (rx=60 and rx=0.1 look alike, and the other radius
       gets inflated by the scale factor), so there is nothing to solve for: the handle just stops there. In the chord's
       frame (x1,y1 = half-chord along the axes) the arc fits while x1^2/rx^2 + y1^2/ry^2 <= 1. */
    const c=g0.c,s_=g0.s,hx=(P[0]-E[0])/2,hy=(P[1]-E[1])/2,x1=c*hx+s_*hy,y1=-s_*hx+c*hy;
    const lo=sh?Math.hypot(x1,y1):(()=>{const [a,o,oth]=X?[x1,y1,ry]:[y1,x1,rx],k=1-(o/oth)**2;return k>1e-12?Math.abs(a)/Math.sqrt(k):0})();
    const tmin=Math.max(Math.ceil(lo*1000)/1000,.1);
    // residual: how far the drawn handle is from the pointer, measured along the handle's own axis
    const res=t=>{
      const q=arcGeom(P,E,X||sh?t:rx,!X||sh?t:ry,phi,fa,fs);if(!q)return NaN;
      const dx=p[0]-q.cx,dy=p[1]-q.cy;
      return X?dx*q.c+dy*q.s-gap-q.rx:-dx*q.s+dy*q.c-gap-q.ry;
    };
    let v=tmin;
    if(res(tmin)>0){ // pointer is beyond the minimum: bracket the root on a log grid, keep the one nearest the current value
      const hi=50*(Math.hypot(E[0]-P[0],E[1]-P[1])+t0+tmin),N=160,k=Math.pow(hi/tmin,1/N);
      let best=null,prev={t:tmin,f:res(tmin)};
      for(let n=1,t=tmin*k;n<=N;n++,t*=k){
        const f=res(t);if(isNaN(f))continue;
        if((prev.f<0)!==(f<0)){
          let a=prev.t,b=t,fa_=prev.f;
          for(let m=0;m<40;m++){const mid=(a+b)/2,fm=res(mid);if((fm<0)===(fa_<0)){a=mid;fa_=fm}else b=mid}
          const r=(a+b)/2;if(best===null||Math.abs(r-t0)<Math.abs(best-t0))best=r;
        }
        prev={t,f};
      }
      v=best??hi;
    }
    if(X||sh)rx=v;if(!X||sh)ry=v;
  }
  phi=((phi+180)%360+360)%360-180;
  return [r3(rx),r3(ry),r3(phi),fa,fs];
}