/* Widget registry. First registered match wins, so register specific widgets before catch-alls. opts.generic marks a catch-all with no editor of its own (that shape gets no edit mode). */
export const Widgets={list:[],register(match,factory,opts){this.list.push({match,factory,...opts})},
  find(el){return this.list.find(w=>w.match(el))}};
