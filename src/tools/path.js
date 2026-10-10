import {Tools} from '../tools.js';
/* path pen: a tool that lives across many presses, so it has no begin(). `pen:true` hands its presses to the selected path's edit widget instead
   (src/widgets/path.js, pen mode; attach.js decides continue-or-start): press = a node, drag = pull its handles. `tag` = the element it draws, `blank` = its attributes before the first node;
   `real(el)` = does it have anything to show yet (a lone M does not, and is thrown away when the pen leaves it). */
Tools.register({id:'path',label:'Path',cursor:'crosshair',pen:true,tag:'path',blank:{d:'M0 0'},real:el=>((el.getAttribute('d')||'').match(/[A-Za-z]/g)||[]).length>=2});
