import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const {createServer}=createRequire(import.meta.url)('../server.js');
const http=createRequire(import.meta.url)('node:http');
test('local pinned model and runtime assets match their manifest',async()=>{
  const root=new URL('../',import.meta.url);
  const manifest=JSON.parse(await readFile(new URL('assets/manifest.json',root),'utf8'));
  assert.equal(manifest.version,'0.10.32');
  for(const [file,hash] of Object.entries(manifest.checksums))assert.equal(createHash('sha256').update(await readFile(new URL(file,root))).digest('hex'),hash,file);
});
test('local API proxy preserves server results and rejects cross-origin posts',async()=>{
  const upstream=http.createServer((req,res)=>{
    let body='';req.on('data',c=>body+=c);req.on('end',()=>{
      res.writeHead(200,{'Content-Type':'application/json'});
      res.end(JSON.stringify({path:req.url,body:body?JSON.parse(body):null}));
    });
  });
  await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
  const server=createServer({inferenceUrl:'http://127.0.0.1:'+upstream.address().port});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+server.address().port;
  try{
    const health=await fetch(base+'/api/health');assert.equal(health.status,200);
    assert.equal((await health.json()).path,'/api/health');
    const ok=await fetch(base+'/api/consultation/start',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({resultId:'a'.repeat(32)})});
    assert.equal((await ok.json()).body.resultId,'a'.repeat(32));
    assert.equal((await fetch(base+'/api/consultation/start',{method:'POST',headers:{Origin:'https://untrusted.example'},body:'{}'})).status,403);
  }finally{
    await new Promise(r=>server.close(r));await new Promise(r=>upstream.close(r));
  }
});
test('serves only public application/model assets with correct MIME',async()=>{
  const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  try {
    for(const [file,type] of [['/','text/html'],['/frame-pump.mjs','text/javascript'],['/measurement-timeline.mjs','text/javascript'],['/measurement-worker.mjs','text/javascript'],['/assets/mediapipe/vision_bundle.mjs','text/javascript'],['/assets/mediapipe/wasm/vision_wasm_internal.wasm','application/wasm'],['/assets/face_landmarker.task','application/octet-stream']]) {
      const r=await fetch(base+file);assert.equal(r.status,200,file);assert.ok(r.headers.get('content-type').startsWith(type));await r.arrayBuffer();
    }
    for(const file of ['/.env','/server.js','/package.json','/tests/server.test.mjs','/node_modules/@mediapipe/tasks-vision/vision_bundle.mjs','/assets/%2e%2e%2f.env','/assets/%5c..%5c.env'])assert.equal((await fetch(base+file)).status,403,file);
    assert.equal((await fetch(base+'/%zz')).status,400);
    assert.equal((await fetch(base+'/api/video',{method:'POST',body:'no upload'})).status,405);
  } finally {await new Promise(resolve=>server.close(resolve));}
});
