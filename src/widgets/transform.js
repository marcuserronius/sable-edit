import {mk} from '../dom.js';
import {ownM,fmtTransform} from '../xform.js';
import {rnd} from '../util.js';
import {LIN,ROT} from '../glyph.js';
const ACC='var(--acc,#2f6fed)',PANEL='var(--panel,#fff)',r6=v=>+v.toFixed(6);
/* resize cursor closest to a screen-space direction */
const cursor=a=>['ew','nwse','ns','nesw'][Math.round((((a%Math.PI)+Math.PI)%Math.PI)/(Math.PI/4))%4]+'-resize';
const nz=s=>Math.abs(s)<.001?(s<0?-.001:.001):s; // never collapse to a singular matrix
const CAP={sc:'transform.scale',sx:'transform.scale',sy:'transform.scale',rot:'transform.rotate',kx:'transform.skew',ky:'transform.skew'}; // what each handle needs; the policy hides the rest
/* Generic transform layers, for any element. Both write the element's own `transform` attribute and
   show the bounding box of its geometry in the element's own (possibly rotated/skewed) frame.
     kind 'scale'  : corners resize proportionally along the diagonal, edge midpoints resize one axis; the opposite side stays put
     kind 'rotate' : corners rotate about the box centre (Shift = 15 degree steps), edge midpoints skew parallel to their edge */
export function transformLayer(ctx,kind){
  const el=ctx.el,g=mk('g'),A=(e,o)=>{for(const k in o)e.setAttribute(k,o[k])},ol=mk('polygon',{fill:'none',stroke:ACC});
  g.append(ol);ctx.overlay.append(g);let dead=false,cap=null; // cap: the capability of the handle being dragged
  const frame=(e,hx,hy)=>{ // pointer mapper frozen to the element's frame at gesture start
    const inv=ctx.matrix().inverse(),loc=ev=>{const o=ctx.toOverlay(ev),q=new DOMPoint(o[0],o[1]).matrixTransform(inv);return [q.x,q.y]},p0=loc(e);
    return {b:ctx.bbox(),t0:el.getAttribute('transform')||'',dirty:false,at:ev=>{const p=loc(ev);return [hx+p[0]-p0[0],hy+p[1]-p0[1]]}};
  };
  const put=(S,pre,post)=>{ctx.set('transform',[pre,S.t0,post].filter(Boolean).join(' '),'widget',cap);S.dirty=true};
  const begin={
    sc:(ix,iy)=>e=>{const b=ctx.bbox(),hx=b.x+b.w*ix,hy=b.y+b.h*iy,ax=b.x+b.w*(1-ix),ay=b.y+b.h*(1-iy),vx=hx-ax,vy=hy-ay,L=vx*vx+vy*vy,S=frame(e,hx,hy);
      return {S,move:ev=>{if(L<1e-12)return;const p=S.at(ev),s=nz(((p[0]-ax)*vx+(p[1]-ay)*vy)/L);
        put(S,'',`translate(${rnd(ax)} ${rnd(ay)}) scale(${r6(s)}) translate(${rnd(-ax)} ${rnd(-ay)})`)}}},
    sx:(ix,iy)=>e=>{const b=ctx.bbox(),hx=b.x+b.w*ix,ax=b.x+b.w*(1-ix),S=frame(e,hx,b.y+b.h/2);
      return {S,move:ev=>{if(Math.abs(hx-ax)<1e-9)return;const s=nz((S.at(ev)[0]-ax)/(hx-ax));put(S,'',`translate(${rnd(ax)} 0) scale(${r6(s)} 1) translate(${rnd(-ax)} 0)`)}}},
    sy:(ix,iy)=>e=>{const b=ctx.bbox(),hy=b.y+b.h*iy,ay=b.y+b.h*(1-iy),S=frame(e,b.x+b.w/2,hy);
      return {S,move:ev=>{if(Math.abs(hy-ay)<1e-9)return;const s=nz((S.at(ev)[1]-ay)/(hy-ay));put(S,'',`translate(0 ${rnd(ay)}) scale(1 ${r6(s)}) translate(0 ${rnd(-ay)})`)}}},
    rot:()=>e=>{ // pivot and angles live in the parent frame, which doesn't change while we rewrite the element's transform
      const M0=ownM(el),Pinv=ctx.matrix().multiply(M0.inverse()).inverse(),b=ctx.bbox(),c=new DOMPoint(b.x+b.w/2,b.y+b.h/2).matrixTransform(M0),
        par=ev=>{const o=ctx.toOverlay(ev),q=new DOMPoint(o[0],o[1]).matrixTransform(Pinv);return Math.atan2(q.y-c.y,q.x-c.x)},a0=par(e),S={t0:el.getAttribute('transform')||'',dirty:false};
      return {S,move:ev=>{let d=(par(ev)-a0)*180/Math.PI;if(ev.shiftKey)d=Math.round(d/15)*15;put(S,`rotate(${+d.toFixed(3)} ${rnd(c.x)} ${rnd(c.y)})`,'')}}},
    kx:(ix,iy)=>e=>{const b=ctx.bbox(),hy=b.y+b.h*iy,ay=b.y+b.h*(1-iy),d=hy-ay,cx=b.x+b.w/2,S=frame(e,cx,hy);
      return {S,move:ev=>{if(Math.abs(d)<1e-9)return;const k=(S.at(ev)[0]-cx)/d;put(S,'',`matrix(1 0 ${r6(k)} 1 ${rnd(-k*ay)} 0)`)}}},
    ky:(ix,iy)=>e=>{const b=ctx.bbox(),hx=b.x+b.w*ix,ax=b.x+b.w*(1-ix),d=hx-ax,cy=b.y+b.h/2,S=frame(e,hx,cy);
      return {S,move:ev=>{if(Math.abs(d)<1e-9)return;const k=(S.at(ev)[1]-cy)/d;put(S,'',`matrix(1 ${r6(k)} 0 1 0 ${rnd(-k*ax)})`)}}}
  };
  const specs=[];
  for(const iy of [0,.5,1])for(const ix of [0,.5,1]){
    if(ix===.5&&iy===.5)continue;
    const corner=ix!==.5&&iy!==.5,vert=ix!==.5&&iy===.5; // vert: a left/right edge midpoint
    const role=kind==='scale'?(corner?'sc':vert?'sx':'sy'):(corner?'rot':vert?'ky':'kx');
    const h=mk('g',{style:'pointer-events:all'});
    h.append(mk('circle',{r:8,fill:PANEL,stroke:ACC,'stroke-width':1.2}),mk('path',{d:role==='rot'?ROT:LIN,fill:'none',stroke:ACC,'stroke-width':1.4,'stroke-linecap':'round','stroke-linejoin':'round'}));
    g.append(h);specs.push({ix,iy,role,g:h});
    h.addEventListener('pointerdown',e=>{
      e.stopPropagation();h.setPointerCapture(e.pointerId);cap=CAP[role];const G=begin[role](ix,iy)(e);if(!G)return;
      const mv=ev=>G.move(ev);h.addEventListener('pointermove',mv);
      h.addEventListener('pointerup',()=>{h.removeEventListener('pointermove',mv);if(G.S.dirty)ctx.set('transform',fmtTransform(ownM(el)),'widget',cap)},{once:true});
    });
  }
  function layout(){
    const b=ctx.bbox();g.style.display=b?'':'none';if(!b)return;
    const M=ctx.matrix(),T=(x,y)=>{const q=new DOMPoint(x,y).matrixTransform(M);return [q.x,q.y]},C=T(b.x+b.w/2,b.y+b.h/2);
    A(ol,{points:[[b.x,b.y],[b.x+b.w,b.y],[b.x+b.w,b.y+b.h],[b.x,b.y+b.h]].map(p=>T(p[0],p[1])).join(' '),'stroke-width':ctx.px(1.5),'stroke-dasharray':ctx.px(5)+' '+ctx.px(3)});
    specs.forEach(s=>{
      let [x,y]=T(b.x+b.w*s.ix,b.y+b.h*s.iy);
      // a tiny box would bury the shape under its own handles: fan them out to a minimum screen distance from the centre so the middle stays grabbable
      const dx=s.ix-.5,dy=s.iy-.5,min=ctx.px(dx&&dy?24:20);let vx=x-C[0],vy=y-C[1],d=Math.hypot(vx,vy);
      if(d<min){if(d<1e-6){vx=M.a*dx+M.c*dy;vy=M.b*dx+M.d*dy;d=Math.hypot(vx,vy)||1}x=C[0]+vx/d*min;y=C[1]+vy/d*min}
      // arrow axis: along the diagonal / away from the centre for corners; along the local x or y axis for edges
      const v=s.role==='sc'||s.role==='rot'?[x-C[0],y-C[1]]:s.role==='sx'||s.role==='kx'?[M.a,M.b]:[M.c,M.d],a=Math.atan2(v[1],v[0]);
      A(s.g,{transform:`translate(${x} ${y}) rotate(${a*180/Math.PI}) scale(${ctx.px(1)})`});
      s.g.style.cursor=s.role==='rot'?'grab':cursor(a);
      // a handle whose axis has no extent (e.g. vertical scale of a horizontal line) can't do anything: hide it rather than let it sit on the shape's centre, where it would block grabbing the shape
      const e=1e-9,live={sc:b.w>e||b.h>e,sx:b.w>e,sy:b.h>e,rot:true,kx:b.h>e,ky:b.w>e}[s.role];
      s.g.style.display=live&&ctx.can(CAP[s.role])?'':'none';
    });
  }
  ctx.on('view',()=>!dead&&layout());ctx.on('change',()=>!dead&&layout());layout();
  return {update:layout,destroy(){dead=true;g.remove()}};
}
