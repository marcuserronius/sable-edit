/* Handle glyphs as SVG path data in screen-pixel units: origin at the handle centre, arrow axis along +x.
   Callers place them with translate(x y) rotate(deg) scale(ctx.px(1)). */
const f=n=>+n.toFixed(2);
/* open arrowhead with its tip at (x,y), pointing in direction a */
export const chev=(x,y,a,s=2.6,d=.7)=>{const p=k=>`${f(x-s*Math.cos(a+k))} ${f(y-s*Math.sin(a+k))}`;return `M${p(d)}L${f(x)} ${f(y)}L${p(-d)}`};
/* straight double arrow: scale handles (perpendicular to an edge / along a diagonal) and skew handles (parallel to an edge) */
export const LIN=`M-4.6 0H4.6${chev(4.6,0,0)}${chev(-4.6,0,Math.PI)}`;
/* bent double arrow, bulging toward +x (outward from the pivot): rotate handles */
const R=5.6,CX=-3.8,A=1.2,ex=Math.cos(A)*R+CX,ey=Math.sin(A)*R;
export const ROT=`M${f(ex)} ${f(-ey)}A${R} ${R} 0 0 1 ${f(ex)} ${f(ey)}${chev(ex,ey,A+Math.PI/2,2.3,.6)}${chev(ex,-ey,-A-Math.PI/2,2.3,.6)}`;
/* four-way arrow: the hub */
export const CROSS=`M-5 0H5M0-5V5${chev(5,0,0)}${chev(-5,0,Math.PI)}${chev(0,5,Math.PI/2)}${chev(0,-5,-Math.PI/2)}`;
