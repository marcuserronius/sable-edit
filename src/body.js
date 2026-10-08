import {mover} from './move.js';
import {ownM,fmtTransform} from './xform.js';
import {rnd} from './util.js';
const DBL=300; // ms a deferred click waits for a possible second press before it switches mode
/* Body grab: pressing the selected shape itself (or a widget's transparent grab proxy for it, via ctx.grab) is the one gesture
   that moves it and switches its mode. Drag = move; release without dragging = next mode.
   Moving rewrites the shape's own coordinates where it can (rect, circle, ellipse, line, polygon, polyline, path)
   and otherwise adds a translate() to `transform`. Without the transform.move capability the drag does nothing (it is still not a click).
     fresh : this press just selected the shape, so releasing without a drag must not also switch mode
     defer : the press landed on something that also means double-click (path/polygon stroke: add a node), so the mode switch
             waits DBL ms and a second press cancels it
   Listeners live on window, not on the pressed element, because widgets rebuild their overlay mid-drag. */
export function bodyGrab(ctx,{cycle,moved,done}){
  const el=ctx.el;let timer=0,armed=-1e9,busy=false,off=null;
  const cancel=()=>{clearTimeout(timer);timer=0};
  function grab(e,{fresh=false,defer=false}={}){
    if(e.button!==0||busy)return;
    const second=performance.now()-armed<DBL;armed=-1e9;cancel();
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
      if(go||fresh||second||ev.type!=='pointerup')return;
      if(defer){armed=performance.now();timer=setTimeout(()=>{timer=0;cycle()},DBL)}else cycle();
    }
    addEventListener('pointermove',move);addEventListener('pointerup',end);addEventListener('pointercancel',end);off=stop;
  }
  return {grab,cancel,get busy(){return busy},destroy(){cancel();off&&off()}};
}
