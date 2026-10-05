/* Shared helpers for widgets. */
export const num=(el,a)=>parseFloat(el.getAttribute(a))||0, rnd=v=>+v.toFixed(3);
export const box4=(x,y,w,h)=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h]];
