import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ITEMS, ITEM_IDS, canPlace, cellsOf, evaluate, gradeBase, shapeOf, START_SIZE } from '../js/rules.js';
import * as G from '../js/game.js';

const dim = { cols: 5, rows: 4 };
let uid = 0;
const P = (id, x, y, rot = 0, g = 1) => ({ uid: ++uid, id, x, y, rot, g });
const ev = (pieces, extra = {}) => evaluate(pieces, { dim, ...extra });
const tot = (pieces, p, extra) => ev(pieces, extra).items.get(p.uid).total;
const arrange = (seed) => { const s = G.newGame(seed); s.phase = 'arrange'; s.offers = null; s.contractOffer = null; return s; };

test('상품 24종, 분야별 8종', () => {
  assert.equal(ITEM_IDS.length, 24);
  for (const c of ['alch', 'gear', 'magic']) assert.equal(ITEM_IDS.filter((id) => ITEMS[id].cat === c).length, 8);
  for (const id of ITEM_IDS) assert.ok(ITEMS[id].muts.A && ITEMS[id].muts.B, id);
});

test('회전한 모양과 차지하는 칸이 일치한다', () => {
  assert.deepEqual(shapeOf('bow', 1), [[0, 0], [1, 0], [2, 0]]);
  assert.deepEqual(shapeOf('spear', 1), [[0, 0], [0, 1], [0, 2]]);
  assert.deepEqual(cellsOf(P('pack', 2, 1, 1)), [[2, 1], [3, 1]]);
});

test('겹치기·진열대 밖·봉인 칸에는 놓을 수 없다', () => {
  const a = P('armor', 0, 0);
  assert.equal(canPlace(dim, [a], P('potion', 1, 1)), false);
  assert.equal(canPlace(dim, [a], P('potion', 2, 1)), true);
  assert.equal(canPlace(dim, [], P('bow', 3, 2)), false);
  assert.equal(canPlace(dim, [], P('potion', 2, 2), undefined, ['2,2']), false);
});

test('등급 기본 매출은 약 2.4배, 하위 셋보다 작다', () => {
  assert.equal(gradeBase('potion', 2), 7);
  assert.ok(gradeBase('armor', 2) < 3 * gradeBase('armor', 1));
});

test('약초 두 개 옆 물약도 약초 보너스는 한 번, 높은 등급 기준', () => {
  const potion = P('potion', 1, 1);
  assert.equal(tot([potion, P('herb', 0, 1), P('herb', 2, 1, 0, 2)], potion), 3 + 4);
});

test('신규 상품 효과: 정령수·불사조 재·용의 창·룬석·봉인 상자', () => {
  const spirit = P('spirit', 1, 1);
  assert.equal(tot([spirit, P('herb', 0, 1)], spirit), 3 + 3);
  const ph = P('phoenix', 0, 0);
  assert.equal(tot([ph], ph), 8 + 4);
  // 창끝(오른쪽)으로 숫돌·검이 이어지면 2개까지
  const spear = P('spear', 0, 0);
  assert.equal(tot([spear, P('whetstone', 3, 0), P('sword', 4, 0)], spear), 7 + 6);
  assert.equal(tot([spear, P('potion', 3, 0), P('sword', 4, 0)], spear), 7);
  const rune = P('rune', 1, 1);
  assert.equal(tot([rune, P('potion', 0, 1), P('whetstone', 2, 1)], rune), 3 + 5);
  const chest = P('chest', 1, 1);
  const ring = [P('potion', 0, 1), P('potion', 2, 1), P('herb', 1, 0), P('herb', 1, 2)];
  assert.equal(tot([chest, ...ring], chest), 3 + 6);
  assert.equal(tot([chest, ...ring.slice(1)], chest), 3);
});

test('지원 효과는 받은 보너스를 다시 키우지 않는다', () => {
  // 공유 가마(변이)가 약초 받은 물약을 지원해도 기본·등급만 본다
  const potion = P('potion', 1, 0);
  const pieces = [potion, P('herb', 0, 0), P('cauldron', 2, 0, 0, 2)];
  const r = ev(pieces, { mutations: { cauldron: 'B' } }).items.get(potion.uid);
  assert.equal(r.total, 3 + 2 + 4);
});

test('변이는 Ⅱ등급 이상에만, 종류 전체에 적용', () => {
  const a = P('potion', 0, 0, 0, 2), b = P('potion', 1, 0, 0, 1);
  const r = ev([a, b], { mutations: { potion: 'A' } });
  assert.equal(r.items.get(a.uid).total, gradeBase('potion', 2) + 4);
  assert.equal(r.items.get(b.uid).total, 3);
  assert.equal(r.sum.mut, 4);
});

test('손님 보너스와 마왕의 홍보(2배, 기본 -1, 0 아래로는 안 내려감)', () => {
  const sword = P('sword', 0, 0), herb = P('herb', 2, 0);
  const pieces = [sword, herb];
  assert.equal(tot(pieces, sword, { customer: 'adventurers' }), 5 + 2);
  assert.equal(tot(pieces, sword, { customer: 'adventurers', mods: { customerMul: 2, baseCut: 1 } }), 5 + 4 - 1);
  assert.equal(tot(pieces, herb, { mods: { baseCut: 3 } }), 0);
});

test('합성 후 처음 Ⅱ등급이면 변이를 고르고, 고르기 전엔 영업할 수 없다', () => {
  const s = arrange(11);
  s.pieces = [P('potion', 0, 0), P('potion', 2, 2), P('potion', 4, 3)];
  const target = s.pieces[1].uid;
  assert.ok(G.merge(s, target));
  assert.equal(s.pendingMutation, 'potion');
  assert.equal(G.canOpen(s), false);
  assert.ok(G.chooseMutation(s, 'B'));
  assert.equal(s.mutations.potion, 'B');
  assert.ok(G.canOpen(s));
  assert.ok(G.undo(s));
  assert.equal(s.pieces.length, 3);
  assert.equal(s.mutations.potion, undefined);
});

test('입고 후보는 서로 다르고 이유가 붙는다', () => {
  const s = arrange(31);
  s.pieces = [P('herb', 0, 0)];
  s.phase = 'pick';
  for (let i = 0; i < 30; i++) {
    const o = G.drawOffers(s);
    assert.equal(new Set(o.map((x) => x.id)).size, 3);
    assert.ok(o.every((x) => ['same', 'guest', 'new'].includes(x.why)));
    assert.equal(o[0].why, 'same');
  }
});

test('우선 입고는 더 자주 나오지만 보장되지 않는다', () => {
  const s = arrange(41);
  s.pieces = [P('herb', 0, 0)];
  let hits = 0;
  s.priority = 'armor';
  for (let i = 0; i < 300; i++) if (G.drawOffers(s).some((o) => o.id === 'armor')) hits++;
  const t = arrange(41);
  t.pieces = [P('herb', 0, 0)];
  let base = 0;
  for (let i = 0; i < 300; i++) if (G.drawOffers(t).some((o) => o.id === 'armor')) base++;
  assert.ok(hits > base, `${hits} > ${base}`);
  assert.ok(hits < 300);
});

test('납부 미달이면 불꽃 하나, 잔금은 늘지 않고 유예를 받는다', () => {
  const s = arrange(3);
  const r = G.openShop(s);
  assert.equal(r.ok, false);
  assert.equal(s.lives, 2);
  assert.equal(s.balance, 0);
  assert.equal(G.rerollCost(s), 0);
});

test('특별 손님 조건을 채우면 호감도, 쌓이면 단골 제안·교체·거절', () => {
  const s = arrange(5);
  s.customers = ['goblins', 'goblins', 'goblins', 'witches'];
  s.pieces = [P('herb', 0, 0), P('herb', 1, 0), P('herb', 2, 0), P('armor', 0, 1), P('shield', 2, 1)];
  G.openShop(s);
  assert.equal(s.favor.goblins, 1);
  s.phase = 'arrange'; s.contractOffer = null;
  G.openShop(s);
  assert.equal(s.regularOffer, 'goblins');
  s.regulars = ['witches', 'school'];
  assert.equal(G.acceptRegular(s), false);
  assert.ok(G.acceptRegular(s, 'school'));
  assert.deepEqual(s.regulars, ['witches', 'goblins']);
  assert.equal(G.rerollCost({ ...s, grace: false, rerolls: 0 }), 2);
});

test('계약: 제안은 유형별 하나씩, 서명하거나 거절해야 영업', () => {
  const s = arrange(21);
  s.day = 3;
  s.balance = 100;
  s.pieces = [P('potion', 0, 0, 0, 2), P('herb', 1, 0)];
  s.mutations = { potion: 'A' };
  s.regulars = ['witches'];
  s.contractOffer = { ids: ['vault', 'seal', 'dept'], data: { vault: { uid: s.pieces[1].uid, gain: 26 }, seal: { cells: ['3,3', '4,3', '2,3'] }, dept: {} } };
  assert.equal(G.canOpen(s), false);
  assert.ok(G.sign(s, 'dept'));
  assert.equal(s.balance, 88);
  assert.equal(G.canOpen(s), true);
});

test('즉시 거래: 금고 털기·재활용(합성의 역연산)·변덕의 서명', () => {
  const s = arrange(22);
  s.balance = 50;
  const herb = P('herb', 0, 0);
  const pot = P('potion', 1, 0, 0, 2);
  s.pieces = [herb, pot];
  s.mutations = { potion: 'A' };
  s.contractOffer = { ids: ['vault'], data: { vault: { uid: herb.uid, gain: 26 } } };
  assert.ok(G.sign(s, 'vault'));
  assert.equal(s.balance, 76);
  assert.equal(s.pieces.length, 1);
  s.contractOffer = { ids: ['recycle'], data: { recycle: { uid: pot.uid, cost: 6 } } };
  assert.ok(G.sign(s, 'recycle'));
  assert.equal(s.pieces.filter((p) => p.id === 'potion' && p.g === 1).length, 3);
  s.contractOffer = { ids: ['whim'], data: { whim: { kind: 'potion', to: 'B', cost: 15 } } };
  assert.ok(G.sign(s, 'whim'));
  assert.equal(s.mutations.potion, 'B');
});

test('빚의 유예: 오늘 깎고 정해진 날 더 낸다', () => {
  const s = arrange(23);
  s.day = 4;
  s.contractOffer = { ids: ['debt'], data: { debt: { cut: 5, repay: 7, due: 7 } } };
  const before = G.payFor(s);
  assert.ok(G.sign(s, 'debt'));
  assert.equal(G.payFor(s), before - 5);
  assert.equal(G.payFor(s, 7), G.basePay(7) + 7);
  assert.equal(G.payFor(s, 6), G.basePay(6));
});

test('조건형: 성공하면 보상, 마감까지 못 하면 계약금만 잃는다', () => {
  const s = arrange(24);
  s.balance = 20;
  s.pieces = ['potion', 'herb', 'mana', 'poison', 'mushroom', 'spirit', 'phoenix', 'orb'].map((id, i) => P(id, i % 5, Math.floor(i / 5)));
  s.contractOffer = { ids: ['dept'], data: { dept: {} } };
  assert.ok(G.sign(s, 'dept'));
  const bal = s.balance;
  const r = G.openShop(s);
  assert.equal(r.condResults[0].result, 'success');
  assert.equal(s.balance, bal + r.gain + 40);
  const t = arrange(25);
  t.balance = 20;
  t.contractOffer = { ids: ['armsfair'], data: { armsfair: {} } };
  assert.ok(G.sign(t, 'armsfair'));
  for (let i = 0; i < 3; i++) { t.phase = 'arrange'; t.contractOffer = null; G.openShop(t); }
  assert.equal(t.contracts.length, 0);
  assert.equal(t.lives, 0);
});

test('저장한 상태로 이어 해도 후보·손님이 같다', () => {
  const a = G.newGame(77);
  const b = JSON.parse(JSON.stringify(a));
  G.choose(a, 0); G.skip(a);
  G.choose(b, 0); G.skip(b);
  assert.deepEqual(a.offers, b.offers);
  assert.equal(G.customerOn(a, 9), G.customerOn(b, 9));
});

test('진열대는 정해진 크기까지만 커진다', () => {
  const s = arrange(9);
  s.balance = 10000;
  let n = 0;
  while (G.buyExpand(s)) n++;
  assert.equal(n, 4);
  assert.deepEqual(s.dim, { cols: 7, rows: 6 });
  assert.deepEqual(G.newGame(1).dim, START_SIZE);
});
