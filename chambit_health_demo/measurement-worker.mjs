import { FaceLandmarker, FilesetResolver } from './assets/mediapipe/vision_bundle.mjs';
import { CONFIG } from './measurement-config.mjs';

let detector, surface, context, previousFace=null;
const crop=new OffscreenCanvas(128,128), cropContext=crop.getContext('2d',{willReadFrequently:true});
// Interior forehead and cheek polygons, excluding eyelids and lips.
const regions = [[109,10,338,337,151,108],[50,101,205,206,216,212],[280,330,425,426,436,432]];
function contains(x,y,poly) {
  let inside=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++) {
    const a=poly[i],b=poly[j];
    if((a.y>y)!==(b.y>y) && x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)inside=!inside;
  }
  return inside;
}
function extract(bitmap,t) {
  const w=320,h=Math.round(bitmap.height/bitmap.width*w);
  if(!surface || surface.height!==h){surface=new OffscreenCanvas(w,h);context=surface.getContext('2d',{willReadFrequently:true});}
  context.drawImage(bitmap,0,0,w,h);
  const faces=detector.detectForVideo(surface,t).faceLandmarks;
  if(faces.length!==1){previousFace=null;return {t,reason:faces.length?'한 사람만 화면에 들어와 주세요.':'얼굴을 정면으로 맞춰 주세요.',polygons:[]};}
  const face=faces[0],center=face[1],width=Math.abs(face[454].x-face[234].x);
  const polygons=regions.map(ids=>ids.map(i=>({x:face[i].x,y:face[i].y})));
  const prev=previousFace;previousFace={x:center.x,y:center.y,width,t};
  if(width<0.2 || width>0.75 || polygons.flat().some(p=>p.x<0.02||p.x>0.98||p.y<0.02||p.y>0.98))return {t,polygons,reason:'얼굴 전체가 보이도록 거리를 조절해 주세요.'};
  const symmetry=Math.abs((center.x-face[234].x)-(face[454].x-center.x))/width;
  if(symmetry>0.4)return {t,polygons,reason:'고개를 돌리지 말고 카메라를 정면으로 바라봐 주세요.'};
  if(prev && t-prev.t<CONFIG.maxGapMs && (Math.hypot(center.x-prev.x,center.y-prev.y)/width>0.035 || Math.abs(width-prev.width)/width>0.04))return {t,polygons,reason:'움직임이 큽니다. 얼굴을 고정해 주세요.'};
  const {data}=context.getImageData(0,0,w,h), colors=[], exposureFractions=[];
  for(const poly of polygons) {
    const points=poly.map(p=>({x:p.x*w,y:p.y*h}));
    const x0=Math.max(0,Math.floor(Math.min(...points.map(p=>p.x)))),x1=Math.min(w-1,Math.ceil(Math.max(...points.map(p=>p.x))));
    const y0=Math.max(0,Math.floor(Math.min(...points.map(p=>p.y)))),y1=Math.min(h-1,Math.ceil(Math.max(...points.map(p=>p.y))));
    let n=0,accepted=0,r=0,g=0,b=0;
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++) {
      if(!contains(x+0.5,y+0.5,points))continue;
      n++;const i=(y*w+x)*4,rr=data[i],gg=data[i+1],bb=data[i+2];
      const luma=0.2126*rr+0.7152*gg+0.0722*bb;
      if(luma<30 || luma>220 || Math.max(rr,gg,bb)>=250)continue;
      accepted++;r+=rr;g+=gg;b+=bb;
    }
    if(accepted<30 || accepted/Math.max(1,n)<0.75)return {t,polygons,reason:'빛이 너무 어둡거나 강합니다. 얼굴에 고르게 빛을 비춰 주세요.'};
    colors.push([r/accepted,g/accepted,b/accepted]);
    exposureFractions.push(accepted/n);
  }
  // Preserve a full face crop for learned models, separately from skin RGB means.
  const xs=face.map(p=>p.x*w),ys=face.map(p=>p.y*h);
  const box=Math.max(Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys))*1.5;
  const cx=(Math.min(...xs)+Math.max(...xs))/2,cy=(Math.min(...ys)+Math.max(...ys))/2;
  const side=Math.min(box,w,h),x=Math.max(0,Math.min(w-side,cx-side/2)),y=Math.max(0,Math.min(h-side,cy-side/2));
  cropContext.drawImage(surface,x,y,side,side,0,0,128,128);
  const rgba=cropContext.getImageData(0,0,128,128).data, pixels=new Uint8Array(128*128*3);
  for(let i=0,j=0;i<rgba.length;i+=4){pixels[j++]=rgba[i];pixels[j++]=rgba[i+1];pixels[j++]=rgba[i+2];}
  const rgb=[0,1,2].map(c=>colors.reduce((sum,rgb)=>sum+rgb[c],0)/colors.length);
  return {t,polygons,rgb,pixels,scene:{brightness:rgb.reduce((a,b)=>a+b,0)/3,
    motion:prev?Math.hypot(center.x-prev.x,center.y-prev.y)/width:0,
    exposure:exposureFractions.reduce((a,b)=>a+b,0)/exposureFractions.length}};
}
self.onmessage=async ({data})=>{
  try {
    if(data.type==='init') {
      const files=await FilesetResolver.forVisionTasks(CONFIG.wasmPath);
      detector=await FaceLandmarker.createFromOptions(files,{
        baseOptions:{modelAssetPath:CONFIG.modelPath,delegate:'CPU'},runningMode:'VIDEO',numFaces:2,
        minFaceDetectionConfidence:0.7,minFacePresenceConfidence:0.7,minTrackingConfidence:0.7,
        outputFaceBlendshapes:false,outputFacialTransformationMatrixes:false,
      });
      postMessage({type:'ready'});
    } else if(data.type==='start') {
      previousFace=null;
    } else if(data.type==='frame') {
      try {
        const started=performance.now(),sample=extract(data.bitmap,data.t);
        postMessage({type:'sample',...sample,extractionMs:performance.now()-started},sample.pixels?[sample.pixels.buffer]:[]);
      } finally {data.bitmap.close();postMessage({type:'frameDone'});}
    }
  } catch(error) {postMessage({type:'error',message:error.message || String(error)});}
};
