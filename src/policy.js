/* Permissions. Pure (no DOM access), so it is unit-testable in Node and a server can run the very same checkWrite()
   on edits it receives. A policy is an ordered list of rules; resolve(el) folds every rule that matches `el`, in order,
   into one Perms object. Nothing is allowed until a rule grants it (default-deny), and a shape no rule grants anything
   to is not selectable at all, which is how the plain "which shapes are editable" setup maps on: {select, can:'all'}.

     rule = { select?, can?, cannot?, attrs?, pin?, bounds?, ranges?, snap? }
       select  CSS selector | (el)=>bool | element | array of those. Omitted = every element.
       can     capabilities to grant ('all', 'transform.*', or exact names). cannot removes them again. Within one rule
               `cannot` wins; across rules the later rule wins (rules are applied in order).
       attrs   {allow?:[globs], deny?:[globs]} filters the attributes that `attrs.edit` covers (fill, stroke, style, class...).
               A later rule's allow / deny replaces an earlier one's. Names are globs ('stroke*'); style="..." is
               checked property by property, so denying 'stroke' blocks both the attribute and the style property.
       pin     nodes that must not move: 'endpoints' (first/last node of each open path/polyline, both ends of a line)
               and/or node indices (negative counts from the end). Applies to path, polygon, polyline and line only.
       bounds  {x,y,width,height} (or [x,y,width,height]) in the shape's parent coordinate system, the same space its
               `transform` maps into: the shape's nodes (a path's anchors AND bezier handles, a polygon's vertices, a rect's
               corners, an ellipse's extent) may not leave this box. null clears an earlier rule's bounds. Stroke width
               is not counted. Where there is one obvious answer the edit is clamped (a dragged node stops at the wall and
               slides along it; a move stops at the wall); otherwise it is refused. An edit that doesn't make an already
               out-of-bounds shape worse is let through.
       snap    10 | [10, 5] | {x: 10, y: 5}: a grid step (x and y), in the shape's own coordinates, i.e. the numbers stored in d, points,
               x, cx... Whatever an edit moves lands on the grid: path anchors and bezier handles, polygon vertices, rect edges, line
               ends, circle / ellipse centres and the edge a radius handle drags; arc radii and flags are not snapped. Only coordinates
               the edit changes are snapped (an off-grid shape stays as it is until you touch that part), and a move shifts the whole
               shape by one amount, so nothing is squashed: a dragged node and the handles that travel with it snap together. Adding
               and deleting nodes does not snap (the new node sits on the curve). Snapping is forced, not a toggle, and applies to
               ed.set() too. Order: snap, then ranges, then bounds, so a range or a wall that is off the grid wins. null clears.
       ranges  {attr: [min, max]} numeric limits for attribute values ('r': [5,50], 'stroke-width': [1,null]); the value
               is clamped, and style="stroke-width:..." is limited the same way. Keys are globs. A value that isn't a
               number (or removing the attribute) is refused. {} clears an earlier rule's ranges.

   Capabilities
     transform.move / .scale / .rotate / .skew   whole-shape moves and the scale and rotate/skew modes
     geometry.edit                               the edit mode: dragging nodes and handles (also writing d, points, x, r...)
     nodes.insert / nodes.delete                 adding / removing nodes (need geometry.edit)
     attrs.edit                                  every other attribute (fill, stroke, style...), narrowed by `attrs`
   Markup. A rules list may contain the string 'markup' (policy: 'markup' is the short form), which reads
   data-sable-policy="..." attributes from the SVG itself, at that point in the list: rules after it override the markup, rules
   before it are overridden by it. An element's declarations are its ancestors' (outermost first) then its own, so one on a <g>
   covers the group and one on the root <svg> is the default for the whole drawing. The value is clauses separated by ';':
       geometry.edit, nodes.*       bare words grant capabilities ('all' and 'group.*' work);  -nodes.delete  takes one away
       can: ...   cannot: ...       the same, spelled out
       attrs-allow: fill, stroke*   attrs-deny: style      globs; an empty value clears an earlier list
       pin: endpoints, 0, -1        node indices; empty clears
       bounds: 0 0 600 400          x y width height ('none' clears)
       range: r=5..50               min..max, either end may be empty (r=5..  stroke-width=..8); 'range: none' clears
       snap: 10   or   snap: 10 5   grid step (x y);  'snap: none' clears
   Markup is only read when 'markup' is in the policy, because markup that came from the content (an uploaded SVG, say) must
   not be able to grant itself powers: enable it only for markup the host wrote. Writes to the attribute are always refused.
   A declaration that can't be parsed throws when the editor attaches (or the policy is set) and, if it appears later, switches
   everything off for the shapes it covers (fail closed). Bounds and pins on an ancestor apply to its descendants unchanged,
   so put them on groups whose children sit directly in them.
   Pins imply stability: any pin switches off the shape's transform.* (a move or scale would drag a pinned node along),
   and a pin by index also switches off nodes.insert / nodes.delete (indices would shift).
   TODO(reassess): pin holding in canvas coordinates while transforms stay allowed but constrained. See TODO.md. */
import {parsePath,serPath,arcGeom} from './path-math.js';
import {rnd} from './util.js';

export const CAPS=['transform.move','transform.scale','transform.rotate','transform.skew','geometry.edit','nodes.insert','nodes.delete','attrs.edit'];
const XF=CAPS.filter(c=>c.startsWith('transform.'));
/* attributes a widget gesture writes, per tag: these belong to geometry.edit (or to the move/scale capability that was declared) */
export const GEO={path:['d'],polygon:['points'],polyline:['points'],line:['x1','y1','x2','y2'],rect:['x','y','width','height','rx','ry'],circle:['cx','cy','r'],ellipse:['cx','cy','rx','ry']};
const NODE_ATTRS={path:['d'],polygon:['points'],polyline:['points'],line:['x1','y1','x2','y2']};
export const MODE_CAPS={scale:['transform.scale'],rotate:['transform.rotate','transform.skew'],edit:['geometry.edit']};
const TOL=1e-3; // pinned nodes may differ by this much (the first edit rewrites d with 3 decimals), and bounds are met to this precision

const expand=list=>{
  const out=new Set();
  for(const t of [].concat(list??[])){
    const m=t==='all'||t==='*'?CAPS:CAPS.filter(c=>t.endsWith('.*')?c.startsWith(t.slice(0,-1)):c===t);
    if(!m.length)throw new Error(`SableEdit policy: unknown capability "${t}"`);
    m.forEach(c=>out.add(c));
  }
  return out;
};
const glob=g=>new RegExp('^'+String(g).replace(/[.+?^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*')+'$');
const globs=l=>l==null?null:[].concat(l).map(glob);
const matcher=s=>typeof s==='string'?el=>el.matches(s):typeof s==='function'?s:Array.isArray(s)?(m=>el=>m.some(f=>f(el)))(s.map(matcher)):el=>el===s;
const normPin=p=>[].concat(p??[]).map(t=>{
  if(t==='endpoints'||Number.isInteger(t))return t;
  throw new Error(`SableEdit policy: bad pin "${t}" (use 'endpoints' or a node index)`);
});
const normBounds=b=>{
  if(b==null||b===false)return null;
  const [x,y,w,h]=Array.isArray(b)?b:[b.x,b.y,b.width,b.height];
  if(![x,y,w,h].every(Number.isFinite)||w<0||h<0)throw new Error('SableEdit policy: bounds needs {x, y, width, height} (numbers, width and height >= 0)');
  return [x,y,x+w,y+h];
};
const normRanges=r=>{
  if(r==null)return [];
  return Object.entries(r).map(([k,v])=>{
    const [a,b]=[].concat(v),min=a==null?-Infinity:a,max=b==null?Infinity:b;
    if(!(min<=max)||![min,max].every(x=>typeof x==='number'&&!Number.isNaN(x)))throw new Error(`SableEdit policy: bad range for "${k}" (use [min, max], either may be null)`);
    return {re:glob(k),min,max};
  });
};
export const MARKUP_ATTR='data-sable-policy';
const normSnap=s=>{
  if(s==null||s===false)return null;
  const [x,y]=Array.isArray(s)?[s[0],s[1]??s[0]]:typeof s==='object'?[s.x??s.y,s.y??s.x]:[s,s];
  if(![x,y].every(v=>typeof v==='number'&&Number.isFinite(v)&&v>0))throw new Error('SableEdit policy: snap needs a positive number, [x, y] or {x, y}');
  return [x,y];
};
const only=(o,keys,what)=>{for(const k in o)if(!keys.includes(k))throw new Error(`SableEdit policy: unknown ${what} key "${k}"`)};

/* ---- nodes: the points a pin can name ---- */
const NUM=/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g;
/* {pts, ends}: ends = indices of the endpoints (none for a closed shape) */
export const polyNodes=(pts,closed)=>({pts,ends:closed||!pts.length?[]:pts.length>1?[0,pts.length-1]:[0]});
/* path segments -> {pts: every anchor (a segment's end point, Z has none), ends, seg: the segment index of each anchor} */
export function pathNodes(segs){
  const pts=[],seg=[],ends=[];let from=-1,closed=false;
  const flush=()=>{if(from>=0&&!closed&&pts.length>from){ends.push(from);if(pts.length-1>from)ends.push(pts.length-1)}};
  segs.forEach((s,i)=>{
    if(s.t==='M'){flush();from=pts.length;closed=false}
    if(s.t==='Z'){closed=true;return}
    pts.push(s.pts.at(-1));seg.push(i);
  });
  flush();return {pts,ends,seg};
}
const readNodes=(tag,get)=>{
  if(tag==='path')return pathNodes(parsePath(get('d')||''));
  if(tag==='polygon'||tag==='polyline'){const n=(get('points')||'').match(NUM)||[],p=[];for(let i=0;i+1<n.length;i+=2)p.push([+n[i],+n[i+1]]);return polyNodes(p,tag==='polygon')}
  if(tag==='line'){const g=a=>parseFloat(get(a))||0;return polyNodes([[g('x1'),g('y1')],[g('x2'),g('y2')]],false)}
  return null;
};
/* indices (into n.pts) the pin list names */
export function pinnedIdx(n,pin){
  const s=new Set();
  for(const t of pin){if(t==='endpoints')n.ends.forEach(i=>s.add(i));else{const i=t<0?n.pts.length+t:t;if(i>=0&&i<n.pts.length)s.add(i)}}
  return [...s].sort((a,b)=>a-b);
}
const pinsHold=(a,b,pin)=>{
  const at=n=>pinnedIdx(n,pin).map(i=>n.pts[i]),x=at(a),y=at(b);
  return x.length===y.length&&x.every((p,i)=>Math.abs(p[0]-y[i][0])<=TOL&&Math.abs(p[1]-y[i][1])<=TOL);
};

/* style="a:b;c:d" -> {a:'b',c:'d'} (semicolons inside quotes and parentheses, e.g. url(data:...), don't split) */
const cssProps=s=>{
  const o={},parts=[];let d=0,q='',cur='';
  for(const ch of s||''){
    if(q){if(ch===q)q='';cur+=ch;continue}
    if(ch==='"'||ch==="'"){q=ch;cur+=ch;continue}
    if(ch==='(')d++;else if(ch===')')d=Math.max(0,d-1);
    if(ch===';'&&!d){parts.push(cur);cur=''}else cur+=ch;
  }
  parts.push(cur);
  for(const p of parts){const i=p.indexOf(':');if(i<0)continue;const k=p.slice(0,i).trim().toLowerCase();if(k)o[k]=p.slice(i+1).trim()}
  return o;
};

/* ---- Perms ---- */
function finish(tag,can,allow,deny,pin,bounds,ranges,snap){
  pin=NODE_ATTRS[tag]?pin:[];
  if(pin.length){XF.forEach(c=>can.delete(c));if(pin.some(t=>typeof t==='number')){can.delete('nodes.insert');can.delete('nodes.delete')}}
  if(!can.has('geometry.edit')){can.delete('nodes.insert');can.delete('nodes.delete')}
  const denied=n=>!!deny&&deny.some(r=>r.test(n));
  const rangesFor=n=>ranges.filter(r=>r.re.test(n));
  return {tag,pin,bounds,snap,caps:can,can:c=>can.has(c),denied,propOk:n=>!denied(n)&&(!allow||allow.some(r=>r.test(n))),selectable:can.size>0,rangesFor,
    /* [min, max] (null = open end) that applies to an attribute, or null: for host UIs that size their own sliders */
    range:n=>{const rs=rangesFor(n);if(!rs.length)return null;const lo=Math.max(...rs.map(r=>r.min)),hi=Math.min(...rs.map(r=>r.max));return [lo===-Infinity?null:lo,hi===Infinity?null:hi]}};
}
/* what no policy at all means: everything allowed */
export const OPEN={tag:'',pin:[],bounds:null,snap:null,caps:new Set(CAPS),can:()=>true,denied:()=>false,propOk:()=>true,selectable:true,rangesFor:()=>[],range:()=>null};

const MARKUP=Symbol('markup');
const compileRule=r=>{
  if(!r||typeof r!=='object'||Array.isArray(r))throw new Error('SableEdit policy: a rule is an object (or the string "markup")');
  only(r,['select','can','cannot','attrs','pin','bounds','ranges','snap'],'rule');if(r.attrs)only(r.attrs,['allow','deny'],'attrs');
  return {match:r.select==null?()=>true:matcher(r.select),can:r.can===undefined?null:expand(r.can),cannot:r.cannot===undefined?null:expand(r.cannot),
    attrs:r.attrs?{...('allow' in r.attrs&&{allow:globs(r.attrs.allow)}),...('deny' in r.attrs&&{deny:globs(r.attrs.deny)})}:null,
    pin:r.pin===undefined?null:normPin(r.pin),
    bounds:r.bounds===undefined?undefined:normBounds(r.bounds),ranges:r.ranges===undefined?undefined:normRanges(r.ranges),
    snap:r.snap===undefined?undefined:normSnap(r.snap)};
};

/* A data-sable-policy value -> a rule object (the same shape a policy list takes, before compiling). Throws on anything it
   doesn't understand. See the header for the grammar. */
export function parseMarkup(str){
  const r={},can=[],cannot=[];let ranges=null;
  const list=v=>v.split(/[\s,]+/).filter(Boolean);
  for(const raw of String(str??'').split(';')){
    const c=raw.trim();if(!c)continue;
    const i=c.indexOf(':');
    if(i<0){for(const t of list(c))t.startsWith('-')?cannot.push(t.slice(1)):can.push(t);continue}
    const key=c.slice(0,i).trim().toLowerCase(),v=c.slice(i+1).trim();
    switch(key){
      case 'can':can.push(...list(v));break;
      case 'cannot':cannot.push(...list(v));break;
      case 'attrs-allow':case 'attrs-deny':{const l=list(v);(r.attrs??={})[key.slice(6)]=l.length?l:null;break}
      case 'pin':r.pin=list(v).map(t=>/^[-+]?\d+$/.test(t)?+t:t);break;
      case 'bounds':{
        if(!v||v==='none'){r.bounds=null;break}
        const n=list(v).map(Number);
        if(n.length!==4)throw new Error('SableEdit policy: bounds needs four numbers: x y width height');
        r.bounds=n;break;
      }
      case 'snap':{
        if(!v||v==='none'){r.snap=null;break}
        const n=list(v).map(Number);
        if(n.length>2)throw new Error('SableEdit policy: snap wants one number or two (x y)');
        r.snap=n.length===1?n[0]:n;break;
      }
      case 'range':{
        ranges??={};
        if(v==='none'){ranges={};break}
        const m=/^(\S+?)\s*=\s*(\S*)$/.exec(v),e=m&&m[2].split('..');
        if(!m||e.length!==2)throw new Error(`SableEdit policy: range wants name=min..max (either end may be empty), got "${v}"`);
        ranges[m[1]]=e.map(x=>x===''?null:Number(x));break;
      }
      default:throw new Error(`SableEdit policy: unknown clause "${key}" in data-sable-policy`);
    }
  }
  if(can.length)r.can=can;if(cannot.length)r.cannot=cannot;if(ranges)r.ranges=ranges;
  return r;
}

/* env.root: the element the editor is attached to; markup is read from an element up to and including it */
export function compilePolicy(spec,env={}){
  if(spec==null)return null;
  const str=typeof spec==='string',arr=Array.isArray(spec),rules=str?[spec]:arr?spec:spec.rules||[],create=str||arr?true:spec.create??true;
  if(!str&&!arr)only(spec,['rules','create'],'policy');
  const R=rules.map(r=>r==='markup'?MARKUP:compileRule(r));
  const hasMarkup=R.includes(MARKUP),cache=new Map();
  /* the compiled rule for one attribute value; a value that can't be parsed turns everything off (and says so once) */
  const fromMarkup=v=>{
    let c=cache.get(v);
    if(!c){
      try{c=compileRule(parseMarkup(v))}
      catch(e){if(typeof console!=='undefined')console.error(e.message+` (data-sable-policy="${v}"): everything is switched off for the shapes it covers`);c=compileRule({cannot:'all'})}
      cache.set(v,c);
    }
    return c;
  };
  const chain=el=>{const out=[];for(let n=el;n&&typeof n.getAttribute==='function';n=n.parentNode){const v=n.getAttribute(MARKUP_ATTR);if(v!=null)out.unshift(fromMarkup(v));if(n===env.root)break}return out};
  return {spec,create,
    /* create: true | false | [tool ids]: which creation tools the menu offers */
    toolOk:id=>create===true||(Array.isArray(create)&&create.includes(id)),
    /* throws if any data-sable-policy under `root` doesn't parse (a typo shows up when the editor attaches, not as a silent hole) */
    validate(root){
      if(!hasMarkup||!root)return;
      const els=[root,...(root.querySelectorAll?root.querySelectorAll('['+MARKUP_ATTR+']'):[])];
      for(const e of els){
        const v=e.getAttribute&&e.getAttribute(MARKUP_ATTR);if(v==null)continue;
        try{compileRule(parseMarkup(v))}catch(err){throw new Error(`${err.message} (in data-sable-policy="${v}" on <${e.tagName}${e.id?' id="'+e.id+'"':''}>)`)}
      }
    },
    resolve(el){
      const can=new Set();let allow=null,deny=null,pin=[],bounds=null,ranges=[],snap=null;
      const apply=r=>{
        r.can&&r.can.forEach(c=>can.add(c));r.cannot&&r.cannot.forEach(c=>can.delete(c));
        if(r.attrs){if('allow' in r.attrs)allow=r.attrs.allow;if('deny' in r.attrs)deny=r.attrs.deny}
        if(r.pin)pin=r.pin;
        if(r.bounds!==undefined)bounds=r.bounds;if(r.ranges!==undefined)ranges=r.ranges;if(r.snap!==undefined)snap=r.snap;
      };
      for(const r of R){if(r===MARKUP)chain(el).forEach(apply);else if(r.match(el))apply(r)}
      return finish(el.tagName,can,allow,deny,pin,bounds,ranges,snap);
    }};
}

export const modeOk=(p,m)=>MODE_CAPS[m].some(c=>p.can(c));

/* style="..." is judged per property; any other attribute by name */
function attrOk(p,attr,old,nw){
  if(attr!=='style')return p.propOk(attr);
  if(p.denied('style'))return false;
  const a=cssProps(old),b=cssProps(nw);
  return [...new Set([...Object.keys(a),...Object.keys(b)])].filter(k=>a[k]!==b[k]).every(p.propOk);
}

/* ---- ranges ---- */
const NUM1=/^\s*([-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?)\s*(.*?)\s*$/;
const clampNum=(rs,v)=>rs.reduce((x,r)=>Math.min(r.max,Math.max(r.min,x)),v);
/* the value after clamping to the ranges that apply to attribute `attr`; undefined = refused (not a number, or removed) */
function rangeValue(p,attr,old,nw){
  if(attr==='style'){
    const a=cssProps(old),b=cssProps(nw);let hit=false;
    if(Object.keys(a).some(k=>!(k in b)&&p.rangesFor(k).length))return undefined;   // dropping a ranged property would reset it
    for(const k of Object.keys(b)){
      const rs=p.rangesFor(k);if(!rs.length||a[k]===b[k])continue;
      const m=NUM1.exec(b[k]);if(!m)return undefined;
      const v=clampNum(rs,+m[1]);if(v!==+m[1]){b[k]=rnd(v)+m[2];hit=true}
    }
    return hit?Object.entries(b).map(([k,v])=>k+':'+v).join('; '):nw;
  }
  const rs=p.rangesFor(attr);if(!rs.length)return nw;
  if(nw==null)return undefined;
  const m=NUM1.exec(nw);if(!m)return undefined;
  const v=clampNum(rs,+m[1]);
  return v===+m[1]?nw:rnd(v)+m[2];
}

/* ---- bounds ---- */
const mul=(A,B)=>[A[0]*B[0]+A[2]*B[1],A[1]*B[0]+A[3]*B[1],A[0]*B[2]+A[2]*B[3],A[1]*B[2]+A[3]*B[3],A[0]*B[4]+A[2]*B[5]+A[4],A[1]*B[4]+A[3]*B[5]+A[5]];
const ap=(M,q)=>[M[0]*q[0]+M[2]*q[1]+M[4],M[1]*q[0]+M[3]*q[1]+M[5]];
const inv=M=>{const d=M[0]*M[3]-M[1]*M[2];return Math.abs(d)<1e-12?null:[M[3]/d,-M[1]/d,-M[2]/d,M[0]/d,(M[2]*M[5]-M[3]*M[4])/d,(M[1]*M[4]-M[0]*M[5])/d]};
/* a transform list -> [a,b,c,d,e,f] (the same matrix the browser would build) */
export function parseTransform(str){
  let m=[1,0,0,1,0,0];const re=/(\w+)\s*\(([^)]*)\)/g;let t;
  while((t=re.exec(str||''))){
    const n=(t[2].match(NUM)||[]).map(Number),a=(n[0]||0)*Math.PI/180;let q;
    switch(t[1]){
      case 'translate':q=[1,0,0,1,n[0]||0,n[1]||0];break;
      case 'scale':q=[n[0]??1,0,0,n[1]??n[0]??1,0,0];break;
      case 'rotate':{const c=Math.cos(a),s=Math.sin(a),x=n[1]||0,y=n[2]||0;q=[c,s,-s,c,x-c*x+s*y,y-s*x-c*y];break}
      case 'skewX':q=[1,0,Math.tan(a),1,0,0];break;
      case 'skewY':q=[1,Math.tan(a),0,1,0,0];break;
      case 'matrix':q=n.length>=6?n.slice(0,6):null;break;
      default:q=null;
    }
    if(q)m=mul(m,q);
  }
  return m;
}
const flt=(get,a)=>parseFloat(get(a))||0;
/* local-space points whose convex hull contains the shape: a path's anchors and bezier handles plus samples of its arcs */
function hullPts(tag,get,env){
  if(tag==='path'){
    const out=[];let cur=[0,0],start=[0,0];
    for(const s of parsePath(get('d')||'')){
      if(s.t==='Z'){cur=start;continue}
      if(s.t==='M')start=s.pts[0];
      if(s.t==='A'){const q=arcGeom(cur,s.pts[0],...s.arc);if(q)for(let k=1;k<24;k++)out.push(q.pt(q.th1+q.dth*k/24))}
      s.pts.forEach(q=>out.push(q));cur=s.pts.at(-1);
    }
    return out;
  }
  if(tag==='polygon'||tag==='polyline'||tag==='line')return readNodes(tag,get).pts;
  if(tag==='rect'){const x=flt(get,'x'),y=flt(get,'y'),w=flt(get,'width'),h=flt(get,'height');return [[x,y],[x+w,y],[x+w,y+h],[x,y+h]]}
  const b=env&&env.bbox&&env.bbox();   // anything else (text, g, use...): the host-side bounding box
  return b?[[b[0],b[1]],[b[2],b[1]],[b[2],b[3]],[b[0],b[3]]]:null;
}
/* [x0,y0,x1,y1] of the shape in its parent's coordinates (its own transform applied), or null when it can't be told */
function shapeBox(tag,get,env){
  const M=parseTransform(get('transform'));
  if(tag==='circle'||tag==='ellipse'){
    const rx=Math.abs(tag==='circle'?flt(get,'r'):flt(get,'rx')),ry=tag==='circle'?rx:Math.abs(flt(get,'ry')),c=ap(M,[flt(get,'cx'),flt(get,'cy')]),
      hx=Math.hypot(M[0]*rx,M[2]*ry),hy=Math.hypot(M[1]*rx,M[3]*ry);
    return [c[0]-hx,c[1]-hy,c[0]+hx,c[1]+hy];
  }
  const pts=hullPts(tag,get,env);if(!pts||!pts.length)return null;
  const q=pts.map(r=>ap(M,r)),xs=q.map(r=>r[0]),ys=q.map(r=>r[1]);
  return [Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)];
}
/* how far a box sticks out of B, summed over the sides of the chosen axes */
const viol=(B,b,axis='XY')=>(axis!=='Y'?Math.max(0,B[0]-b[0])+Math.max(0,b[2]-B[2]):0)+(axis!=='X'?Math.max(0,B[1]-b[1])+Math.max(0,b[3]-B[3]):0);
/* extents of these attributes along x ('X'), y ('Y') or both ('XY'): what a scalar-attribute shape's box depends on */
const AXIS={rect:{x:'X',width:'X',y:'Y',height:'Y'},line:{x1:'X',x2:'X',y1:'Y',y2:'Y'},ellipse:{cx:'X',rx:'X',cy:'Y',ry:'Y'},circle:{cx:'X',cy:'Y',r:'XY'}};
const isGeo=(tag,a)=>a==='transform'||!!(GEO[tag]&&GEO[tag].includes(a));
const shiftPts=(segsOrPts,dx,dy)=>segsOrPts.map(q=>[q[0]+dx,q[1]+dy]);
const fmtPts=pts=>pts.map(q=>rnd(q[0])+','+rnd(q[1])).join(' ');
const bad=()=>({ok:false,cap:'bounds',reason:'bounds'});

/* Bring the combined result of a group of writes (`fin`: attr -> final string) back inside p.bounds.
   -> {ok:true, values} (possibly adjusted) | {ok:false}. See the header for what is clamped and what is refused. */
function fitBounds(p,tag,get,fin,attrs,isMove,env){
  const B=p.bounds,val=k=>fin.has(k)?fin.get(k):get(k);
  const bNew=shapeBox(tag,val,env),bOld=shapeBox(tag,get,env);
  if(!bNew||!bOld)return bad();
  const vOld=viol(B,bOld);
  if(viol(B,bNew)<=vOld+TOL)return {ok:true,values:fin};
  const out=new Map(fin),M=parseTransform(val('transform')),Mi=inv(M);
  const done=()=>{const nb=shapeBox(tag,k=>out.has(k)?out.get(k):get(k),env);return nb&&viol(B,nb)<=vOld+TOL?{ok:true,values:out}:bad()};
  const nodeAttr=NODE_ATTRS[tag]&&tag!=='line'?NODE_ATTRS[tag][0]:null;   // path d / polygon+polyline points
  if(attrs.includes('transform')){
    if(!isMove)return bad();                                              // scale / rotate / skew: refuse, the pointer just stops at the wall
    const dx=bNew[0]<B[0]?B[0]-bNew[0]:bNew[2]>B[2]?B[2]-bNew[2]:0,dy=bNew[1]<B[1]?B[1]-bNew[1]:bNew[3]>B[3]?B[3]-bNew[3]:0;
    out.set('transform','matrix('+mul([1,0,0,1,dx,dy],parseTransform(val('transform'))).map((v,i)=>+v.toFixed(i<4?6:3)).join(' ')+')');
    return done();
  }
  if(nodeAttr&&attrs.includes(nodeAttr)){
    if(!Mi)return bad();
    const nw=val(nodeAttr);
    if(isMove){                                                           // slide the whole shape back in, per axis
      const dx=bNew[0]<B[0]?B[0]-bNew[0]:bNew[2]>B[2]?B[2]-bNew[2]:0,dy=bNew[1]<B[1]?B[1]-bNew[1]:bNew[3]>B[3]?B[3]-bNew[3]:0,
        ldx=Mi[0]*dx+Mi[2]*dy,ldy=Mi[1]*dx+Mi[3]*dy;
      out.set(nodeAttr,tag==='path'?serPath(parsePath(nw).map(s=>({...s,pts:shiftPts(s.pts,ldx,ldy)}))):fmtPts(shiftPts(readNodes(tag,k=>k===nodeAttr?nw:get(k)).pts,ldx,ldy)));
      return done();
    }
    const clamp=(q,old)=>{                                                // an edit: clamp the points it changed, leave the rest alone
      if(old&&Math.abs(q[0]-old[0])<1e-9&&Math.abs(q[1]-old[1])<1e-9)return q;
      const w=ap(M,q);if(w[0]>=B[0]&&w[0]<=B[2]&&w[1]>=B[1]&&w[1]<=B[3])return q;
      return ap(Mi,[Math.min(B[2],Math.max(B[0],w[0])),Math.min(B[3],Math.max(B[1],w[1]))]);
    };
    if(tag==='path'){
      const segs=parsePath(nw),was=parsePath(get('d')||'');
      out.set('d',serPath(segs.map((s,i)=>({...s,pts:s.pts.map((q,k)=>clamp(q,was[i]&&was[i].pts[k]))}))));
    }else{
      const was=readNodes(tag,get).pts;
      out.set('points',fmtPts(readNodes(tag,k=>k===nodeAttr?nw:get(k)).pts.map((q,i)=>clamp(q,was[i]))));
    }
    return done();
  }
  const ax=AXIS[tag],chg=ax?attrs.filter(a=>ax[a]):[];                    // rect / line / circle / ellipse: back off each axis's attributes in proportion
  if(!chg.length)return bad();
  const o={},n={};chg.forEach(a=>{o[a]=flt(get,a);n[a]=flt(val,a)});
  const aligned=Math.abs(M[1])<1e-9&&Math.abs(M[2])<1e-9,joint=!aligned||chg.some(a=>ax[a]==='XY');
  const groups=joint?[{attrs:chg,axis:'XY'}]:['X','Y'].map(g=>({attrs:chg.filter(a=>ax[a]===g),axis:g})).filter(g=>g.attrs.length);
  for(const g of groups){
    const st=t=>k=>g.attrs.includes(k)?String(o[k]+(n[k]-o[k])*t):chg.includes(k)?String(n[k]):val(k);
    const vo=viol(B,bOld,g.axis),ok=t=>viol(B,shapeBox(tag,st(t),env),g.axis)<=vo+1e-9;   // search strictly; rounding to 3 decimals then stays within TOL
    if(ok(1))continue;
    let lo=0,hi=1;for(let i=0;i<30;i++){const m=(lo+hi)/2;ok(m)?lo=m:hi=m}
    g.attrs.forEach(a=>{n[a]=o[a]+(n[a]-o[a])*lo});
  }
  chg.forEach(a=>out.set(a,String(rnd(n[a]))));
  return done();
}

/* ---- snap ---- */
const SNAP_TOL=6e-4;   // a coordinate that moved by less than this has not moved (3-decimal rounding noise)
const snapQ=(v,st)=>Math.round(v/st)*st;
const moved=(a,b)=>Math.abs(a-b)>SNAP_TOL;
/* Points that were moved by the same amount snap together, by one adjustment taken from the group's first anchor (or its first
   point): a dragged node and the bezier handles that travel with it keep their offsets, and a whole-shape move stays rigid. */
function snapGroups(refs,S){
  const groups=[];
  for(const r of refs){const g=groups.find(g=>Math.abs(g.d[0]-r.d[0])<=1.5e-3&&Math.abs(g.d[1]-r.d[1])<=1.5e-3);g?g.m.push(r):groups.push({d:r.d,m:[r]})}
  for(const g of groups){
    const ref=g.m.find(r=>r.anchor)||g.m[0],pt=ref.h.pts[ref.k],adj=[snapQ(pt[0],S[0])-pt[0],snapQ(pt[1],S[1])-pt[1]];
    g.m.forEach(r=>{const t=r.h.pts[r.k];r.h.pts[r.k]=[t[0]+adj[0],t[1]+adj[1]]});
  }
}
/* the writes of one group, with whatever they move put on the grid (p.snap = [sx, sy]); returns a new changes list */
function snapChanges(p,tag,get,changes,env){
  const S=p.snap,prop=new Map();
  for(const c of changes)prop.set(c.attr,c.nw);
  if([...prop.values()].some(v=>v===null))return changes;
  const val=k=>prop.has(k)?prop.get(k):get(k),out=new Map();
  const put=(a,v)=>{if(moved(v,prop.has(a)?flt(val,a):flt(get,a)))out.set(a,String(rnd(v)))};   // only when it differs from what would be written anyway
  if(tag==='rect'){                                       // edges, not x and width: resizing from the left must not move the right edge
    for(const [pos,size,st] of [['x','width',S[0]],['y','height',S[1]]]){
      if(!prop.has(pos)&&!prop.has(size))continue;
      const o0=flt(get,pos),o1=o0+flt(get,size),n0=flt(val,pos),n1=n0+flt(val,size),m0=moved(n0,o0),m1=moved(n1,o1);
      const rigid=m0&&m1&&!moved(n1-n0,o1-o0);              // a move: snap one edge, keep the size
      const a=m0?snapQ(n0,st):o0;let b=rigid?a+(n1-n0):m1?snapQ(n1,st):o1;
      if(!rigid&&m1&&b-a<=0&&n1-n0>0)b=a+st;                // never collapse to nothing
      put(pos,a);put(size,b-a);
    }
  }else if(tag==='circle'||tag==='ellipse'){
    const ell=tag==='ellipse';
    for(const [pos,size,st,rad] of [['cx',ell?'rx':'r',S[0],true],['cy',ell?'ry':'r',S[1],ell]]){
      const c0=flt(get,pos),c1=flt(val,pos),r0=flt(get,size),r1=flt(val,size),cm=moved(c1,c0),c=cm?snapQ(c1,st):c0;
      if(cm)put(pos,c);
      if(rad&&moved(r1,r0)){let r=snapQ(c+r1,st)-c;if(r<=0&&r1>0)r=st;put(size,r)}   // the handle at centre + radius lands on the grid
    }
  }else if(tag==='line'){
    for(const [ks,st] of [[['x1','x2'],S[0]],[['y1','y2'],S[1]]]){
      const o=ks.map(k=>flt(get,k)),n=ks.map(k=>flt(val,k)),m=[moved(n[0],o[0]),moved(n[1],o[1])];
      if(m[0]&&m[1]&&!moved(n[0]-o[0],n[1]-o[1])){const sh=snapQ(n[0],st)-n[0];ks.forEach((k,i)=>put(k,n[i]+sh))}   // a move: both ends together
      else ks.forEach((k,i)=>{if(m[i])put(k,snapQ(n[i],st))});
    }
  }else if(tag==='path'&&prop.has('d')){
    const was=parsePath(get('d')||''),now=parsePath(prop.get('d')||'');
    if(was.length===now.length&&was.every((s,i)=>s.t===now[i].t)){   // same structure: an edit or a move (adding / deleting nodes isn't snapped)
      const refs=[];
      now.forEach((s,i)=>s.pts.forEach((pt,k)=>{
        const o=was[i].pts[k],d=[pt[0]-o[0],pt[1]-o[1]];
        if(!moved(d[0],0)&&!moved(d[1],0)){s.pts[k]=[...o];return}
        refs.push({h:s,k,d,anchor:k===s.pts.length-1});
      }));
      if(refs.length){snapGroups(refs,S);out.set('d',serPath(now))}
    }
  }else if((tag==='polygon'||tag==='polyline')&&prop.has('points')){
    const was=readNodes(tag,get).pts,now=readNodes(tag,val).pts;
    if(was.length===now.length){
      const h={pts:now},refs=[];
      now.forEach((pt,k)=>{const d=[pt[0]-was[k][0],pt[1]-was[k][1]];if(!moved(d[0],0)&&!moved(d[1],0)){now[k]=[...was[k]];return}refs.push({h,k,d,anchor:true})});
      if(refs.length){snapGroups(refs,S);out.set('points',fmtPts(now))}
    }
  }
  if(prop.has('transform')&&changes.some(c=>c.attr==='transform'&&[].concat(c.hint||[]).includes('transform.move'))){   // a move of text, g...: the box corner lands on the grid
    const M=parseTransform(prop.get('transform')),M0=parseTransform(get('transform'));
    if(M.some((v,i)=>moved(v,M0[i]))){
      const b=env&&env.bbox&&env.bbox(),ref=b?ap(M,[b[0],b[1]]):[M[4],M[5]],sh=[snapQ(ref[0],S[0])-ref[0],snapQ(ref[1],S[1])-ref[1]];
      if(moved(sh[0],0)||moved(sh[1],0))out.set('transform','matrix('+mul([1,0,0,1,sh[0],sh[1]],M).map((v,i)=>+v.toFixed(i<4?6:3)).join(' ')+')');
    }
  }
  if(!out.size)return changes;
  const res=changes.map(c=>out.has(c.attr)?{...c,nw:out.get(c.attr)}:c);
  for(const [a,v] of out)if(!changes.some(c=>c.attr===a))res.push({attr:a,nw:v,hint:changes[0].hint});
  return res;
}

/* Decide one attribute write. get(name) reads the element's current attributes, nw is the new value (null = remove),
   hint is the capability the writer declares (a string or list; the move / scale / rotate gestures pass theirs).
   Checks capability, attribute rules, ranges and node structure / pins for this attribute alone.
   -> {ok:true, value} (value: what to store, ranges may have clamped it) | {ok:false, cap, reason} */
function checkOne(p,tag,get,attr,nw,hint){
  const no=(cap,reason)=>({ok:false,cap,reason});
  const kind=GEO[tag]&&GEO[tag].includes(attr)?'geom':attr==='transform'?'xform':'attr';
  const need=hint?[].concat(hint):kind==='geom'?['geometry.edit']:kind==='xform'?XF:['attrs.edit'];
  if(!need.some(c=>p.can(c)))return no(need[0],'capability');
  if(attr===MARKUP_ATTR)return no('attrs.edit','attribute');   // the policy can't be edited through the editor it governs (host code can use force)
  if(kind==='attr'&&!attrOk(p,attr,get(attr),nw))return no('attrs.edit','attribute');
  const v=rangeValue(p,attr,get(attr),nw);
  if(v===undefined)return no('range','range');
  nw=v;
  if(NODE_ATTRS[tag]&&NODE_ATTRS[tag].includes(attr)){ // node structure: compare the nodes before and after
    const a=readNodes(tag,get),b=readNodes(tag,k=>k===attr?nw:get(k));
    if(b.pts.length>a.pts.length&&!p.can('nodes.insert'))return no('nodes.insert','capability');
    if(b.pts.length<a.pts.length&&!p.can('nodes.delete'))return no('nodes.delete','capability');
    if(p.pin.length&&!pinsHold(a,b,p.pin))return no('pin','pinned');
  }
  return {ok:true,value:nw};
}

/* Decide several writes to one element as one step (a rect resize writes x, y, width and height; the bounds are judged on
   the finished rect, not on each half-written state). changes: [{attr, nw, hint?}]; env.bbox() -> [x0,y0,x1,y1] is only
   needed for bounds on elements this module can't measure itself (text, g...).
   -> {ok:true, values: Map attr -> string to store (null = remove)} | {ok:false, attr, cap, reason: 'capability'|'attribute'|'range'|'pinned'|'bounds'} */
export function checkWrites(p,tag,get,changes,env){
  if(p.snap)changes=snapChanges(p,tag,get,changes,env);
  const fin=new Map();
  for(const c of changes){const r=checkOne(p,tag,get,c.attr,c.nw,c.hint);if(!r.ok)return {...r,attr:c.attr};fin.set(c.attr,r.value)}
  const geo=changes.filter(c=>isGeo(tag,c.attr));
  if(!p.bounds||!geo.length)return {ok:true,values:fin};
  const f=fitBounds(p,tag,get,fin,geo.map(c=>c.attr),geo.some(c=>[].concat(c.hint||[]).includes('transform.move')),env);
  return f.ok?f:{...f,attr:geo[0].attr};
}
/* one write: -> {ok:true} | {ok:true, value} when it was adjusted | {ok:false, cap, reason} */
export function checkWrite(p,tag,get,attr,nw,hint,env){
  const r=checkWrites(p,tag,get,[{attr,nw,hint}],env);
  if(!r.ok){const {attr:_,...rest}=r;return rest}
  const v=r.values.get(attr);return v===nw?{ok:true}:{ok:true,value:v};
}

/* Would a write to `attr` be accepted at all? ('style:fill' asks about one style property.) For host UIs that grey out controls. */
export function canSet(p,tag,attr){
  if(attr===MARKUP_ATTR)return false;
  if(attr.startsWith('style:'))return p.can('attrs.edit')&&!p.denied('style')&&p.propOk(attr.slice(6).toLowerCase());
  if(GEO[tag]&&GEO[tag].includes(attr))return p.can('geometry.edit');
  if(attr==='transform')return XF.some(c=>p.can(c));
  return p.can('attrs.edit')&&(attr==='style'?!p.denied('style'):p.propOk(attr));
}
