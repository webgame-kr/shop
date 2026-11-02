// 납부액 곡선 검증: 여러 시드에서 봇으로 끝까지 돌려 생존 일수 분포를 본다.
//   node scripts/simulate.js [판 수] [casual|greedy]
import { canPlace, cellsOf, shapeOf, ITEMS } from '../js/rules.js';
import * as G from '../js/game.js';

const runs = Number(process.argv[2] ?? 200);
const only = process.argv[3] ?? null;
// 곡선 실험: PAY=a,b,c 로 납부액 계수를 바꿔 본다
if (process.env.PAY) [G.PAY.a, G.PAY.b, G.PAY.c] = process.env.PAY.split(',').map(Number);
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

// greedy용 후보 자리: 모양이 같은 회전은 한 번만, 이미 놓인 상품과 맞닿는 자리만 본다(효과는 거의 인접에서 나온다).
// 맞닿는 자리가 없으면 처음 찾은 자리 하나.
function nearSpots(s, id, g) {
  const occ = new Set(s.pieces.flatMap((p) => cellsOf(p).map(([x, y]) => `${x},${y}`)));
  const seen = new Set();
  const out = [];
  let first = null;
  const sealed = G.sealedNow(s);
  for (let rot = 0; rot < 4; rot++) {
    const key = JSON.stringify(shapeOf(id, rot));
    if (seen.has(key)) continue;
    seen.add(key);
    for (let y = 0; y < s.dim.rows; y++)
      for (let x = 0; x < s.dim.cols; x++) {
        const p = { uid: -1, id, g, x, y, rot };
        if (!canPlace(s.dim, s.pieces, p, undefined, sealed)) continue;
        first ??= p;
        if (cellsOf(p).some(([cx, cy]) => occ.has(`${cx + 1},${cy}`) || occ.has(`${cx - 1},${cy}`) || occ.has(`${cx},${cy + 1}`) || occ.has(`${cx},${cy - 1}`))) out.push(p);
      }
  }
  return out.length ? out : first ? [first] : [];
}

// 아무 후보나 골라 처음 빈 곳에 놓는다. 합성·잔금·계약은 쓰지 않는다.
function casual(s, rand) {
  if (s.phase === 'pick') {
    G.choose(s, Math.floor(rand() * s.offers.length));
    const sp = spots(s, s.hand.id, s.hand.g)[0];
    if (sp) G.placeHand(s, sp.x, sp.y, sp.rot); else G.skip(s);
  }
}

// 오늘 매출이 가장 크게 오르는 후보·위치를 고른다. 자리가 부족하면 합성하고, 잔금으로 지정 발주·등급 올리기·추가 입고.
function greedy(s) {
  if (s.phase === 'reward') {
    const pref = ['life', 'order', 'upgrade', 'perma_', 'grade', 'cash', 'priority'];
    const k = pref.map((r) => s.rewardOffer.find((o) => o.startsWith(r))).find(Boolean);
    G.takeReward(s, k, k === 'priority' ? s.pieces[0].id : null);
    return;
  }
  if (s.contractOffer) G.refuseContracts(s);
  // 빈칸이 적으면 합성
  for (const p of s.pieces.slice()) {
    const free = s.dim.cols * s.dim.rows - s.pieces.reduce((a, q) => a + ITEMS[q.id].cells.length, 0);
    if (free < 4 && s.pieces.includes(p) && G.mergePlan(s, p.uid)) G.merge(s, p.uid);
  }
  if (s.phase === 'pick') {
    let best = null;
    s.offers.forEach(({ id }, i) => {
      for (const sp of nearSpots(s, id, s.offerGrade)) {
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
  // 지정 발주: Ⅰ등급 두 개인 상품을 주문해 손에 든 채 합성(잔금 30은 남김)
  if (s.phase === 'arrange') {
    const cost = G.orderCost(s);
    const want = G.orderables(s).find((id) => !ITEMS[id].egg && s.pieces.filter((p) => p.id === id && p.g === 1).length === 2 && !G.orderBlocked(s, id));
    if (want && s.balance >= cost + 30 && G.order(s, want)) {
      G.merge(s, 'hand');
      const sp = spots(s, s.hand.id, s.hand.g)[0];
      if (sp) G.placeHand(s, sp.x, sp.y, sp.rot); else G.skip(s);
      return;
    }
  }
  // 매출이 가장 많이 오르는 상품의 등급을 올린다(잔금 20은 남김)
  if (s.phase === 'arrange') {
    const base = G.income(s).sum.total;
    let best = null;
    for (const p of s.pieces) {
      const cost = G.upgradeCost(s, p);
      if (cost === null || cost > s.balance - 20) continue;
      const gain = G.income(s, s.pieces.map((q) => (q === p ? { ...q, g: q.g + 1 } : q))).sum.total - base;
      if (gain > 0 && (!best || gain / (cost + 1) > best.r)) best = { p, r: gain / (cost + 1) };
    }
    if (best && G.upgrade(s, best.p.uid)) return;
  }
  if (s.phase === 'arrange' && s.balance >= G.extraCost(s) + 25) { G.buyExtra(s); return; }
}

const CATS6 = ['alch', 'gear', 'magic', 'food', 'treasure', 'beast'];
// 기획서 9장 지표: 첫 불꽃 손실, 잔금, 빈칸, 합성·발주·새로고침, 결산 보상 선택, 최대 확장 뒤 생존
function play(seed, bot) {
  const s = G.newGame(seed, CATS6[seed % 6]);
  const m = { firstLoss: null, balance: [], empty: [], rewards: {}, rerolls: 0 };
  const take = G.takeReward;
  let r = seed ^ 0x5bd1e995;
  const rand = () => ((r = (Math.imul(r, 1664525) + 1013904223) | 0) >>> 0) / 4294967296;
  let guard = 0;
  while (s.phase !== 'over' && s.day <= MAX_DAY && guard++ < 20000) {
    if (s.contractOffer) G.refuseContracts(s);
    if (s.pendingMutation) G.chooseMutation(s, 'A');
    if (s.regularOffer) { if (s.regulars.length < 2) G.acceptRegular(s); else G.refuseRegular(s); }
    if (s.phase === 'mainpick') { G.settleMain(s, G.mainRewardOptions(s).slice(-1)[0] ?? null, null); continue; }
    if (s.phase === 'arrange' && (bot === casual || s.balance < G.extraCost(s) + 25)) {
      if (bot === greedy) { const before = s.balance; greedy(s); if (s.balance !== before) continue; }
      const occ = s.pieces.reduce((a, q) => a + ITEMS[q.id].cells.length, 0);
      m.empty.push(s.dim.cols * s.dim.rows - occ);
      const r = G.openShop(s);
      m.balance.push(s.balance);
      if (r && !r.ok && m.firstLoss === null) m.firstLoss = r.day;
      continue;
    }
    if (s.phase === 'reward') {
      const before = s.rewardOffer.slice();
      if (bot === casual) { const k = before.find((x) => x !== 'priority') ?? 'priority'; take(s, k, s.pieces[0]?.id); }
      else bot(s, rand);
      continue;
    }
    if (s.phase === 'place') { G.skip(s); continue; }
    bot(s, rand);
  }
  s.metrics = m;
  return s;
}

for (const [name, bot] of [['casual', casual], ['greedy', greedy]].filter(([n]) => !only || n === only)) {
  const t0 = Date.now();
  const games = [];
  for (let i = 1; i <= runs; i++) games.push(play(i * 7919, bot));
  const days = games.map((g) => g.day).sort((a, b) => a - b);
  const q = (f) => days[Math.floor(f * (days.length - 1))];
  const med = (xs) => { const a = xs.filter((x) => x !== null).sort((x, y) => x - y); return a.length ? a[Math.floor((a.length - 1) / 2)] : '-'; };
  const avg = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);
  console.log(`[${name}] ${runs}판 생존 일수  최소 ${q(0)} / 하위10% ${q(0.1)} / 중앙 ${q(0.5)} / 상위10% ${q(0.9)} / 최대 ${q(1)} · ${((Date.now() - t0) / 1000).toFixed(1)}초`);
  const rewards = {};
  for (const g of games) for (const h of g.rewardLog ?? []) rewards[h] = (rewards[h] ?? 0) + 1;
  console.log(`  첫 불꽃 손실(중앙) ${med(games.map((g) => g.metrics.firstLoss))}일 · 영업 뒤 잔금 평균 ${avg(games.flatMap((g) => g.metrics.balance))} · 영업 때 빈칸 평균 ${avg(games.flatMap((g) => g.metrics.empty))}`);
  console.log(`  판당 합성 ${avg(games.map((g) => g.mergeCount))} · 지정 발주 ${avg(games.map((g) => g.orders ?? 0))} · 등급 올리기 ${avg(games.map((g) => g.upgrades ?? 0))} · 최대 확장(31일) 뒤 생존 ${games.filter((g) => g.day > 31).length}판, 평균 ${avg(games.filter((g) => g.day > 31).map((g) => g.day - 31))}일`);
  console.log(`  결산 보상 선택 ${Object.entries(rewards).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ') || '없음'}`);
}
const curve = [1, 2, 3, 5, 10, 15, 20, 25, 30, 40].map((d) => `${d}일 ${G.basePay(d)}`).join(' · ');
console.log(`납부액: ${curve}`);
