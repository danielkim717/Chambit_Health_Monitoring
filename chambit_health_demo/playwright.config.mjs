// 파일 역할: 브라우저 검사 실행 설정
// 연결과 사용: Playwright의 검사 대상과 웹 실행 환경을 정의합니다.
// 파일 안내: docs/FILE_GUIDE.md
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./tests/browser',timeout:45000,fullyParallel:false,workers:1,
  use:{baseURL:'http://127.0.0.1:5501',headless:true,viewport:{width:1440,height:1000},
    launchOptions:{args:['--use-fake-device-for-media-stream']},permissions:['camera']},
  projects:[{name:'chrome',use:{channel:'chrome'}},{name:'edge',use:{channel:'msedge'}}],
  webServer:{command:'node dev.mjs',url:'http://127.0.0.1:5501/api/health',env:{PORT:'5501',INFERENCE_PORT:'8001',INFERENCE_URL:'http://127.0.0.1:8001'},reuseExistingServer:false,timeout:60000},
});
