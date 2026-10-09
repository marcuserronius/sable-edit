import {Widgets} from '../registry.js';
import {mk} from '../dom.js';
import {rnd} from '../util.js';
import {polyNodes,pinnedIdx} from '../policy.js';
import {deletePoints} from '../path-math.js';
import {selection} from '../selection.js';
/* polygon / polyline, edit mode: vertex squares (drag to move), double-click an edge to add a vertex,
   double-click a vertex to delete it.
   Click a vertex to select it (Shift adds / removes); dragging a selected vertex moves all selected ones; Delete / Backspace remove
   them (never below 3 vertices for a polygon, 2 for a polyline); Escape clears. Edges can't be selected yet: cutting one splits
   the element in two, which needs the object-conversion work on the TODO. Moving the whole shape is the body drag's job (body.js). The policy can take adding and
   deleting away (nodes.insert / nodes.delete) and pin vertices: a pinned vertex is drawn grey and can't be dragged or deleted. */
for(const tag of ['polygon','polyline'])Widgets.register(el=>el.tagName===tag,ctx=>{
  const el=ctx.el,closed=tag==='polygon',g=mk('g'),A=(e,o)=>{for(const k in o)e.setAttribute(k,o[k])}; ctx.overlay.append(g);
  const parse=()=>{const n=(el.getAttribute('points')||'').match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g)||[],p=[];
    for(let i=0;i+1<n.length;i+=2)p.push([+n[i],+n[i+1]]);return p};
  let pts=parse(),items=[],hit,dead=false,mv0=false,mv1=false,pinned=new Set();const S=selection(),min=closed?3:2;
  /* the policy can refuse a write (show what the document really holds) or store something else (a bounds clamp): adopt it, in place so a drag in progress keeps its array */
  let uid=0;const write=own=>{const v=pts.map(p=>rnd(p[0])+','+rnd(p[1])).join(' '),r=own?ctx.batch(()=>ctx.set('points',v),own):ctx.set('points',v);if(r===false){pts=parse();build()}else if(el.getAttribute('points')!==v)pts.splice(0,pts.length,...parse())};
  function drag(h,start,move,click){ // click: a release that was not a drag
    h.addEventListener('pointerdown',e=>{
      e.stopPropagation();h.setPointerCapture(e.pointerId);const p0=ctx.toLocal(e);start(e);mv0=mv1;mv1=false;
      const mv=ev=>{if(Math.hypot(ev.clientX-e.clientX,ev.clientY-e.clientY)>3)mv1=true;move(ctx.toLocal(ev),p0);write();layout()};
      h.addEventListener('pointermove',mv);h.addEventListener('pointerup',()=>{h.removeEventListener('pointermove',mv);if(!mv1&&click)click()},{once:true});
    });
  }
  function del(){ // the selected vertices (not the pinned ones)
    if(!S.size||!ctx.can('nodes.delete'))return false;
    const r=deletePoints(pts,S.items,min,pinned);if(!r)return false;
    pts=r;S.clear();write('del:'+(++uid));build();return true;
  }
  function insert(p){
    let best=null;const n=pts.length;
    for(let i=0;i<(closed?n:n-1);i++){
      const a=pts[i],b=pts[(i+1)%n],dx=b[0]-a[0],dy=b[1]-a[1],L=dx*dx+dy*dy;
      const t=L?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/L)):0;
      const q=[a[0]+dx*t,a[1]+dy*t],d=Math.hypot(q[0]-p[0],q[1]-p[1]);
      if(!best||d<best.d)best={d,i,q};
    }
    if(!best)return;pts.splice(best.i+1,0,best.q);S.pick('node',best.i+1);write();build(); // the new vertex is the selection
  }
  function build(){
    g.replaceChildren();items=[];
    hit=mk(tag,{fill:'none',stroke:'transparent','stroke-width':12,'vector-effect':'non-scaling-stroke',style:'pointer-events:stroke;cursor:'+(ctx.can('nodes.insert')?'copy':'move')});
    hit.addEventListener('dblclick',e=>ctx.can('nodes.insert')&&insert(ctx.toLocal(e)));hit.addEventListener('pointerdown',e=>ctx.grab(e));g.append(hit);
    pinned=new Set(pinnedIdx(polyNodes(pts,closed),ctx.pin));
    S.keep('node',i=>i<pts.length);
    pts.forEach((_,i)=>{
      const h=mk('rect',{style:'pointer-events:all;cursor:move',fill:'var(--panel,#fff)',stroke:'var(--acc,#2f6fed)'});g.append(h);
      items.push({h,get:()=>pts[i],r:5,n:1,node:i,pin:pinned.has(i)}); 
      if(pinned.has(i)){ // locked: grey, no drag, no delete; it can still be selected
        h.style.cursor='not-allowed';h.setAttribute('fill','#ddd');h.setAttribute('stroke','#888');
        h.addEventListener('pointerdown',e=>{e.stopPropagation();S.pick('node',i,e.shiftKey);layout()});return;
      }
      let refs=[],rel=()=>{};
      drag(h,e=>{rel=S.press('node',i,e.shiftKey);layout();refs=S.items.filter(j=>pts[j]&&!pinned.has(j)).map(j=>[j,[...pts[j]]])},
        (p,p0)=>{ // one vertex follows the pointer; a group moves by the pointer's travel
          if(refs.length===1)pts[refs[0][0]]=p;else refs.forEach(([j,o])=>pts[j]=[o[0]+p[0]-p0[0],o[1]+p[1]-p0[1]]);
        },()=>{rel();layout()});
      h.addEventListener('dblclick',e=>{e.stopPropagation();if(mv0||mv1)return;S.pick('node',i);del()});
    });
    layout();
  }
  function layout(){
    const M=ctx.matrix(),T=p=>{const q=new DOMPoint(p[0],p[1]).matrixTransform(M);return [q.x,q.y]},w=ctx.px(1.5);
    A(hit,{points:pts.map(p=>p.join(',')).join(' '),transform:`matrix(${M.a} ${M.b} ${M.c} ${M.d} ${M.e} ${M.f})`});
    items.forEach(it=>{const [x,y]=T(it.get()),r=ctx.px(it.r);
      A(it.h,it.n?{x:x-r,y:y-r,width:2*r,height:2*r,'stroke-width':w}:{cx:x,cy:y,r,'stroke-width':w});
      const sl=S.has('node',it.node);if(it.pin)it.h.setAttribute('stroke',sl?'var(--acc,#2f6fed)':'#888');else it.h.setAttribute('fill',sl?'var(--acc,#2f6fed)':'var(--panel,#fff)')}); // selected: filled
  }
  ctx.on('view',()=>!dead&&layout());
  ctx.on('key',d=>{
    if(dead||d.handled||!S.size)return;
    if(d.key==='Escape'){S.clear();layout();d.handled=true}else if(d.key==='Delete'||d.key==='Backspace'){del();d.handled=true}
  });
  ctx.on('change',({el:e,src})=>{if(dead||e!==el||src==='widget')return;pts=parse();build()});
  build();
  return {update(){pts=parse();build()},destroy(){dead=true;g.remove()},
    deleteSelection:del,clearSelection(){S.clear();layout()},get selection(){return S.size?{kind:'node',items:S.items}:null}};
});
