// 화면 흐름(디자인 시안): 시작 → 영업 예고(아침) → 입고·상점 정리(합성) → 계약 → 납부와 판정 → 압류 통지서.
// 선택 후 위치 누르기가 기본이고 끌기는 보조. 모든 주요 선택 뒤 자동 저장.
import {
  ITEMS, ITEM_IDS, CATS, CUSTOMERS, MAX_LIVES, EXPAND_STEPS,
  shapeOf, sizeOf, cellsOf, clampAnchor, canPlace, occupancy, gradeBase, gradeLabel, roman, effectText, anyFit,
} from './rules.js';
import * as G from './game.js';
import { drawCard } from './card.js';
import * as S from './sound.js';

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
const FAV = { adventurers: 'gear', witches: 'alch', school: 'magic' };
const GUEST_LIKE = {
  adventurers: '모험 장비 상품에 보너스 매출', witches: '연금술 상품에 보너스 매출', school: '마법 잡화에 보너스 매출',
  goblins: '같은 상품이 여러 개면 보너스', noble: '높은 등급 상품을 좋아해요', wanderers: '서로 다른 상품 종류에 보너스',
};

let s = null;          // 게임 상태 (저장 대상)
let sel = null;        // { kind: 'hand' } | { kind: 'piece', uid }
let ghost = null;      // { x, y, rot } 미리보기
let handRot = 0;
let merging = null;    // 합성 미리보기: G.mergePlan 결과
let spark = new Set();
let press = null;
let pickedContract = null;
let judgeAnim = null;

/* ---------- 저장 ---------- */

function save() { if (s) store.set(KEY_RUN, s); }
function loadRun() {
  const r = store.get(KEY_RUN);
  return r && r.v === 2 && Array.isArray(r.pieces) ? r : null;
}
const bestRecord = () => store.get(KEY_BEST);
const tutorialDone = () => store.get(KEY_TUTORIAL) === true;

/* ---------- 화면 전환 ---------- */

const SCREENS = ['start', 'morning', 'play', 'contract', 'judge', 'result'];
function show(name) {
  for (const id of SCREENS) $(`screen-${id}`).hidden = id !== name;
  window.scrollTo(0, 0);
}

function route() {
  if (s.phase === 'over') return showResult();
  if (s.phase === 'reward') return showJudge(true);
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

function startNew() {
  s = G.newGame();
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

/* ---------- 02 영업 예고 ---------- */

function demonLine() {
  const pay = G.payFor(s);
  const today = G.customerOn(s, s.day);
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
  return `<span class="k">${label}</span><img src="${guestImg(id)}" alt=""><b>${c.name}</b><p>${off ? '계약 때문에 오늘은 효과가 없어요' : GUEST_LIKE[id]}</p>`;
}

function conflictText() {
  const today = G.customerOn(s, s.day);
  const { mods } = G.modsFor(s);
  if (mods.noCustomer) return '계약 때문에 오늘 손님의 보너스가 없어요.';
  const cat = FAV[today];
  if (cat && mods.catFlat[cat] < 0) return `오늘 손님은 ${CATS[cat].name}을 좋아하지만, 계약 때문에 ${CATS[cat].name} 보너스가 줄어요.`;
  return '';
}

function contractRowsHTML() {
  const active = G.activeContracts(s);
  if (!active.length) return '';
  return `<div class="sect"><h3>진행 중인 계약</h3><span>${active.length} / 2</span></div>` +
    active.map((c) => `<div class="c-row"><div><b>${G.CONTRACTS[c.id].name}</b><small>${G.CONTRACTS[c.id].gain} · ${G.CONTRACTS[c.id].cost}</small></div>` +
      `<span class="left-tag">${G.contractDaysLeft(s, c)}일 남음</span></div>`).join('');
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
  $('m-paysub').textContent = `${prev ? `어제 ${fmt(prev.pay)} · ` : ''}${settleText}`;
  $('m-pay').parentElement.classList.toggle('settle-day', G.isSettleDay(s.day));
  $('m-line').textContent = demonLine();
  $('m-today').innerHTML = guestCard(today, '오늘의 손님', mods.noCustomer);
  $('m-today').classList.toggle('off', mods.noCustomer);
  $('m-tomorrow').innerHTML = guestCard(tomorrow, '내일의 손님');
  const warn = conflictText();
  let html = contractRowsHTML() + (warn ? `<p class="warn">${warn}</p>` : '');
  if (s.grace) html += `<div class="grace"><svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v5h-5"/></svg><div><b>마왕의 유예</b>오늘 상품 후보 전체를 한 번 무료로 다시 뽑을 수 있어요. 오늘이 끝나면 사라져요.</div></div>`;
  if (s.contractOffer) html += `<button class="offer-callout" data-go="contract"><span>📜</span><span><b>마왕의 계약 제안 ${s.contractOffer.ids.length}건</b><small>입고 전에 읽어 볼 수 있어요. 거절해도 돼요.</small></span><span>›</span></button>`;
  $('m-contracts').innerHTML = html;
  show('morning');
  S.play(G.isSettleDay(s.day) ? 'settlement_toll' : 'demon_voice', { delay: 0.2 });
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

// 다음 확장 칸까지 보여 주고 자물쇠를 건다
function viewDim() {
  return s.expand < EXPAND_STEPS.length ? EXPAND_STEPS[s.expand] : s.dim;
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

// 일러스트: 길쭉한 상품을 옆으로 돌리면 그림도 90도
function picHTML(dim, p, b, textRows) {
  const cell = 100 / dim.cols;
  const w = b.w * cell - 2.2;
  const h = Math.max(b.h * cell - 2.2 - textRows * 3.2, cell * 0.45);
  const base = sizeOf(p.id, 0);
  const turned = base.w !== base.h && p.rot % 2 === 1;
  const [mw, mh] = turned ? [h, w] : [w, h];
  return `<span class="pic" style="width:${w}cqw;height:${h}cqw">` +
    `<img src="${itemImg(p.id)}" alt="" style="max-width:${mw}cqw;max-height:${mh}cqw;transform:translate(-50%,-50%)${turned ? ' rotate(90deg)' : ''}"></span>`;
}

function pieceHTML(dim, p, { cls = '', sub = '', tag = '', rows = sub ? 1 : 0 } = {}) {
  const cells = cellsOf(p);
  const has = (x, y) => cells.some((c) => c[0] === x && c[1] === y);
  const it = ITEMS[p.id];
  const g = p.g ?? 1;
  let html = `<div class="piece g${Math.min(g, 6)} ${cls}" style="--cat:${CATS[it.cat].color}" data-uid="${p.uid ?? ''}" aria-label="${gradeLabel(g)} ${it.name}">`;
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
    `<span class="gtag">${roman(g)}</span>${g >= 4 ? `<span class="gnum">${g}</span>` : ''}` +
    `${picHTML(dim, p, b, rows)}${sub}${tag}</div></div>`;
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

function staticBoard(el, dim, pieces, subOf = null) {
  sizeBoard(el, dim);
  el.innerHTML = cellsHTML(dim, false) + pieces.map((p) => pieceHTML(dim, p, { sub: subOf ? subOf(p) : '' })).join('');
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
  return { uid: sel.kind === 'piece' ? sel.uid : -1, id: it.id, g: it.g, bless: it.bless, ...ghost };
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
  if (spark.size) S.play('coin_tick', { delay: 0.15 });
  press = uid;
  select(null);
  save();
  render();
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

function formula(r) {
  const parts = r.bonuses.map((b) => `${b.amount < 0 ? '-' : '+'} ${b.label} ${Math.abs(b.amount)}`);
  return `기본 ${r.base} ${parts.join(' ')} = 하루 ${r.total}`.replace(/ {2,}/g, ' ');
}

function render() {
  if (!s) return;
  if (s.phase === 'over' || s.phase === 'reward') return route();

  const ev = G.income(s);
  const prev = previewPieces();
  let prevEv = prev ? G.income(s, prev) : null;
  // 합성 미리보기도 같은 게이지로 보여 준다
  let mergedPieces = null;
  if (merging) {
    const used = new Set(merging.set.map((q) => q.uid));
    mergedPieces = s.pieces.filter((p) => p.uid === merging.target.uid || !used.has(p.uid))
      .map((p) => (p.uid === merging.target.uid ? { ...p, g: merging.g } : p));
    if (merging.target.uid !== -1) prevEv = G.income(s, mergedPieces);
  }
  const sales = ev.sum.total;
  const shown = prevEv ? prevEv.sum.total : sales;
  const pay = G.payFor(s);
  const coach = coachStep();

  $('p-day').textContent = `${s.day}일 차`;
  $('p-sub').textContent = s.phase === 'arrange' ? '상점 정리' : '입고';
  $('p-status').innerHTML = statusHTML();
  $('btn-coach-skip').hidden = !coach;
  $('btn-menu').hidden = !!coach;

  // 예상 매출 / 납부액 게이지: 부족분은 주황 빗금
  $('g-sales').textContent = fmt(shown);
  $('g-pay').textContent = fmt(pay);
  // 막대 전체가 납부액: 채운 만큼이 예상 매출, 남은 만큼이 부족분
  $('g-fill').style.width = `${(Math.min(shown, pay) / Math.max(pay, 1)) * 100}%`;
  $('g-short').style.width = `${(Math.max(0, pay - shown) / Math.max(pay, 1)) * 100}%`;
  const note = $('g-note');
  if (shown < pay) { note.textContent = `${fmt(pay - shown)} 부족 · 이대로면 불꽃이 하나 꺼져요`; note.className = 'g-note short'; }
  else { note.textContent = `납부 가능 · 잔금 +${fmt(shown - pay)}`; note.className = 'g-note ok'; }
  if (prevEv && shown !== sales) note.textContent += ` (지금 ${fmt(sales)} → ${fmt(shown)})`;
  $('gauge').classList.toggle('hl', coach === 3);

  renderChips();

  // 진열대
  const board = $('board');
  const vdim = viewDim();
  sizeBoard(board, vdim, 34);
  const g = ghostPiece();
  const matUids = new Set(merging ? merging.set.map((q) => q.uid) : []);
  let html = cellsHTML(vdim, true, { ok: sel && !merging ? placeableCells() : null, sealed: G.sealedNow(s), locked: s.dim });
  for (const p of s.pieces) {
    const r = ev.items.get(p.uid);
    const cls = [];
    let piece = p;
    if (merging && p.uid === merging.target.uid) { cls.push('result'); piece = { ...p, g: merging.g }; }
    else if (matUids.has(p.uid)) cls.push('mat');
    if (!merging && sel?.kind === 'piece' && sel.uid === p.uid) cls.push('selected', ghost ? 'lifted' : '');
    if (spark.has(p.uid)) cls.push('spark');
    if (press === p.uid) cls.push('press');
    let tag = '';
    if (prevEv && p.uid !== g?.uid && prevEv.items.has(p.uid)) {
      const gain = prevEv.items.get(p.uid).total - r.total;
      if (gain) tag = `<span class="ptag ${gain > 0 ? 'up' : 'bad'}">${gain > 0 ? '+' : ''}${gain}</span>`;
    }
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

  renderPanel(ev, prevEv, coach);
  renderActions(coach);
}

function renderChips() {
  const today = G.customerOn(s, s.day), tomorrow = G.customerOn(s, s.day + 1);
  const { mods } = G.modsFor(s);
  let html = `<span class="chip"><img src="${guestImg(today)}" alt="">${CUSTOMERS[today].name}${mods.noCustomer ? ' (효과 없음)' : ''}</span>` +
    `<span class="chip k">내일</span><span class="chip"><img src="${guestImg(tomorrow)}" alt="">${CUSTOMERS[tomorrow].name}</span>`;
  for (const c of G.activeContracts(s)) html += `<button class="chip contract" data-go="contract-info" data-c="${c.id}">📜 ${G.CONTRACTS[c.id].name} · ${G.contractDaysLeft(s, c)}일</button>`;
  if (s.contractOffer) html += `<button class="chip offer" data-go="contract">📜 계약 제안 ${s.contractOffer.ids.length}건</button>`;
  if (s.miracles) html += `<span class="chip k">✨ 기적 ${s.miracles}회</span>`;
  $('p-chips').innerHTML = html;
}

function coachHTML(step, dir) {
  const t = {
    1: ['상품을 하나 골라 진열대에 놓아 보세요', '상품을 누른 뒤, 놓고 싶은 칸을 누르면 돼요. 오늘은 두 번 들여올 수 있어요.'],
    2: ['어울리는 상품을 붙여 놓으면 보너스!', '약초는 옆 물약을, 숫돌은 옆 검·활을 키워요. 상하좌우로 맞닿아야 해요.'],
    3: ['예상 매출이 납부액을 넘는지 보고 영업!', '모자라면 영혼의 불꽃이 하나 꺼져요. 남는 돈은 잔금이 되어 다시 뽑기·확장에 써요.'],
  }[step];
  return `<div class="coach ${dir}"><div class="step">안내 ${step} / 3</div><div class="ttl2">${t[0]}</div><p class="body">${t[1]}</p></div>`;
}

function infoHTML(item, { acts = '', formulaHTML = '', hint = '', warn = false, extra = '' }) {
  const it = ITEMS[item.id];
  const g = item.g ?? 1;
  return `<div class="info">
    <div class="head"><div class="thumb"><img src="${itemImg(item.id)}" alt=""></div>
      <div><div class="nm">${gradeLabel(g)} ${it.name}<span class="r">${roman(g)}</span></div>
      <div class="meta">${CATS[it.cat].name} · ${it.cells.length}칸 · 기본 ${gradeBase(item.id, g)} / 일${item.bless ? ` · 기적 +${item.bless}` : ''}</div></div>
      <div class="acts">${acts}</div></div>
    <p class="eff">${effectText(item.id, g)}</p>
    ${formulaHTML ? `<div class="formula">${formulaHTML}</div>` : ''}
    ${hint ? `<p class="hint${warn ? ' warn' : ''}">${hint}</p>` : ''}
    ${extra}</div>`;
}

function mergeOfferHTML(plan) {
  if (!plan) return '';
  return `<div class="merge-offer"><span>🔥 <b>합성 가능</b> · 같은 ${gradeLabel(plan.target.g)} ${ITEMS[plan.target.id].name} 3개</span>` +
    `<button class="small-btn hot" data-act="merge-preview">미리보기</button></div>`;
}

function mergePanelHTML() {
  const m = merging;
  const id = m.target.id;
  const name = ITEMS[id].name;
  const before = m.set.reduce((a, q) => a + gradeBase(id, q.g), 0);
  const after = gradeBase(id, m.g);
  const freed = ITEMS[id].cells.length * 2;
  const tomorrow = G.customerOn(s, s.day + 1), today = G.customerOn(s, s.day);
  const rows = [
    ['오늘 기본 매출', `${before} → ${after} <span class="minus">(${after - before >= 0 ? '+' : ''}${after - before})</span>`],
    ['빈 칸', `+${freed}칸`],
  ];
  if (today === 'goblins') rows.push(['오늘 고블린 행상단', '같은 상품 보너스가 줄어요']);
  if (tomorrow === 'noble' || today === 'noble') rows.push([`${today === 'noble' ? '오늘' : '내일'} 귀족 수집가`, '높은 등급 보너스 대상']);
  if (s.miracles) rows.push(['세 번의 기적', `영구 +${4 * m.g}`]);
  const where = m.target.uid === -1 ? '손에 든 새 상품이 한 등급 올라요.' : '흐리게 표시된 칸은 합성 후 비어요.';
  return `<div class="parch-panel"><h4>${gradeLabel(m.target.g)} ${name} <span class="r">${roman(m.target.g)}</span> × 3 → ${gradeLabel(m.g)} ${name} <span class="r">${roman(m.g)}</span></h4>` +
    `<dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl><p>${where} 영업 전까지 되돌릴 수 있어요.</p></div>`;
}

function renderPanel(ev, prevEv, coach) {
  const panel = $('panel');
  if (merging) { panel.innerHTML = mergePanelHTML(); return; }

  if (sel?.kind === 'piece') {
    const p = selectedPiece();
    let f = formula(ev.items.get(p.uid));
    let hint = '옮길 칸을 누르거나 끌어 보세요. 회전도 미리 볼 수 있어요.';
    let warn = false;
    if (ghost) {
      if (prevEv) {
        const diff = prevEv.sum.total - ev.sum.total;
        f += `<span class="after${diff < 0 ? ' down' : ''}">옮기면 ${formula(prevEv.items.get(p.uid))} · 전체 ${diff >= 0 ? '+' : ''}${diff}</span>`;
        hint = '';
      } else { hint = '다른 상품이나 봉인된 칸과 겹쳐서 놓을 수 없어요.'; warn = true; }
    }
    const acts = `<button class="small-btn" data-act="discard">버리기</button><button class="small-btn" data-act="deselect">닫기</button>`;
    panel.innerHTML = infoHTML(p, { acts, formulaHTML: f, hint, warn, extra: ghost ? '' : mergeOfferHTML(G.mergePlan(s, p.uid)) });
    return;
  }

  if (s.phase === 'place' && s.hand) {
    if (!sel) {
      panel.innerHTML = infoHTML(s.hand, { acts: '<button class="small-btn hot" data-act="hold">새 상품 들기</button>', hint: '진열대 정리 중이에요. 상품을 눌러 옮기거나 버리거나 합성한 뒤 [새 상품 들기]를 누르세요.' });
      return;
    }
    let f = '', hint = '진열대에서 놓을 칸을 누르세요.', warn = false;
    if (ghost) {
      if (prevEv) { f = formula(prevEv.items.get(-1)); hint = ''; }
      else { hint = '다른 상품이나 봉인된 칸과 겹쳐서 놓을 수 없어요.'; warn = true; }
    } else if (!anyFit(s.dim, s.pieces, s.hand.id, G.sealedNow(s))) {
      hint = '놓을 자리가 없어요. 합성하거나, [진열대 정리]로 옮기거나 버리고, 아니면 → 버튼으로 넘겨요.';
      warn = true;
    }
    panel.innerHTML = (coach ? coachHTML(coach, 'up') : '') +
      infoHTML(s.hand, { acts: '<button class="small-btn" data-act="tidy">진열대 정리</button>', formulaHTML: f, hint, warn, extra: ghost ? '' : mergeOfferHTML(G.mergePlan(s, 'hand')) });
    return;
  }

  if (s.phase === 'pick') {
    const owned = {};
    s.pieces.forEach((p) => { if (p.g === s.offerGrade) owned[p.id] = (owned[p.id] ?? 0) + 1; });
    const fav = FAV[G.customerOn(s, s.day)];
    const cards = s.offers.map((id, i) => {
      const it = ITEMS[id];
      const tags = [];
      if (owned[id] >= 2) tags.push('🔥 합성 재료');
      else if (owned[id]) tags.push('같은 상품 보유');
      if (fav === it.cat) tags.push('오늘 손님 선호');
      return `<button class="offer${coach === 1 && i === 0 ? ' hl' : ''}" data-offer="${i}">
        <span class="cat" style="background:${CATS[it.cat].color}">${CATS[it.cat].name}</span>
        <span class="art"><img src="${itemImg(id)}" alt=""></span>
        <span class="nm">${s.offerGrade > 1 ? `${gradeLabel(s.offerGrade)} ` : ''}${it.name}</span>
        <span class="meta">${it.cells.length}칸 · 기본 ${gradeBase(id, s.offerGrade)}</span>
        <span class="eff">${effectText(id, s.offerGrade)}</span>
        ${tags.length ? `<span class="tagline">${tags.join(' · ')}</span>` : ''}</button>`;
    }).join('');
    const cost = G.rerollCost(s);
    const reroll = `<button class="small-btn${cost === 0 ? ' hot' : ''}" data-act="reroll" ${s.balance < cost ? 'disabled' : ''}>다시 뽑기 · ${cost === 0 ? (s.grace ? '유예 무료' : '무료') : `잔금 ${cost}`}</button>`;
    panel.innerHTML = (coach ? coachHTML(coach, 'down') : '') +
      `<div class="panel-head"><h3>입고 ${s.picksDone + 1} / ${s.picksDone + s.picksLeft}</h3>${reroll}</div><div class="offers">${cards}</div>`;
    return;
  }

  const extra = G.extraCost(s), expand = G.expandCost(s);
  const next = EXPAND_STEPS[s.expand];
  panel.innerHTML = `<div class="done-line"><svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg>오늘 입고 완료 · 상품을 눌러 옮기거나 합성할 수 있어요</div>` +
    `<div class="shopbar">
      <button class="btn" data-act="extra" ${s.balance < extra ? 'disabled' : ''}>추가 입고<small>잔금 ${extra}</small></button>
      <button class="btn" data-act="expand" ${expand === null || s.balance < expand ? 'disabled' : ''}>${expand === null ? '진열대 최대' : '자물쇠 칸 열기'}<small>${expand === null ? `${s.dim.cols}×${s.dim.rows}` : `잔금 ${expand} · ${next.cols}×${next.rows}`}</small></button>
    </div>` + (coach === 3 ? `<div style="margin-top:14px">${coachHTML(3, 'down')}</div>` : '');
}

function renderActions(coach) {
  const main = $('btn-main');
  const cancel = $('btn-merge-cancel');
  main.classList.remove('hl');
  if (merging) {
    $('btn-rotate').hidden = true;
    $('btn-skip').hidden = true;
    $('btn-undo').hidden = false;
    $('btn-undo').disabled = !G.canUndo(s);
    cancel.hidden = false;
    main.textContent = '합성하기';
    main.disabled = false;
    return;
  }
  cancel.hidden = true;
  $('btn-rotate').hidden = false;
  $('btn-undo').hidden = false;
  $('btn-rotate').disabled = !sel;
  $('btn-undo').disabled = !G.canUndo(s);
  $('btn-skip').hidden = !(s.phase === 'pick' || s.phase === 'place');
  let label, enabled = false;
  if (ghost) {
    enabled = ghostValid();
    label = enabled ? '여기에 놓기' : '놓을 수 없는 자리';
    if (enabled && coach === 2) main.classList.add('hl');
  } else if (sel?.kind === 'hand') label = '놓을 칸을 누르세요';
  else if (G.canOpen(s)) { enabled = true; label = '영업 시작'; if (coach === 3) main.classList.add('hl'); }
  else if (s.phase === 'place') label = '새 상품을 놓아 주세요';
  else label = `상품 ${s.picksLeft}개를 고르면 영업 시작`;
  main.textContent = label;
  main.disabled = !enabled;
}

function coachStep() {
  if (tutorialDone() || s.day !== 1) return 0;
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
  save();
  render();
}

/* ---------- 04 마왕의 계약 ---------- */

function spanText(c, day) {
  const span = G.CONTRACT_SPAN[c];
  if (!span) return ['즉시', '받는 순간 끝나요'];
  const a = day + span[0], b = day + span[1];
  return [`${b - a + 1}일 (${a}~${b}일 차)`, `${b + 1}일 차 아침에 ${c === 'seal' ? '봉인이 풀려요' : '효과가 끝나요'}`];
}

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

function showContract() {
  if (!s.contractOffer) return;
  if (!pickedContract || !s.contractOffer.ids.includes(pickedContract)) pickedContract = null;
  const active = G.activeContracts(s).length;
  $('c-count').textContent = `진행 중 ${active} / 2`;
  const pay = G.payFor(s), sales = G.income(s).sum.total;
  $('c-list').innerHTML = s.contractOffer.ids.map((id) => {
    const c = G.CONTRACTS[id];
    const can = G.canSign(s, id);
    if (id !== pickedContract) {
      return `<button class="c-item${can.ok ? '' : ' no'}" data-pick="${id}"><div><b>${c.name}</b><small>${c.gain} · ${c.cost}</small></div><span class="chev">›</span></button>`;
    }
    const [period, end] = spanText(id, s.day);
    const trial = JSON.parse(JSON.stringify(s));
    trial.undo = [];
    let today = '';
    if (G.sign(trial, id)) {
      const tPay = G.payFor(trial), tSales = G.income(trial).sum.total;
      const lines = [`납부액 ${fmt(pay)} → <b>${fmt(tPay)}</b>`, `예상 매출 ${fmt(tSales)}${tSales === sales ? ' (변화 없음)' : ` (${tSales - sales > 0 ? '+' : ''}${tSales - sales})`}`];
      if (trial.balance !== s.balance) lines.push(`잔금 ${fmt(s.balance)} → ${fmt(trial.balance)}`);
      if (trial.lives !== s.lives) lines.push(`영혼의 불꽃 ${s.lives} → ${trial.lives}`);
      if (trial.picksLeft !== s.picksLeft) lines.push(`오늘 입고 ${trial.picksLeft - s.picksLeft}번 추가`);
      const verdict = sales < pay && tSales >= tPay ? '<span class="ok">납부 가능해져요</span>' : tSales < tPay ? '아직 납부액에 모자라요' : '';
      today = `<div class="today">${id === 'seal' ? minimap(s.contractOffer.cells) : ''}<div><b class="h">오늘 예상</b>${lines.join('<br>')}${verdict ? `<br>${verdict}` : ''}</div></div>`;
    }
    return `<div class="c-open"><button class="x" data-pick="" aria-label="선택 취소"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
      <div class="k">선택한 계약</div><h3>${c.name}</h3>
      <dl><dt>받는 것</dt><dd class="gain">${c.gain}</dd><dt>대가</dt><dd class="cost">${c.cost}</dd><dt>기간</dt><dd>${period}</dd><dt>끝나면</dt><dd>${end}</dd></dl>
      ${today}${can.ok ? '' : `<p class="why">${can.why}</p>`}</div>`;
  }).join('');
  const sign = $('btn-sign');
  const ok = pickedContract && G.canSign(s, pickedContract).ok;
  sign.disabled = !ok;
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
  if (!tutorialDone()) store.set(KEY_TUTORIAL, true);
  save();
  S.play('open_shop');
  showJudge();
}

function showJudge(fromSave = false) {
  const st = s.last;
  const cust = CUSTOMERS[st.customer];
  $('j-title').textContent = `${st.day}일 차 납부`;
  const short = st.pay - st.sales;
  const contract = st.sum.contract + st.sum.perma;
  $('receipt').innerHTML = `<h4>오늘 매출 명세</h4>
    <div class="row"><span>상품 기본 매출</span><b>${fmt(st.sum.base)}</b></div>
    <div class="row"><span>배치 조합 보너스</span><b>${st.sum.place >= 0 ? '+' : ''}${fmt(st.sum.place)}</b></div>
    <div class="row"><span>특별 손님 · ${cust.name}</span><b>+${fmt(st.sum.customer)}</b></div>
    <div class="row"><span>계약 · 성장 효과</span><b>${contract > 0 ? '+' : ''}${fmt(contract)}</b></div>
    <hr><div class="row big"><span>오늘 매출</span><b data-count="${st.sales}">${fromSave ? fmt(st.sales) : 0}</b></div>
    <div class="row big"><span>납부액</span><b>${fmt(st.pay)}</b></div>
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

  const extra = $('j-extra');
  const next = $('btn-judge-next');
  if (s.phase === 'reward') {
    extra.innerHTML = `<div class="gain-card"><span>잔금 +${fmt(st.gain)}</span><b>${fmt(s.balance)}</b></div><div class="rewards"><h3>결산 보상 고르기</h3>${s.rewardOffer.map((k) =>
      `<button class="reward" data-reward="${k}"><b>${G.REWARDS[k].name}</b><span>${G.REWARDS[k].text}</span></button>`).join('')}</div>`;
    next.hidden = true;
  } else {
    next.hidden = false;
    if (s.phase === 'over') {
      extra.innerHTML = '';
      next.textContent = '압류 통지서 받기';
    } else {
      extra.innerHTML = st.ok
        ? `<div class="gain-card"><span>잔금 +${fmt(st.gain)}</span><b>${fmt(s.balance)}</b></div>`
        : `<div class="grace"><svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v5h-5"/></svg><div><b>마왕의 유예를 받았어요</b>${s.day}일 차에 상품 후보 전체를 한 번 무료로 다시 뽑을 수 있어요. 그날이 끝나면 사라져요.</div></div>`;
      next.textContent = `${s.day}일 차 아침으로`;
    }
  }
  show('judge');
  if (!fromSave) {
    const n = Math.min(Object.keys(st.perItem).length, 12);
    for (let i = 0; i < n; i++) S.play('coin_tick', { delay: 0.3 + i * 0.07, rate: 1 + Math.min(i, 10) * 0.03 });
    const t = 0.4 + n * 0.07;
    if (st.ok) S.play('pay_success', { delay: t });
    else { S.play('pay_fail', { delay: t }); S.play('flame_out', { delay: t + 0.6 }); }
    if (s.phase === 'over') S.play('seized', { delay: t + 1.4 });
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
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function skipJudgeAnim() {
  judgeAnim = null;
  const el = $('receipt').querySelector('[data-count]');
  if (el) el.textContent = fmt(+el.dataset.count);
}

function finishJudge() {
  if (s.phase === 'reward') return;
  judgeAnim = null;
  if (s.phase === 'over') return showResult();
  resetSelection();
  route();
}

/* ---------- 06 압류 통지서 ---------- */

function showResult() {
  const sum = G.summary(s);
  const fresh = !s.final;
  if (fresh) {
    const prevBest = bestRecord();
    const isNew = G.better({ days: sum.days, total: s.total }, prevBest);
    if (isNew) store.set(KEY_BEST, { days: sum.days, total: s.total, at: Date.now() });
    s.final = { isNew, prev: prevBest ?? null };
    save();
  }
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
  const canvas = await drawCard({ dim: s.dim, pieces: s.pieces, days: sum.days, total: s.total, bestDay: s.bestDay, signed: s.signed, nickname: sum.nickname, url });
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

function onTap(x, y) {
  if (merging) return;
  if (isLocked(x, y)) {
    const cost = G.expandCost(s);
    toast(cost === null ? '더 넓힐 수 없어요' : `잔금 ${cost}으로 자물쇠 칸을 열 수 있어요 (영업 준비가 끝난 뒤)`);
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

function clampToDim(x, y) {
  return { x: Math.min(x, s.dim.cols - 1), y: Math.min(y, s.dim.rows - 1) };
}

let drag = null;
function onPointerDown(ev) {
  if (ev.button > 0 || merging) return;
  const { x, y } = cellFromPoint(ev);
  drag = { x0: ev.clientX, y0: ev.clientY, cell: { x, y }, moved: false };
  $('board').setPointerCapture(ev.pointerId);
}
function onPointerMove(ev) {
  if (!drag) return;
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
  const c = clampToDim(...Object.values(cellFromPoint(ev)));
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
  G.discard(s, p.uid);
  S.play('discard');
  select(null);
  save();
  render();
  toast(`${ITEMS[p.id].name}을(를) 버렸어요. 되돌리기로 살릴 수 있어요.`);
}

function act(fn, sound) {
  if (fn(s)) { if (sound) S.play(sound); resetSelection(); save(); render(); return true; }
  return false;
}

function undo() {
  if (merging) { merging = null; render(); return; }
  if (G.undo(s)) { S.play('undo'); resetSelection(); save(); render(); }
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
    const offer = e.target.closest('[data-offer]');
    if (offer) {
      G.choose(s, +offer.dataset.offer);
      S.play('item_pick');
      select({ kind: 'hand' });
      save();
      return render();
    }
    const go = e.target.closest('[data-go]');
    if (go) {
      if (go.dataset.go === 'contract') openContract();
      if (go.dataset.go === 'contract-info') { const c = G.CONTRACTS[go.dataset.c]; toast(`${c.name} · 받는 것: ${c.gain} · 대가: ${c.cost}`); }
      return;
    }
    const btn = e.target.closest('[data-act]');
    if (!btn || btn.disabled) return;
    const a = btn.dataset.act;
    if (a === 'deselect' || a === 'tidy') { select(null); render(); }
    if (a === 'hold') { select({ kind: 'hand' }); render(); }
    if (a === 'discard') discardSelected();
    if (a === 'merge-preview') startMerge();
    if (a === 'reroll') act(G.reroll, 'reroll');
    if (a === 'extra') act(G.buyExtra, 'item_pick');
    if (a === 'expand' && act(G.buyExpand, 'reward_pick')) toast(`진열대가 ${s.dim.cols}×${s.dim.rows}로 넓어졌어요`);
  };
  $('panel').addEventListener('click', onAct);
  $('p-chips').addEventListener('click', onAct);
  $('m-contracts').addEventListener('click', onAct);

  $('c-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pick]');
    if (!b) return;
    pickedContract = b.dataset.pick || null;
    showContract();
  });
  $('btn-sign').onclick = () => {
    const id = pickedContract;
    if (!id || !G.sign(s, id)) return;
    S.play('contract_sign');
    toast(`계약 체결: ${G.CONTRACTS[id].name}`);
    resetSelection();
    save();
    backFromContract();
  };
  $('btn-refuse').onclick = () => { G.refuseContracts(s); S.play('contract_reject'); save(); backFromContract(); };
  $('btn-contract-close').onclick = backFromContract;

  $('btn-go-shelf').onclick = leaveMorning;
  $('j-extra').addEventListener('click', (e) => {
    const b = e.target.closest('[data-reward]');
    if (!b) return;
    G.takeReward(s, b.dataset.reward);
    S.play('reward_pick');
    resetSelection();
    save();
    route();
  });
  $('btn-judge-skip').onclick = () => { if (judgeAnim) skipJudgeAnim(); else finishJudge(); };
  $('btn-judge-next').onclick = finishJudge;

  $('btn-rotate').onclick = rotate;
  $('btn-undo').onclick = undo;
  $('btn-skip').onclick = () => act(G.skip);
  $('btn-merge-cancel').onclick = () => { merging = null; render(); };
  $('btn-main').onclick = () => { if (merging) confirmMerge(); else if (ghost) commit(); else openShop(); };
  $('btn-coach-skip').onclick = () => { store.set(KEY_TUTORIAL, true); render(); };
  $('btn-menu').onclick = () => $('help').showModal();
  $('btn-new').onclick = () => {
    const run = loadRun();
    if (run && run.phase !== 'over' && !confirm('진행 중인 상점이 있어요. 새 계약서에 서명할까요?')) return;
    S.play('contract_sign');
    startNew();
  };
  $('btn-continue').onclick = resume;
  $('btn-home').onclick = () => { $('help').close(); goStart(); };
  $('btn-again').onclick = () => { S.play('contract_sign'); startNew(); };
  $('btn-result-home').onclick = goStart;
  $('btn-card').onclick = saveCard;
  document.querySelectorAll('[data-open-help]').forEach((b) => { b.onclick = () => $('help').showModal(); });

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
    if (b.matches('.cell, .offer, #btn-rotate, #btn-undo, #btn-main, #btn-sound, #btn-sign, #btn-refuse, #btn-new, #btn-again, [data-act], [data-go], [data-reward]')) return;
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

function fillHelp() {
  $('help-items').innerHTML = ITEM_IDS.map((id) => {
    const it = ITEMS[id];
    return `<div class="help-item"><div class="pic"><img src="${itemImg(id)}" alt=""></div>
      <b>${it.name}</b><div class="meta">${CATS[it.cat].name} · ${it.cells.length}칸 · 기본 ${it.base}</div><div>${effectText(id, 1)}</div></div>`;
  }).join('');
  $('help-guests').innerHTML = Object.entries(CUSTOMERS).map(([id, c]) =>
    `<div><img src="${guestImg(id)}" alt=""><span><b>${c.name}</b>${c.text}</span></div>`).join('');
}

fillHelp();
S.init();
bind();
goStart();
