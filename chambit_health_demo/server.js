// 파일 역할: 웹 파일 제공과 로컬 API 중계
// 연결과 사용: 정적 화면, 같은 출처 요청, WebSocket과 Python 서버 연결, 선택형 지도 요청을 처리합니다.
// 파일 안내: docs/FILE_GUIDE.md
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const net = require('net');

const PORT = Number(process.env.PORT || 5500);
const ROOT = __dirname;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream'
};
const PUBLIC_FILES = new Set([
  'index.html', 'style.css', 'script.js', 'measurement-config.mjs',
  'measurement-session.mjs', 'measurement-controller.mjs', 'measurement-ui.mjs',
  'measurement-worker.js', 'measurement-worker.mjs', 'signal-analysis.mjs',
  'consultation-ui.mjs', 'measurement-timeline.mjs', 'frame-pump.mjs',
  'assets/face_landmarker.task', 'assets/mediapipe/vision_bundle.mjs',
  'assets/mediapipe/wasm/vision_wasm_internal.js',
  'assets/mediapipe/wasm/vision_wasm_internal.wasm',
  'assets/mediapipe/wasm/vision_wasm_nosimd_internal.js',
  'assets/mediapipe/wasm/vision_wasm_nosimd_internal.wasm'
]);

function sendJson(res, code, obj){
  res.writeHead(code, {'Content-Type':'application/json; charset=utf-8'});
  res.end(JSON.stringify(obj));
}

function serveStatic(req, res){
  let urlPath;
  try { urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { res.writeHead(400); res.end('Bad request'); return; }
  const relative = urlPath === '/' ? 'index.html' : urlPath.slice(1);
  const file = path.resolve(ROOT, relative);
  if(!PUBLIC_FILES.has(relative) || !file.startsWith(ROOT + path.sep)){
    res.writeHead(403); res.end('Forbidden'); return;
  }
  const type = MIME[path.extname(file).toLowerCase()];
  if(!type){ res.writeHead(404); res.end('Not found'); return; }
  fs.readFile(file, (err, buf) => {
    if(err){ res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, {'Content-Type': type});
    res.end(buf);
  });
}

function coord(o){
  if(!o) return null;
  const x = Number(o.x), y = Number(o.y);
  return Number.isFinite(x) && Number.isFinite(y) ? {x, y} : null;
}

// 다중 목적지(/v1/destinations)는 제휴 계약이 필요한 엔드포인트라 일반 REST 키로는 -404가 난다.
// 목적지가 5개 수준이므로 단일 길찾기를 병렬로 던져 합친다.
function routeOne(key, origin, dest){
  return new Promise(resolve => {
    const q = `origin=${origin.x},${origin.y}&destination=${dest.x},${dest.y}`;
    https.get({
      host: 'apis-navi.kakaomobility.com',
      path: `/v1/directions?${q}`,
      headers: {'Authorization': `KakaoAK ${key}`}
    }, r => {
      let data = '';
      r.on('data', c => data += c);
      r.on('end', () => {
        try{
          const route = JSON.parse(data).routes?.[0];
          if(route?.result_code === 0){
            return resolve({key: dest.key, result_code: 0, summary: {
              distance: route.summary.distance,
              duration: route.summary.duration
            }});
          }
        }catch{ /* 아래 실패 응답으로 떨어짐 */ }
        resolve({key: dest.key, result_code: -1});
      });
    }).on('error', () => resolve({key: dest.key, result_code: -1}));
  });
}

function proxyDirections(req, res){
  const key = process.env.KAKAO_REST_KEY;
  if(!key) return sendJson(res, 503, {code:'NO_KEY'});

  let body = '';
  req.on('data', c => {
    body += c;
    if(body.length > 100000) req.destroy();
  });
  req.on('end', async () => {
    let payload;
    try{ payload = JSON.parse(body); }catch{ return sendJson(res, 400, {code:'BAD_JSON'}); }

    const origin = coord(payload.origin);
    const destinations = (Array.isArray(payload.destinations) ? payload.destinations : [])
      .slice(0, 10)
      .map(d => { const c = coord(d); return c && d.key != null ? {...c, key: String(d.key)} : null; })
      .filter(Boolean);
    if(!origin || !destinations.length) return sendJson(res, 400, {code:'BAD_COORDS'});

    const routes = await Promise.all(destinations.map(d => routeOne(key, origin, d)));
    sendJson(res, 200, {routes});
  });
}

const INFERENCE_ROUTES = new Set(['/api/health', '/api/measurement/demo',
  '/api/consultation/start', '/api/consultation/answer']);
function trustedOrigin(req) {
  // Reject cross-origin web pages trying to reach a local camera/LLM service.
  if(!req.headers.origin)return true;
  try{return new URL(req.headers.origin).host === req.headers.host;}catch{return false;}
}
function proxyInference(req,res,target){
  if(!trustedOrigin(req))return sendJson(res,403,{detail:'다른 출처의 요청은 허용하지 않습니다.'});
  let size=0;
  const upstream=http.request({hostname:target.hostname,port:target.port,path:req.url,
    method:req.method,headers:{'Content-Type':'application/json'},timeout:20000},r=>{
    res.writeHead(r.statusCode,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
    r.pipe(res);
  });
  upstream.on('timeout',()=>upstream.destroy(new Error('timeout')));
  upstream.on('error',()=>{if(!res.headersSent)sendJson(res,503,{detail:'로컬 추론 서버에 연결할 수 없습니다. 시작 명령과 서버 상태를 확인하세요.'});else res.destroy();});
  req.on('data',chunk=>{size+=chunk.length;if(size>16384){upstream.destroy();req.destroy();}});
  req.on('aborted',()=>upstream.destroy());
  req.pipe(upstream);
}
function createServer(options={}){
 const target=new URL(options.inferenceUrl || process.env.INFERENCE_URL || 'http://127.0.0.1:8000');
 if(target.protocol!=='http:' || !['localhost','127.0.0.1','[::1]'].includes(target.hostname))
   throw new Error('INFERENCE_URL must address a local HTTP service');
 const tunnels=new Set();
 const server=http.createServer((req, res) => {
  if(INFERENCE_ROUTES.has(req.url) && ((req.url==='/api/health' && req.method==='GET') ||
      (req.url!=='/api/health' && req.method==='POST')))return proxyInference(req,res,target);
  if(req.method === 'POST' && req.url === '/api/directions') return proxyDirections(req, res);
  if(req.method === 'GET') return serveStatic(req, res);
  res.writeHead(405); res.end();
 });
 server.on('upgrade',(req,socket,head)=>{
   if(req.url!=='/api/measurement' || !trustedOrigin(req) ||
      req.headers.upgrade?.toLowerCase()!=='websocket'){
     socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;
   }
   const upstream=net.connect({host:target.hostname,port:Number(target.port||80)});
   tunnels.add(socket);tunnels.add(upstream);
   upstream.setTimeout(160000,()=>upstream.destroy());
   upstream.on('connect',()=>{
     const headers=['GET /api/measurement HTTP/1.1', 'Host: '+target.host];
     for(const [key,value] of Object.entries(req.headers))
       if(['upgrade','connection','sec-websocket-key','sec-websocket-version','sec-websocket-protocol'].includes(key))
         headers.push(key+': '+value);
     upstream.write(headers.join('\r\n')+'\r\n\r\n');
     if(head.length)upstream.write(head);
     socket.pipe(upstream);upstream.pipe(socket);
   });
   upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());
   upstream.on('close',()=>{tunnels.delete(upstream);socket.destroy();});
   socket.on('close',()=>{tunnels.delete(socket);upstream.destroy();});
 });
 server.closeTunnels=()=>{for(const socket of tunnels)socket.destroy();};
 return server;
}
module.exports = { createServer };
if (require.main === module) createServer().listen(PORT, '127.0.0.1', () => {
  console.log(`참빛설계 데모: http://localhost:${PORT}`);
  if(!process.env.KAKAO_REST_KEY) console.log('KAKAO_REST_KEY 미설정 - 소요시간은 추정치로 표시됩니다.');
});
