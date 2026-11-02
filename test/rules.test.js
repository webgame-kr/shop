import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canPlace, cellsOf, dailyIncome, evaluate, shapeOf, sizeOf } from '../js/rules.js';
import * as G from '../js/game.js';

let uid = 0;
const P = (id, x, y, rot = 0) => ({ uid: ++uid, id, x, y, rot });
const totals = (pieces) => pieces.map((p) => evaluate(pieces).get(p.uid).total);

test('회전한 모양과 차지하는 칸이 일치한다', () => {
  assert.deepEqual(shapeOf('fish', 1), [[0, 0], [0, 1], [0, 2]]);
  assert.deepEqual(sizeOf('tshirt', 1), { w: 2, h: 2 });
  assert.deepEqual(shapeOf('tshirt', 0), [[0, 0], [0, 1], [1, 1]]);
  assert.deepEqual(shapeOf('tshirt', 1), [[0, 0], [1, 0], [0, 1]]);
  assert.deepEqual(shapeOf('tshirt', 4), shapeOf('tshirt', 0));
  assert.deepEqual(cellsOf(P('safe', 2, 1, 1)), [[2, 1], [3, 1], [4, 1]]);
});

test('겹치거나 진열대 밖으로 나가면 놓을 수 없다', () => {
  const a = P('fridge', 0, 0);
  assert.equal(canPlace([a], P('apple', 1, 1)), false);
  assert.equal(canPlace([a], P('apple', 2, 1)), true);
  assert.equal(canPlace([], P('fish', 4, 0)), false);
  assert.equal(canPlace([], P('safe', 0, 3)), false);
  assert.equal(canPlace([], P('safe', 3, 4, 1)), true);
});

test('대각선은 인접이 아니다', () => {
  const ps = [P('bread', 0, 0), P('milk', 2, 1)];
  assert.deepEqual(totals(ps), [4, 4]);
});

test('빵과 우유', () => {
  const ps = [P('bread', 0, 0), P('milk', 2, 0)];
  assert.deepEqual(totals(ps), [7, 6]);
});

test('사과는 이웃 사과 최대 +2, 냉장고 두 개여도 +2 한 번', () => {
  const ps = [P('apple', 2, 2), P('apple', 1, 2), P('apple', 3, 2), P('apple', 2, 1), P('fridge', 2, 3), P('fridge', 0, 0)];
  const ev = evaluate(ps);
  assert.equal(ev.get(ps[0].uid).total, 2 + 2 + 2);
  // (2,1) 사과: 아래 사과 하나 + 왼쪽 냉장고(0,0~1,1) → 2+1+2
  assert.equal(ev.get(ps[3].uid).total, 5);
  const milk = P('milk', 2, 0);
  const two = [P('fridge', 0, 0), milk, P('fridge', 3, 0)];
  assert.equal(evaluate(two).get(milk.uid).total, 6);
});

test('간판은 다른 간판에 주지 않고, 두 간판이어도 +1', () => {
  const bread = P('bread', 2, 1);
  const s1 = P('sign', 2, 0), s2 = P('sign', 2, 2), s3 = P('sign', 0, 0);
  const ev = evaluate([bread, s1, s2, s3]);
  assert.equal(ev.get(bread.uid).total, 5);
  assert.equal(ev.get(s1.uid).total, 1);
  assert.equal(ev.get(s3.uid).total, 1);
});

test('향수·티셔츠, 보석함·금고, 화분, 운동화', () => {
  const t1 = P('tshirt', 0, 0), pf = P('perfume', 1, 0);
  let ev = evaluate([t1, pf]);
  assert.equal(ev.get(t1.uid).total, 10);
  assert.equal(ev.get(pf.uid).total, 3);

  const j = P('jewel', 0, 0), s = P('safe', 2, 0), j2 = P('jewel', 3, 0);
  ev = evaluate([j, s, j2]);
  assert.equal(ev.get(s.uid).total, 7);
  assert.equal(ev.get(j.uid).total, 15);

  const plant = P('plant', 2, 2);
  ev = evaluate([plant, P('apple', 1, 2), P('apple', 3, 2), P('bread', 2, 3)]);
  assert.equal(ev.get(plant.uid).total, 1);
  ev = evaluate([plant, P('apple', 1, 2), P('perfume', 3, 2), P('bread', 2, 3)]);
  assert.equal(ev.get(plant.uid).total, 6);

  assert.equal(evaluate([P('sneakers', 0, 2)]).values().next().value.total, 7);
  assert.equal(evaluate([P('sneakers', 2, 2)]).values().next().value.total, 5);
});

test('보너스는 다른 보너스의 기준이 되지 않는다(정수 덧셈)', () => {
  const ps = [P('bread', 0, 0), P('milk', 2, 0), P('sign', 0, 1)];
  // 간판(0,1)-(1,1)은 빵과 우유(2,1) 모두에 닿는다
  assert.equal(dailyIncome(ps), (7 + 1) + (6 + 1) + 1);
});

test('한 판: 첫 후보, 넘기기, 되돌리기, 정산은 한 번만', () => {
  const s = G.newGame(42);
  assert.deepEqual(s.offers, ['apple', 'bread', 'milk']);
  assert.equal(G.canOpen(s), false);
  G.choose(s, 1);
  assert.equal(G.placeHand(s, 5, 0, 0), false);
  assert.ok(G.placeHand(s, 0, 0, 0));
  const offers = s.offers.slice();
  assert.equal(new Set(offers).size, 3);
  G.choose(s, 0);
  assert.ok(G.undo(s));
  assert.deepEqual(s.offers, offers);
  assert.ok(G.skip(s));
  assert.ok(G.canOpen(s));
  const r = G.openShop(s);
  assert.equal(r.income, 4);
  assert.equal(G.openShop(s), null);
  assert.equal(s.total, 4);
  assert.equal(s.day, 2);
  assert.equal(G.canUndo(s), false);
});

test('저장한 상태로 이어 해도 후보가 같다', () => {
  const a = G.newGame(7);
  G.choose(a, 0); G.placeHand(a, 0, 0, 0);
  const b = JSON.parse(JSON.stringify(a));
  G.choose(a, 0); G.skip(a); G.openShop(a);
  G.choose(b, 0); G.skip(b); G.openShop(b);
  assert.deepEqual(a.offers, b.offers);
});

test('8일이 지나면 끝난다', () => {
  const s = G.newGame(3);
  for (let d = 0; d < 8; d++) { G.skip(s); G.skip(s); G.openShop(s); }
  assert.equal(s.phase, 'over');
  assert.equal(s.history.length, 8);
});
