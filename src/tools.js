/* Tool registry. A tool is a creation gesture: {id, label, cursor?, begin(t, p0, ev)}.
   begin() runs on pointerdown and returns {move(p, ev), end(p, ev) -> element|null, cancel?()}.
   `p`/`p0` are points in the creation container's coordinates; end() returns the finished element (it is then
   recorded as one undo step) or null to discard everything the gesture made.
   `t` = {host, px(n) (screen px -> host units), make(tag, attrs) (creates an element with the default shape
   attributes, inserted in the host)}. The pointer tool is not registered here: it is the absence of a tool. */
export const Tools={list:[],
  register(def){const i=this.list.findIndex(d=>d.id===def.id);i<0?this.list.push(def):this.list[i]=def},
  get(id){return this.list.find(d=>d.id===id)}};
