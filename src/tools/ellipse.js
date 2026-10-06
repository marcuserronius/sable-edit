import {Tools} from '../tools.js';
import {rnd} from '../util.js';
/* two opposite corners of the bounding box -> ellipse attributes; null unless BOTH sides are above `min` (pure, Node-testable) */
export const ellipseFrom=(a,b,min=0)=>{
  const w=Math.abs(b[0]-a[0]),h=Math.abs(b[1]-a[1]);
  return w>min&&h>min?{cx:rnd((a[0]+b[0])/2),cy:rnd((a[1]+b[1])/2),rx:rnd(w/2),ry:rnd(h/2)}:null;
};
/* ellipse tool: drag out its bounding box like the rectangle tool (press = one corner, release = the opposite corner, any direction).
   A click, or a drag thinner than 2 screen px in either direction, makes nothing. */
Tools.register({id:'ellipse',label:'Ellipse',cursor:'crosshair',begin(t,p0){
  const el=t.make('ellipse',{cx:rnd(p0[0]),cy:rnd(p0[1]),rx:0,ry:0}),put=c=>{for(const k in c)el.setAttribute(k,c[k])};
  return {move:p=>{const c=ellipseFrom(p0,p);c&&put(c)},end:p=>{const c=ellipseFrom(p0,p,t.px(2));if(!c)return null;put(c);return el}};
}});
