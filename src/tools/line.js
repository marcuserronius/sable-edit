import {Tools} from '../tools.js';
import {rnd} from '../util.js';
/* two endpoints -> line attributes (x1,y1 = where the press was); null unless the length is above `min` (pure, Node-testable) */
export const lineFrom=(a,b,min=0)=>Math.hypot(b[0]-a[0],b[1]-a[1])>min?{x1:rnd(a[0]),y1:rnd(a[1]),x2:rnd(b[0]),y2:rnd(b[1])}:null;
/* line tool: mousedown = [x1,y1], drag, mouseup = [x2,y2]. A click, or a drag shorter than 2 screen px, makes nothing. */
Tools.register({id:'line',label:'Line',cursor:'crosshair',begin(t,p0){
  const el=t.make('line',{x1:rnd(p0[0]),y1:rnd(p0[1]),x2:rnd(p0[0]),y2:rnd(p0[1])}),put=c=>{for(const k in c)el.setAttribute(k,c[k])};
  return {move:p=>{const c=lineFrom(p0,p);c&&put(c)},end:p=>{const c=lineFrom(p0,p,t.px(2));if(!c)return null;put(c);return el}};
}});
