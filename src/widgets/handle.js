import {mk} from '../dom.js';
export function handleWidget(ctx,specs,outline){
  const g=mk('g'),A=(e,o)=>{for(const k in o)e.setAttribute(k,o[k])}; ctx.overlay.append(g); let dead=false;
  const ols=[]; // outline() returns one polygon, or an array of polygons (first = dashed outline, the rest = dotted guides)
  const items=specs.map(sp=>{
    const el=mk(sp.sq?'rect':'circle',{style:'pointer-events:all;cursor:move',fill:sp.sq?'var(--panel,#fff)':'var(--acc,#2f6fed)',stroke:'var(--acc,#2f6fed)'}); g.append(el);
    el.addEventListener('pointerdown',e=>{
      e.stopPropagation();if(sp.locked&&sp.locked())return; // a pinned handle (sp.locked) is drawn grey and doesn't drag
      el.setPointerCapture(e.pointerId);const p0=ctx.toLocal(e);sp.start&&sp.start(p0);
      const mv=ev=>sp.drag(ctx.toLocal(ev),p0,ev);
      el.addEventListener('pointermove',mv);el.addEventListener('pointerup',()=>el.removeEventListener('pointermove',mv),{once:true});
    });
    return {el,sp};
  });
  function layout(){
    const M=ctx.matrix(),T=p=>{const q=new DOMPoint(p[0],p[1]).matrixTransform(M);return [q.x,q.y]},w=ctx.px(1.5);
    if(outline){const o=outline(),polys=Array.isArray(o[0][0])?o:[o];
      polys.forEach((poly,i)=>{
        if(!ols[i]){ols[i]=mk('polygon',{fill:'none',stroke:'var(--acc,#2f6fed)'});g.insertBefore(ols[i],g.firstChild)}
        A(ols[i],{points:poly.map(T).join(' '),'stroke-width':w,'stroke-dasharray':i?ctx.px(1.5)+' '+ctx.px(2.5):ctx.px(5)+' '+ctx.px(3)});
      });
    }
    items.forEach(({el,sp})=>{const [x,y]=T(sp.get()),r=ctx.px(sp.sq?5:4.5),lk=sp.locked&&sp.locked();
      el.style.cursor=lk?'not-allowed':'move';el.setAttribute('fill',lk?'#ddd':sp.sq?'var(--panel,#fff)':'var(--acc,#2f6fed)');el.setAttribute('stroke',lk?'#888':'var(--acc,#2f6fed)');
      A(el,sp.sq?{x:x-r,y:y-r,width:2*r,height:2*r,'stroke-width':w}:{cx:x,cy:y,r,'stroke-width':w})});
  }
  ctx.on('view',()=>!dead&&layout()); ctx.on('change',()=>!dead&&layout()); layout();
  return {update:layout,destroy(){dead=true;g.remove()}};
}
