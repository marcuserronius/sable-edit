import {parsePath,serPath} from './path-math.js';
import {num,rnd} from './util.js';
/* Geometry-native translation: rewrites the element's own coordinates instead of adding a transform.
   Returns fn(dx,dy) (local units, relative to the state when mover() was called), or null when the
   element type has no simple form, in which case the caller falls back to the `transform` attribute. */
export function mover(ctx){
  const el=ctx.el,t=el.tagName;
  const pairs={rect:[['x','y']],circle:[['cx','cy']],ellipse:[['cx','cy']],line:[['x1','y1'],['x2','y2']]}[t];
  if(pairs){const s=pairs.map(p=>p.map(a=>num(el,a)));return (dx,dy)=>pairs.forEach((p,i)=>{ctx.set(p[0],rnd(s[i][0]+dx));ctx.set(p[1],rnd(s[i][1]+dy))})}
  if(t==='polygon'||t==='polyline'){
    const n=(el.getAttribute('points')||'').match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g)||[],p=[];
    for(let i=0;i+1<n.length;i+=2)p.push([+n[i],+n[i+1]]);
    return (dx,dy)=>ctx.set('points',p.map(q=>rnd(q[0]+dx)+','+rnd(q[1]+dy)).join(' '));
  }
  if(t==='path'){const segs=parsePath(el.getAttribute('d')||'');return (dx,dy)=>ctx.set('d',serPath(segs.map(s=>({...s,pts:s.pts.map(q=>[q[0]+dx,q[1]+dy])}))))}
  return null;
}
