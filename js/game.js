// 한 판의 진행: 영업 예고 → 입고(3개 중 1개, 하루 2번) → 정리·합성·변이·계약 → 영업 → 납부 판정
// → 결산 보상 → 단골 제안. 상태는 JSON 하나로 저장되고, 무작위는 시드와 난수 상태를 함께 저장한다.
import {
  ITEMS, ITEM_IDS, CUSTOMERS, CUSTOMER_IDS, CATS, START_SIZE, EXPAND_STEPS, MAX_LIVES,
  canPlace, anyFit, findSpot, evaluate, mergeSet, cellsOf,
} from './rules.js';

export const PICKS_PER_DAY = 2;
export const SETTLE_EVERY = 5;
export const FAVOR_TO_OFFER = 2;   // 호감도가 이만큼 쌓이면 단골 제안
export const MAX_ACTIVE = 2;       // 기간형·조건형 계약을 합친 최대 수
const UNDO_LIMIT = 80;

/* ---------- 납부액 곡선 ---------- */

export function isSettleDay(d) { return d % SETTLE_EVERY === 0; }
export function isContractDay(d) { return d % SETTLE_EVERY === 3 || (d > SETTLE_EVERY && d % SETTLE_EVERY === 1); }

export function basePay(d) {
  const n = d - 1;
  const v = Math.round(6 + 4.6 * n + 0.34 * n * n);
  return isSettleDay(d) ? Math.round(v * 1.35) : v;
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

const pickOne = (s, list) => list[Math.floor(rand(s) * list.length)];

/* ---------- 손님과 단골 ---------- */

// 단골 효과는 매출 숫자가 아니라 입고·방문·비용에 작용한다
export const REGULAR = {
  adventurers: { cond: '장비를 3종류 이상 진열', effect: '4일 안에 한 번은 꼭 방문' },
  witches: { cond: '연금술 조합(연금술 상품의 배치 보너스)을 활성화', effect: '연금술 상품 입고 비중 증가' },
  school: { cond: '마법 잡화를 3종류 이상 진열', effect: '이 손님이 올 때 방문 보너스 +50%' },
  goblins: { cond: '같은 상품을 3개 이상 진열', effect: '후보 새로고침 비용 절반' },
  noble: { cond: '중급 이상 상품을 진열', effect: '3일마다 중급 상품 구매 기회(잔금 20)' },
  wanderers: { cond: '세 분야를 모두 6종류 이상 진열', effect: '추가 입고 비용 절반' },
};

export function guestCondMet(s, guest, ev) {
  const ids = s.pieces.map((p) => p.id);
  const kinds = (cat) => new Set(s.pieces.filter((p) => ITEMS[p.id].cat === cat).map((p) => p.id)).size;
  switch (guest) {
    case 'adventurers': return kinds('gear') >= 3;
    case 'witches': return s.pieces.some((p) => ITEMS[p.id].cat === 'alch' && ev.items.get(p.uid)?.bonuses.some((b) => b.kind === 'place' && b.amount > 0));
    case 'school': return kinds('magic') >= 3;
    case 'goblins': { const c = {}; ids.forEach((i) => { c[i] = (c[i] ?? 0) + 1; }); return Object.values(c).some((n) => n >= 3); }
    case 'noble': return s.pieces.some((p) => p.g >= 2);
    case 'wanderers': return ['alch', 'gear', 'magic'].every((c) => kinds(c) > 0) && new Set(ids).size >= 6;
  }
  return false;
}

export function customerOn(s, day) {
  while (s.customers.length < day) {
    const n = s.customers.length + 1;
    const prev = s.customers.slice(-2);
    let pick;
    // 모험가 단골: 최근 3일 안에 오지 않았으면 다음 정할 날짜에 온다
    if (s.regulars.includes('adventurers') && n > 1 && !s.customers.slice(-3).includes('adventurers')) pick = 'adventurers';
    else {
      const pool = CUSTOMER_IDS.filter((c) => !prev.includes(c));
      pick = pool[Math.floor(hashRand(s.seed, n) * pool.length)];
    }
    s.customers.push(pick);
  }
  return s.customers[day - 1];
}

/* ---------- 계약 24종 ---------- */

// type: instant(즉시 거래, 자리 차지 없음) · period(기간형) · cond(조건형, 계약금 선지불)
// span: 서명한 날 기준 [시작, 끝] 상대 일수. cond의 span은 마감까지.
export const CONTRACTS = {
  soul: { type: 'instant', name: '영혼 담보' },
  rush: { type: 'instant', name: '급행 입고' },
  vault: { type: 'instant', name: '금고 털기' },
  trade: { type: 'instant', name: '상인의 교환' },
  recycle: { type: 'instant', name: '연금술적 재활용' },
  whim: { type: 'instant', name: '변덕의 서명' },
  ledger: { type: 'instant', name: '고객 명부 매각' },
  rekindle: { type: 'instant', name: '불꽃 되찾기' },

  redsign: { type: 'period', name: '붉은 간판', span: [0, 2] },
  smoke: { type: 'period', name: '보랏빛 연기', span: [0, 2] },
  forbidden: { type: 'period', name: '금서 판매 허가', span: [0, 2] },
  seal: { type: 'period', name: '봉인된 선반', span: [0, 2] },
  exclusive: { type: 'period', name: '독점 입고', span: [0, 2] },
  frugal: { type: 'period', name: '검소한 영업', span: [0, 2] },
  promo: { type: 'period', name: '마왕의 홍보', span: [0, 2] },
  debt: { type: 'period', name: '빚의 유예', span: [0, 3] },

  potions: { type: 'cond', name: '물약 납품', span: [0, 2], deposit: 10, need: 2 },
  armsfair: { type: 'cond', name: '무장 전시회', span: [0, 2], deposit: 10, need: 1 },
  bookfair: { type: 'cond', name: '비밀 도서전', span: [0, 2], deposit: 10, need: 2 },
  mergelab: { type: 'cond', name: '합성 실험', span: [0, 2], deposit: 8, need: 2 },
  dept: { type: 'cond', name: '작은 백화점', span: [0, 2], deposit: 12, need: 1 },
  focus: { type: 'cond', name: '선택과 집중', span: [0, 2], deposit: 10, need: 2 },
  hosting: { type: 'cond', name: '손님 접대', span: [0, 3], deposit: 8, need: 1 },
  tight: { type: 'cond', name: '빈틈없는 진열', span: [0, 2], deposit: 10, need: 1 },
};
const TYPE_IDS = { instant: [], period: [], cond: [] };
for (const [id, c] of Object.entries(CONTRACTS)) TYPE_IDS[c.type].push(id);

const rushCost = (s) => 10 + s.day;
const sameShape = (a, b) => JSON.stringify(ITEMS[a].cells) === JSON.stringify(ITEMS[b].cells);

// 제안할 때 대상·금액을 미리 정해 둔다(수락 전에 확정해서 보여 주기 위해)
function prepareContract(s, id) {
  const ev = income(s);
  switch (id) {
    case 'vault': {
      if (!s.pieces.length) return null;
      const p = s.pieces.slice().sort((a, b) => ev.items.get(a.uid).total - ev.items.get(b.uid).total || a.uid - b.uid)[0];
      return { uid: p.uid, gain: 20 + 2 * s.day };
    }
    case 'trade': {
      const opts = s.pieces.filter((p) => ITEM_IDS.some((o) => o !== p.id && sameShape(o, p.id)));
      if (!opts.length) return null;
      const p = pickOne(s, opts);
      const to = pickOne(s, ITEM_IDS.filter((o) => o !== p.id && sameShape(o, p.id)));
      return { uid: p.uid, to, cost: 8 };
    }
    case 'recycle': {
      const p = s.pieces.filter((q) => q.g >= 2).sort((a, b) => b.g - a.g || a.uid - b.uid)[0];
      return p ? { uid: p.uid, cost: 6 } : null;
    }
    case 'whim': {
      const ids = Object.keys(s.mutations);
      if (!ids.length) return null;
      const kind = pickOne(s, ids);
      return { kind, to: s.mutations[kind] === 'A' ? 'B' : 'A', cost: 15 };
    }
    case 'ledger': return s.regulars.length ? { guest: s.regulars[0], gain: 40 } : null;
    case 'rekindle': return { cost: 50 };
    case 'rush': return { cost: rushCost(s) };
    case 'seal': {
      const empty = emptyCells(s);
      if (empty.length < 3) return null;
      const cells = [];
      while (cells.length < 3) cells.push(empty.splice(Math.floor(rand(s) * empty.length), 1)[0]);
      return { cells };
    }
    case 'exclusive': {
      const count = { alch: 0, gear: 0, magic: 0 };
      s.pieces.forEach((p) => { count[ITEMS[p.id].cat]++; });
      const cat = Object.entries(count).sort((a, b) => b[1] - a[1])[0][0];
      return { cat };
    }
    case 'debt': {
      const cut = Math.max(3, Math.round(basePay(s.day) * 0.3));
      return { cut, repay: Math.round(cut * 1.3), due: s.day + 3 };
    }
    case 'potions': return { target: Math.max(10, Math.round(basePay(s.day) * 0.35)) };
    default: return {};
  }
}

function contractEligible(s, id) {
  const c = CONTRACTS[id];
  if (s.contracts.some((a) => a.id === id && contractActive(s, a))) return false; // 같은 계약은 겹치지 않는다
  switch (id) {
    case 'soul': return s.lives > 1;
    case 'rekindle': return s.lives < MAX_LIVES;
    case 'debt': return !s.contracts.some((a) => a.id === 'debt' && contractActive(s, a));
    case 'ledger': return s.regulars.length > 0;
    case 'whim': return Object.keys(s.mutations).length > 0;
    case 'recycle': return s.pieces.some((p) => p.g >= 2);
    case 'vault': case 'trade': return s.pieces.length > 0;
    case 'seal': return emptyCells(s).length >= 3;
  }
  return !!c;
}

// 오늘 서명하면 생길 일을 문장으로. 기간·끝나면·오늘 영향은 UI가 계산해 덧붙인다.
export function describeContract(s, id, d) {
  const name = (uid) => { const p = s.pieces.find((q) => q.uid === uid); return p ? `${ITEMS[p.id].name}${p.g > 1 ? ` ${p.g}등급` : ''}` : '상품'; };
  const cat = (c) => CATS[c].name;
  const potT = d?.target;
  switch (id) {
    case 'soul': return { gain: '중급 상품 후보 3개 중 하나 선택', cost: '영혼의 불꽃 1개' };
    case 'rush': return { gain: '지금 상품 선택 2번 추가', cost: `잔금 ${d.cost}` };
    case 'vault': return { gain: `잔금 +${d.gain}`, cost: `진열 중인 ${name(d.uid)} 폐기(가장 적게 버는 상품)` };
    case 'trade': return { gain: `${name(d.uid)} → 같은 등급 ${ITEMS[d.to].name}(같은 자리)`, cost: `잔금 ${d.cost}` };
    case 'recycle': return { gain: `${name(d.uid)}을(를) 한 등급 아래 3개로 분해`, cost: `잔금 ${d.cost} · 빈칸 2칸` };
    case 'whim': return { gain: `${ITEMS[d.kind].name} 전체의 변이 변경(${ITEMS[d.kind].muts[s.mutations[d.kind]][0]} → ${ITEMS[d.kind].muts[d.to][0]})`, cost: `잔금 ${d.cost}` };
    case 'ledger': return { gain: `잔금 +${d.gain}`, cost: `${CUSTOMERS[d.guest].name} 단골 관계 종료` };
    case 'rekindle': return { gain: '영혼의 불꽃 1개 회복', cost: `잔금 ${d.cost} · 다음 결산 보상 포기` };
    case 'redsign': return { gain: '장비 상품마다 +3', cost: '연금술 상품마다 -2' };
    case 'smoke': return { gain: '연금술 상품마다 +3', cost: '장비 상품마다 -2' };
    case 'forbidden': return { gain: '마법 잡화 상품마다 +3', cost: '그날 납부액 +10' };
    case 'seal': return { gain: '납부액 -30%', cost: '표시된 빈칸 3개 사용 불가' };
    case 'exclusive': return { gain: `${cat(d.cat)} 상품이 입고 후보에 더 자주`, cost: '다른 분야 등장 비중 감소' };
    case 'frugal': return { gain: '납부액 -15%', cost: '추가 입고 구매 불가' };
    case 'promo': return { gain: '특별 손님 보너스 2배', cost: '상품마다 기본 매출 -1' };
    case 'debt': return { gain: `오늘 납부액 -${d.cut}`, cost: `${d.due}일 차 납부액 +${d.repay}` };
    case 'potions': return { gain: '연금술 상품 입고 1번(다음 날)', cost: '계약금 10', cond: `연금술 매출 ${potT} 이상인 영업 2번` };
    case 'armsfair': return { gain: '장비 상품 영구 +2', cost: '계약금 10', cond: '서로 다른 장비 4종류 이상 진열한 채 영업 1번' };
    case 'bookfair': return { gain: '마법 잡화 입고 1번(다음 날)', cost: '계약금 10', cond: '마도서·수정구가 배치 보너스를 받는 영업 2번' };
    case 'mergelab': return { gain: '추가 입고 이용권 1장', cost: '계약금 8', cond: '기간 안에 합성 2번' };
    case 'dept': return { gain: '잔금 +40', cost: '계약금 12', cond: '서로 다른 상품 8종류 이상 진열한 채 영업 1번' };
    case 'focus': return { gain: '그 분야 입고 비중 영구 증가', cost: '계약금 10', cond: '한 분야가 매출의 70% 이상인 영업 2번' };
    case 'hosting': return { gain: '그 손님 호감도 +1 추가', cost: '계약금 8', cond: '특별 손님 호감도 얻기' };
    case 'tight': return { gain: '추가 입고 이용권 1장', cost: '계약금 10', cond: '상품 8개 이상, 빈칸 2칸 이하로 영업 1번' };
  }
  return { gain: '', cost: '' };
}

export function contractSpan(id) { return CONTRACTS[id].span ?? null; }

export function contractActive(s, c, day = s.day) {
  const span = CONTRACTS[c.id].span;
  if (!span || c.done) return false;
  return day >= c.day + span[0] && day <= c.day + span[1];
}

export function contractDaysLeft(s, c) {
  const span = CONTRACTS[c.id].span;
  return span ? c.day + span[1] - s.day + 1 : 0;
}

export function activeContracts(s) {
  return s.contracts.filter((c) => contractActive(s, c));
}

function emptyCells(s) {
  const out = [];
  const taken = new Set(s.pieces.flatMap((p) => cellsOf(p).map(([x, y]) => `${x},${y}`)));
  const sealed = new Set(sealedNow(s));
  for (let y = 0; y < s.dim.rows; y++)
    for (let x = 0; x < s.dim.cols; x++) {
      const k = `${x},${y}`;
      if (!taken.has(k) && !sealed.has(k)) out.push(k);
    }
  return out;
}

// 오늘 적용되는 계약·성장 효과
export function modsFor(s, day = s.day) {
  const mods = { catFlat: { alch: 0, gear: 0, magic: 0 }, catLabel: {}, perma: { ...s.perma }, noCustomer: false, customerMul: 1, baseCut: 0 };
  const pay = { mul: 0, add: 0 };
  const sealed = [];
  const offer = { cat: null };
  let noExtra = false;
  const flat = (cat, v, label) => { mods.catFlat[cat] += v; mods.catLabel[cat] = label; };
  for (const c of s.contracts) {
    if (!contractActive(s, c, day)) continue;
    const name = CONTRACTS[c.id].name;
    switch (c.id) {
      case 'redsign': flat('gear', 3, name); flat('alch', -2, name); break;
      case 'smoke': flat('alch', 3, name); flat('gear', -2, name); break;
      case 'forbidden': flat('magic', 3, name); pay.add += 10; break;
      case 'seal': pay.mul -= 0.3; sealed.push(...c.data.cells); break;
      case 'exclusive': offer.cat = c.data.cat; break;
      case 'frugal': pay.mul -= 0.15; noExtra = true; break;
      case 'promo': mods.customerMul = 2; mods.baseCut = 1; mods.baseCutLabel = name; break;
      case 'debt':
        if (day === c.day) pay.add -= c.data.cut;
        if (day === c.data.due) pay.add += c.data.repay;
        break;
    }
  }
  return { mods, pay, sealed, offer, noExtra };
}

export function payFor(s, day = s.day) {
  const { pay } = modsFor(s, day);
  return Math.max(1, Math.round(basePay(day) * (1 + pay.mul) + pay.add));
}

export function debtDueToday(s) {
  return s.contracts.find((c) => c.id === 'debt' && c.data.due === s.day) ?? null;
}

export function sealedNow(s) {
  return modsFor(s).sealed;
}

export function ctxFor(s, day = s.day) {
  const { mods, sealed } = modsFor(s, day);
  return { dim: s.dim, customer: customerOn(s, day), mods, mutations: s.mutations, regulars: s.regulars, sealed };
}

export function income(s, pieces = s.pieces) {
  return evaluate(pieces, ctxFor(s));
}

/* ---------- 시작 ---------- */

export function newGame(seed = (Math.random() * 2 ** 32) >>> 0) {
  const s = {
    v: 3, seed, rng: seed | 0,
    day: 1, lives: MAX_LIVES, phase: 'pick',
    dim: { ...START_SIZE }, expand: 0,
    pieces: [], nextUid: 1,
    offers: null, offerGrade: 1, offerCat: null, hand: null, picksLeft: PICKS_PER_DAY, picksDone: 0,
    balance: 0, total: 0, bestDay: 0, history: [], earnedById: {},
    customers: [], contracts: [], contractOffer: null, signed: 0,
    perma: { alch: 0, gear: 0, magic: 0 }, catBoost: {},
    mutations: {}, pendingMutation: null,
    favor: {}, regulars: [], regularOffer: null,
    priority: null, tickets: 0, mergeCount: 0, nobleDay: 0, bonusPick: null,
    grace: false, rerolls: 0, extras: 0, bonusGradeNext: false, forfeitReward: false,
    rewardOffer: null, undo: [], last: null, final: null, briefSeen: false,
  };
  startDay(s);
  return s;
}

function startDay(s) {
  s.picksLeft = PICKS_PER_DAY;
  s.picksDone = 0;
  s.rerolls = 0;
  s.extras = 0;
  s.hand = null;
  s.offerGrade = s.bonusGradeNext ? 2 : 1;
  s.bonusGradeNext = false;
  s.offerCat = null;
  if (s.bonusPick) { s.picksLeft++; s.offerCat = s.bonusPick.cat; s.bonusPick = null; }
  s.contractOffer = isContractDay(s.day) ? drawContracts(s) : null;
  s.offers = drawOffers(s);
  s.phase = 'pick';
  s.briefSeen = false;
}

export function seeBrief(s) { s.briefSeen = true; }

// 즉시·기간·조건에서 하나씩. 같은 유형에서 서로 모순되는 계약(붉은 간판/보랏빛 연기)은 함께 나오지 않는다.
function drawContracts(s) {
  const ids = [];
  const data = {};
  for (const type of ['instant', 'period', 'cond']) {
    const pool = TYPE_IDS[type].filter((id) => contractEligible(s, id));
    while (pool.length) {
      const id = pool.splice(Math.floor(rand(s) * pool.length), 1)[0];
      const d = prepareContract(s, id);
      if (d) { ids.push(id); data[id] = d; break; }
    }
  }
  return ids.length ? { ids, data } : null;
}

/* ---------- 입고 후보 ---------- */

const FAV = { adventurers: 'gear', witches: 'alch', school: 'magic' };

function baseWeights(s) {
  const { offer } = modsFor(s);
  const w = {};
  for (const id of ITEM_IDS) {
    let v = ITEMS[id].cells.length === 1 ? 10 : ITEMS[id].cells.length === 2 ? 9 : 7;
    const cat = ITEMS[id].cat;
    if (s.regulars.includes('witches') && cat === 'alch') v *= 1.6;
    if (offer.cat) v *= cat === offer.cat ? 2.5 : 0.6;
    if (s.catBoost[cat]) v *= s.catBoost[cat];
    if (!anyFit(s.dim, s.pieces, id, sealedNow(s)) && !s.pieces.some((p) => p.id === id)) v *= 0.25;
    w[id] = v;
  }
  return w;
}

// 우선 입고 상품은 더 자주 나오지만, 한 칸에서 60%를 넘지 않는다
function withPriority(s, entries) {
  if (!s.priority) return entries;
  const i = entries.findIndex(([k]) => k === s.priority);
  if (i < 0) return entries;
  const rest = entries.reduce((a, [k, v]) => a + (k === s.priority ? 0 : v), 0);
  const boosted = Math.min(entries[i][1] * 2.5, rest * 1.5);
  return entries.map(([k, v]) => [k, k === s.priority ? boosted : v]);
}

// 후보 세 개를 역할로 나눈다: 같은 종류 · 손님/단골 · 새 선택
export function drawOffers(s) {
  const w = baseWeights(s);
  const chosen = [];
  const take = (pool, why) => {
    const avail = pool.filter((id) => !chosen.some((o) => o.id === id));
    if (!avail.length) return false;
    const id = weighted(s, withPriority(s, avail.map((k) => [k, w[k]])));
    chosen.push({ id, why });
    return true;
  };
  if (s.offerCat) {
    const pool = ITEM_IDS.filter((id) => ITEMS[id].cat === s.offerCat);
    while (chosen.length < 3) take(pool, 'reward');
  } else {
    const onShelf = [...new Set(s.pieces.map((p) => p.id))];
    if (onShelf.length) take(onShelf, 'same');
    const guestPool = new Set();
    for (const g of [customerOn(s, s.day), customerOn(s, s.day + 1), ...s.regulars]) {
      if (FAV[g]) ITEM_IDS.filter((id) => ITEMS[id].cat === FAV[g]).forEach((id) => guestPool.add(id));
      if (g === 'goblins') onShelf.forEach((id) => guestPool.add(id));
      if (g === 'noble') s.pieces.filter((p) => p.g >= 2).forEach((p) => guestPool.add(p.id));
      if (g === 'wanderers') ITEM_IDS.filter((id) => !onShelf.includes(id)).forEach((id) => guestPool.add(id));
    }
    take([...guestPool], 'guest');
    const fresh = ITEM_IDS.filter((id) => !onShelf.includes(id));
    while (chosen.length < 3) if (!take(fresh.length > chosen.length ? fresh : ITEM_IDS, 'new')) take(ITEM_IDS, 'new');
  }
  // 셋 다 놓을 데가 없으면 하나는 1칸 상품으로
  const sealed = sealedNow(s);
  if (chosen.every((o) => !anyFit(s.dim, s.pieces, o.id, sealed))) {
    const ones = ITEM_IDS.filter((id) => ITEMS[id].cells.length === 1 && !chosen.some((o) => o.id === id));
    chosen[2] = { id: pickOne(s, ones), why: 'new' };
  }
  return chosen.map((o) => ({ ...o, prio: o.id === s.priority }));
}

/* ---------- 되돌리기 ---------- */

function snapshot(s) {
  const { undo, ...rest } = s;
  s.undo = [...undo, JSON.stringify(rest)].slice(-UNDO_LIMIT);
}

export function canUndo(s) {
  return s.undo.length > 0 && prep(s);
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
  s.offerCat = null;
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
  s.hand = { id: s.offers[index].id, g: s.offerGrade, rot: 0 };
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

function maybeMutation(s, id, g) {
  if (g >= 2 && !s.mutations[id] && !s.pendingMutation) s.pendingMutation = id;
}

export function placeHand(s, x, y, rot) {
  if (s.phase !== 'place' || !s.hand) return false;
  const piece = { uid: s.nextUid, id: s.hand.id, g: s.hand.g, x, y, rot: ((rot % 4) + 4) % 4 };
  if (!canPlace(s.dim, s.pieces, piece, undefined, sealedNow(s))) return false;
  snapshot(s);
  s.pieces.push(piece);
  s.nextUid++;
  maybeMutation(s, piece.id, piece.g);
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

/* ---------- 합성과 변이 ---------- */

export function mergePlan(s, target) {
  if (!prep(s) || s.pendingMutation) return null;
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
  s.mergeCount++;
  if (target === 'hand') {
    s.pieces = s.pieces.filter((p) => !used.has(p.uid));
    s.hand.g = plan.g;
  } else {
    const t = s.pieces.find((p) => p.uid === target);
    s.pieces = s.pieces.filter((p) => p.uid === target || !used.has(p.uid));
    t.g = plan.g;
    if (used.has(-1)) afterPick(s);
  }
  maybeMutation(s, plan.target.id, plan.g);
  return true;
}

// 처음 Ⅱ등급이 된 상품 종류에 변이를 정한다(그 판 동안 종류 전체에 적용)
export function chooseMutation(s, m) {
  if (!s.pendingMutation || (m !== 'A' && m !== 'B')) return false;
  s.mutations[s.pendingMutation] = m;
  s.pendingMutation = null;
  return true;
}

/* ---------- 잔금 사용 ---------- */

export function rerollCost(s) {
  if (s.grace) return 0;
  const c = 3 + 2 * s.rerolls;
  return s.regulars.includes('goblins') ? Math.ceil(c / 2) : c;
}
export function rerollFullCost(s) { return s.grace ? 0 : 3 + 2 * s.rerolls; }

export function reroll(s) {
  if (s.phase !== 'pick') return false;
  const cost = rerollCost(s);
  if (s.balance < cost) return false;
  snapshot(s);
  if (s.grace) s.grace = false;
  else { s.balance -= cost; s.rerolls++; }
  s.offers = drawOffers(s);
  return true;
}

export function extraCost(s) {
  if (s.tickets > 0) return 0;
  const c = 8 + 6 * s.extras;
  return s.regulars.includes('wanderers') ? Math.ceil(c / 2) : c;
}
export function extraBlocked(s) { return modsFor(s).noExtra; }

export function buyExtra(s) {
  if (!prep(s) || s.phase === 'place' || extraBlocked(s)) return false;
  const cost = extraCost(s);
  if (s.balance < cost) return false;
  snapshot(s);
  if (s.tickets > 0) s.tickets--;
  else { s.balance -= cost; s.extras++; }
  addPicks(s, 1);
  return true;
}

export const NOBLE_COST = 20;
export function nobleDealOpen(s) {
  return s.regulars.includes('noble') && s.day % 3 === 0 && s.nobleDay !== s.day && s.phase === 'arrange';
}
export function buyNoble(s) {
  if (!nobleDealOpen(s) || s.balance < NOBLE_COST) return false;
  snapshot(s);
  s.balance -= NOBLE_COST;
  s.nobleDay = s.day;
  addPicks(s, 1, 2);
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

function addPicks(s, n, grade = 1, cat = null) {
  s.picksLeft += n;
  if (s.phase === 'arrange' || s.phase === 'pick') {
    s.offerGrade = grade;
    s.offerCat = cat;
    s.offers = drawOffers(s);
    s.phase = 'pick';
  }
}

/* ---------- 계약 서명 ---------- */

export function contractCost(s, id) {
  const d = s.contractOffer?.data?.[id] ?? {};
  if (CONTRACTS[id].type === 'cond') return CONTRACTS[id].deposit;
  return d.cost ?? 0;
}

export function canSign(s, id) {
  if (!prep(s) || !s.contractOffer?.ids.includes(id)) return { ok: false, why: '오늘 제안된 계약이 아니에요' };
  const c = CONTRACTS[id];
  const d = s.contractOffer.data[id];
  if (c.type !== 'instant' && activeContracts(s).length >= MAX_ACTIVE) return { ok: false, why: '기간형·조건형 계약은 합쳐서 두 개까지예요' };
  if (s.balance < contractCost(s, id)) return { ok: false, why: `잔금이 부족해요 (필요 ${contractCost(s, id)})` };
  if (s.phase === 'place') return { ok: false, why: '들고 있는 상품을 먼저 놓아 주세요' };
  if (s.pendingMutation) return { ok: false, why: '먼저 변이를 골라 주세요' };
  const has = (uid) => s.pieces.some((p) => p.uid === uid);
  switch (id) {
    case 'soul': if (s.lives <= 1) return { ok: false, why: '불꽃이 하나뿐이면 맺을 수 없어요' }; break;
    case 'rekindle': if (s.lives >= MAX_LIVES) return { ok: false, why: '불꽃이 이미 가득해요' }; break;
    case 'vault': case 'trade': if (!has(d.uid)) return { ok: false, why: '대상 상품이 진열대에 없어요' }; break;
    case 'recycle': {
      if (!has(d.uid)) return { ok: false, why: '대상 상품이 진열대에 없어요' };
      if (!recycleSpots(s, d.uid)) return { ok: false, why: '분해한 상품 두 개를 놓을 자리가 없어요' };
      break;
    }
    case 'whim': if (!s.mutations[d.kind]) return { ok: false, why: '그 상품의 변이가 없어요' }; break;
    case 'ledger': if (!s.regulars.includes(d.guest)) return { ok: false, why: '이미 단골이 아니에요' }; break;
    case 'seal': {
      const taken = new Set(s.pieces.flatMap((p) => cellsOf(p).map(([x, y]) => `${x},${y}`)));
      if (d.cells.some((k) => taken.has(k))) return { ok: false, why: '봉인될 칸의 상품을 먼저 옮겨 주세요' };
      break;
    }
  }
  return { ok: true };
}

function recycleSpots(s, uid) {
  const p = s.pieces.find((q) => q.uid === uid);
  if (!p) return null;
  const sealed = sealedNow(s);
  const temp = s.pieces.slice();
  const spots = [];
  for (let i = 0; i < 2; i++) {
    const at = findSpot(s.dim, temp, p.id, sealed, [p.rot, (p.rot + 1) % 4, (p.rot + 2) % 4, (p.rot + 3) % 4]);
    if (!at) return null;
    const q = { uid: -10 - i, id: p.id, g: p.g - 1, ...at };
    temp.push(q);
    spots.push(at);
  }
  return spots;
}

export function sign(s, id) {
  if (!canSign(s, id).ok) return false;
  snapshot(s);
  const c = CONTRACTS[id];
  const d = s.contractOffer.data[id];
  s.contractOffer = null;
  s.signed++;
  if (c.type === 'cond') s.balance -= c.deposit;
  if (c.type !== 'instant') {
    s.contracts.push({ id, day: s.day, data: d, progress: 0, lastCheck: 0, merges0: s.mergeCount, favor0: { ...s.favor } });
    return true;
  }
  switch (id) {
    case 'soul': s.lives--; addPicks(s, 1, 2); break;
    case 'rush': s.balance -= d.cost; addPicks(s, 2); break;
    case 'vault': s.pieces = s.pieces.filter((p) => p.uid !== d.uid); s.balance += d.gain; break;
    case 'trade': { const p = s.pieces.find((q) => q.uid === d.uid); s.balance -= d.cost; p.id = d.to; maybeMutation(s, p.id, p.g); break; }
    case 'recycle': {
      const spots = recycleSpots(s, d.uid);
      const p = s.pieces.find((q) => q.uid === d.uid);
      s.balance -= d.cost;
      p.g--;
      for (const at of spots) s.pieces.push({ uid: s.nextUid++, id: p.id, g: p.g, ...at });
      break;
    }
    case 'whim': s.balance -= d.cost; s.mutations[d.kind] = d.to; break;
    case 'ledger': s.regulars = s.regulars.filter((g) => g !== d.guest); s.favor[d.guest] = 0; s.balance += d.gain; break;
    case 'rekindle': s.balance -= d.cost; s.lives = Math.min(MAX_LIVES, s.lives + 1); s.forfeitReward = true; break;
  }
  return true;
}

export function refuseContracts(s) {
  if (!s.contractOffer) return false;
  snapshot(s);
  s.contractOffer = null;
  return true;
}

export function contractPending(s) {
  return !!s.contractOffer;
}

/* ---------- 조건형 계약 판정 ---------- */

function condMet(s, c, ev, sales) {
  const kinds = (cat) => new Set(s.pieces.filter((p) => !cat || ITEMS[p.id].cat === cat).map((p) => p.id)).size;
  const catSales = (cat) => s.pieces.filter((p) => ITEMS[p.id].cat === cat).reduce((a, p) => a + ev.items.get(p.uid).total, 0);
  switch (c.id) {
    case 'potions': return catSales('alch') >= c.data.target;
    case 'armsfair': return kinds('gear') >= 4;
    case 'bookfair': return s.pieces.some((p) => (p.id === 'tome' || p.id === 'orb') && ev.items.get(p.uid).bonuses.some((b) => b.kind === 'place' && b.amount > 0));
    case 'mergelab': return s.mergeCount - c.merges0 >= 2;
    case 'dept': return kinds(null) >= 8;
    case 'focus': {
      if (sales <= 0) return false;
      const best = ['alch', 'gear', 'magic'].map((k) => [k, catSales(k)]).sort((a, b) => b[1] - a[1])[0];
      if (best[1] / sales >= 0.7) { c.data.cat = best[0]; return true; }
      return false;
    }
    case 'hosting': return Object.keys(s.favor).some((g) => (s.favor[g] ?? 0) > (c.favor0[g] ?? 0));
    case 'tight': return s.pieces.length >= 8 && emptyCells(s).length <= 2;
  }
  return false;
}

function condReward(s, c) {
  switch (c.id) {
    case 'potions': s.bonusPick = { cat: 'alch' }; break;
    case 'armsfair': s.perma.gear += 2; break;
    case 'bookfair': s.bonusPick = { cat: 'magic' }; break;
    case 'mergelab': case 'tight': s.tickets++; break;
    case 'dept': s.balance += 40; break;
    case 'focus': s.catBoost[c.data.cat] = 1.6; break;
    case 'hosting': {
      const g = Object.keys(s.favor).find((k) => (s.favor[k] ?? 0) > (c.favor0[k] ?? 0));
      if (g) s.favor[g] += 1;
      break;
    }
  }
}

export function condProgressText(s, c) {
  const span = CONTRACTS[c.id].span;
  const left = c.day + span[1] - s.day + 1;
  return `${c.progress} / ${CONTRACTS[c.id].need} · 마감 ${c.day + span[1]}일 차${left > 0 ? ` (남은 영업 ${left}번)` : ''}`;
}

/* ---------- 영업과 판정 ---------- */

export function canOpen(s) {
  return s.phase === 'arrange' && !contractPending(s) && !s.pendingMutation;
}

export function openShop(s) {
  if (!canOpen(s)) return null;
  const ev = income(s);
  const pay = payFor(s);
  const sales = ev.sum.total;
  const ok = sales >= pay;
  const customer = customerOn(s, s.day);
  const { mods } = modsFor(s);
  const perItem = {};
  for (const p of s.pieces) {
    const v = ev.items.get(p.uid).total;
    perItem[p.uid] = v;
    s.earnedById[p.id] = (s.earnedById[p.id] ?? 0) + v;
  }

  // 호감도: 특별 손님의 선호 조건을 채우면 방문당 +1
  let favorGain = null;
  if (!mods.noCustomer && guestCondMet(s, customer, ev)) {
    s.favor[customer] = (s.favor[customer] ?? 0) + 1;
    favorGain = customer;
    if (s.favor[customer] >= FAVOR_TO_OFFER && !s.regulars.includes(customer)) s.regularOffer = customer;
  }

  // 조건형 계약 진행
  const condResults = [];
  for (const c of s.contracts) {
    if (CONTRACTS[c.id].type !== 'cond' || !contractActive(s, c)) continue;
    if (c.lastCheck !== s.day && condMet(s, c, ev, sales)) { c.progress++; c.lastCheck = s.day; }
    if (c.progress >= CONTRACTS[c.id].need) {
      c.done = true;
      condReward(s, c);
      condResults.push({ id: c.id, result: 'success' });
    } else if (s.day >= c.day + CONTRACTS[c.id].span[1]) {
      c.done = true;
      condResults.push({ id: c.id, result: 'fail' });
    } else condResults.push({ id: c.id, result: 'progress', progress: c.progress });
  }

  s.total += sales;
  s.bestDay = Math.max(s.bestDay, sales);
  const gain = ok ? sales - pay : 0;
  s.balance += gain;
  if (!ok) s.lives--;
  const settle = isSettleDay(s.day);
  s.history.push({ day: s.day, sales, pay, ok });
  s.last = { day: s.day, sales, pay, ok, gain, sum: ev.sum, perItem, customer, settle, lives: s.lives, favorGain, condResults, debt: !!debtDueToday(s) };
  s.undo = [];
  s.grace = false;
  s.contractOffer = null;
  s.contracts = s.contracts.filter((c) => !c.done && (contractActive(s, c, s.day + 1) || s.day + 1 < c.day));
  if (s.lives <= 0) {
    s.phase = 'over';
    return s.last;
  }
  if (!ok) s.grace = true;
  if (settle && ok) {
    if (s.forfeitReward) { s.forfeitReward = false; s.last.forfeited = true; }
    else { s.rewardOffer = drawRewards(s); s.phase = 'reward'; return s.last; }
  }
  nextDay(s);
  return s.last;
}

function nextDay(s) {
  s.day++;
  startDay(s);
}

/* ---------- 단골 ---------- */

export function acceptRegular(s, swapOut = null) {
  const g = s.regularOffer;
  if (!g) return false;
  if (s.regulars.length >= 2) {
    if (!swapOut || !s.regulars.includes(swapOut)) return false;
    s.regulars = s.regulars.filter((r) => r !== swapOut);
  }
  s.regulars.push(g);
  s.regularOffer = null;
  return true;
}

export function refuseRegular(s) {
  if (!s.regularOffer) return false;
  s.favor[s.regularOffer] = 0;
  s.regularOffer = null;
  return true;
}

/* ---------- 결산 보상 ---------- */

export const REWARDS = {
  priority: { name: '우선 입고 지정', text: '고른 상품이 입고 후보에 더 자주 나와요. 매번 보장되지는 않고, 한 종류만, 다음 결산일에 바꿀 수 있어요.' },
  perma_alch: { name: '연금술 분야 강화', text: '이번 판 동안 연금술 상품마다 매일 +2' },
  perma_gear: { name: '모험 장비 분야 강화', text: '이번 판 동안 장비 상품마다 매일 +2' },
  perma_magic: { name: '마법 잡화 분야 강화', text: '이번 판 동안 마법 잡화 상품마다 매일 +2' },
  expand: { name: '진열대 확장', text: '자물쇠 칸이 열려요' },
  grade: { name: '중급 입고', text: '내일 첫 입고 후보가 모두 중급' },
  life: { name: '영혼의 불꽃 회복', text: '꺼진 불꽃 하나를 다시 밝혀요' },
  cash: { name: '마왕의 팁', text: '잔금 +30' },
};

function drawRewards(s) {
  const out = [];
  if (s.pieces.length) out.push('priority');
  const pool = ['perma_alch', 'perma_gear', 'perma_magic', 'grade', 'cash'];
  if (s.expand < EXPAND_STEPS.length) pool.push('expand', 'expand');
  if (s.lives < MAX_LIVES) pool.push('life', 'life');
  while (out.length < 3 && pool.length) {
    const k = pool[Math.floor(rand(s) * pool.length)];
    if (!out.includes(k)) out.push(k);
    pool.splice(pool.indexOf(k), 1);
  }
  return out;
}

export function takeReward(s, key, arg = null) {
  if (s.phase !== 'reward' || !s.rewardOffer?.includes(key)) return false;
  if (key === 'priority') {
    if (!arg || !s.pieces.some((p) => p.id === arg)) return false;
    s.priority = arg;
  }
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
  return { days: s.day, total: s.total, bestDay: s.bestDay, signed: s.signed, topPiece: top, nickname: nickname(s) };
}

export function better(a, b) {
  if (!b) return true;
  return a.days > b.days || (a.days === b.days && a.total > b.total);
}
