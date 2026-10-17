import {Widgets} from '../registry.js';
import {mk} from '../dom.js';
import {rnd} from '../util.js';
import {polyNodes,pinnedIdx} from '../policy.js';
import {deletePoints} from '../path-math.js';
import {selection} from '../selection.js';
import {polyEnd,polyAdd,headAfter} from '../pen-math.js';
/* polygon / polyline, edit mode: vertex squares (drag to move), double-click an edge to add a vertex,
   double-click a vertex to delete it.
   Click a vertex to select it (Shift adds / removes); dragging a selected vertex moves all selected ones; Delete / Backspace remove
   them (never below 3 vertices for a polygon, 2 for a polyline); Escape clears. Edges can't be selected yet: cutting one splits
   the element in two, which needs the object-conversion work on the TODO. Moving the whole shape is the body drag's job (body.js). The policy can take adding and
   deleting away (nodes.insert / nodes.delete) and pin vertices: a pinned vertex is drawn grey and can't be dragged or deleted.
   Pen mode (the Polygon / Polyline tool, ctx.penOn; see pen below): a press on empty canvas adds a vertex after the selected one (Shift holds the new edge on a multiple of 45 degrees). */
for(const tag of ['polygon','polyline'])Widgets.register(el=>el.tagName===tag,ctx=>{
  const el=ctx.el,closed=tag==='polygon',g=mk('g'),A=(e,o)=>{for(const k in o)e.setAttribute(k,o[k])}; ctx.overlay.append(g);
  const parse=()=>{const n=(el.getAttribute('points')||'').match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g)||[],p=[];
    for(let i=0;i+1<n.length;i+=2)p.push([+n[i],+n[i+1]]);return p};
  let pts=parse(),items=[],hit,pv,dead=false,mv0=false,mv1=false,pinned=new Set();const S=selection(),min=closed?3:2;
  /* the policy can refuse a write (show what the document really holds) or store something else (a bounds clamp): adopt it, in place so a drag in progress keeps its array */
  let uid=0;const write=own=>{const v=pts.map(p=>rnd(p[0])+','+rnd(p[1])).join(' '),r=own?ctx.batch(()=>ctx.set('points',v),own):ctx.set('points',v);if(r===false){pts=parse();build();return false}if(el.getAttribute('points')!==v)pts.splice(0,pts.length,...parse());return true};
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
    hit=mk(tag,{'data-sable':'hit',fill:'none',stroke:'transparent','stroke-width':12,'vector-effect':'non-scaling-stroke',style:'pointer-events:stroke;cursor:'+(ctx.can('nodes.insert')?'copy':'move')});
    hit.addEventListener('dblclick',e=>ctx.can('nodes.insert')&&insert(ctx.toLocal(e)));hit.addEventListener('pointerdown',e=>ctx.grab(e));g.append(hit);
    pv=g.appendChild(mk('polyline',{fill:'none',stroke:'var(--acc,#2f6fed)','stroke-dasharray':'5 4','vector-effect':'non-scaling-stroke',style:'pointer-events:none;display:none'})); // the pen's rubber band
    pinned=new Set(pinnedIdx(polyNodes(pts,closed),ctx.pin));
    S.keep('node',i=>i<pts.length);
    pts.forEach((_,i)=>{
      const h=mk('rect',{style:'pointer-events:all;cursor:move',fill:'var(--panel,#fff)',stroke:'var(--acc,#2f6fed)'});g.append(h);
      items.push({h,get:()=>pts[i],r:5,n:1,node:i,pin:pinned.has(i)}); 
      if(pinned.has(i)){ // locked: grey, no drag, no delete; it can still be selected
        h.style.cursor='not-allowed';h.setAttribute('fill','#ddd');h.setAttribute('stroke','#888');
        h.addEventListener('pointerdown',e=>{e.stopPropagation();S.pick('node',i,e.shiftKey);layout()});return;
      }
      let refs=[],rel=()=>{},wasHead=false;
      drag(h,e=>{wasHead=ctx.penOn&&drawing&&head()===i;rel=S.press('node',i,e.shiftKey);layout();refs=S.items.filter(j=>pts[j]&&!pinned.has(j)).map(j=>[j,[...pts[j]]])},
        (p,p0)=>{ // one vertex follows the pointer; a group moves by the pointer's travel
          if(refs.length===1)pts[refs[0][0]]=p;else refs.forEach(([j,o])=>pts[j]=[o[0]+p[0]-p0[0],o[1]+p[1]-p0[1]]);
        },()=>{rel();layout();if(wasHead)ctx.penFinish()}); // (pen: clicking the vertex the pen is on finishes the shape)
      h.addEventListener('dblclick',e=>{e.stopPropagation();if(mv0||mv1||(ctx.penOn&&ctx.penRecent()))return;S.pick('node',i);del()});
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
    if(d.key==='Escape'){if(ctx.penOn&&drawing)return;S.clear();layout();d.handled=true}else if(d.key==='Delete'||d.key==='Backspace'){del();d.handled=true}
  });
  ctx.on('change',({el:e,src})=>{
    if(dead||e!==el||src==='widget')return;
    const old=pts;pts=parse();build();
    if(ctx.penOn&&drawing){const k=headAfter(old,pts,closed);if(k>=0){S.clear();S.pick('node',k);layout()}} // undo / redo walk the drawing: the pen's vertex comes back with it
  });
  /* ---- pen mode (a Polygon / Polyline tool is armed, ctx.penOn; attach.js starts shapes and tidies up, src/pen-math.js has the arithmetic) ----
     The pen continues from the one selected vertex: a polyline grows on the end that vertex is on (from its first vertex it grows in front), a polygon,
     which has no ends, takes the new vertex right after it. A press places a vertex (written at once, an undo step of its own) and a drag moves it
     until you let go; clicking the vertex the pen is on again finishes. */
  let drawing=false;
  const head=()=>S.kind==='node'&&S.size===1&&polyEnd(pts.length,S.items[0],closed)?S.items[0]:-1;
  function allowed(){ // adding vertices needs the edit mode and nodes.insert; a pin refuses (indices would shift, an end would stop being an end)
    const c=!ctx.can('geometry.edit')?'geometry.edit':!ctx.can('nodes.insert')?'nodes.insert':null;
    if(c){ctx.deny(c,'capability');return false}
    if(ctx.pin.length){ctx.deny('nodes.insert','pinned');return false}
    return true;
  }
  const pen={
    canContinue:()=>head()>=0,canClose:()=>false,close:()=>false, // a polygon is closed already, and a polyline stays open
    clear(){S.clear();drawing=false;layout()}, // the shape is done: no vertex selected, so the next press starts a new one
    hover(e){ // the rubber band: the edge(s) a press here would add (a polygon's new vertex goes in between the head and the next one)
      const h=e&&ctx.penOn?head():-1;if(h<0){pv.style.display='none';return}
      const q=ctx.place(e,pts[h]),line=[pts[h],q],M=ctx.matrix();
      if(closed&&pts.length>1)line.push(pts[(h+1)%pts.length]);
      A(pv,{points:line.map(z=>z.join(',')).join(' '),transform:`matrix(${M.a} ${M.b} ${M.c} ${M.d} ${M.e} ${M.f})`});pv.style.display='';
    },
    /* a press: -> a gesture {move, end, cancel} like a creation tool's, or null when refused. o.first: the shape was just made for this press (its
       first vertex); o.key: the undo key every write of this press shares (and the shape's creation, when it is the first) */
    begin(e,o){
      pv.style.display='none';
      const key=o.key,thr=e.pointerType==='touch'?8:3,x0=e.clientX,y0=e.clientY,h0=head();let idx=0,wrote=false,dragging=false;
      const from=!o.first&&h0>=0&&pts[h0]?[...pts[h0]]:null; // the vertex the new one comes from: Shift holds the edge on a multiple of 45 degrees
      if(o.first){
        pts.splice(0,pts.length,ctx.fit(ctx.toLocal(e)));drawing=true;
        if(!write(key)||!pts.length)return null;
      }else{
        if(!allowed())return null;
        const r=polyAdd(pts,h0,ctx.place(e,from),closed);
        pts.splice(0,pts.length,...r.pts);idx=r.idx;drawing=true;S.pick('node',idx);
        if(!write(key))return null; // (refused: write has put the document's points back)
      }
      wrote=true;S.pick('node',idx);build();
      return {move(_,ev){
        if(dead||!pts[idx]||(!dragging&&Math.hypot(ev.clientX-x0,ev.clientY-y0)<=thr))return;dragging=true;
        pts[idx]=ctx.place(ev,from);write(key);layout();
      },end(){layout();return null},cancel(){ // Esc during the press: it never happened (what it added is the newest undo step)
        if(wrote)ctx.undo();if(dead)return;if(h0>=0)S.pick('node',h0);layout();
      }};
    },
  };
  build();
  return {pen,update(){pts=parse();build()},destroy(){dead=true;g.remove()},
    deleteSelection:del,clearSelection(){S.clear();layout()},get selection(){return S.size?{kind:'node',items:S.items}:null}};
});
