// 납부액 곡선 검증: 여러 시드에서 봇으로 끝까지 돌려 생존 일수 분포를 본다.
//   node scripts/simulate.js [판 수]
import { canPlace, ITEMS } from '../js/rules.js';
import * as G from '../js/game.js';

const runs = Number(process.argv[2] ?? 200);
const MAX_DAY = 80;

function spots(s, id, g) {
  const out = [];
  const sealed = G.sealedNow(s);
  for (let rot = 0; rot < 4; rot++)
    for (let y = 0; y < s.dim.rows; y++)
      for (let x = 0; x < s.dim.cols; x++) {
        const p = { uid: -1, id, g, x, y, rot };
        if (canPlace(s.dim, s.pieces, p, undefined, sealed)) out.push(p);
      }
  return out;
}

// 아무 후보나 골라 처음 빈 곳에 놓는다. 합성·잔금·계약은 쓰지 않는다.
function casual(s, rand) {
  if (s.phase === 'pick') {
    G.choose(s, Math.floor(rand() * s.offers.length));
    const sp = spots(s, s.hand.id, s.hand.g)[0];
    if (sp) G.placeHand(s, sp.x, sp.y, sp.rot); else G.skip(s);
  }
}

// 오늘 매출이 가장 크게 오르는 후보·위치를 고른다. 자리가 부족하면 합성하고, 잔금으로 확장·추가 입고.
function greedy(s) {
  if (s.phase === 'reward') {
    const pref = ['expand', 'life', 'perma_gear', 'perma_magic', 'perma_alch', 'cash', 'grade', 'priority'];
    const k = pref.find((r) => s.rewardOffer.includes(r));
    G.takeReward(s, k, k === 'priority' ? s.pieces[0].id : null);
    return;
  }
  if (s.contractOffer) G.refuseContracts(s);
  if (G.expandCost(s) !== null && s.balance >= G.expandCost(s) + 10) G.buyExpand(s);
  // 빈칸이 적으면 합성
  for (const p of s.pieces.slice()) {
    const free = s.dim.cols * s.dim.rows - s.pieces.reduce((a, q) => a + ITEMS[q.id].cells.length, 0);
    if (free < 4 && s.pieces.includes(p) && G.mergePlan(s, p.uid)) G.merge(s, p.uid);
  }
  if (s.phase === 'pick') {
    let best = null;
    s.offers.forEach(({ id }, i) => {
      for (const sp of spots(s, id, s.offerGrade)) {
        const v = G.income(s, [...s.pieces, sp]).sum.total;
        if (!best || v > best.v) best = { v, i, sp };
      }
    });
    if (!best) {
      // 합성 재료가 되면 받아서 합성
      const i = s.offers.findIndex(({ id }) => s.pieces.filter((p) => p.id === id && p.g === s.offerGrade).length >= 2);
      if (i >= 0) { G.choose(s, i); G.merge(s, 'hand'); const sp = spots(s, s.hand.id, s.hand.g)[0]; if (sp) G.placeHand(s, sp.x, sp.y, sp.rot); else G.skip(s); }
      else G.skip(s);
      return;
    }
    G.choose(s, best.i);
    G.placeHand(s, best.sp.x, best.sp.y, best.sp.rot);
    return;
  }
  if (s.phase === 'arrange' && s.balance >= G.extraCost(s) + 25) { G.buyExtra(s); return; }
}

const CATS6 = ['alch', 'gear', 'magic', 'food', 'treasure', 'beast'];
function play(seed, bot) {
  const s = G.newGame(seed, CATS6[seed % 6]);
  let r = seed ^ 0x5bd1e995;
  const rand = () => ((r = (Math.imul(r, 1664525) + 1013904223) | 0) >>> 0) / 4294967296;
  let guard = 0;
  while (s.phase !== 'over' && s.day <= MAX_DAY && guard++ < 20000) {
    if (s.contractOffer) G.refuseContracts(s);
    if (s.pendingMutation) G.chooseMutation(s, 'A');
    if (s.regularOffer) { if (s.regulars.length < 2) G.acceptRegular(s); else G.refuseRegular(s); }
    if (s.phase === 'mainpick') { G.settleMain(s, G.mainRewardOptions(s).slice(-1)[0] ?? null, null); continue; }
    if (s.phase === 'arrange' && (bot === casual || s.balance < G.extraCost(s) + 25)) { G.openShop(s); continue; }
    if (s.phase === 'reward' && bot === casual) { const k = s.rewardOffer.find((r) => r !== 'priority') ?? 'priority'; G.takeReward(s, k, s.pieces[0]?.id); continue; }
    if (s.phase === 'place') { G.skip(s); continue; }
    bot(s, rand);
  }
  return s;
}

for (const [name, bot] of [['casual', casual], ['greedy', greedy]]) {
  const days = [];
  for (let i = 1; i <= runs; i++) days.push(play(i * 7919, bot).day);
  days.sort((a, b) => a - b);
  const q = (f) => days[Math.floor(f * (days.length - 1))];
  console.log(`[${name}] ${runs}판 생존 일수  최소 ${q(0)} / 하위10% ${q(0.1)} / 중앙 ${q(0.5)} / 상위10% ${q(0.9)} / 최대 ${q(1)}`);
}
const curve = [1, 2, 3, 5, 10, 15, 20, 25, 30, 40].map((d) => `${d}일 ${G.basePay(d)}`).join(' · ');
console.log(`납부액: ${curve}`);
