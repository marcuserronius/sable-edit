import {Tools} from '../tools.js';
import {polyCount} from '../pen-math.js';
/* polygon pen: see path.js. A polygon has no ends, so the pen continues from any selected vertex by adding the new one right after it; it is
   a shape once it has three vertices (fewer are thrown away when the pen leaves). */
Tools.register({id:'polygon',label:'Polygon',cursor:'crosshair',pen:true,tag:'polygon',blank:{points:'0,0'},real:el=>polyCount(el.getAttribute('points'))>=3});
