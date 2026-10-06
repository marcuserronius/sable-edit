import {Widgets} from '../registry.js';
import {handleWidget} from './handle.js';
import {num,rnd,box4} from '../util.js';
/* rect, edit mode: two corner nodes (x1,y1 / x2,y2 - opposite corners, drag one past the other and it keeps tracking
   its own corner) and one corner-radius handle. The radius handle sits on a free corner (top row, preferring the right)
   and moves into the interior: at inset (rx,ry) from that corner, so the handle's x and y offsets ARE the two radii.
   With radius 0 it sits exactly on the corner. Shift = circular. Moving the whole rect is the hub's job. */
Widgets.register(el=>el.tagName==='rect',ctx=>{
  const el=ctx.el,rect=()=>({x:num(el,'x'),y:num(el,'y'),w:num(el,'width'),h:num(el,'height')});
  let A,B,a0,b0,rr0,busy=false; // busy: x/y/width/height are written one at a time, so don't resync from a half-written rect
  const fromAB=()=>({x:Math.min(A[0],B[0]),y:Math.min(A[1],B[1]),w:Math.abs(A[0]-B[0]),h:Math.abs(A[1]-B[1])});
  const sync=()=>{if(busy)return;const r=rect(),q=A&&fromAB();if(!q||Math.abs(q.x-r.x)+Math.abs(q.y-r.y)+Math.abs(q.w-r.w)+Math.abs(q.h-r.h)>2e-3){A=[r.x,r.y];B=[r.x+r.w,r.y+r.h]}};
  const write=()=>{const q=fromAB();busy=true;try{ctx.set('x',rnd(q.x));ctx.set('y',rnd(q.y));ctx.set('width',rnd(q.w));ctx.set('height',rnd(q.h))}finally{busy=false}};
  /* an unset rx/ry follows the other (SVG); both are clamped to half the side, as rendered */
  const radii=()=>{const r=rect(),a=parseFloat(el.getAttribute('rx')),b=parseFloat(el.getAttribute('ry')),
    rx=a>=0?a:b>=0?b:0,ry=b>=0?b:a>=0?a:0;return [Math.min(rx,r.w/2),Math.min(ry,r.h/2)]};
  const corner=()=>{sync();const r=rect(),ax=A[0]<=B[0]?0:1,ay=A[1]<=B[1]?0:1,fx=ay?ax:1-ax; // top-row corner not occupied by a node
    return {cx:r.x+r.w*fx,cy:r.y,sx:fx?-1:1}};
  const node=(get,set)=>({sq:1,get:()=>{sync();return get()},start:()=>{sync();a0=[...A];b0=[...B]},drag:(p,p0)=>{set(p[0]-p0[0],p[1]-p0[1]);write()}});
  const specs=[
    node(()=>A,(dx,dy)=>{A=[rnd(a0[0]+dx),rnd(a0[1]+dy)]}),
    node(()=>B,(dx,dy)=>{B=[rnd(b0[0]+dx),rnd(b0[1]+dy)]}),
    {get:()=>{const c=corner(),[rx,ry]=radii();return [c.cx+c.sx*rx,c.cy+ry]},
     start:()=>{rr0=radii()},
     drag:(p,p0,ev)=>{const r=rect(),c=corner();let rx=rr0[0]+(p[0]-p0[0])*c.sx,ry=rr0[1]+(p[1]-p0[1]);
       rx=Math.max(0,Math.min(rx,r.w/2));ry=Math.max(0,Math.min(ry,r.h/2));
       if(ev&&ev.shiftKey)rx=ry=Math.min((rx+ry)/2,r.w/2,r.h/2);
       ctx.set('rx',rnd(rx));ctx.set('ry',rnd(ry))}}];
  return handleWidget(ctx,specs,()=>{const r=rect(),c=corner(),[rx,ry]=radii();
    return [box4(r.x,r.y,r.w,r.h),[[c.cx,c.cy],[c.cx+c.sx*rx,c.cy],[c.cx+c.sx*rx,c.cy+ry],[c.cx,c.cy+ry]]]});
});
/* circle / ellipse, edit mode: square handles set the radii (moving is the hub's job) */
for(const tag of ['circle','ellipse'])Widgets.register(el=>el.tagName===tag,ctx=>{
  const el=ctx.el,c=()=>[num(el,'cx'),num(el,'cy')],ell=tag==='ellipse';
  const rx=()=>num(el,ell?'rx':'r'),ry=()=>num(el,ell?'ry':'r');
  const specs=[
    {sq:1,get:()=>[c()[0]+rx(),c()[1]],drag:p=>ctx.set(ell?'rx':'r',rnd(ell?Math.abs(p[0]-c()[0]):Math.hypot(p[0]-c()[0],p[1]-c()[1])))}];
  if(ell)specs.push({sq:1,get:()=>[c()[0],c()[1]+ry()],drag:p=>ctx.set('ry',rnd(Math.abs(p[1]-c()[1])))});
  return handleWidget(ctx,specs,()=>box4(c()[0]-rx(),c()[1]-ry(),2*rx(),2*ry()));
});
/* line, edit mode: two endpoints (moving the whole line is the hub's job) */
Widgets.register(el=>el.tagName==='line',ctx=>{
  const el=ctx.el,P=(a,b)=>[num(el,a),num(el,b)];
  return handleWidget(ctx,[
    {sq:1,get:()=>P('x1','y1'),drag:p=>{ctx.set('x1',rnd(p[0]));ctx.set('y1',rnd(p[1]))}},
    {sq:1,get:()=>P('x2','y2'),drag:p=>{ctx.set('x2',rnd(p[0]));ctx.set('y2',rnd(p[1]))}}
  ]);
});
