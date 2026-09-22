// 라이브러리에 넣은 이미지에 태그 초안을 단다. LLM 은 부르지 않는다.
//   public/lib/ 에 파일을 넣고 → npm run tag-assets → assets/library.json 을 손으로 다듬는다.
// Kenney 같은 팩은 파일명이 설명적이라 (slime_green.png) 대부분 이걸로 충분하다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { normalizeTags } from '../src/effects.js';

export function tagsFromFilename(file) {
  return normalizeTags(path.parse(file).name.split(/[_\-\d\s]+/));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const jsonPath = path.join(root, 'assets', 'library.json');
  const list = fs.existsSync(jsonPath) ? JSON.parse(fs.readFileSync(jsonPath, 'utf8')) : [];
  const known = new Set(list.map((e) => e.file));
  const added = fs.readdirSync(path.join(root, 'public', 'lib'))
    .filter((f) => /\.(png|jpe?g|webp)$/i.test(f) && !known.has(f))
    .map((file) => ({ file, tags: tagsFromFilename(file) }));
  fs.writeFileSync(jsonPath, JSON.stringify([...list, ...added], null, 2) + '\n');
  console.log(`${added.length}개 추가. assets/library.json 의 태그를 확인하세요.`);
  for (const e of added) console.log(`  ${e.file}  →  ${e.tags.join(', ')}`);
}
