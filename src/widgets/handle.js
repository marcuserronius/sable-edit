import {mk} from '../dom.js';
export function handleWidget(ctx,specs,outline){
  const g=mk('g'),A=(e,o)=>{for(const k in o)e.setAttribute(k,o[k])}; ctx.overlay.append(g); let dead=false;
  const ol=outline&&mk('polygon',{fill:'none',stroke:'var(--acc,#2f6fed)'}); ol&&g.append(ol);
  const items=specs.map(sp=>{
    const el=mk(sp.sq?'rect':'circle',{style:'pointer-events:all;cursor:move',fill:sp.sq?'var(--panel,#fff)':'var(--acc,#2f6fed)',stroke:'var(--acc,#2f6fed)'}); g.append(el);
    el.addEventListener('pointerdown',e=>{
      e.stopPropagation();el.setPointerCapture(e.pointerId);const p0=ctx.toLocal(e);sp.start&&sp.start(p0);
      const mv=ev=>sp.drag(ctx.toLocal(ev),p0,ev);
      el.addEventListener('pointermove',mv);el.addEventListener('pointerup',()=>el.removeEventListener('pointermove',mv),{once:true});
    });
    return {el,sp};
  });
  function layout(){
    const M=ctx.matrix(),T=p=>{const q=new DOMPoint(p[0],p[1]).matrixTransform(M);return [q.x,q.y]},w=ctx.px(1.5);
    if(ol)A(ol,{points:outline().map(T).join(' '),'stroke-width':w,'stroke-dasharray':ctx.px(5)+' '+ctx.px(3)});
    items.forEach(({el,sp})=>{const [x,y]=T(sp.get()),r=ctx.px(sp.sq?5:4.5);
      A(el,sp.sq?{x:x-r,y:y-r,width:2*r,height:2*r,'stroke-width':w}:{cx:x,cy:y,r,'stroke-width':w})});
  }
  ctx.on('view',()=>!dead&&layout()); ctx.on('change',()=>!dead&&layout()); layout();
  return {update:layout,destroy(){dead=true;g.remove()}};
}
