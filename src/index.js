/* Public API. Widget import order matters: the registry returns the first match,
   so specific widgets come first and the bounding-box fallback goes last. */
import './widgets/path.js';
import './widgets/shapes.js';
import './widgets/poly.js';
import './widgets/fallback.js';
export {attach} from './attach.js';
export {Widgets as widgets} from './registry.js';
