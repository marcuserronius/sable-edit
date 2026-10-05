import {Widgets} from '../registry.js';
import {mk} from '../dom.js';
import {rnd} from '../util.js';
/* polygon / polyline: vertex squares (drag to move), centre dot moves the whole shape,
   double-click an edge to add a vertex, double-click a vertex to delete it */
for(const tag of ['polygon','polyline'])Widgets.register(el=>el.tagName===tag,ctx=>{
  const el=ctx.el,closed=tag==='polygon',g=mk('g'),A=(e,o)=>{for(const k in o)e.setAttribute(k,o[k])}; ctx.overlay.append(g);
  const parse=()=>{const n=(el.getAttribute('points')||'').match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g)||[],p=[];
    for(let i=0;i+1<n.length;i+=2)p.push([+n[i],+n[i+1]]);return p};
  let pts=parse(),items=[],hit,dead=false,mv0=false,mv1=false;
  const write=()=>ctx.set('points',pts.map(p=>rnd(p[0])+','+rnd(p[1])).join(' '));
  const centroid=()=>[pts.reduce((s,p)=>s+p[0],0)/pts.length,pts.reduce((s,p)=>s+p[1],0)/pts.length];
  function drag(h,start,move){
    h.addEventListener('pointerdown',e=>{
      e.stopPropagation();h.setPointerCapture(e.pointerId);const p0=ctx.toLocal(e);start();mv0=mv1;mv1=false;
      const mv=ev=>{if(Math.hypot(ev.clientX-e.clientX,ev.clientY-e.clientY)>3)mv1=true;move(ctx.toLocal(ev),p0);write();layout()};
      h.addEventListener('pointermove',mv);h.addEventListener('pointerup',()=>h.removeEventListener('pointermove',mv),{once:true});
    });
  }
  function insert(p){
    let best=null;const n=pts.length;
    for(let i=0;i<(closed?n:n-1);i++){
      const a=pts[i],b=pts[(i+1)%n],dx=b[0]-a[0],dy=b[1]-a[1],L=dx*dx+dy*dy;
      const t=L?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/L)):0;
      const q=[a[0]+dx*t,a[1]+dy*t],d=Math.hypot(q[0]-p[0],q[1]-p[1]);
      if(!best||d<best.d)best={d,i,q};
    }
    if(!best)return;pts.splice(best.i+1,0,best.q);write();build();
  }
  function build(){
    g.replaceChildren();items=[];
    hit=mk(tag,{fill:'none',stroke:'transparent','stroke-width':12,'vector-effect':'non-scaling-stroke',style:'pointer-events:stroke;cursor:copy'});
    hit.addEventListener('dblclick',e=>insert(ctx.toLocal(e)));g.append(hit);
    pts.forEach((_,i)=>{
      const h=mk('rect',{style:'pointer-events:all;cursor:move',fill:'var(--panel,#fff)',stroke:'var(--acc,#2f6fed)'});g.append(h);
      items.push({h,get:()=>pts[i],r:5,n:1}); 
      drag(h,()=>{},p=>{pts[i]=p});
      h.addEventListener('dblclick',e=>{e.stopPropagation();if(mv0||mv1||pts.length<=(closed?3:2))return;pts.splice(i,1);write();build()});
    });
    if(pts.length){
      const c=mk('circle',{style:'pointer-events:all;cursor:move',fill:'var(--acc,#2f6fed)',stroke:'var(--acc,#2f6fed)'});g.append(c);
      items.push({h:c,get:centroid,r:4.5}); let o;
      drag(c,()=>{o=pts.map(q=>[...q])},(p,p0)=>{pts=o.map(q=>[q[0]+p[0]-p0[0],q[1]+p[1]-p0[1]])});
    }
    layout();
  }
  function layout(){
    const M=ctx.matrix(),T=p=>{const q=new DOMPoint(p[0],p[1]).matrixTransform(M);return [q.x,q.y]},w=ctx.px(1.5);
    A(hit,{points:pts.map(p=>p.join(',')).join(' '),transform:`matrix(${M.a} ${M.b} ${M.c} ${M.d} ${M.e} ${M.f})`});
    items.forEach(it=>{const [x,y]=T(it.get()),r=ctx.px(it.r);
      A(it.h,it.n?{x:x-r,y:y-r,width:2*r,height:2*r,'stroke-width':w}:{cx:x,cy:y,r,'stroke-width':w})});
  }
  ctx.on('view',()=>!dead&&layout());
  ctx.on('change',({el:e,src})=>{if(dead||e!==el||src==='widget')return;pts=parse();build()});
  build();
  return {update(){pts=parse();build()},destroy(){dead=true;g.remove()}};
});
