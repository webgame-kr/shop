// 한 판의 진행: 영업 예고 → 입고(3개 중 1개, 하루 2번) → 정리·합성·계약 → 영업 → 납부 판정 → 결산 보상.
// 상태는 JSON 하나로 저장된다. 무작위는 시드와 난수 상태를 함께 저장해 새로고침해도 같다.
import {
  ITEMS, ITEM_IDS, CUSTOMER_IDS, CATS, START_SIZE, EXPAND_STEPS, MAX_LIVES,
  canPlace, anyFit, evaluate, mergeSet, cellsOf,
} from './rules.js';

export const PICKS_PER_DAY = 2;
export const SETTLE_EVERY = 5;
export const CONTRACT_DAY = 3; // 3, 8, 13, … 일에 계약 제안
const UNDO_LIMIT = 80;

/* ---------- 납부액 곡선 ---------- */

export function isSettleDay(d) { return d % SETTLE_EVERY === 0; }

export function basePay(d) {
  const n = d - 1;
  const v = Math.round(6 + 4.6 * n + 0.34 * n * n);
  return isSettleDay(d) ? Math.round(v * 1.35) : v;
}

/* ---------- 계약 ---------- */

// kind: 즉시 효과(now) + 기간 효과(effects, from/to 상대 일수)
export const CONTRACTS = {
  rush: { name: '급행 입고', gain: '지금 상품 선택 2번 추가', cost: '내일부터 3일간 납부액 +25%', weight: 3 },
  redsign: { name: '붉은 간판', gain: '오늘부터 3일간 장비 상품마다 +3', cost: '같은 기간 연금술 상품마다 -2', weight: 3 },
  soul: { name: '영혼 담보', gain: '지금 중급 상품 하나 선택', cost: '영혼의 불꽃 1개 지불', weight: 2 },
  seal: { name: '봉인된 선반', gain: '오늘부터 3일간 납부액 -30%', cost: '표시된 빈칸 3개를 같은 기간 사용 불가', weight: 3 },
  miracle: { name: '세 번의 기적', gain: '다음 합성 3번, 완성 상품에 영구 +4×등급', cost: '지금 잔금 전부', weight: 2 },
  goblinloan: { name: '고블린 외상', gain: '지금 잔금 +25', cost: '내일부터 3일간 납부액 +8', weight: 3 },
  overtime: { name: '야근 계약', gain: '오늘부터 3일간 모든 상품 +1', cost: '내일부터 3일간 하루 입고 1번', weight: 3 },
  accountant: { name: '악마 회계사', gain: '오늘부터 3일간 납부액 -15%', cost: '같은 기간 특별 손님 효과 없음', weight: 3 },
  lifebond: { name: '생명의 대가', gain: '영혼의 불꽃 1개 회복', cost: '내일부터 5일간 납부액 +20%', weight: 1 },
  witchsale: { name: '마녀의 할인', gain: '지금 상품 선택 1번 + 다시 뽑기 무료 2번', cost: '오늘부터 3일간 마법 잡화마다 -2', weight: 3 },
};

function contractEligible(s, id) {
  if (id === 'soul' && s.lives <= 1) return false;
  if (id === 'lifebond' && s.lives >= MAX_LIVES) return false;
  if (id === 'miracle' && s.balance < 10) return false;
  if (id === 'seal' && emptyCells(s).length < 3) return false;
  return true;
}

function emptyCells(s) {
  const out = [];
  const taken = new Set(s.pieces.flatMap((p) => cellsOf(p).map(([x, y]) => `${x},${y}`)));
  for (let y = 0; y < s.dim.rows; y++)
    for (let x = 0; x < s.dim.cols; x++) if (!taken.has(`${x},${y}`)) out.push(`${x},${y}`);
  return out;
}

// 오늘 적용되는 계약·성장 효과를 rules.evaluate가 읽는 형태로 모은다
export function modsFor(s, day = s.day) {
  const mods = { catFlat: { alch: 0, gear: 0, magic: 0 }, catLabel: {}, perma: { ...s.perma }, noCustomer: false };
  const pay = { mul: 0, add: 0 };
  let picks = PICKS_PER_DAY;
  const sealed = [];
  const flat = (cat, v, label) => { mods.catFlat[cat] += v; mods.catLabel[cat] = label; };
  for (const c of s.contracts) {
    const on = (from, to) => day >= c.day + from && day <= c.day + to;
    switch (c.id) {
      case 'rush': if (on(1, 3)) pay.mul += 0.25; break;
      case 'redsign': if (on(0, 2)) { flat('gear', 3, '붉은 간판'); flat('alch', -2, '붉은 간판'); } break;
      case 'seal': if (on(0, 2)) { pay.mul -= 0.3; sealed.push(...c.cells); } break;
      case 'goblinloan': if (on(1, 3)) pay.add += 8; break;
      case 'overtime':
        if (on(0, 2)) for (const k of Object.keys(CATS)) flat(k, 1, '야근 계약');
        if (on(1, 3)) picks = Math.min(picks, 1);
        break;
      case 'accountant': if (on(0, 2)) { pay.mul -= 0.15; mods.noCustomer = true; } break;
      case 'lifebond': if (on(1, 5)) pay.mul += 0.2; break;
      case 'witchsale': if (on(0, 2)) flat('magic', -2, '마녀의 할인'); break;
    }
  }
  return { mods, pay, picks, sealed };
}

// 기간 효과가 걸리는 날: 서명한 날 기준 [시작, 끝] (상대 일수). null이면 즉시 효과만.
export const CONTRACT_SPAN = {
  rush: [1, 3], redsign: [0, 2], seal: [0, 2], goblinloan: [1, 3], overtime: [0, 3],
  accountant: [0, 2], lifebond: [1, 5], witchsale: [0, 2], soul: null, miracle: null,
};

export function contractActive(s, c, day = s.day) {
  const span = CONTRACT_SPAN[c.id];
  return !!span && day <= c.day + span[1];
}

export function contractDaysLeft(s, c) {
  const span = CONTRACT_SPAN[c.id];
  return span ? c.day + span[1] - s.day + 1 : 0;
}

export function activeContracts(s) {
  return s.contracts.filter((c) => contractActive(s, c));
}

/* ---------- 날짜 정보 ---------- */

export function payFor(s, day = s.day) {
  const { pay } = modsFor(s, day);
  return Math.max(1, Math.round(basePay(day) * (1 + pay.mul) + pay.add));
}

export function customerOn(s, day) {
  while (s.customers.length < day) {
    const prev = s.customers[s.customers.length - 1];
    const prev2 = s.customers[s.customers.length - 2];
    // 같은 손님이 이틀 연속, 혹은 사흘 사이 두 번 오지 않게
    const pool = CUSTOMER_IDS.filter((c) => c !== prev && c !== prev2);
    // 화면을 그리다 내일 손님을 미리 봐도 입고 난수가 흔들리지 않게 시드에서 따로 뽑는다
    s.customers.push(pool[Math.floor(hashRand(s.seed, s.customers.length + 1) * pool.length)]);
  }
  return s.customers[day - 1];
}

export function ctxFor(s, day = s.day) {
  const { mods } = modsFor(s, day);
  return { dim: s.dim, customer: customerOn(s, day), mods };
}

export function sealedNow(s) {
  return modsFor(s).sealed;
}

export function income(s, pieces = s.pieces) {
  return evaluate(pieces, ctxFor(s));
}

/* ---------- 무작위 ---------- */

function rand(s) {
  let t = (s.rng = (s.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function hashRand(seed, n) {
  let t = (seed ^ Math.imul(n, 0x9e3779b1)) | 0;
  t = Math.imul(t ^ (t >>> 16), 0x85ebca6b);
  t = Math.imul(t ^ (t >>> 13), 0xc2b2ae35);
  return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
}

function weighted(s, entries) {
  const sum = entries.reduce((a, [, w]) => a + w, 0);
  let r = rand(s) * sum;
  for (const [k, w] of entries) { if ((r -= w) < 0) return k; }
  return entries[entries.length - 1][0];
}

/* ---------- 시작 ---------- */

export function newGame(seed = (Math.random() * 2 ** 32) >>> 0) {
  const s = {
    v: 2, seed, rng: seed | 0,
    day: 1, lives: MAX_LIVES, phase: 'pick',
    dim: { ...START_SIZE }, expand: 0,
    pieces: [], nextUid: 1,
    offers: null, offerGrade: 1, hand: null, picksLeft: PICKS_PER_DAY, picksDone: 0,
    balance: 0, total: 0, bestDay: 0, history: [], earnedById: {},
    customers: [], contracts: [], contractOffer: null, contractCells: null, signed: 0,
    perma: { alch: 0, gear: 0, magic: 0 }, miracles: 0,
    grace: false, freeRerolls: 0, rerolls: 0, extras: 0, bonusGradeNext: false,
    rewardOffer: null, undo: [], last: null, final: null,
  };
  startDay(s);
  return s;
}

function startDay(s) {
  s.picksLeft = modsFor(s).picks;
  s.picksDone = 0;
  s.rerolls = 0;
  s.extras = 0;
  s.hand = null;
  s.contractOffer = s.day % SETTLE_EVERY === CONTRACT_DAY ? drawContracts(s) : null;
  s.contractCells = null;
  s.offerGrade = s.bonusGradeNext ? 2 : 1;
  s.bonusGradeNext = false;
  s.offers = drawOffers(s);
  s.phase = 'pick';
  s.briefSeen = false;
}

export function seeBrief(s) { s.briefSeen = true; }

function drawContracts(s) {
  const pool = Object.keys(CONTRACTS).filter((id) => contractEligible(s, id));
  const out = [];
  while (out.length < 3 && pool.length) {
    const id = weighted(s, pool.map((k) => [k, CONTRACTS[k].weight]));
    out.push(id);
    pool.splice(pool.indexOf(id), 1);
  }
  // 봉인 위치는 제안할 때 정해 보여 준다
  const cells = out.includes('seal') ? pickSealCells(s) : null;
  return { ids: out, cells };
}

function pickSealCells(s) {
  const empty = emptyCells(s);
  const out = [];
  while (out.length < 3 && empty.length) out.push(empty.splice(Math.floor(rand(s) * empty.length), 1)[0]);
  return out;
}

/* ---------- 입고 후보 ---------- */

export function offerWeights(s) {
  const today = customerOn(s, s.day), tomorrow = customerOn(s, s.day + 1);
  const favCat = { adventurers: 'gear', witches: 'alch', school: 'magic' };
  const owned = {};
  s.pieces.forEach((p) => { if (p.g === 1) owned[p.id] = (owned[p.id] ?? 0) + 1; });
  const sealed = sealedNow(s);
  const w = {};
  for (const id of ITEM_IDS) {
    let v = ITEMS[id].cells.length === 1 ? 10 : ITEMS[id].cells.length === 2 ? 9 : 7;
    if (owned[id]) v *= 1.8;                                         // 합성할 수 있는 상품
    const cat = ITEMS[id].cat;
    if (favCat[today] === cat || favCat[tomorrow] === cat) v *= 1.5; // 손님과 맞는 상품
    if (!anyFit(s.dim, s.pieces, id, sealed) && !owned[id]) v *= 0.25; // 놓을 데 없는 큰 상품은 드물게
    w[id] = v;
  }
  return w;
}

function drawOffers(s) {
  const w = offerWeights(s);
  const pool = ITEM_IDS.slice();
  const out = [];
  while (out.length < 3) {
    const id = weighted(s, pool.map((k) => [k, w[k]]));
    out.push(id);
    pool.splice(pool.indexOf(id), 1);
  }
  // 셋 다 놓을 데가 없으면 하나는 1칸 상품으로 바꾼다
  const sealed = sealedNow(s);
  if (out.every((id) => !anyFit(s.dim, s.pieces, id, sealed))) {
    const ones = ITEM_IDS.filter((id) => ITEMS[id].cells.length === 1 && !out.includes(id));
    out[2] = ones[Math.floor(rand(s) * ones.length)];
  }
  return out;
}

/* ---------- 되돌리기 ---------- */

function snapshot(s) {
  const { undo, ...rest } = s;
  s.undo = [...undo, JSON.stringify(rest)].slice(-UNDO_LIMIT);
}

export function canUndo(s) {
  return s.undo.length > 0 && s.phase !== 'over' && s.phase !== 'reward';
}

export function undo(s) {
  if (!canUndo(s)) return false;
  const stack = s.undo.slice(0, -1);
  Object.assign(s, JSON.parse(s.undo[s.undo.length - 1]), { undo: stack });
  return true;
}

/* ---------- 입고와 배치 ---------- */

function afterPick(s) {
  s.hand = null;
  s.picksDone++;
  s.picksLeft--;
  s.offerGrade = 1;
  if (s.picksLeft > 0) {
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
  s.hand = { id: s.offers[index], g: s.offerGrade, rot: 0 };
  s.offers = null;
  s.phase = 'place';
  return true;
}

export function skip(s) {
  if (s.phase !== 'pick' && s.phase !== 'place') return false;
  snapshot(s);
  afterPick(s);
  return true;
}

export function placeHand(s, x, y, rot) {
  if (s.phase !== 'place' || !s.hand) return false;
  const piece = { uid: s.nextUid, id: s.hand.id, g: s.hand.g, x, y, rot: ((rot % 4) + 4) % 4 };
  if (s.hand.bless) piece.bless = s.hand.bless;
  if (!canPlace(s.dim, s.pieces, piece, undefined, sealedNow(s))) return false;
  snapshot(s);
  s.pieces.push(piece);
  s.nextUid++;
  afterPick(s);
  return true;
}

export function movePiece(s, uid, x, y, rot) {
  if (!prep(s)) return false;
  const p = s.pieces.find((q) => q.uid === uid);
  if (!p) return false;
  const moved = { ...p, x, y, rot: ((rot % 4) + 4) % 4 };
  if (moved.x === p.x && moved.y === p.y && moved.rot === p.rot) return false;
  if (!canPlace(s.dim, s.pieces, moved, uid, sealedNow(s))) return false;
  snapshot(s);
  Object.assign(p, moved);
  return true;
}

export function discard(s, uid) {
  if (!prep(s) || !s.pieces.some((p) => p.uid === uid)) return false;
  snapshot(s);
  s.pieces = s.pieces.filter((p) => p.uid !== uid);
  return true;
}

function prep(s) {
  return s.phase === 'pick' || s.phase === 'place' || s.phase === 'arrange';
}

/* ---------- 합성 ---------- */

// target: 진열대 상품 uid, 또는 'hand'(아직 놓지 않은 새 상품)
export function mergePlan(s, target) {
  if (!prep(s)) return null;
  const handPiece = s.hand && s.phase === 'place' ? { uid: -1, ...s.hand, x: null, y: null } : null;
  const t = target === 'hand' ? handPiece : s.pieces.find((p) => p.uid === target);
  if (!t) return null;
  const set = mergeSet(s.pieces, t, handPiece && target !== 'hand' ? [handPiece] : []);
  return set ? { target: t, set, g: t.g + 1 } : null;
}

export function merge(s, target) {
  const plan = mergePlan(s, target);
  if (!plan) return false;
  snapshot(s);
  const used = new Set(plan.set.map((q) => q.uid));
  const bless = s.miracles > 0 ? 4 * plan.g : 0;
  if (s.miracles > 0) s.miracles--;
  if (target === 'hand') {
    // 새 상품이 기준: 진열대의 두 개를 쓰고, 손에 든 상품이 한 등급 오른다
    s.pieces = s.pieces.filter((p) => !used.has(p.uid));
    s.hand.g = plan.g;
    if (bless) s.hand.bless = (s.hand.bless ?? 0) + bless;
    return true;
  }
  const t = s.pieces.find((p) => p.uid === target);
  s.pieces = s.pieces.filter((p) => p.uid === target || !used.has(p.uid));
  t.g = plan.g;
  if (bless) t.bless = (t.bless ?? 0) + bless;
  if (used.has(-1)) afterPick(s); // 손에 든 상품을 재료로 썼으면 이번 입고는 끝
  return true;
}

/* ---------- 잔금 사용 ---------- */

export function rerollCost(s) {
  if (s.grace || s.freeRerolls > 0) return 0;
  return 3 + 2 * s.rerolls;
}

export function reroll(s) {
  if (s.phase !== 'pick') return false;
  const cost = rerollCost(s);
  if (s.balance < cost) return false;
  snapshot(s);
  if (s.grace) s.grace = false;
  else if (s.freeRerolls > 0) s.freeRerolls--;
  else { s.balance -= cost; s.rerolls++; }
  s.offers = drawOffers(s);
  return true;
}

export function extraCost(s) { return 8 + 6 * s.extras; }

export function buyExtra(s) {
  if (!prep(s) || s.phase === 'place') return false;
  const cost = extraCost(s);
  if (s.balance < cost) return false;
  snapshot(s);
  s.balance -= cost;
  s.extras++;
  s.picksLeft++;
  if (s.phase === 'arrange') { s.offers = drawOffers(s); s.phase = 'pick'; }
  return true;
}

export function expandCost(s) { return s.expand < EXPAND_STEPS.length ? 60 + 40 * s.expand : null; }

function grow(s) {
  if (s.expand >= EXPAND_STEPS.length) return false;
  s.dim = { ...EXPAND_STEPS[s.expand] };
  s.expand++;
  return true;
}

export function buyExpand(s) {
  const cost = expandCost(s);
  if (!prep(s) || cost === null || s.balance < cost) return false;
  snapshot(s);
  s.balance -= cost;
  grow(s);
  return true;
}

/* ---------- 계약 ---------- */

export function canSign(s, id) {
  if (!prep(s) || !s.contractOffer?.ids.includes(id)) return { ok: false, why: '오늘 제안된 계약이 아니에요' };
  if (activeContracts(s).length >= 2) return { ok: false, why: '계약은 동시에 두 개까지예요' };
  if (!contractEligible(s, id)) return { ok: false, why: '지금은 맺을 수 없는 계약이에요' };
  if (id === 'seal') {
    const taken = new Set(s.pieces.flatMap((p) => cellsOf(p).map(([x, y]) => `${x},${y}`)));
    if (s.contractOffer.cells.some((k) => taken.has(k))) return { ok: false, why: '봉인될 칸의 상품을 먼저 옮겨 주세요' };
  }
  if ((id === 'rush' || id === 'witchsale' || id === 'soul') && s.phase === 'place') return { ok: false, why: '들고 있는 상품을 먼저 놓아 주세요' };
  return { ok: true };
}

export function sign(s, id) {
  if (!canSign(s, id).ok) return false;
  snapshot(s);
  const c = { id, day: s.day };
  if (id === 'seal') c.cells = s.contractOffer.cells.slice();
  s.contracts.push(c);
  s.contractOffer = null;
  s.signed++;
  switch (id) {
    case 'rush': addPicks(s, 2); break;
    case 'witchsale': addPicks(s, 1); s.freeRerolls += 2; break;
    case 'soul': s.lives--; addPicks(s, 1, 2); break;
    case 'miracle': s.balance = 0; s.miracles += 3; break;
    case 'goblinloan': s.balance += 25; break;
    case 'lifebond': s.lives = Math.min(MAX_LIVES, s.lives + 1); break;
  }
  return true;
}

function addPicks(s, n, grade = 1) {
  s.picksLeft += n;
  if (s.phase === 'arrange' || s.phase === 'pick') {
    s.offerGrade = grade;
    s.offers = drawOffers(s);
    s.phase = 'pick';
  }
}

export function refuseContracts(s) {
  if (!s.contractOffer) return false;
  snapshot(s);
  s.contractOffer = null;
  return true;
}

/* ---------- 영업과 판정 ---------- */

export function canOpen(s) {
  return s.phase === 'arrange';
}

export function openShop(s) {
  if (!canOpen(s)) return null;
  const ev = income(s);
  const pay = payFor(s);
  const sales = ev.sum.total;
  const ok = sales >= pay;
  const customer = customerOn(s, s.day);
  const perItem = {};
  for (const p of s.pieces) {
    const v = ev.items.get(p.uid).total;
    perItem[p.uid] = v;
    s.earnedById[p.id] = (s.earnedById[p.id] ?? 0) + v;
  }
  s.total += sales;
  s.bestDay = Math.max(s.bestDay, sales);
  const gain = ok ? sales - pay : 0;
  s.balance += gain;
  if (!ok) s.lives--;
  const settle = isSettleDay(s.day);
  s.history.push({ day: s.day, sales, pay, ok });
  s.last = { day: s.day, sales, pay, ok, gain, sum: ev.sum, perItem, customer, settle, lives: s.lives };
  s.undo = [];
  s.grace = false;
  s.contractOffer = null;
  // 기간이 끝난 계약은 내일 기준으로 정리
  s.contracts = s.contracts.filter((c) => contractActive(s, c, s.day + 1));
  if (s.lives <= 0) {
    s.phase = 'over';
    return s.last;
  }
  if (!ok) s.grace = true; // 마왕의 유예: 다음 날 후보 무료 다시 뽑기 1번
  if (settle && ok) {
    s.rewardOffer = drawRewards(s);
    s.phase = 'reward';
    return s.last;
  }
  nextDay(s);
  return s.last;
}

function nextDay(s) {
  s.day++;
  startDay(s);
}

/* ---------- 결산 보상 ---------- */

export const REWARDS = {
  perma_alch: { name: '연금술 영구 강화', text: '연금술 상품마다 매일 +2' },
  perma_gear: { name: '장비 영구 강화', text: '모험 장비 상품마다 매일 +2' },
  perma_magic: { name: '마법 잡화 영구 강화', text: '마법 잡화 상품마다 매일 +2' },
  expand: { name: '진열대 확장', text: '진열대가 한 줄 넓어져요' },
  grade: { name: '중급 입고', text: '내일 첫 입고 후보가 모두 중급' },
  life: { name: '영혼의 불꽃 회복', text: '불꽃 1개를 되찾아요' },
  cash: { name: '마왕의 팁', text: '잔금 +30' },
};

function drawRewards(s) {
  const pool = ['perma_alch', 'perma_gear', 'perma_magic', 'grade', 'cash'];
  if (s.expand < EXPAND_STEPS.length) pool.push('expand', 'expand');
  if (s.lives < MAX_LIVES) pool.push('life');
  const out = [];
  while (out.length < 3 && pool.length) {
    const k = pool[Math.floor(rand(s) * pool.length)];
    if (!out.includes(k)) out.push(k);
    pool.splice(pool.indexOf(k), 1);
  }
  return out;
}

export function takeReward(s, key) {
  if (s.phase !== 'reward' || !s.rewardOffer?.includes(key)) return false;
  if (key.startsWith('perma_')) s.perma[key.slice(6)] += 2;
  if (key === 'expand') grow(s);
  if (key === 'grade') s.bonusGradeNext = true;
  if (key === 'life') s.lives = Math.min(MAX_LIVES, s.lives + 1);
  if (key === 'cash') s.balance += 30;
  s.rewardOffer = null;
  nextDay(s);
  return true;
}

/* ---------- 결과 ---------- */

export function nickname(s) {
  if (!s.pieces.length) return '텅 빈 가게';
  const count = {};
  s.pieces.forEach((p) => { count[p.id] = (count[p.id] ?? 0) + 1; });
  const [topId, n] = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
  if (n / s.pieces.length >= 0.4) return `${ITEMS[topId].name}에 인생을 건 가게`;
  const cats = {};
  s.pieces.forEach((p) => { cats[ITEMS[p.id].cat] = (cats[ITEMS[p.id].cat] ?? 0) + 1; });
  const [cat, m] = Object.entries(cats).sort((a, b) => b[1] - a[1])[0];
  if (m / s.pieces.length >= 0.6) return { alch: '수상한 골목 약방', gear: '모험가 단골 무기점', magic: '먼지 쌓인 마법 골동품점' }[cat];
  return '뭐든지 파는 마계 잡화점';
}

export function summary(s) {
  const top = s.pieces.slice().sort((a, b) => b.g - a.g || ITEMS[b.id].base - ITEMS[a.id].base)[0] ?? null;
  return {
    days: s.day, total: s.total, bestDay: s.bestDay, signed: s.signed,
    topPiece: top, nickname: nickname(s),
  };
}

// 기록 비교: 생존 일수, 같으면 누적 매출
export function better(a, b) {
  if (!b) return true;
  return a.days > b.days || (a.days === b.days && a.total > b.total);
}
