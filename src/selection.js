/* A selection of nodes or segments in one shape (pure, no DOM). It holds one kind at a time: a plain pick replaces it, a
   shift-pick toggles within the same kind, and picking the other kind starts over. */
export function selection(){
  let kind=null;const set=new Set();
  const api={
    get kind(){return kind},get size(){return set.size},get items(){return [...set].sort((a,b)=>a-b)},
    has:(k,i)=>kind===k&&set.has(i),
    only:(k,i)=>kind===k&&set.size===1&&set.has(i),
    pick(k,i,add=false){
      if(kind!==k||!add){kind=k;set.clear();set.add(i);return}
      set.has(i)?set.delete(i):set.add(i);if(!set.size)kind=null;
    },
    /* a press: picks now when the item isn't selected yet, and returns what a release without a drag should do. Pressing an
       item that is already selected leaves the selection alone, so the whole selection can be dragged; a click on it
       collapses to it (or, with shift, drops it). */
    press(k,i,add){if(!api.has(k,i)){api.pick(k,i,add);return ()=>{}}return ()=>api.pick(k,i,add)},
    clear(){kind=null;set.clear()},
    keep(k,ok){if(kind!==k)return;for(const i of [...set])if(!ok(i))set.delete(i);if(!set.size)kind=null},
  };
  return api;
}
