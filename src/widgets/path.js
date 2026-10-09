import {Widgets} from '../registry.js';
import {mk} from '../dom.js';
import {parsePath,serPath,arcGeom,arcFit,dc,split,segInfo,segD,nearestSeg,deleteNodes,deleteSegments,healSmooth,fixSmooth,nodeType,handleLinks,dragHandle,setNodeType,retype,convertSegments} from '../path-math.js';
import {pathNodes,pinnedIdx} from '../policy.js';
import {selection} from '../selection.js';
/* Path widget: nodes (squares) + bezier handles (dots). Drag to edit; Shift while dragging a
   cubic handle mirrors its partner; double-click the path to add a node, a node to delete it. The policy can take those two
   away (nodes.insert / nodes.delete) and pin nodes: a pinned node is drawn grey and can't be dragged or deleted (its bezier
   handles stay free).
   Selection: click a node or a segment (Shift adds / removes). Only the handles that belong to the selection are drawn: a
   node brings the handles of the two segments that meet at it, a segment brings its own. Dragging a selected node moves
   every selected node. Delete / Backspace removes selected nodes (the neighbours join up) or cuts the path at selected
   segments; Escape clears the selection. Clicking the stroke selects the segment under it; clicking the one selected
   segment again clears it.
   Node types (a node with a curve handle on each side): corner, smooth (the handles stay on one line through the node, each keeping its
   own length) and symmetric (mirror images; written as S / T in the path data). A handle drag keeps the node as it is: a smooth node's
   other handle swings to stay opposite, a symmetric node's mirrors. Shift while dragging makes the node symmetric; Alt / Option moves the
   handle alone and makes it a corner. The right-click menu has Node type > Corner / Smooth / Symmetric for the selected nodes (the one
   under the pointer is selected first). Smooth nodes are drawn rounded, symmetric ones round.
   Right-click a segment for Segment type > Line / Quadratic curve / Cubic curve / Arc. Lines are written H / V / L, whichever is shortest, for
   the segments an edit touches; the others keep the command they had. */
Widgets.register(el=>el.tagName==='path',ctx=>{
  const el=ctx.el,g=mk('g'); ctx.overlay.append(g);
  let segs=parsePath(el.getAttribute('d')||''),items=[],lines=[],hit,gh,sg,dead=false,mv0=false,mv1=false,arcs=[],pinned=new Set(); // mv*: did the last two gestures drag? pinned: segment indices of pinned nodes
  const S=selection(); // nodes are picked by segment index (never a Z), segments by the index of the segment that draws them (never an M)
  const f=v=>+v.toFixed(3), A=(e,o)=>{for(const k in o)e.setAttribute(k,o[k])};
  const ser=()=>serPath(segs);
  let uid=0,segAt=0;const T0=p=>{const q=new DOMPoint(p[0],p[1]).matrixTransform(ctx.matrix());return [q.x,q.y]}; // local -> overlay
  /* The policy can refuse a write (show what the document really holds) or store something else (a bounds clamp): adopt it.
     Adopting is done in place, so a drag in progress keeps working on the same segment objects. */
  const sync=()=>{
    const n=parsePath(el.getAttribute('d')||'');
    if(n.length!==segs.length||n.some((q,i)=>q.t!==segs[i].t)){segs=n;build();return}
    n.forEach((q,i)=>{segs[i].pts=q.pts;if(q.arc)segs[i].arc=q.arc;if(q.sm)segs[i].sm=1;else delete segs[i].sm}); // the stored d is the truth, S / T flag included
  };
  /* own: a history key, so a change that isn't part of a pointer gesture (a key, a menu item) is an undo step of its own */
  const write=own=>{fixSmooth(segs);retype(segs);const v=ser(),r=own?ctx.batch(()=>ctx.set('d',v),own):ctx.set('d',v);if(r===false){segs=parsePath(el.getAttribute('d')||'');build()}else if(el.getAttribute('d')!==v)sync()};
  const prevPt=i=>{for(let j=i-1;j>=0;j--)if(segs[j].t!=='Z')return segs[j].pts.at(-1);return segs[i].pts[0]};
  const startOf=i=>{for(let j=i;j>=0;j--)if(segs[j].t==='M')return segs[j].pts[0]};
  const pnode=i=>{for(let j=i-1;j>=0;j--)if(segs[j].t!=='Z')return j;return -1}; // the node a segment starts from
  /* is segment i's handle drawn? w: 0 = the handle that hangs off its start node, 1 = off its end node, none = either */
  const on=(i,w)=>S.has('seg',i)||(w!==1&&S.has('node',pnode(i)))||(w!==0&&S.has('node',i));
  function bind(h,onStart,onMove,onClick){ // onClick: a release that was not a drag
    h.addEventListener('pointerdown',e=>{
      e.stopPropagation();h.setPointerCapture(e.pointerId);const p0=ctx.toLocal(e);onStart(p0,e);mv0=mv1;mv1=false;
      const mv=ev=>{if(Math.hypot(ev.clientX-e.clientX,ev.clientY-e.clientY)>3)mv1=true;onMove(ctx.toLocal(ev),p0,ev);write();layout()};
      h.addEventListener('pointermove',mv);
      h.addEventListener('pointerup',()=>{h.removeEventListener('pointermove',mv);if(!mv1&&onClick)onClick()},{once:true});
    });
  }
  function ctl(s,k,i,w){
    const h=mk('circle',{style:'pointer-events:all;cursor:move',fill:'var(--acc,#2f6fed)'});
    items.push({el:h,get:()=>s.pts[k],r:3.5,vis:()=>on(i,w)}); gh.append(h);
    let links=[];
    bind(h,()=>{links=handleLinks(segs,i,k)},(p,p0,ev)=>{ // links: the node(s) this handle hangs off, as they were when the drag began
      dragHandle(segs,i,k,p,links,ev.altKey?'free':ev.shiftKey?'sym':null);
    });
  }
  function node(s,i){
    const h=mk('rect',{style:'pointer-events:all;cursor:move',fill:'var(--panel,#fff)',stroke:'var(--acc,#2f6fed)'}),pin=pinned.has(i);
    items.push({el:h,get:()=>s.pts.at(-1),r:5,n:1,node:i,pin}); gh.append(h);
    if(pin){ // locked: grey, no drag, no delete; it can still be selected, which brings its handles up
      h.style.cursor='not-allowed';h.setAttribute('fill','#ddd');h.setAttribute('stroke','#888');
      h.addEventListener('pointerdown',e=>{e.stopPropagation();S.pick('node',i,e.shiftKey);layout()});return;
    }
    let refs=[],rel=()=>{};
    bind(h,(p0,e)=>{ // a node carries its adjacent bezier handles along, and so does every other selected node
      rel=S.press('node',i,e.shiftKey);layout();
      refs=[];for(const j of S.items){
        const q=segs[j];if(!q||q.t==='Z'||pinned.has(j))continue;const nx=segs[j+1];
        refs.push([q,q.pts.length-1]);if(q.t==='C')refs.push([q,1]);if(nx?.t==='C')refs.push([nx,0]);
        if(q.t==='L')q.dirty=1;if(nx?.t==='L')nx.dirty=1; // lines that change length: H / V / L is re-decided for them (see retype)
      }
      refs=refs.map(([q,k])=>[q,k,[...q.pts[k]]]);
    },(p,p0)=>{const dx=p[0]-p0[0],dy=p[1]-p0[1];refs.forEach(([q,k,o])=>q.pts[k]=[o[0]+dx,o[1]+dy])},()=>{rel();layout()});
    h.addEventListener('dblclick',e=>{
      e.stopPropagation(); if(mv0||mv1)return;
      S.pick('node',i);del();
    });
  }
  /* Delete / Backspace: selected nodes are removed (the neighbours join up), selected segments are cut out (the path falls apart
     there; a closed one opens). Needs nodes.delete; cutting also needs a policy without pins, since it renumbers the nodes. */
  function del(){
    if(!S.size||!ctx.can('nodes.delete'))return false;
    const r=S.kind==='seg'?(ctx.pin.length?null:deleteSegments(segs,S.items)):deleteNodes(segs,S.items,pinned);
    if(!r)return false;
    segs=r;S.clear();healSmooth(segs);write('del:'+(++uid));build();return true;
  }
  function insert(p){
    const best=nearestSeg(segs,p,{arcs:false});if(!best)return;
    const {i,t,cp}=best,s=segs[i],[L,R]=split(cp,t);
    if(s.t==='Z')segs.splice(i,0,{t:'L',pts:[L.at(-1)],dirty:1});
    else segs.splice(i,1,{t:s.t,pts:L.slice(1),dirty:1},{t:s.t,pts:R.slice(1),dirty:1});
    S.pick('node',i);healSmooth(segs);write();build(); // the new node is the selection
  }
  const geom=i=>{const s=segs[i];return s&&s.t==='A'?arcGeom(prevPt(i),s.pts[0],...s.arc):null};
  /* Arc handles, one job each. Squares are only ever the start/end nodes. Dots:
       x dot  - rx only, on the x axis       y dot   - ry only, on the y axis
       ring   - rotation only, opposite the x dot      mid dot - flip: drag it to the side/part of the ellipse you want
     The x and y dots sit a fixed screen distance past the ellipse so they never hide behind a node or the mid dot.
     Dotted axes run from the centre out to them; the dashed ellipse shows the rest of the shape. */
  const GAP=16, gapL=()=>{const M=ctx.matrix();return ctx.px(GAP)/(Math.hypot(M.a,M.b)||1)};
  const ln=(a,b,o={})=>{const l=mk('line',{stroke:'var(--acc,#2f6fed)',opacity:o.op||.55});lines.push({el:l,a,b,...o});g.append(l)};
  const ends=(i,k,out)=>()=>{const q=geom(i);if(!q)return null;const d=(k?q.ry:q.rx)+out*gapL();return k?[q.cx-d*q.s,q.cy+d*q.c]:[q.cx+d*q.c,q.cy+d*q.s]};
  const ctr=i=>()=>{const q=geom(i);return q&&[q.cx,q.cy]};
  function arcHandles(s,i){
    const mkh=(fill,cur)=>{const h=mk('circle',{style:'pointer-events:all;cursor:'+cur,fill,stroke:'var(--acc,#2f6fed)'});gh.append(h);return h};
    const acc='var(--acc,#2f6fed)',P=()=>prevPt(i);
    arcs.push({i,ell:g.appendChild(mk('ellipse',{fill:'none',stroke:acc,opacity:.6,'vector-effect':'non-scaling-stroke','stroke-dasharray':'5 3'}))});
    ln(ctr(i),ends(i,0,1),{vis:()=>on(i),dash:1,op:.8});ln(ctr(i),ends(i,1,1),{vis:()=>on(i),dash:1,op:.8}); // dotted x and y axes
    const rotPos=()=>{const q=geom(i);if(!q)return null;const d=q.rx+gapL();return [q.cx-d*q.c,q.cy-d*q.s]};
    ln(()=>{const q=geom(i);return q&&[q.cx-q.rx*q.c,q.cy-q.rx*q.s]},rotPos,{vis:()=>on(i)}); // short stem: ring hangs off the ellipse
    const drag=(h,pos,kind,r,fill)=>{
      items.push({el:h,vis:()=>on(i),r,get:pos});
      let off=[0,0]; // where on the dot you grabbed it: aim the dot's centre, not the raw pointer, so a click off-centre doesn't jump
      bind(h,p0=>{const c=pos();off=c?[p0[0]-c[0],p0[1]-c[1]]:[0,0]},
        (p,p0,ev)=>{s.arc=arcFit(P(),s.pts[0],s.arc,kind,[p[0]-off[0],p[1]-off[1]],{gap:kind==='rot'?0:gapL(),shift:ev.shiftKey})});
    };
    drag(mkh(acc,'move'),ends(i,0,1),'rx',4.5);
    drag(mkh(acc,'move'),ends(i,1,1),'ry',4.5);
    drag(mkh('var(--panel,#fff)','grab'),rotPos,'rot',4.5);
    const hm=mkh(acc,'move');items.push({el:hm,vis:()=>on(i),r:4.5,get:()=>{const q=geom(i);return q&&q.pt(q.th1+q.dth/2)}});
    let offm=[0,0];
    bind(hm,p0=>{const c=geom(i)&&geom(i).pt(geom(i).th1+geom(i).dth/2);offm=c?[p0[0]-c[0],p0[1]-c[1]]:[0,0]},
      p=>{s.arc=arcFit(P(),s.pts[0],s.arc,'flip',[p[0]-offm[0],p[1]-offm[1]])});
  }
  function build(){
    g.replaceChildren();items=[];lines=[];arcs=[];const pn=pathNodes(segs);pinned=new Set(pinnedIdx(pn,ctx.pin).map(k=>pn.seg[k]));
    healSmooth(segs);S.keep('node',i=>segs[i]&&segs[i].t!=='Z');S.keep('seg',i=>segs[i]&&segs[i].t!=='M'); // an undo or an outside edit may have renumbered things
    hit=mk('path',{fill:'none',stroke:'transparent','stroke-width':12,'vector-effect':'non-scaling-stroke',style:'pointer-events:stroke;cursor:'+(ctx.can('nodes.insert')?'copy':'move')});
    hit.addEventListener('dblclick',e=>ctx.can('nodes.insert')&&insert(ctx.toLocal(e)));
    /* stroke press: drag moves the path; a click selects the segment under it (Shift adds / removes it). Clicking the one selected segment
       again clears it, unless that is the second click of a double-click, which goes on to add a node. */
    hit.addEventListener('pointerdown',e=>{
      const k=nearestSeg(segs,ctx.toLocal(e)),i=k?k.i:-1,add=e.shiftKey;
      ctx.grab(e,{click:()=>{
        if(i<0||!segs[i]||segs[i].t==='M')return;
        const now=performance.now();
        if(!add&&S.only('seg',i)){if(now-segAt>500){S.clear();layout()}return}
        segAt=now;S.pick('seg',i,add);layout();
      }});
    });
    g.append(hit);sg=g.appendChild(mk('g',{style:'pointer-events:none'}));gh=mk('g');
    segs.forEach((s,i)=>{
      if(s.t==='C'){ln(()=>prevPt(i),()=>s.pts[0],{vis:()=>on(i,0)});ln(()=>s.pts[1],()=>s.pts[2],{vis:()=>on(i,1)});ctl(s,0,i,0);ctl(s,1,i,1)}
      if(s.t==='Q'){ln(()=>prevPt(i),()=>s.pts[0],{vis:()=>on(i)});ln(()=>s.pts[0],()=>s.pts[1],{vis:()=>on(i)});ctl(s,0,i)}
      if(s.t==='A')arcHandles(s,i);
    });
    segs.forEach((s,i)=>s.t!=='Z'&&node(s,i));
    g.append(gh);layout();
  }
  function layout(){
    const M=ctx.matrix(),T=p=>{const q=new DOMPoint(p[0],p[1]).matrixTransform(M);return [q.x,q.y]},info=segInfo(segs),types=segs.map((_,j)=>nodeType(segs,j,info)),w=ctx.px(1.5);
    A(hit,{d:ser(),transform:`matrix(${M.a} ${M.b} ${M.c} ${M.d} ${M.e} ${M.f})`});
    lines.forEach(l=>{const a0=l.a(),b0=l.b(),show=a0&&b0&&(!l.vis||l.vis());l.el.style.display=show?'':'none';if(!show)return;
      const a=T(a0),b=T(b0);A(l.el,{x1:a[0],y1:a[1],x2:b[0],y2:b[1],'stroke-width':ctx.px(1),'stroke-dasharray':l.dash?ctx.px(2)+' '+ctx.px(3):'none'})});
    items.forEach(it=>{const pt=it.vis&&!it.vis()?null:it.get();
      it.el.style.display=pt?'':'none';if(!pt)return;const [x,y]=T(pt),r=ctx.px(it.r);
      A(it.el,it.n?{x:x-r,y:y-r,width:2*r,height:2*r,'stroke-width':w}:{cx:x,cy:y,r,'stroke-width':w});
      if(it.n){const ty=types[it.node],rx=ty==='symmetric'?r:ty==='smooth'?r*.45:0;it.el.setAttribute('rx',rx);it.el.setAttribute('ry',rx);const sl=S.has('node',it.node);if(it.pin)it.el.setAttribute('stroke',sl?'var(--acc,#2f6fed)':'#888');else it.el.setAttribute('fill',sl?'var(--acc,#2f6fed)':'var(--panel,#fff)')}}); // selected node: filled
    sg.replaceChildren(...(S.kind==='seg'?S.items:[]).map(i=>segD(segs,i)).filter(Boolean).map(d=>mk('path',{d,fill:'none',stroke:'var(--acc,#2f6fed)',opacity:.45,'stroke-width':6,'stroke-linecap':'round','vector-effect':'non-scaling-stroke',transform:`matrix(${M.a} ${M.b} ${M.c} ${M.d} ${M.e} ${M.f})`})));
    arcs.forEach(({i,ell})=>{const q=on(i)&&geom(i);ell.style.display=q?'':'none';
      if(q)A(ell,{rx:q.rx,ry:q.ry,transform:`matrix(${M.a} ${M.b} ${M.c} ${M.d} ${M.e} ${M.f}) translate(${q.cx} ${q.cy}) rotate(${q.phi*180/Math.PI})`})});
  }
  /* right-click menu: Node type for the selected nodes. A right-click on a node selects it first (unless it is already selected). */
  function setType(js,type){
    let out=segs;for(const j of js){const r=setNodeType(out,j,type);if(r)out=r}
    if(out===segs)return;segs=out;write('type:'+(++uid));build();
  }
  /* Segment type for the selected segments: Line / Quadratic / Cubic / Arc (see convertSegment for how the shape carries over). The converted
     segments stay selected, so a line turned into a curve can be dragged by its handles straight away. */
  function setSegType(js,type){
    const r=convertSegments(segs,js,type);if(!r)return;
    segs=r.segs;S.clear();r.sel.forEach(i=>S.pick('seg',i,true));write('seg:'+(++uid));build();
  }
  ctx.menu(({x,y})=>{
    if(!ctx.can('geometry.edit'))return [];
    const o=ctx.toOverlay({clientX:x,clientY:y}),at=segs.findIndex((q,j)=>q.t!=='Z'&&Math.hypot(...T0(segs[j].pts.at(-1)).map((v,k)=>v-o[k]))<=ctx.px(9));
    if(at>=0&&!S.has('node',at)){S.pick('node',at);layout()}
    else if(at<0&&document.elementFromPoint(x,y)===hit){ // on the stroke: that segment
      const k=nearestSeg(segs,ctx.toLocal({clientX:x,clientY:y}));
      if(k&&!S.has('seg',k.i)){S.pick('seg',k.i);layout()}
    }
    if(S.kind==='seg'){
      const js=S.items.filter(j=>segs[j]&&segs[j].t!=='M'&&segs[j].t!=='Z'),cur=new Set(js.map(j=>segs[j].t));
      if(!js.length)return [];
      const it=(label,t)=>{const r=convertSegments(segs,js,t);return {label,checked:cur.size===1&&cur.has(t),disabled:!!r&&r.segs.length>segs.length&&!ctx.can('nodes.insert'),action:()=>setSegType(js,t)}};
      return [{label:'Segment type',submenu:[it('Line','L'),it('Quadratic curve','Q'),it('Cubic curve','C'),it('Arc','A')]}];
    }
    const info=segInfo(segs),js=(S.kind==='node'?S.items:[]).filter(j=>nodeType(segs,j,info)),ts=new Set(js.map(j=>nodeType(segs,j,info)));
    if(!js.length)return [];
    const it=(label,t)=>({label,checked:ts.size===1&&ts.has(t),action:()=>setType(js,t)});
    return [{label:'Node type',submenu:[it('Corner','corner'),it('Smooth','smooth'),it('Symmetric','symmetric')]}];
  });
  ctx.on('view',()=>!dead&&layout());
  ctx.on('key',d=>{ // Escape clears the selection, Delete / Backspace remove it (see del)
    if(dead||d.handled||!S.size)return;
    if(d.key==='Escape'){S.clear();layout();d.handled=true}else if(d.key==='Delete'||d.key==='Backspace'){del();d.handled=true}
  });
  ctx.on('change',({el:e,src})=>{if(dead||e!==el||src==='widget')return;segs=parsePath(el.getAttribute('d')||'');build()});
  build();
  return {update(){segs=parsePath(el.getAttribute('d')||'');build()},destroy(){dead=true;g.remove()},
    deleteSelection:del,clearSelection(){S.clear();layout()},get selection(){return S.size?{kind:S.kind==='seg'?'segment':'node',items:S.items}:null}};
});
