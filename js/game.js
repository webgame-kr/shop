// 한 판의 진행: 영업 예고 → 입고(3개 중 1개, 하루 2번) → 정리·합성·변이·계약 → 영업 → 납부 판정
// → 결산 보상 → 단골 제안. 상태는 JSON 하나로 저장되고, 무작위는 시드와 난수 상태를 함께 저장한다.
import {
  ITEMS, ITEM_IDS, CUSTOMERS, CUSTOMER_IDS, CATS, CAT_IDS, CAT_GUEST, START_SIZE, EXPAND_STEPS, EXPAND_SCHEDULE, MAX_SIZE, dimForDay, MAX_LIVES, GROW_NEED,
  canPlace, anyFit, findSpot, evaluate, mergeSet, cellsOf, shapeOf, isEgg, displayName, growthCheck, neighborsOf, gradeBase,
} from './rules.js';

export const PICKS_PER_DAY = 2;
export const SETTLE_EVERY = 5;
export const FAVOR_TO_OFFER = 2;   // 호감도가 이만큼 쌓이면 단골 제안
// 친밀도 단계(초기 시험값): 1 관심 고객 · 2 단골 · 4 친한 단골 · 6 VIP 단골
export const STAGES = [{ at: 1, name: '관심 고객' }, { at: 2, name: '단골' }, { at: 4, name: '친한 단골' }, { at: 6, name: 'VIP 단골' }];
export const START_SUPPORT_UNTIL = 10; // 첫 주력 단골 전, 이 날 영업이 끝날 때까지 1번 자리를 시작 분야로
export const MAX_TICKETS = 2;
const VISIT_CAP = { start: 4, regular: 5 }; // 방문 간격 상한(일)
export const MAX_ACTIVE = 2;       // 기간형·조건형 계약을 합친 최대 수
const UNDO_LIMIT = 80;

/* ---------- 납부액 곡선 ---------- */

export function isSettleDay(d) { return d % SETTLE_EVERY === 0; }
export function isContractDay(d) { return d % SETTLE_EVERY === 3 || (d > SETTLE_EVERY && d % SETTLE_EVERY === 1); }

// 납부액 = a + b·n + c·n² (n = 날짜 - 1), 결산일은 ×1.35. 플레이 테스트 후 앞은 올리고 제곱 항은 줄였다.
export const PAY = { a: 8, b: 8, c: 0.32 };
export function basePay(d) {
  const n = d - 1;
  const v = Math.round(PAY.a + PAY.b * n + PAY.c * n * n);
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

// 단골은 분야형 6집단만. 주력 단골 하나가 입고 1번 자리를 그 분야로 채운다.
export const REGULAR = {
  witches: { cond: '연금술 상품 2종 이상 진열' },
  adventurers: { cond: '모험 장비 2종 이상 진열' },
  school: { cond: '마법 잡화 2종 이상 진열' },
  ogre: { cond: '식품 2종 이상이 서로 붙어 있음' },
  dwarf: { cond: '보물 2종 이상 또는 Ⅱ등급 이상 보물 1개 진열' },
  keeper: { cond: '마수 2종 이상 또는 성장 완료 마수 1개 진열' },
};
export const SPECIAL_GUESTS = ['goblins', 'noble', 'wanderers'];

export function stageOf(favor) {
  return STAGES.filter((x) => favor >= x.at).pop() ?? null;
}
export function nextStage(favor) {
  return STAGES.find((x) => favor < x.at) ?? null;
}

export function guestCondMet(s, guest) {
  if (!REGULAR[guest]) return false;
  const cat = CUSTOMERS[guest].fav;
  const mine = s.pieces.filter((p) => ITEMS[p.id].cat === cat);
  const kinds = new Set(mine.map((p) => p.id)).size;
  switch (guest) {
    case 'ogre': {
      const nbr = neighborsOf(s.dim, s.pieces);
      const byUid = new Map(s.pieces.map((p) => [p.uid, p]));
      return mine.some((p) => [...nbr.get(p.uid)].some((u) => { const q = byUid.get(u); return ITEMS[q.id].cat === 'food' && q.id !== p.id; }));
    }
    case 'dwarf': return kinds >= 2 || mine.some((p) => p.g >= 2);
    case 'keeper': return kinds >= 2 || mine.some((p) => p.id !== 'nest' && !isEgg(p));
    default: return kinds >= 2;
  }
}

export function startSupport(s) {
  return !s.main && !s.everMain && s.day <= START_SUPPORT_UNTIL;
}

// 손님 순서: 시드에서 뽑되, 시작 분야 손님은 2일 차에 처음 오고(첫 단골 전 간격 상한),
// 단골 분야 손님도 간격 상한을 둔다. 여러 보장이 겹치면 가장 오래 못 온 손님부터.
export function customerOn(s, day) {
  while (s.customers.length < day) {
    const n = s.customers.length + 1;
    const prev = s.customers.slice(-2);
    const since = (g) => { const i = s.customers.lastIndexOf(g); return i < 0 ? n - 1 : n - 1 - i; };
    const due = [];
    const startGuest = CAT_GUEST[s.startCat];
    if (startGuest && !s.everMain) {
      if (n === 2) due.push([startGuest, 99]);
      else if (n > 2 && since(startGuest) >= VISIT_CAP.start) due.push([startGuest, since(startGuest)]);
    }
    for (const g of s.regulars) if (n > 1 && since(g) >= VISIT_CAP.regular) due.push([g, since(g)]);
    let pick;
    if (due.length) pick = due.sort((a, b) => b[1] - a[1])[0][0];
    else {
      const pool = CUSTOMER_IDS.filter((c) => !prev.includes(c) && (n !== 1 || c !== startGuest));
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
    case 'ledger': return s.regulars.length ? { guest: s.main ?? s.regulars[0], gain: 40 } : null;
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
      const count = Object.fromEntries(CAT_IDS.map((c) => [c, 0]));
      s.pieces.forEach((p) => { count[ITEMS[p.id].cat]++; });
      const cat = Object.entries(count).sort((a, b) => b[1] - a[1])[0][0];
      return { cat, cost: 12 };
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
  if ((s.doneContracts ?? []).includes(id)) return false;                        // 영구 효과를 이미 받은 계약은 다시 오지 않는다
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
  const name = (uid) => { const p = s.pieces.find((q) => q.uid === uid); return p ? `${displayName(p)}${p.g > 1 ? ` ${p.g}등급` : ''}` : '상품'; };
  const newName = (id) => (ITEMS[id].egg ? ITEMS[id].egg.name : ITEMS[id].name); // 교환으로 받는 마수는 알로 온다
  const cat = (c) => CATS[c].name;
  const potT = d?.target;
  switch (id) {
    case 'soul': return { gain: '중급 상품 후보 3개 중 하나 선택', cost: '영혼의 불꽃 1개' };
    case 'rush': return { gain: '지금 상품 선택 2번 추가', cost: `잔금 ${d.cost}` };
    case 'vault': return { gain: `잔금 +${d.gain}`, cost: `진열 중인 ${name(d.uid)} 폐기(가장 적게 버는 상품)` };
    case 'trade': return { gain: `${name(d.uid)} → 같은 등급 ${newName(d.to)}(같은 자리)`, cost: `잔금 ${d.cost}` };
    case 'recycle': return { gain: `${name(d.uid)}을(를) 한 등급 아래 3개로 분해`, cost: `잔금 ${d.cost} · 빈칸 2칸` };
    case 'whim': return { gain: `${ITEMS[d.kind].name} 전체의 변이 변경(${ITEMS[d.kind].muts[s.mutations[d.kind]][0]} → ${ITEMS[d.kind].muts[d.to][0]})`, cost: `잔금 ${d.cost}` };
    case 'ledger': return { gain: `잔금 +${d.gain}`, cost: `${CUSTOMERS[d.guest].name} 단골 관계와 호감도 종료${s.main === d.guest ? ' · 다음 입고부터 주력 추천 끝' : ''}` };
    case 'rekindle': return { gain: '영혼의 불꽃 1개 회복', cost: `잔금 ${d.cost} · 다음 결산 보상 포기` };
    case 'redsign': return { gain: '장비 상품마다 +3', cost: '연금술 상품마다 -2' };
    case 'smoke': return { gain: '연금술 상품마다 +3', cost: '장비 상품마다 -2' };
    case 'forbidden': return { gain: '마법 잡화 상품마다 +3', cost: '그날 납부액 +10' };
    case 'seal': return { gain: '납부액 -30%', cost: '표시된 빈칸 3개 사용 불가' };
    case 'exclusive': return { gain: `입고 3번 자리가 ${cat(d.cat)} 상품으로 고정`, cost: `잔금 ${d.cost ?? 12} · 3번 자리에 다른 분야와 오랜만의 분야가 나오지 않음` };
    case 'frugal': return { gain: '납부액 -15%', cost: '추가 입고 구매 불가' };
    case 'promo': return { gain: '특별 손님 보너스 2배', cost: '상품마다 기본 매출 -1' };
    case 'debt': return { gain: `오늘 납부액 -${d.cut}`, cost: `${d.due}일 차 납부액 +${d.repay}` };
    case 'potions': return { gain: '연금술 상품 입고 1번(다음 날)', cost: '계약금 10', cond: `연금술 매출 ${potT} 이상인 영업 2번` };
    case 'armsfair': return { gain: '장비 상품 영구 +2', cost: '계약금 10', cond: '서로 다른 장비 4종류 이상 진열한 채 영업 1번' };
    case 'bookfair': return { gain: '마법 잡화 입고 1번(다음 날)', cost: '계약금 10', cond: '마도서·수정구가 배치 보너스를 받는 영업 2번' };
    case 'mergelab': return { gain: '추가 입고 이용권 1장', cost: '계약금 8', cond: '기간 안에 합성 2번' };
    case 'dept': return { gain: '잔금 +40', cost: '계약금 12', cond: '서로 다른 상품 8종류 이상 진열한 채 영업 1번' };
    case 'focus': return { gain: '그 분야 입고 비중 영구 증가', cost: '계약금 10', cond: '한 분야가 매출의 70% 이상인 영업 2번' };
    case 'hosting': return { gain: '그 손님 호감도 +1 추가', cost: '계약금 8', cond: '분야형 손님(단골 후보)의 호감도 얻기' };
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
  const mods = { catFlat: Object.fromEntries(CAT_IDS.map((c) => [c, 0])), catLabel: {}, perma: { ...s.perma }, noCustomer: false, customerMul: 1, baseCut: 0 };
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

export function newGame(seed = (Math.random() * 2 ** 32) >>> 0, startCat = 'alch') {
  const s = {
    v: 6, seed, rng: seed | 0, startCat,
    day: 1, lives: MAX_LIVES, phase: 'pick',
    dim: { ...START_SIZE }, expand: 0,
    pieces: [], nextUid: 1,
    offers: null, offerGrade: 1, offerCat: null, hand: null, picksLeft: PICKS_PER_DAY, picksDone: 0,
    balance: 0, total: 0, bestDay: 0, history: [], earnedById: {},
    customers: [], contracts: [], contractOffer: null, signed: 0,
    perma: Object.fromEntries(CAT_IDS.map((c) => [c, 0])), catBoost: {},
    mutations: {}, pendingMutation: null,
    favor: {}, regulars: [], regularOffer: null, main: null, everMain: false,
    priority: null, tickets: 0, freeTickets: 0, mergeCount: 0, bonusPick: null, recentCats: [], recentContracts: [], doneContracts: [], upTickets: 0, upgrades: 0, orderTickets: 0, ordersToday: 0, ordering: false, orders: 0, lastExpand: null, rewardCash: 0, storage: [], storageSlots: STORAGE_START, storageSold: [],
    grace: false, rerolls: 0, extras: 0, bonusGradeNext: false, forfeitReward: false,
    rewardOffer: null, undo: [], last: null, final: null, briefSeen: false,
  };
  startDay(s);
  return s;
}

function startDay(s) {
  applyExpansion(s);
  sellExpired(s);
  s.ordersToday = 0;
  s.ordering = false;
  s.picksLeft = PICKS_PER_DAY;
  s.picksDone = 0;
  s.rerolls = 0;
  s.extras = 0;
  s.hand = null;
  s.offerGrade = s.bonusGradeNext ? 2 : 1;
  s.bonusGradeNext = false;
  s.offerCat = null;
  if (s.bonusPick) { s.picksLeft++; s.offerCat = s.bonusPick.cat; if (s.bonusPick.grade) s.offerGrade = s.bonusPick.grade; s.bonusPick = null; }
  // 주력 단골을 잃었고 다른 단골이 있으면 그 단골이 주력이 된다
  if (!s.main && s.regulars.length) s.main = s.regulars[0];
  s.contractOffer = isContractDay(s.day) ? drawContracts(s) : null;
  s.offers = drawOffers(s);
  s.phase = 'pick';
  s.briefSeen = false;
}

export function seeBrief(s) { s.briefSeen = true; }

// 이전 형식(v4) 진행 중 판: 새 필드를 채우고, 진열대는 줄이지 않고 일정 크기와 비교해 큰 쪽(가로·세로 각각)을 쓴다
export function migrate(s) {
  if (!s) return s;
  if (s.v === 5 || s.v === 6) { s.storage ??= []; s.storageSlots ??= STORAGE_START; s.storageSold ??= []; s.v = 6; return s; }
  if (s.v !== 4) return null;
  Object.assign(s, { v: 6, orderTickets: 0, ordersToday: 0, ordering: false, orders: 0, lastExpand: null, rewardCash: 0, storage: [], storageSlots: STORAGE_START, storageSold: [] });
  s.recentContracts ??= []; s.doneContracts ??= []; s.upTickets ??= 0; s.upgrades ??= 0;
  for (const c of CAT_IDS) s.perma[c] ??= 0;
  const want = dimForDay(s.day);
  s.dim = { cols: Math.max(s.dim.cols, want.cols), rows: Math.max(s.dim.rows, want.rows) };
  if (s.rewardOffer) s.rewardOffer = s.rewardOffer.map((k) => (k === 'expand' ? 'order' : k));
  return s;
}

/* ---------- 진열대 자동 확장 ---------- */

// 다음에 넓어질 날과 크기(최대면 null)
export function nextExpansion(s) {
  return EXPAND_SCHEDULE.find((e) => e.day > s.day && (e.cols > s.dim.cols || e.rows > s.dim.rows)) ?? null;
}

// 크기를 바꾸면 매출이 어떻게 달라지는지: 새 칸 수, 조건이 달라지는 상품, 전체 변화
export function expansionPreview(s, from, to) {
  const ctx = (dim) => ({ ...ctxFor(s), dim });
  const a = evaluate(s.pieces, ctx(from)), b = evaluate(s.pieces, ctx(to));
  const changed = s.pieces.map((p) => ({ uid: p.uid, id: p.id, from: a.items.get(p.uid).total, to: b.items.get(p.uid).total })).filter((c) => c.from !== c.to);
  return { added: to.cols * to.rows - from.cols * from.rows, changed, delta: b.sum.total - a.sum.total };
}

function applyExpansion(s) {
  const want = dimForDay(s.day);
  if (want.cols <= s.dim.cols && want.rows <= s.dim.rows) { s.lastExpand = null; return; }
  const from = { ...s.dim };
  const to = { cols: Math.max(from.cols, want.cols), rows: Math.max(from.rows, want.rows) };
  s.lastExpand = { day: s.day, from, to, ...expansionPreview(s, from, to) };
  s.dim = to; // 왼쪽 위 좌표는 그대로, 오른쪽·아래에 칸이 붙는다
  s.expand = EXPAND_SCHEDULE.filter((e) => e.day <= s.day).length;
}

// 즉시·기간·조건에서 하나씩. 같은 유형에서 서로 모순되는 계약(붉은 간판/보랏빛 연기)은 함께 나오지 않는다.
export function drawContracts(s) {
  const ids = [];
  const data = {};
  for (const type of ['instant', 'period', 'cond']) {
    const eligible = TYPE_IDS[type].filter((id) => contractEligible(s, id));
    // 최근 두 번의 제안에 나온 계약은 쉬게 하되, 남는 게 없으면 다시 쓴다
    const fresh = eligible.filter((id) => !(s.recentContracts ?? []).includes(id));
    const pool = fresh.length ? fresh : eligible;
    while (pool.length) {
      const id = pool.splice(Math.floor(rand(s) * pool.length), 1)[0];
      const d = prepareContract(s, id);
      if (d) { ids.push(id); data[id] = d; break; }
    }
  }
  s.recentContracts = [...(s.recentContracts ?? []), ...ids].slice(-6);
  return ids.length ? { ids, data } : null;
}

/* ---------- 입고 후보 ---------- */

function baseWeights(s) {
  const w = {};
  for (const id of ITEM_IDS) {
    let v = ITEMS[id].cells.length === 1 ? 10 : ITEMS[id].cells.length === 2 ? 9 : 7;
    const cat = ITEMS[id].cat;
    if (s.catBoost[cat]) v *= s.catBoost[cat];
    if (!anyFit(s.dim, s.pieces, id, sealedNow(s)) && !s.pieces.some((p) => p.id === id)) v *= 0.25;
    w[id] = v;
  }
  return w;
}

// 우선 입고 상품은 더 자주 나오지만, 한 칸에서 다른 후보 합의 1.5배를 넘지 않는다
function withPriority(s, entries) {
  if (!s.priority) return entries;
  const i = entries.findIndex(([k]) => k === s.priority);
  if (i < 0) return entries;
  const rest = entries.reduce((a, [k, v]) => a + (k === s.priority ? 0 : v), 0);
  const boosted = Math.min(entries[i][1] * 2.5, rest * 1.5);
  return entries.map(([k, v]) => [k, k === s.priority ? boosted : v]);
}

// 1번 자리: 주력 단골 분야(없으면 시작 분야 지원)
export function slot1Cat(s) {
  if (s.main) return CUSTOMERS[s.main].fav;
  if (startSupport(s)) return s.startCat;
  return null;
}

function drawSlot(s, role, taken, w) {
  const pick = (pool, why, extra = {}) => {
    const avail = pool.filter((id) => !taken.includes(id));
    if (!avail.length) return null;
    const id = weighted(s, withPriority(s, avail.map((k) => [k, w[k]])));
    return { id, why, ...extra };
  };
  const all = ITEM_IDS;
  if (role === 1) {
    const cat = slot1Cat(s);
    if (cat) return pick(all.filter((id) => ITEMS[id].cat === cat), s.main ? 'main' : 'start', { cat });
    return pick(all, 'new');
  }
  if (role === 2) {
    // 보유 상품: 합성 재료가 모자란 것(1~2개)을 우선
    const count = {};
    s.pieces.filter((p) => p.g === 1 && !isEgg(p)).forEach((p) => { count[p.id] = (count[p.id] ?? 0) + 1; });
    s.pieces.filter((p) => isEgg(p)).forEach((p) => { count[p.id] = count[p.id] ?? 0; });
    const lacking = Object.keys(count).filter((id) => count[id] % 3 !== 0 || count[id] === 0);
    const owned = [...new Set(s.pieces.map((p) => p.id))];
    // 빈칸이 거의 없으면 고르는 즉시 합성이 되는 상품(같은 상품 Ⅰ등급 2개)을 먼저
    if (emptyCells(s).length <= 3) {
      const r = pick(Object.keys(count).filter((id) => count[id] % 3 === 2), 'same', { complete: true });
      if (r) return r;
    }
    return pick(lacking, 'same') ?? pick(owned, 'same') ?? pick(all, 'new');
  }
  // 3번: 독점 입고 계약이면 그 분야, 아니면 최근 덜 나온 분야를 우선
  const { offer } = modsFor(s);
  if (offer.cat) return pick(all.filter((id) => ITEMS[id].cat === offer.cat), 'exclusive', { cat: offer.cat });
  const owned = new Set(s.pieces.map((p) => p.id));
  const unowned = all.filter((id) => !owned.has(id));
  // 성장 조건을 못 채운 알이 있으면 그 조건 상품을 자주 보여 준다
  const need = eggNeeds(s).filter((n) => !taken.includes(n.id));
  if (need.length && rand(s) < 0.6) {
    const n = need[Math.floor(rand(s) * need.length)];
    return { id: n.id, why: 'egg', egg: n.egg };
  }
  const recent = s.recentCats.slice(-9);
  const rare = CAT_IDS.filter((c) => !recent.includes(c));
  if (rare.length && recent.length >= 6) {
    const r = pick(unowned.filter((id) => rare.includes(ITEMS[id].cat)), 'new', { rare: true });
    if (r) return r;
  }
  return pick(unowned, 'new') ?? pick(all, 'new');
}

// 성장 조건을 아직 못 채운 알과, 옆에 두면 조건이 채워지는 상품들
const EGG_NEEDS = {
  wyvern: (id) => ITEMS[id].cat === 'food',
  snail: (id) => id === 'herb' || id === 'mushroom',
  mimic: (id) => ITEMS[id].cat === 'treasure',
  griffin: (id) => ITEMS[id].cat === 'gear',
};
function eggNeeds(s) {
  const gc = growthCheck(s.pieces, s.dim, sealedNow(s));
  const out = [];
  for (const p of s.pieces) {
    if (!isEgg(p) || gc.get(p.uid)?.met || !EGG_NEEDS[p.id]) continue;
    for (const id of ITEM_IDS) if (EGG_NEEDS[p.id](id) && !ITEMS[id].egg) out.push({ id, egg: ITEMS[p.id].egg.name });
  }
  return out;
}

// 후보 세 자리: 1 주력 단골(또는 시작 분야) · 2 보유 상품 · 3 새로운 상품. 같은 상품은 한 묶음에 한 번.
export function drawOffers(s) {
  const w = baseWeights(s);
  let chosen = [];
  if (s.offerCat) {
    const pool = ITEM_IDS.filter((id) => ITEMS[id].cat === s.offerCat);
    while (chosen.length < 3) {
      const avail = pool.filter((id) => !chosen.some((o) => o.id === id));
      chosen.push({ id: weighted(s, avail.map((k) => [k, w[k]])), why: 'reward' });
    }
  } else {
    for (const role of [1, 2, 3]) {
      const o = drawSlot(s, role, chosen.map((x) => x.id), w);
      if (o) chosen.push(o);
    }
  }
  const sealed = sealedNow(s);
  if (chosen.every((o) => !anyFit(s.dim, s.pieces, o.id, sealed))) {
    const ones = ITEM_IDS.filter((id) => ITEMS[id].cells.length === 1 && !chosen.some((o) => o.id === id));
    chosen[2] = { id: pickOne(s, ones), why: 'new' };
  }
  chosen = chosen.map((o) => ({ ...o, prio: o.id === s.priority }));
  s.recentCats = [...s.recentCats, ...chosen.map((o) => ITEMS[o.id].cat)].slice(-12);
  return chosen;
}

// 1번 자리만 다시 뽑기(주력 단골 보상 이용권). 같은 상품이 다시 나올 수 있다.
export function rerollSlot1(s) {
  if (s.phase !== 'pick' || s.freeTickets <= 0 || !s.offers?.length || !slot1Cat(s) || s.offerCat) return false;
  snapshot(s);
  s.freeTickets--;
  const o = drawSlot(s, 1, s.offers.slice(1).map((x) => x.id), baseWeights(s));
  if (o) s.offers[0] = { ...o, prio: o.id === s.priority };
  return true;
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
  // 발주 상품은 기본 입고 횟수를 바꾸지 않고 정리 단계로 돌아간다
  if (s.ordering) { s.ordering = false; s.hand = null; s.offers = null; s.phase = 'arrange'; return; }
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
  if (ITEMS[s.hand.id].egg) s.hand.grow = 0;
  s.offers = null;
  s.phase = 'place';
  return true;
}

// 입고를 넘기면 작은 잔금을 받는다(꽉 찬 진열대에서도 넘기기가 손해만은 아니게)
export function skipBonus(s) { return 2 + Math.floor(s.day / 4); }

export function skip(s) {
  if (s.phase !== 'pick' && s.phase !== 'place') return false;
  snapshot(s);
  if (!s.ordering) s.balance += skipBonus(s); // 발주 상품을 버리는 건 보너스 없음
  afterPick(s);
  return true;
}

function maybeMutation(s, id, g) {
  if (g >= 2 && !s.mutations[id] && !s.pendingMutation) s.pendingMutation = id;
}

export function placeHand(s, x, y, rot) {
  if (s.phase !== 'place' || !s.hand) return false;
  const piece = { uid: s.nextUid, id: s.hand.id, g: s.hand.g, x, y, rot: ((rot % 4) + 4) % 4 };
  if (ITEMS[piece.id].egg) piece.grow = s.hand.grow ?? 0;
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

// 진열대에서 빼면 기본 매출의 1.5배(알은 알 매출)를 잔금으로 돌려받는다
export function sellValue(p) {
  return isEgg(p) ? ITEMS[p.id].egg.base : Math.max(1, Math.round(gradeBase(p.id, p.g) * 1.5));
}

/* ---------- 창고 ---------- */

// 매출에 들어가지 않는 임시 보관 칸. 기본 2칸(결산 보상으로 최대 3칸), 넣은 날 영업부터 3번 보관.
// 창고 상품은 s.pieces에 없으므로 매출·손님·호감·계약·주변 효과·마수 성장에서 저절로 빠진다.
export const STORAGE_START = 2;
export const STORAGE_MAX = 3;
export const STORAGE_DAYS = 3;
export const storageFree = (s) => (s.storageSlots ?? STORAGE_START) - (s.storage?.length ?? 0);
export function storeBlocked(s, uid) {
  if (!prep(s)) return '지금은 창고를 쓸 수 없어요';
  if (s.pendingMutation) return '변이를 먼저 골라 주세요';
  if (uid !== 'hand' && !s.pieces.some((p) => p.uid === uid)) return '진열대 상품이 아니에요';
  if (uid === 'hand' && !(s.phase === 'place' && s.hand)) return '손에 든 상품이 없어요';
  if (storageFree(s) <= 0) return '창고 가득 참';
  return null;
}
// 같은 날 꺼냈다 다시 넣으면 처음 기한을 이어 쓴다(꺼냈다 넣기로 기한을 늘릴 수 없다)
function storageLeft(s, p) {
  return p.out?.day === s.day ? p.out.left : STORAGE_DAYS;
}
export function store(s, uid) {
  if (storeBlocked(s, uid)) return false;
  snapshot(s);
  if (uid === 'hand') {
    const p = { uid: s.nextUid++, ...s.hand, x: null, y: null };
    s.storage.push({ ...p, left: STORAGE_DAYS, since: s.day });
    afterPick(s);
    return true;
  }
  const p = s.pieces.find((q) => q.uid === uid);
  s.pieces = s.pieces.filter((q) => q.uid !== uid);
  const { out, ...rest } = p;
  s.storage.push({ ...rest, left: storageLeft(s, p), since: out?.day === s.day ? out.since : s.day });
  return true;
}
export function unstoreBlocked(s, uid, x, y, rot) {
  if (!prep(s) || s.phase === 'place') return s.phase === 'place' ? '손에 든 상품을 먼저 처리해 주세요' : '지금은 꺼낼 수 없어요';
  const p = s.storage?.find((q) => q.uid === uid);
  if (!p) return '창고에 없는 상품이에요';
  if (x == null) return anyFit(s.dim, s.pieces, p.id, sealedNow(s)) ? null : '놓을 자리 없음';
  return canPlace(s.dim, s.pieces, { ...p, x, y, rot: ((rot % 4) + 4) % 4 }, undefined, sealedNow(s)) ? null : '놓을 수 없는 자리';
}
export function unstore(s, uid, x, y, rot = 0) {
  if (unstoreBlocked(s, uid, x, y, rot)) return false;
  snapshot(s);
  const p = s.storage.find((q) => q.uid === uid);
  s.storage = s.storage.filter((q) => q.uid !== uid);
  const { left, since, ...rest } = p;
  s.pieces.push({ ...rest, x, y, rot: ((rot % 4) + 4) % 4, out: { day: s.day, left, since } });
  return true;
}
export function sellStored(s, uid) {
  const p = s.storage?.find((q) => q.uid === uid);
  if (!prep(s) || !p) return false;
  snapshot(s);
  s.storage = s.storage.filter((q) => q.uid !== uid);
  s.balance += sellValue(p);
  return true;
}
// 영업이 끝날 때 기한을 하나 줄이고, 0이 된 상품은 다음 날 아침에 판다
function tickStorage(s) {
  for (const p of s.storage ?? []) p.left = Math.max(0, p.left - 1);
}
function sellExpired(s) {
  s.storageSold = [];
  for (const p of (s.storage ?? []).filter((q) => q.left <= 0)) {
    const v = sellValue(p);
    s.balance += v;
    s.storageSold.push({ id: p.id, name: displayName(p), g: p.g, value: v });
  }
  s.storage = (s.storage ?? []).filter((q) => q.left > 0);
}

/* ---------- 같은 크기 상품끼리 자리 바꾸기 ---------- */

// a가 b의 칸을 그대로 차지하게 하는 회전(지금 회전을 먼저 본다). 안 되면 null.
export function swapRot(a, b) {
  const target = JSON.stringify(shapeOf(b.id, b.rot));
  return [a.rot, ...[0, 1, 2, 3].filter((r) => r !== a.rot)].find((r) => JSON.stringify(shapeOf(a.id, r)) === target) ?? null;
}
export function canSwap(s, ua, ub) {
  const a = s.pieces.find((p) => p.uid === ua), b = s.pieces.find((p) => p.uid === ub);
  return !!a && !!b && a !== b && swapRot(a, b) !== null && swapRot(b, a) !== null;
}
export function swapPieces(s, ua, ub) {
  if (!prep(s) || !canSwap(s, ua, ub)) return false;
  snapshot(s);
  const a = s.pieces.find((p) => p.uid === ua), b = s.pieces.find((p) => p.uid === ub);
  const ra = swapRot(a, b), rb = swapRot(b, a);
  [a.x, a.y, b.x, b.y] = [b.x, b.y, a.x, a.y];
  a.rot = ra;
  b.rot = rb;
  return true;
}

export function discard(s, uid) {
  const p = s.pieces.find((q) => q.uid === uid);
  if (!prep(s) || !p) return false;
  snapshot(s);
  s.pieces = s.pieces.filter((q) => q.uid !== uid);
  s.balance += sellValue(p);
  return true;
}

/* ---------- 후반 성장: 잔금으로 등급 올리기 ---------- */

// 알은 올릴 수 없고, 등급 올리기로는 Ⅲ등급까지만(그 위는 합성), 하루 한 번. 이용권이 있으면 무료.
// 등급마다 매출이 약 2.4배라 제한 없이 사면 납부액보다 빨리 불어난다(시뮬레이션에서 80일 넘게 생존).
export const UPGRADE_MAX = 3;
export function upgradeBlocked(s, p) {
  if (!p) return '상품을 골라 주세요';
  if (isEgg(p)) return '알은 올릴 수 없어요';
  if (p.g >= UPGRADE_MAX) return `${UPGRADE_MAX}등급부터는 합성으로만 올라가요`;
  if (s.upgradedDay === s.day) return '등급 올리기는 하루 한 번이에요';
  return null;
}
export function upgradeCost(s, p) {
  if (!p || isEgg(p) || p.g >= UPGRADE_MAX) return null;
  if ((s.upTickets ?? 0) > 0) return 0;
  return Math.round(gradeBase(p.id, p.g + 1) * 6 + 25 * p.g + 10 * (s.upgrades ?? 0)); // 쓸수록 비싸진다
}

export function upgrade(s, uid) {
  const p = s.pieces.find((q) => q.uid === uid);
  const cost = upgradeCost(s, p);
  if (!prep(s) || s.pendingMutation || cost === null || upgradeBlocked(s, p) || s.balance < cost) return false;
  snapshot(s);
  s.upgradedDay = s.day;
  if (cost === 0) s.upTickets--;
  else s.balance -= cost;
  p.g++;
  s.upgrades = (s.upgrades ?? 0) + 1;
  maybeMutation(s, p.id, p.g);
  return true;
}

function prep(s) {
  return s.phase === 'pick' || s.phase === 'place' || s.phase === 'arrange';
}

/* ---------- 합성과 변이 ---------- */

// target: 진열대 상품 uid, 'hand', 또는 { stored: uid }(창고 상품). 창고 상품도 재료가 된다(창고 것을 먼저 쓴다).
export function mergePlan(s, target) {
  if (!prep(s) || s.pendingMutation) return null;
  const handPiece = s.hand && s.phase === 'place' ? { uid: -1, ...s.hand, x: null, y: null } : null;
  const stored = (s.storage ?? []).map((p) => ({ ...p, x: null, y: null, inStore: true }));
  const fromStore = typeof target === 'object' && target !== null;
  const t = target === 'hand' ? handPiece : fromStore ? stored.find((p) => p.uid === target.stored) : s.pieces.find((p) => p.uid === target);
  if (!t) return null;
  const set = mergeSet(s.pieces, t, [...(handPiece && target !== 'hand' ? [handPiece] : []), ...stored.filter((p) => p.uid !== t.uid)]);
  if (!set) return null;
  const plan = { target: t, set, g: t.g + 1 };
  if (fromStore) {
    // 결과는 진열대에: 진열대 재료가 있으면 그 자리, 모두 창고면 빈자리
    const board = set.find((q) => !q.inStore && q.uid !== -1);
    if (board) plan.anchor = { uid: board.uid };
    else {
      const at = findSpot(s.dim, s.pieces, t.id, sealedNow(s));
      if (!at) return { ...plan, blocked: '합성 결과를 놓을 진열대 자리가 없어요' };
      plan.anchor = { spot: at };
    }
  }
  return plan;
}

export function merge(s, target) {
  const plan = mergePlan(s, target);
  if (!plan || plan.blocked) return false;
  snapshot(s);
  const used = new Set(plan.set.map((q) => q.uid));
  s.mergeCount++;
  s.storage = (s.storage ?? []).filter((p) => !used.has(p.uid));
  if (plan.anchor) {
    if (plan.anchor.uid != null) {
      const keep = s.pieces.find((p) => p.uid === plan.anchor.uid);
      s.pieces = s.pieces.filter((p) => p.uid === keep.uid || !used.has(p.uid));
      keep.g = plan.g;
    } else {
      s.pieces = s.pieces.filter((p) => !used.has(p.uid));
      const { inStore, left, since, ...t } = plan.target;
      s.pieces.push({ ...t, ...plan.anchor.spot, g: plan.g });
    }
  } else if (target === 'hand') {
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
  return 3 + 2 * s.rerolls;
}
export function rerollFullCost(s) { return s.grace ? 0 : 3 + 2 * s.rerolls; }

export function reroll(s) {
  if (s.phase !== 'pick' || s.offers?.every((o) => o.why === 'reward')) return false;
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
  return 8 + 6 * s.extras;
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


// 진열대는 자동으로 넓어진다(결산일 다음 날). 잔금으로 사는 확장은 없다.
export function expandCost() { return null; }
export function buyExpand() { return false; }

function addPicks(s, n, grade = 1, cat = null) {
  s.picksLeft += n;
  if (s.phase === 'arrange' || s.phase === 'pick') {
    s.offerGrade = grade;
    s.offerCat = cat;
    s.offers = drawOffers(s);
    s.phase = 'pick';
  }
}

/* ---------- 지정 발주 ---------- */

// 진열 중인 상품 종류를 하루 두 번까지 확정 입고. 첫 주문 25 + 10·⌊날짜÷5⌋, 두 번째는 두 배. 발주권이면 무료.
export const ORDERS_PER_DAY = 2;
export const MAX_ORDER_TICKETS = 2;
export function orderBaseCost(s) { return 25 + 10 * Math.floor(s.day / 5); }
export function orderCost(s) {
  if ((s.orderTickets ?? 0) > 0) return 0;
  return orderBaseCost(s) * ((s.ordersToday ?? 0) >= 1 ? 2 : 1);
}
export function orderables(s) {
  return [...new Set(s.pieces.map((p) => p.id))];
}
// 주문할 수 없으면 이유, 할 수 있으면 null
export function orderBlocked(s, id) {
  if (s.phase !== 'arrange') return '기본 입고를 마친 뒤 상점 정리 단계에서 주문할 수 있어요';
  if (s.hand) return '손에 든 상품을 먼저 처리해 주세요';
  if (s.pendingMutation) return '변이를 먼저 골라 주세요';
  if (s.regularOffer) return '단골 제안을 먼저 처리해 주세요';
  if (extraBlocked(s)) return '계약 때문에 오늘은 추가 입고·발주를 할 수 없어요';
  if ((s.ordersToday ?? 0) >= ORDERS_PER_DAY) return `지정 발주는 하루 ${ORDERS_PER_DAY}번까지예요`;
  if (id && !s.pieces.some((p) => p.id === id)) return '진열 중인 상품 종류만 주문할 수 있어요';
  if (id) {
    const room = anyFit(s.dim, s.pieces, id, sealedNow(s));
    const mergeable = !ITEMS[id].egg && s.pieces.filter((p) => p.id === id && p.g === 1 && !isEgg(p)).length >= 2;
    if (!room && !mergeable) return '현재는 받을 공간이 없어요. 상품을 합성하거나 정리한 뒤 주문하세요';
  }
  const cost = orderCost(s);
  if (s.balance < cost) return `잔금이 부족해요 (필요 ${cost})`;
  return null;
}
export function order(s, id) {
  if (!id || orderBlocked(s, id)) return false;
  snapshot(s);
  const cost = orderCost(s);
  if (cost === 0) s.orderTickets--;
  else s.balance -= cost;
  s.ordersToday = (s.ordersToday ?? 0) + 1;
  s.orders = (s.orders ?? 0) + 1;
  s.hand = { id, g: 1, rot: 0 };
  if (ITEMS[id].egg) s.hand.grow = 0; // 마수는 성장 전으로 온다
  s.ordering = true;
  s.phase = 'place';
  return true;
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
  else if (c.type === 'period' && d?.cost) s.balance -= d.cost;
  if (c.type !== 'instant') {
    s.contracts.push({ id, day: s.day, data: d, progress: 0, lastCheck: 0, merges0: s.mergeCount, favor0: { ...s.favor } });
    return true;
  }
  switch (id) {
    case 'soul': s.lives--; addPicks(s, 1, 2); break;
    case 'rush': s.balance -= d.cost; addPicks(s, 2); break;
    case 'vault': s.pieces = s.pieces.filter((p) => p.uid !== d.uid); s.balance += d.gain; break;
    case 'trade': {
      const p = s.pieces.find((q) => q.uid === d.uid);
      s.balance -= d.cost;
      p.id = d.to;
      if (ITEMS[p.id].egg) p.grow = 0; else delete p.grow;
      maybeMutation(s, p.id, p.g);
      break;
    }
    case 'recycle': {
      const spots = recycleSpots(s, d.uid);
      const p = s.pieces.find((q) => q.uid === d.uid);
      s.balance -= d.cost;
      p.g--;
      for (const at of spots) s.pieces.push({ uid: s.nextUid++, id: p.id, g: p.g, ...at });
      break;
    }
    case 'whim': s.balance -= d.cost; s.mutations[d.kind] = d.to; break;
    case 'ledger': s.regulars = s.regulars.filter((g) => g !== d.guest); s.favor[d.guest] = 0; if (s.main === d.guest) s.main = null; s.balance += d.gain; break;
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
      const best = CAT_IDS.map((k) => [k, catSales(k)]).sort((a, b) => b[1] - a[1])[0];
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
    case 'armsfair': s.perma.gear += 2; s.doneContracts = [...(s.doneContracts ?? []), 'armsfair']; break;
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

  // 호감도: 분야형 손님의 조건을 영업 시작 배치로 채우면 방문당 +1
  let favorGain = null, stageUp = null;
  if (!mods.noCustomer && guestCondMet(s, customer)) {
    const before = s.favor[customer] ?? 0;
    s.favor[customer] = before + 1;
    favorGain = customer;
    const st = stageOf(s.favor[customer]);
    if (s.regulars.includes(customer) && st && st.at === s.favor[customer] && st.at >= 4) stageUp = { guest: customer, stage: st.name };
    if (s.favor[customer] >= FAVOR_TO_OFFER && !s.regulars.includes(customer)) s.regularOffer = customer;
  }

  // 마수 성장: 영업 시작 배치 기준, 새 매출은 다음 영업부터
  const growth = [];
  const gc = growthCheck(s.pieces, s.dim, sealedNow(s));
  for (const p of s.pieces) {
    const r = gc.get(p.uid);
    if (!r) continue;
    p.grow = r.to;
    growth.push({ uid: p.uid, id: p.id, ...r, hatched: r.to >= GROW_NEED });
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
  // 분야별 상품 매출(계약·결산 강화 보너스 제외): 결산 보상의 기준 분야 판정용
  const catSales = Object.fromEntries(CAT_IDS.map((c) => [c, 0]));
  for (const p of s.pieces) {
    const r = ev.items.get(p.uid);
    catSales[ITEMS[p.id].cat] += r.total - r.bonuses.filter((b) => b.kind === 'contract').reduce((a, b) => a + b.amount, 0);
  }
  s.history.push({ day: s.day, sales, pay, ok, catSales });
  s.last = { day: s.day, sales, pay, ok, gain, sum: ev.sum, perItem, customer, settle, lives: s.lives, favorGain, stageUp, growth, condResults, debt: !!debtDueToday(s) };
  s.undo = [];
  s.grace = false;
  s.contractOffer = null;
  s.contracts = s.contracts.filter((c) => !c.done && (contractActive(s, c, s.day + 1) || s.day + 1 < c.day));
  if (s.lives <= 0) {
    s.phase = 'over';
    return s.last;
  }
  tickStorage(s);
  if (!ok) s.grace = true;
  if (settle && ok) {
    if (s.forfeitReward) { s.forfeitReward = false; s.last.forfeited = true; }
    else { s.rewardOffer = drawRewards(s); s.phase = 'reward'; return s.last; }
    if (s.regulars.length) { s.phase = 'mainpick'; return s.last; }
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
    s.favor[swapOut] = 0;                // 관계를 끝내면 호감도는 0
    if (s.main === swapOut) s.main = g;
  }
  s.regulars.push(g);
  if (!s.main) { s.main = g; s.everMain = true; } // 첫 단골은 바로 주력
  s.regularOffer = null;
  return true;
}

export function refuseRegular(s) {
  if (!s.regularOffer) return false;
  s.regularOffer = null; // 제안을 거절해도 기존 관계와 호감도는 그대로
  return true;
}

/* ---------- 결산 보상 ---------- */

export const REWARDS = {
  priority: { name: '우선 입고 지정', text: '고른 상품이 입고 후보에 더 자주 나와요. 매번 보장되지는 않고, 한 종류만, 다음 결산일에 바꿀 수 있어요.' },
  ...Object.fromEntries(CAT_IDS.map((c) => [`perma_${c}`, { name: `${CATS[c].name} 분야 강화`, text: `이번 판 동안 ${CATS[c].name} 상품마다 매일 +2(반복 선택하면 누적)` }])),
  grade: { name: '중급 입고', text: '내일 첫 입고 후보가 모두 Ⅱ등급' },
  order: { name: '지정 발주권', text: '지정 발주 한 번을 무료로(하루 두 번 제한에는 포함, 최대 2장)' },
  storage: { name: '창고 확장', text: '창고가 한 칸 늘어요(최대 3칸)' },
  upgrade: { name: '등급 올리기 이용권', text: '진열 중인 상품 하나를 잔금 없이 한 등급 올려요(알 제외, Ⅲ등급까지)' },
  life: { name: '영혼의 불꽃 회복', text: '꺼진 불꽃 하나를 다시 밝혀요' },
  cash: { name: '마왕의 팁', text: '잔금 지원(그날 지정 발주 한 번 값)' },
};

// 결산 보상의 기준 분야: 주력 단골 분야, 없으면 최근 3번 영업에서 상품 매출이 가장 큰 분야
export function focusCat(s) {
  if (s.main) return CUSTOMERS[s.main].fav;
  const recent = s.history.slice(-3);
  const sum = Object.fromEntries(CAT_IDS.map((c) => [c, 0]));
  for (const h of recent) for (const c of CAT_IDS) sum[c] += h.catSales?.[c] ?? 0;
  if (CAT_IDS.every((c) => sum[c] === 0)) {
    if (!s.pieces.length) return s.startCat;
    for (const p of s.pieces) sum[ITEMS[p.id].cat] += 1;
  }
  return CAT_IDS.slice().sort((a, b) => sum[b] - sum[a])[0];
}

// 세 자리: 1 지금 전략 강화 · 2 성장 방식 · 3 운영 안정. 낭비되는 보상은 내지 않는다.
function drawRewards(s) {
  const one = (list) => list[Math.floor(rand(s) * list.length)];
  const kinds = new Set(s.pieces.map((p) => p.id));
  const canPrio = [...kinds].some((k) => k !== s.priority);
  const slot1 = canPrio && rand(s) < 0.35 ? 'priority' : `perma_${focusCat(s)}`;
  const growth = ['grade'];
  if ((s.orderTickets ?? 0) < MAX_ORDER_TICKETS) growth.push('order');
  if (s.pieces.some((p) => !isEgg(p) && p.g < UPGRADE_MAX)) growth.push('upgrade');
  if ((s.storageSlots ?? STORAGE_START) < STORAGE_MAX) growth.push('storage');
  const slot2 = one(growth);
  const slot3 = s.lives < MAX_LIVES && rand(s) < 0.6 ? 'life' : 'cash';
  s.rewardCash = orderBaseCost(s);
  return [slot1, slot2, slot3];
}

// 보상 카드에 붙이는 지금 상점 기준 효과
export function rewardPreview(s, key) {
  if (key.startsWith('perma_')) {
    const c = key.slice(6);
    const cur = s.perma[c] ?? 0;
    const now = income(s).sum.total;
    const after = evaluate(s.pieces, { ...ctxFor(s), mods: { ...modsFor(s).mods, perma: { ...s.perma, [c]: cur + 2 } } }).sum.total;
    return `현재 상품마다 +${cur} → +${cur + 2} · 현재 배치 기준 하루 매출 +${after - now}`;
  }
  switch (key) {
    case 'cash': return `잔금 +${s.rewardCash || orderBaseCost(s)}`;
    case 'order': return `보유 ${s.orderTickets ?? 0} → ${(s.orderTickets ?? 0) + 1}장 · 지금 값으로 ${orderBaseCost(s)} 아낌`;
    case 'upgrade': return `보유 ${s.upTickets ?? 0} → ${(s.upTickets ?? 0) + 1}장`;
    case 'storage': return `창고 ${s.storageSlots ?? STORAGE_START} → ${(s.storageSlots ?? STORAGE_START) + 1}칸`;
    case 'life': return `불꽃 ${s.lives} → ${s.lives + 1}`;
    case 'grade': return '내일 첫 입고 후보 셋이 Ⅱ등급';
    case 'priority': return s.priority ? `지금 지정: ${ITEMS[s.priority].name}` : '아직 지정한 상품 없음';
  }
  return '';
}

export function takeReward(s, key, arg = null) {
  if (s.phase !== 'reward' || !s.rewardOffer?.includes(key)) return false;
  if (key === 'priority') {
    if (!arg || !s.pieces.some((p) => p.id === arg)) return false;
    s.priority = arg;
  }
  if (key.startsWith('perma_')) s.perma[key.slice(6)] = (s.perma[key.slice(6)] ?? 0) + 2;
  if (key === 'order') s.orderTickets = Math.min(MAX_ORDER_TICKETS, (s.orderTickets ?? 0) + 1);
  if (key === 'grade') s.bonusGradeNext = true;
  if (key === 'life') s.lives = Math.min(MAX_LIVES, s.lives + 1);
  if (key === 'cash') s.balance += s.rewardCash || orderBaseCost(s);
  if (key === 'storage') s.storageSlots = Math.min(STORAGE_MAX, (s.storageSlots ?? STORAGE_START) + 1);
  if (key === 'upgrade') s.upTickets = (s.upTickets ?? 0) + 1;
  s.rewardOffer = null;
  s.rewardLog = [...(s.rewardLog ?? []), key]; // 어떤 보상을 골랐는지(지표용)
  if (s.regulars.length) { s.phase = 'mainpick'; return true; }
  nextDay(s);
  return true;
}

// 주력 단골 결산 보상: 친밀도에 따라 고를 수 있는 것이 늘고, 한 번만 받는다
export function mainRewardOptions(s) {
  if (!s.main) return [];
  const f = s.favor[s.main] ?? 0;
  const out = ['ticket'];
  if (f >= 4) out.push('g1');
  if (f >= 6) out.push('g2');
  return out;
}

export function settleMain(s, reward, nextMain) {
  if (s.phase !== 'mainpick') return false;
  const opts = mainRewardOptions(s);
  if (opts.length && !opts.includes(reward)) return false;
  if (nextMain && !s.regulars.includes(nextMain)) return false;
  const cat = s.main ? CUSTOMERS[s.main].fav : null;
  if (reward === 'ticket') s.freeTickets = Math.min(MAX_TICKETS, s.freeTickets + 1);
  if (reward === 'g1' || reward === 'g2') s.bonusPick = { cat, grade: reward === 'g2' ? 2 : 1 };
  if (nextMain) { s.main = nextMain; s.everMain = true; }
  nextDay(s); // 새 주력은 다음 날 후보부터
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
  if (m / s.pieces.length >= 0.6) return { alch: '수상한 골목 약방', gear: '모험가 단골 무기점', magic: '먼지 쌓인 마법 골동품점', food: '오우거도 줄 서는 마계 식당', treasure: '드워프도 탐내는 보물 가게', beast: '알 냄새 나는 마수 분양소' }[cat];
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

// 테스트용
export const __startDay = startDay;
export const __drawRewards = drawRewards;
