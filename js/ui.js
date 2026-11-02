// 화면 흐름(디자인 시안·확장판): 시작 → 영업 예고(아침) → 입고(후보 역할) → 상점 정리(합성·변이·상세)
// → 계약(즉시·기간·조건) → 납부와 판정 → 결산 보상 → 단골 제안 → … → 압류 통지서.
// 선택 후 위치 누르기가 기본이고 끌기는 보조. 모든 주요 선택 뒤 자동 저장.
import {
  ITEMS, ITEM_IDS, CATS, CAT_IDS, CAT_GUEST, CUSTOMERS, MAX_LIVES, EXPAND_STEPS, DIRECTIONAL, GROW_NEED,
  isEgg, displayName, imgKey, growthCheck,
  shapeOf, sizeOf, cellsOf, clampAnchor, canPlace, occupancy, gradeBase, gradeLabel, roman, effectText, anyFit,
  mutName, mutText, evaluate,
} from './rules.js';
import * as G from './game.js';
import { drawCard } from './card.js';
import * as S from './sound.js';
import { renderGuide, renderCodex } from './guide.js';

const KEY_RUN = 'demon-shop:run';
const KEY_BEST = 'demon-shop:best';
const KEY_TUTORIAL = 'demon-shop:tutorial-done';

const $ = (id) => document.getElementById(id);
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 저장 불가 환경 */ } },
};
const fmt = (n) => Number(n).toLocaleString('ko-KR');
const itemImg = (id) => `img/${id}.png`;
const guestImg = (id) => `img/guest_${id}.png`;
const GUEST_LIKE = {
  adventurers: '모험 장비 상품에 보너스 매출', witches: '연금술 상품에 보너스 매출', school: '마법 잡화에 보너스 매출',
  goblins: '같은 상품이 여러 개면 보너스', noble: '높은 등급 상품을 좋아해요', wanderers: '서로 다른 상품 종류에 보너스',
  ogre: '마계 식품에 보너스 매출', dwarf: '보물·귀금속에 보너스 매출', keeper: '마수·알에 보너스 매출',
};
const SHORT = { adventurers: '모험가', witches: '마녀', school: '마법학교', goblins: '고블린', noble: '귀족', wanderers: '떠돌이', ogre: '미식회', dwarf: '보석상', keeper: '사육사' };
const catIcon = (cat, cls = 'caticon') => `<img class="${cls}" src="img/cat_${cat}.png" alt="">`;
const regEffect = (g) => `주력이면 입고 1번 자리 ${CATS[CUSTOMERS[g].fav].name}`;
// 하트 6칸: 1 관심 · 2 단골 · 4 친한 단골 · 6 VIP 경계마다 칸막이
function heartsHTML(f) {
  let h = '';
  for (let i = 1; i <= 6; i++) h += `<i class="${i <= f ? 'on' : ''}">${i <= f ? '♥' : '♡'}</i>${[1, 2, 4].includes(i) ? '<b class="sep"></b>' : ''}`;
  return `<span class="hearts6">${h}</span>`;
}
function stageLine(g) {
  const f = s.favor[g] ?? 0;
  const st = G.stageOf(f), nx = G.nextStage(f);
  return `${st ? st.name : '처음 보는 손님'}${nx ? ` · ${nx.name}까지 호감 ${nx.at - f}` : ''}`;
}
const MUT_WAY = {
  self: '운영 방식 · 자기 매출 집중', aura: '운영 방식 · 주변 상품 지원', focus: '운영 방식 · 대상 하나 집중 지원',
  cond: '운영 방식 · 조건 달성형', guest: '운영 방식 · 특정 손님 전문화',
};

let s = null;          // 게임 상태 (저장 대상)
let sel = null;        // { kind: 'hand' } | { kind: 'piece', uid }
let ghost = null;      // { x, y, rot } 미리보기
let handRot = 0;
let merging = null;    // 합성 미리보기
let spark = new Set();
let press = null;
let pickedOffer = null;
let pickedContract = null;
let pickedMut = null;
let pickedReward = null;
let pickedPrio = null;
let swapOut = null;
let stripOpen = false;
let judgeAnim = null;

/* ---------- 저장 ---------- */

// 튜토리얼(연습 상점) 중에는 본 게임 진행을 저장하지 않고 레슨 목표만 확인한다
function save() {
  if (tut) return checkTut();
  if (s) store.set(KEY_RUN, s);
}
function loadRun() {
  const r = store.get(KEY_RUN);
  return r && (r.v === 4 || r.v === 5) && Array.isArray(r.pieces) ? G.migrate(r) : null;
}
const bestRecord = () => store.get(KEY_BEST);
const tutorialDone = () => store.get(KEY_TUTORIAL) === true;

/* ---------- 화면 전환 ---------- */

const SCREENS = ['start', 'startpick', 'morning', 'play', 'contract', 'judge', 'mutation', 'regular', 'reward', 'settlemain', 'result'];
function show(name) {
  for (const id of SCREENS) $(`screen-${id}`).hidden = id !== name;
  window.scrollTo(0, 0);
}

function route() {
  if (s.phase === 'over') return showResult();
  if (s.pendingMutation) { pickedMut = null; S.play('mutation_open'); return showMutation(); }
  if (s.phase === 'reward') return showReward();
  if (s.phase === 'mainpick') return showSettleMain();
  if (s.regularOffer) return showRegular();
  if (!s.briefSeen) return showMorning();
  show('play');
  render();
}

function goStart() {
  const run = loadRun();
  const cont = $('btn-continue');
  cont.hidden = !(run && run.phase !== 'over');
  if (run) cont.textContent = `이어 하기 · ${run.day}일 차`;
  const best = bestRecord();
  $('start-record').innerHTML = best
    ? `<div><span class="k">최장 생존</span><b>${best.days}일</b></div><div><span class="k">그때 누적 매출</span><b class="gold">${fmt(best.total)}</b></div>` : '';
  show('start');
}

let pickedStart = null;
function showStartPick() {
  pickedStart = null;
  renderStartPick();
  show('startpick');
}
function renderStartPick() {
  const art = { alch: 'potion', gear: 'sword', magic: 'orb', food: 'lavabread', treasure: 'ruby', beast: 'slime_egg' };
  $('sp-grid').innerHTML = CAT_IDS.map((c) => `<button class="sp-card${pickedStart === c ? ' sel' : ''}" data-start="${c}">
    ${catIcon(c, 'sp-icon')}<span class="sp-art"><img src="img/${art[c]}.png" alt=""></span><b>${CATS[c].name}</b><small>${CATS[c].short}</small></button>`).join('');
  const g = pickedStart ? CAT_GUEST[pickedStart] : null;
  $('sp-guest').innerHTML = g ? `<img src="${guestImg(g)}" alt=""><p><b>${CUSTOMERS[g].name}</b>가 2일 차에 와요. ${G.REGULAR[g].cond}하면 호감도 +1.</p>` : '';
  $('sp-guest').hidden = !g;
  $('sp-note').textContent = `이 지원은 첫 주력 단골을 얻거나 ${G.START_SUPPORT_UNTIL}일 차가 끝나면 종료돼요.`;
  const b = $('btn-startpick');
  b.disabled = !pickedStart;
  b.textContent = pickedStart ? `${CATS[pickedStart].name.split('·')[0]} 상점으로 시작` : '분야를 골라 주세요';
}

function startNew(cat = 'alch') {
  s = G.newGame(undefined, cat);
  resetSelection();
  save();
  route();
}

function resume() {
  s = loadRun();
  if (!s) return goStart();
  resetSelection();
  route();
}

function resetSelection() {
  ghost = null;
  merging = null;
  pickedOffer = null;
  orderOpen = false;
  handRot = s?.hand?.rot ?? 0;
  sel = s?.phase === 'place' && s.hand ? { kind: 'hand' } : null;
}

function flamesHTML(lives, lostNow = false) {
  return Array.from({ length: MAX_LIVES }, (_, i) => (i < lives
    ? '<img src="img/flame.png" alt="">'
    : `<span class="flame-out${lostNow && i === lives ? ' lost' : ''}"><svg viewBox="0 0 20 28"><path d="M10 2c3 5 8 9 8 15a8 8 0 0 1-16 0c0-4 2-6 4-8 0 3 1 5 3 5 0-5-1-8 1-12z"/></svg></span>`)).join('');
}

function statusHTML() {
  return `<span class="flames" aria-label="영혼의 불꽃 ${s.lives}개">${flamesHTML(s.lives)}</span><span>잔금<b>${fmt(s.balance)}</b></span>`;
}

const hexHTML = (id, m, cls = 'mhex') => `<span class="${cls} ${m}" title="${mutName(id, m)}">${mutName(id, m)[0]}</span>`;

/* ---------- 02 영업 예고 ---------- */

function demonLine() {
  const pay = G.payFor(s);
  const today = G.customerOn(s, s.day);
  if (G.debtDueToday(s)) return `오늘은 빚 갚는 날이지. ${fmt(pay)}, 잊지 않았겠지?`;
  if (s.lives === 1) return `마지막 불꽃이군. 오늘은 ${fmt(pay)}이다. 가게 열쇠는 잘 챙겨 두게.`;
  if (s.grace) return '어제는 모자랐지? 이번만 후보를 공짜로 다시 뽑게 해 주지.';
  if (G.isSettleDay(s.day)) return `오늘은 결산일이지. ${fmt(pay)}, 깎아 줄 생각은 없다네.`;
  if (s.contractOffer) return '좋은 조건이 있는데… 읽어 보겠나? 작은 글씨는 없다네. 이번엔.';
  if (s.day === 1) return `어서 오게, 새 세입자. 첫날이니 ${fmt(pay)}만 받지.`;
  const byGuest = {
    witches: '마녀들이 온다지? 물약 냄새 좀 풍겨 보게.',
    adventurers: '원정대가 온다는군. 칼날 좀 반짝이게 닦아 두게.',
    school: '학생들이 몰려온다지. 책 냄새 나는 물건이 잘 나갈 걸세.',
    goblins: '고블린들이 온다네. 같은 걸 잔뜩 쌓아 두면 좋아하지.',
    noble: '귀족 나리가 오신다는군. 반짝이는 고급품을 꺼내 두게.',
    wanderers: '떠돌이 손님들이 온다네. 이것저것 골고루 놓아 두게.',
  };
  return `${byGuest[today]} 오늘은 ${fmt(pay)}이다.`;
}

function guestCard(id, label, off = false) {
  const c = CUSTOMERS[id];
  const fav = s.favor[id] ?? 0;
  const reg = s.regulars.includes(id) ? ' · 단골' : fav ? ` · 호감 ${'♥'.repeat(fav)}` : '';
  const cond = G.REGULAR[id] ? `호감 조건: ${G.REGULAR[id].cond}${label.startsWith('오늘') ? (G.guestCondMet(s, id) ? ' · 충족' : ' · 아직') : ''}` : '특별 손님 · 단골이 되지 않아요';
  return `<span class="k">${label}${reg}</span><img src="${guestImg(id)}" alt=""><b>${c.name}</b><p>${off ? '계약 때문에 오늘은 효과가 없어요' : GUEST_LIKE[id]}<br><small>${cond}</small></p>`;
}

function conflictText() {
  const today = G.customerOn(s, s.day);
  const { mods } = G.modsFor(s);
  if (mods.noCustomer) return '계약 때문에 오늘 손님의 보너스가 없어요.';
  const cat = CUSTOMERS[today].fav;
  if (cat && mods.catFlat[cat] < 0) return `오늘 손님은 ${CATS[cat].name}을 좋아하지만, 계약 때문에 ${CATS[cat].name} 보너스가 줄어요.`;
  return '';
}

function contractLine(c) {
  const t = G.CONTRACTS[c.id];
  const d = G.describeContract(s, c.id, c.data);
  if (t.type === 'cond') return `<div class="c-row"><div><b>${t.name}</b><small>${d.cond} · ${G.condProgressText(s, c)}</small></div><span class="left-tag">조건형</span></div>`;
  return `<div class="c-row"><div><b>${t.name}</b><small>${d.gain} · ${d.cost}</small></div><span class="left-tag">${G.contractDaysLeft(s, c)}일 남음</span></div>`;
}

function showMorning() {
  const pay = G.payFor(s);
  const today = G.customerOn(s, s.day), tomorrow = G.customerOn(s, s.day + 1);
  const { mods } = G.modsFor(s);
  $('m-day').textContent = `${s.day}일 차`;
  $('m-status').innerHTML = statusHTML();
  $('m-pay').textContent = fmt(pay);
  const prev = s.history[s.history.length - 1];
  const nextSettle = Math.ceil(s.day / G.SETTLE_EVERY) * G.SETTLE_EVERY;
  const settleText = G.isSettleDay(s.day) ? '오늘은 결산일 · 성공하면 성장 보상' : `결산일(${nextSettle}일 차)까지 ${nextSettle - s.day}일`;
  const debt = G.debtDueToday(s);
  $('m-paysub').textContent = `${prev ? `어제 ${fmt(prev.pay)} · ` : ''}${debt ? `빚 상환 +${debt.data.repay} 포함 · ` : ''}${settleText}`;
  $('m-pay').parentElement.classList.toggle('settle-day', G.isSettleDay(s.day));
  $('m-line').textContent = demonLine();
  $('m-today').innerHTML = guestCard(today, '오늘의 손님', mods.noCustomer);
  $('m-today').classList.toggle('off', mods.noCustomer);
  $('m-tomorrow').innerHTML = guestCard(tomorrow, '내일의 손님');
  const active = G.activeContracts(s);
  let html = '';
  if (s.regulars.length) html += `<div class="sect"><h3>단골</h3><span>${s.regulars.length} / 2</span></div>` +
    s.regulars.map((g) => `<div class="c-row"><div><b>${CUSTOMERS[g].name}${s.main === g ? ' <span class="main-tag">주력</span>' : ''}</b><small>${stageLine(g)}${s.main === g ? ` · ${CATS[CUSTOMERS[g].fav].name} 입고 1번 자리` : ''}</small></div>${heartsHTML(s.favor[g] ?? 0)}</div>`).join('');
  if (active.length) html += `<div class="sect"><h3>진행 중인 계약</h3><span>${active.length} / 2</span></div>` + active.map(contractLine).join('');
  const ex = s.lastExpand?.day === s.day ? s.lastExpand : null;
  if (ex) {
    const ch = ex.changed.map((c) => `${displayName(s.pieces.find((p) => p.uid === c.uid))} ${c.to - c.from > 0 ? '+' : ''}${c.to - c.from}`).join(' · ');
    html += `<div class="expand-card"><b>진열대 확장 ${ex.from.cols}×${ex.from.rows} → ${ex.to.cols}×${ex.to.rows}</b>
      <span>새 칸 ${ex.added}개가 오른쪽·아래에 생겼어요. 상품은 그 자리 그대로예요.</span>
      <span>${ex.changed.length ? `조건이 달라진 상품: ${ch} · 지금 배치 기준 하루 매출 ${ex.delta >= 0 ? '+' : ''}${ex.delta}. 새 칸에 다시 배치해 되찾을 수 있어요.` : '지금 배치의 매출은 그대로예요.'}</span></div>`;
  }
  const nx = G.nextExpansion(s);
  if (nx && nx.day === s.day + 1) {
    const pv = G.expansionPreview(s, s.dim, { cols: Math.max(nx.cols, s.dim.cols), rows: Math.max(nx.rows, s.dim.rows) });
    html += `<div class="expand-card soon"><b>내일 아침 진열대 확장 → ${nx.cols}×${nx.rows}</b><span>새 칸 ${pv.added}개${pv.changed.length ? ` · 가장자리 조건이 바뀌는 상품 ${pv.changed.length}개, 지금 배치 기준 하루 매출 ${pv.delta >= 0 ? '+' : ''}${pv.delta}` : ''}</span></div>`;
  }
  const warn = conflictText();
  if (warn) html += `<p class="warn">${warn}</p>`;
  if (s.grace) html += `<div class="grace"><svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v5h-5"/></svg><div><b>마왕의 유예</b>오늘 상품 후보 전체를 한 번 무료로 다시 뽑을 수 있어요. 오늘이 끝나면 사라져요.</div></div>`;
  if (s.contractOffer) html += `<button class="offer-callout" data-go="contract"><span>📜</span><span><b>마왕의 계약 제안 ${s.contractOffer.ids.length}건</b><small>서명하거나 모두 거절해야 오늘 영업을 시작할 수 있어요.</small></span><span>›</span></button>`;
  $('m-contracts').innerHTML = html;
  show('morning');
  S.play(debt ? 'debt_due' : G.isSettleDay(s.day) ? 'settlement_toll' : 'demon_voice', { delay: 0.2 });
}

function leaveMorning() {
  G.seeBrief(s);
  save();
  show('play');
  render();
}

/* ---------- 진열대 그리기 ---------- */

const pct = (v, n) => (v / n) * 100;
const GAP = '0.5cqw';

function viewDim() {
  const n = G.nextExpansion(s);
  return n ? { cols: Math.max(n.cols, s.dim.cols), rows: Math.max(n.rows, s.dim.rows) } : s.dim;
}

function cellBox(dim, x, y, out) {
  const [t, r, b, l] = out.map((o) => (o ? GAP : '-0.5px'));
  return `left:calc(${pct(x, dim.cols)}% + ${l});top:calc(${pct(y, dim.rows)}% + ${t});` +
    `width:calc(${pct(1, dim.cols)}% - ${l} - ${r});height:calc(${pct(1, dim.rows)}% - ${t} - ${b})`;
}

function labelBox(p) {
  const cells = cellsOf(p);
  const { w, h } = sizeOf(p.id, p.rot);
  if (cells.length === w * h) return { x: p.x, y: p.y, w, h };
  const cx = cells.reduce((a, c) => a + c[0], 0) / cells.length;
  const cy = cells.reduce((a, c) => a + c[1], 0) / cells.length;
  const [bx, by] = cells.reduce((best, c) =>
    Math.hypot(c[0] - cx, c[1] - cy) < Math.hypot(best[0] - cx, best[1] - cy) ? c : best);
  return { x: bx, y: by, w: 1, h: 1 };
}

// 일러스트: 길쭉한 상품을 옆으로 돌리면 그림도 90도, 창처럼 방향이 있는 상품은 회전 그대로
function picHTML(dim, p, b, textRows) {
  const cell = 100 / dim.cols;
  const w = b.w * cell - 2.2;
  const h = Math.max(b.h * cell - 2.2 - textRows * 3.2, cell * 0.45);
  const base = sizeOf(p.id, 0);
  const deg = DIRECTIONAL.has(p.id) ? (p.rot % 4) * 90 : base.w !== base.h && p.rot % 2 === 1 ? 90 : 0;
  const turned = deg % 180 === 90;
  const [mw, mh] = turned ? [h, w] : [w, h];
  return `<span class="pic" style="width:${w}cqw;height:${h}cqw">` +
    `<img src="${itemImg(imgKey(p))}" alt="" style="max-width:${mw}cqw;max-height:${mh}cqw;transform:translate(-50%,-50%)${deg ? ` rotate(${deg}deg)` : ''}"></span>`;
}

function pieceHTML(dim, p, { cls = '', sub = '', tag = '', rows = sub ? 1 : 0 } = {}) {
  const cells = cellsOf(p);
  const has = (x, y) => cells.some((c) => c[0] === x && c[1] === y);
  const it = ITEMS[p.id];
  const g = p.g ?? 1;
  const m = g >= 2 ? s?.mutations?.[p.id] : null;
  let html = `<div class="piece g${Math.min(g, 6)} ${cls}" style="--cat:${CATS[it.cat].color}" data-uid="${p.uid ?? ''}" aria-label="${gradeLabel(g)} ${displayName(p)}${m ? ` ${mutName(p.id, m)}` : ''}${isEgg(p) ? ` 성장 ${p.grow ?? 0}/${GROW_NEED}` : ''}">`;
  for (const [x, y] of cells) {
    const out = [!has(x, y - 1), !has(x + 1, y), !has(x, y + 1), !has(x - 1, y)];
    const c = [];
    if (out[0] && out[3]) c.push('r-tl');
    if (out[0] && out[1]) c.push('r-tr');
    if (out[2] && out[3]) c.push('r-bl');
    if (out[2] && out[1]) c.push('r-br');
    if (out[2]) c.push('floor');
    html += `<div class="pc ${c.join(' ')}" style="${cellBox(dim, x, y, out)}"></div>`;
  }
  const b = labelBox(p);
  html += `<div class="lbl" style="left:${pct(b.x, dim.cols)}%;top:${pct(b.y, dim.rows)}%;width:${pct(b.w, dim.cols)}%;height:${pct(b.h, dim.rows)}%">` +
    `<span class="gtag">${roman(g)}</span>${m ? hexHTML(p.id, m) : ''}${g >= 4 ? `<span class="gnum">${g}</span>` : ''}` +
    `${picHTML(dim, p, b, rows)}${isEgg(p) ? `<span class="growpill">${p.grow ?? 0}/${GROW_NEED}</span>` : ''}${sub}${tag}</div></div>`;
  return html;
}

function cellsHTML(dim, interactive, { ok = null, sealed = [], preview = [], locked = null } = {}) {
  const seal = new Set(sealed), pre = new Set(preview);
  let html = '';
  for (let y = 0; y < dim.rows; y++)
    for (let x = 0; x < dim.cols; x++) {
      const k = `${x},${y}`;
      const lock = locked && (x >= locked.cols || y >= locked.rows);
      const style = `left:${pct(x, dim.cols)}%;top:${pct(y, dim.rows)}%;width:${pct(1, dim.cols)}%;height:${pct(1, dim.rows)}%`;
      const c = `cell${ok?.has(k) ? ' ok' : ''}${seal.has(k) ? ' sealed' : ''}${pre.has(k) ? ' seal-preview' : ''}${lock ? ' locked' : ''}`;
      const label = `${y + 1}행 ${x + 1}열${seal.has(k) ? ' 봉인됨' : ''}${lock ? ' 잠김' : ''}`;
      html += interactive
        ? `<button class="${c}" data-x="${x}" data-y="${y}" style="${style}" aria-label="${label}"></button>`
        : `<div class="${c}" style="${style}"></div>`;
    }
  return html;
}

function sizeBoard(el, dim, capVh = 0) {
  el.style.aspectRatio = `${dim.cols} / ${dim.rows}`;
  if (capVh) el.parentElement.style.width = `min(100%, calc(${capVh}dvh * ${dim.cols} / ${dim.rows} + 16px))`;
}

function staticBoard(el, dim, pieces) {
  sizeBoard(el, dim);
  el.innerHTML = cellsHTML(dim, false) + pieces.map((p) => pieceHTML(dim, p)).join('');
}

/* ---------- 선택과 미리보기 ---------- */

function selectedItem() {
  if (!sel) return null;
  if (sel.kind === 'hand') return s.hand ?? null;
  return s.pieces.find((p) => p.uid === sel.uid) ?? null;
}
const selectedId = () => selectedItem()?.id ?? null;
const selectedPiece = () => (sel?.kind === 'piece' ? s.pieces.find((p) => p.uid === sel.uid) : null);
const ignoreUid = () => (sel?.kind === 'piece' ? sel.uid : undefined);

function ghostPiece() {
  if (!ghost || !sel) return null;
  const it = selectedItem();
  return { uid: sel.kind === 'piece' ? sel.uid : -1, id: it.id, g: it.g, ...ghost };
}
function ghostValid() {
  const g = ghostPiece();
  return !!g && canPlace(s.dim, s.pieces, g, ignoreUid(), G.sealedNow(s));
}
function previewPieces() {
  const g = ghostPiece();
  if (!g || !ghostValid()) return null;
  if (sel.kind === 'hand') return [...s.pieces, g];
  return s.pieces.map((p) => (p.uid === g.uid ? g : p));
}
function currentRot() {
  if (ghost) return ghost.rot;
  return sel?.kind === 'hand' ? handRot : selectedPiece()?.rot ?? 0;
}

function placeableCells() {
  const id = selectedId();
  if (!id) return null;
  const rot = currentRot();
  const sealed = G.sealedNow(s);
  const ok = new Set();
  for (let y = 0; y < s.dim.rows; y++)
    for (let x = 0; x < s.dim.cols; x++) {
      const p = { uid: ignoreUid() ?? -1, id, x, y, rot };
      if (canPlace(s.dim, s.pieces, p, ignoreUid(), sealed)) cellsOf(p).forEach(([cx, cy]) => ok.add(`${cx},${cy}`));
    }
  const grid = occupancy(s.dim, s.pieces, ignoreUid());
  for (const k of [...ok]) { const [x, y] = k.split(',').map(Number); if (grid[y][x] !== null) ok.delete(k); }
  return ok;
}

function setGhostAt(cx, cy, rot, grab) {
  const id = selectedId();
  const [gx, gy] = grab ?? shapeOf(id, rot)[0];
  ghost = { ...clampAnchor(s.dim, id, rot, cx - gx, cy - gy), rot };
}

function select(next) {
  sel = next;
  ghost = null;
  merging = null;
  if (next?.kind === 'hand') handRot = s.hand.rot ?? 0;
  if (next?.kind === 'piece') {
    const r = G.income(s).items.get(next.uid);
    if (r?.bonuses.some((b) => b.from.length)) S.play('link_highlight');
  }
}

function afterAction() {
  if (s.pendingMutation) { save(); return route(); }
  save();
  render();
}

function commit() {
  if (!ghostValid()) return false;
  const before = G.income(s).items;
  const g = ghost;
  let ok, uid;
  if (sel.kind === 'hand') { uid = s.nextUid; ok = G.placeHand(s, g.x, g.y, g.rot); }
  else { uid = sel.uid; ok = G.movePiece(s, uid, g.x, g.y, g.rot); }
  if (!ok) return false;
  markSparks(before);
  S.play('item_place');
  const sparkCats = [...spark].map((u) => ITEMS[s.pieces.find((p) => p.uid === u)?.id]?.cat);
  if (sparkCats.includes('food')) S.play('food_set', { delay: 0.15 });
  else if (sparkCats.includes('treasure')) S.play('treasure_shine', { delay: 0.15 });
  else if (spark.size) S.play('coin_tick', { delay: 0.15 });
  press = uid;
  select(null);
  if (s.phase === 'pick') S.play('restock_new', { delay: 0.25 });
  afterAction();
  return true;
}

function markSparks(before) {
  const after = G.income(s).items;
  spark = new Set();
  for (const [uid, r] of after) {
    const prev = before.get(uid);
    const gain = r.total - r.base;
    if (gain > 0 && (!prev || gain > prev.total - prev.base)) spark.add(uid);
  }
}

/* ---------- 03 상점 정리 ---------- */

function render() {
  if (!s) return;
  if (s.phase === 'over' || s.phase === 'reward' || s.pendingMutation) return route();

  const ev = G.income(s);
  const prev = previewPieces();
  let prevEv = prev ? G.income(s, prev) : null;
  if (merging && merging.target.uid !== -1) {
    const used = new Set(merging.set.map((q) => q.uid));
    const merged = s.pieces.filter((p) => p.uid === merging.target.uid || !used.has(p.uid))
      .map((p) => (p.uid === merging.target.uid ? { ...p, g: merging.g } : p));
    prevEv = G.income(s, merged);
  }
  const sales = ev.sum.total;
  const shown = prevEv ? prevEv.sum.total : sales;
  const pay = G.payFor(s);
  const coach = coachStep();

  $('p-day').textContent = `${s.day}일 차`;
  $('p-sub').textContent = s.phase === 'pick' ? `입고 ${s.picksDone + 1}/${s.picksDone + s.picksLeft}` : '상점 정리';
  $('p-status').innerHTML = statusHTML();
  $('btn-coach-skip').hidden = !coach;
  $('btn-menu').hidden = !!coach;

  $('g-sales').textContent = fmt(shown);
  $('g-pay').textContent = fmt(pay);
  $('g-fill').style.width = `${(Math.min(shown, pay) / Math.max(pay, 1)) * 100}%`;
  $('g-short').style.width = `${(Math.max(0, pay - shown) / Math.max(pay, 1)) * 100}%`;
  const note = $('g-note');
  if (shown < pay) { note.textContent = `${fmt(pay - shown)} 부족 · 불꽃 위험`; note.className = 'g-note short'; }
  else { note.textContent = `잔금 +${fmt(shown - pay)}`; note.className = 'g-note ok'; }
  $('gauge').classList.toggle('hl', coach === 3);

  renderStrip();

  // 후보를 고르는 동안에도 진열대를 작게 보여 준다(보기 전용). 고른 후보와 같은 상품·등급은 표시한다.
  const picking = s.phase === 'pick';
  const shelf = $('board').parentElement;
  shelf.hidden = false;
  shelf.classList.toggle('peek', picking);
  const pickId = picking && pickedOffer !== null ? s.offers[pickedOffer]?.id : null;
  const zoomOn = zoom && !picking;
  shelf.classList.toggle('zoomed', zoomOn);
  $('btn-zoom').hidden = picking || s.dim.cols * s.dim.rows < 35;
  $('btn-zoom').textContent = zoomOn ? '전체 보기' : '확대 보기';
  $('zoom-hint').hidden = !zoomOn;

  // 진열대
  const board = $('board');
  const vdim = viewDim();
  sizeBoard(board, vdim, picking ? 24 : 34);
  if (zoomOn) shelf.style.width = '100%';
  const g = ghostPiece();
  const matUids = new Set(merging ? merging.set.map((q) => q.uid) : []);
  // 선택한 상품이 받는 효과의 출처: 화살표와 받는 양
  const srcGive = new Map();
  const selP = !merging && !ghost ? selectedPiece() : null;
  if (selP) for (const b of ev.items.get(selP.uid).bonuses) for (const u of b.from) srcGive.set(u, (srcGive.get(u) ?? 0) + (b.from.length === 1 ? b.amount : 0));
  let html = cellsHTML(vdim, true, { ok: sel && !merging ? placeableCells() : null, sealed: G.sealedNow(s), locked: s.dim });
  for (const p of s.pieces) {
    const r = ev.items.get(p.uid);
    const cls = [];
    let piece = p;
    if (merging && p.uid === merging.target.uid) { cls.push('result'); piece = { ...p, g: merging.g }; }
    else if (matUids.has(p.uid)) cls.push('mat');
    if (!merging && sel?.kind === 'piece' && sel.uid === p.uid) cls.push('selected', ghost ? 'lifted' : '');
    if (srcGive.has(p.uid)) cls.push('link-src');
    if (spark.has(p.uid)) cls.push('spark');
    const match = pickId && p.id === pickId && p.g === s.offerGrade && !isEgg(p);
    if (match) cls.push('match');
    if (press === p.uid) cls.push('press');
    let tag = '';
    if (prevEv && p.uid !== g?.uid && prevEv.items.has(p.uid)) {
      const gain = prevEv.items.get(p.uid).total - r.total;
      if (gain) tag = `<span class="ptag ${gain > 0 ? 'up' : 'bad'}">${gain > 0 ? '+' : ''}${gain}</span>`;
    } else if (srcGive.get(p.uid)) tag = `<span class="ptag src">+${srcGive.get(p.uid)}</span>`;
    else if (match) tag = '<span class="ptag up">같은 상품</span>';
    const bonus = r.bonuses.some((b) => b.amount > 0);
    const sub = `<span class="per">${bonus ? '<b>✦</b> ' : ''}하루 ${(prevEv?.items.get(p.uid) ?? r).total}</span>`;
    html += pieceHTML(vdim, piece, { cls: cls.join(' '), sub, tag });
  }
  if (g) {
    const valid = ghostValid();
    const tag = valid ? `<span class="ptag">+${prevEv.items.get(g.uid).total}</span>` : '<span class="ptag bad">✕ 놓을 수 없음</span>';
    html += pieceHTML(vdim, g, { cls: `ghost ${valid ? 'valid' : 'invalid'}`, tag });
  }
  board.innerHTML = html;
  spark = new Set();
  press = null;

  if (picking) {
    renderOffers(coach);
    renderActions(coach);
    return;
  }
  if (zoomOn) focusZoom();
  renderPanel(ev, prevEv, coach);
  renderActions(coach);
}

// 접을 수 있는 준비 패널: 주력·단골 호감도, 오늘·내일 손님과 호감 조건, 계약
function guestLine(label, g, today) {
  const c = CUSTOMERS[g];
  if (!G.REGULAR[g]) return `<dt>${label}</dt><dd>${c.name} · 특별 손님 · ${GUEST_LIKE[g]}</dd>`;
  const st = G.stageOf(s.favor[g] ?? 0);
  const met = G.guestCondMet(s, g);
  return `<dt>${label}</dt><dd>${c.name}${st ? ` · ${st.name}` : ''} · ${G.REGULAR[g].cond} ${met ? `<span class="okc">충족${today ? ' → 영업 후 호감 +1' : ''}</span>` : '<span class="noc">아직</span>'}</dd>`;
}

function renderStrip() {
  const today = G.customerOn(s, s.day), tomorrow = G.customerOn(s, s.day + 1);
  const active = G.activeContracts(s);
  const soon = active.map((c) => G.contractDaysLeft(s, c)).sort((a, b) => a - b)[0];
  const lead = s.main ? `주력 <b>${SHORT[s.main]}</b>` : G.startSupport(s) ? `시작 분야 <b>${CATS[s.startCat].name}</b>` : '단골 <b>없음</b>';
  $('strip-sum').innerHTML = `${lead} · 손님 <b>${SHORT[today]}</b> → <b>${SHORT[tomorrow]}</b> · 계약 <b>${active.length}/2</b>` +
    (soon ? ` <span class="due">마감 D-${soon - 1}</span>` : '') + (s.contractOffer ? ' · <span class="due">제안 도착</span>' : '');
  const head = $('strip-head');
  head.setAttribute('aria-expanded', String(stripOpen));
  $('strip-word').textContent = stripOpen ? '접기' : '펼치기';
  const chips = $('p-chips');
  chips.hidden = !stripOpen && !s.contractOffer;
  let html = '';
  if (stripOpen) {
    html += '<div class="prep">';
    if (s.regulars.length) {
      html += s.regulars.map((g) => {
        const f = s.favor[g] ?? 0;
        const nx = G.nextStage(f);
        return `<div class="prow"><img class="pface${s.main === g ? ' main' : ''}" src="${guestImg(g)}" alt="">
          <div><b>${CUSTOMERS[g].name}</b>${s.main === g ? '<span class="main-tag">주력</span>' : ''}<small class="stg">${G.stageOf(f)?.name ?? ''}</small>
          ${heartsHTML(f)}<small>${nx ? `${nx.name}까지 호감 ${nx.at - f}` : '최고 단계'}${s.main === g ? ` · ${CATS[CUSTOMERS[g].fav].name} 입고 1번 자리` : ''}</small></div></div>`;
      }).join('');
    } else if (G.startSupport(s)) {
      html += `<p class="pnote">아직 단골이 없어요. ${G.START_SUPPORT_UNTIL}일 차까지 입고 1번 자리는 시작 분야(${CATS[s.startCat].name})에서 나와요.</p>`;
    }
    html += `<dl class="pguests">${guestLine('오늘', today, true)}${guestLine('내일', tomorrow, false)}</dl>`;
    if (active.length) html += `<div class="pcons">${active.map((c) => { const t = G.CONTRACTS[c.id]; return `<button class="chip contract" data-go="contract-info" data-c="${c.id}">📜 ${t.name} · ${t.type === 'cond' ? G.condProgressText(s, c) : `${G.contractDaysLeft(s, c)}일 남음`}</button>`; }).join('')}</div>`;
    const extra = [s.priority ? `★ 우선 입고 ${ITEMS[s.priority].name}` : '', s.freeTickets ? `🎟 1번 다시 뽑기 ${s.freeTickets}장` : '', s.tickets ? `추가 입고 이용권 ${s.tickets}장` : '', s.upTickets ? `⇧ 등급 올리기 이용권 ${s.upTickets}장` : '', s.orderTickets ? `📦 지정 발주권 ${s.orderTickets}장` : ''].filter(Boolean);
    if (extra.length) html += `<p class="pnote">${extra.join(' · ')}</p>`;
    html += '</div>';
  }
  if (s.contractOffer) html += `<button class="chip offer" data-go="contract">📜 계약 제안 ${s.contractOffer.ids.length}건 · 영업 전에 결정</button>`;
  chips.innerHTML = html;
}

function coachHTML(step, dir) {
  const t = {
    1: ['상품을 하나 골라 진열대에 놓아 보세요', '후보를 누른 뒤 [고르기], 놓고 싶은 칸을 누르면 돼요. 오늘은 두 번 들여올 수 있어요.'],
    2: ['어울리는 상품을 붙여 놓으면 보너스!', '약초는 옆 물약을, 숫돌은 옆 검·활을 키워요. 상하좌우로 맞닿아야 해요.'],
    3: ['예상 매출이 목표를 넘는지 보고 영업!', '모자라면 영혼의 불꽃이 하나 꺼져요. 남는 돈은 잔금이 되어 다시 뽑기·확장에 써요.'],
  }[step];
  return `<div class="coach ${dir}"><div class="step">안내 ${step} / 3</div><div class="ttl2">${t[0]}</div><p class="body">${t[1]}</p></div>`;
}

function whyText(o, i) {
  const same = s.pieces.filter((p) => p.id === o.id && p.g === s.offerGrade && !isEgg(p)).length;
  const role = {
    main: `${SHORT[s.main] ?? ''} 추천`, start: '시작 분야 추천', same: '보유 상품', new: '새로운 상품', exclusive: '독점 입고', reward: '보상 입고', egg: `${o.egg} 성장용`,
  }[o.why] ?? '';
  const extra = [];
  if (o.why === 'same' && same > 0 && same < 3) extra.push(same === 2 ? '고르면 합성 가능' : '합성까지 1개 더');
  if (o.complete && same !== 2) extra.push('합성 완성');
  if (o.rare) extra.push('오랜만의 분야');
  if (o.prio) extra.push('★ 우선 입고');
  return `${i + 1} · ${[role, ...extra].join(' · ')}`;
}

function renderOffers(coach) {
  const rewardPick = s.offers.every((o) => o.why === 'reward');
  const banner = rewardPick
    ? `<div class="main-banner">${catIcon(ITEMS[s.offers[0].id].cat, 'bicon')}<div><b>주력 단골 보상 · ${CATS[ITEMS[s.offers[0].id].cat].name} ${roman(s.offerGrade)}등급</b><small>셋 중 하나를 골라요 · 이번 입고 1번에 포함</small></div></div>`
    : s.main
    ? `<div class="main-banner"><img src="${guestImg(s.main)}" alt=""><div><b>주력 단골 · ${CUSTOMERS[s.main].name}</b>${G.stageOf(s.favor[s.main] ?? 0) ? `<span class="main-tag soft">${G.stageOf(s.favor[s.main] ?? 0).name}</span>` : ''}<small>입고 1번 자리를 ${CATS[CUSTOMERS[s.main].fav].name} 상품으로 채워요</small></div></div>`
    : G.startSupport(s) ? `<div class="main-banner">${catIcon(s.startCat, 'bicon')}<div><b>시작 분야 · ${CATS[s.startCat].name}</b><small>첫 단골 전까지(${G.START_SUPPORT_UNTIL}일 차) 1번 자리를 채워요</small></div></div>` : '';
  const rows = s.offers.map((o, i) => {
    const it = ITEMS[o.id];
    const egg = !!it.egg;
    const name = egg ? it.egg.name : it.name;
    const desc = egg ? `성장 전 · ${it.egg.grow}` : effectText(o.id, s.offerGrade);
    return `<div class="oslot"><span class="otag t${o.why}">${whyText(o, i)}</span>
      <button class="orow${pickedOffer === i ? ' sel' : ''}${coach === 1 && i === 0 && pickedOffer === null ? ' hl' : ''}" data-offer="${i}">
      <span class="art"><img src="${itemImg(egg ? `${o.id}_egg` : o.id)}" alt=""></span>
      <span class="body"><span class="nm">${name}<span class="r">${roman(s.offerGrade)}</span><span class="cat" style="background:${CATS[it.cat].color}">${catIcon(it.cat, 'mini-ic')}${CATS[it.cat].name}</span></span>
      <span class="eff">${it.cells.length}칸 · 기본 ${egg ? it.egg.base : gradeBase(o.id, s.offerGrade)} · ${desc}</span></span></button></div>`;
  }).join('');
  const cost = G.rerollCost(s);
  const one = s.freeTickets > 0 && G.slot1Cat(s) && !s.offerCat
    ? `<button class="btn rr one" data-act="reroll-one">1번만 다시 뽑기<small>무료 이용권 ${s.freeTickets} / ${G.MAX_TICKETS}</small></button>` : '';
  const all = `<button class="btn rr" data-act="reroll-all" ${s.balance < cost ? 'disabled' : ''}>전체 새로고침<small>${cost === 0 ? (s.grace ? '마왕의 유예 · 무료' : '무료') : `잔금 ${cost}`} · 자리 역할 유지</small></button>`;
  $('panel').innerHTML = (coach ? coachHTML(coach, 'down') : '') + banner +
    `<div class="offer-list">${rows}</div>${rewardPick ? '' : `<div class="rr-row${one ? '' : ' single'}">${one}${all}</div>`}` +
    (one ? '<p class="fine center">다시 뽑아도 같은 상품이 나올 수 있어요</p>' : '');
}

function eggDetailHTML(item, acts) {
  const it = ITEMS[item.id];
  const gc = item.uid > 0 ? growthCheck(s.pieces, s.dim, G.sealedNow(s)).get(item.uid) : null;
  const res = !gc ? '진열한 뒤 조건을 채우면 영업이 끝날 때 성장해요'
    : gc.gain ? (gc.to >= GROW_NEED ? '<b>영업이 끝나면 성장 완료</b> · 새 매출은 내일부터' : `영업이 끝나면 성장 ${gc.from} → ${gc.to}`)
    : `그대로 ${gc.from}/${GROW_NEED}`;
  return `<div class="detail egg">
    <div class="evo"><span><img src="${itemImg(`${item.id}_egg`)}" alt=""></span><i>→</i><span><img src="${itemImg(item.id)}" alt=""></span></div>
    <div class="dh"><span class="nm">${it.egg.name} · 성장 ${item.grow ?? 0}/${GROW_NEED}</span><span class="cat" style="background:${CATS.beast.color}">${catIcon('beast', 'mini-ic')}마수·알</span><span class="acts">${acts}</span></div>
    <dl><dt>성장 조건</dt><dd>${it.egg.grow}${gc ? (gc.met ? ` <span class="okc">충족 (${gc.why})</span>` : ' <span class="noc">아직</span>') : ''}</dd>
      <dt>둥지 지원</dt><dd>${gc?.nest ? '<span class="okc">정령 둥지와 붙어 있음 · +1</span>' : '없음 · 정령 둥지와 붙으면 +1'}</dd>
      <dt>오늘 결과</dt><dd>${res}</dd>
      <dt>성장 후</dt><dd>${it.name} · 기본 ${gradeBase(item.id, item.g ?? 1)}</dd></dl>
    <p class="hint">성장 전에는 합성할 수 없어요. 자라도 칸 모양은 그대로예요.</p></div>`;
}

function eggListHTML(exceptUid) {
  const gc = growthCheck(s.pieces, s.dim, G.sealedNow(s));
  const rows = s.pieces.filter((p) => isEgg(p) && p.uid !== exceptUid).map((p) => {
    const r = gc.get(p.uid);
    return `<div class="egg-row"><span class="art"><img src="${itemImg(imgKey(p))}" alt=""></span><span><b>${displayName(p)}</b> · ${r.met ? r.why : '조건 아직'}${r.met && r.nest ? ' + 둥지 +1' : ''}</span>` +
      `<b class="${r.gain ? (r.to >= GROW_NEED ? 'okc' : 'okc') : 'noc'}">${r.gain ? `${r.from} → ${r.to}${r.to >= GROW_NEED ? ' 완료' : ''}` : `${r.from}/${GROW_NEED} 그대로`}</b></div>`;
  }).join('');
  return rows ? `<div class="egg-list">${rows}</div>` : '';
}

function detailHTML(item, now, after, { acts = '', hint = '', warn = false, extra = '' } = {}) {
  if (isEgg(item)) return eggDetailHTML(item, acts) + (item.uid > 0 ? eggListHTML(item.uid) : '');
  const it = ITEMS[item.id];
  const g = item.g ?? 1;
  const m = s.mutations[item.id];
  const same = s.pieces.filter((p) => p.id === item.id && p.g === g).length + (item.uid === -1 ? 1 : 0);
  const need = Math.max(0, 3 - same);
  const parts = { base: 0, place: 0, mut: 0, customer: 0, contract: 0 };
  const take = (r) => { const o = { base: r.base, place: 0, mut: 0, customer: 0, contract: 0 }; r.bonuses.forEach((b) => { o[b.kind] += b.amount; }); return o; };
  const a = now ? take(now) : parts;
  const b = after ? take(after) : null;
  const box = (k, label) => {
    const v = (b ?? a)[k];
    const diff = b ? b[k] - a[k] : 0;
    const txt = k === 'base' ? fmt(v) : `${v >= 0 ? '+' : ''}${fmt(v)}`;
    return `<div>${label}<b class="${diff > 0 ? 'up' : diff < 0 ? 'dn' : ''}">${txt}</b></div>`;
  };
  const total = (after ?? now)?.total ?? gradeBase(item.id, g);
  const diffTotal = after && now ? after.total - now.total : 0;
  return `<div class="detail">
    <div class="dh"><span class="nm">${it.name} ${roman(g)}</span>${m && g >= 2 ? `${hexHTML(item.id, m, 'hex-big')}<span class="mname">${mutName(item.id, m)}</span>` : ''}<span class="acts">${acts}</span></div>
    <dl><dt>기본 효과</dt><dd>${effectText(item.id, g)}</dd>
      <dt>합성 등급</dt><dd>${roman(g)} · ${roman(g + 1)}까지 ${roman(g)} ${need ? `${need}개 더 필요` : '합성 가능'}</dd>
      <dt>변이</dt><dd class="${m ? '' : 'muted'}">${m ? (g >= 2 ? mutText(item.id, m, g) : `Ⅱ등급부터 적용 · ${mutName(item.id, m)}: ${mutText(item.id, m, 2)}`) : '처음 Ⅱ등급이 되면 두 변이 중 하나를 골라요'}</dd></dl>
    <div class="chain">${box('base', '기본')}<i>›</i>${box('place', '배치')}<i>›</i>${box('mut', '변이')}<i>›</i>${box('customer', '손님')}<i>›</i>${box('contract', '계약')}</div>
    <div class="day"><span>하루 예상${diffTotal ? ` <small>(${diffTotal > 0 ? '+' : ''}${diffTotal})</small>` : ''}</span><b>${fmt(total)}</b></div>
    ${hint ? `<p class="hint${warn ? ' warn' : ''}">${hint}</p>` : ''}${extra}</div>`;
}

function mergeOfferHTML(plan) {
  if (!plan) return '';
  return `<div class="merge-offer"><span>🔥 <b>합성 가능</b> · 같은 ${ITEMS[plan.target.id].name} ${roman(plan.target.g)} 3개</span>` +
    `<button class="small-btn hot" data-act="merge-preview">미리보기</button></div>`;
}

function mergePanelHTML() {
  const m = merging;
  const id = m.target.id;
  const name = ITEMS[id].name;
  const before = m.set.reduce((a, q) => a + gradeBase(id, q.g), 0);
  const after = gradeBase(id, m.g);
  const today = G.customerOn(s, s.day), tomorrow = G.customerOn(s, s.day + 1);
  const rows = [
    ['오늘 기본 매출', `${before} → ${after} <span class="minus">(${after - before >= 0 ? '+' : ''}${after - before})</span>`],
    ['빈 칸', `+${ITEMS[id].cells.length * 2}칸`],
  ];
  if (m.g === 2 && !s.mutations[id]) rows.push(['변이', '처음 Ⅱ등급 · 변이를 골라요']);
  if (today === 'goblins') rows.push(['오늘 고블린 행상단', '같은 상품 보너스가 줄어요']);
  if (tomorrow === 'noble' || today === 'noble') rows.push([`${today === 'noble' ? '오늘' : '내일'} 귀족 수집가`, '높은 등급 보너스 대상']);
  const where = m.target.uid === -1 ? '손에 든 새 상품이 한 등급 올라요.' : '흐리게 표시된 칸은 합성 후 비어요.';
  return `<div class="parch-panel"><h4>${gradeLabel(m.target.g)} ${name} <span class="r">${roman(m.target.g)}</span> × 3 → ${gradeLabel(m.g)} ${name} <span class="r">${roman(m.g)}</span></h4>` +
    `<dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl><p>${where} 영업 전까지 되돌릴 수 있어요.</p></div>`;
}

function renderPanel(ev, prevEv, coach) {
  const panel = $('panel');
  if (merging) { panel.innerHTML = mergePanelHTML(); return; }

  if (sel?.kind === 'piece') {
    const p = selectedPiece();
    const now = ev.items.get(p.uid);
    let after = null, hint = '옮길 칸을 누르거나 끌어 보세요. 녹색 점선 상품이 효과를 주고 있어요.', warn = false;
    if (ghost) {
      if (prevEv) { after = prevEv.items.get(p.uid); hint = `옮기면 전체 매출 ${prevEv.sum.total - ev.sum.total >= 0 ? '+' : ''}${prevEv.sum.total - ev.sum.total}`; }
      else { hint = '다른 상품이나 봉인된 칸과 겹쳐서 놓을 수 없어요.'; warn = true; }
    }
    const up = G.upgradeCost(s, p);
    const today = s.upgradedDay === s.day;
    const upBtn = up === null ? '' : `<button class="small-btn${up === 0 && !today ? ' hot' : ''}" data-act="upgrade" ${s.balance < up || s.pendingMutation || today ? 'disabled' : ''}>${today ? '오늘은 이미 올렸어요' : `${roman(p.g + 1)}로 올리기 · ${up === 0 ? '이용권' : `잔금 ${up}`}`}</button>`;
    const acts = `${upBtn}<button class="small-btn" data-act="discard">팔기 +${G.sellValue(p)}</button><button class="small-btn" data-act="deselect">닫기</button>`;
    panel.innerHTML = detailHTML(p, now, after, { acts, hint, warn, extra: ghost ? '' : mergeOfferHTML(G.mergePlan(s, p.uid)) });
    return;
  }

  if (s.phase === 'place' && s.hand) {
    const h = { ...s.hand, uid: -1 };
    if (!sel) {
      panel.innerHTML = detailHTML(h, null, null, { acts: '<button class="small-btn hot" data-act="hold">새 상품 들기</button>', hint: `${s.ordering ? '지정 발주 상품이에요. ' : ''}진열대 정리 중이에요. 상품을 눌러 옮기거나 버리거나 합성한 뒤 [새 상품 들기]를 누르세요.` });
      return;
    }
    let after = null, hint = '진열대에서 놓을 칸을 누르세요.', warn = false;
    if (ghost) {
      if (prevEv) { after = prevEv.items.get(-1); hint = ''; }
      else { hint = '다른 상품이나 봉인된 칸과 겹쳐서 놓을 수 없어요.'; warn = true; }
    } else if (!anyFit(s.dim, s.pieces, s.hand.id, G.sealedNow(s))) {
      hint = '놓을 자리가 없어요. 합성하거나, [진열대 정리]로 옮기거나 버리고, 아니면 → 버튼으로 넘겨요.';
      warn = true;
    }
    panel.innerHTML = (coach ? coachHTML(coach, 'up') : '') +
      detailHTML(h, null, after, { acts: '<button class="small-btn" data-act="tidy">진열대 정리</button>', hint, warn, extra: ghost ? '' : mergeOfferHTML(G.mergePlan(s, 'hand')) });
    return;
  }

  // 정리 단계
  const extra = G.extraCost(s);
  const blocked = G.extraBlocked(s);
  if (orderOpen) { panel.innerHTML = orderPanelHTML(); return; }
  const oc = G.orderCost(s);
  const ob = G.orderBlocked(s, null);
  const nx = G.nextExpansion(s);
  panel.innerHTML = `<div class="done-line"><svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg>오늘 입고 완료 · 상품을 눌러 상세·합성을 볼 수 있어요</div>` + eggListHTML(null) +
    `<div class="shopbar">
      <button class="btn" data-act="extra" ${blocked || s.balance < extra ? 'disabled' : ''}>추가 입고<small>${blocked ? '검소한 영업 중' : s.tickets ? `이용권 1장 사용` : `잔금 ${extra} · 후보 셋 중 하나`}</small></button>
      <button class="btn order" data-act="order-open" ${ob && !/잔금/.test(ob) ? 'disabled' : ''}>지정 발주<small>${blocked ? '검소한 영업 중' : (s.ordersToday ?? 0) >= G.ORDERS_PER_DAY ? '오늘 2번 모두 사용' : `${oc === 0 ? '발주권 1장' : `잔금 ${oc}`} · 오늘 ${s.ordersToday ?? 0}/${G.ORDERS_PER_DAY}`}</small></button>
    </div>
    <p class="expand-note">${nx ? `진열대 ${s.dim.cols}×${s.dim.rows} · <b>${nx.day}일 차</b> 아침에 ${nx.cols}×${nx.rows}로 넓어져요` : `진열대 최대 크기 ${s.dim.cols}×${s.dim.rows}`}</p>` + (coach === 3 ? `<div style="margin-top:14px">${coachHTML(3, 'down')}</div>` : '');
}

// 지정 발주: 진열 중인 종류 중 하나를 확정 입고(1등급, 마수는 알)
let orderOpen = false;
function orderPanelHTML() {
  const cost = G.orderCost(s);
  const rows = G.orderables(s).map((id) => {
    const it = ITEMS[id];
    const why = G.orderBlocked(s, id);
    const have = s.pieces.filter((p) => p.id === id);
    const g1 = have.filter((p) => p.g === 1 && !isEgg(p)).length;
    const note = it.egg ? `${it.egg.name}(성장 전)으로 와요` : g1 === 2 ? '받으면 바로 합성할 수 있어요' : `진열 ${have.length}개 · Ⅰ등급 ${g1}개`;
    return `<button class="orow order-row" data-order="${id}" ${why ? 'disabled' : ''}>
      <span class="art"><img src="${itemImg(it.egg ? `${id}_egg` : id)}" alt=""></span>
      <span class="body"><span class="nm">${it.egg ? it.egg.name : it.name}<span class="r">Ⅰ</span></span><span class="eff">${why ?? note}</span></span></button>`;
  }).join('');
  return `<div class="order-head"><b>지정 발주</b><span>${cost === 0 ? `발주권 사용 (보유 ${s.orderTickets})` : `잔금 ${cost}`} · 오늘 ${s.ordersToday ?? 0}/${G.ORDERS_PER_DAY}${(s.ordersToday ?? 0) === 0 && cost ? ` · 두 번째는 ${cost * 2}` : ''}</span></div>
    <p class="fine">진열 중인 상품 종류만 1등급으로 확정 입고해요. 받은 상품은 놓거나, 손에 든 채로 합성하거나, 버릴 수 있어요. 기본 입고 횟수는 그대로예요.</p>
    <div class="offer-list">${rows}</div>
    <div class="rr-row single"><button class="btn rr" data-act="order-close">닫기</button></div>`;
}

function renderActions(coach) {
  const main = $('btn-main');
  const cancel = $('btn-merge-cancel');
  const reroll = $('btn-reroll');
  main.classList.remove('hl');
  reroll.hidden = true;
  cancel.hidden = true;
  $('btn-rotate').hidden = false;
  $('btn-undo').hidden = false;
  if (merging) {
    $('btn-rotate').hidden = true;
    $('btn-skip').hidden = true;
    $('btn-undo').disabled = !G.canUndo(s);
    cancel.hidden = false;
    main.textContent = '합성하기';
    main.disabled = false;
    return;
  }
  $('btn-undo').disabled = !G.canUndo(s);
  if (s.phase === 'pick') {
    $('btn-rotate').hidden = true;
    $('btn-skip').hidden = false;
    const po = pickedOffer !== null ? ITEMS[s.offers[pickedOffer].id] : null;
    main.textContent = po ? `${po.egg ? po.egg.name : po.name} 고르기` : '후보를 골라 주세요';
    main.disabled = pickedOffer === null;
    return;
  }
  $('btn-rotate').disabled = !sel;
  $('btn-skip').hidden = s.phase !== 'place';
  let label, enabled = false;
  if (ghost) {
    enabled = ghostValid();
    label = enabled ? '여기에 놓기' : '놓을 수 없는 자리';
    if (enabled && coach === 2) main.classList.add('hl');
  } else if (sel?.kind === 'hand') label = '놓을 칸을 누르세요';
  else if (s.phase === 'arrange' && G.contractPending(s)) { enabled = true; label = '계약을 먼저 결정하세요'; main.classList.add('hl'); }
  else if (G.canOpen(s)) { enabled = true; label = '영업 시작'; if (coach === 3) main.classList.add('hl'); }
  else if (s.phase === 'place') label = '새 상품을 놓아 주세요';
  else label = '영업 준비 중';
  main.textContent = label;
  main.disabled = !enabled;
}

function coachStep() {
  if (tut || tutorialDone() || s.day !== 1) return 0;
  if (s.picksDone === 0) return 1;
  if (s.picksDone === 1 && s.phase !== 'arrange') return 2;
  return 3;
}

/* ---------- 합성 ---------- */

function startMerge() {
  const plan = sel ? G.mergePlan(s, sel.kind === 'hand' ? 'hand' : sel.uid) : null;
  if (!plan) return;
  ghost = null;
  merging = plan;
  S.play('merge_ready');
  render();
}

function confirmMerge() {
  if (!merging) return;
  const target = merging.target.uid === -1 ? 'hand' : merging.target.uid;
  if (!G.merge(s, target)) return;
  S.play('merge_complete');
  if (target !== 'hand') { press = target; spark.add(target); }
  merging = null;
  resetSelection();
  if (target === 'hand' && s.phase === 'place') sel = { kind: 'hand' };
  afterAction();
}

/* ---------- 11 변이 선택 ---------- */

function mutWay(id, m) {
  const t = ITEMS[id].muts[m][1];
  if (/오는 날/.test(t)) return MUT_WAY.guest;
  if (/하나에/.test(t)) return MUT_WAY.focus;
  if (/마다 \+/.test(t) && !/자신/.test(t)) return MUT_WAY.aura;
  if (/면 /.test(t)) return MUT_WAY.cond;
  return MUT_WAY.self;
}

function showMutation() {
  const id = s.pendingMutation;
  const it = ITEMS[id];
  $('mu-day').textContent = `${s.day}일 차`;
  $('mu-status').innerHTML = statusHTML();
  $('mu-img').src = itemImg(id);
  $('mu-title').textContent = `${it.name} 첫 Ⅱ등급!`;
  $('mu-lead').innerHTML = `변이를 하나 골라요. 이번 판의 <b>Ⅱ등급 이상 ${it.name} 전체</b>에 적용돼요.`;
  const base = G.income(s).sum.total;
  const ctx = G.ctxFor(s);
  $('mu-list').innerHTML = ['A', 'B'].map((m) => {
    const v = evaluate(s.pieces, { ...ctx, mutations: { ...s.mutations, [id]: m } }).sum.total - base;
    return `<button class="mu-card${pickedMut === m ? ' sel' : ''}" data-mut="${m}"><span class="h">${hexHTML(id, m, 'hex-big')}${mutName(id, m)}</span>
      <p>${mutText(id, m, 2)}</p><p class="way">${mutWay(id, m)}</p><p class="now">지금 진열 기준 하루 ${v >= 0 ? '+' : ''}${v}</p></button>`;
  }).join('');
  const btn = $('btn-mutation');
  btn.disabled = !pickedMut;
  btn.textContent = pickedMut ? `${mutName(id, pickedMut)}(으)로 정하기` : '변이를 골라 주세요';
  show('mutation');
}

/* ---------- 13 단골 제안 ---------- */

function showRegular() {
  const g = s.regularOffer;
  const c = CUSTOMERS[g];
  $('rg-day').textContent = `${s.last?.day ?? s.day}일 차`;
  $('rg-status').innerHTML = statusHTML();
  const fav = s.favor[g] ?? 0;
  $('rg-offer').innerHTML = `<div class="h"><img src="${guestImg(g)}" alt=""><div><b>${c.name}이(가) 단골이 되고 싶어 해요</b>
    ${heartsHTML(fav)}<small>오늘 방문 +1 · 방문당 최대 +1</small></div></div>
    <dl><dt>호감 조건</dt><dd>${G.REGULAR[g].cond}</dd><dt>단골 효과</dt><dd>${regEffect(g)} · 주력 결산 보상</dd><dt>지금 단계</dt><dd>${stageLine(g)}</dd></dl>`;
  const full = s.regulars.length >= 2;
  $('rg-slots-title').textContent = `단골 자리 ${s.regulars.length} / 2`;
  $('rg-slots-lead').textContent = full ? '자리가 다 찼어요. 한 집단을 교체하거나 제안을 거절할 수 있어요.' : '빈자리가 있어요. 받아들이거나 거절할 수 있어요.';
  if (full && !s.regulars.includes(swapOut)) swapOut = null;
  $('rg-slots').innerHTML = [0, 1].map((i) => {
    const r = s.regulars[i];
    if (!r) return '<div class="rg-slot empty">빈자리</div>';
    return `<button class="rg-slot${swapOut === r ? ' sel' : ''}" data-swap="${r}">${swapOut === r ? '<span class="swap">교체</span>' : ''}<img src="${guestImg(r)}" alt=""><b>${CUSTOMERS[r].name}${s.main === r ? ' · 주력' : ''}</b><small>${stageLine(r)}</small></button>`;
  }).join('');
  const acc = $('btn-rg-accept');
  if (!full) { acc.textContent = '단골로 맞이하기'; acc.disabled = false; }
  else { acc.textContent = swapOut ? `${SHORT[swapOut]} 대신 단골로` : '교체할 단골을 골라요'; acc.disabled = !swapOut; }
  show('regular');
}

/* ---------- 15 결산 보상 ---------- */

function showReward() {
  $('rw-day').textContent = `${s.last?.day ?? s.day}일 차`;
  $('rw-status').innerHTML = statusHTML();
  const kinds = [...new Set(s.pieces.map((p) => p.id))];
  $('rw-list').innerHTML = s.rewardOffer.map((k) => {
    const r = G.REWARDS[k];
    let inner = `<b>${r.name}</b><span>${r.text}</span><span class="pv">${G.rewardPreview(s, k)}</span>`;
    if (k === 'priority' && pickedReward === 'priority') {
      inner += `<div class="prio-grid">${kinds.map((id) => `<button data-prio="${id}" class="${pickedPrio === id ? 'sel' : ''}"><img src="${itemImg(id)}" alt="">${ITEMS[id].name}</button>`).join('')}</div>` +
        `<span class="now">지금 지정: ${pickedPrio ? ITEMS[pickedPrio].name : s.priority ? ITEMS[s.priority].name : '없음'} · 다음 결산일(${(s.last?.day ?? s.day) + G.SETTLE_EVERY}일 차)에 바꿀 수 있어요</span>`;
    }
    return `<div class="rw${pickedReward === k ? ' sel' : ''}" data-reward="${k}" role="button" tabindex="0">${inner}</div>`;
  }).join('');
  $('rw-note').textContent = '1 지금 전략 강화 · 2 성장 방식 · 3 운영 안정 중에서 하나를 골라요. 진열대 확장은 결산 다음 날 아침 자동이에요.';
  const btn = $('btn-reward');
  const ready = pickedReward && (pickedReward !== 'priority' || pickedPrio);
  btn.disabled = !ready;
  btn.textContent = !pickedReward ? '보상을 골라 주세요' : pickedReward === 'priority' ? (pickedPrio ? `${ITEMS[pickedPrio].name}을(를) 우선 입고로` : '상품을 골라 주세요') : `${G.REWARDS[pickedReward].name} 받기`;
  show('reward');
}

/* ---------- 21 결산 · 주력 단골 ---------- */

let pickedMainReward = null;
let pickedMain = null;

function showSettleMain() {
  $('sm-day').textContent = `${s.last?.day ?? s.day}일 차`;
  $('sm-status').innerHTML = statusHTML();
  const opts = G.mainRewardOptions(s);
  if (pickedMainReward && !opts.includes(pickedMainReward)) pickedMainReward = null;
  if (!pickedMainReward && opts.length) pickedMainReward = opts[opts.length - 1];
  if (!pickedMain || !s.regulars.includes(pickedMain)) pickedMain = s.main ?? s.regulars[0];
  if (s.main) {
    const g = s.main, cat = CATS[CUSTOMERS[g].fav].name;
    const st = G.stageOf(s.favor[g] ?? 0);
    const label = {
      ticket: [`${cat} 후보 무료 다시 뽑기 이용권 1장`, `입고 1번 자리만 · 보관 ${s.freeTickets} / ${G.MAX_TICKETS}`],
      g1: [`${cat} Ⅰ등급 상품 1개 선택`, CUSTOMERS[g].fav === 'beast' ? '마수는 성장 전 상태로, 정령 둥지는 일반 상품으로 받아요' : '내일 첫 입고에서 이 분야 후보 셋 중 하나'],
      g2: [`${cat} Ⅱ등급 상품 1개 선택`, '내일 첫 입고에서 이 분야 Ⅱ등급 후보 셋 중 하나'],
    };
    const nx = G.nextStage(s.favor[g] ?? 0);
    const locked = !opts.includes('g2') ? (opts.includes('g1') ? ['VIP 단골이 되면', `${cat} Ⅱ등급 상품 선택이 추가돼요 · 호감 ${6 - (s.favor[g] ?? 0)} 더`] : ['친한 단골이 되면', `${cat} Ⅰ등급 상품 선택이 추가돼요 · 호감 ${4 - (s.favor[g] ?? 0)} 더`]) : null;
    $('sm-reward').innerHTML = `<div class="smr"><div class="h"><img src="${guestImg(g)}" alt=""><div><b>주력 단골 보상 · ${CUSTOMERS[g].name}</b><small>${st?.name ?? ''} · 하나만 고를 수 있어요</small></div></div>
      ${opts.map((k) => `<button class="smr-opt${pickedMainReward === k ? ' sel' : ''}" data-mr="${k}"><i></i><span><b>${label[k][0]}</b><small>${label[k][1]}</small></span></button>`).join('')}
      ${locked && nx ? `<div class="smr-lock"><svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg><span><b>${locked[0]}</b><small>${locked[1]}</small></span></div>` : ''}</div>`;
    if (s.freeTickets >= G.MAX_TICKETS && pickedMainReward === 'ticket') $('sm-reward').insertAdjacentHTML('beforeend', '<p class="fine">이용권은 2장까지 보관돼요. 이미 가득해서 받아도 늘지 않아요.</p>');
  } else {
    $('sm-reward').innerHTML = '<p class="fine">주력 단골이 없어 이번 결산 보상은 없어요. 아래에서 내일부터의 주력을 고를 수 있어요.</p>';
  }
  $('sm-mains').innerHTML = s.regulars.map((g) => {
    const keep = g === s.main;
    return `<button class="sm-main${pickedMain === g ? ' sel' : ''}" data-main="${g}"><img src="${guestImg(g)}" alt=""><span><b>${CUSTOMERS[g].name}${keep ? " · 유지" : "로 변경"}</b><small>${keep ? '' : `${(s.last?.day ?? s.day) + 1}일 차부터 `}입고 1번 자리 ${CATS[CUSTOMERS[g].fav].name} 상품</small></span></button>`;
  }).join('');
  $('btn-settlemain').textContent = `보상 받고 ${(s.last?.day ?? s.day) + 1}일 차로`;
  show('settlemain');
}

/* ---------- 14 마왕의 계약 ---------- */

const TYPE_LABEL = { instant: '⇄ 즉시 거래', period: '⧗ 기간형', cond: '◎ 조건형' };

function minimap(cells) {
  const set = new Set(cells);
  const used = new Set(s.pieces.flatMap((p) => cellsOf(p).map(([x, y]) => `${x},${y}`)));
  let html = `<div class="minimap" style="grid-template-columns:repeat(${s.dim.cols},12px)">`;
  for (let y = 0; y < s.dim.rows; y++)
    for (let x = 0; x < s.dim.cols; x++) {
      const k = `${x},${y}`;
      html += `<i class="${set.has(k) ? 'seal' : used.has(k) ? 'used' : ''}"></i>`;
    }
  return `${html}</div>`;
}

function todayImpact(id) {
  const pay = G.payFor(s), sales = G.income(s).sum.total;
  const trial = JSON.parse(JSON.stringify(s));
  trial.undo = [];
  if (!G.sign(trial, id)) return '';
  const tPay = G.payFor(trial), tSales = G.income(trial).sum.total;
  const parts = [];
  if (tSales !== sales) parts.push(`하루 예상 매출 ${tSales - sales > 0 ? '+' : ''}${tSales - sales}`);
  if (tPay !== pay) parts.push(`납부액 ${fmt(pay)} → ${fmt(tPay)}`);
  if (!parts.length) parts.push('오늘 매출·납부액 변화 없음');
  return parts.join(' · ');
}

function showContract() {
  if (!s.contractOffer) return backFromContract();
  const active = G.activeContracts(s).length;
  $('c-day').textContent = `${s.day}일 차`;
  $('c-status').innerHTML = statusHTML();
  $('c-count').textContent = `기간·조건 계약 ${active} / 2`;
  $('c-list').innerHTML = s.contractOffer.ids.map((id) => {
    const t = G.CONTRACTS[id];
    const d = s.contractOffer.data[id];
    const desc = G.describeContract(s, id, d);
    const can = G.canSign(s, id);
    let dl = '', foot = '';
    if (t.type === 'instant') {
      dl = `<dt>받는 것</dt><dd>${desc.gain}</dd><dt>지불</dt><dd>${desc.cost}</dd><dt>오늘</dt><dd>${todayImpact(id)}</dd>`;
      foot = '<p class="foot">바로 처리되고 계약 자리는 차지하지 않아요</p>';
    } else if (t.type === 'period') {
      const [a, b] = t.span;
      dl = `<dt>받는 것</dt><dd>${desc.gain}</dd><dt>대가</dt><dd>${desc.cost}</dd><dt>기간</dt><dd>${a === 0 ? '오늘' : `${s.day + a}일 차`}부터 ${s.day + b}일 차까지</dd><dt>오늘</dt><dd>${todayImpact(id)}</dd>`;
      if (id === 'debt') foot = '<p class="foot red">이 계약으로 상환을 다시 미룰 수는 없어요</p>';
      if (id === 'seal') foot = `<div class="mm">${minimap(d.cells)}<span>빨간 칸 3개가 ${s.day + b + 1}일 차 아침까지 봉인돼요</span></div>`;
    } else {
      const left = t.span[1] + 1;
      dl = `<dt>계약금</dt><dd>잔금 ${t.deposit}, 지금 지불</dd><dt>조건</dt><dd>남은 ${left}번 영업 중 ${desc.cond}</dd><dt>마감</dt><dd>${s.day + t.span[1]}일 차</dd><dt>성공</dt><dd>${desc.gain}</dd>`;
      foot = '<p class="foot green">실패하면 계약금만 잃어요</p>';
    }
    return `<div class="ccard${pickedContract === id ? ' sel' : ''}${can.ok ? '' : ' no'}" data-pick="${id}" role="button" tabindex="0">
      <div class="h"><span class="ctype ${t.type}">${TYPE_LABEL[t.type]}</span><b>${t.name}</b></div><dl>${dl}</dl>${foot}${can.ok ? '' : `<p class="why">${can.why}</p>`}</div>`;
  }).join('');
  const sign = $('btn-sign');
  sign.disabled = !(pickedContract && G.canSign(s, pickedContract).ok);
  sign.textContent = pickedContract ? `${G.CONTRACTS[pickedContract].name}에 서명` : '계약을 골라 주세요';
  show('contract');
}

function openContract() {
  S.play('contract_open');
  pickedContract = null;
  showContract();
}

function backFromContract() {
  pickedContract = null;
  if (!s.briefSeen) showMorning();
  else { show('play'); render(); }
}

/* ---------- 05 납부와 판정 ---------- */

function openShop() {
  if (!G.canOpen(s)) return;
  select(null);
  const last = G.openShop(s);
  if (!last) return;
  if (!tut && !tutorialDone()) store.set(KEY_TUTORIAL, true);
  save();
  S.play('open_shop');
  showJudge();
}

function showJudge(fromSave = false) {
  const st = s.last;
  const cust = CUSTOMERS[st.customer];
  $('j-title').textContent = `${st.day}일 차 납부`;
  const short = st.pay - st.sales;
  $('receipt').innerHTML = `<h4>오늘 매출 명세</h4>
    <div class="row"><span>상품 기본 매출</span><b>${fmt(st.sum.base)}</b></div>
    <div class="row"><span>배치 조합 보너스</span><b>${st.sum.place >= 0 ? '+' : ''}${fmt(st.sum.place)}</b></div>
    <div class="row"><span>변이 효과</span><b>${st.sum.mut > 0 ? '+' : ''}${fmt(st.sum.mut)}</b></div>
    <div class="row"><span>특별 손님 · ${cust.name}</span><b>+${fmt(st.sum.customer)}</b></div>
    <div class="row"><span>계약 · 성장 효과</span><b>${st.sum.contract > 0 ? '+' : ''}${fmt(st.sum.contract)}</b></div>
    <hr><div class="row big"><span>오늘 매출</span><b data-count="${st.sales}">${fromSave ? fmt(st.sales) : 0}</b></div>
    <div class="row big"><span>납부액${st.debt ? ' (빚 상환 포함)' : ''}</span><b>${fmt(st.pay)}</b></div>
    <span class="r-stamp ${st.ok ? 'ok' : 'fail'}">${st.ok ? '완납' : `${fmt(short)} 부족 · 미납`}</span>`;
  $('j-flames').innerHTML = flamesHTML(st.lives, !st.ok);
  if (st.ok) {
    $('j-head').textContent = st.settle ? '결산일 납부 완료!' : '납부 완료!';
    $('j-sub').textContent = `남은 불꽃 ${st.lives}개 · 남은 매출 ${fmt(st.gain)}이 잔금이 돼요`;
  } else if (st.lives > 0) {
    $('j-head').textContent = '영혼의 불꽃이 하나 꺼졌어요';
    $('j-sub').textContent = `남은 불꽃 ${st.lives + 1} → ${st.lives} · 미납한 날은 잔금이 늘지 않아요`;
  } else {
    $('j-head').textContent = '마지막 불꽃이 꺼졌어요';
    $('j-sub').textContent = '상점이 마왕에게 압류됩니다';
  }
  $('j-line').textContent = st.ok
    ? (st.settle ? '결산일까지 버티다니, 제법이군. 선물을 하나 고르게.' : st.sales >= st.pay * 1.5 ? '흠, 넉넉하군. 내일은 조금 더 올려도 되겠어.' : '좋아, 받았네. 내일 또 보세.')
    : st.lives <= 0 ? '자, 열쇠를 돌려받겠네. 즐거운 거래였어.' : `겨우 ${fmt(short)} 모자라다니. 내일 갚겠다고? 좋아, 이번만 봐주지.`;

  const notes = [];
  if (st.favorGain) notes.push(`<div class="j-note good"><img src="${guestImg(st.favorGain)}" alt="">${CUSTOMERS[st.favorGain].name} 호감도 +1 <span class="hearts">${'♥'.repeat(Math.min(s.favor[st.favorGain] ?? 0, 6))}</span>${s.regularOffer === st.favorGain ? ' · 단골 제안이 왔어요' : ''}</div>`);
  for (const r of st.condResults ?? []) {
    const t = G.CONTRACTS[r.id];
    if (r.result === 'success') notes.push(`<div class="j-note good">◎ ${t.name} 달성! ${G.describeContract(s, r.id, {}).gain}</div>`);
    else if (r.result === 'fail') notes.push(`<div class="j-note bad">◎ ${t.name} 실패 · 계약금만 잃었어요</div>`);
    else notes.push(`<div class="j-note">◎ ${t.name} 진행 ${r.progress} / ${t.need}</div>`);
  }
  for (const gr of st.growth ?? []) {
    const name = ITEMS[gr.id].egg.name;
    if (gr.hatched && gr.gain) notes.push(`<div class="j-note good"><img src="${itemImg(gr.id)}" alt="">${name} → ${ITEMS[gr.id].name} 성장 완료! 새 매출은 내일부터</div>`);
    else if (gr.gain) notes.push(`<div class="j-note"><img src="${itemImg(`${gr.id}_egg`)}" alt="">${name} 성장 ${gr.from} → ${gr.to}${gr.nest ? ' (둥지 +1)' : ''}</div>`);
  }
  if (st.stageUp) notes.push(`<div class="j-note good"><img src="${guestImg(st.stageUp.guest)}" alt="">${CUSTOMERS[st.stageUp.guest].name} · ${st.stageUp.stage}가 되었어요</div>`);
  if (st.forfeited) notes.push('<div class="j-note bad">불꽃 되찾기 계약으로 이번 결산 보상을 포기했어요</div>');
  let extra = notes.length ? `<div class="j-notes">${notes.join('')}</div>` : '';
  const next = $('btn-judge-next');
  if (s.phase === 'over') next.textContent = '압류 통지서 받기';
  else {
    extra += st.ok
      ? `<div class="gain-card"><span>잔금 +${fmt(st.gain)}</span><b>${fmt(s.balance)}</b></div>`
      : `<div class="grace"><svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v5h-5"/></svg><div><b>마왕의 유예를 받았어요</b>${s.day}일 차에 상품 후보 전체를 한 번 무료로 다시 뽑을 수 있어요. 그날이 끝나면 사라져요.</div></div>`;
    next.textContent = s.phase === 'reward' ? '결산 보상 고르기' : s.phase === 'mainpick' ? '주력 단골 보상' : s.regularOffer ? '단골 제안 보기' : `${s.day}일 차 아침으로`;
  }
  $('j-extra').innerHTML = extra;
  show('judge');
  if (!fromSave) {
    const n = Math.min(Object.keys(st.perItem).length, 12);
    for (let i = 0; i < n; i++) S.play('coin_tick', { delay: 0.3 + i * 0.07, rate: 1 + Math.min(i, 10) * 0.03 });
    S.play('coin_stack', { delay: 0.35 + n * 0.07 });
    let t = 0.4 + n * 0.07;
    if (st.ok) S.play('pay_success', { delay: t });
    else { S.play('pay_fail', { delay: t }); S.play('flame_out', { delay: t + 0.6 }); }
    t += 1.2;
    for (const r of st.condResults ?? []) { S.play(r.result === 'success' ? 'condition_success' : r.result === 'fail' ? 'condition_fail' : 'condition_check', { delay: t }); t += 0.5; }
    if (st.favorGain) { S.play('favor_up', { delay: t }); t += 0.5; }
    if (st.stageUp) { S.play(st.stageUp.stage === 'VIP 단골' ? 'vip_up' : 'stage_up', { delay: t }); t += 0.6; }
    const HATCH = { slime: 'hatch_slime', wyvern: 'hatch_wyvern', snail: 'hatch_snail', mimic: 'hatch_mimic', griffin: 'hatch_griffin' };
    for (const gr of (st.growth ?? []).filter((x) => x.gain)) { S.play(gr.hatched ? HATCH[gr.id] : gr.nest ? 'nest_bonus' : 'growth_tick', { delay: t }); t += 0.4; }
    if (s.phase === 'over') S.play('seized', { delay: t + 0.4 });
    countUp($('receipt').querySelector('[data-count]'), st.sales);
  }
}

function countUp(el, to) {
  const t0 = performance.now();
  const token = {};
  judgeAnim = token;
  const step = (t) => {
    if (judgeAnim !== token) { el.textContent = fmt(to); return; }
    const k = Math.min(1, (t - t0) / 900);
    el.textContent = fmt(Math.round(to * k));
    if (k < 1) requestAnimationFrame(step); else judgeAnim = null;
  };
  requestAnimationFrame(step);
}

function finishJudge() {
  judgeAnim = null;
  if (s.phase === 'over') return showResult();
  resetSelection();
  pickedReward = null; pickedPrio = null; swapOut = null;
  if (s.phase === 'reward' || s.phase === 'mainpick') S.play('reward_pick');
  else if (s.regularOffer) S.play('regular_offer');
  route();
}

/* ---------- 06 압류 통지서 ---------- */

function showResult() {
  const sum = G.summary(s);
  const fresh = !s.final && !tut;
  if (fresh) {
    const prevBest = bestRecord();
    const isNew = G.better({ days: sum.days, total: s.total }, prevBest);
    if (isNew) store.set(KEY_BEST, { days: sum.days, total: s.total, at: Date.now() });
    s.final = { isNew, prev: prevBest ?? null };
    save();
  }
  if (!s.final) s.final = { isNew: false, prev: null }; // 튜토리얼
  const top = sum.topPiece;
  $('notice').innerHTML = `<p class="org">마계 상점가 관리국</p><h2>압류 통지서</h2>
    <p class="body">상호 <b>「${sum.nickname}」</b>는 영혼의 불꽃이 모두 꺼져 아래 기록과 함께 압류되었음을 알립니다.</p>
    <div class="days"><small>버틴 날</small><b>${sum.days}일</b></div>
    <dl><div><dt>누적 매출</dt><dd>${fmt(s.total)}</dd></div><div><dt>하루 최고 매출</dt><dd>${fmt(s.bestDay)}</dd></div>
      <div><dt>최고 등급 상품</dt><dd>${top ? `${gradeLabel(top.g)} ${ITEMS[top.id].name} ${roman(top.g)}` : '없음'}</dd></div><div><dt>체결한 계약</dt><dd>${s.signed}건</dd></div></dl>
    <div class="foot"><div class="shelf"><div class="board static" id="result-board"></div></div>
      <div class="who">최종 진열대<i>마왕 (서명)</i>마계 상점가 관리인, 마왕</div></div>
    <div class="stamp" aria-hidden="true">압류</div>`;
  staticBoard($('result-board'), s.dim, s.pieces);
  const best = bestRecord();
  $('r-best').innerHTML = s.final.isNew
    ? `개인 최고 기록 <b>${sum.days}일</b> · 이번 판이 최고예요`
    : `개인 최고 기록 <b>${best?.days ?? sum.days}일</b> · 이번엔 ${sum.days}일`;
  show('result');
  if (fresh && s.final.isNew && s.final.prev) celebrate();
}

function celebrate() {
  const colors = ['#FF8A3D', '#F2C46B', '#7448A3', '#2F7558', '#F1E4C8'];
  for (let i = 0; i < 22; i++) {
    const c = document.createElement('span');
    c.className = 'confetti';
    c.style.background = colors[i % colors.length];
    c.style.left = `${Math.random() * 100}vw`;
    c.style.animationDelay = `${Math.random() * 0.6}s`;
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 2600);
  }
}

async function saveCard() {
  const url = `${location.host}${location.pathname.replace(/index\.html$/, '')}`.replace(/\/$/, '');
  const sum = G.summary(s);
  const canvas = await drawCard({ dim: s.dim, pieces: s.pieces, mutations: s.mutations, days: sum.days, total: s.total, bestDay: s.bestDay, signed: s.signed, nickname: sum.nickname, url });
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  const href = URL.createObjectURL(blob);
  $('card-img').src = href;
  const a = $('card-download');
  a.href = href;
  a.download = `demon-shop-${sum.days}days.png`;
  $('card-dialog').showModal();
}

/* ---------- 입력 ---------- */

function cellFromPoint(ev) {
  const r = $('board').getBoundingClientRect();
  const vd = viewDim();
  const x = Math.floor(((ev.clientX - r.left) / r.width) * vd.cols);
  const y = Math.floor(((ev.clientY - r.top) / r.height) * vd.rows);
  return { x: Math.max(0, Math.min(vd.cols - 1, x)), y: Math.max(0, Math.min(vd.rows - 1, y)) };
}

const inPiece = (p, x, y) => p && cellsOf(p).some((c) => c[0] === x && c[1] === y);
const isLocked = (x, y) => x >= s.dim.cols || y >= s.dim.rows;
const clampToDim = (x, y) => ({ x: Math.min(x, s.dim.cols - 1), y: Math.min(y, s.dim.rows - 1) });

function onTap(x, y) {
  if (merging) return;
  if (isLocked(x, y)) {
    const n = G.nextExpansion(s);
    toast(n ? `${n.day}일 차 아침에 진열대가 ${n.cols}×${n.rows}로 넓어지며 열려요` : '더 넓힐 수 없어요');
    return;
  }
  const occ = occupancy(s.dim, s.pieces)[y][x];
  if (!sel) {
    if (occ !== null) select({ kind: 'piece', uid: occ });
    else if (s.phase === 'place') { select({ kind: 'hand' }); setGhostAt(x, y, handRot); }
    return render();
  }
  if (ghost && inPiece(ghostPiece(), x, y)) {
    if (ghostValid()) commit();
    else { S.play('place_invalid'); toast('다른 상품이나 봉인된 칸과 겹쳐서 놓을 수 없어요'); }
    return;
  }
  if (sel.kind === 'piece' && !ghost) {
    if (occ === sel.uid) { select(null); return render(); }
    if (occ !== null) { select({ kind: 'piece', uid: occ }); return render(); }
  }
  const c = clampToDim(x, y);
  setGhostAt(c.x, c.y, currentRot());
  render();
}

// 확대 보기에서는 손가락으로 밀면 진열대가 움직이고, 끌어서 놓기는 꺼진다(밀다가 상품이 놓이지 않게)
let zoom = false;
let zoomFocus = '';
function focusZoom() {
  const key = sel ? `${sel.kind}:${sel.uid ?? ''}:${ghost ? `${ghost.x},${ghost.y}` : ''}` : '';
  if (!key || key === zoomFocus) { zoomFocus = key; return; }
  zoomFocus = key;
  requestAnimationFrame(() => document.querySelector('#board .piece.ghost, #board .piece.selected')?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' }));
}

let drag = null;
function onPointerDown(ev) {
  if (ev.button > 0 || merging) return;
  const { x, y } = cellFromPoint(ev);
  drag = { x0: ev.clientX, y0: ev.clientY, cell: { x, y }, moved: false, pan: zoom };
  if (!zoom) $('board').setPointerCapture(ev.pointerId);
}
function onPointerMove(ev) {
  if (!drag) return;
  if (drag.pan) { if (Math.hypot(ev.clientX - drag.x0, ev.clientY - drag.y0) >= 10) drag.moved = drag.dead = true; return; }
  if (!drag.moved) {
    if (Math.hypot(ev.clientX - drag.x0, ev.clientY - drag.y0) < 10) return;
    const { x, y } = drag.cell;
    drag.moved = true;
    if (isLocked(x, y)) { drag.dead = true; return; }
    const g = ghostPiece();
    const occ = occupancy(s.dim, s.pieces)[y][x];
    if (g && inPiece(g, x, y)) { drag.grab = [x - g.x, y - g.y]; drag.rot = g.rot; }
    else if (sel?.kind === 'hand') { drag.rot = currentRot(); drag.grab = shapeOf(s.hand.id, drag.rot)[0]; }
    else if (occ !== null) {
      if (sel?.uid !== occ) select({ kind: 'piece', uid: occ });
      const p = selectedPiece();
      drag.grab = [x - p.x, y - p.y];
      drag.rot = p.rot;
    } else { drag.dead = true; }
  }
  if (drag.dead) return;
  const pt = cellFromPoint(ev);
  const c = clampToDim(pt.x, pt.y);
  const before = ghost && `${ghost.x},${ghost.y},${ghost.rot}`;
  ghost = { ...clampAnchor(s.dim, selectedId(), drag.rot, c.x - drag.grab[0], c.y - drag.grab[1]), rot: drag.rot };
  if (`${ghost.x},${ghost.y},${ghost.rot}` !== before) render();
}
function onPointerUp() {
  if (!drag) return;
  const d = drag;
  drag = null;
  if (!d.moved) return onTap(d.cell.x, d.cell.y);
  if (d.dead) return;
  if (ghostValid()) commit();
  else { S.play('place_invalid'); render(); }
}

function rotate() {
  if (!sel || merging) return;
  S.play('item_rotate');
  if (sel.kind === 'hand' && !ghost) {
    handRot = (handRot + 1) % 4;
    s.hand.rot = handRot;
    save();
    return render();
  }
  const base = ghost ?? selectedPiece();
  const rot = (base.rot + 1) % 4;
  ghost = { ...clampAnchor(s.dim, selectedId(), rot, base.x, base.y), rot };
  render();
}

function discardSelected() {
  if (sel?.kind !== 'piece' || merging) return;
  const p = selectedPiece();
  const v = G.sellValue(p);
  G.discard(s, p.uid);
  S.play('discard');
  S.play('coin_tick', { delay: 0.15 });
  select(null);
  save();
  render();
  toast(`${displayName(p)}을(를) 팔아 잔금 +${v}. 되돌리기로 살릴 수 있어요.`);
}

function act(fn, sound) {
  if (fn(s)) { if (sound) S.play(sound); resetSelection(); afterAction(); return true; }
  return false;
}

function undo() {
  if (merging) { merging = null; render(); return; }
  if (G.undo(s)) { S.play('undo'); resetSelection(); save(); route(); }
}

let toastTimer = 0;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

function bind() {
  const board = $('board');
  board.addEventListener('pointerdown', onPointerDown);
  board.addEventListener('pointermove', onPointerMove);
  board.addEventListener('pointerup', onPointerUp);
  board.addEventListener('pointercancel', () => { drag = null; });
  board.addEventListener('click', (e) => {
    if (e.detail !== 0) return;
    const c = e.target.closest('.cell');
    if (c) onTap(+c.dataset.x, +c.dataset.y);
  });

  const onAct = (e) => {
    const ord = e.target.closest('[data-order]');
    if (ord) {
      const id = ord.dataset.order;
      const why = G.orderBlocked(s, id);
      if (why) { toast(why); return; }
      const free = G.orderCost(s) === 0;
      orderOpen = false;
      if (act((x) => G.order(x, id), 'restock_new')) {
        select({ kind: 'hand' });
        toast(`${ITEMS[id].egg ? ITEMS[id].egg.name : ITEMS[id].name} 발주 완료${free ? ' · 발주권 사용' : ''} · 놓거나 합성하세요`);
        render();
      }
      return;
    }
    const offer = e.target.closest('[data-offer]');
    if (offer) { pickedOffer = +offer.dataset.offer; S.play('ui_tap'); return render(); }
    const go = e.target.closest('[data-go]');
    if (go) {
      if (go.dataset.go === 'contract') openContract();
      if (go.dataset.go === 'contract-info') {
        const c = s.contracts.find((x) => x.id === go.dataset.c);
        const d = G.describeContract(s, go.dataset.c, c?.data);
        toast(`${G.CONTRACTS[go.dataset.c].name} · ${d.cond ? `조건: ${d.cond} · ` : ''}받는 것: ${d.gain} · 대가: ${d.cost}`);
      }
      return;
    }
    const btn = e.target.closest('[data-act]');
    if (!btn || btn.disabled) return;
    const a = btn.dataset.act;
    if (a === 'deselect' || a === 'tidy') { select(null); render(); }
    if (a === 'order-open') {
      const why = G.orderBlocked(s, null);
      if (why && !/잔금/.test(why)) { toast(why); return; }
      orderOpen = true; S.play('ui_tap'); render();
    }
    if (a === 'order-close') { orderOpen = false; render(); }
    if (a === 'hold') { select({ kind: 'hand' }); render(); }
    if (a === 'discard') discardSelected();
    if (a === 'upgrade' && sel?.kind === 'piece') {
      const p = selectedPiece();
      const free = G.upgradeCost(s, p) === 0;
      if (act((x) => G.upgrade(x, p.uid), 'merge_complete')) {
        spark = new Set([p.uid]);
        toast(`${displayName(p)} ${roman(p.g)}등급으로 올렸어요${free ? ' · 이용권 사용' : ''}`);
      }
    }
    if (a === 'merge-preview') startMerge();
    if (a === 'extra') act(G.buyExtra, 'restock_new');
    if (a === 'reroll-all') { pickedOffer = null; act(G.reroll, 'reroll'); }
    if (a === 'reroll-one') { pickedOffer = null; act(G.rerollSlot1, 'free_ticket'); }
  };
  $('panel').addEventListener('click', onAct);
  $('p-chips').addEventListener('click', onAct);
  $('m-contracts').addEventListener('click', onAct);
  $('strip-head').onclick = () => { stripOpen = !stripOpen; renderStrip(); };

  $('c-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pick]');
    if (!b) return;
    pickedContract = pickedContract === b.dataset.pick ? null : b.dataset.pick;
    showContract();
  });
  $('btn-sign').onclick = () => {
    const id = pickedContract;
    if (!id || !G.sign(s, id)) return;
    const type = G.CONTRACTS[id].type;
    S.play(type === 'instant' ? 'sign_instant' : type === 'period' ? 'sign_period' : 'sign_condition');
    toast(`계약 체결: ${G.CONTRACTS[id].name}`);
    resetSelection();
    save();
    if (s.pendingMutation) return route();
    backFromContract();
  };
  $('btn-refuse').onclick = () => { G.refuseContracts(s); S.play('contract_reject'); save(); backFromContract(); };
  $('btn-contract-close').onclick = () => {
    if (G.contractPending(s)) toast('오늘 영업 전에 서명하거나 모두 거절해야 해요');
    backFromContract();
  };

  $('mu-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mut]');
    if (!b) return;
    pickedMut = b.dataset.mut;
    S.play(pickedMut === 'A' ? 'mutation_choose_a' : 'mutation_choose_b');
    showMutation();
  });
  $('btn-mutation').onclick = () => {
    const id = s.pendingMutation;
    if (!pickedMut || !G.chooseMutation(s, pickedMut)) return;
    toast(`변이 확정: ${ITEMS[id].name} · ${mutName(id, pickedMut)}`);
    pickedMut = null;
    save();
    resetSelection();
    route();
  };

  $('rg-slots').addEventListener('click', (e) => {
    const b = e.target.closest('[data-swap]');
    if (!b) return;
    swapOut = swapOut === b.dataset.swap ? null : b.dataset.swap;
    showRegular();
  });
  $('btn-rg-accept').onclick = () => {
    const swapped = s.regulars.length >= 2;
    const hadMain = !!s.main;
    if (!G.acceptRegular(s, swapOut)) return;
    S.play(swapped ? 'regular_swap' : 'regular_join');
    if (!hadMain && s.main) { S.play('main_regular_set', { delay: 0.6 }); toast(`${CUSTOMERS[s.main].name}이(가) 주력 단골이 되었어요 · 입고 1번 자리 ${CATS[CUSTOMERS[s.main].fav].name}`); }
    swapOut = null;
    save();
    route();
  };
  $('btn-rg-refuse').onclick = () => { G.refuseRegular(s); S.play('contract_reject'); swapOut = null; save(); route(); };

  $('rw-list').addEventListener('click', (e) => {
    const pr = e.target.closest('[data-prio]');
    if (pr) { pickedPrio = pr.dataset.prio; S.play('priority_set'); return showReward(); }
    const b = e.target.closest('[data-reward]');
    if (!b) return;
    pickedReward = b.dataset.reward;
    if (pickedReward !== 'priority') pickedPrio = null;
    showReward();
  });
  $('btn-reward').onclick = () => {
    if (!G.takeReward(s, pickedReward, pickedPrio)) return;
    S.play(pickedReward === 'priority' ? 'priority_set' : 'reward_pick');
    pickedReward = null; pickedPrio = null;
    resetSelection();
    save();
    route();
  };

  $('btn-go-shelf').onclick = leaveMorning;
  $('sp-grid').addEventListener('click', (e) => {
    const b = e.target.closest('[data-start]');
    if (!b) return;
    pickedStart = b.dataset.start;
    S.play('ui_tap');
    renderStartPick();
  });
  $('btn-startpick').onclick = () => { if (!pickedStart) return; S.play('start_category'); startNew(pickedStart); };
  $('sm-reward').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mr]');
    if (b) { pickedMainReward = b.dataset.mr; S.play('ui_tap'); showSettleMain(); }
  });
  $('sm-mains').addEventListener('click', (e) => {
    const b = e.target.closest('[data-main]');
    if (b) { pickedMain = b.dataset.main; S.play('ui_tap'); showSettleMain(); }
  });
  $('btn-settlemain').onclick = () => {
    const change = pickedMain && pickedMain !== s.main;
    const reward = s.main ? pickedMainReward : null;
    if (!G.settleMain(s, reward, pickedMain)) return;
    S.play(change ? 'main_regular_set' : reward === 'ticket' ? 'free_ticket' : 'reward_pick');
    pickedMainReward = null; pickedMain = null;
    resetSelection();
    save();
    route();
  };
  $('btn-judge-skip').onclick = () => { if (judgeAnim) { judgeAnim = null; } else finishJudge(); };
  $('btn-judge-next').onclick = finishJudge;

  $('btn-rotate').onclick = rotate;
  $('btn-undo').onclick = undo;
  $('btn-zoom').onclick = () => { zoom = !zoom; zoomFocus = ''; S.play('ui_tap'); render(); };
  $('btn-skip').onclick = () => {
    const b = G.skipBonus(s), ord = s.ordering;
    pickedOffer = null;
    if (act(G.skip, ord ? 'discard' : 'coin_tick')) toast(ord ? '발주 상품을 버렸어요. 되돌리기로 살릴 수 있어요.' : `이번 입고를 넘기고 잔금 +${b}`);
  };
  $('btn-reroll').onclick = () => { pickedOffer = null; act(G.reroll, 'reroll'); };
  $('btn-merge-cancel').onclick = () => { merging = null; render(); };
  $('btn-main').onclick = () => {
    if (s.phase === 'pick' && pickedOffer !== null) {
      G.choose(s, pickedOffer);
      pickedOffer = null;
      S.play('item_pick');
      select({ kind: 'hand' });
      save();
      return render();
    }
    if (merging) confirmMerge();
    else if (ghost) commit();
    else if (s.phase === 'arrange' && G.contractPending(s)) openContract();
    else openShop();
  };
  $('btn-coach-skip').onclick = () => { store.set(KEY_TUTORIAL, true); render(); };
  $('btn-menu').onclick = () => openSheet('menu');
  $('btn-new').onclick = () => {
    const run = loadRun();
    if (run && run.phase !== 'over' && !confirm('진행 중인 상점이 있어요. 새 계약서에 서명할까요?')) return;
    S.play('contract_sign');
    showStartPick();
  };
  $('btn-continue').onclick = resume;
  $('btn-home').onclick = () => { $('menu').close(); if (tut) quitTutorial(); else goStart(); };
  $('btn-again').onclick = () => { S.play('contract_sign'); showStartPick(); };
  $('btn-result-home').onclick = goStart;
  $('btn-card').onclick = saveCard;

  const syncSound = () => {
    const any = S.isOn('sfx') || S.isOn('bgm');
    $('btn-sound').setAttribute('aria-pressed', String(any));
    $('btn-sound').setAttribute('aria-label', any ? '소리 끄기' : '소리 켜기');
    $('opt-sfx').checked = S.isOn('sfx');
    $('opt-bgm').checked = S.isOn('bgm');
  };
  $('btn-sound').onclick = () => {
    const on = !(S.isOn('sfx') || S.isOn('bgm'));
    S.setOn('sfx', on);
    S.setOn('bgm', on);
    if (on) S.play('demon_voice');
    syncSound();
  };
  $('opt-sfx').onchange = (e) => { S.setOn('sfx', e.target.checked); if (e.target.checked) S.play('ui_tap'); syncSound(); };
  $('opt-bgm').onchange = (e) => { S.setOn('bgm', e.target.checked); syncSound(); };
  syncSound();
  document.addEventListener('click', (e) => {
    const b = e.target.closest('button, a.btn');
    if (!b || b.disabled) return;
    if (b.matches('.cell, .orow, #btn-rotate, #btn-undo, #btn-main, #btn-sound, #btn-sign, #btn-refuse, #btn-new, #btn-again, #btn-reroll, #btn-mutation, #btn-reward, #btn-rg-accept, #btn-rg-refuse, #btn-startpick, #btn-settlemain, [data-act], [data-go], [data-mut], [data-prio], [data-start], [data-mr], [data-main]')) return;
    S.play('ui_tap');
  }, true);

  document.addEventListener('keydown', (e) => {
    if (document.querySelector('dialog[open]')) return;
    if (!$('screen-judge').hidden) { if (e.key === 'Enter' || e.key === ' ') finishJudge(); return; }
    if (!$('screen-morning').hidden) { if (e.key === 'Enter') leaveMorning(); return; }
    if ($('screen-play').hidden) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
    else if (e.key === 'r' || e.key === 'R') rotate();
    else if (e.key === 'Enter' && (ghost || merging)) { e.preventDefault(); if (merging) confirmMerge(); else commit(); }
    else if (e.key === 'Escape') { select(null); render(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') discardSelected();
  });
}


/* ---------- 도감 · 운영 안내서 · 메뉴 ---------- */

let codexTab = 'items';
let codexFilter = 'all';

function openCodex() {
  renderCodex($('codex-body'), $('codex-filters'), codexTab, codexFilter, s);
  document.querySelectorAll('#codex .tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === codexTab)));
  openSheet('codex');
}

function openSheet(id) {
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
  $(id).showModal();
  $(id).scrollTop = 0;
}

function openNamed(name) {
  if (name === 'guide') { renderGuide($('guide-body'), $('guide-toc')); openSheet('guide'); }
  if (name === 'codex') openCodex();
  if (name === 'tutorial') {
    document.querySelectorAll('dialog[open]').forEach((d) => d.close());
    startTutorial(0);
  }
}

/* ---------- 튜토리얼 모드 ----------
   연습 상점: 레슨마다 준비된 상태로 시작해 실제 화면에서 한 가지 시스템을 해 본다.
   본 게임의 진행·최고 기록·첫 플레이 안내에는 아무것도 저장하지 않는다. */

let tut = null; // { i, done }

const tp = (s, list) => {
  s.pieces = list.map(([id, x, y, g = 1, rot = 0], i) => ({ uid: i + 1, id, x, y, rot, g }));
  s.nextUid = list.length + 1;
};
const lessonState = (seed, day, fn) => {
  const s = G.newGame(seed);
  s.day = day;
  s.briefSeen = true;
  s.contractOffer = null;
  s.customers = [];
  fn(s);
  return s;
};
const arrangeIt = (s) => { s.phase = 'arrange'; s.offers = null; s.picksLeft = 0; s.picksDone = 2; };
const guestsFor = (s, list) => { s.customers = list; };
const hasBonus = (s, id, label) => {
  const ev = G.income(s);
  return s.pieces.some((p) => p.id === id && ev.items.get(p.uid).bonuses.some((b) => b.label === label));
};

const LESSONS = [
  {
    title: '입고와 배치',
    body: '아침 화면에서 <b>오늘 납부액</b>을 확인하고 [상품 입고하러 가기]. 후보 하나를 누르고 [고르기] → 진열대 칸을 누르면 미리보기가 떠요 → [여기에 놓기].',
    goal: '상품 1개를 진열하기',
    setup: () => {
      const s = lessonState(101, 1, (x) => { guestsFor(x, ['witches', 'school']); x.briefSeen = false; });
      s.offers = [{ id: 'potion', why: 'new' }, { id: 'herb', why: 'new' }, { id: 'sword', why: 'new' }];
      return s;
    },
    done: (s) => s.pieces.length >= 1,
  },
  {
    title: '붙여 놓으면 보너스',
    body: '<b>약초</b>는 상하좌우로 붙은 회복 물약의 매출을 올려 줘요. 약초를 골라 회복 물약 옆에 놓아 보세요. 놓기 전 미리보기에 바뀌는 매출이 떠요.',
    goal: '약초를 회복 물약 옆에 놓기',
    setup: () => {
      const s = lessonState(102, 1, (x) => guestsFor(x, ['witches', 'school']));
      tp(s, [['potion', 1, 1]]);
      s.picksDone = 1; s.picksLeft = 1; s.phase = 'pick';
      s.offers = [{ id: 'herb', why: 'guest' }, { id: 'sword', why: 'new' }, { id: 'orb', why: 'new' }];
      return s;
    },
    done: (s) => hasBonus(s, 'potion', '약초'),
  },
  {
    title: '영업과 납부',
    body: '위쪽 막대에서 <b>목표(납부액)</b>와 예상 매출을 비교하고 [영업 시작]. 영수증에서 매출이 기본·배치·변이·손님·계약으로 나뉘어요. 남는 돈은 <b>잔금</b>이 되고, 모자라면 불꽃이 하나 꺼져요.',
    goal: '영업을 시작해 납부 결과 보기',
    setup: () => {
      const s = lessonState(103, 2, (x) => guestsFor(x, ['witches', 'adventurers', 'school']));
      tp(s, [['potion', 1, 1], ['herb', 0, 1], ['sword', 3, 0], ['whetstone', 4, 0]]);
      arrangeIt(s);
      return s;
    },
    done: (s) => s.history.length >= 1,
  },
  {
    title: '합성과 변이',
    body: '같은 상품·같은 등급 <b>3개</b>를 합치면 한 등급 위 1개가 돼요. 회복 물약을 눌러 [미리보기] → [합성하기]. 처음 Ⅱ등급이 되면 <b>변이</b> 둘 중 하나를 골라요(그 판 동안 종류 전체에 적용).',
    goal: '회복 물약을 합성하고 변이 고르기',
    setup: () => {
      const s = lessonState(104, 3, (x) => guestsFor(x, ['witches', 'school', 'noble', 'goblins']));
      tp(s, [['potion', 0, 0], ['herb', 1, 0], ['potion', 2, 0], ['potion', 4, 0], ['sword', 4, 1]]);
      arrangeIt(s);
      return s;
    },
    done: (s) => !!s.mutations.potion,
  },
  {
    title: '손님과 단골',
    body: '오늘 손님은 <b>마녀 모임</b>. 손님이 온 날 그 손님의 <b>호감 조건</b>(연금술 조합 활성화)을 채운 채 영업하면 호감도가 올라요. ♥♥가 되면 단골 제안이 와요 → [단골로 맞이하기]. 첫 단골은 <b>주력 단골</b>이 되어 입고 1번 자리를 자기 분야 상품으로 채워 줘요.',
    goal: '마녀 모임을 단골로 맞이하기',
    setup: () => {
      const s = lessonState(105, 4, (x) => guestsFor(x, ['school', 'noble', 'goblins', 'witches', 'adventurers']));
      tp(s, [['potion', 0, 0], ['herb', 1, 0], ['potion', 2, 0], ['cauldron', 0, 1], ['ruby', 3, 0], ['sword', 4, 0]]);
      s.favor = { witches: 1 };
      arrangeIt(s);
      return s;
    },
    done: (s) => s.regulars.includes('witches'),
  },
  {
    title: '마왕의 계약',
    body: '계약은 <b>즉시 거래·기간형·조건형</b>에서 하나씩 와요. 서명하거나 모두 거절해야 영업할 수 있어요. 아래 버튼으로 계약 화면을 열어 받는 것·대가·기간·오늘 영향을 읽어 보세요.',
    goal: '계약에 서명하거나 모두 거절하기',
    setup: () => {
      const s = lessonState(106, 6, (x) => guestsFor(x, ['school', 'noble', 'goblins', 'witches', 'adventurers', 'witches', 'noble']));
      tp(s, [['potion', 0, 0], ['herb', 1, 0], ['potion', 2, 0], ['cauldron', 0, 1], ['sword', 4, 0], ['whetstone', 3, 0]]);
      s.balance = 30;
      arrangeIt(s);
      s.contractOffer = { ids: ['rush', 'smoke', 'dept'], data: { rush: { cost: 16 }, smoke: {}, dept: {} } };
      return s;
    },
    done: (s) => !s.contractOffer,
  },
  {
    title: '결산일과 성장',
    body: '5일마다 <b>결산일</b>. 납부액이 높지만 성공하면 성장 보상 셋 중 하나를 골라요. <b>우선 입고</b>를 고르면 그 상품이 후보에 더 자주 나와요(보장은 아님).',
    goal: '결산일 납부에 성공하고 보상 고르기',
    setup: () => {
      const s = lessonState(107, 5, (x) => guestsFor(x, ['school', 'noble', 'goblins', 'witches', 'adventurers', 'witches']));
      tp(s, [['armor', 0, 0], ['shield', 2, 0], ['bow', 4, 0], ['sword', 2, 2], ['whetstone', 3, 2], ['potion', 0, 2], ['herb', 1, 2], ['ruby', 0, 3]]);
      arrangeIt(s);
      return s;
    },
    done: (s) => s.day >= 6 && s.phase !== 'reward',
  },
  {
    title: '마수 성장',
    body: '마수는 <b>알</b>로 들어와 매출이 낮아요. 영업이 끝날 때 성장 조건을 채우면 성장도 +1, <b>2</b>가 되면 성장 완료(새 매출은 다음 날부터). <b>정령 둥지</b>와 붙어 있으면 +1 더. 와이번 알을 눌러 조건을 확인하고 영업해 보세요.',
    goal: '마수 하나를 성장 완료시키기',
    setup: () => {
      const s = lessonState(109, 4, (x) => guestsFor(x, ['school', 'keeper', 'goblins', 'keeper', 'noble']));
      tp(s, [['wyvern', 0, 0], ['lavabread', 2, 0], ['nest', 0, 1], ['slime', 4, 2], ['ghostcheese', 4, 0], ['ruby', 2, 1], ['sword', 3, 1]]);
      s.pieces[0].grow = 0; s.pieces[3].grow = 0;
      arrangeIt(s);
      return s;
    },
    done: (s) => s.pieces.some((p) => ITEMS[p.id].egg && !isEgg(p)),
  },
  {
    title: '잔금 쓰기',
    body: '정상 납부하고 남은 돈이 <b>잔금</b>이에요. 정리 화면에서 [추가 입고](후보 셋 중 하나)나 [지정 발주](진열 중인 상품을 확정 입고, 하루 두 번)를 써 보세요. 회복 물약을 발주하면 손에 든 채로 진열된 둘과 합성할 수 있어요. 진열대는 결산일 다음 날 아침에 저절로 넓어져요.',
    goal: '잔금으로 추가 입고 또는 지정 발주',
    setup: () => {
      const s = lessonState(108, 7, (x) => guestsFor(x, ['school', 'noble', 'goblins', 'witches', 'adventurers', 'witches', 'school', 'noble']));
      tp(s, [['potion', 0, 0], ['herb', 1, 0], ['potion', 2, 0], ['tome', 4, 0], ['candle', 3, 0]]);
      s.balance = 90;
      arrangeIt(s);
      return s;
    },
    done: (s) => (s.ordersToday ?? 0) >= 1 || s.extras >= 1,
  },
];

function startTutorial(i) {
  tut = { i, done: false };
  s = LESSONS[i].setup();
  resetSelection();
  stripOpen = false;
  document.body.classList.add('tut');
  $('tut-bar').hidden = false;
  $('tut-bar').classList.remove('folded');
  document.body.classList.remove('tut-folded');
  renderTut();
  route();
}

function quitTutorial() {
  tut = null;
  s = null;
  document.body.classList.remove('tut', 'tut-folded');
  $('tut-bar').hidden = true;
  padForTut();
  goStart();
}

function checkTut() {
  if (!tut || tut.done || !s) return;
  if (LESSONS[tut.i].done(s)) {
    tut.done = true;
    S.play('condition_success');
    $('tut-bar').classList.remove('folded');
    document.body.classList.remove('tut-folded');
  }
  renderTut();
}

function renderTut() {
  if (!tut) return;
  const L = LESSONS[tut.i];
  const last = tut.i === LESSONS.length - 1;
  $('tut-step').textContent = `튜토리얼 ${tut.i + 1} / ${LESSONS.length}`;
  $('tut-title').textContent = L.title;
  $('tut-body').innerHTML = L.body;
  $('tut-goal').textContent = `${tut.done ? '✓ 완료' : '목표'} · ${L.goal}`;
  $('tut-goal').classList.toggle('done', tut.done);
  const next = $('tut-next');
  next.disabled = !tut.done;
  next.textContent = last ? '튜토리얼 마치기' : '다음 단계 →';
  padForTut();
}

// 안내 띠가 화면 머리를 가리지 않도록 띠 높이만큼 내린다
function padForTut() {
  $('app').style.paddingTop = tut ? `${$('tut-bar').offsetHeight + 16}px` : '';
}

function bindTutorial() {
  document.addEventListener('click', (e) => {
    const o = e.target.closest('[data-open]');
    if (o) openNamed(o.dataset.open);
  });
  $('codex').addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) { codexTab = t.dataset.tab; return openCodex(); }
    const f = e.target.closest('[data-filter]');
    if (f) { codexFilter = f.dataset.filter; openCodex(); }
  });
  $('tut-next').onclick = () => {
    if (!tut?.done) return;
    if (tut.i + 1 < LESSONS.length) startTutorial(tut.i + 1);
    else { quitTutorial(); toast('튜토리얼을 마쳤어요. 이제 진짜 계약서에 서명해 볼까요?'); }
  };
  $('tut-quit').onclick = quitTutorial;
  $('tut-fold').onclick = () => {
    const f = $('tut-bar').classList.toggle('folded');
    document.body.classList.toggle('tut-folded', f);
    padForTut();
  };
  window.addEventListener('resize', padForTut);
}

S.init();
bind();
bindTutorial();
goStart();
