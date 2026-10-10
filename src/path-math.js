/* Pure path/curve math: no DOM access, safe to import in Node. */
export const lerp=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
export const dc=(p,t)=>p.length===1?p[0]:dc(p.slice(1).map((q,k)=>lerp(p[k],q,t)),t);
export const split=(p,t)=>{const L=[],R=[];let q=p;while(q.length){L.push(q[0]);R.unshift(q.at(-1));q=q.slice(1).map((v,k)=>lerp(q[k],v,t))}return [L,R]};
export const NARGS={M:2,L:2,H:1,V:1,C:6,S:4,Q:4,T:2,A:7,Z:0};
/* d string -> absolute segments {t:M|L|C|Q|A|Z, pts:[[x,y]..], arc?, sm?}. H/V->L, H/V->L (keeping `c:'H'|'V'` as the command it came from), S->C, T->Q; the last two keep `sm:1` (smooth: the
   first control point is the reflection of the previous segment's, so serPath writes them back as S / T). */
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
      case 'H': x=X(a[0]);out.push({t:'L',pts:[[x,y]],c:'H'});break;
      case 'V': y=Y(a[0]);out.push({t:'L',pts:[[x,y]],c:'V'});break;
      case 'C': {const p=[[X(a[0]),Y(a[1])],[X(a[2]),Y(a[3])],[X(a[4]),Y(a[5])]];out.push({t:'C',pts:p});nc=p[1];[x,y]=p[2];break}
      case 'S': {const p=[lc?[2*x-lc[0],2*y-lc[1]]:[x,y],[X(a[0]),Y(a[1])],[X(a[2]),Y(a[3])]];out.push({t:'C',pts:p,sm:1});nc=p[1];[x,y]=p[2];break}
      case 'Q': {const p=[[X(a[0]),Y(a[1])],[X(a[2]),Y(a[3])]];out.push({t:'Q',pts:p});nq=p[0];[x,y]=p[1];break}
      case 'T': {const c=lq?[2*x-lq[0],2*y-lq[1]]:[x,y],p=[c,[X(a[0]),Y(a[1])]];out.push({t:'Q',pts:p,sm:1});nq=c;[x,y]=p[1];break}
      case 'A': x=X(a[5]);y=Y(a[6]);out.push({t:'A',arc:a.slice(0,5),pts:[[x,y]]});break;
    }
    lc=nc;lq=nq;
  }
  return out;
}
/* segments -> d string (inverse of parsePath, 3-decimal rounding). An L with `c` is written as H / V while it is still horizontal / vertical. A C / Q flagged `sm` is written as S / T when its first control point really is
   the reflection the short form implies; otherwise (the flag went stale) it is written out in full. */
export function serPath(segs){
  const info=segInfo(segs),f=n=>+n.toFixed(3),v=a=>a.map(f).join(' ');
  return segs.map((s,i)=>{
    if(s.t==='Z')return 'Z';
    if(s.t==='L'&&s.c&&info[i].from){ // an L that came from (or was judged to be) an H / V and still is one
      const [x0,y0]=info[i].from,[x,y]=s.pts[0];
      if(s.c==='H'&&f(y)===f(y0))return 'H'+f(x);if(s.c==='V'&&f(x)===f(x0))return 'V'+f(y);
    }
    if(s.sm&&(s.t==='C'||s.t==='Q')){const e=smoothCtl(segs,i,info);if(e&&near(e,s.pts[0]))return (s.t==='C'?'S':'T')+v(s.pts.slice(1).flat())}
    return s.t+(s.arc?s.arc.join(' ')+' ':'')+v(s.pts.flat());
  }).join(' ');
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
/* ---- segment-level helpers for the path editor (pure) ---- */
const same=(a,b)=>Math.abs(a[0]-b[0])<1e-9&&Math.abs(a[1]-b[1])<1e-9;
const clone=s=>({...s,pts:s.pts.map(p=>[...p]),...(s.arc?{arc:[...s.arc]}:{})});
/* per segment: where the pen is when it starts (from) and where the segment ends (to). M: both are its point; Z: to is the subpath start. */
export function segInfo(segs){
  const out=[];let cur=null,sx=null;
  for(const s of segs){
    if(s.t==='M'){cur=sx=s.pts[0];out.push({from:cur,to:cur});continue}
    const to=s.t==='Z'?sx:s.pts.at(-1);out.push({from:cur,to});cur=to;
  }
  return out;
}
/* d string of just segment i (a drawing segment or Z), for highlighting it */
export function segD(segs,i){
  const s=segs[i],f=segInfo(segs)[i];if(!s||s.t==='M'||!f.from)return '';
  const v=a=>a.map(n=>+n.toFixed(3)).join(' ');
  return 'M'+v(f.from)+(s.t==='Z'?' L'+v(f.to):' '+s.t+(s.arc?v(s.arc)+' ':'')+v(s.pts.flat()));
}
/* the segment whose curve passes closest to p -> {i, t (0..1 along it), d (distance), cp (control points, none for arcs)} or null.
   Zero-length edges are skipped (a Z that closes onto the start has nothing to hit); opts.arcs:false leaves arcs out. */
export function nearestSeg(segs,p,opts={}){
  const info=segInfo(segs);let best=null;
  segs.forEach((s,i)=>{
    if(s.t==='M')return;const {from,to}=info[i];if(!from||(s.t==='Z'||s.t==='L')&&same(from,to))return;
    let at,cp=null;
    if(s.t==='A'){
      if(opts.arcs===false)return;const g=arcGeom(from,to,...s.arc);
      at=g?t=>g.pt(g.th1+g.dth*t):t=>lerp(from,to,t);
    }else{cp=s.t==='Z'||s.t==='L'?[from,to]:[from,...s.pts];at=t=>dc(cp,t)}
    for(let k=1;k<32;k++){const q=at(k/32),d=Math.hypot(q[0]-p[0],q[1]-p[1]);if(!best||d<best.d)best={d,i,t:k/32,cp}}
  });
  return best;
}
/* drop what a deletion leaves behind: an M with nothing drawn after it, and a Z that no longer closes anything */
const tidy=a=>{
  const r=[];let skipZ=false;
  a.forEach((s,k)=>{
    const n=a[k+1];
    if(s.t==='M'&&(!n||n.t==='M'||n.t==='Z')){skipZ=true;return}
    if(s.t==='Z'&&(skipZ||!r.length||r.at(-1).t==='Z'))return;
    skipZ=false;r.push(s);
  });
  return r;
};
/* Delete the nodes at segment indices idxs (pinned ones, a Set of indices, are skipped): the neighbours join up and each
   remaining segment keeps its own curve. Deleting a subpath's first node promotes the next one to M. Refuses (null) when
   nothing can go or fewer than two nodes would be left. */
export function deleteNodes(segs,idxs,pinned=new Set()){
  const out=segs.map(clone),del=[...idxs].filter(i=>out[i]&&out[i].t!=='Z'&&!pinned.has(i)).sort((a,b)=>b-a);
  if(!del.length||out.filter(s=>s.t!=='Z').length-del.length<2)return null;
  for(const i of del){
    if(out[i].t==='M'){const n=out[i+1];if(n&&n.t!=='Z'&&n.t!=='M'){n.t='M';n.pts=[n.pts.at(-1)];delete n.arc}}
    out.splice(i,1);if(out[i]&&out[i].t==='L')out[i].dirty=1; // its start moved: see retype
  }
  return tidy(out);
}
/* Delete the segments at indices idxs: the path is cut there. An open subpath falls apart into pieces; a closed one is opened
   (it becomes a single open subpath that starts where the cut ends, the Z's closing line turned into a real L). Returns the
   new segments, or null when nothing was cut or nothing would be left. */
export function deleteSegments(segs,idxs){
  const want=new Set(idxs),info=segInfo(segs),out=[];let did=false,i=0;
  while(i<segs.length){
    if(segs[i].t!=='M'){out.push(clone(segs[i]));i++;continue}
    let j=i+1;while(j<segs.length&&segs[j].t!=='M')j++;
    const z=segs.findIndex((s,k)=>k>i&&k<j&&s.t==='Z'),keep=()=>{for(let k=i;k<j;k++)out.push(clone(segs[k]))};
    if(z>=0&&z!==j-1){keep();i=j;continue} // a subpath that carries on after its Z: left alone
    const E=[];
    for(let k=i+1;k<j;k++)if(segs[k].t!=='Z')E.push({idx:k,seg:clone(segs[k]),from:info[k].from});
    if(z>=0&&!same(info[z].from,info[z].to))E.push({idx:z,seg:{t:'L',pts:[[...info[z].to]],dirty:1},from:info[z].from});
    const first=E.findIndex(e=>want.has(e.idx));
    if(first<0){keep();i=j;continue}
    did=true;
    const ring=z>=0?[...E.slice(first+1),...E.slice(0,first+1)]:E; // closed: start just after a cut so no piece wraps round
    let run=null;
    for(const e of ring){
      if(want.has(e.idx)){run=null;continue}
      if(!run){out.push({t:'M',pts:[[...e.from]]});run=1}
      out.push(e.seg);
    }
    i=j;
  }
  const r=tidy(out);return did&&r.length?r:null;
}
/* the same for a plain point list (polygon / polyline): idxs are point indices, min the fewest points allowed to remain */
export function deletePoints(pts,idxs,min,pinned=new Set()){
  const rm=new Set([...idxs].filter(i=>i>=0&&i<pts.length&&!pinned.has(i)));
  return rm.size&&pts.length-rm.size>=min?pts.filter((_,i)=>!rm.has(i)):null;
}

/* ---- smooth / symmetric nodes (pure) ----
   A node between two curves has a handle on each side. Three kinds, told apart from the geometry alone:
     corner     - the handles point wherever they like
     smooth     - the handles lie on one line through the node, on opposite sides, at different lengths (the tangent is continuous)
     symmetric  - smooth, and the same length (the S / T form of the path syntax; a C / Q flagged `sm` always counts)
   A handle is {i, k}: control point k of segment i. */
const near=(a,b)=>Math.abs(a[0]-b[0])<=0.01&&Math.abs(a[1]-b[1])<=0.01;
const refl=(h,n)=>[2*n[0]-h[0],2*n[1]-h[1]],vec=(a,b)=>[a[0]-b[0],a[1]-b[1]],vlen=v=>Math.hypot(v[0],v[1]);
/* where the first control point of segment i has to be for its S / T form to describe it (the previous segment's, reflected) */
function smoothCtl(segs,i,info){
  const s=segs[i],p=segs[i-1];
  if(s.t==='C')return p&&p.t==='C'?refl(p.pts[1],info[i-1].to):info[i].from;
  if(s.t==='Q')return p&&p.t==='Q'?refl(p.pts[0],info[i-1].to):info[i].from;
  return null;
}
/* in place: drop `sm` flags that no longer describe the geometry (after nodes were deleted, say) */
export function healSmooth(segs){
  const info=segInfo(segs);
  segs.forEach((s,i)=>{if(!s.sm)return;const e=(s.t==='C'||s.t==='Q')&&smoothCtl(segs,i,info);if(!e||!near(e,s.pts[0]))delete s.sm});
  return segs;
}
/* in place: re-derive the first control point of every `sm` segment, in order, so a chain of them follows its head */
export function fixSmooth(segs){
  const info=segInfo(segs);
  segs.forEach((s,i)=>{if(!s.sm)return;const e=smoothCtl(segs,i,info);if(e&&(s.t==='C'||s.t==='Q'))s.pts[0]=e;else delete s.sm});
  return segs;
}
/* the two handles that meet at node j (a segment index, never a Z): {n, a (the one on the incoming side), b (outgoing), flag}, either may be
   null (a line, an arc, the end of the path). A closed subpath whose last point sits on its start joins its last and first segments.
   flag: the segment whose first control point is `b`, when that is j+1 (the one that can carry `sm`), else -1. */
export function nodeHandles(segs,j,info=segInfo(segs)){
  const s=segs[j];if(!s||s.t==='Z')return null;
  let m=j;while(m>0&&segs[m].t!=='M')m--;
  let z=-1,e=-1;for(let k=m+1;k<segs.length&&segs[k].t!=='M';k++){if(segs[k].t==='Z'){z=k;break}e=k}
  const wrap=z>=0&&e>m&&near(info[e].to,info[m].to);
  const endH=i=>{const q=segs[i];return q&&q.t==='C'?{i,k:1}:q&&q.t==='Q'?{i,k:0}:null};
  const startH=i=>{const q=segs[i];return q&&(q.t==='C'||q.t==='Q')?{i,k:0}:null};
  const a=s.t==='M'?(wrap?endH(e):null):endH(j);
  const b=wrap&&j===e?startH(m+1):startH(j+1);
  return {n:info[j].to,a,b,flag:b&&b.i===j+1?b.i:-1};
}
export function nodeType(segs,j,info=segInfo(segs)){
  const h=nodeHandles(segs,j,info);if(!h||!h.a||!h.b)return null;
  if(h.flag>=0&&segs[h.flag].sm)return 'symmetric';
  const A=vec(segs[h.a.i].pts[h.a.k],h.n),B=vec(segs[h.b.i].pts[h.b.k],h.n),la=vlen(A),lb=vlen(B);
  if(la<0.005||lb<0.005)return 'corner';
  if(Math.abs(A[0]*B[1]-A[1]*B[0])/(la*lb)>0.005||A[0]*B[0]+A[1]*B[1]>=0)return 'corner';
  return Math.abs(la-lb)<=Math.max(0.005,0.001*Math.max(la,lb))?'symmetric':'smooth';
}
/* what dragging handle (i,k) has to keep in step: one link per node it hangs off (a cubic's handle hangs off one, a quadratic's off two) */
export function handleLinks(segs,i,k){
  const info=segInfo(segs),s=segs[i];if(!s||(s.t!=='C'&&s.t!=='Q'))return [];
  let m=i-1;while(m>=0&&segs[m].t==='Z')m--;
  const nodes=s.t==='Q'?[m,i]:k===0?[m]:[i],out=[];
  for(const j of nodes){
    const h=j>=0&&nodeHandles(segs,j,info);if(!h||!h.a||!h.b)continue;
    const mine=h.a.i===i&&h.a.k===k?'a':h.b.i===i&&h.b.k===k?'b':null;if(!mine)continue;
    const part=mine==='a'?h.b:h.a;
    out.push({node:h.n,partner:part,type:nodeType(segs,j,info),len:vlen(vec(segs[part.i].pts[part.k],h.n)),flag:h.flag});
  }
  return out;
}
/* Move handle (i,k) to p and bring its partners along (in place). force: 'free' = move it alone and break the link (drops `sm`),
   'sym' = make the partners mirror it (and mark them `sm` where the S / T form can say so), none = keep each node as it was. */
export function dragHandle(segs,i,k,p,links,force){
  segs[i].pts[k]=p;
  for(const L of links){
    const mode=force==='free'?'corner':force==='sym'?'symmetric':L.type,q=segs[L.partner.i];
    if(mode==='symmetric')q.pts[L.partner.k]=refl(p,L.node);
    else if(mode==='smooth'){const v=vec(L.node,p),d=vlen(v);if(d>1e-6)q.pts[L.partner.k]=[L.node[0]+v[0]/d*L.len,L.node[1]+v[1]/d*L.len]}
    if(L.flag>=0){
      if(force==='free')delete segs[L.flag].sm;
      else if(force==='sym'&&segs[L.flag].t===segs[L.flag-1]?.t)segs[L.flag].sm=1;
    }
  }
}
/* make node j 'corner' (handles untouched, S / T form dropped), 'smooth' (the outgoing handle swings onto the line of the incoming one, keeping
   its length) or 'symmetric' (the outgoing handle becomes the incoming one's mirror image). New segments, or null when the node has no
   handle on one side. */
export function setNodeType(segs,j,type){
  const h=nodeHandles(segs,j);if(!h||!h.a||!h.b)return null;
  const out=segs.map(clone),A=out[h.a.i].pts[h.a.k],B=out[h.b.i],la=vlen(vec(A,h.n)),lb=vlen(vec(B.pts[h.b.k],h.n));
  if(type==='corner'){if(h.flag>=0)delete out[h.flag].sm}
  else if(type==='smooth'){
    if(la<0.005)return null;const L=lb<0.005?la:lb;
    B.pts[h.b.k]=[h.n[0]-(A[0]-h.n[0])/la*L,h.n[1]-(A[1]-h.n[1])/la*L];
  }else if(type==='symmetric'){
    B.pts[h.b.k]=refl(A,h.n);if(h.flag>=0&&out[h.flag].t===out[h.flag-1]?.t)out[h.flag].sm=1;
  }else return null;
  return healSmooth(out);
}

/* ---- line commands and segment types (pure) ----
   An L parsed from H / V keeps that as `c`, and nothing re-decides it just because some other segment was edited. Code that changes a
   segment marks it `dirty`; retype then picks the shortest command for each dirty line: H when it is horizontal, V when vertical, else L. */
export function retype(segs){
  const info=segInfo(segs),f=n=>+n.toFixed(3);
  segs.forEach((s,i)=>{
    if(!s.dirty)return;delete s.dirty;
    if(s.t!=='L'){delete s.c;return}
    const [x0,y0]=info[i].from||[NaN,NaN],[x,y]=s.pts[0];
    if(f(y)===f(y0)&&f(x)!==f(x0))s.c='H';else if(f(x)===f(x0)&&f(y)!==f(y0))s.c='V';else delete s.c;
  });
  return segs;
}
const lerp2=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t],unit=v=>{const d=Math.hypot(v[0],v[1]);return d>1e-9?[v[0]/d,v[1]/d]:null};
/* unit direction the path is heading in as segment i ends, or null */
function endTangent(segs,i,info){
  const q=segs[i];if(!q||q.t==='M'||q.t==='Z')return null;
  const {from,to}=info[i];
  if(q.t==='C')return unit(vec(q.pts[2],q.pts[1]))||unit(vec(q.pts[2],q.pts[0]))||unit(vec(to,from));
  if(q.t==='Q')return unit(vec(q.pts[1],q.pts[0]))||unit(vec(to,from));
  if(q.t==='A'){
    const g=arcGeom(from,to,...q.arc);if(!g)return unit(vec(to,from));
    const t=g.th1+g.dth,sg=Math.sign(g.dth)||1,sn=Math.sin(t),cs=Math.cos(t);
    return unit([sg*(-g.rx*sn*g.c-g.ry*cs*g.s),sg*(-g.rx*sn*g.s+g.ry*cs*g.c)]);
  }
  return unit(vec(to,from));
}
/* the circular arc from `from` to `to` through `mid`, as arc parameters, or null when the three are in a line */
export function arcThrough(from,mid,to){
  const [ax,ay]=from,[bx,by]=mid,[cx,cy]=to,d=2*(ax*(by-cy)+bx*(cy-ay)+cx*(ay-by));
  const sc=Math.hypot(cx-ax,cy-ay);if(Math.abs(d)<1e-6*sc*sc)return null;
  const a2=ax*ax+ay*ay,b2=bx*bx+by*by,c2=cx*cx+cy*cy,ux=(a2*(by-cy)+b2*(cy-ay)+c2*(ay-by))/d,uy=(a2*(cx-bx)+b2*(ax-cx)+c2*(bx-ax))/d,R=Math.hypot(ax-ux,ay-uy);
  const m=vec(mid,from),n=vec(to,mid);
  return [R,R,0,(vec(from,mid)[0]*vec(to,mid)[0]+vec(from,mid)[1]*vec(to,mid)[1])>0?1:0,m[0]*n[1]-m[1]*n[0]>0?1:0];
}
/* the circular arc from `from` to `to` that leaves `from` heading along unit vector d, or null when that is the chord's own direction */
function arcTangent(from,to,d){
  const ch=vec(to,from),cr=d[0]*ch[1]-d[1]*ch[0],L2=ch[0]*ch[0]+ch[1]*ch[1];
  if(Math.abs(cr)<1e-6*Math.sqrt(L2))return null;
  const R=L2/(2*Math.abs(cr));return [R,R,0,d[0]*ch[0]+d[1]*ch[1]<0?1:0,cr>0?1:0];
}
/* an arc, in cubic or quadratic pieces (cubics: up to 90 degrees each; quadratics: up to 45) */
function arcPieces(g,to,quad){
  const n=Math.max(1,Math.ceil(Math.abs(g.dth)/(quad?Math.PI/4:Math.PI/2)-1e-9)),st=g.dth/n,out=[];
  const d=t=>[-g.rx*Math.sin(t)*g.c-g.ry*Math.cos(t)*g.s,-g.rx*Math.sin(t)*g.s+g.ry*Math.cos(t)*g.c];
  for(let j=0;j<n;j++){
    const t1=g.th1+j*st,t2=t1+st,P2=j===n-1?to:g.pt(t2);
    if(quad){const m=g.pt(t1+st/2),k=1/Math.cos(st/2);out.push({t:'Q',pts:[[g.cx+(m[0]-g.cx)*k,g.cy+(m[1]-g.cy)*k],P2]})}
    else{const k=4/3*Math.tan(st/4),P1=g.pt(t1),D1=d(t1),D2=d(t2);out.push({t:'C',pts:[[P1[0]+k*D1[0],P1[1]+k*D1[1]],[P2[0]-k*D2[0],P2[1]-k*D2[1]],P2]})}
  }
  return out;
}
/* segment i as type L / Q / C / A (an array of segments: an arc of more than a quarter turn becomes several curves), or null when it already is that type.
   Quadratic -> cubic is exact; cubic -> quadratic and anything -> arc are best fits (an arc is fitted through the curve's midpoint; a line becomes an
   arc tangent to the segment before it when there is one, else a one radian arc); a line becomes a straight curve (control points at the middle, or the
   thirds). */
export function convertSegment(segs,i,type,info=segInfo(segs)){
  const s=segs[i];if(!s||s.t==='M'||s.t==='Z'||s.t===type)return null;
  const {from,to}=info[i],g=s.t==='A'?arcGeom(from,to,...s.arc):null,cp=s.t==='C'||s.t==='Q'?[from,...s.pts]:null;
  if(type==='L')return [{t:'L',pts:[[...to]]}];
  if(type==='Q'){
    if(s.t==='L'||(s.t==='A'&&!g))return [{t:'Q',pts:[lerp2(from,to,.5),[...to]]}];
    if(s.t==='C'){const [a,b]=s.pts;return [{t:'Q',pts:[[(3*(a[0]+b[0])-from[0]-to[0])/4,(3*(a[1]+b[1])-from[1]-to[1])/4],[...to]]}]}
    return arcPieces(g,to,true);
  }
  if(type==='C'){
    if(s.t==='L'||(s.t==='A'&&!g))return [{t:'C',pts:[lerp2(from,to,1/3),lerp2(from,to,2/3),[...to]]}];
    if(s.t==='Q'){const c=s.pts[0];return [{t:'C',pts:[lerp2(from,c,2/3),lerp2(to,c,2/3),[...to]]}]}
    return arcPieces(g,to,false);
  }
  if(type==='A'){
    let a=cp&&arcThrough(from,dc(cp,.5),to);
    if(!a){const d=i>0&&endTangent(segs,i-1,info);a=d&&arcTangent(from,to,d)}
    if(!a){const R=Math.hypot(to[0]-from[0],to[1]-from[1])/(2*Math.sin(.5));a=[R,R,0,0,1]}
    return [{t:'A',arc:a.map(n=>+n.toFixed(3)),pts:[[...to]]}];
  }
  return null;
}
/* convert the segments at idxs: {segs, sel (their new indices, which move when an arc becomes several curves)} or null when nothing changed */
export function convertSegments(segs,idxs,type){
  const info=segInfo(segs),want=new Set(idxs),out=[],sel=[];let did=false;
  segs.forEach((s,i)=>{
    const r=want.has(i)?convertSegment(segs,i,type,info):null;
    if(want.has(i)&&s.t!=='M')sel.push(...(r?r.map((_,k)=>out.length+k):[out.length]));
    if(r){did=true;r.forEach(q=>out.push({...q,dirty:1}))}else out.push(clone(s));
  });
  return did?{segs:healSmooth(out),sel}:null;
}
