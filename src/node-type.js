/* Node types for any node with a segment on each side (pure, no DOM). A node is a 'corner', 'smooth' (the two tangents line up) or 'symmetric'
   (smooth, and the two handles are mirror images: only beziers have handles to compare). Making a node smooth or symmetric changes whichever
   side has to give way, whatever the segment types are:
     bezier + bezier   the later one's handle follows the earlier one's (as setNodeType in path-math)
     bezier + line     the line becomes a bezier of the bezier's kind, its handle along (smooth) or mirroring (symmetric) the other's
     line + line       both become cubics, their handles along the line between the neighbouring nodes
     arc + line        smooth: the line becomes a quadratic leaving along the arc's tangent. symmetric: it becomes a circular arc tangent there
                       (an arc's radii can't be copied: the node, the far end and the tangent already fix the circle)
     arc + bezier      smooth: the bezier's handle swings onto the arc's tangent. symmetric: the arc becomes a bezier of the bezier's kind
                       (one best-fit cubic: never more nodes) with the handle mirrored
     arc + arc         both become single best-fit cubics, then as bezier + bezier
   A quadratic has one control for both its ends, so moving it also turns the tangent at its far end: when that node is smooth the segment
   becomes a cubic instead, whose far control stays on the old tangent. A closing line (Z that draws one) is made an explicit segment first. */
import {segInfo,healSmooth,convertSegment,arcGeom,twins,nodeType,setNodeType,startTangent,endTangent} from './path-math.js';
const cl=s=>({...s,pts:s.pts.map(p=>[...p]),...(s.arc?{arc:[...s.arc]}:{})});
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1]],dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]),refl=(h,n)=>[2*n[0]-h[0],2*n[1]-h[1]];
const unit=v=>{const d=Math.hypot(v[0],v[1]);return d>1e-9?[v[0]/d,v[1]/d]:null},lerp=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
const along=(n,t,l)=>[n[0]+t[0]*l,n[1]+t[1]*l];
const isB=t=>t==='C'||t==='Q';

/* the segments on each side of node j: {a (ends at it), b (starts at it), m, z (the Z of its subpath or -1)}, -1 for a side that isn't there.
   A joined node (path-math twins) has its last segment and its first. A real closing line is a side too (its index is the Z's). */
export function sides(segs,j,tw=twins(segs)){
  const s=segs[j];if(!s||s.t==='Z')return null;
  let m=j;while(m>0&&segs[m].t!=='M')m--;
  let e=m,z=-1;for(let k=m+1;k<segs.length&&segs[k].t!=='M';k++){if(segs[k].t==='Z'){z=k;break}e=k}
  const joined=e>m&&tw[m]===e;let a,b;
  if(j===m){a=joined?e:z>=0?z:-1;b=e>m?m+1:-1}
  else{a=j;b=j<e?j+1:joined?m+1:z>=0?z:-1}
  return {a,b,m,z};
}
const dirOK=(u,v)=>Math.abs(u[0]*v[1]-u[1]*v[0])<=0.005&&u[0]*v[0]+u[1]*v[1]>0;
/* tangent as segment i ends / starts; a Z is the line it draws */
const tIn=(segs,i,info)=>segs[i].t==='Z'?unit(sub(info[i].to,info[i].from)):endTangent(segs,i,info);
const tOut=(segs,i,info)=>segs[i].t==='Z'?unit(sub(info[i].to,info[i].from)):startTangent(segs,i,info);
/* 'corner' | 'smooth' | 'symmetric', or null when the node has no segment on one side (an end of an open path) */
export function nodeTypeAny(segs,j,info=segInfo(segs),tw=twins(segs,info)){
  const sd=sides(segs,j,tw);if(!sd||sd.a<0||sd.b<0)return null;
  if(isB(segs[sd.a].t)&&isB(segs[sd.b].t))return nodeType(segs,j,info)||'corner';
  const u=tIn(segs,sd.a,info),v=tOut(segs,sd.b,info);
  return u&&v&&dirOK(u,v)?'smooth':'corner';
}
/* a single cubic along an arc (the usual 4/3 tan(sweep/4) handles: exact up to a quarter turn, plainly off for a big arc), or null */
export function arcToCubic1(from,to,arc){
  const g=arcGeom(from,to,...arc);if(!g)return null;
  const d=th=>[-g.rx*Math.sin(th)*g.c-g.ry*Math.cos(th)*g.s,-g.rx*Math.sin(th)*g.s+g.ry*Math.cos(th)*g.c];
  const k=4/3*Math.tan(Math.max(-1.5*Math.PI,Math.min(1.5*Math.PI,g.dth))/4),d1=d(g.th1),d2=d(g.th1+g.dth);
  return {t:'C',pts:[[from[0]+k*d1[0],from[1]+k*d1[1]],[to[0]-k*d2[0],to[1]-k*d2[1]],[...to]]};
}
/* the circle that leaves p0 heading t0 and passes through p1: {R, sweep, large} (SVG arc flags for travelling p0 -> p1), or null when p1 is on the tangent line */
export function arcTangentThrough(p0,t0,p1){
  const d=sub(p1,p0),nr=[-t0[1],t0[0]],k=nr[0]*d[0]+nr[1]*d[1];
  if(Math.abs(k)<1e-6*(Math.hypot(d[0],d[1])||1))return null;
  const s=(d[0]*d[0]+d[1]*d[1])/(2*k),c=[p0[0]+nr[0]*s,p0[1]+nr[1]*s],r0=sub(p0,c),r1=sub(p1,c);
  const sweep=r0[0]*t0[1]-r0[1]*t0[0]>0?1:0,TAU=2*Math.PI;
  let dl=sweep?Math.atan2(r1[1],r1[0])-Math.atan2(r0[1],r0[0]):Math.atan2(r0[1],r0[0])-Math.atan2(r1[1],r1[0]);
  dl=(dl%TAU+TAU)%TAU;
  return {R:Math.abs(s),sweep,large:dl>Math.PI?1:0};
}

/* Set node j to 'corner' | 'smooth' | 'symmetric'. -> {segs, ins (index of a segment that was inserted, -1 when none)} or null when there is nothing to do */
export function setNodeTypeAt(segs,j,type){
  if(type==='corner'){const r=setNodeType(segs,j,'corner');return r?{segs:r,ins:-1}:null}
  if(type!=='smooth'&&type!=='symmetric')return null;
  const sym=type==='symmetric',out=segs.map(cl);let ins=-1,sd=sides(out,j);if(!sd)return null;
  if((sd.a>=0&&out[sd.a].t==='Z')||(sd.b>=0&&out[sd.b].t==='Z')){ // a closing line that draws something: an explicit segment first, and the path now ends on its start
    out.splice(sd.z,0,{t:'L',pts:[[...out[sd.m].pts[0]]],dirty:1});ins=sd.z;sd=sides(out,j);
  }
  if(!sd||sd.a<0||sd.b<0)return null;
  const {a,b}=sd;let info=segInfo(out);const n=[...info[a].to];
  const conv=(i,t)=>{const c=convertSegment(out,i,t,segInfo(out));if(c&&c.length===1)out[i]=c[0]};
  if(a===b&&out[a].t==='Q')conv(a,'C');           // one segment from the node back to itself: its one control can't be smooth against itself
  const farOf=side=>side==='b'?b:a-1;               // the node at the other end of the segment that gives way
  const farSmooth=side=>{const f=farOf(side),t=f>=0&&nodeTypeAny(out,f);return !!t&&t!=='corner'};
  const hOf=(side,q=out[side==='a'?a:b])=>side==='a'?(q.t==='C'?q.pts[1]:q.pts[0]):q.pts[0];     // the handle at the node
  const setH=(side,p)=>{const q=out[side==='a'?a:b];q.pts[side==='a'&&q.t==='C'?1:0]=p};
  const ta=()=>tIn(out,a,info),tb=()=>tOut(out,b,info);
  const place=(side,tf,len)=>side==='b'?along(n,tf,len):along(n,tf,-len);        // a handle on `side` along the forward tangent tf
  /* both beziers: `side` is the one that gives way */
  const bb=side=>{
    const i=side==='a'?a:b,other=side==='a'?'b':'a';
    if(a!==b&&out[i].t==='Q'&&farSmooth(side))conv(i,'C');
    const ah=hOf(other),u=sub(ah,n),cur=dist(hOf(side),n),len=cur<0.005?Math.hypot(u[0],u[1]):cur;
    if(sym)setH(side,refl(ah,n));else{const v=unit(u);if(!v)return false;setH(side,along(n,v,-len))}
    return true;
  };
  /* a line becomes a bezier; `anchor`: the bezier it has to line up with ({h, kind}) or an arc's forward tangent ({tf}) */
  const lineToBez=(side,anchor)=>{
    const i=side==='a'?a:b,far=side==='a'?info[i].from:info[i].to,d=dist(n,far);if(d<1e-9)return false;
    let kind=anchor.kind||'Q';if(kind==='Q'&&farSmooth(side))kind='C';
    const tf=anchor.tf||(anchor.h&&(side==='b'?unit(sub(n,anchor.h)):unit(sub(anchor.h,n))));if(!tf)return false; // forward along the path, out of the anchor's handle
    const h=sym&&anchor.h?refl(anchor.h,n):place(side,tf,kind==='Q'?d/2:d/3),c1=lerp(far,n,1/3);
    out[i]=kind==='C'?(side==='b'?{t:'C',pts:[h,c1,far]}:{t:'C',pts:[c1,h,n]}):(side==='b'?{t:'Q',pts:[h,far]}:{t:'Q',pts:[h,n]});
    out[i].dirty=1;return true;
  };
  let ok=true;const A=out[a].t,B=out[b].t;
  if(isB(A)&&isB(B))ok=bb('b');
  else if(A==='A'&&B==='A'){
    const ca=arcToCubic1(info[a].from,n,out[a].arc),cb=arcToCubic1(n,info[b].to,out[b].arc);
    if(!ca||!cb)return null;out[a]={...ca,dirty:1};out[b]={...cb,dirty:1};ok=bb('b');
  }else if(A==='L'&&B==='L'){
    const P=info[a].from,N=info[b].to,t=unit(sub(N,P)),la=dist(P,n)/3,lb=dist(n,N)/3,l=sym?Math.min(la,lb):0;
    if(!t||la<1e-9||lb<1e-9)return null;
    out[a]={t:'C',pts:[lerp(P,n,1/3),along(n,t,-(sym?l:la)),[...n]],dirty:1};out[b]={t:'C',pts:[along(n,t,sym?l:lb),lerp(N,n,1/3),[...N]],dirty:1};
  }else if(isB(A)||isB(B)){
    const bs=isB(A)?'a':'b',os=bs==='a'?'b':'a',ot=os==='a'?A:B;
    if(ot==='L')ok=lineToBez(os,{h:hOf(bs),kind:out[bs==='a'?a:b].t});
    else if(!sym){ // bezier + arc, smooth: the handle swings onto the arc's tangent
      const i=bs==='a'?a:b,tf=bs==='b'?ta():tb();if(!tf)return null;
      if(a!==b&&out[i].t==='Q'&&farSmooth(bs))conv(i,'C');
      const cur=dist(hOf(bs),n);setH(bs,place(bs,tf,cur<0.005?dist(info[i].from,info[i].to)/3:cur));
    }else{ // bezier + arc, symmetric: the arc becomes a bezier of the bezier's kind, its handle the mirror of the other
      const i=os==='a'?a:b,kind0=out[bs==='a'?a:b].t,kind=kind0==='Q'&&farSmooth(os)?'C':kind0,h=refl(hOf(bs),n),from=info[i].from,to=info[i].to;
      if(kind==='C'){const c=arcToCubic1(from,to,out[i].arc);if(!c)return null;c.pts[os==='a'?1:0]=h;out[i]={...c,dirty:1}}
      else out[i]={t:'Q',pts:os==='a'?[h,n]:[h,to],dirty:1};
    }
  }else{ // arc + line
    const ls=A==='L'?'a':'b',as=ls==='a'?'b':'a',tf=as==='a'?ta():tb();if(!tf)return null;
    if(!sym)ok=lineToBez(ls,{tf});
    else{ // the circle tangent to the arc's direction at the node and through the line's far end
      const far=ls==='a'?info[a].from:info[b].to,r=ls==='b'?arcTangentThrough(n,tf,far):arcTangentThrough(n,[-tf[0],-tf[1]],far);
      if(!r)return null;
      out[ls==='a'?a:b]={t:'A',arc:[r.R,r.R,0,r.large,ls==='b'?r.sweep:1-r.sweep],pts:[ls==='b'?far:[...n]],dirty:1};
    }
  }
  if(!ok)return null;
  if(sym&&b===a+1&&isB(out[a].t)&&out[a].t===out[b].t)out[b].sm=1;else if(b===a+1)delete out[b].sm;
  return {segs:healSmooth(out),ins};
}
/* node types for several nodes at once: -> {segs, sel (where the nodes are now: a closing line made explicit shifts what comes after it)} or null when nothing changed */
export function setNodeTypes(segs,js,type){
  let out=segs,sel=[...js],did=false;
  for(const j of [...js].sort((x,y)=>y-x)){
    const r=setNodeTypeAt(out,sel[js.indexOf(j)],type);if(!r)continue;
    did=true;out=r.segs;if(r.ins>=0)sel=sel.map(q=>q>=r.ins?q+1:q);
  }
  return did?{segs:out,sel}:null;
}
