import {mk} from '../dom.js';
const GEO={path:['d'],polygon:['points'],polyline:['points'],line:['x1','y1','x2','y2'],rect:['x','y','width','height','rx','ry'],circle:['cx','cy','r'],ellipse:['cx','cy','rx','ry']};
/* Grab halo: an invisible, stroke-only copy of the selected shape's outline, a few pixels fat, drawn under the handles.
   It keeps lines and unfilled paths grabbable (drag = move, click = next mode) even though their own stroke is thin.
   It has no fill on purpose: a shape drawn above the selection still wins a press inside its own area. */
export function haloWidget(ctx){
  const el=ctx.el,geo=GEO[el.tagName];if(!geo)return null;
  const h=mk(el.tagName,{'data-sable':'halo',fill:'none',stroke:'transparent','stroke-width':12,'vector-effect':'non-scaling-stroke',style:'pointer-events:stroke;cursor:move'});
  ctx.overlay.append(h);let dead=false;
  h.addEventListener('pointerdown',e=>ctx.grab(e));
  function layout(){
    geo.forEach(a=>{const v=el.getAttribute(a);v===null?h.removeAttribute(a):h.setAttribute(a,v)});
    const M=ctx.matrix();h.setAttribute('transform',`matrix(${M.a} ${M.b} ${M.c} ${M.d} ${M.e} ${M.f})`);
  }
  ctx.on('view',()=>!dead&&layout());ctx.on('change',()=>!dead&&layout());layout();
  return {update:layout,destroy(){dead=true;h.remove()}};
}
