import {Widgets} from '../registry.js';
import {handleWidget} from './handle.js';
import {num,rnd,box4} from '../util.js';
/* rect: 8 resize handles (drag past the opposite edge to flip) + centre dot to move */
Widgets.register(el=>el.tagName==='rect',ctx=>{
  const el=ctx.el,rect=()=>({x:num(el,'x'),y:num(el,'y'),w:num(el,'width'),h:num(el,'height')}); let r0; const specs=[];
  for(const iy of [0,.5,1])for(const ix of [0,.5,1]){
    const mid=ix===.5&&iy===.5;
    specs.push({sq:!mid,get:()=>{const r=rect();return [r.x+r.w*ix,r.y+r.h*iy]},start:()=>{r0=rect()},drag:(p,p0)=>{
      let {x,y,w,h}=r0;
      if(mid){x+=p[0]-p0[0];y+=p[1]-p0[1]}
      else{
        if(ix!==.5){const a=ix?x:x+w;x=Math.min(a,p[0]);w=Math.abs(a-p[0])}
        if(iy!==.5){const a=iy?y:y+h;y=Math.min(a,p[1]);h=Math.abs(a-p[1])}
      }
      ctx.set('x',rnd(x));ctx.set('y',rnd(y)); if(!mid){ctx.set('width',rnd(w));ctx.set('height',rnd(h))}
    }});
  }
  return handleWidget(ctx,specs,()=>{const r=rect();return box4(r.x,r.y,r.w,r.h)});
});
/* circle / ellipse: centre dot moves, square handles set the radii */
for(const tag of ['circle','ellipse'])Widgets.register(el=>el.tagName===tag,ctx=>{
  const el=ctx.el,c=()=>[num(el,'cx'),num(el,'cy')],ell=tag==='ellipse'; let c0;
  const rx=()=>num(el,ell?'rx':'r'),ry=()=>num(el,ell?'ry':'r');
  const specs=[
    {get:c,start:()=>{c0=c()},drag:(p,p0)=>{ctx.set('cx',rnd(c0[0]+p[0]-p0[0]));ctx.set('cy',rnd(c0[1]+p[1]-p0[1]))}},
    {sq:1,get:()=>[c()[0]+rx(),c()[1]],drag:p=>ctx.set(ell?'rx':'r',rnd(ell?Math.abs(p[0]-c()[0]):Math.hypot(p[0]-c()[0],p[1]-c()[1])))}];
  if(ell)specs.push({sq:1,get:()=>[c()[0],c()[1]+ry()],drag:p=>ctx.set('ry',rnd(Math.abs(p[1]-c()[1])))});
  return handleWidget(ctx,specs,()=>box4(c()[0]-rx(),c()[1]-ry(),2*rx(),2*ry()));
});
/* line: two endpoints + midpoint dot to move the whole line */
Widgets.register(el=>el.tagName==='line',ctx=>{
  const el=ctx.el,P=(a,b)=>[num(el,a),num(el,b)]; let s0;
  return handleWidget(ctx,[
    {sq:1,get:()=>P('x1','y1'),drag:p=>{ctx.set('x1',rnd(p[0]));ctx.set('y1',rnd(p[1]))}},
    {sq:1,get:()=>P('x2','y2'),drag:p=>{ctx.set('x2',rnd(p[0]));ctx.set('y2',rnd(p[1]))}},
    {get:()=>{const a=P('x1','y1'),b=P('x2','y2');return [(a[0]+b[0])/2,(a[1]+b[1])/2]},
     start:()=>{s0=['x1','y1','x2','y2'].map(k=>num(el,k))},
     drag:(p,p0)=>{const dx=p[0]-p0[0],dy=p[1]-p0[1];['x1','y1','x2','y2'].forEach((k,i)=>ctx.set(k,rnd(s0[i]+(i%2?dy:dx))))}}
  ]);
});
