import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canPlace, cellsOf, evaluate, gradeBase, shapeOf, sizeOf, START_SIZE } from '../js/rules.js';
import * as G from '../js/game.js';

const dim = { cols: 5, rows: 4 };
let uid = 0;
const P = (id, x, y, rot = 0, g = 1) => ({ uid: ++uid, id, x, y, rot, g });
const ev = (pieces, customer = null, mods = {}) => evaluate(pieces, { dim, customer, mods });
const tot = (pieces, p, ...rest) => ev(pieces, ...rest).items.get(p.uid).total;

test('회전한 모양과 차지하는 칸이 일치한다', () => {
  assert.deepEqual(shapeOf('bow', 1), [[0, 0], [0, 1], [0, 2]]);
  assert.deepEqual(sizeOf('boots', 1), { w: 2, h: 2 });
  assert.deepEqual(cellsOf(P('candle', 2, 1, 1)), [[2, 1], [3, 1]]);
});

test('겹치기·진열대 밖·봉인 칸에는 놓을 수 없다', () => {
  const a = P('shield', 0, 0);
  assert.equal(canPlace(dim, [a], P('potion', 1, 1)), false);
  assert.equal(canPlace(dim, [a], P('potion', 2, 1)), true);
  assert.equal(canPlace(dim, [], P('bow', 3, 0)), false);
  assert.equal(canPlace(dim, [], P('potion', 2, 2), undefined, ['2,2']), false);
});

test('등급 기본 매출은 약 2.4배, 하위 셋보다 작다', () => {
  assert.equal(gradeBase('potion', 1), 3);
  assert.equal(gradeBase('potion', 2), 7);
  assert.equal(gradeBase('potion', 3), 17);
  assert.ok(gradeBase('bow', 2) < 3 * gradeBase('bow', 1));
});

test('약초 두 개 옆 물약도 약초 보너스는 한 번, 높은 등급 기준', () => {
  const potion = P('potion', 1, 1);
  const pieces = [potion, P('herb', 0, 1), P('herb', 2, 1, 0, 2)];
  assert.equal(tot(pieces, potion), 3 + 4);
});

test('저주 인형은 이웃을 깎되 0 아래로는 안 내려간다', () => {
  const herb = P('herb', 0, 0);
  const doll = P('doll', 1, 0);
  const r = ev([herb, doll]);
  assert.equal(r.items.get(herb.uid).total, 0);
  assert.equal(r.items.get(doll.uid).total, 9);
  assert.equal(r.sum.total, 9);
});

test('손님 보너스: 원정대·고블린·귀족·떠돌이', () => {
  const sword = P('sword', 0, 0), sword2 = P('sword', 1, 0), orb = P('orb', 2, 0, 0, 2);
  const pieces = [sword, sword2, orb];
  assert.equal(tot(pieces, sword, 'adventurers'), 5 + 2);
  assert.equal(tot(pieces, sword, 'goblins'), 5 + 3);
  assert.equal(tot(pieces, orb, 'goblins'), gradeBase('orb', 2));
  assert.equal(tot(pieces, orb, 'noble'), gradeBase('orb', 2) + 6);
  assert.equal(ev(pieces, 'wanderers').sum.customer, 6);
  assert.equal(ev(pieces, 'witches', { noCustomer: true }).sum.customer, 0);
});

test('합성: 같은 상품·같은 등급 3개 → 한 등급 위, 기준 자리에 남는다', () => {
  const s = G.newGame(11);
  s.phase = 'arrange';
  s.pieces = [P('potion', 0, 0), P('potion', 2, 2), P('potion', 4, 3), P('potion', 1, 0, 0, 2)];
  const target = s.pieces[1].uid;
  assert.ok(G.merge(s, target));
  assert.equal(s.pieces.length, 2);
  const m = s.pieces.find((p) => p.uid === target);
  assert.deepEqual([m.g, m.x, m.y], [2, 2, 2]);
  assert.ok(G.undo(s));
  assert.equal(s.pieces.length, 4);
});

test('손에 든 새 상품도 합성 재료가 된다', () => {
  const s = G.newGame(12);
  s.pieces = [P('herb', 0, 0), P('herb', 1, 0)];
  s.phase = 'place';
  s.hand = { id: 'herb', g: 1, rot: 0 };
  assert.ok(G.mergePlan(s, 'hand'));
  assert.ok(G.merge(s, 'hand'));
  assert.equal(s.pieces.length, 0);
  assert.equal(s.hand.g, 2);
});

test('납부 미달이면 불꽃 하나, 잔금은 늘지 않고 유예를 받는다', () => {
  const s = G.newGame(3);
  s.phase = 'arrange';
  s.pieces = [];
  const r = G.openShop(s);
  assert.equal(r.ok, false);
  assert.equal(s.lives, 2);
  assert.equal(s.balance, 0);
  assert.equal(s.grace, true);
  assert.equal(G.rerollCost(s), 0);
  assert.equal(G.openShop(s), null);
});

test('정상 납부하면 초과분이 잔금이 된다', () => {
  const s = G.newGame(4);
  s.phase = 'arrange';
  s.pieces = [P('shield', 0, 0), P('bow', 2, 0)];
  const sales = G.income(s).sum.total;
  const pay = G.payFor(s);
  const r = G.openShop(s);
  assert.ok(r.ok);
  assert.equal(s.balance, sales - pay);
  assert.equal(s.day, 2);
});

test('불꽃이 모두 꺼지면 끝난다', () => {
  const s = G.newGame(5);
  for (let i = 0; i < 3; i++) { while (s.phase !== 'arrange') G.skip(s); G.openShop(s); }
  assert.equal(s.phase, 'over');
  assert.equal(s.lives, 0);
});

test('되돌리기로 잔금이나 상품을 복제할 수 없다', () => {
  const s = G.newGame(6);
  s.balance = 20;
  assert.ok(G.reroll(s));
  const after = s.balance;
  assert.ok(G.undo(s));
  assert.equal(s.balance, 20);
  assert.ok(G.reroll(s));
  assert.equal(s.balance, after);
});

test('저장한 상태로 이어 해도 후보·손님이 같다', () => {
  const a = G.newGame(77);
  const b = JSON.parse(JSON.stringify(a));
  G.choose(a, 0); G.skip(a);
  G.choose(b, 0); G.skip(b);
  assert.deepEqual(a.offers, b.offers);
  assert.equal(G.customerOn(a, 9), G.customerOn(b, 9));
});

test('계약: 동시에 두 개까지, 불꽃 1개면 영혼 담보 없음, 봉인 칸엔 못 놓음', () => {
  const s = G.newGame(8);
  s.phase = 'arrange';
  s.contractOffer = { ids: ['seal', 'goblinloan', 'accountant'], cells: ['0,0', '1,0', '2,0'] };
  assert.ok(G.sign(s, 'seal'));
  assert.equal(canPlace(s.dim, s.pieces, P('potion', 0, 0), undefined, G.sealedNow(s)), false);
  const payToday = G.payFor(s);
  assert.equal(payToday, Math.max(1, Math.round(G.basePay(s.day) * 0.7)));
  s.contractOffer = { ids: ['goblinloan', 'accountant', 'rush'], cells: null };
  assert.ok(G.sign(s, 'goblinloan'));
  s.contractOffer = { ids: ['accountant'], cells: null };
  assert.equal(G.canSign(s, 'accountant').ok, false);
  s.lives = 1;
  s.contracts = [];
  s.contractOffer = { ids: ['soul'], cells: null };
  assert.equal(G.canSign(s, 'soul').ok, false);
});

test('진열대는 정해진 크기까지만 커진다', () => {
  const s = G.newGame(9);
  s.phase = 'arrange';
  s.balance = 10000;
  let n = 0;
  while (G.buyExpand(s)) n++;
  assert.equal(n, 4);
  assert.deepEqual(s.dim, { cols: 7, rows: 6 });
  assert.equal(G.expandCost(s), null);
  assert.deepEqual(G.newGame(1).dim, START_SIZE);
});
