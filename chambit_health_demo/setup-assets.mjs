// 파일 역할: MediaPipe 실행 자산 준비
// 연결과 사용: 브라우저에서 사용할 모델과 런타임 파일을 준비합니다. 자산 출처는 assets/NOTICE.md에 있습니다.
// 파일 안내: docs/FILE_GUIDE.md
import { mkdir, readFile, writeFile, copyFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const source = path.join(root, 'node_modules/@mediapipe/tasks-vision');
const destination = path.join(root, 'assets/mediapipe');
const version = JSON.parse(await readFile(path.join(source, 'package.json'), 'utf8')).version;
if (version !== '0.10.32') throw new Error('Expected @mediapipe/tasks-vision 0.10.32');
await mkdir(path.join(destination, 'wasm'), { recursive: true });
const files = ['vision_bundle.mjs'];
for (const file of await readdir(path.join(source, 'wasm'))) if (/\.(js|wasm)$/.test(file)) files.push(`wasm/${file}`);
for (const file of files) await copyFile(path.join(source, file), path.join(destination, file));
const modelUrl = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const response = await fetch(modelUrl, { signal: AbortSignal.timeout(120000) });
if (!response.ok) throw new Error(`Model download failed: ${response.status}`);
const model = Buffer.from(await response.arrayBuffer());
const modelHash = createHash('sha256').update(model).digest('hex');
if (modelHash !== '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff') throw new Error('Face model v1 checksum mismatch');
await writeFile(path.join(root, 'assets/face_landmarker.task'), model);
const assets = [...files.map(f => `assets/mediapipe/${f}`), 'assets/face_landmarker.task'];
const checksums = {};
for (const file of assets) checksums[file] = createHash('sha256').update(await readFile(path.join(root, file))).digest('hex');
await writeFile(path.join(root, 'assets/manifest.json'), JSON.stringify({ version, modelUrl, checksums }, null, 2) + '\n');
console.log(`Local MediaPipe ${version} assets installed (${assets.length} files).`);
