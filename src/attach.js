import {Widgets} from './registry.js';
import {mk} from './dom.js';
import {ownM} from './xform.js';
import {transformLayer} from './widgets/transform.js';
import {haloWidget} from './widgets/halo.js';
import {bodyGrab} from './body.js';
import {Tools} from './tools.js';
import {openMenu as openMenuUI} from './menu.js';
import {compilePolicy,checkWrites,canSet,modeOk,OPEN} from './policy.js';
const MODES=['scale','rotate','edit'];
export function attach(svg,opts={}){
  const PRIM=opts.selector||'path,rect,circle,ellipse,line,polyline,polygon,text', root=opts.root||svg;
  let ov=opts.overlay; if(!ov){ov=mk('g',{style:'pointer-events:none'});svg.append(ov)}
  const hs={}, on=(e,f)=>{(hs[e]??=[]).push(f)}, emit=(e,d)=>[...(hs[e]||[])].forEach(f=>f(d));
  if(opts.onSelect)on('select',opts.onSelect);if(opts.onCreate)on('create',d=>opts.onCreate(d.el)); if(opts.onChange)on('change',d=>opts.onChange(d.el,d.attr,d.src));
  if(opts.onDenied)on('denied',d=>opts.onDenied(d.el,d));
  let P=compilePolicy(opts.policy,{root}),lastDeny=''; // permissions: see src/policy.js. No policy = everything allowed, nothing checked
  if(P)P.validate(root); // data-sable-policy typos throw here, not later
  const perms=el=>P?P.resolve(el):OPEN, toolOk=id=>!P||P.toolOk(id);
  let sel=null,layer=null,halo=null,body=null,subs=[],menuOffs=[],start=MODES.includes(opts.mode)?opts.mode:'scale',pref=start==='edit'?'scale':start,editing=start==='edit'; // start: the mode a fresh selection opens in
  let tool='pointer',oneShot=false,gesture=null,swallow=false,menuCtl=null; // creation tools: see the 'Tools and context menu' section
  const cycLog=[]; // recent scale <-> rotate toggles {t, from}: a double-click takes back the ones that were its own clicks
  const ONCE=false; // TODO(remove): "use once" is switched off, every tool is sticky. The oneShot code below stays until it is deleted for good
  let penSeg='auto',penEl=null,penPub=false; // pen tools: the next segment's kind, the shape being drawn, has 'create' been announced for it
  const penOn=()=>!!Tools.get(tool)?.pen; // a pen tool is armed: the shape it can continue stays selected, in edit mode

  /* undo/redo: edits made in one pointer gesture (or one burst of typing) form one step */
  const undoS=[],redoS=[]; let gid=0;
  const record=(el,attr,old,nw,src,own)=>{ // own: a key of its own (one batch = one step)
    const key=own||src+':'+(src==='widget'?gid:attr),now=Date.now(),last=undoS.at(-1);
    if(last&&last.key===key&&(src==='widget'||own||now-last.t<800)){
      const it=last.items.find(i=>i.el===el&&i.attr===attr);it?it.nw=nw:last.items.push({el,attr,old,nw});last.t=now;
    }else undoS.push({key,t:now,items:[{el,attr,old,nw}]});
    redoS.length=0;emit('history');
  };
  /* v === null removes the attribute. Returns false when the policy refused the write (and emits 'denied'); `cap` is the
     capability the writer declares (move/scale/rotate gestures), `force` skips the policy (for host code outside it).
     The policy may store something other than v (a range or a bounds box clamps it): read the attribute back if it matters.
     Inside batch(fn) writes are only collected; when fn returns, the writes to each element are checked and applied as one
     step, so a rect resize (x, y, width, height) is judged as the finished rect and not as four half-written ones. */
  let pending=null,bid=0;
  const bbox=el=>{try{const b=el.getBBox();return [b.x,b.y,b.x+b.width,b.y+b.height]}catch{return null}};
  const setAttr=(el,attr,v,src='app',cap,force)=>{
    const c={el,attr,nw:v===null?null:String(v),src,cap,force};
    if(pending){pending.push(c);return true}
    return flush([c]);
  };
  const batch=(fn,own)=>{const q=pending=[];q.own=own;try{fn()}finally{pending=null}return flush(q)}; // own: history key, so the whole batch undoes as one step
  function flush(q){
    const by=new Map();let ok=true;
    for(const c of q)(by.get(c.el)||by.set(c.el,[]).get(c.el)).push(c);
    for(const [el,cs] of by){
      const last=new Map(cs.map(c=>[c.attr,c])),gate=cs.filter(c=>!c.force); // last write to an attribute wins
      const vals=new Map([...last].map(([a,c])=>[a,c.nw]));
      if(P&&gate.length){
        const r=checkWrites(perms(el),el.tagName,a=>el.getAttribute(a),gate.map(c=>({attr:c.attr,nw:c.nw,hint:c.cap})),{bbox:()=>bbox(el)});
        if(!r.ok){
          const c=gate.find(g=>g.attr===r.attr)||gate[0],k=gid+':'+r.cap;ok=false;
          if(c.src!=='widget'||k!==lastDeny){lastDeny=k;emit('denied',{el,attr:r.attr,cap:r.cap,reason:r.reason,src:c.src})} // one event per gesture, not per pointermove
          continue;
        }
        r.values.forEach((v,a)=>{if(!last.get(a).force)vals.set(a,v)});
      }
      const done=[];
      for(const [attr,nw] of vals){
        const old=el.getAttribute(attr);if(old===nw)continue;
        nw===null?el.removeAttribute(attr):el.setAttribute(attr,nw);record(el,attr,old,nw,last.get(attr).src,q.own);done.push([attr,last.get(attr).src]);
      }
      done.forEach(([attr,src])=>emit('change',{el,attr,src}));
    }
    return ok;
  }
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
    if(!(e.ctrlKey||e.metaKey||e.altKey)&&/^(Escape|Delete|Backspace)$/.test(e.key)){ // the selected shape's editor gets first refusal (clear / delete its selection)
      const d={key:e.key,event:e,handled:false};emit('key',d);if(d.handled){e.preventDefault();return}
    }
    if(e.key==='Enter'&&!(e.ctrlKey||e.metaKey||e.altKey)&&penOn()&&!gesture){e.preventDefault();penFinish();return} // Enter finishes the path being drawn
    if(e.key==='Escape'){ // one step back each time: the armed tool, then edit mode (back to scale), then the selection
      if(gesture)return;
      if(tool!=='pointer'){setTool('pointer');return}
      if(sel&&cur()==='edit'&&xmodes(sel).length){editing=false;build();emit('mode',cur());return}
      if(sel)select(null);
      return;
    }
    if(!(e.ctrlKey||e.metaKey))return;const k=e.key.toLowerCase();
    if(k==='z'){e.preventDefault();e.shiftKey?redo():undo()}else if(k==='y'){e.preventDefault();redo()}
  };
  svg.addEventListener('pointerdown',onDown,true);
  if(opts.keys!==false)addEventListener('keydown',onKey);
  const scale=()=>{const m=ov.getScreenCTM();return m?Math.hypot(m.a,m.b)||1:1};
  const dm=m=>new DOMMatrix([m.a,m.b,m.c,m.d,m.e,m.f]),matrixFor=el=>dm(ov.getCTM().inverse().multiply(el.getCTM())); // DOMMatrix, so it composes with ownM()
  /* Edit modes. Every shape cycles scale -> rotate/skew -> edit; shapes with no editor of their own
     (only the catch-all fallback matches) cycle scale <-> rotate. `pref` is the user's last choice and is
     kept across selections; `cur()` is what the selected shape can actually show (the policy can switch modes off). */
  const modesFor=el=>{const e=Widgets.find(el),p=perms(el);return MODES.filter(m=>modeOk(p,m)&&(m!=='edit'||(e&&!e.generic)))};
  /* scale and rotate/skew cycle on a click; edit mode is entered on purpose (double-click, a long press, api.edit()) and left with Escape.
     A shape that is allowed nothing but edit mode just stays in it. */
  const xmodes=el=>modesFor(el).filter(m=>m!=='edit'),canEdit=el=>modesFor(el).includes('edit');
  const cur=()=>{const t=xmodes(sel);if(canEdit(sel)&&(editing||!t.length))return 'edit';return t.includes(pref)?pref:t[0]};
  const unsub=()=>{menuOffs.forEach(f=>f());menuOffs=[];subs.forEach(([e,f])=>{const a=hs[e],i=a?a.indexOf(f):-1;if(i>=0)a.splice(i,1)});subs=[]};
  const teardown=()=>{layer?.destroy();halo?.destroy();layer=halo=null;unsub();ov.replaceChildren()};
  let ctx=null;
  function build(){
    teardown();const m=cur();if(!m)return; // no mode available: nothing to draw
    // the grab halo goes first so it sits under the handles; path/polygon/polyline edit mode brings its own (it also owns double-click)
    halo=m==='edit'&&/^(path|polygon|polyline)$/.test(sel.tagName)?null:haloWidget(ctx);
    layer=m==='edit'?Widgets.find(sel).factory(ctx):transformLayer(ctx,m);
  }
  function select(el){
    if(el===sel||(el&&!perms(el).selectable))return;
    body?.destroy();body=null;teardown();sel=el;ctx=null;pref=start==='edit'?'scale':start;editing=start==='edit'||penOn();
    if(tool==='pointer')svg.style.cursor=cursorWas;
    if(el){
      const toOverlay=e=>{const q=new DOMPoint(e.clientX,e.clientY).matrixTransform(ov.getScreenCTM().inverse());return [q.x,q.y]};
      ctx={el,overlay:ov,on:(e,f)=>{on(e,f);subs.push([e,f])},matrix:()=>matrixFor(el),px:n=>n/scale(),toOverlay,
        toLocal(e){const o=toOverlay(e),q=new DOMPoint(o[0],o[1]).matrixTransform(matrixFor(el).inverse());return [q.x,q.y]},
        /* pointer in the parent's coordinate system: what the element's own `transform` is relative to */
        toParent(e){const o=toOverlay(e),q=new DOMPoint(o[0],o[1]).matrixTransform(matrixFor(el).multiply(ownM(el).inverse()).inverse());return [q.x,q.y]},
        bbox(){try{const b=el.getBBox();return {x:b.x,y:b.y,w:b.width,h:b.height}}catch{return null}},
        set(a,v,src='widget',cap){return setAttr(el,a,v,src,cap)}, // false = refused by the policy
        menu:f=>{menuOffs.push(api.addMenu(f))}, // the shape's editor adds items to the right-click menu while it is selected: f({x,y,target,editor}) => [items]
        batch, // batch(fn): the writes made inside fn are checked and applied together
        get penOn(){return penOn()},get penSeg(){return penSeg}, // a pen tool is armed / what kind of segment its next node adds
        undo, // for a pen gesture cancelled halfway: its writes are the newest undo step
        /* a point the pen is about to add, brought onto the policy's grid and inside its walls: the policy leaves added nodes alone (it judges edits
           to existing ones), and the pen is nothing but added nodes */
        fit(q){const p=perms(el);let r=q;
          if(p.snap)r=[Math.round(r[0]/p.snap[0])*p.snap[0],Math.round(r[1]/p.snap[1])*p.snap[1]];
          if(p.bounds){const B=p.bounds,M=ownM(el),w=new DOMPoint(r[0],r[1]).matrixTransform(M),c=new DOMPoint(Math.min(B[2],Math.max(B[0],w.x)),Math.min(B[3],Math.max(B[1],w.y))).matrixTransform(M.inverse());r=[c.x,c.y]}
          return r},
        deny:(cap,reason)=>emit('denied',{el,attr:'d',cap,reason,src:'widget'}), // a refusal that isn't a write (the pen won't continue a pinned shape)
        penFinish:()=>penFinish(), // the pen's "this path is done": deselect its node, drop it if it never got a segment
        can:c=>perms(el).can(c),get pin(){return perms(el).pin}, // what the policy allows this shape / which nodes it pins
        /* a press on this shape that a widget's own overlay element caught: drag = move, click = next mode (see body.js) */
        grab(e,o){if(!ctxClick(e))body.grab(e,o)}};
      body=bodyGrab(ctx,{cycle:()=>api.cycleMode(),moved:()=>layer&&layer.update&&layer.update(),
        done:()=>{swallow=true;setTimeout(()=>{swallow=false})}}); // the click that follows a grab must not select/deselect
      build();
    }
    emit('select',el);
  }
  /* Pressing a shape selects it and starts moving it in the same gesture; pressing the selected shape moves it, and a release
     without a drag switches mode (body.js). Clicking empty space deselects. Handles and widget proxies live in the overlay and
     never reach here. A bare click (no press, e.g. el.click() from a script) still selects. */
  const pickAt=e=>{const t=e.target.closest?.(PRIM);return t&&root.contains(t)&&perms(t).selectable?t:null};
  const onPress=e=>{
    if(e.button!==0||ctxClick(e)||tool!=='pointer'||gesture||ov.contains(e.target))return;
    const t=pickAt(e);if(!t)return;
    if(t===sel)body.grab(e);
    else if(opts.pick!==false){select(t);body.grab(e,{fresh:true})}
  };
  const onClick=e=>{if(swallow){swallow=false;return}if(ov.contains(e.target)||ctxClick(e))return;select(pickAt(e))};
  svg.addEventListener('pointerdown',onPress);
  if(opts.pick!==false)svg.addEventListener('click',onClick);
  const onHover=e=>{ // the selected shape's body is a move handle: say so
    if(tool!=='pointer'||gesture||(body&&body.busy))return;
    svg.style.cursor=sel&&!ov.contains(e.target)&&pickAt(e)===sel&&perms(sel).can('transform.move')?'move':cursorWas;
  };
  svg.addEventListener('pointermove',onHover);
  /* Edit mode is entered with a double-click, or a long press (finger or pen) where there is no double-click: on the shape or, once selected, on
     its grab halo. Handles and the path editor's own elements are left alone (a double-click on a stroke there adds a node). */
  const editTarget=e=>ov.contains(e.target)?(e.target.getAttribute?.('data-sable')==='halo'?sel:null):pickAt(e);
  const editAt=t=>{if(t!==sel&&opts.pick===false)return false;if(t!==sel)select(t);return api.edit()};
  /* a double-click is two clicks first, and a click on the selected shape toggles scale <-> rotate: undo what this one's clicks did, so Escape
     from edit mode lands in the mode the shape was in before it */
  const onDbl=e=>{if(e.button!==0||tool!=='pointer'||gesture)return;const t=editTarget(e);if(!t)return;const now=performance.now(),c=cycLog.find(q=>now-q.t<600);if(c)pref=c.from;cycLog.length=0;editAt(t)};
  svg.addEventListener('dblclick',onDbl);
  const LONG=450;let lp=null,lpDone=-1e9;
  const lpStop=()=>{if(!lp)return;clearTimeout(lp.timer);removeEventListener('pointermove',lp.move);removeEventListener('pointerup',lp.end);removeEventListener('pointercancel',lp.end);lp=null};
  const onLong=e=>{
    lpStop();if(e.pointerType==='mouse'||e.button!==0||tool!=='pointer'||gesture)return;
    const t=editTarget(e);if(!t)return;
    const id=e.pointerId,x0=e.clientX,y0=e.clientY;
    const fire=()=>{lpStop();lpDone=performance.now();editAt(t)};
    lp={timer:setTimeout(fire,LONG),fire,
      move:ev=>{if(ev.pointerId===id&&Math.hypot(ev.clientX-x0,ev.clientY-y0)>8)lpStop()},end:ev=>{if(ev.pointerId===id)lpStop()}};
    addEventListener('pointermove',lp.move);addEventListener('pointerup',lp.end);addEventListener('pointercancel',lp.end);
  };
  svg.addEventListener('pointerdown',onLong);

  /* ---- Tools and context menu ----
     Tool = pointer (the default: press to select, drag the shape to move it, handles edit) or a registered creation tool (src/tools/*).
     'Switch Tool' sets a tool until changed (Esc leaves it). 'Use Once' (one gesture, then back to pointer) is switched off: see ONCE. */
  const isMac=()=>/Mac|iPhone|iPad/i.test(navigator.platform||navigator.userAgent||'');
  const ctxClick=e=>e.button===2||(e.button===0&&e.ctrlKey&&isMac()); // belongs to the context menu, never to a tool, a body grab or a handle
  const cursorWas=svg.style.cursor;
  const hostEl=()=>{const c=opts.createIn;return (typeof c==='string'?svg.querySelector(c):c)||root};
  const shapeAttrs=()=>({fill:'#d6eaf8',stroke:'#2874a6','stroke-width':2,...opts.shapeAttrs});
  function setTool(id,once=false){
    if(gesture)return;const T=Tools.get(id);if(id!=='pointer'&&(!T||!toolOk(id)))return;
    once=ONCE&&once&&id!=='pointer'; // TODO(remove): with ONCE off useTool(id) is the same as tool=id
    if(id===tool&&once===oneShot)return;
    const wasPen=penOn();if(wasPen&&!(T&&T.pen))penCleanup();
    tool=id;oneShot=once;svg.style.cursor=T?T.cursor||'crosshair':cursorWas;
    if(T&&T.pen){ // a pen keeps the shape it can continue (selected, as an edit layer); anything else is deselected
      if(sel&&sel.tagName!==T.tag)select(null);
      if(sel){const was=cur();editing=true;if(cur()!==was){build();emit('mode',cur())}} // already in edit mode: keep the layer (and its node selection)
    }else if(T)select(null);
    else if(wasPen&&sel){editing=false;pref=start==='edit'?'scale':start;build();emit('mode',cur())} // leaving a pen: the shape stays selected, in scale mode
    emit('tool',id);
  }
  /* ---- pen tools (src/tools/path.js): they live across many presses, so the path widget's pen mode (widgets/path.js) does the work and this
     only starts shapes, announces them and tidies up. A press continues the shape when its widget has an endpoint node selected, else it
     starts a new one. Every node is an undo step of its own; the press that starts a shape is one step with the shape's creation. ---- */
  const realOf=el=>{const T=Tools.list.find(t=>t.pen&&t.tag===el.tagName);return !T||!T.real||T.real(el)};
  const forget=el=>{for(const st of [undoS,redoS])for(let i=st.length;i--;){const g=st[i];g.items=g.items.filter(it=>it.el!==el);if(!g.items.length)st.splice(i,1)}};
  function penCleanup(){ // leaving the pen, or finishing a path: a shape that never got a segment is not worth keeping
    const el=penEl;penEl=null;if(!el||!el.isConnected||realOf(el))return;
    if(sel===el)select(null);el.remove();forget(el);emit('history');if(penPub)emit('remove',{el,src:'tool'});
  }
  function penFinish(){if(!penOn())return;layer&&layer.pen&&layer.pen.clear();penCleanup()}
  const penAfter=()=>{if(penEl&&!penPub&&realOf(penEl)){penPub=true;emit('create',{el:penEl,src:'tool'})}};
  function penBegin(T,host,e){ // -> a gesture {move, end, cancel} (the widget's) or null when there is nothing to do or the policy said no
    const key='pen:'+(++gid);
    if(sel&&layer&&layer.pen&&sel.tagName===T.tag&&layer.pen.canContinue())return layer.pen.begin(e,{key});
    penCleanup();
    const el=mk(T.tag,{...shapeAttrs(),...T.blank});host.insertBefore(el,host===ov.parentNode?ov:null);
    const no=cap=>{el.remove();if(sel===el)select(null);emit('denied',{el,attr:null,cap,reason:'capability',src:'tool'});return null};
    if(!perms(el).selectable)return no('select');
    if(!perms(el).can('geometry.edit'))return no('geometry.edit');
    if(!perms(el).can('nodes.insert'))return no('nodes.insert'); // a pen is nothing but inserted nodes
    undoS.push({key,t:Date.now(),items:[{add:1,el,parent:host,next:el.nextSibling}]});redoS.length=0;emit('history');
    penEl=el;penPub=false;select(el);
    const G=sel===el&&layer&&layer.pen&&layer.pen.begin(e,{key,first:true});
    if(!G){penCleanup();if(el.isConnected)no('geometry.edit');return null}
    return G;
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
    if(T.pen&&ov.contains(e.target))return; // a pen's own nodes, handles and stroke belong to the path widget
    e.preventDefault();e.stopPropagation();
    const inv=M.inverse(),sc=Math.hypot(M.a,M.b)||1,made=[],id=e.pointerId,g={dead:false};
    const pt=ev=>{const q=new DOMPoint(ev.clientX,ev.clientY).matrixTransform(inv);return [q.x,q.y]};
    const G=T.pen?penBegin(T,host,e):T.begin({host,px:n=>n/sc,make(tag,a){const el=mk(tag,{...shapeAttrs(),...a});host.insertBefore(el,host===ov.parentNode?ov:null);made.push(el);return el}},pt(e),e);
    if(!G){svg.addEventListener('pointerup',()=>{swallow=true;setTimeout(()=>{swallow=false})},{once:true});return} // refused: the click that follows must not deselect either
    gesture=g;svg.setPointerCapture(id);
    const kill=()=>{if(g.dead)return;g.dead=true;G.cancel&&G.cancel();made.forEach(x=>x.remove())};
    const mv=ev=>{if(ev.pointerId===id&&!g.dead)G.move(pt(ev),ev)};
    const esc=ev=>{if(ev.key==='Escape')kill()};
    const stop=()=>{svg.removeEventListener('pointermove',mv);svg.removeEventListener('pointerup',up);svg.removeEventListener('pointercancel',cancel);
      removeEventListener('keydown',esc,true);gesture=null;swallow=true;setTimeout(()=>{swallow=false})}; // the click that follows must not select/deselect
    const up=ev=>{if(ev.pointerId!==id)return;stop();if(g.dead)return;const el=G.end(pt(ev),ev);made.forEach(x=>x!==el&&x.remove());if(el)commit(el);if(T.pen)penAfter()};
    const cancel=ev=>{if(ev.pointerId!==id)return;kill();stop()};
    svg.addEventListener('pointermove',mv);svg.addEventListener('pointerup',up);svg.addEventListener('pointercancel',cancel);addEventListener('keydown',esc,true);
  }
  const menuB=[]; // builders: ({x,y,target,editor}) => [items]; groups are separated automatically
  const toolItems=()=>{
    const ts=Tools.list.filter(d=>toolOk(d.id));if(!ts.length)return [];
    return [...(ONCE?[{label:'Use Once',submenu:ts.map(d=>({label:d.label,checked:oneShot&&tool===d.id,action:()=>setTool(d.id,true)}))}]:[]), // TODO(remove) with ONCE
      {label:'Switch Tool',submenu:[{label:'Pointer',checked:tool==='pointer',action:()=>setTool('pointer')},
        ...ts.map(d=>({label:d.label,checked:!oneShot&&tool===d.id,action:()=>setTool(d.id)}))]}];
  };
  menuB.push(toolItems);
  const PEN_SEGS=[['auto','Auto (click: line, drag: curve)'],['L','Line'],['Q','Quadratic curve'],['C','Cubic curve'],['A','Arc']];
  const penItems=()=>{ // while a pen is armed: what its next segment is, and finishing the path
    if(!penOn())return [];const pn=layer&&layer.pen;
    return [{label:'Next segment',submenu:PEN_SEGS.map(([k,l])=>({label:l,checked:penSeg===k,action:()=>{api.penSegment=k}}))},
      {label:'Close path',disabled:!(pn&&pn.canClose()),action:()=>pn&&pn.close()},{label:'Finish path',action:penFinish}];
  };
  menuB.push(penItems);
  /* hover (mouse / pen, not touch): the dashed rubber band of the next segment, and a cursor that says continue or new path */
  const onPenHover=e=>{
    if(!penOn()||gesture||e.pointerType==='touch')return;const pn=layer&&layer.pen;
    svg.style.cursor=pn&&pn.canContinue()?'crosshair':'cell';pn&&pn.hover(ov.contains(e.target)?null:e);
  };
  const onPenLeave=()=>{layer&&layer.pen&&layer.pen.hover(null)};
  svg.addEventListener('pointermove',onPenHover);svg.addEventListener('pointerleave',onPenLeave);
  const closeMenu=()=>{menuCtl&&menuCtl.close();menuCtl=null};
  function openMenu(x,y,target=null){
    const items=[];menuB.forEach(f=>{const l=f({x,y,target,editor:api})||[];if(l.length){items.length&&items.push({sep:1});items.push(...l)}});
    if(!items.length)return false;closeMenu();menuCtl=openMenuUI(items,x,y,()=>{menuCtl=null});return true;
  }
  const onCtx=e=>{
    if(lp){e.preventDefault();lp.fire();return} // a long press that the browser also reports as a context menu: it means edit mode
    if(performance.now()-lpDone<1000){e.preventDefault();return}
    if(opts.menu===false||gesture)return;const t=ov.contains(e.target)?null:e.target.closest?.(PRIM);
    if(openMenu(e.clientX,e.clientY,t&&root.contains(t)?t:null))e.preventDefault();
  };
  svg.addEventListener('pointerdown',toolDown,true);svg.addEventListener('contextmenu',onCtx);
  const api={select,set(el,attr,val,src,o){return setAttr(el,attr,val,src,undefined,o&&o.force)},
    setMany(el,attrs,src,o){return batch(()=>{for(const a in attrs)setAttr(el,a,attrs[a],src,undefined,o&&o.force)},'many:'+(++bid))}, // several attributes: checked together, undone together
    undo,redo,clearHistory,get canUndo(){return undoS.length>0},get canRedo(){return redoS.length>0},get selected(){return sel},on,
    refresh(){emit('view')}, changed(el,attr,src='app'){emit('change',{el,attr,src})},
    destroy(){closeMenu();setTool('pointer');select(null);svg.removeEventListener('pointerdown',toolDown,true);svg.removeEventListener('contextmenu',onCtx);svg.removeEventListener('click',onClick);svg.removeEventListener('dblclick',onDbl);svg.removeEventListener('pointerdown',onLong);lpStop();svg.removeEventListener('pointerdown',onPress);svg.removeEventListener('pointermove',onHover);svg.removeEventListener('pointermove',onPenHover);svg.removeEventListener('pointerleave',onPenLeave);svg.removeEventListener('pointerdown',onDown,true);removeEventListener('keydown',onKey);if(!opts.overlay)ov.remove()},
    get mode(){return sel?cur():editing?'edit':pref},set mode(m){if(!MODES.includes(m)||m===api.mode)return;if(m==='edit')editing=true;else{pref=m;editing=false}if(sel&&cur()!==m)return;sel&&build();emit('mode',m)},
    /* switch the shape (default: the selected one, which is selected first if it is another) to its own edit mode; false if it has none or the policy forbids it */
    edit(el=sel){if(el&&el!==sel)select(el);if(!sel||!canEdit(sel))return false;if(cur()!=='edit'){editing=true;build();emit('mode','edit')}return true},
    get modes(){return sel?modesFor(sel):MODES},
    get tool(){return tool},set tool(id){setTool(id)},useTool(id){setTool(id,true)}, // TODO(remove): useTool is sticky like tool= while ONCE is off
    get penSegment(){return penSeg},set penSegment(k){if(!PEN_SEGS.some(q=>q[0]===k)||k===penSeg)return;penSeg=k;emit('pen',{segment:k});layer&&layer.pen&&layer.pen.hover(null)}, // what the pen's next node adds: 'auto' | 'L' | 'Q' | 'C' | 'A'
    get tools(){return Tools.list.filter(d=>toolOk(d.id)).map(({id,label})=>({id,label}))},
    openMenu,closeMenu,addMenu(f){menuB.push(f);return ()=>{const i=menuB.indexOf(f);i>=0&&menuB.splice(i,1)}},
    /* permissions: can([el,] capability) and canSet([el,] attr) answer for host UIs (el defaults to the selected shape);
       policy (get/set) swaps the whole policy at runtime */
    can(a,b){const el=typeof a==='string'?sel:a;return !!el&&perms(el).can(typeof a==='string'?a:b)},
    canSet(a,b){const el=typeof a==='string'?sel:a;return !!el&&canSet(perms(el),el.tagName,typeof a==='string'?a:b)},
    range(a,b){const el=typeof a==='string'?sel:a;return el?perms(el).range(typeof a==='string'?a:b):null},  // [min, max] (null = open end) the policy allows for an attribute, or null
    bounds(el=sel){return el&&perms(el).bounds?{x:perms(el).bounds[0],y:perms(el).bounds[1],width:perms(el).bounds[2]-perms(el).bounds[0],height:perms(el).bounds[3]-perms(el).bounds[1]}:null},
    snap(el=sel){const s=el&&perms(el).snap;return s?{x:s[0],y:s[1]}:null}, // the grid step the policy imposes on the shape, in its own coordinates, or null
    get policy(){return P?P.spec:null},
    set policy(spec){const np=compilePolicy(spec,{root});if(np)np.validate(root);P=np;if(tool!=='pointer'&&!toolOk(tool))setTool('pointer');if(!sel)return;if(!perms(sel).selectable)select(null);else build()},
    /* the edit-mode layer's own selection (path / polygon / polyline nodes, path segments): for host UIs and for hosts that attach with keys:false */
    deleteSelection(){return !!(layer&&layer.deleteSelection&&layer.deleteSelection())},clearSelection(){layer&&layer.clearSelection&&layer.clearSelection()},
    get selection(){return (layer&&layer.selection)||null}, // {kind:'node'|'segment', items:[indices]} or null
    cycleMode(){if(!sel||cur()==='edit')return;const t=xmodes(sel);if(t.length<2)return;cycLog.push({t:performance.now(),from:pref});if(cycLog.length>4)cycLog.shift();pref=t[(t.indexOf(cur())+1)%t.length];build();emit('mode',pref)}};
  return api;
}
