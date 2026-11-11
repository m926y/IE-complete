import {BrandMark} from './brand';
import {useEffect,useRef,type ReactNode} from 'react';
import './login-home.css';
export function LoginHome({children}:{children:ReactNode}){
 return <main className="login-home"><a className="login-skip" href="#login-form">跳到登录</a><header className="lh-header"><a className="lh-brand" href="#login-form" aria-label="易流智安驾驶安全管理"><BrandMark/><span>易流智安<small>驾驶安全管理</small></span></a><div className="lh-header-right"><span>安全评价</span><span>风险监控</span><span>培训改善</span><a href="#login-form">进入工作台 <span aria-hidden="true">↗</span></a></div></header><div className="lh-stage"><section className="lh-hero" aria-labelledby="lh-title"><div className="lh-hero-copy"><h1 id="lh-title" className="lh-art-title" aria-label="道路千万条，安全第一条。">{Array.from("道路千万条安全第一条").map((character,index)=><span key={index} aria-hidden="true" className={`lh-art-char lh-art-char-${index}`} style={{animationDelay:`${.15+index*.12}s`}}>{character}</span>)}</h1></div><div className="lh-illustration" aria-hidden="true"><RoadScene/></div></section><section className="lh-login-column" aria-label="工作台登录">{children}<div className="lh-role-note"><span>管理员</span><i/><span>安全员</span><i/><span>司机</span></div></section></div></main>
}
function RoadScene(){
 const truck=useRef<SVGGElement>(null);
 const road=useRef<SVGPathElement>(null);
 const speed=useRef<SVGGElement>(null),risk=useRef<SVGGElement>(null);
 useEffect(()=>{
  const vehicle=truck.current,path=road.current;
  if(!vehicle||!path)return;
  const length=path.getTotalLength(),preference=window.matchMedia('(prefers-reduced-motion: reduce)');
  let frame=0,start=performance.now();
  const place=(progress:number)=>{
   const distance=progress*length,point=path.getPointAtLength(distance),next=path.getPointAtLength(Math.min(length,distance+1));
   const angle=Math.atan2(next.y-point.y,next.x-point.x)*180/Math.PI;
   vehicle.setAttribute('transform',`translate(${point.x} ${point.y}) rotate(${angle})`);
   speed.current?.setAttribute('opacity',progress>.28&&progress<.44?'1':'0');
   risk.current?.setAttribute('opacity',progress>.46&&progress<.65?'1':'0');
  };
  const tick=(now:number)=>{place(preference.matches?.48:((now-start)/14000+.25)%1);if(!preference.matches)frame=requestAnimationFrame(tick);};
  const restart=()=>{cancelAnimationFrame(frame);start=performance.now();tick(start);};
  restart();preference.addEventListener('change',restart);
  return()=>{cancelAnimationFrame(frame);preference.removeEventListener('change',restart);};
 },[]);
 const route='M-270 290 C80 290 180 290 350 250 S620 240 1170 290';
 return <svg viewBox="0 0 900 440" fill="none" xmlns="http://www.w3.org/2000/svg"><defs>
 <linearGradient id="lh-road" x1="0" y1="250" x2="900" y2="250" gradientUnits="userSpaceOnUse"><stop stopColor="#c5addd"/><stop offset=".5" stopColor="#a27dc3"/><stop offset="1" stopColor="#b69bd0"/></linearGradient>
 <linearGradient id="lh-roof" x1="-130" y1="-40" x2="-130" y2="40" gradientUnits="userSpaceOnUse"><stop stopColor="#fff"/><stop offset=".48" stopColor="#faf8fd"/><stop offset="1" stopColor="#d7c6e7"/></linearGradient>
 <linearGradient id="lh-cab" x1="50" y1="-34" x2="50" y2="34" gradientUnits="userSpaceOnUse"><stop stopColor="#d9c8e9"/><stop offset=".45" stopColor="#f4edf9"/><stop offset="1" stopColor="#b99cd1"/></linearGradient>
 <radialGradient id="lh-radar"><stop stopColor="#45c7b3" stopOpacity=".48"/><stop offset="1" stopColor="#45c7b3" stopOpacity="0"/></radialGradient>
 <filter id="lh-shadow" x="-30%" y="-50%" width="170%" height="220%"><feDropShadow dx="0" dy="8" stdDeviation="6" floodColor="#5a3975" floodOpacity=".2"/></filter>
 <pattern id="lh-grid" width="48" height="48" patternUnits="userSpaceOnUse"><path d="M48 0H0V48" stroke="#d9c9e8" strokeOpacity=".25"/></pattern>
 </defs>
 <path d="M0 95H900V425H0Z" fill="url(#lh-grid)"/>
 <path ref={road} d={route} stroke="#e6dbee" strokeWidth="148"/>
 <path d={route} stroke="url(#lh-road)" strokeWidth="128"/>
 <path d={route} stroke="#f8f2fc" strokeWidth="2" strokeDasharray="20 20"/>
 <path d={route} stroke="#f9f5fc" strokeWidth="2" transform="translate(0 -55)"/>
 <path d={route} stroke="#f9f5fc" strokeWidth="2" transform="translate(0 55)"/>
 <g opacity=".8">
 {[95,195,650,810].map((x,i)=><g key={x} transform={`translate(${x} ${i%2?390:145})`}><ellipse cy="13" rx="21" ry="8" fill="#cfc1dd" fillOpacity=".3"/><circle r="18" fill="#cbb8df"/><circle cx="-6" cy="-6" r="12" fill="#e6dbef"/><circle cx="7" cy="3" r="10" fill="#b9a0cf"/></g>)}
 <g transform="translate(510 126)"><rect x="-4" y="-24" width="8" height="46" rx="4" fill="#d8cbe3"/><rect x="-12" y="-27" width="50" height="7" rx="3.5" fill="#b6a2c9"/><rect x="28" y="-25" width="13" height="6" rx="2" fill="#fff5d6"/></g>
 <g transform="translate(330 380)"><path d="M0 0V-30M36 0V-30" stroke="#baa9ca" strokeWidth="3"/><rect x="-9" y="-51" width="54" height="28" rx="5" fill="#b49bce"/><path d="M2-37H32M24-43L32-37L24-31" stroke="#fcf9ff" strokeWidth="2.5"/></g>
 {[60,270,470,740,870].map(x=><g key={x} transform={`translate(${x} ${x<300?367:340})`}><rect width="5" height="13" rx="2" fill="#e7deef"/><rect y="2" width="5" height="4" fill="#b4a0c6"/></g>)}
 </g>
 <g ref={truck} className="lh-moving-truck" transform="translate(90 290)">
 {[{name:'front',transform:'translate(98 0)'},{name:'rear',transform:'translate(-155 0) rotate(180)'}].map(side=><g key={side.name} className="lh-radar-field" transform={side.transform}>
 <path d="M0 0L165-100A193 193 0 0 1 165 100Z" fill="url(#lh-radar)"/>
 <path className="lh-radar-band" d="M80-46A92 92 0 0 1 80 46L121 70A140 140 0 0 0 121-70Z" fill="#4ccab5" fillOpacity=".14"/>
 <path className="lh-radar-band lh-radar-band-outer" d="M127-74A148 148 0 0 1 127 74L167 97A193 193 0 0 0 167-97Z" fill="#73d8cb" fillOpacity=".18"/>
 <path d="M178-103A206 206 0 0 1 178 103" stroke="#4ba99c" strokeOpacity=".3" strokeWidth="1"/>
 <path className="lh-radar-side" d="M0 0L45 95L-25 105Z" fill="#79bfe4" fillOpacity=".2"/>
 {[0,1,2].map(i=><path key={i} className="lh-radar-push" style={{animationDelay:`${-i*.9}s`}} d="M159-92A184 184 0 0 1 159 92" stroke="#39a997" strokeWidth="2"/>)}
 <path className="lh-radar-sweep" d="M0 0L177-76A193 193 0 0 1 193 0Z" fill="#58d6bd" fillOpacity=".38"/>
 </g>)}
 <g filter="url(#lh-shadow)">
 <rect x="-134" y="-45" width="24" height="12" rx="4" fill="#584760"/><rect x="-102" y="-45" width="24" height="12" rx="4" fill="#584760"/><rect x="-134" y="33" width="24" height="12" rx="4" fill="#584760"/><rect x="-102" y="33" width="24" height="12" rx="4" fill="#584760"/>
 <rect x="-153" y="-38" width="179" height="76" rx="6" fill="url(#lh-roof)" stroke="#bca4d0" strokeWidth="1.5"/>
 <path d="M-144-31V31M-137-31V31M-130-31V31M-123-31V31M-116-31V31M-109-31V31M-102-31V31M-95-31V31M-88-31V31M-81-31V31M-74-31V31M-67-31V31M-60-31V31M-53-31V31M-46-31V31M-39-31V31M-32-31V31M-25-31V31M-18-31V31M-11-31V31M-4-31V31M3-31V31M10-31V31M17-31V31" stroke="#bda4d0" strokeOpacity=".2"/>
 <path d="M-149-32V32M22-32V32" stroke="#c0abcF" strokeWidth="3"/>
 <rect x="-143" y="-34" width="156" height="4" rx="2" fill="#fff" fillOpacity=".8"/>
 <path d="M-148-23H-140M-148 23H-140" stroke="#d8a39f" strokeWidth="3"/>
 <path d="M-148-29V29" stroke="#a590b7" strokeWidth="1.5"/>
 <g transform="translate(-10 0)"><path d="M26-19H49V19H26" fill="#7d668c"/><rect x="60" y="-40" width="22" height="12" rx="4" fill="#584760"/><rect x="60" y="28" width="22" height="12" rx="4" fill="#584760"/>
 <path d="M43-32H89Q105-32 108-18V18Q105 32 89 32H43Z" fill="url(#lh-cab)" stroke="#a98aba" strokeWidth="1.5"/>
 <path d="M83-27Q94-27 97-19V19Q94 27 83 27L77 21V-21Z" fill="#645675"/>
 <path d="M45-27H72V27H45Z" fill="#eae0f3"/><rect x="50" y="-15" width="17" height="30" rx="4" fill="#d3c0e3" stroke="#b99aca"/><path d="M85-20L91-16M85 20L91 16" stroke="#a8b6c8" strokeWidth="1.5"/><path d="M48-23H69M48 23H69" stroke="#c5acd7" strokeWidth="2"/>
 <path d="M99-18H106M99 18H106" stroke="#fff8d9" strokeWidth="5" strokeLinecap="round"/><path d="M108-11V11" stroke="#b59bc7" strokeWidth="3"/>
 <path d="M80-32V-44H87M80 32V44H87" stroke="#8e759d" strokeWidth="3" strokeLinecap="round"/>
 </g><path d="M-153-27V-16M-153 16V27" stroke="#d6a7ba" strokeWidth="3"/>
 </g>
 <g ref={speed} className="lh-driving-label" opacity="0" transform="translate(-45 -105)">
 <rect x="-38" y="-24" width="120" height="52" rx="10" fill="#fff" stroke="#d8d2e7"/>
 <text x="-24" y="-5" fill="#9a8ba9" fontSize="10">当前车速</text><text x="-24" y="17" fill="#568b9d" fontSize="20" fontWeight="600">62<tspan fontSize="10" dx="5">km/h</tspan></text>
 </g>
 <g ref={risk} className="lh-driving-label" opacity="0" transform="translate(120 -122)">
 <rect x="-12" y="-22" width="150" height="62" rx="10" fill="#fff" stroke="#ead5d1"/>
 <text x="2" y="-1" fill="#a58d98" fontSize="10">车距过近</text><text x="2" y="25" fill="#d79452" fontSize="23" fontWeight="600">18<tspan fontSize="12" dx="3">m</tspan></text>
 <path d="M106-5L125 28H87Z" fill="#d97b83"/><text x="106" y="22" textAnchor="middle" fill="#fff" fontSize="22" fontWeight="600">!</text>
 </g>
 </g></svg>
}
