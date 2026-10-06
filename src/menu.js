/* Context menu UI (HTML popup, appended to <body> so the svg never clips it). Items:
   {label, action(), checked, disabled, submenu: [items] | () => [items]} or {sep:1}.
   Keyboard: arrows, Enter/Space, Left/Esc close a submenu. Closes on outside press, Esc, blur, resize, scroll. */
/* pure placement helpers (unit-tested): the menu opens at the pointer, flipping left / clamping up when it would leave the viewport */
export const placeMenu=(x,y,w,h,vw,vh,pad=4)=>({left:x+w+pad>vw?Math.max(pad,x-w):x,top:y+h+pad>vh?Math.max(pad,vh-h-pad):y});
/* submenu flyout beside its parent row `r` ({left,right,top}): right side if it fits, else left */
export const placeSub=(r,w,h,vw,vh,pad=4)=>({left:Math.max(pad,r.right+w+pad>vw?r.left-w:r.right),top:r.top+h+pad>vh?Math.max(pad,vh-h-pad):r.top});
const CSS='position:fixed;left:0;top:0;visibility:hidden;z-index:2147483000;min-width:150px;padding:4px 0;margin:0;background:var(--panel,#fff);color:#222;border:1px solid #ccc;border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,.22);font:13px/1.4 system-ui,sans-serif;user-select:none;-webkit-user-select:none';
let live=null;
export function openMenu(items,x,y,onClose){
  live&&live.close();
  const doc=document,panels=[];let closed=false;
  const lit=(row,on)=>{row.el.style.background=on?'var(--acc,#2f6fed)':'';row.el.style.color=on?'#fff':''};
  const focus=(p,i)=>{if(p.sel>=0)lit(p.rows[p.sel],false);p.sel=i;if(i>=0)lit(p.rows[i],true)};
  const trim=n=>{while(panels.length>n)panels.pop().el.remove()};
  function build(list,at){
    const el=doc.createElement('div');el.setAttribute('role','menu');el.style.cssText=CSS;const p={el,rows:[],sel:-1};
    list.forEach(it=>{
      if(it.sep){const s=doc.createElement('div');s.setAttribute('role','separator');s.style.cssText='height:1px;margin:4px 0;background:#ddd';el.append(s);return}
      const r=doc.createElement('div'),ck=doc.createElement('span'),lb=doc.createElement('span');
      r.setAttribute('role','menuitem');if(it.disabled)r.setAttribute('aria-disabled','true');
      r.style.cssText='display:flex;align-items:center;gap:8px;padding:4px 14px 4px 8px;cursor:default;white-space:nowrap'+(it.disabled?';opacity:.45':'');
      ck.style.cssText='width:14px;text-align:center';ck.textContent=it.checked?'\u2713':'';lb.style.flex='1';lb.textContent=it.label;r.append(ck,lb);
      if(it.submenu){const a=doc.createElement('span');a.textContent='\u25B8';a.style.marginLeft='12px';r.append(a);r.setAttribute('aria-haspopup','true')}
      const row={el:r,it};p.rows.push(row);el.append(r);
      r.addEventListener('mouseenter',()=>enter(p,row));
      r.addEventListener('click',e=>{e.stopPropagation();activate(p,row)});
    });
    doc.body.append(el);
    const b=el.getBoundingClientRect(),q=at(b.width,b.height,doc.documentElement.clientWidth,doc.documentElement.clientHeight);
    el.style.left=q.left+'px';el.style.top=q.top+'px';el.style.visibility='';panels.push(p);return p;
  }
  function openSub(p,row,first){
    trim(panels.indexOf(p)+1);const l=row.it.submenu,list=typeof l==='function'?l():l,r=row.el.getBoundingClientRect();
    const sp=build(list,(w,h,vw,vh)=>placeSub(r,w,h,vw,vh));
    if(first){const i=sp.rows.findIndex(q=>!q.it.disabled);i>=0&&focus(sp,i)}
  }
  function enter(p,row){
    trim(panels.indexOf(p)+1);if(row.it.disabled){focus(p,-1);return}
    focus(p,p.rows.indexOf(row));if(row.it.submenu)openSub(p,row,false);
  }
  function activate(p,row,viaKey){
    if(row.it.disabled)return;
    if(row.it.submenu){openSub(p,row,viaKey);return}
    close();row.it.action&&row.it.action();
  }
  const key=e=>{
    const p=panels[panels.length-1],k=e.key,r=p.rows[p.sel];
    const move=d=>{const en=p.rows.map((_,i)=>i).filter(i=>!p.rows[i].it.disabled);if(!en.length)return;const at=en.indexOf(p.sel);focus(p,en[at<0?(d>0?0:en.length-1):(at+d+en.length)%en.length])};
    if(k==='ArrowDown')move(1);else if(k==='ArrowUp')move(-1);
    else if(k==='ArrowRight'){if(r&&r.it.submenu)openSub(p,r,true)}
    else if(k==='Enter'||k===' '){if(r)activate(p,r,true)}
    else if(k==='ArrowLeft'){if(panels.length<2)return;trim(panels.length-1)}
    else if(k==='Escape'){panels.length>1?trim(panels.length-1):close()}
    else return;
    e.preventDefault();e.stopImmediatePropagation();
  };
  const down=e=>{if(!panels.some(p=>p.el.contains(e.target)))close()};
  const ctx=e=>{if(panels.some(p=>p.el.contains(e.target)))e.preventDefault()};
  doc.addEventListener('keydown',key,true);doc.addEventListener('pointerdown',down,true);doc.addEventListener('contextmenu',ctx,true);
  addEventListener('blur',close);addEventListener('resize',close);addEventListener('scroll',close,true);
  function close(){
    if(closed)return;closed=true;trim(0);
    doc.removeEventListener('keydown',key,true);doc.removeEventListener('pointerdown',down,true);doc.removeEventListener('contextmenu',ctx,true);
    removeEventListener('blur',close);removeEventListener('resize',close);removeEventListener('scroll',close,true);
    if(live===ctl)live=null;onClose&&onClose();
  }
  const ctl=live={close};
  build(items,(w,h,vw,vh)=>placeMenu(x,y,w,h,vw,vh));
  return ctl;
}
