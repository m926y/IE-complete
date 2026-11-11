import './brand.css';
export function BrandMark(){return <img className="yiliu-brand-mark" src="/brand/yiliu-mark.svg" alt="" aria-hidden="true"/>}
export function Brand({driver=false}:{driver?:boolean}){return <a className={driver?'yiliu-brand yiliu-brand-driver':'yiliu-brand'} href={driver?'#':'#/overview'} aria-label="易流智安"><BrandMark/><span>易流智安<small>智能驾驶安全平台</small></span></a>}
