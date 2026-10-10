/* The pen's path arithmetic (pure, no DOM; the path widget's pen mode drives it). Segments are those of path-math.js. A "head" is the
   segment index of the node the pen continues from: the last drawing segment of an open subpath (or its lone M). */
import {arcThrough,convertSegment,healSmooth} from './path-math.js';
const cp=s=>({...s,pts:s.pts.map(p=>[...p]),...(s.arc?{arc:[...s.arc]}:{})});
const refl=(h,n)=>[2*n[0]-h[0],2*n[1]-h[1]],mid=(a,b)=>[(a[0]+b[0])/2,(a[1]+b[1])/2],dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]),r3=n=>+n.toFixed(3);

/* the subpath node/segment j belongs to: {m: its M, last: its last drawing segment (m for a lone M), closed: it ends in Z} */
export function subOf(segs,j){
  let m=j;while(m>0&&segs[m].t!=='M')m--;
  let last=m,closed=false;
  for(let k=m+1;k<segs.length&&segs[k].t!=='M';k++){if(segs[k].t==='Z'){closed=true;break}last=k}
  return {m,last,closed};
}
/* 'start' | 'end' | 'lone' (an M with nothing after it) when node j is an endpoint of an open subpath, else null. A closed subpath has none. */
export function endKind(segs,j){
  const s=segs[j];if(!s||s.t==='Z')return null;
  const {m,last,closed}=subOf(segs,j);if(closed)return null;
  return m===last?(j===m?'lone':null):j===last?'end':j===m?'start':null;
}
/* the open subpath that starts at segment m, drawn backwards: {segs, map (old node index -> new)} or null for a closed one. Curves swap their
   controls, arcs flip their sweep, S / T flags move with the node they describe, lines are marked `dirty` so H / V / L is decided afresh. The
   pen uses it to continue from a path's first node: it only ever appends. */
export function reverseSub(segs,m){
  const {last,closed}=subOf(segs,m);if(closed)return null;
  const n=last-m+1,P=Array.from({length:n},(_,k)=>segs[m+k].pts.at(-1)),out=segs.slice(0,m).map(cp);
  out.push({t:'M',pts:[[...P[n-1]]]});
  for(let k=n-1;k>=1;k--){
    const s=segs[m+k],prev=[...P[k-1]],nx=segs[m+k+1],sm=k+1<=n-1&&nx&&nx.sm&&nx.t===s.t;
    if(s.t==='L')out.push({t:'L',pts:[prev],dirty:1});
    else if(s.t==='C')out.push({t:'C',pts:[[...s.pts[1]],[...s.pts[0]],prev],...(sm?{sm:1}:{})});
    else if(s.t==='Q')out.push({t:'Q',pts:[[...s.pts[0]],prev],...(sm?{sm:1}:{})});
    else if(s.t==='A'){const a=[...s.arc];a[4]=a[4]?0:1;out.push({t:'A',arc:a,pts:[prev]})}
  }
  out.push(...segs.slice(last+1).map(cp));
  return {segs:healSmooth(out),map:i=>i>=m&&i<=last?m+(last-i):i};
}
/* The pen adds a node at p after node `head`. o: kind 'auto' (a click is a line; a drag, or a pending handle on the head, makes a curve) | 'L' | 'Q' | 'C' |
   'A'; out = {pt, sym} the head's pending outgoing handle (a handle the last drag pulled that no segment holds yet); drag = the handle position
   the pointer pulled to (a drag makes the new node symmetric: incoming control = mirror of it); alt = break the node (incoming stays on it).
   -> {segs, idx (the new node), out (the new node's pending outgoing handle, for the next call: {pt, sym}, or null)} */
export function penNode(segs,head,p,o={}){
  const kind=o.kind||'auto',h=o.drag||null,from=segs[head].pts.at(-1),drag=!!h&&dist(h,p)>1e-9,prevC=segs[head].t==='C';
  if(dist(from,p)<1e-9)return null; // a node on the head (a snap can do that) is no segment, and an arc of no length has no radius
  const out=o.out||null,sym=drag&&!o.alt,mirror=!!out&&out.sym&&prevC;let s,nout=null;
  if(kind==='Q')s={t:'Q',pts:[drag?[...h]:out?[...out.pt]:mid(from,p),[...p]]};
  else if(kind==='A'){
    const a=drag&&arcThrough(from,h,p);
    s=a?{t:'A',arc:a.map(r3),pts:[[...p]]}:convertSegment([...segs.slice(0,head+1),{t:'L',pts:[[...p]]}],head+1,'A')[0];
  }else if(kind==='C'||(kind==='auto'&&(out||sym))){ // a cubic: c1 is the head's outgoing handle (the node itself when it has none), c2 the mirror of the pulled handle (the node when broken or not pulled)
    s={t:'C',pts:[mirror?refl(segs[head].pts[1],from):out?[...out.pt]:[...from],sym?refl(h,p):[...p],[...p]],...(mirror?{sm:1}:{})};
  }else s=kind==='L'||kind==='auto'?{t:'L',pts:[[...p]]}:null;
  if(drag&&(kind==='auto'||kind==='C'))nout={pt:[...h],sym}; // what the next node's first control will be
  if(!s)return null;
  const res=segs.map(cp);res.splice(head+1,0,{...s,dirty:1});
  return {segs:healSmooth(res),idx:head+1,out:nout};
}
/* can the subpath whose end node is `head` be closed? It needs a segment to close (two nodes): a curve back to the start makes a perfectly good
   balloon of two nodes. (A straight two-node path closes to a line there and back, which is legal and merely flat.) */
export function canClose(segs,head){const {m,last,closed}=subOf(segs,head);return !closed&&head===last&&last>m}
/* close it: a final curve back to the start when the kind, a pending handle or a drag (o.drag, as for penNode) asks for one, then Z (a straight closing line is just the Z).
   -> {segs, idx (the start node: a closed subpath has no endpoints, so the pen has nothing to continue from)} or null */
export function closeSub(segs,head,o={}){
  if(!canClose(segs,head))return null;
  const {m}=subOf(segs,head),kind=o.kind||'auto',curved=kind==='Q'||kind==='C'||kind==='A'||(kind==='auto'&&(o.out||o.drag));
  let res=segs,at=head;
  if(curved){const r=penNode(segs,head,segs[m].pts[0],{kind,out:o.out,drag:o.drag});if(r){res=r.segs;at=r.idx}} // (no curve possible: a plain Z)
  res=res.map(cp);res.splice(at+1,0,{t:'Z',pts:[]});
  return {segs:healSmooth(res),idx:m};
}
