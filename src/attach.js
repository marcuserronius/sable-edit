import {Widgets} from './registry.js';
import {mk} from './dom.js';
import {ownM} from './xform.js';
import {transformLayer} from './widgets/transform.js';
import {hubWidget} from './widgets/hub.js';
import {Tools} from './tools.js';
import {openMenu as openMenuUI} from './menu.js';
const MODES=['scale','rotate','edit'];
export function attach(svg,opts={}){
  const PRIM=opts.selector||'path,rect,circle,ellipse,line,polyline,polygon,text', root=opts.root||svg;
  let ov=opts.overlay; if(!ov){ov=mk('g',{style:'pointer-events:none'});svg.append(ov)}
  const hs={}, on=(e,f)=>{(hs[e]??=[]).push(f)}, emit=(e,d)=>[...(hs[e]||[])].forEach(f=>f(d));
  if(opts.onSelect)on('select',opts.onSelect);if(opts.onCreate)on('create',d=>opts.onCreate(d.el)); if(opts.onChange)on('change',d=>opts.onChange(d.el,d.attr,d.src));
  let sel=null,layer=null,hub=null,subs=[],pref=MODES.includes(opts.mode)?opts.mode:'scale';
  let tool='pointer',oneShot=false,gesture=null,swallow=false,menuCtl=null; // creation tools: see the 'Tools and context menu' section

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
  /* a created element is one history item {add,el,parent,next}: undo removes it, redo puts it back in place */
  const stepAdd=(i,dir)=>{
    if(dir>0){i.parent.insertBefore(i.el,i.next&&i.next.parentNode===i.parent?i.next:null);emit('create',{el:i.el,src:'history'})}
    else{if(sel===i.el)select(null);i.el.remove();emit('remove',{el:i.el,src:'history'})}
  };
  const step=(from,to,dir)=>{
    const g=from.pop();if(!g)return;
    (dir>0?g.items:[...g.items].reverse()).forEach(i=>{
      if(i.add)return stepAdd(i,dir);
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
    if(e.key==='Escape'){if(!gesture&&tool!=='pointer')setTool('pointer');return}
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
  const onClick=e=>{if(swallow){swallow=false;return}if(ov.contains(e.target)||ctxClick(e))return;const t=e.target.closest?.(PRIM);select(t&&root.contains(t)?t:null)};
  if(opts.pick!==false)svg.addEventListener('click',onClick);
  /* ---- Tools and context menu ----
     Tool = pointer (the default: click to select, hub and handles edit) or a registered creation tool (src/tools/*).
     'Use Once' arms a tool for one successful gesture and then returns to pointer; 'Switch Tool' sets it until changed. */
  const isMac=()=>/Mac|iPhone|iPad/i.test(navigator.platform||navigator.userAgent||'');
  const ctxClick=e=>e.button===2||(e.button===0&&e.ctrlKey&&isMac()); // belongs to the context menu, never to a tool, the hub or a handle
  const cursorWas=svg.style.cursor;
  const hostEl=()=>{const c=opts.createIn;return (typeof c==='string'?svg.querySelector(c):c)||root};
  const shapeAttrs=()=>({fill:'#d6eaf8',stroke:'#2874a6','stroke-width':2,...opts.shapeAttrs});
  function setTool(id,once=false){
    if(gesture)return;const T=Tools.get(id);if(id!=='pointer'&&!T)return;
    once=once&&id!=='pointer';if(id===tool&&once===oneShot)return;
    tool=id;oneShot=once;svg.style.cursor=T?T.cursor||'crosshair':cursorWas;
    if(T)select(null);emit('tool',id);
  }
  function commit(el){ // one finished gesture = one undo step
    undoS.push({key:'add:'+(++gid),t:Date.now(),items:[{add:1,el,parent:el.parentNode,next:el.nextSibling}]});redoS.length=0;emit('history');
    emit('create',{el,src:'tool'});
    if(oneShot){setTool('pointer');select(el)} // a sticky tool stays armed with nothing selected, ready for the next shape
  }
  function toolDown(e){
    if(ctxClick(e)){e.stopPropagation();return}
    if(tool==='pointer'||e.button!==0||gesture)return;
    const T=Tools.get(tool),host=hostEl(),M=host.getScreenCTM();if(!T||!M)return;
    e.preventDefault();e.stopPropagation();
    const inv=M.inverse(),sc=Math.hypot(M.a,M.b)||1,made=[],id=e.pointerId,g=gesture={dead:false};
    const pt=ev=>{const q=new DOMPoint(ev.clientX,ev.clientY).matrixTransform(inv);return [q.x,q.y]};
    const G=T.begin({host,px:n=>n/sc,make(tag,a){const el=mk(tag,{...shapeAttrs(),...a});host.insertBefore(el,host===ov.parentNode?ov:null);made.push(el);return el}},pt(e),e);
    svg.setPointerCapture(id);
    const kill=()=>{if(g.dead)return;g.dead=true;G.cancel&&G.cancel();made.forEach(x=>x.remove())};
    const mv=ev=>{if(ev.pointerId===id&&!g.dead)G.move(pt(ev),ev)};
    const esc=ev=>{if(ev.key==='Escape')kill()};
    const stop=()=>{svg.removeEventListener('pointermove',mv);svg.removeEventListener('pointerup',up);svg.removeEventListener('pointercancel',cancel);
      removeEventListener('keydown',esc,true);gesture=null;swallow=true;setTimeout(()=>{swallow=false})}; // the click that follows must not select/deselect
    const up=ev=>{if(ev.pointerId!==id)return;stop();if(g.dead)return;const el=G.end(pt(ev),ev);made.forEach(x=>x!==el&&x.remove());if(el)commit(el)};
    const cancel=ev=>{if(ev.pointerId!==id)return;kill();stop()};
    svg.addEventListener('pointermove',mv);svg.addEventListener('pointerup',up);svg.addEventListener('pointercancel',cancel);addEventListener('keydown',esc,true);
  }
  const menuB=[]; // builders: ({x,y,target,editor}) => [items]; groups are separated automatically
  const toolItems=()=>{
    const ts=Tools.list;if(!ts.length)return [];
    return [{label:'Use Once',submenu:ts.map(d=>({label:d.label,checked:oneShot&&tool===d.id,action:()=>setTool(d.id,true)}))},
      {label:'Switch Tool',submenu:[{label:'Pointer',checked:tool==='pointer',action:()=>setTool('pointer')},
        ...ts.map(d=>({label:d.label,checked:!oneShot&&tool===d.id,action:()=>setTool(d.id)}))]}];
  };
  menuB.push(toolItems);
  const closeMenu=()=>{menuCtl&&menuCtl.close();menuCtl=null};
  function openMenu(x,y,target=null){
    const items=[];menuB.forEach(f=>{const l=f({x,y,target,editor:api})||[];if(l.length){items.length&&items.push({sep:1});items.push(...l)}});
    if(!items.length)return false;closeMenu();menuCtl=openMenuUI(items,x,y,()=>{menuCtl=null});return true;
  }
  const onCtx=e=>{
    if(opts.menu===false||gesture)return;const t=ov.contains(e.target)?null:e.target.closest?.(PRIM);
    if(openMenu(e.clientX,e.clientY,t&&root.contains(t)?t:null))e.preventDefault();
  };
  svg.addEventListener('pointerdown',toolDown,true);svg.addEventListener('contextmenu',onCtx);
  const api={select,set:setAttr,undo,redo,clearHistory,get canUndo(){return undoS.length>0},get canRedo(){return redoS.length>0},get selected(){return sel},on,
    refresh(){emit('view')}, changed(el,attr,src='app'){emit('change',{el,attr,src})},
    destroy(){closeMenu();setTool('pointer');select(null);svg.removeEventListener('pointerdown',toolDown,true);svg.removeEventListener('contextmenu',onCtx);svg.removeEventListener('click',onClick);svg.removeEventListener('pointerdown',onDown,true);removeEventListener('keydown',onKey);if(!opts.overlay)ov.remove()},
    get mode(){return sel?cur():pref},set mode(m){if(!MODES.includes(m)||m===api.mode)return;pref=m;if(sel&&cur()!==m)return;sel&&build();emit('mode',m)},
    get modes(){return sel?modesFor(sel):MODES},
    get tool(){return tool},set tool(id){setTool(id)},useTool(id){setTool(id,true)},get tools(){return Tools.list.map(({id,label})=>({id,label}))},
    openMenu,closeMenu,addMenu(f){menuB.push(f);return ()=>{const i=menuB.indexOf(f);i>=0&&menuB.splice(i,1)}},
    cycleMode(){if(!sel)return;const ms=modesFor(sel);pref=ms[(ms.indexOf(cur())+1)%ms.length];build();emit('mode',pref)}};
  return api;
}
