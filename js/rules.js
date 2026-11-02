// 규칙: 상품 15종과 등급, 모양 회전, 배치 판정, 하루 매출 계산(배치·손님·계약·성장 구분). DOM 없음.

export const START_SIZE = { cols: 5, rows: 4 };
// 진열대 확장 순서(최대 7×6)
export const EXPAND_STEPS = [{ cols: 6, rows: 4 }, { cols: 6, rows: 5 }, { cols: 7, rows: 5 }, { cols: 7, rows: 6 }];
export const GRADE_MULT = 2.4;
export const MAX_LIVES = 3;

const ONE = [[0, 0]];
const H2 = [[0, 0], [1, 0]];
const V2 = [[0, 0], [0, 1]];
const H3 = [[0, 0], [1, 0], [2, 0]];
const SQ = [[0, 0], [1, 0], [0, 1], [1, 1]];
const L3 = [[0, 0], [0, 1], [1, 1]];

export const CATS = {
  alch: { name: '연금술', color: '#7fc8a9' },
  gear: { name: '모험 장비', color: '#e3a86b' },
  magic: { name: '마법 잡화', color: '#b59be0' },
};

// effect 문구의 {n}은 등급에 따라 바뀌는 수치
export const ITEMS = {
  potion: { name: '물약', icon: '🧪', cat: 'alch', cells: ONE, base: 3, effect: '약초·가마의 도움을 받는 기본 상품' },
  herb: { name: '약초', icon: '🌿', cat: 'alch', cells: ONE, base: 1, effect: '붙어 있는 물약마다 +{2}' },
  mushroom: { name: '버섯', icon: '🍄', cat: 'alch', cells: ONE, base: 2, effect: '붙어 있는 다른 연금술 종류마다 자신 +{1} (최대 3종)' },
  poison: { name: '독병', icon: '☠️', cat: 'alch', cells: V2, base: 6, effect: '물약과 붙으면 자신 +{4}' },
  cauldron: { name: '연금 가마', icon: '⚗️', cat: 'alch', cells: SQ, base: 4, effect: '붙어 있는 다른 연금술 상품마다 +{2}' },
  sword: { name: '검', icon: '🗡️', cat: 'gear', cells: V2, base: 5, effect: '방패와 붙으면 자신 +{3}' },
  shield: { name: '방패', icon: '🛡️', cat: 'gear', cells: SQ, base: 7, effect: '진열대 가장자리에 닿으면 자신 +{3}' },
  boots: { name: '장화', icon: '👢', cat: 'gear', cells: L3, base: 6, effect: '붙어 있는 다른 장비 종류마다 자신 +{2} (최대 2종)' },
  bow: { name: '활', icon: '🏹', cat: 'gear', cells: H3, base: 8, effect: '붙어 있는 장비마다 자신 +{2} (최대 2개)' },
  whetstone: { name: '숫돌', icon: '🪨', cat: 'gear', cells: ONE, base: 1, effect: '붙어 있는 검·활마다 +{3}' },
  tome: { name: '마도서', icon: '📕', cat: 'magic', cells: H2, base: 5, effect: '붙어 있는 다른 마법 잡화 종류마다 자신 +{2} (최대 2종)' },
  orb: { name: '수정구', icon: '🔮', cat: 'magic', cells: ONE, base: 4, effect: '마도서와 붙으면 자신 +{3}' },
  charm: { name: '부적', icon: '🧿', cat: 'magic', cells: ONE, base: 2, effect: '붙어 있는 상품 종류마다 자신 +{1} (최대 4종)' },
  candle: { name: '촛대', icon: '🕯️', cat: 'magic', cells: V2, base: 1, effect: '붙어 있는 마도서·수정구마다 +{3}' },
  doll: { name: '저주 인형', icon: '🪆', cat: 'magic', cells: ONE, base: 9, effect: '붙어 있는 다른 상품마다 -{1} (0 아래로는 안 내려감)' },
};
export const ITEM_IDS = Object.keys(ITEMS);

export function gradeBase(id, g) {
  return Math.round(ITEMS[id].base * GRADE_MULT ** (g - 1));
}

export function effectText(id, g = 1) {
  return ITEMS[id].effect.replace(/\{(\d+)\}/g, (_, n) => String(Number(n) * g));
}

export function gradeLabel(g) {
  return g <= 1 ? '하급' : g === 2 ? '중급' : g === 3 ? '상급' : `${g}등급`;
}

/* ---------- 모양 ---------- */

// 화면 좌표(y가 아래)에서 시계 방향 90도: (x, y) → (-y, x)
export function shapeOf(id, rot = 0) {
  let cells = ITEMS[id].cells.map(([x, y]) => [x, y]);
  for (let i = 0; i < ((rot % 4) + 4) % 4; i++) cells = cells.map(([x, y]) => [-y, x]);
  const mx = Math.min(...cells.map((c) => c[0]));
  const my = Math.min(...cells.map((c) => c[1]));
  return cells.map(([x, y]) => [x - mx, y - my]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}

export function sizeOf(id, rot = 0) {
  const s = shapeOf(id, rot);
  return { w: Math.max(...s.map((c) => c[0])) + 1, h: Math.max(...s.map((c) => c[1])) + 1 };
}

export function cellsOf(p) {
  return shapeOf(p.id, p.rot).map(([x, y]) => [p.x + x, p.y + y]);
}

export function clampAnchor(dim, id, rot, x, y) {
  const { w, h } = sizeOf(id, rot);
  return { x: Math.max(0, Math.min(dim.cols - w, x)), y: Math.max(0, Math.min(dim.rows - h, y)) };
}

const key = (x, y) => `${x},${y}`;

export function occupancy(dim, pieces, ignoreUid) {
  const grid = Array.from({ length: dim.rows }, () => Array(dim.cols).fill(null));
  for (const p of pieces) {
    if (p.uid === ignoreUid) continue;
    for (const [x, y] of cellsOf(p)) if (x >= 0 && y >= 0 && x < dim.cols && y < dim.rows) grid[y][x] = p.uid;
  }
  return grid;
}

// sealed: 봉인된 칸 키 목록
export function canPlace(dim, pieces, piece, ignoreUid, sealed = []) {
  const grid = occupancy(dim, pieces, ignoreUid);
  const seal = new Set(sealed);
  return cellsOf(piece).every(([x, y]) =>
    x >= 0 && y >= 0 && x < dim.cols && y < dim.rows && grid[y][x] === null && !seal.has(key(x, y)));
}

export function anyFit(dim, pieces, id, sealed = []) {
  for (let rot = 0; rot < 4; rot++)
    for (let y = 0; y < dim.rows; y++)
      for (let x = 0; x < dim.cols; x++)
        if (canPlace(dim, pieces, { uid: -1, id, x, y, rot }, undefined, sealed)) return true;
  return false;
}

export function neighborsOf(dim, pieces) {
  const grid = occupancy(dim, pieces);
  const map = new Map(pieces.map((p) => [p.uid, new Set()]));
  for (const p of pieces) {
    for (const [x, y] of cellsOf(p)) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= dim.cols || ny >= dim.rows) continue;
        const o = grid[ny][nx];
        if (o !== null && o !== p.uid) map.get(p.uid).add(o);
      }
    }
  }
  return map;
}

/* ---------- 손님 ---------- */

export const CUSTOMERS = {
  adventurers: { name: '모험가 원정대', icon: '⚔️', text: '모험 장비 상품마다 +2×등급' },
  witches: { name: '마녀 모임', icon: '🧹', text: '연금술 상품마다 +2×등급' },
  school: { name: '마법학교 구매단', icon: '🎓', text: '마법 잡화 상품마다 +2×등급' },
  goblins: { name: '고블린 행상단', icon: '👺', text: '같은 상품이 2개 이상이면 그 상품마다 +3' },
  noble: { name: '귀족 수집가', icon: '🎩', text: '중급 이상 상품마다 +6×(등급-1)' },
  wanderers: { name: '떠돌이 시장 손님', icon: '🎒', text: '진열된 상품 종류마다 +3' },
};
export const CUSTOMER_IDS = Object.keys(CUSTOMERS);

/* ---------- 하루 매출 ---------- */

// ctx: { dim, customer, mods } — mods는 game.js가 계약·성장에서 모은 값
//   mods.catFlat: { alch, gear, magic } 상품마다 더하는 값(음수 가능), 출처 이름은 mods.catLabel
//   mods.perma: { alch, gear, magic } 결산 성장 보상
//   mods.noCustomer: 특별 손님 효과 없음
// 결과: Map(uid → { base, bonuses: [{ label, amount, kind, from }], total }), 그리고 합계
export function evaluate(pieces, ctx) {
  const { dim, customer = null, mods = {} } = ctx;
  const byUid = new Map(pieces.map((p) => [p.uid, p]));
  const nbr = neighborsOf(dim, pieces);
  const out = new Map();
  for (const p of pieces) out.set(p.uid, { base: gradeBase(p.id, p.g), bonuses: [], total: 0 });
  const add = (uid, label, amount, kind, from = []) => {
    if (amount) out.get(uid).bonuses.push({ label, amount, kind, from });
  };
  const near = (uid) => [...nbr.get(uid)].map((u) => byUid.get(u));
  const isEdge = ([x, y]) => x === 0 || y === 0 || x === dim.cols - 1 || y === dim.rows - 1;

  // 자기 효과
  for (const p of pieces) {
    const n = near(p.uid);
    const g = p.g;
    const ofId = (id) => n.filter((q) => q.id === id);
    const kinds = (filter) => new Set(n.filter(filter).map((q) => q.id));
    switch (p.id) {
      case 'mushroom': {
        const k = kinds((q) => ITEMS[q.id].cat === 'alch' && q.id !== 'mushroom');
        add(p.uid, '연금술 이웃', Math.min(k.size, 3) * g, 'place', n.filter((q) => k.has(q.id)).map((q) => q.uid));
        break;
      }
      case 'poison': { const m = ofId('potion'); if (m.length) add(p.uid, '물약', 4 * g, 'place', m.map((q) => q.uid)); break; }
      case 'sword': { const m = ofId('shield'); if (m.length) add(p.uid, '방패', 3 * g, 'place', m.map((q) => q.uid)); break; }
      case 'shield': if (cellsOf(p).some(isEdge)) add(p.uid, '가장자리', 3 * g, 'place'); break;
      case 'boots': {
        const k = kinds((q) => ITEMS[q.id].cat === 'gear' && q.id !== 'boots');
        add(p.uid, '장비 이웃', Math.min(k.size, 2) * 2 * g, 'place', n.filter((q) => k.has(q.id)).map((q) => q.uid));
        break;
      }
      case 'bow': {
        const m = n.filter((q) => ITEMS[q.id].cat === 'gear');
        add(p.uid, '장비 이웃', Math.min(m.length, 2) * 2 * g, 'place', m.map((q) => q.uid));
        break;
      }
      case 'tome': {
        const k = kinds((q) => ITEMS[q.id].cat === 'magic' && q.id !== 'tome');
        add(p.uid, '마법 이웃', Math.min(k.size, 2) * 2 * g, 'place', n.filter((q) => k.has(q.id)).map((q) => q.uid));
        break;
      }
      case 'orb': { const m = ofId('tome'); if (m.length) add(p.uid, '마도서', 3 * g, 'place', m.map((q) => q.uid)); break; }
      case 'charm': {
        const k = new Set(n.map((q) => q.id));
        add(p.uid, '다양한 이웃', Math.min(k.size, 4) * g, 'place', n.map((q) => q.uid));
        break;
      }
    }
  }

  // 외부 효과: 같은 이름은 한 상품에 한 번, 가장 높은 등급 기준
  const external = (srcId, label, perG, targetOk) => {
    for (const p of pieces) {
      if (p.id === srcId || !targetOk(p)) continue;
      const srcs = near(p.uid).filter((q) => q.id === srcId);
      if (!srcs.length) continue;
      const g = Math.max(...srcs.map((q) => q.g));
      add(p.uid, label, perG * g, 'place', srcs.map((q) => q.uid));
    }
  };
  external('herb', '약초', 2, (p) => p.id === 'potion');
  external('cauldron', '연금 가마', 2, (p) => ITEMS[p.id].cat === 'alch');
  external('whetstone', '숫돌', 3, (p) => p.id === 'sword' || p.id === 'bow');
  external('candle', '촛대', 3, (p) => p.id === 'tome' || p.id === 'orb');
  external('doll', '저주', -1, () => true);

  // 특별 손님
  if (customer && !mods.noCustomer) {
    const c = CUSTOMERS[customer].name;
    const catOf = { adventurers: 'gear', witches: 'alch', school: 'magic' }[customer];
    if (catOf) for (const p of pieces) if (ITEMS[p.id].cat === catOf) add(p.uid, c, 2 * p.g, 'customer');
    if (customer === 'goblins') {
      const count = {};
      pieces.forEach((p) => { count[p.id] = (count[p.id] ?? 0) + 1; });
      for (const p of pieces) if (count[p.id] >= 2) add(p.uid, c, 3, 'customer');
    }
    if (customer === 'noble') for (const p of pieces) if (p.g >= 2) add(p.uid, c, 6 * (p.g - 1), 'customer');
    if (customer === 'wanderers') {
      const seen = new Set();
      for (const p of pieces) if (!seen.has(p.id)) { seen.add(p.id); add(p.uid, c, 3, 'customer'); }
    }
  }

  // 계약과 결산 성장
  for (const p of pieces) {
    const cat = ITEMS[p.id].cat;
    if (mods.catFlat?.[cat]) add(p.uid, mods.catLabel?.[cat] ?? '계약', mods.catFlat[cat], 'contract');
    if (mods.perma?.[cat]) add(p.uid, `${CATS[cat].name} 강화`, mods.perma[cat], 'perma');
    if (p.bless) add(p.uid, '기적', p.bless, 'perma');
  }

  const sum = { base: 0, place: 0, customer: 0, contract: 0, perma: 0, total: 0 };
  for (const r of out.values()) {
    const raw = r.base + r.bonuses.reduce((s, b) => s + b.amount, 0);
    r.total = Math.max(0, raw);
    // 0 아래로 잘린 만큼은 배치 쪽에서 덜어 낸 것으로 본다
    sum.base += r.base;
    for (const b of r.bonuses) sum[b.kind] += b.amount;
    if (raw < 0) sum.place -= raw;
  }
  sum.total = [...out.values()].reduce((a, r) => a + r.total, 0);
  return { items: out, sum };
}

/* ---------- 합성 ---------- */

// 같은 상품·같은 등급 3개를 고른다: 기준 상품 + 가까운 순 2개
export function mergeSet(pieces, target, extra = []) {
  const pool = [...pieces, ...extra].filter((q) => q.uid !== target.uid && q.id === target.id && q.g === target.g);
  if (pool.length < 2) return null;
  const dist = (q) => (q.x == null || target.x == null ? -1 : Math.abs(q.x - target.x) + Math.abs(q.y - target.y));
  pool.sort((a, b) => dist(a) - dist(b));
  return [target, pool[0], pool[1]];
}
