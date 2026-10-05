import {Widgets} from '../registry.js';
import {mk} from '../dom.js';
/* Built-in placeholder: bounding-box outline + corner markers (proves the handoff). */
Widgets.register(()=>true,ctx=>{
  const g=mk('g'); ctx.overlay.append(g);
  function update(){
    g.replaceChildren(); let b; try{b=ctx.el.getBBox()}catch{return}
    const M=ctx.matrix(), pts=[[b.x,b.y],[b.x+b.width,b.y],[b.x+b.width,b.y+b.height],[b.x,b.y+b.height]]
      .map(([x,y])=>{const p=new DOMPoint(x,y).matrixTransform(M);return [p.x,p.y]});
    g.append(mk('polygon',{points:pts.join(' '),fill:'none',stroke:'var(--acc,#2f6fed)','stroke-width':ctx.px(1.5),'stroke-dasharray':ctx.px(5)+' '+ctx.px(3)}));
    pts.forEach(([x,y])=>g.append(mk('rect',{x:x-ctx.px(4),y:y-ctx.px(4),width:ctx.px(8),height:ctx.px(8),fill:'var(--panel,#fff)',stroke:'var(--acc,#2f6fed)','stroke-width':ctx.px(1.5)})));
  }
  ctx.on('view',update); ctx.on('change',update); update();
  return {update,destroy(){g.remove()}};
});
