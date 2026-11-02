// 목표 매출 검증: 여러 시드에서 단순한 봇들로 8일을 돌려 최종 매출 분포를 본다.
//   node scripts/simulate.js [판 수]
import { COLS, ROWS, canPlace, dailyIncome, gradeOf, GRADES } from '../js/rules.js';
import * as G from '../js/game.js';

const runs = Number(process.argv[2] ?? 400);

function spots(pieces, id) {
  const out = [];
  for (let rot = 0; rot < 4; rot++)
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++) {
        const p = { uid: -1, id, x, y, rot };
        if (canPlace(pieces, p)) out.push(p);
      }
  return out;
}

// 아무 후보나 골라 처음 빈 곳에 놓는 사람
function casual(s, rand) {
  const i = Math.floor(rand() * 3);
  G.choose(s, i);
  const sp = spots(s.pieces, s.hand.id)[0];
  if (sp) G.placeHand(s, sp.x, sp.y, sp.rot); else G.skip(s);
}

// 지금 당장 수익이 가장 크게 늘어나는 후보와 위치를 고르고, 자리가 없으면 가장 약한 상품을 버려 본다
function greedy(s) {
  let best = null;
  const tryAll = (pieces, dropUid) => {
    s.offers.forEach((id, i) => {
      for (const sp of spots(pieces, id)) {
        const v = dailyIncome([...pieces, sp]) + (8 - s.day) * 0; // 하루 기준
        if (!best || v > best.v) best = { v, i, sp, dropUid };
      }
    });
  };
  tryAll(s.pieces, null);
  const now = dailyIncome(s.pieces);
  for (const p of s.pieces) tryAll(s.pieces.filter((q) => q.uid !== p.uid), p.uid);
  if (!best || best.v <= now) { G.skip(s); return; }
  if (best.dropUid) G.discard(s, best.dropUid);
  G.choose(s, best.i);
  G.placeHand(s, best.sp.x, best.sp.y, best.sp.rot);
}

function play(seed, bot) {
  const s = G.newGame(seed);
  let r = seed ^ 0x9e3779b9;
  const rand = () => ((r = (Math.imul(r, 1664525) + 1013904223) | 0) >>> 0) / 4294967296;
  while (s.phase !== 'over') {
    if (s.phase === 'pick') bot(s, rand);
    else if (s.phase === 'arrange') G.openShop(s);
  }
  return s;
}

for (const [name, bot] of [['casual', casual], ['greedy', greedy]]) {
  const totals = [];
  const counts = Object.fromEntries(GRADES.map((g) => [g.name, 0]));
  for (let i = 1; i <= runs; i++) {
    const s = play(i * 7919, bot);
    totals.push(s.total);
    counts[gradeOf(s.total).name]++;
  }
  totals.sort((a, b) => a - b);
  const q = (f) => totals[Math.floor(f * (totals.length - 1))];
  console.log(`\n[${name}] ${runs}판  최소 ${q(0)} / 하위10% ${q(0.1)} / 중앙 ${q(0.5)} / 상위10% ${q(0.9)} / 최대 ${q(1)}`);
  for (const g of GRADES) console.log(`  ${g.name.padEnd(14)} ${((counts[g.name] / runs) * 100).toFixed(1)}%`);
}
