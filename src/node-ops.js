/* Node operations that change how a path is divided into subpaths (pure, no DOM; the path widget's Node menu drives them). Segments are those of
   path-math.js. A subpath is an M and what follows it up to the next M; its nodes are named by segment index like everywhere else in the editor.
     joinNodes   two unattached nodes (the end of an open subpath, or a lone M): a straight segment between them (or, with `merge`, one node at the
                 average of their positions). Different subpaths become one; the two ends of the same subpath close it.
     splitNodes  a node inside a subpath becomes two: the subpath ends there and a new one starts there with an M. A closed subpath has no ends to
                 cut at, so cutting it opens it instead (see splitNodes). */
import {segInfo,healSmooth,twins} from './path-math.js';
import {endKind,reverseSub,subOf,closeSub} from './pen-math.js';
const clone=s=>({...s,pts:s.pts.map(p=>[...p]),...(s.arc?{arc:[...s.arc]}:{})});
const near=(a,b)=>Math.abs(a[0]-b[0])<=0.01&&Math.abs(a[1]-b[1])<=0.01;

/* the two nodes idxs as [kind, kind] ('start' | 'end' | 'lone', see endKind), or null unless there are exactly two different unattached nodes */
export function unattached(segs,idxs){
  const u=[...new Set(idxs)];if(u.length!==2)return null;
  const k=u.map(j=>endKind(segs,j));return k[0]&&k[1]?k:null;
}

/* Join the two unattached nodes idxs: {segs, sel (the nodes that were joined, where they are now)} or null when they can't be (not two unattached nodes;
   a subpath's own two ends need a third node in between to merge, and a segment to close).
   Default: a straight line from one to the other. opts.merge: no line; both nodes become one at the average of their positions, each node's own bezier
   handle moving with it. Two subpaths come out as one, in the place of the earlier of the two (the later one is reversed if that is what it takes to
   put its end beside the other's). The ends of one subpath close it: with a Z that draws the line (default), or a Z that draws nothing, the node being
   joined (merge). */
export function joinNodes(segs,idxs,opts={}){
  const [a0,b0]=[...new Set(idxs)].sort((x,y)=>x-y),kinds=unattached(segs,[a0,b0]);if(!kinds)return null;
  const merge=!!opts.merge,A=subOf(segs,a0),B=subOf(segs,b0);
  if(A.m===B.m){ // the two ends of one subpath
    const n=A.last-A.m+1;if(n<(merge?3:2))return null;
    if(!merge){const r=closeSub(segs,A.last);return r?{segs:r.segs,sel:[a0,b0]}:null}
    const out=segs.map(clone),p=mid(out[A.m].pts[0],out[A.last].pts[0]);
    shift(out,A.last,'end',p);shift(out,A.m,'start',p);out.splice(A.last+1,0,{t:'Z',pts:[]});
    return {segs:healSmooth(out),sel:[A.m]};
  }
  /* put the first node at the end of its subpath and the second at the start of its own (a subpath is reversed to do it); a reversal keeps every
     index outside the subpath and the number of segments in it, so the other one is not disturbed */
  let cur=segs;
  if(kinds[0]==='start'){const r=reverseSub(cur,A.m);if(!r)return null;cur=r.segs}   // (kinds follow idxs in sorted order: a0, b0)
  if(kinds[1]==='end'){const r=reverseSub(cur,B.m);if(!r)return null;cur=r.segs}
  /* a is now the last node of the subpath from m1, b the first (M) of the one from m2: m1 < m2 */
  const m1=A.m,l1=subOf(cur,m1).last,m2=B.m,l2=subOf(cur,m2).last,out=[];
  const aPt=cur[l1].pts.at(-1),bPt=cur[m2].pts[0];
  const head=cur.slice(m1,l1+1).map(clone),tail=cur.slice(m2+1,l2+1).map(clone);
  let sel;
  if(merge){
    const p=mid(aPt,bPt),h=[...head];
    shiftSeg(h,h.length-1,'end',p,aPt);if(tail.length)shiftSeg(tail,0,'start',p,bPt);
    sel=[m1+head.length-1];
    out.push(...cur.slice(0,m1).map(clone),...h,...tail,...cur.slice(l1+1,m2).map(clone),...cur.slice(l2+1).map(clone));
  }else{
    sel=[m1+head.length-1,m1+head.length];
    out.push(...cur.slice(0,m1).map(clone),...head,{t:'L',pts:[[...bPt]],dirty:1},...tail,...cur.slice(l1+1,m2).map(clone),...cur.slice(l2+1).map(clone));
  }
  return {segs:healSmooth(out),sel};
}
const mid=(a,b)=>[(a[0]+b[0])/2,(a[1]+b[1])/2];
/* move the end of segment i of `list` (or, 'start', the node that segment starts from: its own M, or the previous segment's end) to p, and a cubic's handle at that node by the same step */
function shiftSeg(list,i,which,p,old){
  const s=list[i],d=[p[0]-old[0],p[1]-old[1]];
  if(which==='end'){s.pts[s.pts.length-1]=[...p];if(s.t==='C')s.pts[1]=[s.pts[1][0]+d[0],s.pts[1][1]+d[1]];if(s.t==='L')s.dirty=1}
  else{if(s.t==='C')s.pts[0]=[s.pts[0][0]+d[0],s.pts[0][1]+d[1]];if(s.t==='L')s.dirty=1}
}
/* the same inside a whole segment array: the end node of segment i (which: 'end'), or the start node of the subpath whose M is at i ('start') */
function shift(list,i,which,p){
  if(which==='end'){shiftSeg(list,i,'end',p,list[i].pts.at(-1))}
  else{const old=list[i].pts[0];list[i].pts[0]=[...p];if(list[i+1])shiftSeg(list,i+1,'start',p,old)}
}

/* Split at the nodes idxs: each subpath that has one of them inside it is cut there. -> {segs, sel (the new M of each cut: the start of the piece that
   now begins at the node)} or null when nothing could be cut (the nodes are ends already, or joined nodes of an unclosed loop, which are one node).
   A node inside an open subpath: the subpath ends at the node and a new one starts there, so there are two nodes where there was one.
   A closed subpath (Z) has no ends, so it is opened instead: it is rewritten to start at the first cut and run round to it again, without its Z. That
   is one subpath with one joined node at the cut (a subpath that ends where it starts is one node, see `twins`), which differs from the closed one in
   the stroke only: a join at that point becomes the ends of the line. More cuts in the same closed subpath then divide it into several. A Z that
   draws a line is an ordinary segment (an L) from then on. Cutting a closed subpath at its first node just drops the Z. */
export function splitNodes(segs,idxs){
  const want=new Set(idxs),info=segInfo(segs),tw=twins(segs,info),out=[],sel=[];let did=false,i=0;
  while(i<segs.length){
    if(segs[i].t!=='M'){out.push(clone(segs[i]));i++;continue}
    let j=i+1;while(j<segs.length&&segs[j].t!=='M')j++;
    const r=splitSub(segs,info,tw,i,j,want);
    if(!r){for(let k=i;k<j;k++)out.push(clone(segs[k]));i=j;continue}
    did=true;
    for(const pc of r){if(pc.cut)sel.push(out.length);out.push({t:'M',pts:[[...pc.start]]},...pc.edges)}
    i=j;
  }
  return did?{segs:healSmooth(out),sel}:null;
}
/* the subpath [i, j) as pieces [{start, edges, cut (it begins at a cut)}] or null when no cut applies */
function splitSub(segs,info,tw,i,j,want){
  const z=segs.findIndex((s,k)=>k>i&&k<j&&s.t==='Z');
  if(z>=0&&z!==j-1)return null;                        // a subpath that carries on after its Z: left alone
  const L=(z>=0?z:j)-1-i;                              // the drawing segments: i+1 .. i+L
  if(L<1)return null;
  const ring=z>=0,real=ring&&!near(info[z].from,info[z].to);   // real: the Z draws a line, which becomes an edge of its own
  const E=[null];for(let k=1;k<=L;k++)E.push(segs[i+k]);
  if(real)E.push({t:'L',pts:[[...info[z].to]],dirty:1});
  const N=E.length-1;                                  // the chain runs from node 0 to node N; in a ring node N is node 0 again
  const pt=k=>k===0?segs[i].pts[0]:E[k].pts.at(-1);
  const joinedEnd=tw[i]===i+L;                         // the last node is the first one's other half
  const at=idx=>idx===i||(joinedEnd&&idx===i+L)?0:idx>i&&idx<=i+L?idx-i:-1;   // a segment index -> its node in the chain
  const cuts=[...new Set([...want].map(at).filter(k=>k>0&&k<N))].sort((a,b)=>a-b);
  const base=ring&&[...want].some(idx=>at(idx)===0);
  if(!cuts.length&&!base)return null;
  const edges=(a,b)=>{const r=[];for(let k=a+1;k<=b;k++)r.push(clone(E[k]));return r};
  const pieces=[],ks=ring&&!base?cuts:[0,...cuts,N];
  for(let n=0;n+1<ks.length;n++)pieces.push({start:[...pt(ks[n])],edges:edges(ks[n],ks[n+1]),cut:ks[n]>0||base});
  if(ring&&!base)pieces.push({start:[...pt(ks.at(-1))],edges:[...edges(ks.at(-1),N),...edges(0,ks[0])],cut:true}); // the piece that runs through the first node
  return pieces;
}
