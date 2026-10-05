/* Widget registry. First registered match wins, so register specific widgets before catch-alls. */
export const Widgets={list:[],register(match,factory){this.list.push({match,factory})},
  find(el){return this.list.find(w=>w.match(el))}};
