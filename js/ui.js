// 화면: 시작·플레이·정산·압류 통지서. 선택 후 위치 누르기(끌기는 보조), 합성, 계약, 첫 플레이 안내, 저장.
import {
  ITEMS, ITEM_IDS, CATS, CUSTOMERS, MAX_LIVES,
  shapeOf, sizeOf, cellsOf, clampAnchor, canPlace, occupancy, evaluate, gradeBase, gradeLabel, effectText, anyFit,
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

let s = null;          // 게임 상태 (저장 대상)
let sel = null;        // { kind: 'hand' } | { kind: 'piece', uid }
let ghost = null;      // { x, y, rot } 미리보기
let handRot = 0;
let spark = new Set(); // 조합이 막 생긴 상품
let press = null;      // 방금 놓은 상품
let settling = null;   // 정산 화면 정보
let sealPreview = null;

/* ---------- 저장 ---------- */

function save() { if (s) store.set(KEY_RUN, s); }
function loadRun() {
  const r = store.get(KEY_RUN);
  return r && r.v === 2 && Array.isArray(r.pieces) ? r : null;
}
const bestRecord = () => store.get(KEY_BEST);
const tutorialDone = () => store.get(KEY_TUTORIAL) === true;

/* ---------- 화면 전환 ---------- */

function show(name) {
  for (const id of ['start', 'play', 'settle', 'result']) $(`screen-${id}`).hidden = id !== name;
  window.scrollTo(0, 0);
}

function goStart() {
  const run = loadRun();
  const cont = $('btn-continue');
  cont.hidden = !(run && run.phase !== 'over');
  if (run) cont.textContent = `이어 하기 · ${run.day}일 차`;
  const best = bestRecord();
  $('start-best').innerHTML = best
    ? `최고 기록 <strong>${best.days}</strong>일 <b>누적 ${fmt(best.total)}</b>` : '';
  show('start');
}

function startNew() {
  s = G.newGame();
  resetSelection();
  save();
  show('play');
  render();
}

function resume() {
  s = loadRun();
  if (!s) return goStart();
  resetSelection();
  if (s.phase === 'over') return showResult();
  if (s.phase === 'reward') return showSettle(true);
  show('play');
  render();
}

// 새 상품을 받는 중이면 그 상품을 든 상태로 돌아간다
function resetSelection() {
  ghost = null;
  handRot = s?.hand?.rot ?? 0;
  sel = s?.phase === 'place' && s.hand ? { kind: 'hand' } : null;
}

/* ---------- 진열대 그리기 ---------- */

const pct = (v, n) => (v / n) * 100;
const GAP = '0.55cqw';

function cellBox(dim, x, y, out) {
  // 바깥쪽 면만 띄워서 같은 상품의 칸끼리는 한 덩어리로 보이게 한다
  const [t, r, b, l] = out.map((o) => (o ? GAP : '-0.5px'));
  return `left:calc(${pct(x, dim.cols)}% + ${l});top:calc(${pct(y, dim.rows)}% + ${t});` +
    `width:calc(${pct(1, dim.cols)}% - ${l} - ${r});height:calc(${pct(1, dim.rows)}% - ${t} - ${b})`;
}

function labelBox(p) {
  const cells = cellsOf(p);
  const { w, h } = sizeOf(p.id, p.rot);
  if (cells.length === w * h) return { x: p.x, y: p.y, w, h };
  // 꺾인 상품은 무게중심에 가장 가까운 칸에 이름을 쓴다
  const cx = cells.reduce((a, c) => a + c[0], 0) / cells.length;
  const cy = cells.reduce((a, c) => a + c[1], 0) / cells.length;
  const [bx, by] = cells.reduce((best, c) =>
    Math.hypot(c[0] - cx, c[1] - cy) < Math.hypot(best[0] - cx, best[1] - cy) ? c : best);
  return { x: bx, y: by, w: 1, h: 1 };
}

function tileColor(id) {
  return CATS[ITEMS[id].cat].color;
}

function pieceHTML(dim, p, { cls = '', sub = '', tag = '' } = {}) {
  const cells = cellsOf(p);
  const has = (x, y) => cells.some((c) => c[0] === x && c[1] === y);
  const it = ITEMS[p.id];
  const g = p.g ?? 1;
  let html = `<div class="piece g${Math.min(g, 6)} ${cls}" data-uid="${p.uid ?? ''}">`;
  for (const [x, y] of cells) {
    const out = [!has(x, y - 1), !has(x + 1, y), !has(x, y + 1), !has(x - 1, y)];
    const c = [];
    if (out[0] && out[3]) c.push('r-tl');
    if (out[0] && out[1]) c.push('r-tr');
    if (out[2] && out[3]) c.push('r-bl');
    if (out[2] && out[1]) c.push('r-br');
    if (out[2]) c.push('floor');
    ['o-t', 'o-r', 'o-b', 'o-l'].forEach((k, i) => { if (out[i]) c.push(k); });
    html += `<div class="pc ${c.join(' ')}" style="${cellBox(dim, x, y, out)};background:${tileColor(p.id)}"></div>`;
  }
  const b = labelBox(p);
  const cell = 100 / dim.cols;
  const emo = Math.min(b.w * cell * 0.5, b.h * cell * 0.42, 13);
  html += `<div class="lbl" style="left:${pct(b.x, dim.cols)}%;top:${pct(b.y, dim.rows)}%;width:${pct(b.w, dim.cols)}%;height:${pct(b.h, dim.rows)}%">` +
    `${g > 1 ? `<span class="gbadge">${gradeLabel(g)}</span>` : ''}` +
    `<span class="emo" style="font-size:${emo}cqw">${it.icon}</span><span class="nm">${it.name}</span>${sub}${tag}</div></div>`;
  return html;
}

function cellsHTML(dim, interactive, { ok = null, sealed = [], preview = [] } = {}) {
  const seal = new Set(sealed), pre = new Set(preview);
  let html = '';
  for (let y = 0; y < dim.rows; y++)
    for (let x = 0; x < dim.cols; x++) {
      const k = `${x},${y}`;
      const style = `left:${pct(x, dim.cols)}%;top:${pct(y, dim.rows)}%;width:${pct(1, dim.cols)}%;height:${pct(1, dim.rows)}%`;
      const c = `cell${ok?.has(k) ? ' ok' : ''}${seal.has(k) ? ' sealed' : ''}${pre.has(k) ? ' seal-preview' : ''}`;
      html += interactive
        ? `<button class="${c}" data-x="${x}" data-y="${y}" style="${style}" aria-label="${y + 1}행 ${x + 1}열${seal.has(k) ? ' 봉인됨' : ''}"></button>`
        : `<div class="${c}" style="${style}"></div>`;
    }
  return html;
}

function sizeBoard(el, dim) {
  el.style.aspectRatio = `${dim.cols} / ${dim.rows}`;
  // 플레이 화면에서는 진열대가 화면 높이의 30%를 넘지 않게 해 후보 카드가 함께 보이도록
  if (el.id === 'board') el.parentElement.style.width = `min(100%, calc(30dvh * ${dim.cols} / ${dim.rows} + 14px))`;
}

function staticBoard(el, dim, pieces, subOf = null, cls = '') {
  sizeBoard(el, dim);
  el.innerHTML = cellsHTML(dim, false) + pieces.map((p, i) =>
    pieceHTML(dim, p, { sub: subOf ? subOf(p, i) : '', cls })).join('');
}

/* ---------- 선택과 미리보기 ---------- */

function selectedItem() {
  if (!sel) return null;
  if (sel.kind === 'hand') return s.hand ?? null;
  return s.pieces.find((p) => p.uid === sel.uid) ?? null;
}
function selectedId() { return selectedItem()?.id ?? null; }
function selectedPiece() {
  return sel?.kind === 'piece' ? s.pieces.find((p) => p.uid === sel.uid) : null;
}
function ignoreUid() { return sel?.kind === 'piece' ? sel.uid : undefined; }
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

// 선택한 상품을 지금 방향으로 놓을 수 있는 칸들 (점선)
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
  if (next?.kind === 'hand') handRot = s.hand.rot ?? 0;
}

function commit() {
  if (!ghostValid()) return false;
  const before = G.income(s).items;
  const g = ghost;
  let ok;
  let uid;
  if (sel.kind === 'hand') {
    uid = s.nextUid;
    ok = G.placeHand(s, g.x, g.y, g.rot);
  } else {
    uid = sel.uid;
    ok = G.movePiece(s, uid, g.x, g.y, g.rot);
  }
  if (!ok) return false;
  markSparks(before);
  S.play('item_place');
  if (spark.size) S.play('combo_spark', { delay: 0.12 });
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

/* ---------- 마왕의 한마디 ---------- */

function demonLine() {
  if (s.lives === 1) return '마지막 불꽃이군. 가게 열쇠는 잘 챙겨 두게.';
  if (s.grace) return '불꽃이 하나 꺼졌군. 이번만 후보를 공짜로 다시 뽑게 해 주지.';
  if (s.contractOffer) return '좋은 조건이 있는데… 읽어 보겠나? 이번엔 작은 글씨 없다네.';
  if (G.isSettleDay(s.day)) return '오늘은 결산일이지. 평소보다 조금 더 기대하고 있겠네.';
  if (s.day === 1) return '어서 오게, 새 세입자. 첫날이니 조금만 받지.';
  const lines = ['오늘도 꼬박꼬박 부탁하네, 상인 양반.', '계산기는 이미 두드려 놨다네.', '어제보다 조금 올랐지? 물가가 그렇다네.', '손님 오는 소리가 들리는군. 내 몫도 들리고.'];
  return lines[s.day % lines.length];
}

/* ---------- 플레이 화면 ---------- */

function formula(r) {
  const parts = r.bonuses.map((b) => `${b.amount < 0 ? '-' : '+'} ${b.label} ${Math.abs(b.amount)}`);
  return `기본 ${r.base} ${parts.join(' ')} = 하루 ${r.total}`.replace(/ {2,}/g, ' ');
}

function render() {
  if (!s) return;
  if (s.phase === 'over') return showResult();
  if (s.phase === 'reward') return showSettle(true);

  const ev = G.income(s);
  const sales = ev.sum.total;
  const prev = previewPieces();
  const prevEv = prev ? G.income(s, prev) : null;
  const prevSales = prevEv ? prevEv.sum.total : null;
  const pay = G.payFor(s);
  const coach = coachStep();

  // 상단: 날짜, 불꽃, 납부액, 예상 매출, 잔금
  $('hud-day').textContent = `${s.day}일 차`;
  $('hud-flames').innerHTML = Array.from({ length: MAX_LIVES }, (_, i) =>
    `<i class="${i < s.lives ? '' : 'out'}" aria-hidden="true">🔥</i>`).join('');
  $('hud-flames').setAttribute('aria-label', `영혼의 불꽃 ${s.lives}개`);
  $('btn-coach-skip').hidden = !coach;
  $('btn-menu').hidden = !!coach;
  $('hud-pay').textContent = fmt(pay);
  $('hud-settle').textContent = G.isSettleDay(s.day) ? '결산일' : '';
  $('hud-settle').className = 'tag';
  const shown = prevSales ?? sales;
  const inc = $('hud-income');
  inc.textContent = fmt(shown);
  inc.className = shown >= pay ? 'ok' : 'short';
  const d = $('hud-delta');
  if (prevSales !== null && prevSales !== sales) {
    const diff = prevSales - sales;
    d.textContent = `${diff > 0 ? '▲' : '▼'}${Math.abs(diff)}`;
    d.className = diff > 0 ? 'up' : 'down';
  } else { d.textContent = ''; d.className = ''; }
  $('hud-balance').textContent = fmt(s.balance);
  $('stat-income').classList.toggle('hl', coach === 3);
  $('stat-pay').classList.toggle('hl', coach === 3);

  renderBrief();

  // 진열대
  const board = $('board');
  sizeBoard(board, s.dim);
  const plan = sel ? G.mergePlan(s, sel.kind === 'hand' ? 'hand' : sel.uid) : null;
  const mergeUids = new Set(plan && !ghost ? plan.set.map((q) => q.uid) : []);
  const g = ghostPiece();
  let html = cellsHTML(s.dim, true, { ok: sel ? placeableCells() : null, sealed: G.sealedNow(s), preview: sealPreview ?? [] });
  for (const p of s.pieces) {
    const r = ev.items.get(p.uid);
    const cls = [];
    if (sel?.kind === 'piece' && sel.uid === p.uid) cls.push('selected', ghost ? 'lifted' : '');
    if (mergeUids.has(p.uid)) cls.push('merge-src');
    if (spark.has(p.uid)) cls.push('spark');
    if (press === p.uid) cls.push('press');
    let tag = '';
    if (prevEv && p.uid !== g?.uid) {
      const gain = prevEv.items.get(p.uid).total - r.total;
      if (gain) tag = `<span class="pill-tag ${gain > 0 ? 'orange' : 'bad'}">${gain > 0 ? '+' : ''}${gain}</span>`;
    }
    const sub = `<span class="per">${r.bonuses.some((b) => b.amount > 0) ? '✦ ' : ''}하루 ${r.total}</span>`;
    html += pieceHTML(s.dim, p, { cls: cls.join(' '), sub, tag });
  }
  if (g) {
    const valid = ghostValid();
    const tag = valid
      ? `<span class="pill-tag">+${prevEv.items.get(g.uid).total}</span>`
      : '<span class="pill-tag bad">✕ 놓을 수 없음</span>';
    html += pieceHTML(s.dim, g, { cls: `ghost ${valid ? 'valid' : 'invalid'}`, tag });
  }
  board.innerHTML = html;
  $('legend').hidden = !sel;
  spark = new Set();
  press = null;

  renderPanel(ev, prevEv, coach, plan);
  renderActions(coach);
}

function renderBrief() {
  const today = CUSTOMERS[G.customerOn(s, s.day)];
  const tomorrow = CUSTOMERS[G.customerOn(s, s.day + 1)];
  const { mods } = G.modsFor(s);
  const active = G.activeContracts(s);
  let html = `<div class="demon"><span class="face">😈</span><p>${demonLine()}</p></div>`;
  html += `<div class="cust"><span>오늘 ${today.icon} <b>${today.name}</b>${mods.noCustomer ? ' (계약으로 효과 없음)' : ''}</span>` +
    `<span class="next">내일 ${tomorrow.icon} ${tomorrow.name}</span></div>`;
  if (s.contractOffer) html += `<button class="chipbtn offer-c" data-act="contracts">📜 계약 제안 ${s.contractOffer.ids.length}건 보기</button>`;
  for (const c of active) {
    const left = { rush: 3, redsign: 2, seal: 2, goblinloan: 3, overtime: 3, accountant: 2, lifebond: 5, witchsale: 2 }[c.id] + c.day - s.day + 1;
    html += `<button class="chipbtn" data-act="contract-info" data-c="${c.id}">📜 ${G.CONTRACTS[c.id].name} · ${left}일 남음</button>`;
  }
  if (s.miracles) html += `<span class="chipbtn">✨ 기적 ${s.miracles}회</span>`;
  $('brief').innerHTML = html;
}

function miniShape(id, rot = 0, cell = 10) {
  const sh = shapeOf(id, rot);
  const { w, h } = sizeOf(id, rot);
  const rects = sh.map(([x, y]) =>
    `<rect x="${x * cell + 1}" y="${y * cell + 1}" width="${cell - 3}" height="${cell - 3}" rx="3" fill="${tileColor(id)}"/>`).join('');
  return `<svg class="mini" style="width:${w * cell}px;height:${h * cell}px;stroke:none" viewBox="0 0 ${w * cell} ${h * cell}" aria-hidden="true">${rects}</svg>`;
}

function coachHTML(step, dir) {
  const t = {
    1: ['상품을 하나 골라 진열대에 놓아 보세요', '상품을 누른 뒤, 놓고 싶은 칸을 누르면 돼요. 오늘은 두 번 들여올 수 있어요.'],
    2: ['어울리는 상품을 붙여 놓으면 보너스!', '약초는 옆 물약을, 숫돌은 옆 검·활을 키워요. 상하좌우로 맞닿아야 해요.'],
    3: ['예상 매출이 납부액을 넘는지 보고 영업!', '모자라면 영혼의 불꽃이 하나 꺼져요. 남는 돈은 잔금이 되어 다시 뽑기·확장에 써요.'],
  }[step];
  return `<div class="coach ${dir}"><div class="step">안내 ${step} / 3</div><div class="ttl">${t[0]}</div><p class="body">${t[1]}</p></div>`;
}

function infoHTML(item, { acts = '', chips = '', formulaHTML = '', hint = '', warn = false, extra = '' }) {
  const it = ITEMS[item.id];
  const g = item.g ?? 1;
  return `<div class="card info">
    <div class="head"><div class="thumb">${it.icon}</div>
      <div><div class="nm">${g > 1 ? `${gradeLabel(g)} ` : ''}${it.name}</div><div class="meta">${CATS[it.cat].name} · ${it.cells.length}칸 · 기본 ${gradeBase(item.id, g)} / 일${item.bless ? ` · 기적 +${item.bless}` : ''}</div></div>
      <div class="acts">${acts}</div></div>
    <p class="eff">${effectText(item.id, g)}</p>
    ${chips ? `<div class="chips">${chips}</div>` : ''}
    ${formulaHTML ? `<div class="formula">${formulaHTML}</div>` : ''}
    ${hint ? `<p class="hint${warn ? ' warn' : ''}">${hint}</p>` : ''}
    ${extra}
  </div>`;
}

function chipsFor(pieces, items, uid) {
  const r = items.get(uid);
  if (!r) return '';
  const from = new Set(r.bonuses.filter((b) => b.kind === 'place').flatMap((b) => b.from));
  const byUid = new Map(pieces.map((p) => [p.uid, p]));
  const names = [...new Set([...from].map((u) => ITEMS[byUid.get(u).id].name))];
  if (!names.length) return '';
  const total = r.bonuses.filter((b) => b.kind === 'place').reduce((a, b) => a + b.amount, 0);
  return names.map((n) => `<span class="chip">${n}</span>`).join('') +
    `<span class="ok-mark">${total >= 0 ? '✓ 배치 +' : '배치 '}${total}</span>`;
}

function mergeHTML(plan) {
  if (!plan) return '';
  const id = plan.target.id;
  const lose = plan.set.reduce((a, q) => a + gradeBase(id, q.g), 0);
  const gain = gradeBase(id, plan.g);
  const where = plan.target.uid === -1 ? '손에 든 상품이 한 등급 올라요' : '기준 상품 자리에 남아요';
  return `<div class="merge-box">🔥 <b>합성 가능</b>: ${gradeLabel(plan.target.g)} ${ITEMS[id].name} 3개 → <b>${gradeLabel(plan.g)}</b> 1개 (${where})<br>` +
    `기본 매출 ${lose} → ${gain}, 칸 ${ITEMS[id].cells.length * 2}개가 비어요.${s.miracles ? ` 기적으로 영구 +${4 * plan.g}.` : ''}` +
    `<button class="btn danger" data-act="merge">합성하기</button></div>`;
}

function renderPanel(ev, prevEv, coach, plan) {
  const panel = $('panel');

  if (sel?.kind === 'piece') {
    const p = selectedPiece();
    const now = ev.items.get(p.uid);
    let f = formula(now);
    let hint = '옮길 칸을 누르거나 끌어 보세요. 회전도 미리 볼 수 있어요.';
    let warn = false;
    let chips = chipsFor(s.pieces, ev.items, p.uid);
    if (ghost) {
      if (prevEv) {
        const r = prevEv.items.get(p.uid);
        const diff = prevEv.sum.total - ev.sum.total;
        f += `<span class="after${diff < 0 ? ' down' : ''}">옮기면 ${formula(r)} · 전체 ${diff >= 0 ? '+' : ''}${diff}</span>`;
        chips = chipsFor(previewPieces(), prevEv.items, p.uid);
        hint = '';
      } else { hint = '다른 상품이나 봉인된 칸과 겹쳐서 놓을 수 없어요.'; warn = true; }
    }
    const acts = `<button class="mini-btn" data-act="discard">버리기</button><button class="mini-btn" data-act="deselect">닫기</button>`;
    panel.innerHTML = infoHTML(p, { acts, chips, formulaHTML: f, hint, warn, extra: ghost ? '' : mergeHTML(plan) });
    return;
  }

  if (s.phase === 'place' && s.hand) {
    if (!sel) {
      const acts = `<button class="mini-btn" data-act="hold">새 상품 들기</button>`;
      panel.innerHTML = infoHTML(s.hand, { acts, hint: '진열대 정리 중이에요. 상품을 눌러 옮기거나 버리거나 합성한 뒤 [새 상품 들기]를 누르세요.' });
      return;
    }
    let f = '';
    let chips = '';
    let hint = '진열대에서 놓을 칸을 누르세요.';
    let warn = false;
    if (ghost) {
      if (prevEv) {
        f = formula(prevEv.items.get(-1));
        chips = chipsFor(previewPieces(), prevEv.items, -1);
        hint = '';
      } else { hint = '다른 상품이나 봉인된 칸과 겹쳐서 놓을 수 없어요.'; warn = true; }
    } else if (!anyFit(s.dim, s.pieces, s.hand.id, G.sealedNow(s))) {
      hint = '놓을 자리가 없어요. 합성하거나, [진열대 정리]로 옮기거나 버리고, 아니면 → 버튼으로 넘겨요.';
      warn = true;
    }
    const acts = `<button class="mini-btn" data-act="tidy">진열대 정리</button>`;
    panel.innerHTML = (coach ? coachHTML(coach, 'up') : '') +
      infoHTML(s.hand, { acts, chips, formulaHTML: f, hint, warn, extra: ghost ? '' : mergeHTML(plan) });
    return;
  }

  if (s.phase === 'pick') {
    const owned = {};
    s.pieces.forEach((p) => { if (p.g === s.offerGrade) owned[p.id] = (owned[p.id] ?? 0) + 1; });
    const favCat = { adventurers: 'gear', witches: 'alch', school: 'magic' }[G.customerOn(s, s.day)];
    const cards = s.offers.map((id, i) => {
      const it = ITEMS[id];
      const hl = coach === 1 && i === 0 ? ' hl' : '';
      const tags = [];
      if (owned[id] >= 2) tags.push('🔥 합성 재료');
      else if (owned[id]) tags.push('같은 상품 보유');
      if (favCat === it.cat) tags.push('오늘 손님 선호');
      return `<button class="offer${hl}" data-offer="${i}">
        <span class="pic">${it.icon}</span>${miniShape(id)}
        <span class="nm">${s.offerGrade > 1 ? `${gradeLabel(s.offerGrade)} ` : ''}${it.name}</span>
        <span class="meta">${it.cells.length}칸 · 기본 ${gradeBase(id, s.offerGrade)}</span>
        <span class="eff">${effectText(id, s.offerGrade)}</span>
        ${tags.length ? `<span class="tagline">${tags.join(' · ')}</span>` : ''}</button>`;
    }).join('');
    const cost = G.rerollCost(s);
    const reroll = `<button class="btn outline small" data-act="reroll" ${s.balance < cost ? 'disabled' : ''}>다시 뽑기 ${cost === 0 ? (s.grace ? '· 유예 무료' : '· 무료') : `· 잔금 ${cost}`}</button>`;
    panel.innerHTML = (coach ? coachHTML(coach, 'down') : '') +
      `<div class="panel-head"><h3>입고 ${s.picksDone + 1} / ${s.picksDone + s.picksLeft}</h3>${reroll}</div><div class="offers">${cards}</div>`;
    return;
  }

  // 정리 단계: 잔금 사용
  const extra = G.extraCost(s);
  const expand = G.expandCost(s);
  panel.innerHTML = `<div class="done-line"><svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg>오늘 입고 완료</div>` +
    `<p class="done-sub">상품을 눌러 옮기거나 합성할 수 있어요. 남은 잔금으로 더 준비할 수도 있어요.</p>` +
    `<div class="shopbar">
      <button class="btn outline" data-act="extra" ${s.balance < extra ? 'disabled' : ''}>추가 입고<small>잔금 ${extra}</small></button>
      <button class="btn outline" data-act="expand" ${expand === null || s.balance < expand ? 'disabled' : ''}>${expand === null ? '진열대 최대' : `진열대 확장`}<small>${expand === null ? `${s.dim.cols}×${s.dim.rows}` : `잔금 ${expand} · ${s.dim.cols}×${s.dim.rows}`}</small></button>
    </div>` +
    (coach === 3 ? `<div style="margin-top:14px">${coachHTML(3, 'down')}</div>` : '');
}

function renderActions(coach) {
  $('btn-rotate').disabled = !sel;
  $('btn-undo').disabled = !G.canUndo(s);
  $('btn-skip').hidden = !(s.phase === 'pick' || s.phase === 'place');
  const main = $('btn-main');
  main.classList.remove('hl');
  let label;
  let enabled = false;
  if (ghost) {
    enabled = ghostValid();
    label = enabled ? '여기에 놓기' : '놓을 수 없는 자리';
    if (enabled && coach === 2) main.classList.add('hl');
  } else if (sel?.kind === 'hand') label = '놓을 칸을 누르세요';
  else if (G.canOpen(s)) {
    enabled = true;
    label = '영업 시작';
    if (coach === 3) main.classList.add('hl');
  } else if (s.phase === 'place') label = '새 상품을 놓아 주세요';
  else label = `입고 ${s.picksLeft}번 남음`;
  main.textContent = label;
  main.disabled = !enabled;
}

/* ---------- 계약 ---------- */

function openContracts() {
  if (!s.contractOffer) return;
  const pay = G.payFor(s);
  const sales = G.income(s).sum.total;
  $('contract-list').innerHTML = s.contractOffer.ids.map((id) => {
    const c = G.CONTRACTS[id];
    const can = G.canSign(s, id);
    // 서명했을 때 오늘 숫자가 어떻게 바뀌는지 미리 계산
    const trial = JSON.parse(JSON.stringify(s));
    trial.undo = [];
    let impact = '';
    if (G.sign(trial, id)) {
      const tPay = G.payFor(trial), tSales = G.income(trial).sum.total;
      const parts = [];
      if (tSales !== sales) parts.push(`예상 매출 ${fmt(sales)} → ${fmt(tSales)}`);
      if (tPay !== pay) parts.push(`오늘 납부 ${fmt(pay)} → ${fmt(tPay)}`);
      if (trial.balance !== s.balance) parts.push(`잔금 ${fmt(s.balance)} → ${fmt(trial.balance)}`);
      if (trial.lives !== s.lives) parts.push(`불꽃 ${s.lives} → ${trial.lives}`);
      impact = parts.length ? parts.join(' · ') : '오늘 매출·납부액 변화 없음';
    }
    const seal = id === 'seal' ? '<div class="row"><b>위치</b><span>진열대에 빨간 점선으로 표시된 3칸</span></div>' : '';
    return `<div class="contract"><h3>${c.name}</h3>
      <div class="row"><b>받는 것</b><span class="gain">${c.gain}</span></div>
      <div class="row"><b>대가</b><span class="cost">${c.cost}</span></div>${seal}
      <div class="impact">오늘 영향: ${impact}</div>
      ${can.ok ? `<button class="btn danger" data-sign="${id}">서명하기</button>` : `<p class="why">${can.why}</p>`}</div>`;
  }).join('');
  sealPreview = s.contractOffer.ids.includes('seal') ? s.contractOffer.cells : null;
  render();
  $('contract-sheet').showModal();
}

function contractInfo(id) {
  const c = G.CONTRACTS[id];
  toast(`${c.name}: ${c.gain} / 대가: ${c.cost}`);
}

/* ---------- 첫 플레이 안내 ---------- */

function coachStep() {
  if (tutorialDone() || s.day !== 1) return 0;
  if (s.picksDone === 0) return 1;
  if (s.picksDone === 1 && s.phase !== 'arrange') return 2;
  return 3;
}

/* ---------- 정산 ---------- */

function openShop() {
  if (!G.canOpen(s)) return;
  select(null);
  const ev = G.income(s);
  const pieces = s.pieces.map((p) => ({ ...p }));
  const dim = { ...s.dim };
  const balanceBefore = s.balance;
  const last = G.openShop(s);
  if (!last) return;
  if (!tutorialDone()) store.set(KEY_TUTORIAL, true);
  save();
  S.play('open_shop');
  const tops = pieces.map((p) => ({ p, r: ev.items.get(p.uid) })).sort((a, b) => b.r.total - a.r.total).slice(0, 3);
  settling = { ...last, pieces, dim, tops, balanceBefore, items: ev.items };
  showSettle();
}

function showSettle(fromSave = false) {
  if (!settling) {
    // 결산 보상 고르는 중에 새로고침한 경우
    settling = { ...s.last, pieces: s.pieces.map((p) => ({ ...p })), dim: { ...s.dim }, tops: [], balanceBefore: s.balance, items: null };
  }
  const st = settling;
  $('settle-title').textContent = `${st.day}일 차 영업 끝!`;
  staticBoard($('settle-board'), st.dim, st.pieces, (p) => `<span class="earn">+${st.perItem[p.uid] ?? 0}</span>`, 'pop');
  $('settle-board').querySelectorAll('.piece').forEach((el, i) => {
    el.querySelectorAll('.pc, .lbl').forEach((c) => { c.style.animationDelay = `${i * 0.06}s`; });
  });
  $('sum-base').textContent = fmt(st.sum.base);
  $('sum-place').textContent = `${st.sum.place >= 0 ? '+' : ''}${fmt(st.sum.place)}`;
  $('sum-customer').textContent = `+${fmt(st.sum.customer)}`;
  const cp = st.sum.contract + st.sum.perma;
  $('sum-contract').textContent = `${cp >= 0 ? '+' : ''}${fmt(cp)}`;
  $('sum-today').textContent = fmt(st.sales);
  $('sum-pay').textContent = fmt(st.pay);
  const v = $('settle-verdict');
  if (st.ok) {
    v.className = 'verdict ok';
    v.innerHTML = `납부 완료!<small>잔금 +${fmt(st.gain)} (지금 ${fmt(s.balance)})</small>`;
  } else {
    v.className = 'verdict fail';
    v.innerHTML = `납부 실패… 불꽃 하나가 꺼졌어요<small>${fmt(st.pay - st.sales)} 모자랐어요 · 남은 불꽃 ${'🔥'.repeat(Math.max(0, st.lives)) || '없음'}</small>`;
  }
  $('settle-line').textContent = st.ok
    ? (st.settle ? '결산일까지 버티다니, 제법이군. 선물을 하나 고르게.' : st.sales >= st.pay * 1.5 ? '흠, 넉넉하군. 내일은 조금 더 올려도 되겠어.' : '좋아, 받았네. 내일 또 보세.')
    : st.lives <= 0 ? '자, 열쇠를 돌려받겠네.' : '영혼 한 조각, 잘 받았네. 내일은 후보를 한 번 공짜로 다시 뽑게 해 주지.';

  const extra = $('settle-extra');
  const next = $('btn-settle-next');
  if (s.phase === 'reward') {
    extra.innerHTML = `<div class="rewards"><h3>결산 보상 고르기</h3>${s.rewardOffer.map((k) =>
      `<button class="reward" data-reward="${k}"><b>${G.REWARDS[k].name}</b><span>${G.REWARDS[k].text}</span></button>`).join('')}</div>`;
    next.hidden = true;
  } else {
    extra.innerHTML = st.tops.length ? `<h3 class="sub">오늘의 효자 상품</h3><div class="tops">${st.tops.map(({ p, r }, i) =>
      `<div><b>${i + 1} ${ITEMS[p.id].icon} ${ITEMS[p.id].name}</b>${r.base}${r.bonuses.map((b) => ` ${b.amount >= 0 ? '+' : '-'} ${b.label} ${Math.abs(b.amount)}`).join('')}</div>`).join('')}</div>` : '';
    next.hidden = false;
    next.textContent = s.phase === 'over' ? '압류 통지서 보기' : `${s.day}일 차 준비하기`;
  }
  show('settle');
  if (!fromSave) {
    st.pieces.slice(0, 16).forEach((_, i) => S.play('coin_tick', { delay: 0.35 + i * 0.06, rate: 1 + Math.min(i, 10) * 0.03 }));
    S.play(st.ok ? 'day_total' : 'discard', { delay: 0.45 + Math.min(st.pieces.length, 16) * 0.06 });
  }
}

function finishSettle() {
  if (s.phase === 'reward') return;
  settling = null;
  if (s.phase === 'over') return showResult();
  show('play');
  render();
}

/* ---------- 압류 통지서 ---------- */

function showResult() {
  const sum = G.summary(s);
  const fresh = !s.final;
  if (fresh) {
    const prevBest = bestRecord();
    const isNew = G.better({ days: sum.days, total: s.total }, prevBest);
    if (isNew) store.set(KEY_BEST, { days: sum.days, total: s.total, at: Date.now() });
    s.final = { isNew, prev: prevBest ?? null };
    save();
    S.play('grade_reveal');
  }
  $('result-days').textContent = sum.days;
  $('result-nick').textContent = `최후의 상점: ${sum.nickname}`;
  const badge = $('result-badge');
  badge.hidden = !s.final.isNew;
  if (s.final.isNew) {
    badge.textContent = s.final.prev ? `최고 기록 갱신 · 이전 ${s.final.prev.days}일` : '첫 기록';
    badge.className = 'badge-best new';
    if (fresh) { celebrate(); S.play('new_record', { delay: 1.2 }); }
  }
  const top = sum.topPiece;
  const facts = [
    ['생존 일수', `${sum.days}일`],
    ['누적 매출', fmt(s.total)],
    ['하루 최고 매출', fmt(s.bestDay)],
    ['최고 등급 상품', top ? `${gradeLabel(top.g)} ${ITEMS[top.id].name}` : '없음'],
    ['체결한 계약', `${s.signed}건`],
    ['최고 기록', `${bestRecord()?.days ?? sum.days}일`],
  ];
  $('result-facts').innerHTML = facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  staticBoard($('result-board'), s.dim, s.pieces);
  show('result');
}

function celebrate() {
  const colors = ['#7a4fd0', '#f08a3c', '#ffd36b', '#ff6b5b', '#7fd8a0'];
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
  const canvas = await drawCard({ dim: s.dim, pieces: s.pieces, days: sum.days, total: s.total, nickname: sum.nickname, url });
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
  const x = Math.floor(((ev.clientX - r.left) / r.width) * s.dim.cols);
  const y = Math.floor(((ev.clientY - r.top) / r.height) * s.dim.rows);
  return { x: Math.max(0, Math.min(s.dim.cols - 1, x)), y: Math.max(0, Math.min(s.dim.rows - 1, y)) };
}

function inPiece(p, x, y) {
  return p && cellsOf(p).some((c) => c[0] === x && c[1] === y);
}

function onTap(x, y) {
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
  setGhostAt(x, y, currentRot());
  render();
}

let drag = null;
function onPointerDown(ev) {
  if (ev.button > 0) return;
  const { x, y } = cellFromPoint(ev);
  drag = { x0: ev.clientX, y0: ev.clientY, cell: { x, y }, moved: false };
  $('board').setPointerCapture(ev.pointerId);
}
function onPointerMove(ev) {
  if (!drag) return;
  if (!drag.moved) {
    if (Math.hypot(ev.clientX - drag.x0, ev.clientY - drag.y0) < 10) return;
    const { x, y } = drag.cell;
    const g = ghostPiece();
    const occ = occupancy(s.dim, s.pieces)[y][x];
    drag.moved = true;
    if (g && inPiece(g, x, y)) {
      drag.grab = [x - g.x, y - g.y];
      drag.rot = g.rot;
    } else if (sel?.kind === 'hand') {
      drag.rot = currentRot();
      drag.grab = shapeOf(s.hand.id, drag.rot)[0];
    } else if (occ !== null) {
      if (sel?.uid !== occ) select({ kind: 'piece', uid: occ });
      const p = selectedPiece();
      drag.grab = [x - p.x, y - p.y];
      drag.rot = p.rot;
    } else { drag.dead = true; }
  }
  if (drag.dead) return;
  const { x, y } = cellFromPoint(ev);
  const before = ghost && `${ghost.x},${ghost.y},${ghost.rot}`;
  ghost = { ...clampAnchor(s.dim, selectedId(), drag.rot, x - drag.grab[0], y - drag.grab[1]), rot: drag.rot };
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
  if (!sel) return;
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
  if (sel?.kind !== 'piece') return;
  const p = selectedPiece();
  G.discard(s, p.uid);
  S.play('discard');
  select(null);
  save();
  render();
  toast(`${ITEMS[p.id].name}을(를) 버렸어요. 되돌리기로 살릴 수 있어요.`);
}

function doMerge() {
  if (!sel) return;
  const target = sel.kind === 'hand' ? 'hand' : sel.uid;
  const before = G.income(s).items;
  if (!G.merge(s, target)) return;
  S.play('combo_spark');
  S.play('item_place', { delay: 0.15 });
  if (target !== 'hand') { press = target; markSparks(before); spark.add(target); }
  resetSelection();
  if (target === 'hand' && s.phase === 'place') sel = { kind: 'hand' };
  save();
  render();
}

function act(fn) {
  if (fn(s)) { resetSelection(); save(); render(); return true; }
  return false;
}

function undo() {
  if (G.undo(s)) {
    S.play('undo');
    resetSelection();
    save();
    render();
  }
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
    const btn = e.target.closest('[data-act]');
    if (!btn || btn.disabled) return;
    const a = btn.dataset.act;
    if (a === 'deselect' || a === 'tidy') { select(null); render(); }
    if (a === 'hold') { select({ kind: 'hand' }); render(); }
    if (a === 'discard') discardSelected();
    if (a === 'merge') doMerge();
    if (a === 'reroll') act(G.reroll);
    if (a === 'extra') act(G.buyExtra);
    if (a === 'expand' && act(G.buyExpand)) toast(`진열대가 ${s.dim.cols}×${s.dim.rows}로 넓어졌어요`);
    if (a === 'contracts') openContracts();
    if (a === 'contract-info') contractInfo(btn.dataset.c);
  };
  $('panel').addEventListener('click', onAct);
  $('brief').addEventListener('click', onAct);

  $('contract-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sign]');
    if (!b) return;
    const id = b.dataset.sign;
    if (G.sign(s, id)) {
      $('contract-sheet').close();
      S.play('combo_spark');
      toast(`계약 체결: ${G.CONTRACTS[id].name}`);
      resetSelection();
      save();
      render();
    }
  });
  $('btn-refuse').onclick = () => { G.refuseContracts(s); $('contract-sheet').close(); save(); render(); };
  $('contract-sheet').addEventListener('close', () => { sealPreview = null; render(); });

  $('settle-extra').addEventListener('click', (e) => {
    const b = e.target.closest('[data-reward]');
    if (!b) return;
    G.takeReward(s, b.dataset.reward);
    S.play('combo_spark');
    settling = null;
    resetSelection();
    save();
    show('play');
    render();
  });

  $('btn-rotate').onclick = rotate;
  $('btn-undo').onclick = undo;
  $('btn-skip').onclick = () => act(G.skip);
  $('btn-main').onclick = () => { if (ghost) commit(); else openShop(); };
  $('btn-coach-skip').onclick = () => { store.set(KEY_TUTORIAL, true); render(); };
  $('btn-menu').onclick = () => $('help').showModal();
  $('btn-settle-skip').onclick = finishSettle;
  $('btn-settle-next').onclick = finishSettle;
  $('btn-new').onclick = () => {
    const run = loadRun();
    if (run && run.phase !== 'over' && !confirm('진행 중인 상점이 있어요. 새 계약서에 서명할까요?')) return;
    startNew();
  };
  $('btn-continue').onclick = resume;
  $('btn-home').onclick = () => { $('help').close(); settling = null; goStart(); };
  $('btn-again').onclick = startNew;
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
    if (on) S.play('ui_tap');
    syncSound();
  };
  $('opt-sfx').onchange = (e) => { S.setOn('sfx', e.target.checked); if (e.target.checked) S.play('ui_tap'); syncSound(); };
  $('opt-bgm').onchange = (e) => { S.setOn('bgm', e.target.checked); syncSound(); };
  syncSound();
  document.addEventListener('click', (e) => {
    const b = e.target.closest('button, a.btn');
    if (!b || b.disabled) return;
    if (b.matches('.cell, .offer, #btn-rotate, #btn-undo, #btn-main, #btn-sound, [data-act="discard"], [data-act="merge"], [data-sign], [data-reward]')) return;
    S.play('ui_tap');
  }, true);

  document.addEventListener('keydown', (e) => {
    if (document.querySelector('dialog[open]')) return;
    if (!$('screen-settle').hidden) { if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') finishSettle(); return; }
    if ($('screen-play').hidden) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
    else if (e.key === 'r' || e.key === 'R') rotate();
    else if (e.key === 'Enter' && ghost) { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { select(null); render(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') discardSelected();
  });
}

function fillHelp() {
  $('help-items').innerHTML = ITEM_IDS.map((id) => {
    const it = ITEMS[id];
    return `<div class="help-item"><div class="pic" style="font-size:32px">${it.icon} ${miniShape(id, 0, 9)}</div>
      <b>${it.name}</b><div class="meta">${CATS[it.cat].name} · ${it.cells.length}칸 · 기본 ${it.base}</div><div>${effectText(id, 1)}</div></div>`;
  }).join('');
  $('help-customers').innerHTML = Object.values(CUSTOMERS).map((c) => `<li>${c.icon} <b>${c.name}</b>: ${c.text}</li>`).join('');
}

// 시작 화면의 대표 진열대
const SAMPLE_DIM = { cols: 5, rows: 4 };
const SAMPLE = [
  ['cauldron', 0, 0, 0, 1], ['potion', 2, 0, 0, 2], ['herb', 2, 1, 0, 1], ['bow', 3, 0, 1, 1], ['whetstone', 4, 0, 0, 1],
  ['tome', 0, 2, 0, 1], ['orb', 2, 2, 0, 1], ['candle', 0, 3, 1, 1], ['doll', 2, 3, 0, 1], ['charm', 4, 1, 0, 1], ['sword', 4, 2, 0, 1],
].map(([id, x, y, rot, g], i) => ({ uid: i + 1, id, x, y, rot, g }));

fillHelp();
S.init();
bind();
staticBoard($('start-board'), SAMPLE_DIM, SAMPLE.filter((p, i, all) =>
  canPlace(SAMPLE_DIM, all.slice(0, i), p)));
goStart();
