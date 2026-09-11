import { mountMeasurement } from './measurement-ui.mjs';
import { mountConsultation } from './consultation-ui.mjs';


const KAKAO_JS_KEY = '2a481551ff472bd2e85db08ac077e093'; // 카카오 개발자 콘솔 > 앱 키 > JavaScript 키
const SEARCH_RADIUS = 5000; // m
const CARE_KEYWORDS = ['내과','종합병원'];
const CARE_CATEGORY = /^(내과|가정의학과|종합병원|상급종합병원|병원|응급실)$/;
const DEMO_ORIGIN = {lat:37.5665, lng:126.9780}; // 서울시청
const DEMO_HOSPITALS = [
  {name:'서울적십자병원', cat:'종합병원', lat:37.5673, lng:126.9679},
  {name:'강북삼성병원', cat:'종합병원', lat:37.5688, lng:126.9686},
  {name:'세브란스병원', cat:'상급종합병원', lat:37.5623, lng:126.9410},
  {name:'서울대학교병원', cat:'상급종합병원', lat:37.5799, lng:127.0021},
  {name:'순천향대학교 서울병원', cat:'종합병원', lat:37.5378, lng:126.9884}
];

const pages = document.querySelectorAll('.page');
const navItems = document.querySelectorAll('.nav-item');
const measurementUI = mountMeasurement({
  onReset: () => {
    consultation.reset();
    document.getElementById('hospitalPanel').hidden=true;
    document.getElementById('medicalNotice').hidden=true;
    document.getElementById('scoreLabel').textContent='문진 전';
    document.getElementById('resultTitle').textContent='문진을 완료해 주세요.';
    document.getElementById('resultDesc').textContent='문진 응답에 따른 생활 관리 안내입니다.';
  },
  onContinue: () => { showPage('questionnaire'); consultation.start(); }
});
const consultation=mountConsultation({getResult:()=>measurementUI.result,onComplete:()=>showPage('result')});

function showPage(id){
  if(id==='result' && !consultation.done){toast('측정과 문진을 먼저 완료해 주세요.');return;}
  if(id!=='questionnaire' && !consultation.done)consultation.reset();
  if(id!=='measure')measurementUI.leave();
  pages.forEach(p => p.classList.toggle('active', p.id === id));
  navItems.forEach(n => n.classList.toggle('active', n.dataset.page === id));
  window.scrollTo({top:0, behavior:'smooth'});
}
navItems.forEach(btn => btn.addEventListener('click', () => showPage(btn.dataset.page)));
document.getElementById('startHero').onclick = () => showPage('measure');

function toast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2400);
}

document.getElementById('restartBtn').onclick=()=>{measurementUI.reset();showPage('measure');};

function haversine(lat1,lng1,lat2,lng2){
  const R=6371000, rad=d=>d*Math.PI/180;
  const dLat=rad(lat2-lat1), dLng=rad(lng2-lng1);
  const a=Math.sin(dLat/2)**2+Math.cos(rad(lat1))*Math.cos(rad(lat2))*Math.sin(dLng/2)**2;
  return Math.round(2*R*Math.asin(Math.sqrt(a)));
}
function formatDistance(m){ return m<1000 ? `${m}m` : `${(m/1000).toFixed(1)}km`; }
function formatDuration(sec){
  const min=Math.max(1,Math.round(sec/60));
  return min<60 ? `${min}분` : `${Math.floor(min/60)}시간 ${min%60}분`;
}
// ponytail: 직선거리 × 우회계수 1.3. 프록시가 살아있으면 실제 duration이 이 값을 덮어씀
function estimateMinutes(m){
  const road=m*1.3;
  return {walk:Math.max(1,Math.round(road/75)), drive:Math.max(1,Math.round(road/333))};
}

function getPosition(){
  return new Promise(resolve=>{
    if(!navigator.geolocation) return resolve({...DEMO_ORIGIN, demo:true});
    navigator.geolocation.getCurrentPosition(
      p=>resolve({lat:p.coords.latitude, lng:p.coords.longitude, demo:false}),
      ()=>resolve({...DEMO_ORIGIN, demo:true}),
      {timeout:8000, maximumAge:60000}
    );
  });
}

let kakaoPromise=null;
function loadKakao(){
  if(!kakaoPromise){
    kakaoPromise=new Promise((resolve,reject)=>{
      if(!KAKAO_JS_KEY) return reject(new Error('KAKAO_JS_KEY 미설정'));
      const s=document.createElement('script');
      s.src=`https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_JS_KEY}&libraries=services&autoload=false`;
      s.onload=()=>window.kakao.maps.load(()=>resolve(window.kakao));
      s.onerror=()=>reject(new Error('카카오 SDK 로드 실패'));
      document.head.appendChild(s);
    }).catch(e=>{ kakaoPromise=null; throw e; });
  }
  return kakaoPromise;
}

function keywordSearch(kakao,origin,keyword){
  return new Promise(resolve=>{
    new kakao.maps.services.Places().keywordSearch(keyword,(data,status)=>{
      resolve(status===kakao.maps.services.Status.OK ? data : []);
    },{
      location:new kakao.maps.LatLng(origin.lat,origin.lng),
      radius:SEARCH_RADIUS,
      sort:kakao.maps.services.SortBy.DISTANCE
    });
  });
}

// HP8 카테고리 검색은 도심에서 결과 절반이 치과·피부과라 문진 맥락에 맞지 않는다.
// 내과/종합병원으로 찾고 진료과로 한 번 더 거른다("구강내과치과" 같은 부분일치 제거).
async function searchHospitals(kakao,origin){
  const found=await Promise.all(CARE_KEYWORDS.map(k=>keywordSearch(kakao,origin,k)));
  const seen=new Set(), out=[];
  found.flat().forEach(p=>{
    const leaf=(p.category_name||'').split('>').pop().trim();
    if(p.category_group_code!=='HP8' || !CARE_CATEGORY.test(leaf) || seen.has(p.id)) return;
    seen.add(p.id);
    out.push({name:p.place_name, cat:leaf, lat:Number(p.y), lng:Number(p.x), phone:p.phone, url:p.place_url});
  });
  if(!out.length) throw new Error('주변 진료 가능한 병원 없음');
  return out;
}

async function fetchDurations(origin,list){
  const res=await fetch('/api/directions',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
      origin:{x:origin.lng, y:origin.lat},
      destinations:list.map((h,i)=>({key:String(i), x:h.lng, y:h.lat}))
    })
  });
  if(!res.ok) throw new Error('길찾기 사용 불가');
  const json=await res.json();
  const out={};
  (json.routes||[]).forEach(r=>{
    const sec=r.summary?.duration ?? r.duration;
    if(r.result_code===0 && Number.isFinite(sec)) out[r.key]=sec;
  });
  return out;
}

function renderMap(kakao,origin,places){
  const center=new kakao.maps.LatLng(origin.lat,origin.lng);
  const map=new kakao.maps.Map(document.getElementById('hospitalMap'),{center,level:5});
  const bounds=new kakao.maps.LatLngBounds();
  bounds.extend(center);
  new kakao.maps.Marker({map,position:center,title:'내 위치'});
  places.forEach(p=>{
    const pos=new kakao.maps.LatLng(p.lat,p.lng);
    bounds.extend(pos);
    new kakao.maps.Marker({map,position:pos,title:p.name});
  });
  map.setBounds(bounds);
}

function tag(cls,text){
  const s=document.createElement('span'); s.className='tag '+cls; s.textContent=text; return s;
}
function linkTo(href,text,blank){
  const a=document.createElement('a'); a.href=href; a.textContent=text;
  if(blank){ a.target='_blank'; a.rel='noopener'; }
  return a;
}

function renderHospitals(places,durations,origin,live){
  const badge=document.getElementById('hospitalBadge');
  badge.textContent=live?'카카오맵 검색':'데모 데이터';
  badge.className='data-badge'+(live?' live':'');
  document.getElementById('hospitalMeta').textContent=
    (origin.demo?'데모 위치(서울시청) 기준':'내 위치 기준')+` · 가까운 순 ${places.length}곳`;

  const listEl=document.getElementById('hospitalList');
  listEl.innerHTML='';
  places.forEach((p,i)=>{
    const sec=durations[String(i)];
    const est=estimateMinutes(p.distance);

    const rank=document.createElement('span');
    rank.className='rank'; rank.textContent=i+1;

    const name=document.createElement('b'); name.textContent=p.name;
    const cat=document.createElement('span'); cat.className='cat'; cat.textContent=p.cat||'병원';
    const meta=document.createElement('div'); meta.className='hospital-meta';
    meta.append(
      tag('dist',formatDistance(p.distance)),
      tag('time',sec?`차량 ${formatDuration(sec)}`:`차량 약 ${est.drive}분`),
      tag('walk',`도보 약 ${est.walk}분`)
    );
    const info=document.createElement('div');
    info.append(name,cat,meta);

    const links=document.createElement('div'); links.className='hospital-links';
    if(p.phone) links.append(linkTo(`tel:${p.phone}`,'전화',false));
    if(p.url && /^https?:\/\//.test(p.url)) links.append(linkTo(p.url,'상세',true));

    const row=document.createElement('div'); row.className='hospital-row';
    row.append(rank,info,links);
    listEl.append(row);
  });
}

let hospitalsLoaded=false;
document.getElementById('hospitalBtn').onclick=async ()=>{
  const panel=document.getElementById('hospitalPanel');
  panel.hidden=false;
  panel.scrollIntoView({behavior:'smooth',block:'nearest'});
  if(hospitalsLoaded) return;
  hospitalsLoaded=true;

  const listEl=document.getElementById('hospitalList');
  listEl.innerHTML='<div class="hospital-empty">주변 병원을 찾는 중…</div>';

  const origin=await getPosition();
  let places, kakao=null, live=true;
  try{
    kakao=await loadKakao();
    places=await searchHospitals(kakao,origin);
  }catch(e){
    live=false;
    places=DEMO_HOSPITALS.map(h=>({...h}));
    document.getElementById('hospitalMap').innerHTML=
      '<div class="hospital-empty">카카오 개발자 콘솔에 사이트 도메인(http://localhost:5500)을 등록하면 실제 지도와 주변 병원이 표시됩니다.</div>';
  }

  places.forEach(p=>{ p.distance=haversine(origin.lat,origin.lng,p.lat,p.lng); });
  places.sort((a,b)=>a.distance-b.distance);
  places=places.slice(0,5);
  if(live) renderMap(kakao,origin,places);

  let durations={};
  try{ durations=await fetchDurations(origin,places); }catch(e){}

  renderHospitals(places,durations,origin,live);
};



const hc=document.getElementById('historyCanvas'), hctx=hc.getContext('2d');
function drawHistory(){
  const vals=[68,72,70,75,69,76,72], w=hc.width,h=hc.height,p=45;
  hctx.clearRect(0,0,w,h);
  hctx.strokeStyle='#e7edf5';hctx.lineWidth=1;
  for(let i=0;i<5;i++){let y=p+i*(h-2*p)/4;hctx.beginPath();hctx.moveTo(p,y);hctx.lineTo(w-p,y);hctx.stroke();}
  hctx.strokeStyle='#2878ff';hctx.lineWidth=4;hctx.beginPath();
  vals.forEach((v,i)=>{
    const x=p+i*(w-2*p)/(vals.length-1);
    const y=h-p-(v-60)/25*(h-2*p);
    if(i===0)hctx.moveTo(x,y); else hctx.lineTo(x,y);
    hctx.fillStyle='#fff';hctx.beginPath();hctx.arc(x,y,6,0,Math.PI*2);hctx.fill();hctx.strokeStyle='#2878ff';hctx.stroke();
  });
  hctx.stroke();
}
drawHistory();
