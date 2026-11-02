import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ITEMS, ITEM_IDS, CAT_IDS, CUSTOMERS, canPlace, cellsOf, evaluate, gradeBase, shapeOf, START_SIZE, growthCheck, isEgg, mergeSet } from '../js/rules.js';
import * as G from '../js/game.js';

const dim = { cols: 5, rows: 4 };
let uid = 0;
const P = (id, x, y, rot = 0, g = 1) => ({ uid: ++uid, id, x, y, rot, g });
const ev = (pieces, extra = {}) => evaluate(pieces, { dim, ...extra });
const tot = (pieces, p, extra) => ev(pieces, extra).items.get(p.uid).total;
const arrange = (seed) => { const s = G.newGame(seed); s.phase = 'arrange'; s.offers = null; s.contractOffer = null; return s; };

test('상품 42종: 기존 3분야 8종씩 + 신규 3분야 6종씩', () => {
  assert.equal(ITEM_IDS.length, 42);
  assert.equal(CAT_IDS.length, 6);
  for (const c of ['alch', 'gear', 'magic']) assert.equal(ITEM_IDS.filter((id) => ITEMS[id].cat === c).length, 8);
  for (const c of ['food', 'treasure', 'beast']) assert.equal(ITEM_IDS.filter((id) => ITEMS[id].cat === c).length, 6);
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

test('입고 후보: 1번 시작 분야(단골 전) · 2번 보유 상품 · 3번 새 상품, 중복 없음', () => {
  const s = G.newGame(31, 'food');
  s.pieces = [P('herb', 0, 0)];
  for (let i = 0; i < 30; i++) {
    const o = G.drawOffers(s);
    assert.equal(new Set(o.map((x) => x.id)).size, 3);
    assert.equal(o[0].why, 'start');
    assert.equal(ITEMS[o[0].id].cat, 'food');
    assert.equal(o[1].why, 'same');
  }
  s.main = 'dwarf';
  const o = G.drawOffers(s);
  assert.equal(o[0].why, 'main');
  assert.equal(ITEMS[o[0].id].cat, 'treasure');
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

test('분야형 손님 조건 → 호감도, 단골 제안·첫 단골은 주력·교체하면 호감 0', () => {
  const s = arrange(5);
  s.customers = ['goblins', 'witches', 'goblins', 'witches'];
  s.pieces = [P('herb', 0, 0), P('potion', 1, 0), P('armor', 0, 1)];
  G.openShop(s);
  assert.equal(s.favor.goblins, undefined); // 특별 손님은 단골이 되지 않는다
  s.phase = 'arrange'; s.contractOffer = null;
  G.openShop(s);
  assert.equal(s.favor.witches, 1);
  s.phase = 'arrange'; s.contractOffer = null; s.day = 4;
  G.openShop(s);
  assert.equal(s.regularOffer, 'witches');
  assert.ok(G.acceptRegular(s));
  assert.equal(s.main, 'witches');
  s.regularOffer = 'ogre';
  s.regulars = ['witches', 'school'];
  s.favor.school = 3;
  assert.equal(G.acceptRegular(s), false);
  assert.ok(G.acceptRegular(s, 'school'));
  assert.deepEqual(s.regulars, ['witches', 'ogre']);
  assert.equal(s.favor.school, 0);
  assert.equal(s.main, 'witches');
});

test('마수: 알은 낮은 매출·합성 불가, 조건을 채우면 성장도 +1(둥지 +1, 중첩 없음), 새 매출은 다음 영업부터', () => {
  const egg = { ...P('wyvern', 0, 0), grow: 0 };
  const bread = P('lavabread', 2, 0);
  const nest1 = P('nest', 0, 1), nest2 = P('nest', 2, 2);
  assert.ok(isEgg(egg));
  assert.equal(tot([egg], egg), 2);
  const gc = growthCheck([egg, bread, nest1, nest2], dim);
  assert.deepEqual([gc.get(egg.uid).met, gc.get(egg.uid).gain, gc.get(egg.uid).to], [true, 2, 2]);
  assert.equal(growthCheck([egg], dim).get(egg.uid).gain, 0);
  const s = arrange(6);
  s.customers = ['goblins'];
  s.pieces = [egg, bread];
  const r = G.openShop(s);
  assert.equal(r.perItem[egg.uid], 2);
  assert.equal(s.pieces[0].grow, 1);
  const eggs = [0, 1, 2].map((i) => ({ ...P('slime', i, 3), grow: 0 }));
  assert.equal(mergeSet(eggs, eggs[0]), null);
  const grown = eggs.map((e) => ({ ...e, grow: 2 }));
  assert.ok(mergeSet(grown, grown[0]));
  assert.equal(tot(grown, grown[0]), 7);
});

test('신규 분야 효과: 식품 세트·보물(루비 단독, 왕관 최고 등급, 감정 저울 방향)', () => {
  const tea = P('startea', 1, 0);
  assert.equal(tot([tea, P('lavabread', 2, 0), P('orb', 0, 0)], tea), 4 + 6);
  const honey = P('moonhoney', 1, 1);
  assert.equal(tot([honey, P('ghostcheese', 0, 1), P('lavabread', 2, 1)], honey), 2 + 5);
  const ruby = P('ruby', 0, 0);
  assert.equal(tot([ruby], ruby), 11);
  assert.equal(tot([ruby, P('coin', 1, 0)], ruby), 6);
  const crown = P('crown', 0, 0, 0, 2);
  assert.equal(tot([crown, P('sword', 3, 0, 0, 2)], crown), gradeBase('crown', 2) + 12);
  // 저울은 회전 0에서 오른쪽을 가리킨다
  const scale = P('scale', 0, 0), coin = P('coin', 1, 1), coin2 = P('coin', 3, 3);
  assert.equal(tot([scale, coin, coin2], coin), 3 + 5);
});

test('주력 단골 결산: 친밀도별 보상, 이용권은 1번 자리만, 주력 변경은 다음 날 후보부터', () => {
  const s = arrange(8);
  s.day = 5;
  s.regulars = ['keeper', 'ogre'];
  s.main = 'keeper'; s.everMain = true;
  s.favor = { keeper: 4, ogre: 2 };
  s.pieces = [P('armor', 0, 0), P('shield', 2, 0), P('bow', 4, 0), P('sword', 2, 2), P('armor', 0, 2, 0, 2)];
  s.forfeitReward = true; // 성장 보상은 건너뛰고 바로 주력 단계로
  s.customers = ['goblins', 'noble', 'goblins', 'noble', 'adventurers'];
  const r = G.openShop(s);
  assert.ok(r.ok);
  assert.equal(s.phase, 'mainpick');
  assert.deepEqual(G.mainRewardOptions(s), ['ticket', 'g1']);
  assert.ok(G.settleMain(s, 'ticket', 'ogre'));
  assert.equal(s.freeTickets, 1);
  assert.equal(s.main, 'ogre');
  assert.equal(s.day, 6);
  assert.equal(ITEMS[s.offers[0].id].cat, 'food');
  const keep = s.offers.slice(1).map((o) => o.id);
  assert.ok(G.rerollSlot1(s));
  assert.equal(s.freeTickets, 0);
  assert.deepEqual(s.offers.slice(1).map((o) => o.id), keep);
  assert.equal(G.rerollSlot1(s), false);
});

test('시작 분야 손님은 2일 차에 오고, 단골 전에는 간격 상한이 있다', () => {
  for (const cat of CAT_IDS) {
    const s = G.newGame(91, cat);
    const g = { alch: 'witches', gear: 'adventurers', magic: 'school', food: 'ogre', treasure: 'dwarf', beast: 'keeper' }[cat];
    assert.equal(G.customerOn(s, 2), g);
    const days = [];
    for (let d = 1; d <= 20; d++) if (G.customerOn(s, d) === g) days.push(d);
    for (let i = 1; i < days.length; i++) assert.ok(days[i] - days[i - 1] <= 5, `${cat} ${days}`);
  }
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

test('진열대는 결산일 다음 날 자동으로 넓어진다(최대 8×7), 사는 확장은 없다', () => {
  assert.deepEqual(G.newGame(1).dim, START_SIZE);
  const s = arrange(9);
  s.balance = 10000;
  assert.equal(G.buyExpand(s), false);
  const sizes = [];
  s.pieces = [P('potion', 4, 3)]; // 오른쪽 아래 구석: 확장 뒤에도 자리 그대로
  for (let d = 1; d <= 40; d++) {
    s.day = d;
    G.__startDay(s);
    sizes.push(`${s.dim.cols}x${s.dim.rows}`);
  }
  assert.equal(sizes[4], '5x4');
  assert.equal(sizes[5], '6x4');
  assert.equal(sizes[10], '6x5');
  assert.equal(sizes[30], '8x7');
  assert.equal(sizes[39], '8x7');
  assert.deepEqual([s.pieces[0].x, s.pieces[0].y], [4, 3]);
  assert.equal(G.nextExpansion(s), null);
  // 납부에 실패해도 살아서 다음 날이 되면 넓어진다
  const f = arrange(10);
  f.day = 5;
  f.pieces = [P('herb', 0, 0)];
  const r = G.openShop(f);
  assert.equal(r.ok, false);
  assert.equal(f.day, 6);
  assert.deepEqual(f.dim, { cols: 6, rows: 4 });
  assert.equal(f.lastExpand.added, 4);
  // 이전 형식 판: 진열대가 줄지 않는다
  const old = { ...G.newGame(2), v: 4, day: 12, dim: { cols: 7, rows: 4 } };
  delete old.orderTickets;
  const m = G.migrate(old);
  assert.equal(m.v, 6);
  assert.deepEqual(m.dim, { cols: 7, rows: 5 });
});

test('지정 발주: 진열 중인 종류만, 하루 두 번, 두 번째는 두 배, 발주권, 공간 확인, 되돌리기', () => {
  const s = arrange(14);
  s.day = 12;
  s.balance = 200;
  s.pieces = [P('lavabread', 0, 0), P('lavabread', 2, 0), { ...P('slime', 4, 0), grow: 2 }];
  assert.equal(G.orderBaseCost(s), 45);
  assert.ok(G.orderBlocked(s, 'potion'));
  const picks = s.picksDone;
  assert.ok(G.order(s, 'lavabread'));
  assert.equal(s.balance, 155);
  assert.equal(s.phase, 'place');
  assert.ok(G.merge(s, 'hand'));          // 손에 든 빵 + 진열된 빵 둘 → Ⅱ
  assert.equal(s.hand.g, 2);
  assert.ok(G.placeHand(s, 0, 1, 0));
  assert.equal(s.phase, 'arrange');
  assert.equal(s.picksDone, picks);       // 기본 입고 횟수는 그대로
  assert.equal(G.orderCost(s), 90);
  assert.match(G.orderBlocked(s, 'slime'), /변이/); // 처음 Ⅱ등급이 되면 변이부터
  G.chooseMutation(s, 'A');
  // 마수는 성체를 가져도 알로 온다
  assert.ok(G.order(s, 'slime'));
  assert.equal(s.hand.grow, 0);
  assert.ok(G.undo(s));                   // 되돌리면 잔금·횟수·손 모두 원래대로
  assert.equal(s.hand, null);
  assert.equal(s.ordersToday, 1);
  assert.equal(s.balance, 155);
  assert.ok(G.order(s, 'slime'));
  G.skip(s);
  assert.match(G.orderBlocked(s, 'slime'), /하루 2번/);
  // 발주권은 비용만 면제
  const t = arrange(15);
  t.day = 3;
  t.pieces = [P('potion', 0, 0)];
  t.orderTickets = 1;
  assert.equal(G.orderCost(t), 0);
  assert.ok(G.order(t, 'potion'));
  assert.equal(t.orderTickets, 0);
  // 공간도 합성 재료도 없으면 주문할 수 없다
  const full = arrange(16);
  full.pieces = [];
  for (let y = 0; y < 4; y++) for (let x = 0; x < 5; x++) full.pieces.push(P(x === 0 && y === 0 ? 'ruby' : 'coin', x, y));
  full.balance = 500;
  assert.match(G.orderBlocked(full, 'ruby'), /받을 공간/);
  assert.equal(G.orderBlocked(full, 'coin'), null);
  // 계약의 추가 입고 금지는 발주에도
  const fr = arrange(17);
  fr.pieces = [P('potion', 0, 0)];
  fr.balance = 100;
  fr.contracts = [{ id: 'frugal', day: fr.day, data: {}, progress: 0 }];
  assert.ok(G.orderBlocked(fr, 'potion'));
});

test('결산 보상: 세 자리 역할, 여섯 분야 강화, 낭비 방지, 잔금 지원은 발주 한 번 값', () => {
  for (const cat of CAT_IDS) {
    const s = arrange(40);
    s.day = 10;
    s.lives = 3;
    s.main = Object.keys(G.REGULAR).find((g) => CUSTOMERS[g].fav === cat);
    s.regulars = [s.main];
    s.pieces = [P('potion', 0, 0)];
    for (let i = 0; i < 10; i++) {
      const r = G.__drawRewards(s);
      assert.equal(new Set(r).size, 3);
      assert.ok(r[0] === 'priority' || r[0] === `perma_${cat}`, r[0]);
      assert.ok(['grade', 'order', 'upgrade', 'storage'].includes(r[1]));
      assert.equal(r[2], 'cash');           // 불꽃이 가득하면 회복은 나오지 않는다
    }
  }
  const s = arrange(41);
  s.day = 15;
  s.pieces = [P('lavabread', 0, 0), P('ghostcheese', 2, 0)];
  s.history = [{ catSales: { food: 30, alch: 5 } }];
  assert.equal(G.focusCat(s), 'food');
  s.orderTickets = 2;
  for (let i = 0; i < 10; i++) assert.ok(!G.__drawRewards(s).includes('order'));
  assert.match(G.rewardPreview(s, 'perma_food'), /하루 매출 \+4/);
  s.rewardOffer = ['perma_food', 'grade', 'cash'];
  s.phase = 'reward';
  const before = s.balance;
  G.takeReward(s, 'cash');
  assert.equal(s.balance, before + G.orderBaseCost({ day: 15 }));
  // 신규 분야 강화가 실제 매출에 들어간다
  const t = arrange(42);
  t.pieces = [{ ...P('wyvern', 0, 0), grow: 0 }];
  const b0 = G.income(t).sum.total;
  t.perma.beast = 2;
  assert.equal(G.income(t).sum.total, b0 + 2);
  assert.equal(t.pieces[0].grow, 0);
});

test('플레이 테스트 보고서 수정: 계약 중첩·반복, 독점 입고 대가, 알 이름, 3번 자리', () => {
  // 최근 두 번의 제안에 나온 계약은 다음 제안에 다시 오지 않고, 성공한 무장 전시회는 다시 오지 않는다
  const u = G.newGame(5);
  u.pieces = [P('sword', 0, 0), P('herb', 2, 0), P('potion', 3, 0)];
  for (let i = 0; i < 8; i++) {
    const before = u.recentContracts.slice();
    const ids = G.drawContracts(u)?.ids ?? [];
    for (const id of ids) assert.ok(!before.includes(id), `${id} 반복 (${before})`);
  }
  u.doneContracts = ['armsfair'];
  for (let i = 0; i < 20; i++) assert.ok(!(G.drawContracts(u)?.ids ?? []).includes('armsfair'));

  // 독점 입고는 서명할 때 잔금을 낸다
  const e = arrange(3);
  e.balance = 30;
  e.contractOffer = { ids: ['exclusive'], data: { exclusive: { cat: 'gear', cost: 12 } } };
  assert.ok(G.sign(e, 'exclusive'));
  assert.equal(e.balance, 18);
  assert.match(G.describeContract(e, 'exclusive', { cat: 'gear', cost: 12 }).cost, /잔금 12/);

  // 교환 문구는 알 이름을 쓴다
  const tr = arrange(4);
  tr.pieces = [{ ...P('snail', 0, 0), grow: 0 }];
  const d = G.describeContract(tr, 'trade', { uid: tr.pieces[0].uid, to: 'wyvern', cost: 8 });
  assert.match(d.gain, /정령 고치 → 같은 등급 와이번 알/);

  // 3번 자리 새 상품은 진열 중이 아닌 상품
  const n = G.newGame(8, 'alch');
  n.pieces = ['potion', 'herb', 'sword', 'tome', 'ruby', 'coin'].map((id, i) => P(id, i % 5, Math.floor(i / 5)));
  for (let i = 0; i < 40; i++) {
    const o = G.drawOffers(n)[2];
    if (o.why === 'new') assert.ok(!n.pieces.some((p) => p.id === o.id), o.id);
  }
});

test('후반 성장: 팔기·등급 올리기·넘기기 보너스, 떠돌이 상한, 알 성장 조건과 꽉 찬 진열대 입고', () => {
  const s = arrange(21);
  s.day = 12;
  s.pieces = [P('potion', 0, 0), P('slime', 1, 0)];
  s.pieces[1].grow = 0;
  s.balance = 100;
  // 팔기: 기본의 1.5배, 알은 알 매출
  assert.equal(G.sellValue(s.pieces[0]), Math.round(gradeBase('potion', 1) * 1.5));
  assert.equal(G.sellValue(s.pieces[1]), ITEMS.slime.egg.base);
  // 등급 올리기: 알은 불가, 잔금 또는 이용권
  assert.equal(G.upgradeCost(s, s.pieces[1]), null);
  const cost = G.upgradeCost(s, s.pieces[0]);
  assert.ok(G.upgrade(s, s.pieces[0].uid));
  assert.equal(s.pieces[0].g, 2);
  assert.equal(s.balance, 100 - cost);
  assert.equal(s.pendingMutation, 'potion');
  G.chooseMutation(s, 'A');
  s.upTickets = 1;
  assert.equal(G.upgradeCost(s, s.pieces[0]), 0);
  assert.equal(G.upgrade(s, s.pieces[0].uid), false); // 하루 한 번
  s.day++;
  assert.ok(G.upgrade(s, s.pieces[0].uid));
  assert.equal(s.upTickets, 0);
  s.day++;
  assert.equal(G.upgradeCost(s, s.pieces[0]), null); // Ⅲ부터는 합성으로만
  assert.ok(G.upgradeBlocked(s, s.pieces[0]));
  const before = s.balance;
  assert.ok(G.discard(s, s.pieces[0].uid));
  assert.equal(s.balance, before + Math.round(gradeBase('potion', 3) * 1.5));
  // 넘기기 보너스
  const k = G.newGame(3);
  k.day = 8;
  assert.ok(G.skip(k));
  assert.equal(k.balance, G.skipBonus(k));

  // 떠돌이: 종류마다 +2, 최대 6종
  const ids = ['potion', 'herb', 'sword', 'tome', 'ruby', 'coin', 'orb', 'candle'];
  const ps = ids.map((id, i) => P(id, i % 5, Math.floor(i / 5) * 2));
  const ev = evaluate(ps, { dim: { cols: 7, rows: 6 }, customer: 'wanderers', mutations: {}, perma: {}, mods: {} });
  assert.equal(ev.sum.customer, 12);

  // 성장 조건을 못 채운 와이번 알이 있으면 3번 자리에 식품이 자주 나온다
  const e = G.newGame(30, 'gear');
  e.pieces = [{ ...P('wyvern', 0, 0), grow: 0 }];
  let egg = 0;
  for (let i = 0; i < 40; i++) { const o = G.drawOffers(e)[2]; if (o.why === 'egg') { egg++; assert.equal(ITEMS[o.id].cat, 'food'); } }
  assert.ok(egg >= 12, `egg ${egg}`);

  // 빈칸이 거의 없으면 2번 자리는 합성을 완성하는 상품(같은 Ⅰ등급 2개 → 고르면 3개)
  const full = G.newGame(31, 'alch');
  const fill = ['herb', 'herb', ...['coin', 'ruby', 'potion', 'mushroom', 'moonhoney'].flatMap((id) => [id, id, id])];
  full.pieces = fill.map((id, i) => P(id, i % 5, Math.floor(i / 5))); // 20칸 중 17칸, 빈칸 3
  for (let i = 0; i < 10; i++) {
    const o2 = G.drawOffers(full)[1];
    assert.equal(o2.id, 'herb');
    assert.ok(o2.complete);
  }
});

test('같은 크기 상품끼리 자리 바꾸기: 가로·세로 2칸은 회전해서 맞바꾸고, 크기가 다르면 안 된다', () => {
  const s = arrange(50);
  s.pieces = [P('potion', 0, 0), P('ruby', 4, 3), P('lavabread', 0, 2), P('candle', 4, 0), P('armor', 2, 0)];
  const [potion, ruby, bread, candle, armor] = s.pieces;
  assert.ok(G.swapPieces(s, potion.uid, ruby.uid));
  assert.deepEqual([potion.x, potion.y, ruby.x, ruby.y], [4, 3, 0, 0]);
  // 가로 2칸 빵과 세로 2칸 촛대: 서로 회전해서 상대 칸을 그대로 차지한다
  assert.ok(G.canSwap(s, bread.uid, candle.uid));
  assert.ok(G.swapPieces(s, bread.uid, candle.uid));
  assert.deepEqual(cellsOf(bread).sort().join(' '), [[4, 0], [4, 1]].sort().join(' '));
  assert.deepEqual(cellsOf(candle).sort().join(' '), [[0, 2], [1, 2]].sort().join(' '));
  // 크기가 다르면 바꿀 수 없다
  assert.equal(G.canSwap(s, armor.uid, potion.uid), false);
  assert.equal(G.swapPieces(s, armor.uid, potion.uid), false);
  // 되돌리기
  assert.ok(G.undo(s));
  const after = s.pieces.find((p) => p.id === 'lavabread');
  assert.deepEqual([after.x, after.y, after.rot], [0, 2, 0]);
  // 입고(후보 고르기) 중에도 옮기기·바꾸기가 된다
  const t = G.newGame(51);
  t.pieces = [P('potion', 0, 0), P('herb', 1, 0)];
  assert.equal(t.phase, 'pick');
  assert.ok(G.swapPieces(t, t.pieces[0].uid, t.pieces[1].uid));
  assert.ok(G.movePiece(t, t.pieces[0].uid, 3, 3, 0));
});

test('창고: 매출·조건에서 빠지고, 성장 멈춤, 3번 영업 뒤 다음 날 아침 자동 판매, 같은 날 다시 넣어도 기한 그대로, 합성 재료', () => {
  const s = arrange(60);
  s.day = 7;
  s.customers = Array(30).fill('keeper');
  s.pieces = [P('potion', 0, 0), P('potion', 1, 0), { ...P('wyvern', 0, 1), grow: 1 }, P('lavabread', 2, 1)];
  const [p1, p2, egg] = s.pieces;
  const before = G.income(s).sum.total;
  assert.ok(G.store(s, egg.uid));
  assert.equal(s.storage.length, 1);
  assert.ok(G.income(s).sum.total < before);          // 매출·손님 보너스에서 빠진다
  assert.equal(G.guestCondMet(s, 'keeper'), false);   // 호감 조건에서도 빠진다
  assert.equal(G.storageFree(s), 1);
  assert.ok(G.store(s, p2.uid));
  assert.equal(G.storeBlocked(s, p1.uid), '창고 가득 참');
  // 같은 날 꺼냈다 다시 넣어도 기한은 그대로
  assert.ok(G.unstore(s, p2.uid, 4, 3, 0));
  s.storage.find((q) => q.uid === egg.uid).left = 2;
  assert.ok(G.store(s, p2.uid));
  assert.equal(s.storage.find((q) => q.uid === p2.uid).left, 3);
  const u = s.pieces.length;
  // 합성: 진열대 1개 + 창고 1개 + 손에 든 것 대신, 진열대 potion을 대상으로 창고 potion과 진열대 potion
  s.pieces.push(P('potion', 3, 3));
  const plan = G.mergePlan(s, p1.uid);
  assert.ok(plan && plan.set.some((q) => q.inStore));
  assert.ok(G.merge(s, p1.uid));
  assert.equal(s.pieces.find((q) => q.uid === p1.uid).g, 2);
  assert.ok(!s.storage.some((q) => q.uid === p2.uid));
  G.chooseMutation(s, 'A');
  // 영업 세 번이 지나면 다음 날 아침 팔린다, 마수 성장은 멈춘다
  for (let i = 0; i < 3; i++) {
    s.phase = 'arrange'; s.contractOffer = null; s.regularOffer = null; s.lives = 3;
    const left = s.storage.find((q) => q.uid === egg.uid)?.left;
    G.openShop(s);
    if (s.phase === 'reward' || s.phase === 'mainpick') { s.phase = 'arrange'; G.__startDay(s); }
    if (left === 1) break;
  }
  assert.ok(!s.storage.some((q) => q.uid === egg.uid));
  assert.equal(s.storageSold[0].name, '와이번 알');
  assert.equal(s.storageSold[0].value, G.sellValue({ ...egg, grow: 1 }));
  // 창고 상품을 대상으로 한 합성: 결과는 진열대 재료 자리에
  const t = arrange(61);
  t.pieces = [P('herb', 0, 0)];
  t.balance = 0;
  assert.ok(G.store(t, t.pieces[0].uid));
  t.pieces = [P('herb', 2, 2)];
  t.storage.push({ ...P('herb', null, null), left: 3, since: t.day });
  const sid = t.storage[0].uid;
  const pl = G.mergePlan(t, { stored: sid });
  assert.ok(pl && pl.anchor);
  assert.ok(G.merge(t, { stored: sid }));
  assert.equal(t.storage.length, 0);
  assert.equal(t.pieces.length, 1);
  assert.equal(t.pieces[0].g, 2);
  // 되돌리기로 복제되지 않는다
  assert.ok(G.undo(t));
  assert.equal(t.storage.length + t.pieces.length, 3);
});

test('창고: 손에 든 상품(입고·발주)을 바로 넣을 수 있고 기본 입고 횟수는 정상 진행', () => {
  const s = G.newGame(70);
  G.choose(s, 0);
  assert.equal(s.phase, 'place');
  const id = s.hand.id;
  assert.ok(G.store(s, 'hand'));
  assert.equal(s.storage[0].id, id);
  assert.equal(s.phase, 'pick');
  assert.equal(s.picksLeft, 1);
  // 창고 기한: 영업 3번 뒤 아침에 팔린다(압류된 날은 처리하지 않는다)
  const t = arrange(71);
  t.storage = [{ ...P('potion', null, null), left: 1, since: 1 }];
  t.lives = 1;
  t.pieces = [];
  t.day = 9;
  G.openShop(t);
  assert.equal(t.phase, 'over');
  assert.equal(t.storage.length, 1);
});
