/* Helpers for the element's own `transform` attribute. fmtTransform is pure (Node-testable). */
/* The attribute as a DOMMatrix, read from the SVG transform list (does not modify it). */
export const ownM=el=>{
  let m=new DOMMatrix();const l=el.transform&&el.transform.baseVal;
  if(l)for(let i=0;i<l.numberOfItems;i++){const t=l.getItem(i).matrix;m=m.multiply(new DOMMatrix([t.a,t.b,t.c,t.d,t.e,t.f]))}
  return m;
};
/* matrix {a..f} -> the most readable transform string, or null for identity (attribute can be removed) */
export function fmtTransform({a,b,c,d,e,f}){
  const near=(x,y)=>Math.abs(x-y)<1e-7,r=v=>+v.toFixed(6),q=v=>+v.toFixed(3);
  const tr=Math.abs(e)>1e-9||Math.abs(f)>1e-9?`translate(${q(e)} ${q(f)})`:'';
  let rest='';
  if(near(b,0)&&near(c,0)){if(!(near(a,1)&&near(d,1)))rest=`scale(${r(a)}${near(a,d)?'':' '+r(d)})`}
  else if(near(a,d)&&near(b,-c)&&near(a*a+b*b,1))rest=`rotate(${+(Math.atan2(b,a)*180/Math.PI).toFixed(4)})`;
  else return `matrix(${[a,b,c,d].map(r).join(' ')} ${q(e)} ${q(f)})`;
  return [tr,rest].filter(Boolean).join(' ')||null;
}
