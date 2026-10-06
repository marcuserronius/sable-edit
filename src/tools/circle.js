import {Tools} from '../tools.js';
import {rnd} from '../util.js';
/* centre + a point on the rim -> circle attributes; null when the radius is not above `min` (pure, Node-testable) */
export const circleFrom=(c,p,min=0)=>{const r=Math.hypot(p[0]-c[0],p[1]-c[1]);return r>min?{cx:rnd(c[0]),cy:rnd(c[1]),r:rnd(r)}:null};
/* circle tool: mousedown = centre, drag out to the radius, release. A click without a drag (under 2 screen px) makes nothing. */
Tools.register({id:'circle',label:'Circle',cursor:'crosshair',begin(t,p0){
  const el=t.make('circle',{cx:rnd(p0[0]),cy:rnd(p0[1]),r:0}),put=c=>{for(const k in c)el.setAttribute(k,c[k])};
  return {move:p=>{const c=circleFrom(p0,p);c&&put(c)},end:p=>{const c=circleFrom(p0,p,t.px(2));if(!c)return null;put(c);return el}};
}});
