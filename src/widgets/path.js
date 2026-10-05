import {Widgets} from '../registry.js';
import {mk} from '../dom.js';
import {parsePath,arcGeom,arcFit,dc,split} from '../path-math.js';
/* Path widget: nodes (squares) + bezier handles (dots). Drag to edit; Shift while dragging a
   cubic handle mirrors its partner; double-click the path to add a node, a node to delete it. */
Widgets.register(el=>el.tagName==='path',ctx=>{
  const el=ctx.el,g=mk('g'); ctx.overlay.append(g);
  let segs=parsePath(el.getAttribute('d')||''),items=[],lines=[],hit,gh,dead=false,mv0=false,mv1=false,act=-1,arcs=[]; // mv*: did the last two gestures drag?
  const f=v=>+v.toFixed(3), A=(e,o)=>{for(const k in o)e.setAttribute(k,o[k])};
  const ser=()=>segs.map(s=>s.t==='Z'?'Z':s.t+(s.arc?s.arc.join(' ')+' ':'')+s.pts.flat().map(f).join(' ')).join(' ');
  const write=()=>ctx.set('d',ser());
  const prevPt=i=>{for(let j=i-1;j>=0;j--)if(segs[j].t!=='Z')return segs[j].pts.at(-1);return segs[i].pts[0]};
  const startOf=i=>{for(let j=i;j>=0;j--)if(segs[j].t==='M')return segs[j].pts[0]};
  function bind(h,onStart,onMove){
    h.addEventListener('pointerdown',e=>{
      e.stopPropagation();h.setPointerCapture(e.pointerId);const p0=ctx.toLocal(e);onStart(p0);mv0=mv1;mv1=false;
      const mv=ev=>{if(Math.hypot(ev.clientX-e.clientX,ev.clientY-e.clientY)>3)mv1=true;onMove(ctx.toLocal(ev),p0,ev);write();layout()};
      h.addEventListener('pointermove',mv);
      h.addEventListener('pointerup',()=>h.removeEventListener('pointermove',mv),{once:true});
    });
  }
  function ctl(s,k,i){
    const h=mk('circle',{style:'pointer-events:all;cursor:move',fill:'var(--acc,#2f6fed)'});
    items.push({el:h,get:()=>s.pts[k],r:3.5}); gh.append(h);
    bind(h,()=>{},(p,p0,ev)=>{
      s.pts[k]=p;
      if(ev.shiftKey&&s.t==='C'){
        const [o,oi,nd]=k?[segs[i+1],0,s.pts[2]]:[segs[i-1],1,prevPt(i)];
        if(o?.t==='C')o.pts[oi]=[2*nd[0]-p[0],2*nd[1]-p[1]];
      }
    });
  }
  function node(s,i){
    const h=mk('rect',{style:'pointer-events:all;cursor:move',fill:'var(--panel,#fff)',stroke:'var(--acc,#2f6fed)'});
    items.push({el:h,get:()=>s.pts.at(-1),r:5,n:1}); gh.append(h);
    let refs=[];
    bind(h,()=>{ // a node carries its adjacent bezier handles along
      if(s.t==='A'){act=i;layout()}
      const nx=segs[i+1]; refs=[[s,s.pts.length-1]]; if(s.t==='C')refs.push([s,1]); if(nx?.t==='C')refs.push([nx,0]);
      refs=refs.map(([q,k])=>[q,k,[...q.pts[k]]]);
    },(p,p0)=>{const dx=p[0]-p0[0],dy=p[1]-p0[1];refs.forEach(([q,k,o])=>q.pts[k]=[o[0]+dx,o[1]+dy])});
    h.addEventListener('dblclick',e=>{
      e.stopPropagation(); if(mv0||mv1||segs.filter(q=>q.t!=='Z').length<3)return;
      if(s.t==='M'){const n=segs[i+1]; if(!n||n.t==='Z')return; n.t='M';n.pts=[n.pts.at(-1)];delete n.arc}
      segs.splice(i,1);write();build();
    });
  }
  function insert(p){
    let best=null;
    segs.forEach((s,i)=>{
      if(s.t==='M'||s.t==='A')return;
      const P=prevPt(i),cp=s.t==='Z'?[P,startOf(i)]:s.t==='L'?[P,s.pts[0]]:[P,...s.pts];
      for(let k=1;k<32;k++){const q=dc(cp,k/32),d=Math.hypot(q[0]-p[0],q[1]-p[1]);if(!best||d<best.d)best={d,i,t:k/32,cp}}
    });
    if(!best)return; const {i,t,cp}=best,s=segs[i],[L,R]=split(cp,t);
    if(s.t==='Z')segs.splice(i,0,{t:'L',pts:[L.at(-1)]});
    else segs.splice(i,1,{t:s.t,pts:L.slice(1)},{t:s.t,pts:R.slice(1)});
    write();build();
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
    ln(ctr(i),ends(i,0,1),{arc:i,dash:1,op:.8});ln(ctr(i),ends(i,1,1),{arc:i,dash:1,op:.8}); // dotted x and y axes
    const rotPos=()=>{const q=geom(i);if(!q)return null;const d=q.rx+gapL();return [q.cx-d*q.c,q.cy-d*q.s]};
    ln(()=>{const q=geom(i);return q&&[q.cx-q.rx*q.c,q.cy-q.rx*q.s]},rotPos,{arc:i}); // short stem: ring hangs off the ellipse
    const drag=(h,pos,kind,r,fill)=>{
      items.push({el:h,arc:i,r,get:pos});
      let off=[0,0]; // where on the dot you grabbed it: aim the dot's centre, not the raw pointer, so a click off-centre doesn't jump
      bind(h,p0=>{const c=pos();off=c?[p0[0]-c[0],p0[1]-c[1]]:[0,0];act=i;layout()},
        (p,p0,ev)=>{s.arc=arcFit(P(),s.pts[0],s.arc,kind,[p[0]-off[0],p[1]-off[1]],{gap:kind==='rot'?0:gapL(),shift:ev.shiftKey})});
    };
    drag(mkh(acc,'move'),ends(i,0,1),'rx',4.5);
    drag(mkh(acc,'move'),ends(i,1,1),'ry',4.5);
    drag(mkh('var(--panel,#fff)','grab'),rotPos,'rot',4.5);
    const hm=mkh(acc,'move');items.push({el:hm,arc:i,always:1,r:4.5,get:()=>{const q=geom(i);return q&&q.pt(q.th1+q.dth/2)}});
    let offm=[0,0];
    bind(hm,p0=>{const c=geom(i)&&geom(i).pt(geom(i).th1+geom(i).dth/2);offm=c?[p0[0]-c[0],p0[1]-c[1]]:[0,0];act=i;layout()},
      p=>{s.arc=arcFit(P(),s.pts[0],s.arc,'flip',[p[0]-offm[0],p[1]-offm[1]])});
  }
  function build(){
    g.replaceChildren();items=[];lines=[];arcs=[];if(!(segs[act]&&segs[act].t==='A'))act=segs.findIndex(q=>q.t==='A');
    hit=mk('path',{fill:'none',stroke:'transparent','stroke-width':12,'vector-effect':'non-scaling-stroke',style:'pointer-events:stroke;cursor:copy'});
    hit.addEventListener('dblclick',e=>insert(ctx.toLocal(e))); g.append(hit); gh=mk('g');
    segs.forEach((s,i)=>{
      if(s.t==='C'){ln(()=>prevPt(i),()=>s.pts[0]);ln(()=>s.pts[1],()=>s.pts[2]);ctl(s,0,i);ctl(s,1,i)}
      if(s.t==='Q'){ln(()=>prevPt(i),()=>s.pts[0]);ln(()=>s.pts[0],()=>s.pts[1]);ctl(s,0,i)}
      if(s.t==='A')arcHandles(s,i);
    });
    segs.forEach((s,i)=>s.t!=='Z'&&node(s,i));
    g.append(gh);layout();
  }
  function layout(){
    const M=ctx.matrix(),T=p=>{const q=new DOMPoint(p[0],p[1]).matrixTransform(M);return [q.x,q.y]},w=ctx.px(1.5);
    A(hit,{d:ser(),transform:`matrix(${M.a} ${M.b} ${M.c} ${M.d} ${M.e} ${M.f})`});
    lines.forEach(l=>{const a0=l.a(),b0=l.b(),on=a0&&b0&&(l.arc===undefined||l.arc===act);l.el.style.display=on?'':'none';if(!on)return;
      const a=T(a0),b=T(b0);A(l.el,{x1:a[0],y1:a[1],x2:b[0],y2:b[1],'stroke-width':ctx.px(1),'stroke-dasharray':l.dash?ctx.px(2)+' '+ctx.px(3):'none'})});
    items.forEach(it=>{const pt=it.arc!==undefined&&it.arc!==act&&!it.always?null:it.get();
      it.el.style.display=pt?'':'none';if(!pt)return;const [x,y]=T(pt),r=ctx.px(it.r);
      A(it.el,it.n?{x:x-r,y:y-r,width:2*r,height:2*r,'stroke-width':w}:{cx:x,cy:y,r,'stroke-width':w})});
    arcs.forEach(({i,ell})=>{const q=i===act&&geom(i);ell.style.display=q?'':'none';
      if(q)A(ell,{rx:q.rx,ry:q.ry,transform:`matrix(${M.a} ${M.b} ${M.c} ${M.d} ${M.e} ${M.f}) translate(${q.cx} ${q.cy}) rotate(${q.phi*180/Math.PI})`})});
  }
  ctx.on('view',()=>!dead&&layout());
  ctx.on('change',({el:e,src})=>{if(dead||e!==el||src==='widget')return;segs=parsePath(el.getAttribute('d')||'');build()});
  build();
  return {update(){segs=parsePath(el.getAttribute('d')||'');build()},destroy(){dead=true;g.remove()}};
});
