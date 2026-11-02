// 한 판의 진행: 후보 제시, 선택·배치·폐기·넘기기, 되돌리기, 영업 정산. 상태는 JSON 하나로 저장된다.
import { DAYS, ITEMS, ITEM_IDS, canPlace, evaluate, gradeOf } from './rules.js';

const FIRST_OFFER = ['apple', 'bread', 'milk'];

// 기본 상품은 자주, 특수 상품은 덜 자주.
export const WEIGHTS = {
  apple: 10, bread: 9, milk: 9, sneakers: 8, boots: 8, perfume: 7,
  fish: 7, plant: 6, sign: 6, fridge: 5, jewel: 4, safe: 4,
};
const RARE = ['fridge', 'jewel', 'safe'];
// 짝이 없는 상품을 갖고 있으면 짝이 조금 더 잘 나온다.
const PARTNERS = {
  jewel: ['safe'], safe: ['jewel'], bread: ['milk'], milk: ['bread', 'fridge'],
  boots: ['perfume'], perfume: ['boots'], fish: ['fridge'], apple: ['fridge'],
};
const UNDO_LIMIT = 60;

function nextRandom(state) {
  // mulberry32, 상태는 저장되는 정수 하나
  let t = (state.rng = (state.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function newGame(seed = (Math.random() * 2 ** 32) >>> 0) {
  const s = {
    v: 1, seed, rng: seed | 0,
    day: 1, pick: 0, phase: 'pick',
    offers: FIRST_OFFER.slice(), hand: null,
    pieces: [], nextUid: 1,
    total: 0, history: [], earned: {},
    drought: Object.fromEntries(RARE.map((r) => [r, 0])),
    seen: Object.fromEntries(ITEM_IDS.map((id) => [id, 0])),
    undo: [], last: null,
  };
  FIRST_OFFER.forEach((id) => s.seen[id]++);
  return s;
}

export function offerWeights(s) {
  const w = { ...WEIGHTS };
  for (const r of RARE) if (s.drought[r] >= 3) w[r] *= 1 + (s.drought[r] - 2);
  const owned = new Set(s.pieces.map((p) => p.id));
  for (const id of owned) {
    for (const partner of PARTNERS[id] ?? []) if (!owned.has(partner)) w[partner] *= 1.6;
  }
  return w;
}

function drawOffers(s) {
  const w = offerWeights(s);
  const pool = ITEM_IDS.slice();
  const picked = [];
  while (picked.length < 3) {
    const sum = pool.reduce((a, id) => a + w[id], 0);
    let r = nextRandom(s) * sum;
    let i = 0;
    while (r >= w[pool[i]] && i < pool.length - 1) r -= w[pool[i++]];
    picked.push(pool.splice(i, 1)[0]);
  }
  for (const r of RARE) s.drought[r] = picked.includes(r) ? 0 : s.drought[r] + 1;
  picked.forEach((id) => s.seen[id]++);
  return picked;
}

function snapshot(s) {
  const { undo, ...rest } = s;
  s.undo = [...undo, JSON.stringify(rest)].slice(-UNDO_LIMIT);
}

export function canUndo(s) {
  return s.undo.length > 0 && s.phase !== 'over';
}

export function undo(s) {
  if (!canUndo(s)) return false;
  const stack = s.undo.slice(0, -1);
  Object.assign(s, JSON.parse(s.undo[s.undo.length - 1]), { undo: stack });
  return true;
}

function afterPick(s) {
  s.pick++;
  s.hand = null;
  if (s.pick < 2) {
    s.offers = drawOffers(s);
    s.phase = 'pick';
  } else {
    s.offers = null;
    s.phase = 'arrange';
  }
}

export function choose(s, index) {
  if (s.phase !== 'pick' || !s.offers?.[index]) return false;
  snapshot(s);
  s.hand = { id: s.offers[index], rot: 0 };
  s.offers = null;
  s.phase = 'place';
  return true;
}

// 고른 상품을 받지 않거나, 후보를 보고 아무것도 받지 않는다.
export function skip(s) {
  if (s.phase !== 'pick' && s.phase !== 'place') return false;
  snapshot(s);
  afterPick(s);
  return true;
}

export function placeHand(s, x, y, rot) {
  if (s.phase !== 'place' || !s.hand) return false;
  const piece = { uid: s.nextUid, id: s.hand.id, x, y, rot: ((rot % 4) + 4) % 4 };
  if (!canPlace(s.pieces, piece)) return false;
  snapshot(s);
  s.pieces.push(piece);
  s.nextUid++;
  afterPick(s);
  return true;
}

export function movePiece(s, uid, x, y, rot) {
  if (s.phase === 'over') return false;
  const p = s.pieces.find((q) => q.uid === uid);
  if (!p) return false;
  const moved = { ...p, x, y, rot: ((rot % 4) + 4) % 4 };
  if (moved.x === p.x && moved.y === p.y && moved.rot === p.rot) return false;
  if (!canPlace(s.pieces, moved, uid)) return false;
  snapshot(s);
  Object.assign(p, moved);
  return true;
}

export function discard(s, uid) {
  if (s.phase === 'over' || !s.pieces.some((p) => p.uid === uid)) return false;
  snapshot(s);
  s.pieces = s.pieces.filter((p) => p.uid !== uid);
  return true;
}

export function canOpen(s) {
  return s.phase === 'arrange';
}

// 영업 시작: 오늘 수익을 한 번만 더하고 다음 날로 넘어간다.
export function openShop(s) {
  if (!canOpen(s)) return null;
  const ev = evaluate(s.pieces);
  const perItem = {};
  let income = 0;
  for (const p of s.pieces) {
    const v = ev.get(p.uid).total;
    perItem[p.uid] = v;
    income += v;
    s.earned[p.uid] = (s.earned[p.uid] ?? 0) + v;
  }
  s.total += income;
  s.history.push({ day: s.day, income });
  s.last = { day: s.day, income, perItem };
  s.undo = [];
  s.day++;
  s.pick = 0;
  if (s.day > DAYS) {
    s.phase = 'over';
    s.offers = null;
  } else {
    s.offers = drawOffers(s);
    s.phase = 'pick';
  }
  return s.last;
}

// 결과 화면용: 마지막 진열대에 남은 상품 중 8일 동안 가장 많이 번 것
export function summary(s) {
  let top = null;
  for (const p of s.pieces) {
    const e = s.earned[p.uid] ?? 0;
    if (!top || e > top.earned) top = { id: p.id, name: ITEMS[p.id].name, earned: e };
  }
  return { total: s.total, grade: gradeOf(s.total), top };
}
