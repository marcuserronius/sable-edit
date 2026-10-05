import {Widgets} from './registry.js';
import {mk} from './dom.js';
export function attach(svg,opts={}){
  const PRIM=opts.selector||'path,rect,circle,ellipse,line,polyline,polygon,text', root=opts.root||svg;
  let ov=opts.overlay; if(!ov){ov=mk('g',{style:'pointer-events:none'});svg.append(ov)}
  const hs={}, on=(e,f)=>{(hs[e]??=[]).push(f)}, emit=(e,d)=>(hs[e]||[]).forEach(f=>f(d));
  if(opts.onSelect)on('select',opts.onSelect); if(opts.onChange)on('change',d=>opts.onChange(d.el,d.attr,d.src));
  let sel=null,widget=null;

  /* undo/redo: edits made in one pointer gesture (or one burst of typing) form one step */
  const undoS=[],redoS=[]; let gid=0;
  const record=(el,attr,old,nw,src)=>{
    const key=src+':'+(src==='widget'?gid:attr),now=Date.now(),last=undoS.at(-1);
    if(last&&last.key===key&&(src==='widget'||now-last.t<800)){
      const it=last.items.find(i=>i.el===el&&i.attr===attr);it?it.nw=nw:last.items.push({el,attr,old,nw});last.t=now;
    }else undoS.push({key,t:now,items:[{el,attr,old,nw}]});
    redoS.length=0;emit('history');
  };
  const setAttr=(el,attr,v,src='app')=>{
    const old=el.getAttribute(attr);if(old===String(v))return;
    el.setAttribute(attr,v);record(el,attr,old,String(v),src);emit('change',{el,attr,src});
  };
  const step=(from,to,dir)=>{
    const g=from.pop();if(!g)return;
    (dir>0?g.items:[...g.items].reverse()).forEach(i=>{
      const v=dir>0?i.nw:i.old;v===null?i.el.removeAttribute(i.attr):i.el.setAttribute(i.attr,v);
      emit('change',{el:i.el,attr:i.attr,src:'history'});
    });
    to.push(g);emit('history');
  };
  const undo=()=>step(undoS,redoS,-1),redo=()=>step(redoS,undoS,1);
  const clearHistory=()=>{undoS.length=redoS.length=0;emit('history')};
  const onDown=()=>{gid++};
  const onKey=e=>{
    const t=document.activeElement;if(/INPUT|TEXTAREA|SELECT/.test(t?.tagName)||t?.isContentEditable)return;
    if(!(e.ctrlKey||e.metaKey))return;const k=e.key.toLowerCase();
    if(k==='z'){e.preventDefault();e.shiftKey?redo():undo()}else if(k==='y'){e.preventDefault();redo()}
  };
  svg.addEventListener('pointerdown',onDown,true);
  if(opts.keys!==false)addEventListener('keydown',onKey);
  const scale=()=>{const m=ov.getScreenCTM();return m?Math.hypot(m.a,m.b)||1:1};
  const matrixFor=el=>ov.getCTM().inverse().multiply(el.getCTM());
  function select(el){
    if(el===sel)return;
    widget?.destroy();widget=null;ov.replaceChildren();sel=el;
    if(el){
      const ctx={el,overlay:ov,on,matrix:()=>matrixFor(el),px:n=>n/scale(),
        toLocal(e){const q=new DOMPoint(e.clientX,e.clientY).matrixTransform(ov.getScreenCTM().inverse()).matrixTransform(matrixFor(el).inverse());return [q.x,q.y]},
        set(a,v,src='widget'){setAttr(el,a,v,src)}};
      widget=Widgets.find(el).factory(ctx);
    }
    emit('select',el);
  }
  const onClick=e=>{if(ov.contains(e.target))return;const t=e.target.closest?.(PRIM);select(t&&root.contains(t)?t:null)};
  if(opts.pick!==false)svg.addEventListener('click',onClick);
  return {select,set:setAttr,undo,redo,clearHistory,get canUndo(){return undoS.length>0},get canRedo(){return redoS.length>0},get selected(){return sel},on,
    refresh(){emit('view')}, changed(el,attr,src='app'){emit('change',{el,attr,src})},
    destroy(){select(null);svg.removeEventListener('click',onClick);svg.removeEventListener('pointerdown',onDown,true);removeEventListener('keydown',onKey);if(!opts.overlay)ov.remove()}};
}
