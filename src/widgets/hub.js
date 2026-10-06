import {mk} from '../dom.js';
import {mover} from '../move.js';
import {ownM,fmtTransform} from '../xform.js';
import {rnd} from '../util.js';
import {CROSS} from '../glyph.js';
const ACC='var(--acc,#2f6fed)',PANEL='var(--panel,#fff)';
/* The hub: a specially marked handle at the centre of the shape's bounding box, present in every mode.
   Drag = move the shape; click or tap = next mode. Three pips under it show which mode is active.
   Moving rewrites the shape's own coordinates where it can (rect, circle, ellipse, line, polygon, polyline, path)
   and otherwise adds a translate() to `transform`. */
export function hubWidget(ctx,{modes,index,cycle,moved}){
  const el=ctx.el,g=mk('g'),h=mk('g',{style:'pointer-events:all;cursor:move'}); let dead=false;
  const title=mk('title');title.textContent='Drag to move · click for the next mode ('+modes[index]+')';
  h.append(title,mk('circle',{r:12,fill:'none',stroke:ACC,'stroke-width':1}),mk('circle',{r:9,fill:ACC,stroke:PANEL,'stroke-width':1.6}),
    mk('path',{d:CROSS,fill:'none',stroke:PANEL,'stroke-width':1.3,'stroke-linecap':'round','stroke-linejoin':'round'}));
  g.append(h);
  modes.forEach((_,i)=>g.append(mk('circle',{cx:(i-(modes.length-1)/2)*6,cy:17,r:2,fill:i===index?ACC:PANEL,stroke:ACC,'stroke-width':1,style:'pointer-events:none'})));
  ctx.overlay.append(g);
  function layout(){
    const b=ctx.bbox();g.style.display=b?'':'none';if(!b)return;
    const q=new DOMPoint(b.x+b.w/2,b.y+b.h/2).matrixTransform(ctx.matrix());
    g.setAttribute('transform',`translate(${q.x} ${q.y}) scale(${ctx.px(1)})`);
  }
  h.addEventListener('pointerdown',e=>{
    e.stopPropagation();h.setPointerCapture(e.pointerId);
    const x0=e.clientX,y0=e.clientY,t0=el.getAttribute('transform')||'',mv=mover(ctx),l0=ctx.toLocal(e),p0=ctx.toParent(e);let go=false;
    const move=ev=>{
      if(!go){if(Math.hypot(ev.clientX-x0,ev.clientY-y0)<=3)return;go=true}
      if(mv){const p=ctx.toLocal(ev);mv(p[0]-l0[0],p[1]-l0[1])}
      else{const p=ctx.toParent(ev);ctx.set('transform',`translate(${rnd(p[0]-p0[0])} ${rnd(p[1]-p0[1])})`+(t0?' '+t0:''))}
      moved();
    };
    h.addEventListener('pointermove',move);
    h.addEventListener('pointerup',()=>{
      h.removeEventListener('pointermove',move);
      if(!go)cycle();else if(!mv)ctx.set('transform',fmtTransform(ownM(el)));
    },{once:true});
  });
  ctx.on('view',()=>!dead&&layout());ctx.on('change',()=>!dead&&layout());layout();
  return {update:layout,destroy(){dead=true;g.remove()}};
}
