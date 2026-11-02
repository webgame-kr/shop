// 규칙: 상품 24종(분야별 8종)과 등급·변이, 모양 회전, 배치 판정, 하루 매출 계산. DOM 없음.
// 매출은 기본 → 배치 → 변이 → 손님 → 계약(성장 포함) 순으로 나눠 기록한다.
// 지원 효과는 언제나 기본값과 등급만 보고 계산해서, 받은 보너스를 다른 지원이 다시 키우지 않는다.

export const START_SIZE = { cols: 5, rows: 4 };
// 진열대 확장 순서(최대 7×6)
export const EXPAND_STEPS = [{ cols: 6, rows: 4 }, { cols: 6, rows: 5 }, { cols: 7, rows: 5 }, { cols: 7, rows: 6 }];
export const GRADE_MULT = 2.4;
export const MAX_LIVES = 3;

const ONE = [[0, 0]];
const V2 = [[0, 0], [0, 1]];
const V3 = [[0, 0], [0, 1], [0, 2]];
const H3 = [[0, 0], [1, 0], [2, 0]];
const SQ = [[0, 0], [1, 0], [0, 1], [1, 1]];
const L3 = [[0, 0], [0, 1], [1, 1]];

// 분야 색은 디자인 시안(2026.11.02)
export const CATS = {
  alch: { name: '연금술', color: '#2F7558' },
  gear: { name: '모험 장비', color: '#3F5F8C' },
  magic: { name: '마법 잡화', color: '#7448A3' },
};

// effect·변이 문구의 {n}은 등급에 따라 바뀌는 수치(n × 등급).
// 변이 A는 시안의 금색 문양, B는 민트 문양.
export const ITEMS = {
  potion: { name: '회복 물약', cat: 'alch', cells: ONE, base: 3, effect: '약초와 붙으면 약초가 매출을 올려 줘요',
    muts: { A: ['농축', '자신 +{2}'], B: ['공명', '붙어 있는 다른 회복 물약마다 +{2}'] } },
  mana: { name: '마나 물약', cat: 'alch', cells: ONE, base: 3, effect: '마법 잡화와 붙으면 자신 +{3}',
    muts: { A: ['고농도', '자신 +{2}'], B: ['마력 순환', '붙어 있는 마법 잡화마다 +{1}'] } },
  poison: { name: '독병', cat: 'alch', cells: ONE, base: 5, effect: '붙어 있는 다른 연금술 종류마다 자신 +{1} (최대 3종)',
    muts: { A: ['맹독', '진열대의 연금술 종류가 3종 이하면 자신 +{4}'], B: ['혼합독', '붙어 있는 다른 연금술 종류마다 자신 +{1} 더 (최대 3종)'] } },
  herb: { name: '약초', cat: 'alch', cells: ONE, base: 1, effect: '붙어 있는 회복·마나 물약마다 +{2}',
    muts: { A: ['정제', '붙어 있는 물약 중 등급이 가장 높은 하나에 +{4}'], B: ['무성', '붙어 있는 다른 연금술 상품마다 +{1}'] } },
  mushroom: { name: '달빛 버섯', cat: 'alch', cells: ONE, base: 2, effect: '붙어 있는 달빛 버섯마다 자신 +{1} (최대 3개)',
    muts: { A: ['군락', '붙어 있는 달빛 버섯마다 자신 +{1} 더 (최대 3개)'], B: ['포자', '붙어 있는 다른 연금술 상품마다 +{1}'] } },
  cauldron: { name: '연금 가마', cat: 'alch', cells: SQ, base: 4, effect: '붙어 있는 다른 연금술 종류마다 자신 +{2} (최대 3종)',
    muts: { A: ['대형 가마', '붙어 있는 다른 연금술 종류마다 자신 +{1} 더 (최대 3종)'], B: ['공유 가마', '붙어 있는 다른 연금술 상품마다 +{2}'] } },
  spirit: { name: '정령수', cat: 'alch', cells: ONE, base: 3, effect: '약초·숫돌·촛대 같은 지원 상품과 붙으면 자신 +{3}',
    muts: { A: ['순수', '자신 +{3}'], B: ['순환', '붙어 있는 약초·숫돌·촛대마다 +{2}'] } },
  phoenix: { name: '불사조 재', cat: 'alch', cells: ONE, base: 8, effect: '빈칸과 맞닿아 있으면 자신 +{4}',
    muts: { A: ['재생', '맞닿은 빈칸이 2칸 이상이면 자신 +{3}'], B: ['불씨', '붙어 있는 상품마다 +{1}'] } },

  sword: { name: '강철검', cat: 'gear', cells: V2, base: 5, effect: '숫돌과 붙으면 숫돌이 매출을 올려 줘요',
    muts: { A: ['명품검', '귀족 수집가가 오는 날 자신 +{6}'], B: ['용병검', '모험가 원정대가 오는 날 자신 +{4}'] } },
  shield: { name: '방패', cat: 'gear', cells: SQ, base: 7, effect: '진열대 가장자리에 닿으면 자신 +{3}',
    muts: { A: ['성벽', '가장자리에 닿으면 자신 +{3} 더'], B: ['호위', '붙어 있는 다른 장비마다 +{2}'] } },
  boots: { name: '장화', cat: 'gear', cells: L3, base: 6, effect: '다른 장비 2종 이상과 붙으면 자신 +{4}',
    muts: { A: ['등산화', '진열대 맨 아래 줄에 닿으면 자신 +{4}'], B: ['행군화', '붙어 있는 다른 장비마다 +{1}'] } },
  bow: { name: '사냥활', cat: 'gear', cells: V3, base: 8, effect: '긴 변 한쪽이 모두 빈칸이면 자신 +{4}',
    muts: { A: ['저격', '긴 변 한쪽이 모두 빈칸이면 자신 +{3} 더'], B: ['연사', '붙어 있는 장비마다 자신 +{2} (최대 2개)'] } },
  whetstone: { name: '숫돌', cat: 'gear', cells: ONE, base: 1, effect: '붙어 있는 강철검·사냥활마다 +{3}',
    muts: { A: ['정밀', '붙어 있는 강철검·사냥활 중 등급이 가장 높은 하나에 +{4}'], B: ['대량', '붙어 있는 다른 장비마다 +{1}'] } },
  armor: { name: '갑옷', cat: 'gear', cells: SQ, base: 14, effect: '큰 자리를 차지하는 대신 기본 매출이 높아요',
    muts: { A: ['중갑', '자신 +{4}'], B: ['진열 갑옷', '붙어 있는 다른 장비마다 +{1}'] } },
  pack: { name: '여행 배낭', cat: 'gear', cells: V2, base: 4, effect: '붙어 있는 상품의 분야마다 자신 +{2} (최대 3분야)',
    muts: { A: ['전문가용', '붙어 있는 장비가 3개 이상이면 자신 +{4}'], B: ['여행자용', '붙어 있는 상품의 분야마다 자신 +{1} 더'] } },
  spear: { name: '용의 창', cat: 'gear', cells: H3, base: 7, effect: '창끝 방향으로 장비가 이어지면 하나마다 자신 +{3} (최대 2개)',
    muts: { A: ['용린', '자신 +{3}'], B: ['돌격', '창끝으로 이어진 장비마다 자신 +{1} 더 (최대 2개)'] } },

  tome: { name: '마도서', cat: 'magic', cells: V2, base: 5, effect: '촛대와 붙으면 촛대가 매출을 올려 줘요',
    muts: { A: ['금서', '자신 +{3}'], B: ['교본', '붙어 있는 다른 마법 잡화마다 +{2}'] } },
  orb: { name: '수정구', cat: 'magic', cells: ONE, base: 4, effect: '붙어 있는 다른 마법 잡화 종류마다 자신 +{2} (최대 3종)',
    muts: { A: ['예지', '자신 +{2}'], B: ['투영', '붙어 있는 다른 마법 잡화마다 +{1}'] } },
  charm: { name: '부적', cat: 'magic', cells: ONE, base: 2, effect: '붙어 있는 상품이 2개 이상이고 분야가 모두 다르면 자신 +{4}',
    muts: { A: ['수호', '자신 +{3}'], B: ['행운', '붙어 있는 상품마다 +{1}'] } },
  candle: { name: '촛대', cat: 'magic', cells: V2, base: 1, effect: '붙어 있는 마도서·수정구마다 +{3}',
    muts: { A: ['집중광', '붙어 있는 마도서·수정구 중 등급이 가장 높은 하나에 +{4}'], B: ['확산광', '붙어 있는 다른 마법 잡화마다 +{1}'] } },
  doll: { name: '저주 인형', cat: 'magic', cells: ONE, base: 6, effect: '저주 인형끼리 붙어 있지 않으면 자신 +{3}',
    muts: { A: ['고독', '맞닿은 빈칸마다 자신 +{1} (최대 4칸)'], B: ['군집', '네 방향이 다른 상품으로 둘러싸이면 자신 +{5}'] } },
  rune: { name: '룬석', cat: 'magic', cells: ONE, base: 3, effect: '연금술과 장비 상품에 동시에 붙으면 자신 +{5}',
    muts: { A: ['공명석', '자신 +{3}'], B: ['연결석', '붙어 있는 연금술·장비 상품마다 +{2}'] } },
  pouch: { name: '소원 주머니', cat: 'magic', cells: ONE, base: 3, effect: '서로 다른 등급의 상품과 붙어 있으면 자신 +{4}',
    muts: { A: ['대박', '자신 +{3}'], B: ['나눔', '붙어 있는 상품마다 +{1}'] } },
  chest: { name: '봉인 상자', cat: 'magic', cells: ONE, base: 3, effect: '네 방향이 모두 상품으로 둘러싸이면 자신 +{6}',
    muts: { A: ['보물', '둘러싸이면 자신 +{6} 더'], B: ['방출', '둘러싸이면 붙어 있는 상품마다 +{2}'] } },
};
export const ITEM_IDS = Object.keys(ITEMS);
// 화살표가 있어 회전하면 그림도 같이 도는 상품
export const DIRECTIONAL = new Set(['spear']);
const SUPPORT = new Set(['herb', 'whetstone', 'candle']);

export function gradeBase(id, g) {
  return Math.round(ITEMS[id].base * GRADE_MULT ** (g - 1));
}

const fill = (text, g) => text.replace(/\{(\d+)\}/g, (_, n) => String(Number(n) * g));
export function effectText(id, g = 1) { return fill(ITEMS[id].effect, g); }
export function mutName(id, m) { return ITEMS[id].muts[m][0]; }
export function mutText(id, m, g = 2) { return fill(ITEMS[id].muts[m][1], g); }

const ROMAN = ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ', 'Ⅷ', 'Ⅸ', 'Ⅹ'];
export function roman(g) { return ROMAN[g - 1] ?? String(g); }
export function gradeLabel(g) {
  return g <= 1 ? '하급' : g === 2 ? '중급' : g === 3 ? '상급' : '최상급';
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
const inside = (dim, x, y) => x >= 0 && y >= 0 && x < dim.cols && y < dim.rows;

export function occupancy(dim, pieces, ignoreUid) {
  const grid = Array.from({ length: dim.rows }, () => Array(dim.cols).fill(null));
  for (const p of pieces) {
    if (p.uid === ignoreUid) continue;
    for (const [x, y] of cellsOf(p)) if (inside(dim, x, y)) grid[y][x] = p.uid;
  }
  return grid;
}

export function canPlace(dim, pieces, piece, ignoreUid, sealed = []) {
  const grid = occupancy(dim, pieces, ignoreUid);
  const seal = new Set(sealed);
  return cellsOf(piece).every(([x, y]) => inside(dim, x, y) && grid[y][x] === null && !seal.has(key(x, y)));
}

export function anyFit(dim, pieces, id, sealed = []) {
  return !!findSpot(dim, pieces, id, sealed);
}

export function findSpot(dim, pieces, id, sealed = [], rots = [0, 1, 2, 3]) {
  for (const rot of rots)
    for (let y = 0; y < dim.rows; y++)
      for (let x = 0; x < dim.cols; x++)
        if (canPlace(dim, pieces, { uid: -1, id, x, y, rot }, undefined, sealed)) return { x, y, rot };
  return null;
}

export function neighborsOf(dim, pieces) {
  const grid = occupancy(dim, pieces);
  const map = new Map(pieces.map((p) => [p.uid, new Set()]));
  for (const p of pieces) {
    for (const [x, y] of cellsOf(p)) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (!inside(dim, nx, ny)) continue;
        const o = grid[ny][nx];
        if (o !== null && o !== p.uid) map.get(p.uid).add(o);
      }
    }
  }
  return map;
}

/* ---------- 손님 ---------- */

export const CUSTOMERS = {
  adventurers: { name: '모험가 원정대', text: '모험 장비 상품마다 +2×등급', fav: 'gear' },
  witches: { name: '마녀 모임', text: '연금술 상품마다 +2×등급', fav: 'alch' },
  school: { name: '마법학교 구매단', text: '마법 잡화 상품마다 +2×등급', fav: 'magic' },
  goblins: { name: '고블린 행상단', text: '같은 상품이 2개 이상이면 그 상품마다 +3' },
  noble: { name: '귀족 수집가', text: '중급 이상 상품마다 +6×(등급-1)' },
  wanderers: { name: '떠돌이 시장 손님', text: '진열된 상품 종류마다 +3' },
};
export const CUSTOMER_IDS = Object.keys(CUSTOMERS);

/* ---------- 하루 매출 ---------- */

// ctx: { dim, customer, mods, mutations, regulars, sealed }
//   mods.catFlat / catLabel: 계약의 분야별 가감, mods.perma: 결산 성장, mods.noCustomer,
//   mods.customerMul: 손님 보너스 배수(마왕의 홍보), mods.baseCut: 상품마다 기본 매출에서 빼는 값
// 결과: { items: Map(uid → { base, bonuses: [{ label, amount, kind, from }], total }), sum }
export function evaluate(pieces, ctx) {
  const { dim, customer = null, mods = {}, mutations = {}, regulars = [], sealed = [] } = ctx;
  const byUid = new Map(pieces.map((p) => [p.uid, p]));
  const nbr = neighborsOf(dim, pieces);
  const grid = occupancy(dim, pieces);
  const seal = new Set(sealed);
  const out = new Map();
  for (const p of pieces) out.set(p.uid, { base: gradeBase(p.id, p.g), bonuses: [], total: 0 });
  const add = (uid, label, amount, kind, from = []) => {
    if (amount) out.get(uid).bonuses.push({ label, amount, kind, from });
  };
  const near = (uid) => [...nbr.get(uid)].map((u) => byUid.get(u));
  const cat = (p) => ITEMS[p.id].cat;
  const mut = (p) => (p.g >= 2 ? mutations[p.id] ?? null : null);
  const isEmpty = (x, y) => inside(dim, x, y) && grid[y][x] === null && !seal.has(key(x, y));
  const emptyAround = (p) => {
    const own = new Set(cellsOf(p).map(([x, y]) => key(x, y)));
    const e = new Set();
    for (const [x, y] of cellsOf(p))
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = key(x + dx, y + dy);
        if (!own.has(k) && isEmpty(x + dx, y + dy)) e.add(k);
      }
    return e.size;
  };
  // 1칸 상품의 네 방향이 모두 상품인지(진열대 밖·빈칸·봉인은 아님)
  const surrounded = (p, notId = null) => {
    const [[x, y]] = cellsOf(p);
    return [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => {
      if (!inside(dim, x + dx, y + dy)) return false;
      const o = grid[y + dy][x + dx];
      return o !== null && (!notId || byUid.get(o).id !== notId);
    });
  };
  const kindsOf = (list) => new Set(list.map((q) => q.id));
  const isEdgePiece = (p) => cellsOf(p).some(([x, y]) => x === 0 || y === 0 || x === dim.cols - 1 || y === dim.rows - 1);

  // 다른 상품에 주는 효과: 같은 이름은 한 상품에 한 번, 가장 큰 값만
  const ext = new Map();
  const give = (target, label, amount, kind, src) => {
    const k = `${target.uid}|${label}`;
    const cur = ext.get(k);
    if (!cur || amount > cur.amount) ext.set(k, { uid: target.uid, label, amount, kind, from: [src.uid] });
    else if (amount === cur.amount) cur.from.push(src.uid);
  };
  const aura = (src, label, perG, ok, kind = 'place') => {
    for (const q of near(src.uid)) if (ok(q)) give(q, label, perG * src.g, kind, src);
  };
  const focus = (src, label, perG, ok, kind) => {
    const ts = near(src.uid).filter(ok).sort((a, b) => b.g - a.g || a.uid - b.uid);
    if (ts.length) give(ts[0], label, perG * src.g, kind, src);
  };

  for (const p of pieces) {
    const n = near(p.uid);
    const g = p.g;
    const u = p.uid;
    const from = (list) => list.map((q) => q.uid);
    switch (p.id) {
      case 'mana': { const m = n.filter((q) => cat(q) === 'magic'); if (m.length) add(u, '마법 잡화', 3 * g, 'place', from(m)); break; }
      case 'poison': {
        const k = kindsOf(n.filter((q) => cat(q) === 'alch' && q.id !== 'poison'));
        add(u, '연금술 이웃', Math.min(k.size, 3) * g, 'place', from(n.filter((q) => k.has(q.id))));
        break;
      }
      case 'herb': aura(p, '약초', 2, (q) => q.id === 'potion' || q.id === 'mana'); break;
      case 'mushroom': { const m = n.filter((q) => q.id === 'mushroom'); add(u, '버섯 군생', Math.min(m.length, 3) * g, 'place', from(m)); break; }
      case 'cauldron': {
        const k = kindsOf(n.filter((q) => cat(q) === 'alch' && q.id !== 'cauldron'));
        add(u, '연금술 이웃', Math.min(k.size, 3) * 2 * g, 'place', from(n.filter((q) => k.has(q.id))));
        break;
      }
      case 'spirit': { const m = n.filter((q) => SUPPORT.has(q.id)); if (m.length) add(u, '지원 상품', 3 * g, 'place', from(m)); break; }
      case 'phoenix': if (emptyAround(p) > 0) add(u, '빈칸', 4 * g, 'place'); break;
      case 'shield': if (isEdgePiece(p)) add(u, '가장자리', 3 * g, 'place'); break;
      case 'boots': {
        const k = kindsOf(n.filter((q) => cat(q) === 'gear' && q.id !== 'boots'));
        if (k.size >= 2) add(u, '장비 이웃', 4 * g, 'place', from(n.filter((q) => k.has(q.id))));
        break;
      }
      case 'bow': if (bowClear(p, dim, isEmpty)) add(u, '빈 사로', 4 * g, 'place'); break;
      case 'whetstone': aura(p, '숫돌', 3, (q) => q.id === 'sword' || q.id === 'bow'); break;
      case 'pack': { const c = new Set(n.map(cat)); add(u, '여러 분야', Math.min(c.size, 3) * 2 * g, 'place', from(n)); break; }
      case 'spear': { const ch = spearChain(p, dim, grid, byUid); add(u, '창끝 장비', ch.length * 3 * g, 'place', from(ch)); break; }
      case 'orb': {
        const k = kindsOf(n.filter((q) => cat(q) === 'magic' && q.id !== 'orb'));
        add(u, '마법 이웃', Math.min(k.size, 3) * 2 * g, 'place', from(n.filter((q) => k.has(q.id))));
        break;
      }
      case 'charm': {
        const cs = n.map(cat);
        if (n.length >= 2 && new Set(cs).size === cs.length) add(u, '다른 분야들', 4 * g, 'place', from(n));
        break;
      }
      case 'candle': aura(p, '촛대', 3, (q) => q.id === 'tome' || q.id === 'orb'); break;
      case 'doll': if (!n.some((q) => q.id === 'doll')) add(u, '홀로', 3 * g, 'place'); break;
      case 'rune': if (n.some((q) => cat(q) === 'alch') && n.some((q) => cat(q) === 'gear')) add(u, '두 분야 연결', 5 * g, 'place', from(n)); break;
      case 'pouch': if (new Set(n.map((q) => q.g)).size >= 2) add(u, '여러 등급', 4 * g, 'place', from(n)); break;
      case 'chest': if (surrounded(p)) add(u, '둘러싸임', 6 * g, 'place', from(n)); break;
    }

    // 변이(2등급 이상, 상품 종류 전체에 적용)
    const m = mut(p);
    if (!m) continue;
    const label = mutName(p.id, m);
    const self = (amount, fromList = []) => add(u, label, amount, 'mut', from(fromList));
    const alchKinds = kindsOf(n.filter((q) => cat(q) === 'alch' && q.id !== p.id));
    switch (`${p.id}:${m}`) {
      case 'potion:A': self(2 * g); break;
      case 'potion:B': aura(p, label, 2, (q) => q.id === 'potion', 'mut'); break;
      case 'mana:A': self(2 * g); break;
      case 'mana:B': aura(p, label, 1, (q) => cat(q) === 'magic', 'mut'); break;
      case 'poison:A': if (kindsOf(pieces.filter((q) => cat(q) === 'alch')).size <= 3) self(4 * g); break;
      case 'poison:B': self(Math.min(alchKinds.size, 3) * g); break;
      case 'herb:A': focus(p, label, 4, (q) => q.id === 'potion' || q.id === 'mana', 'mut'); break;
      case 'herb:B': aura(p, label, 1, (q) => cat(q) === 'alch' && q.id !== 'herb', 'mut'); break;
      case 'mushroom:A': self(Math.min(n.filter((q) => q.id === 'mushroom').length, 3) * g); break;
      case 'mushroom:B': aura(p, label, 1, (q) => cat(q) === 'alch' && q.id !== 'mushroom', 'mut'); break;
      case 'cauldron:A': self(Math.min(alchKinds.size, 3) * g); break;
      case 'cauldron:B': aura(p, label, 2, (q) => cat(q) === 'alch' && q.id !== 'cauldron', 'mut'); break;
      case 'spirit:A': self(3 * g); break;
      case 'spirit:B': aura(p, label, 2, (q) => SUPPORT.has(q.id), 'mut'); break;
      case 'phoenix:A': if (emptyAround(p) >= 2) self(3 * g); break;
      case 'phoenix:B': aura(p, label, 1, () => true, 'mut'); break;
      case 'sword:A': if (customer === 'noble' && !mods.noCustomer) self(6 * g); break;
      case 'sword:B': if (customer === 'adventurers' && !mods.noCustomer) self(4 * g); break;
      case 'shield:A': if (isEdgePiece(p)) self(3 * g); break;
      case 'shield:B': aura(p, label, 2, (q) => cat(q) === 'gear' && q.id !== 'shield', 'mut'); break;
      case 'boots:A': if (cellsOf(p).some(([, y]) => y === dim.rows - 1)) self(4 * g); break;
      case 'boots:B': aura(p, label, 1, (q) => cat(q) === 'gear' && q.id !== 'boots', 'mut'); break;
      case 'bow:A': if (bowClear(p, dim, isEmpty)) self(3 * g); break;
      case 'bow:B': { const gs = n.filter((q) => cat(q) === 'gear'); self(Math.min(gs.length, 2) * 2 * g, gs); break; }
      case 'whetstone:A': focus(p, label, 4, (q) => q.id === 'sword' || q.id === 'bow', 'mut'); break;
      case 'whetstone:B': aura(p, label, 1, (q) => cat(q) === 'gear' && q.id !== 'whetstone', 'mut'); break;
      case 'armor:A': self(4 * g); break;
      case 'armor:B': aura(p, label, 1, (q) => cat(q) === 'gear' && q.id !== 'armor', 'mut'); break;
      case 'pack:A': if (n.filter((q) => cat(q) === 'gear').length >= 3) self(4 * g); break;
      case 'pack:B': self(Math.min(new Set(n.map(cat)).size, 3) * g); break;
      case 'spear:A': self(3 * g); break;
      case 'spear:B': self(spearChain(p, dim, grid, byUid).length * g); break;
      case 'tome:A': self(3 * g); break;
      case 'tome:B': aura(p, label, 2, (q) => cat(q) === 'magic' && q.id !== 'tome', 'mut'); break;
      case 'orb:A': self(2 * g); break;
      case 'orb:B': aura(p, label, 1, (q) => cat(q) === 'magic' && q.id !== 'orb', 'mut'); break;
      case 'charm:A': self(3 * g); break;
      case 'charm:B': aura(p, label, 1, () => true, 'mut'); break;
      case 'candle:A': focus(p, label, 4, (q) => q.id === 'tome' || q.id === 'orb', 'mut'); break;
      case 'candle:B': aura(p, label, 1, (q) => cat(q) === 'magic' && q.id !== 'candle', 'mut'); break;
      case 'doll:A': self(Math.min(emptyAround(p), 4) * g); break;
      case 'doll:B': if (surrounded(p, 'doll')) self(5 * g); break;
      case 'rune:A': self(3 * g); break;
      case 'rune:B': aura(p, label, 2, (q) => cat(q) !== 'magic', 'mut'); break;
      case 'pouch:A': self(3 * g); break;
      case 'pouch:B': aura(p, label, 1, () => true, 'mut'); break;
      case 'chest:A': if (surrounded(p)) self(6 * g); break;
      case 'chest:B': if (surrounded(p)) aura(p, label, 2, () => true, 'mut'); break;
    }
  }
  for (const e of ext.values()) add(e.uid, e.label, e.amount, e.kind, e.from);

  // 특별 손님
  if (customer && !mods.noCustomer) {
    const c = CUSTOMERS[customer];
    const mul = mods.customerMul ?? 1;
    const per = customer === 'school' && regulars.includes('school') ? 3 : 2;
    if (c.fav) for (const p of pieces) if (cat(p) === c.fav) add(p.uid, c.name, per * p.g * mul, 'customer');
    if (customer === 'goblins') {
      const count = {};
      pieces.forEach((p) => { count[p.id] = (count[p.id] ?? 0) + 1; });
      for (const p of pieces) if (count[p.id] >= 2) add(p.uid, c.name, 3 * mul, 'customer');
    }
    if (customer === 'noble') for (const p of pieces) if (p.g >= 2) add(p.uid, c.name, 6 * (p.g - 1) * mul, 'customer');
    if (customer === 'wanderers') {
      const seen = new Set();
      for (const p of pieces) if (!seen.has(p.id)) { seen.add(p.id); add(p.uid, c.name, 3 * mul, 'customer'); }
    }
  }

  // 계약과 결산 성장
  for (const p of pieces) {
    const c = cat(p);
    if (mods.catFlat?.[c]) add(p.uid, mods.catLabel?.[c] ?? '계약', mods.catFlat[c], 'contract');
    if (mods.baseCut) add(p.uid, mods.baseCutLabel ?? '계약', -mods.baseCut, 'contract');
    if (mods.perma?.[c]) add(p.uid, `${CATS[c].name} 강화`, mods.perma[c], 'contract');
    if (p.bless) add(p.uid, '기적', p.bless, 'contract');
  }

  // 0 아래로는 내려가지 않는다. 잘린 만큼은 계약 쪽에서 덜어 낸 것으로 본다.
  const sum = { base: 0, place: 0, mut: 0, customer: 0, contract: 0, total: 0 };
  for (const r of out.values()) {
    const raw = r.base + r.bonuses.reduce((s, b) => s + b.amount, 0);
    r.total = Math.max(0, raw);
    sum.base += r.base;
    for (const b of r.bonuses) sum[b.kind] += b.amount;
    if (raw < 0) sum.contract -= raw;
  }
  sum.total = [...out.values()].reduce((a, r) => a + r.total, 0);
  return { items: out, sum };
}

// 사냥활: 긴 변 한쪽(진열대 안)이 모두 빈칸인지
function bowClear(p, dim, isEmpty) {
  const cells = cellsOf(p);
  const vertical = cells.every(([x]) => x === cells[0][0]);
  const sides = vertical ? [[-1, 0], [1, 0]] : [[0, -1], [0, 1]];
  return sides.some(([dx, dy]) => cells.every(([x, y]) => isEmpty(x + dx, y + dy)));
}

// 용의 창: 창끝 방향으로 이어진 장비(서로 다른 상품, 최대 2개)
export function spearDir(rot) {
  return [[1, 0], [0, 1], [-1, 0], [0, -1]][((rot % 4) + 4) % 4];
}
function spearChain(p, dim, grid, byUid) {
  const [dx, dy] = spearDir(p.rot);
  const cells = cellsOf(p);
  const tip = cells.reduce((best, c) => (c[0] * dx + c[1] * dy > best[0] * dx + best[1] * dy ? c : best));
  const chain = [];
  let [x, y] = tip;
  for (let i = 0; i < 6 && chain.length < 2; i++) {
    x += dx; y += dy;
    if (!inside(dim, x, y)) break;
    const o = grid[y][x];
    if (o === null) break;
    const q = byUid.get(o);
    if (ITEMS[q.id].cat !== 'gear') break;
    if (!chain.includes(q)) chain.push(q);
  }
  return chain;
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
