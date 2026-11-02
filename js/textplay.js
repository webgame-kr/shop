// 텍스트 테스트 버전의 핵심: 명령 한 줄을 받아 상태를 바꾸고 결과를 글로 돌려준다.
// Node(scripts/play.js)와 브라우저(play.html)가 함께 쓴다. 저장은 부르는 쪽이 한다.
import * as G from './game.js';
import {
  ITEMS, ITEM_IDS, CATS, CAT_IDS, CUSTOMERS, GROW_NEED, isEgg, displayName, effectText, mutName, mutText,
  gradeBase, roman, shapeOf, sizeOf, cellsOf, growthCheck, findSpot,
} from './rules.js';

class Fail extends Error {}
let out = [];
const say = (...l) => out.push(l.join(' '));
function fail(msg) { throw new Fail(msg); }
const num = (v, name) => {
  const n = Number(v);
  if (!Number.isInteger(n)) fail(`${name}은(는) 정수여야 해요: ${v ?? '(없음)'}`);
  return n;
};

const guestName = (g) => (g ? CUSTOMERS[g].name : '-');
const itemLabel = (p) => `${displayName(p)} ${roman(p.g ?? 1)}${isEgg(p) ? ` (성장 ${p.grow ?? 0}/${GROW_NEED})` : ''}`;

/* ---------- 보여 주기 ---------- */

function board(s) {
  const { cols, rows } = s.dim;
  const grid = Array.from({ length: rows }, () => Array(cols).fill(' . '));
  for (const k of G.sealedNow(s)) { const [x, y] = k.split(',').map(Number); if (grid[y]) grid[y][x] = ' # '; } // 봉인 칸은 "x,y" 문자열
  for (const p of s.pieces) for (const [x, y] of cellsOf(p)) if (grid[y]?.[x] !== undefined) grid[y][x] = String(p.uid).padStart(3);
  say(`진열대 ${cols}×${rows}  (숫자 = 상품 번호, . = 빈칸, # = 봉인)`);
  say('     ' + Array.from({ length: cols }, (_, x) => String(x).padStart(3)).join(''));
  grid.forEach((r, y) => say(`  ${String(y).padStart(2)} ${r.join('')}`));
}

function pieces(s) {
  if (!s.pieces.length) { say('진열 중인 상품 없음'); return; }
  const ev = G.income(s);
  const gc = growthCheck(s.pieces, s.dim, G.sealedNow(s));
  say(`상품 (예상 매출 합 ${ev.sum.total} = 기본 ${ev.sum.base} + 배치 ${ev.sum.place} + 변이 ${ev.sum.mut} + 손님 ${ev.sum.customer} + 계약 ${ev.sum.contract >= 0 ? '+' : ''}${ev.sum.contract})`);
  for (const p of s.pieces) {
    const r = ev.items.get(p.uid);
    const bon = r.bonuses.filter((b) => b.amount).map((b) => `${b.label} ${b.amount > 0 ? '+' : ''}${b.amount}`).join(', ');
    const m = s.mutations[p.id] && p.g >= 2 ? ` [변이 ${mutName(p.id, s.mutations[p.id])}]` : '';
    let grow = '';
    if (isEgg(p)) {
      const g = gc.get(p.uid);
      grow = g.gain ? ` → 영업 후 성장 ${g.from}→${g.to}${g.nest ? '(둥지)' : ''}` : ` → 조건 아직: ${ITEMS[p.id].egg.grow}`;
    }
    const up = G.upgradeCost(s, p);
    say(`  #${p.uid} ${itemLabel(p)}${m} @(${p.x},${p.y}) 회전${p.rot} · ${r.total}${bon ? ` (${bon})` : ''}${grow} · 팔기 +${G.sellValue(p)}${up === null ? '' : ` · 올리기 ${up === 0 ? '이용권' : up}`}`);
  }
}

function offerLine(s, o, i) {
  const it = ITEMS[o.id];
  const name = it.egg ? it.egg.name : it.name;
  const base = it.egg ? it.egg.base : gradeBase(o.id, s.offerGrade);
  const why = { main: '주력 추천', start: '시작 분야', same: '보유 상품', new: '새 상품', exclusive: '독점 입고', reward: '주력 보상', egg: `${o.egg} 성장용` }[o.why] ?? o.why;
  const fit = findSpot(s.dim, s.pieces, o.id, G.sealedNow(s));
  return `  ${i + 1}) ${name} ${roman(s.offerGrade)} [${CATS[it.cat].name}] ${it.cells.length}칸 기본 ${base} · ${why}${o.rare ? '·오랜만' : ''}${o.complete ? '·합성 완성' : ''}${o.prio ? '·★우선' : ''}${fit ? '' : ' · 놓을 자리 없음'}\n       ${it.egg ? `성장: ${it.egg.grow} · ` : ''}${effectText(o.id, s.offerGrade)}`;
}

function show(s) {
  if (s.phase === 'over') {
    say(`=== 압류 · ${s.day}일 차에서 끝 · 누적 매출 ${s.total} · 최고 하루 ${s.bestDay} ===`);
    say(`가게 별명: ${G.nickname(s)}`);
    return;
  }
  const today = G.customerOn(s, s.day), tomorrow = G.customerOn(s, s.day + 1);
  const flames = `${'●'.repeat(s.lives)}${'○'.repeat(3 - s.lives)}`;
  const lead = s.main ? `주력 단골 ${guestName(s.main)} (입고 1번 ${CATS[CUSTOMERS[s.main].fav].name})` : G.startSupport(s) ? `시작 분야 ${CATS[s.startCat].name} (지원 중, ${G.START_SUPPORT_UNTIL}일 차까지)` : '주력 단골 없음';
  if (s.phase === 'reward' || s.phase === 'mainpick') {
    // 결산 보상 단계: 영업은 이미 끝났으므로 그날의 판정 결과를 보여 준다
    say(`=== ${s.day}일 차 결산 · ${s.phase === 'reward' ? '성장 보상' : '주력 단골 결산'} · 불꽃 ${flames} · 잔금 ${s.balance} ===`);
    say(`오늘 영업: 매출 ${s.last.sales} / 납부 ${s.last.pay} 완납 · 다음 영업은 ${s.day + 1}일 차 · ${lead}`);
  } else {
    say(`=== ${s.day}일 차${G.isSettleDay(s.day) ? ' (결산일)' : ''} · 단계 ${s.phase} · 불꽃 ${flames} · 잔금 ${s.balance} ===`);
    say(`납부액 ${G.payFor(s)} · 예상 매출 ${G.income(s).sum.total} · ${lead}`);
  }
  say(`손님 오늘 ${guestName(today)}${G.REGULAR[today] ? ` [호감 조건: ${G.REGULAR[today].cond} → ${G.guestCondMet(s, today) ? '충족' : '아직'}]` : ' [특별 손님]'} · 내일 ${guestName(tomorrow)}`);
  if (s.regulars.length) {
    say('단골: ' + s.regulars.map((g) => `${guestName(g)}${s.main === g ? '(주력)' : ''} 호감 ${s.favor[g] ?? 0} ${G.stageOf(s.favor[g] ?? 0)?.name ?? ''}`).join(' · '));
  }
  const fav = Object.entries(s.favor).filter(([g, f]) => f > 0 && !s.regulars.includes(g));
  if (fav.length) say('호감: ' + fav.map(([g, f]) => `${guestName(g)} ${f}`).join(' · '));
  const extra = [s.freeTickets ? `무료 다시 뽑기 ${s.freeTickets}장` : '', s.tickets ? `추가 입고 이용권 ${s.tickets}장` : '', s.upTickets ? `등급 올리기 이용권 ${s.upTickets}장` : '', s.priority ? `우선 입고 ${ITEMS[s.priority].name}` : ''].filter(Boolean);
  if (extra.length) say(extra.join(' · '));
  const active = G.activeContracts(s);
  if (active.length) say('계약: ' + active.map((c) => `${G.CONTRACTS[c.id].name}(${G.CONTRACTS[c.id].type === 'cond' ? G.condProgressText(s, c) : `${G.contractDaysLeft(s, c)}일 남음`})`).join(' · '));
  say('');
  board(s);
  pieces(s);
  const st = s.storage ?? [];
  say(`창고 ${st.length}/${s.storageSlots ?? G.STORAGE_START}칸(매출·손님·조건에서 빠짐)${st.length ? ': ' + st.map((p) => `#${p.uid} ${itemLabel(p)} ${p.left}일 남음${p.left <= 1 ? '(내일 아침 자동 판매)' : ''}`).join(' · ') : ''}`);
  if (s.storageSold?.length) say(`창고 자동 판매: ${s.storageSold.map((x) => `${x.name} +${x.value}`).join(' · ')}`);
  say('');

  // 지금 해야 하는 결정
  if (s.lastExpand?.day === s.day) {
    const ex = s.lastExpand;
    say(`▶ 진열대 확장 ${ex.from.cols}×${ex.from.rows} → ${ex.to.cols}×${ex.to.rows} · 새 칸 ${ex.added}개 · 조건이 바뀐 상품 ${ex.changed.length}개 · 지금 배치 기준 ${ex.delta >= 0 ? '+' : ''}${ex.delta}`);
  }
  if (s.ordering) say('▶ 지정 발주 상품을 들고 있어요(기본 입고 횟수와 별개). place/merge hand/skip(버리기) 중 하나로 처리하세요.');
  if (s.regularOffer) {
    say(`▶ 단골 제안: ${guestName(s.regularOffer)}. \`accept${s.regulars.length >= 2 ? ' <내보낼 단골 id>' : ''}\` 또는 \`decline\`  (단골 id: ${s.regulars.join(', ') || '없음'})`);
  }
  if (s.pendingMutation) {
    const id = s.pendingMutation;
    say(`▶ 변이 선택 (${ITEMS[id].name}): \`mut A\` ${mutName(id, 'A')} — ${mutText(id, 'A')} / \`mut B\` ${mutName(id, 'B')} — ${mutText(id, 'B')}`);
  }
  if (s.contractOffer) {
    say('▶ 마왕의 계약 (영업 전에 `sign <id>` 하나 또는 `refuse`):');
    for (const id of s.contractOffer.ids) {
      const c = G.CONTRACTS[id];
      const d = G.describeContract(s, id, s.contractOffer.data[id]);
      const span = c.span ? ` / 기간 ${c.span[1] - c.span[0] + 1}일(${s.day + c.span[0]}~${s.day + c.span[1]}일 차)` : ' / 즉시';
      const can = G.canSign(s, id);
      say(`  ${id} · ${c.name} [${{ instant: '즉시 거래', period: '기간형', cond: '조건형' }[c.type]}] 받는 것: ${d.gain} / 대가: ${d.cost}${d.cond ? ` / 조건: ${d.cond}` : ''}${span}${can.ok ? '' : ` (지금 서명 불가: ${can.why})`}`);
    }
  }
  if (s.phase === 'pick') {
    say(`▶ 입고 ${s.picksDone + 1}번째 (남은 ${s.picksLeft}) · \`pick <1-3>\`, \`reroll\`(잔금 ${G.rerollCost(s)})${s.freeTickets ? ', `reroll1`(1번만, 무료 이용권)' : ''}, \`skip\`(잔금 +${G.skipBonus(s)})`);
    s.offers.forEach((o, i) => say(offerLine(s, o, i)));
  }
  if (s.phase === 'place') {
    const it = ITEMS[s.hand.id];
    const spot = findSpot(s.dim, s.pieces, s.hand.id, G.sealedNow(s));
    say(`▶ 손에 든 상품: ${it.egg ? it.egg.name : it.name} ${roman(s.hand.g)} · 모양(회전0): ${JSON.stringify(shapeOf(s.hand.id, 0))}`);
    say(`  \`place <x> <y> [회전0-3]\` (기준점 = 모양의 왼쪽 위)${spot ? ` · 예: 들어가는 자리 place ${spot.x} ${spot.y} ${spot.rot}` : ' · 들어갈 자리가 없어요(discard/merge/skip)'}${G.mergePlan(s, 'hand') ? ' · `merge hand` 가능' : ''}`);
  }
  if (s.phase === 'arrange') {
    const cost = G.extraCost(s);
    const nx = G.nextExpansion(s);
    const ob = G.orderBlocked(s, null);
    say(`▶ 정리: \`open\`(영업)${G.extraBlocked(s) ? '' : `, \`extra\`(추가 입고 ${s.tickets ? '이용권' : `잔금 ${cost}`})`}${ob ? '' : `, \`order <상품id>\`(지정 발주 ${G.orderCost(s) === 0 ? '발주권' : `잔금 ${G.orderCost(s)}`}, 오늘 ${s.ordersToday}/${G.ORDERS_PER_DAY}: ${G.orderables(s).filter((id) => !G.orderBlocked(s, id)).join(' ') || '받을 공간 없음'})`}, \`upgrade <번호>\`, \`move\`, \`merge\`, \`discard\`(팔기), \`undo\``);
    if (!G.canOpen(s)) say('  (영업 전에 위의 결정을 먼저 하세요)');
    say(`  진열대 ${s.dim.cols}×${s.dim.rows}${nx ? ` · ${nx.day}일 차 아침 ${nx.cols}×${nx.rows}로 자동 확장` : ' · 최대 크기'}`);
  }
  if (s.phase === 'reward') {
    say('▶ 결산 보상 (`reward <키> [우선 입고할 상품 id]`):');
    s.rewardOffer.forEach((k, i) => say(`  ${i + 1}) ${k} · ${G.REWARDS[k].name}: ${G.REWARDS[k].text} → ${G.rewardPreview(s, k)}`));
  }
  if (s.phase === 'mainpick') {
    const opts = G.mainRewardOptions(s);
    say(`▶ 주력 단골 결산 (\`main <보상> [다음 주력 id]\`): 보상 ${opts.join(' / ') || '없음(주력 없음, `main none <id>`)'} · 단골 ${s.regulars.join(', ')}`);
    say('  ticket = 1번 자리 무료 다시 뽑기 이용권 · g1/g2 = 주력 분야 Ⅰ/Ⅱ등급 상품 선택(다음 날)');
  }
}

function judge(s, r) {
  say(`--- ${r.day}일 차 영업: 매출 ${r.sales} / 납부 ${r.pay} → ${r.ok ? `완납, 잔금 +${r.sales - r.pay}` : '부족! 불꽃 하나 꺼짐'} ---`);
  if (r.favorGain) say(`  호감 +1: ${guestName(r.favorGain)}`);
  if (r.stageUp) say(`  단계 상승: ${guestName(r.stageUp.guest)} → ${r.stageUp.stage}`);
  for (const g of r.growth ?? []) if (g.gain) say(`  성장: ${ITEMS[g.id].egg.name} ${g.from}→${g.to}${g.hatched ? ` 부화! ${ITEMS[g.id].name}` : ''}`);
  for (const c of r.condResults ?? []) {
    const name = G.CONTRACTS[c.id]?.name ?? c.id;
    const need = G.CONTRACTS[c.id]?.need;
    say(`  조건형 ${name}: ${c.result === 'success' ? `달성! 받는 것: ${G.describeContract(s, c.id, {}).gain}` : c.result === 'fail' ? '실패 · 계약금만 잃음' : `진행 ${c.progress}${need ? ` / ${need}` : ''}`}`);
  }
  say('');
}

/* ---------- 명령 ---------- */

const HELP = `명령:
  new [시드] [시작분야]   새 판 (분야: ${CAT_IDS.join(' ')})
  show                   현재 상태와 할 수 있는 일
  pick <1-3>             입고 후보 고르기 → place로 놓기
  place <x> <y> [회전]   손에 든 상품 놓기
  skip                   이번 입고 넘기기(잔금 조금)
  reroll / reroll1       후보 전체 새로고침(잔금) / 1번 자리만(무료 이용권)
  move <번호> <x> <y> [회전]   진열된 상품 옮기기(입고 중에도 가능)
  swap <번호> <번호>     같은 크기 상품끼리 자리 바꾸기(가로·세로 2칸은 회전해서)
  discard <번호>         상품 팔기(기본 매출 1.5배를 잔금으로)
  store <번호|hand>      창고에 넣기(기본 2칸, 영업 3번 보관, 매출 0, 기한 지나면 다음 날 아침 자동 판매)
  unstore <번호> <x> <y> [회전]   창고에서 꺼내기 · sellstore <번호> 창고에서 팔기
  merge s<번호>          창고 상품을 대상으로 합성(결과는 진열대)
  upgrade <번호>         잔금(또는 이용권)으로 한 등급 올리기 · 하루 한 번, Ⅲ등급까지, 알 제외
  merge <번호|hand>      같은 상품·등급 3개 합성
  mut <A|B>              변이 고르기
  extra                  추가 입고(잔금, 후보 셋 중 하나)
  order <상품id>         지정 발주: 진열 중인 종류를 1등급으로 확정 입고(하루 2번)
  sign <계약id> / refuse 계약 서명 / 모두 거절
  open                   영업하고 납부 판정
  reward <키> [상품id]   결산 보상
  main <보상> [단골id]   주력 단골 결산(보상, 다음 주력)
  accept [내보낼id] / decline   단골 제안
  undo                   되돌리기
  item <상품id>          상품 정보 · items: 전체 목록
  guests                 손님 목록과 호감 조건`;

// 놓을 수 없는 이유를 하나 골라 알려 준다
function placeWhy(s, id, x, y, rot) {
  const cells = cellsOf({ id, x, y, rot: ((rot % 4) + 4) % 4 });
  const out = cells.filter(([cx, cy]) => cx < 0 || cy < 0 || cx >= s.dim.cols || cy >= s.dim.rows);
  if (out.length) return `진열대 밖이에요(${out.map(([a, b]) => `(${a},${b})`).join(' ')}). 진열대는 ${s.dim.cols}×${s.dim.rows}, 좌표는 0부터`;
  const sealed = new Set(G.sealedNow(s));
  const sc = cells.filter(([a, b]) => sealed.has(`${a},${b}`));
  if (sc.length) return `봉인된 칸이에요(${sc.map(([a, b]) => `(${a},${b})`).join(' ')})`;
  const hit = s.pieces.filter((p) => cellsOf(p).some(([a, b]) => cells.some(([c, d]) => a === c && b === d)));
  if (hit.length) return `다른 상품과 겹쳐요: ${hit.map((p) => `#${p.uid} ${displayName(p)}`).join(', ')}`;
  return '놓을 수 없는 자리예요';
}

let args = [];
const ACT = {
  pick: (s) => G.choose(s, num(args[0], '후보 번호') - 1),
  place: (s) => G.placeHand(s, num(args[0], 'x'), num(args[1], 'y'), args[2] ? num(args[2], '회전') : 0),
  skip: (s) => G.skip(s),
  reroll: (s) => G.reroll(s),
  reroll1: (s) => G.rerollSlot1(s),
  move: (s) => G.movePiece(s, num(args[0], '번호'), num(args[1], 'x'), num(args[2], 'y'), args[3] ? num(args[3], '회전') : s.pieces.find((p) => p.uid === Number(args[0]))?.rot ?? 0),
  discard: (s) => G.discard(s, num(args[0], '번호')),
  swap: (s) => G.swapPieces(s, num(args[0], '번호'), num(args[1], '번호')),
  upgrade: (s) => G.upgrade(s, num(args[0], '번호')),
  order: (s) => G.order(s, args[0]),
  merge: (s) => G.merge(s, args[0] === 'hand' ? 'hand' : args[0]?.startsWith('s') ? { stored: num(args[0].slice(1), '창고 번호') } : num(args[0], '번호')),
  store: (s) => G.store(s, args[0] === 'hand' ? 'hand' : num(args[0], '번호')),
  unstore: (s) => G.unstore(s, num(args[0], '번호'), num(args[1], 'x'), num(args[2], 'y'), args[3] ? num(args[3], '회전') : 0),
  sellstore: (s) => G.sellStored(s, num(args[0], '번호')),
  mut: (s) => G.chooseMutation(s, (args[0] ?? '').toUpperCase()),
  extra: (s) => G.buyExtra(s),
  sign: (s) => G.sign(s, args[0]),
  refuse: (s) => G.refuseContracts(s),
  reward: (s) => G.takeReward(s, args[0], args[1] ?? null),
  main: (s) => G.settleMain(s, args[0] === 'none' ? null : args[0], args[1] ?? null),
  accept: (s) => G.acceptRegular(s, args[0] ?? null),
  decline: (s) => G.refuseRegular(s),
  undo: (s) => G.undo(s),
};


// 상태(없으면 null)와 명령 한 줄 → { state, text, ok }. 실패하면 상태는 그대로 돌려준다.
export function run(state, line) {
  out = [];
  const [cmd = 'show', ...rest] = String(line ?? '').trim().split(/\s+/).filter(Boolean);
  args = rest;
  let s = state ? G.migrate(structuredClone(state)) : null;
  if (state && !s) return { state: null, ok: false, text: '✗ 예전 형식의 판이라 이어 할 수 없어요. `new`로 새로 시작하세요.' };
  try {
    if (cmd === 'help') {
      say(HELP);
    } else if (cmd === 'items') {
      for (const c of CAT_IDS) say(`[${CATS[c].name}] ` + ITEM_IDS.filter((id) => ITEMS[id].cat === c).map((id) => `${id}(${ITEMS[id].egg ? ITEMS[id].egg.name + '→' : ''}${ITEMS[id].name})`).join(' '));
    } else if (cmd === 'item') {
      const id = args[0];
      const it = ITEMS[id];
      if (!it) fail(`없는 상품 id: ${id}. \`items\`로 목록을 보세요.`);
      const { w, h } = sizeOf(id, 0);
      say(`${it.name} [${CATS[it.cat].name}] ${it.cells.length}칸(${w}×${h}) 모양 ${JSON.stringify(shapeOf(id, 0))} 기본 ${it.base}`);
      if (it.egg) say(`  알: ${it.egg.name} 기본 ${it.egg.base} · 성장 조건 ${it.egg.grow} · 성장도 ${GROW_NEED}에서 부화`);
      say(`  효과: ${effectText(id, 1)}`);
      for (const m of ['A', 'B']) say(`  변이 ${m} ${mutName(id, m)}: ${mutText(id, m)}`);
    } else if (cmd === 'guests') {
      for (const [id, c] of Object.entries(CUSTOMERS)) say(`${id} · ${c.name}: ${c.text}${G.REGULAR[id] ? ` · 호감 조건 ${G.REGULAR[id].cond} · 주력이면 입고 1번 ${CATS[c.fav].name}` : ' · 특별 손님(단골 안 됨)'}`);
    } else if (cmd === 'new') {
      const seed = args[0] ? num(args[0], '시드') >>> 0 : undefined;
      const cat = args[1] ?? 'alch';
      if (!CATS[cat]) fail(`시작 분야는 ${CAT_IDS.join(', ')} 중 하나예요.`);
      s = G.newGame(seed, cat);
      G.seeBrief(s);
      say(`새 판 시작 · 시드 ${s.seed} · 시작 분야 ${CATS[cat].name}`);
      show(s);
    } else if (cmd === 'show') {
      if (!s) fail('진행 중인 판이 없어요. `new [시드] [시작분야]`로 시작하세요.');
      show(s);
    } else if (cmd === 'open') {
      if (!s) fail('진행 중인 판이 없어요. `new [시드] [시작분야]`로 시작하세요.');
      if (!G.canOpen(s)) fail(s.phase !== 'arrange' ? `지금은 영업할 수 없어요(단계 ${s.phase}). 입고를 먼저 끝내세요.` : '계약이나 변이 결정을 먼저 하세요.');
      const r = G.openShop(s);
      G.seeBrief(s);
      judge(s, r);
      show(s);
    } else if (ACT[cmd]) {
      if (!s) fail('진행 중인 판이 없어요. `new [시드] [시작분야]`로 시작하세요.');
      if (!ACT[cmd](s)) {
        if ((cmd === 'place' && s.phase === 'place') || (cmd === 'move' && s.pieces.some((p) => p.uid === Number(args[0])))) {
          const id = cmd === 'place' ? s.hand.id : s.pieces.find((p) => p.uid === Number(args[0])).id;
          const [x, y, r] = cmd === 'place' ? args : args.slice(1);
          fail(`${cmd} 실패: ${placeWhy(s, id, Number(x), Number(y), Number(r ?? 0))}`);
        }
        if (cmd === 'sign' && s.contractOffer?.ids.includes(args[0])) fail(`서명 불가: ${G.canSign(s, args[0]).why}`);
        if (cmd === 'order') fail(`지정 발주 불가: ${G.orderBlocked(s, args[0]) ?? '상품 id를 확인하세요'}`);
        if (cmd === 'upgrade') {
          const p = s.pieces.find((x) => x.uid === Number(args[0]));
          const why = G.upgradeBlocked(s, p) ?? (s.pendingMutation ? '변이를 먼저 고르세요' : `잔금이 부족해요(필요 ${G.upgradeCost(s, p)})`);
          fail(`등급 올리기 불가: ${why}`);
        }
        fail(`\`${[cmd, ...args].join(' ')}\` 실행 불가 (단계 ${s.phase}). \`show\`로 할 수 있는 일을 확인하세요.`);
      }
      G.seeBrief(s);
      say(`✓ ${[cmd, ...args].join(' ')}`);
      show(s);
    } else {
      fail(`모르는 명령: ${cmd}\n${HELP}`);
    }
    return { state: s, ok: true, text: out.join('\n') };
  } catch (e) {
    if (!(e instanceof Fail)) throw e;
    return { state, ok: false, text: `✗ ${e.message}` };
  }
}

export { HELP };
