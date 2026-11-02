// 텍스트로 한 판을 진행하는 테스트 버전. 화면 없이 명령 하나씩 실행하고, 상태는 JSON 파일에 남긴다.
// Claude 같은 에이전트가 직접 플레이하며 규칙·밸런스·버그를 확인하는 용도. 본 게임 저장과는 따로다.
// 같은 내용을 브라우저에서는 play.html로 쓸 수 있다(핵심은 js/textplay.js).
//
//   node scripts/play.js help
//   node scripts/play.js new [시드] [시작분야]      예: new 42 food
//   node scripts/play.js pick 1 && node scripts/play.js place 0 0
//
// 상태 파일은 기본 .play-state.json(현재 폴더). PLAY_STATE 환경변수로 바꿀 수 있다.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { run } from '../js/textplay.js';

const FILE = resolve(process.env.PLAY_STATE ?? '.play-state.json');
const state = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : null;
const r = run(state, process.argv.slice(2).join(' '));
if (r.ok && r.state) {
  const { undo = [], ...rest } = r.state;
  writeFileSync(FILE, JSON.stringify({ ...rest, undo: undo.slice(-10) }));
}
console.log(r.text);
if (!r.ok) process.exit(1);
