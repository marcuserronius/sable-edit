import {mover} from './move.js';
import {ownM,fmtTransform} from './xform.js';
import {rnd} from './util.js';
/* Body grab: pressing the selected shape itself (or a widget's transparent grab proxy for it, via ctx.grab) is the one gesture
   that moves it and switches its mode. Drag = move; release without dragging = next mode.
   Moving rewrites the shape's own coordinates where it can (rect, circle, ellipse, line, polygon, polyline, path)
   and otherwise adds a translate() to `transform`. Without the transform.move capability the drag does nothing (it is still not a click).
     fresh : this press just selected the shape, so releasing without a drag must not also switch mode
     click : what a release without a drag does instead of switching mode (the path editor selects the segment under the pointer)
   Nothing waits for a possible double-click: scale <-> rotate is harmless to do twice, and a double-click goes on to edit mode regardless.
   Listeners live on window, not on the pressed element, because widgets rebuild their overlay mid-drag. */
export function bodyGrab(ctx,{cycle,moved,done}){
  const el=ctx.el;let busy=false,off=null;
  function grab(e,{fresh=false,click}={}){
    if(e.button!==0||busy)return;
    const id=e.pointerId,thr=e.pointerType==='touch'?8:3,x0=e.clientX,y0=e.clientY,t0=el.getAttribute('transform')||'',l0=ctx.toLocal(e),p0=ctx.toParent(e);
    const CAP='transform.move',can=ctx.can(CAP),put=(a,v)=>ctx.set(a,v,'widget',CAP),mv=can?mover({el,set:put}):null; // writes declare which capability they use
    let go=false;busy=true;
    const move=ev=>{
      if(ev.pointerId!==id)return;
      if(!go){if(Math.hypot(ev.clientX-x0,ev.clientY-y0)<=thr)return;go=true}
      if(!can)return;
      if(mv){const p=ctx.toLocal(ev);ctx.batch(()=>mv(p[0]-l0[0],p[1]-l0[1]))} // a move writes several attributes: judge them as one step
      else{const p=ctx.toParent(ev);put('transform',`translate(${rnd(p[0]-p0[0])} ${rnd(p[1]-p0[1])})`+(t0?' '+t0:''))}
      moved();
    };
    const stop=()=>{removeEventListener('pointermove',move);removeEventListener('pointerup',end);removeEventListener('pointercancel',end);busy=false;off=null};
    function end(ev){
      if(ev.pointerId!==id)return;
      stop();
      if(go&&can&&!mv)put('transform',fmtTransform(ownM(el)));
      done();
      if(go||fresh||ev.type!=='pointerup')return;
      click?click():cycle();
    }
    addEventListener('pointermove',move);addEventListener('pointerup',end);addEventListener('pointercancel',end);off=stop;
  }
  return {grab,get busy(){return busy},destroy(){off&&off()}};
}
