import {Tools} from '../tools.js';
import {rnd} from '../util.js';
/* two opposite corners -> rect attributes (x, y = top-left; width, height positive); null unless BOTH sides are above `min`
   (pure, Node-testable) */
export const rectFrom=(a,b,min=0)=>{
  const w=Math.abs(b[0]-a[0]),h=Math.abs(b[1]-a[1]);
  return w>min&&h>min?{x:rnd(Math.min(a[0],b[0])),y:rnd(Math.min(a[1],b[1])),width:rnd(w),height:rnd(h)}:null;
};
/* rect tool: mousedown = first corner [x1,y1], drag, mouseup = opposite corner [x2,y2]; any drag direction works.
   A click, or a drag thinner than 2 screen px in either direction, makes nothing. */
Tools.register({id:'rect',label:'Rectangle',cursor:'crosshair',begin(t,p0){
  const el=t.make('rect',{x:rnd(p0[0]),y:rnd(p0[1]),width:0,height:0}),put=c=>{for(const k in c)el.setAttribute(k,c[k])};
  return {move:p=>{const c=rectFrom(p0,p);c&&put(c)},end:p=>{const c=rectFrom(p0,p,t.px(2));if(!c)return null;put(c);return el}};
}});
