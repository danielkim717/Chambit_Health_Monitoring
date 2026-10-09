// 파일 역할: 웹 서버와 추론 서버 동시 시작
// 연결과 사용: npm start의 진입점입니다. Node 웹 서버와 로컬 Python 추론 서버를 실행하고 함께 종료합니다.
// 파일 안내: docs/FILE_GUIDE.md
// One command starts both loopback services and terminates both on exit.
import { spawn, execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const app=path.dirname(fileURLToPath(import.meta.url)), root=path.dirname(app);
const local=path.join(root,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
const python=process.env.PYTHON || (existsSync(local)?local:'python');
const inferencePort=process.env.INFERENCE_PORT || '8000';
process.env.INFERENCE_URL ||= 'http://127.0.0.1:'+inferencePort;
const children=[
  spawn(python,['-m','uvicorn','inference.app:app','--host','127.0.0.1','--port',inferencePort,'--ws-max-size','60000','--ws-max-queue','8'],{cwd:root,stdio:'inherit',windowsHide:true}),
  spawn(process.execPath,['--env-file-if-exists=.env','server.js'],{cwd:app,stdio:'inherit',windowsHide:true})
];
let stopped=false;
function stop(code=0){
  if(stopped)return;
  stopped=true;process.exitCode=code;
  for(const child of children){
    // The Windows venv launcher starts a child Python process. Stop our own trees.
    if(process.platform==='win32' && child.pid)
      execFile('taskkill',['/pid',String(child.pid),'/T','/F'],{windowsHide:true},()=>{});
    else child.kill();
  }
}
for(const child of children){child.on('error',error=>{console.error(error.message);stop(1);});child.on('exit',code=>stop(code || 0));}
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
