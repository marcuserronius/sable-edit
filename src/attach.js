import {Widgets} from './registry.js';
import {mk} from './dom.js';
import {ownM} from './xform.js';
import {transformLayer} from './widgets/transform.js';
import {hubWidget} from './widgets/hub.js';
const MODES=['scale','rotate','edit'];
export function attach(svg,opts={}){
  const PRIM=opts.selector||'path,rect,circle,ellipse,line,polyline,polygon,text', root=opts.root||svg;
  let ov=opts.overlay; if(!ov){ov=mk('g',{style:'pointer-events:none'});svg.append(ov)}
  const hs={}, on=(e,f)=>{(hs[e]??=[]).push(f)}, emit=(e,d)=>[...(hs[e]||[])].forEach(f=>f(d));
  if(opts.onSelect)on('select',opts.onSelect); if(opts.onChange)on('change',d=>opts.onChange(d.el,d.attr,d.src));
  let sel=null,layer=null,hub=null,subs=[],pref=MODES.includes(opts.mode)?opts.mode:'scale';

  /* undo/redo: edits made in one pointer gesture (or one burst of typing) form one step */
  const undoS=[],redoS=[]; let gid=0;
  const record=(el,attr,old,nw,src)=>{
    const key=src+':'+(src==='widget'?gid:attr),now=Date.now(),last=undoS.at(-1);
    if(last&&last.key===key&&(src==='widget'||now-last.t<800)){
      const it=last.items.find(i=>i.el===el&&i.attr===attr);it?it.nw=nw:last.items.push({el,attr,old,nw});last.t=now;
    }else undoS.push({key,t:now,items:[{el,attr,old,nw}]});
    redoS.length=0;emit('history');
  };
  const setAttr=(el,attr,v,src='app')=>{ // v === null removes the attribute
    const old=el.getAttribute(attr),nw=v===null?null:String(v);if(old===nw)return;
    nw===null?el.removeAttribute(attr):el.setAttribute(attr,nw);record(el,attr,old,nw,src);emit('change',{el,attr,src});
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
  const dm=m=>new DOMMatrix([m.a,m.b,m.c,m.d,m.e,m.f]),matrixFor=el=>dm(ov.getCTM().inverse().multiply(el.getCTM())); // DOMMatrix, so it composes with ownM()
  /* Edit modes. Every shape cycles scale -> rotate/skew -> edit; shapes with no editor of their own
     (only the catch-all fallback matches) cycle scale <-> rotate. `pref` is the user's last choice and is
     kept across selections; `cur()` is what the selected shape can actually show. */
  const modesFor=el=>{const e=Widgets.find(el);return e&&!e.generic?MODES:MODES.slice(0,2)};
  const cur=()=>{const ms=modesFor(sel);return ms.includes(pref)?pref:ms[0]};
  const unsub=()=>{subs.forEach(([e,f])=>{const a=hs[e],i=a?a.indexOf(f):-1;if(i>=0)a.splice(i,1)});subs=[]};
  const teardown=()=>{layer?.destroy();hub?.destroy();layer=hub=null;unsub();ov.replaceChildren()};
  let ctx=null;
  function build(){
    teardown();const m=cur(),ms=modesFor(sel);
    layer=m==='edit'?Widgets.find(sel).factory(ctx):transformLayer(ctx,m);
    hub=hubWidget(ctx,{modes:ms,index:ms.indexOf(m),cycle:()=>api.cycleMode(),moved:()=>layer.update&&layer.update()});
  }
  function select(el){
    if(el===sel)return;
    teardown();sel=el;ctx=null;
    if(el){
      const toOverlay=e=>{const q=new DOMPoint(e.clientX,e.clientY).matrixTransform(ov.getScreenCTM().inverse());return [q.x,q.y]};
      ctx={el,overlay:ov,on:(e,f)=>{on(e,f);subs.push([e,f])},matrix:()=>matrixFor(el),px:n=>n/scale(),toOverlay,
        toLocal(e){const o=toOverlay(e),q=new DOMPoint(o[0],o[1]).matrixTransform(matrixFor(el).inverse());return [q.x,q.y]},
        /* pointer in the parent's coordinate system: what the element's own `transform` is relative to */
        toParent(e){const o=toOverlay(e),q=new DOMPoint(o[0],o[1]).matrixTransform(matrixFor(el).multiply(ownM(el).inverse()).inverse());return [q.x,q.y]},
        bbox(){try{const b=el.getBBox();return {x:b.x,y:b.y,w:b.width,h:b.height}}catch{return null}},
        set(a,v,src='widget'){setAttr(el,a,v,src)}};
      build();
    }
    emit('select',el);
  }
  const onClick=e=>{if(ov.contains(e.target))return;const t=e.target.closest?.(PRIM);select(t&&root.contains(t)?t:null)};
  if(opts.pick!==false)svg.addEventListener('click',onClick);
  const api={select,set:setAttr,undo,redo,clearHistory,get canUndo(){return undoS.length>0},get canRedo(){return redoS.length>0},get selected(){return sel},on,
    refresh(){emit('view')}, changed(el,attr,src='app'){emit('change',{el,attr,src})},
    destroy(){select(null);svg.removeEventListener('click',onClick);svg.removeEventListener('pointerdown',onDown,true);removeEventListener('keydown',onKey);if(!opts.overlay)ov.remove()},
    get mode(){return sel?cur():pref},set mode(m){if(!MODES.includes(m)||m===api.mode)return;pref=m;if(sel&&cur()!==m)return;sel&&build();emit('mode',m)},
    get modes(){return sel?modesFor(sel):MODES},
    cycleMode(){if(!sel)return;const ms=modesFor(sel);pref=ms[(ms.indexOf(cur())+1)%ms.length];build();emit('mode',pref)}};
  return api;
}
