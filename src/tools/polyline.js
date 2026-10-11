import {Tools} from '../tools.js';
import {polyCount} from '../pen-math.js';
/* polyline pen: see path.js. It continues from the end its selected vertex is on (from the first vertex it adds in front); two vertices make a shape. */
Tools.register({id:'polyline',label:'Polyline',cursor:'crosshair',pen:true,tag:'polyline',blank:{points:'0,0'},real:el=>polyCount(el.getAttribute('points'))>=2});
