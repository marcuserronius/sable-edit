export const NS='http://www.w3.org/2000/svg';
export const mk=(n,a={})=>{const e=document.createElementNS(NS,n);for(const k in a)e.setAttribute(k,a[k]);return e};
