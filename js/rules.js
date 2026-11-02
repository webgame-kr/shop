// 진열대 규칙: 상품 정의, 모양 회전, 배치 판정, 하루 수익 계산. DOM 없이 Node에서도 돈다.

export const COLS = 6;
export const ROWS = 5;
export const DAYS = 8;

const H2 = [[0, 0], [1, 0]];
const V2 = [[0, 0], [0, 1]];
const SQ = [[0, 0], [1, 0], [0, 1], [1, 1]];
const ONE = [[0, 0]];

// 색과 문구는 디자인 시안(2026.11.02)을 따른다. light: 진한 바탕이라 글자를 밝게 쓴다.
export const ITEMS = {
  apple: { name: '사과', cat: '식품', size: '1칸', color: '#e57373', cells: ONE, base: 2,
    effect: '옆 사과 1개당 +1 (최대 +2)' },
  bread: { name: '빵', cat: '식품', size: '가로 2칸', color: '#e0a458', cells: H2, base: 4,
    effect: '우유와 붙으면 자신에게 +3' },
  milk: { name: '우유', cat: '식품', size: '세로 2칸', color: '#dde6f0', cells: V2, base: 4,
    effect: '빵과 붙으면 자신에게 +2' },
  fish: { name: '생선', cat: '식품', size: '가로 3칸', color: '#6ea3c8', cells: [[0, 0], [1, 0], [2, 0]], base: 7,
    effect: '냉장고와 붙으면 자신에게 +5' },
  fridge: { name: '냉장고', cat: '식품', size: '2×2칸', color: '#b6c2c9', cells: SQ, base: 2,
    effect: '붙어 있는 사과·우유 각각에 +2' },
  boots: { name: '장화', cat: '패션', size: 'ㄴ자 3칸', color: '#f2c14e', cells: [[0, 0], [0, 1], [1, 1]], base: 6,
    effect: '향수와 붙으면 자신에게 +4' },
  perfume: { name: '향수', cat: '패션', size: '1칸', color: '#c391d4', cells: ONE, base: 2,
    effect: '옆 장화 1개당 +1 (최대 +3)' },
  sneakers: { name: '운동화', cat: '패션', size: '가로 2칸', color: '#ef9a73', cells: H2, base: 5,
    effect: '진열대 가장자리 칸을 차지하면 +2' },
  jewel: { name: '보석함', cat: '귀중품', size: '2×2칸', color: '#7a4e9e', light: true, cells: SQ, base: 10,
    effect: '금고와 붙으면 자신에게 +5' },
  safe: { name: '금고', cat: '귀중품', size: '세로 3칸', color: '#4a5560', light: true, cells: [[0, 0], [0, 1], [0, 2]], base: 3,
    effect: '옆 보석함 1개당 +2 (최대 +4)' },
  plant: { name: '화분', cat: '장식', size: '1칸', color: '#5e9e6e', cells: ONE, base: 1,
    effect: '붙어 있는 상품 종류가 3종 이상이면 +5' },
  sign: { name: '간판', cat: '장식', size: '가로 2칸', color: '#2f6b4f', light: true, cells: H2, base: 1,
    effect: '붙어 있는 다른 상품마다 +1 (간판끼리는 제외)' },
};

export const ITEM_IDS = Object.keys(ITEMS);

// 기획서 시험값(260/340/420)은 scripts/simulate.js 기준으로 너무 쉬워 올렸다:
// 아무거나 고르는 봇 중앙값 323, 당장 수익만 보는 봇 중앙값 492.
export const GRADES = [
  { min: 520, name: '전설의 작은 상점', short: '전설' },
  { min: 420, name: '소문난 상점', short: '소문난' },
  { min: 320, name: '동네 인기 상점', short: '동네 인기' },
  { min: 0, name: '다음 장사를 준비하는 상점', short: '준비 중' },
];

export function gradeOf(total) {
  return GRADES.find((g) => total >= g.min);
}

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

// 상품이 진열대 안에 들어가도록 왼쪽 위 기준점을 당겨 준다.
export function clampAnchor(id, rot, x, y) {
  const { w, h } = sizeOf(id, rot);
  return { x: Math.max(0, Math.min(COLS - w, x)), y: Math.max(0, Math.min(ROWS - h, y)) };
}

export function occupancy(pieces, ignoreUid) {
  const grid = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  for (const p of pieces) {
    if (p.uid === ignoreUid) continue;
    for (const [x, y] of cellsOf(p)) if (inBounds(x, y)) grid[y][x] = p.uid;
  }
  return grid;
}

export function inBounds(x, y) {
  return x >= 0 && y >= 0 && x < COLS && y < ROWS;
}

export function canPlace(pieces, piece, ignoreUid) {
  const grid = occupancy(pieces, ignoreUid);
  return cellsOf(piece).every(([x, y]) => inBounds(x, y) && grid[y][x] === null);
}

export function neighborsOf(pieces) {
  const grid = occupancy(pieces);
  const map = new Map(pieces.map((p) => [p.uid, new Set()]));
  for (const p of pieces) {
    for (const [x, y] of cellsOf(p)) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (!inBounds(nx, ny)) continue;
        const other = grid[ny][nx];
        if (other !== null && other !== p.uid) map.get(p.uid).add(other);
      }
    }
  }
  return map;
}

const isEdge = ([x, y]) => x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1;

// 상품마다 { base, bonuses: [{ label, amount, from: [uid] }], total }.
// 보너스는 서로의 계산 기준이 되지 않으므로 모두 기본 상태에서 한 번에 구한다.
export function evaluate(pieces) {
  const byUid = new Map(pieces.map((p) => [p.uid, p]));
  const nbr = neighborsOf(pieces);
  const out = new Map();
  for (const p of pieces) out.set(p.uid, { base: ITEMS[p.id].base, bonuses: [], total: 0 });

  const add = (uid, label, amount, from) => {
    if (amount > 0) out.get(uid).bonuses.push({ label, amount, from });
  };
  const near = (uid, id) => [...nbr.get(uid)].filter((u) => byUid.get(u).id === id);

  for (const p of pieces) {
    const u = p.uid;
    switch (p.id) {
      case 'apple': { const a = near(u, 'apple'); add(u, '옆 사과', Math.min(a.length, 2), a); break; }
      case 'bread': { const m = near(u, 'milk'); if (m.length) add(u, '우유', 3, m); break; }
      case 'milk': { const b = near(u, 'bread'); if (b.length) add(u, '빵', 2, b); break; }
      case 'fish': { const f = near(u, 'fridge'); if (f.length) add(u, '냉장고', 5, f); break; }
      case 'boots': { const f = near(u, 'perfume'); if (f.length) add(u, '향수', 4, f); break; }
      case 'perfume': { const t = near(u, 'boots'); add(u, '장화', Math.min(t.length, 3), t); break; }
      case 'sneakers': if (cellsOf(p).some(isEdge)) add(u, '가장자리', 2, []); break;
      case 'jewel': { const s = near(u, 'safe'); if (s.length) add(u, '금고', 5, s); break; }
      case 'safe': { const j = near(u, 'jewel'); add(u, '보석함', Math.min(j.length * 2, 4), j); break; }
      case 'plant': {
        const kinds = new Set([...nbr.get(u)].map((n) => byUid.get(n).id));
        if (kinds.size >= 3) add(u, '주변 3종', 5, [...nbr.get(u)]);
        break;
      }
    }
  }

  // 외부 효과: 같은 이름의 효과는 한 상품에 한 번만.
  for (const p of pieces) {
    const n = [...nbr.get(p.uid)];
    if (p.id === 'apple' || p.id === 'milk') {
      const f = n.filter((u) => byUid.get(u).id === 'fridge');
      if (f.length) add(p.uid, '냉장고', 2, f);
    }
    if (p.id !== 'sign') {
      const s = n.filter((u) => byUid.get(u).id === 'sign');
      if (s.length) add(p.uid, '간판', 1, s);
    }
  }

  for (const r of out.values()) r.total = r.base + r.bonuses.reduce((s, b) => s + b.amount, 0);
  return out;
}

export function dailyIncome(pieces) {
  let sum = 0;
  for (const r of evaluate(pieces).values()) sum += r.total;
  return sum;
}

// 상품이 보너스를 주는 상대(외부 효과 대상)와 받는 상대를 모두 모은다. 조합 강조용.
export function linksOf(pieces, uid) {
  const ev = evaluate(pieces);
  const linked = new Set();
  for (const b of ev.get(uid)?.bonuses ?? []) b.from.forEach((u) => linked.add(u));
  for (const [other, r] of ev) {
    if (other === uid) continue;
    if (r.bonuses.some((b) => b.from.includes(uid))) linked.add(other);
  }
  linked.delete(uid);
  return linked;
}

export function breakdownText(id, r) {
  const parts = [`기본 ${r.base}`, ...r.bonuses.map((b) => `${b.label} ${b.amount}`)];
  return `${ITEMS[id].name} / ${parts.join(' + ')} = 하루 ${r.total}`;
}
