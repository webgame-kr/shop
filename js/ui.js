// 화면: 시작·플레이·정산·결과, 선택 후 위치 누르기(끌기는 보조), 첫 플레이 안내, 저장.
import {
  COLS, ROWS, DAYS, ITEMS, ITEM_IDS, GRADES,
  shapeOf, sizeOf, cellsOf, clampAnchor, canPlace, occupancy, evaluate, dailyIncome, linksOf, gradeOf,
} from './rules.js';
import * as G from './game.js';
import { drawCard } from './card.js';

const KEY_RUN = 'small-shop:run';
const KEY_BEST = 'small-shop:best';
const KEY_TUTORIAL = 'small-shop:tutorial-done';

const $ = (id) => document.getElementById(id);
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 저장 불가 환경 */ } },
};
const img = (id) => `img/${id}.png`;

let s = null;          // 게임 상태 (저장 대상)
let sel = null;        // { kind: 'hand' } | { kind: 'piece', uid }
let ghost = null;      // { x, y, rot } 미리보기
let handRot = 0;
let spark = new Set(); // 조합이 막 생긴 상품
let press = null;      // 방금 놓은 상품
let settling = null;   // 정산 화면 정보

/* ---------- 저장 ---------- */

function save() { if (s) store.set(KEY_RUN, s); }
function loadRun() {
  // 디자인 시안에서 티셔츠가 장화로 바뀌었다
  let raw = null;
  try { raw = localStorage.getItem(KEY_RUN); } catch { return null; }
  if (!raw) return null;
  try {
    const r = JSON.parse(raw.replaceAll('"tshirt"', '"boots"'));
    return r && r.v === 1 && Array.isArray(r.pieces) ? r : null;
  } catch { return null; }
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
  if (run) cont.textContent = `이어 하기 · ${Math.min(run.day, DAYS)}일 차`;
  const best = bestRecord();
  $('start-best').innerHTML = best
    ? `개인 최고 매출 <strong>${best.total}</strong> <b>${gradeOf(best.total).name}</b>` : '';
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

function cellBox(x, y, out) {
  // 바깥쪽 면만 띄워서 같은 상품의 칸끼리는 한 덩어리로 보이게 한다
  const [t, r, b, l] = out.map((o) => (o ? GAP : '-0.5px'));
  return `left:calc(${pct(x, COLS)}% + ${l});top:calc(${pct(y, ROWS)}% + ${t});` +
    `width:calc(${pct(1, COLS)}% - ${l} - ${r});height:calc(${pct(1, ROWS)}% - ${t} - ${b})`;
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

function pieceHTML(p, { cls = '', sub = '', tag = '' } = {}) {
  const cells = cellsOf(p);
  const has = (x, y) => cells.some((c) => c[0] === x && c[1] === y);
  const it = ITEMS[p.id];
  let html = `<div class="piece ${it.light ? 'light' : ''} ${cls}" data-uid="${p.uid ?? ''}">`;
  for (const [x, y] of cells) {
    const out = [!has(x, y - 1), !has(x + 1, y), !has(x, y + 1), !has(x - 1, y)];
    const c = [];
    if (out[0] && out[3]) c.push('r-tl');
    if (out[0] && out[1]) c.push('r-tr');
    if (out[2] && out[3]) c.push('r-bl');
    if (out[2] && out[1]) c.push('r-br');
    if (out[2]) c.push('floor');
    ['o-t', 'o-r', 'o-b', 'o-l'].forEach((k, i) => { if (out[i]) c.push(k); });
    html += `<div class="pc ${c.join(' ')}" style="${cellBox(x, y, out)};background:${it.color}"></div>`;
  }
  const b = labelBox(p);
  html += `<div class="lbl" style="left:${pct(b.x, COLS)}%;top:${pct(b.y, ROWS)}%;width:${pct(b.w, COLS)}%;height:${pct(b.h, ROWS)}%">` +
    `<span class="nm">${it.name}</span>${sub}${tag}</div></div>`;
  return html;
}

function cellsHTML(interactive, ok = null) {
  let html = '';
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++) {
      const style = `left:${pct(x, COLS)}%;top:${pct(y, ROWS)}%;width:${pct(1, COLS)}%;height:${pct(1, ROWS)}%`;
      const okc = ok?.has(`${x},${y}`) ? ' ok' : '';
      html += interactive
        ? `<button class="cell${okc}" data-x="${x}" data-y="${y}" style="${style}" aria-label="${y + 1}행 ${x + 1}열"></button>`
        : `<div class="cell" style="${style}"></div>`;
    }
  return html;
}

function staticBoard(el, pieces, subOf = null, cls = '') {
  el.innerHTML = cellsHTML(false) + pieces.map((p, i) =>
    pieceHTML(p, { sub: subOf ? subOf(p, i) : '', cls })).join('');
}

/* ---------- 선택과 미리보기 ---------- */

function selectedId() {
  if (!sel) return null;
  if (sel.kind === 'hand') return s.hand?.id ?? null;
  return s.pieces.find((p) => p.uid === sel.uid)?.id ?? null;
}
function selectedPiece() {
  return sel?.kind === 'piece' ? s.pieces.find((p) => p.uid === sel.uid) : null;
}
function ignoreUid() { return sel?.kind === 'piece' ? sel.uid : undefined; }
function ghostPiece() {
  if (!ghost || !sel) return null;
  return { uid: sel.kind === 'piece' ? sel.uid : -1, id: selectedId(), ...ghost };
}
function ghostValid() {
  const g = ghostPiece();
  return !!g && canPlace(s.pieces, g, ignoreUid());
}
// 미리보기대로 놓였을 때의 진열대
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

// 선택한 상품을 지금 방향으로 놓을 수 있는 칸들 (초록 점선)
function placeableCells() {
  const id = selectedId();
  if (!id) return null;
  const rot = currentRot();
  const ok = new Set();
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++) {
      const p = { uid: ignoreUid() ?? -1, id, x, y, rot };
      if (canPlace(s.pieces, p, ignoreUid())) cellsOf(p).forEach(([cx, cy]) => ok.add(`${cx},${cy}`));
    }
  const grid = occupancy(s.pieces, ignoreUid());
  for (const k of [...ok]) { const [x, y] = k.split(',').map(Number); if (grid[y][x] !== null) ok.delete(k); }
  return ok;
}

function anyFit(id) {
  for (let rot = 0; rot < 4; rot++)
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++)
        if (canPlace(s.pieces, { uid: -1, id, x, y, rot })) return true;
  return false;
}

function setGhostAt(cx, cy, rot, grab) {
  const id = selectedId();
  // 누른 칸이 상품의 첫 칸(또는 잡은 칸)이 되도록 기준점을 정한다
  const [gx, gy] = grab ?? shapeOf(id, rot)[0];
  ghost = { ...clampAnchor(id, rot, cx - gx, cy - gy), rot };
}

function select(next) {
  sel = next;
  ghost = null;
  if (next?.kind === 'hand') handRot = s.hand.rot ?? 0;
}

function commit() {
  if (!ghostValid()) return false;
  const before = evaluate(s.pieces);
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
  press = uid;
  select(null);
  save();
  render();
  return true;
}

// 보너스가 늘어난 상품을 반짝인다
function markSparks(before) {
  const after = evaluate(s.pieces);
  spark = new Set();
  for (const [uid, r] of after) {
    const prev = before.get(uid);
    const gain = r.total - r.base;
    if (gain > 0 && (!prev || gain > prev.total - prev.base)) spark.add(uid);
  }
}

/* ---------- 플레이 화면 ---------- */

function formula(r) {
  return [`기본 ${r.base}`, ...r.bonuses.map((b) => `${b.label} ${b.amount}`)].join(' + ') + ` = 하루 ${r.total}`;
}

function render() {
  if (!s) return;
  if (s.phase === 'over') return showResult();

  const ev = evaluate(s.pieces);
  const income = dailyIncome(s.pieces);
  const prev = previewPieces();
  const prevEv = prev ? evaluate(prev) : null;
  const prevIncome = prev ? dailyIncome(prev) : null;
  const coach = coachStep();

  // 상단
  $('hud-day').textContent = `${s.day}일`;
  $('hud-dots').innerHTML = Array.from({ length: DAYS }, (_, i) =>
    `<i class="${i + 1 < s.day ? 'done' : i + 1 === s.day ? 'now' : ''}"></i>`).join('');
  $('btn-coach-skip').hidden = !coach;
  $('btn-menu').hidden = !!coach;
  $('hud-total').textContent = s.total;
  $('hud-income').textContent = `+${prevIncome ?? income}`;
  const d = $('hud-delta');
  if (prevIncome !== null && prevIncome !== income) {
    const diff = prevIncome - income;
    d.textContent = `${diff > 0 ? '▲' : '▼'}${Math.abs(diff)}`;
    d.className = diff > 0 ? 'up' : 'down';
  } else { d.textContent = ''; d.className = ''; }
  $('stat-income').classList.toggle('hl', coach === 3);

  // 진열대
  const links = sel?.kind === 'piece' && !ghost ? linksOf(s.pieces, sel.uid) : new Set();
  const g = ghostPiece();
  let html = cellsHTML(true, sel ? placeableCells() : null);
  for (const p of s.pieces) {
    const r = ev.get(p.uid);
    const cls = [];
    if (sel?.kind === 'piece' && sel.uid === p.uid) cls.push('selected', ghost ? 'lifted' : '');
    if (spark.has(p.uid)) cls.push('spark');
    if (press === p.uid) cls.push('press');
    let tag = '';
    // 미리보기로 보너스가 새로 붙는 이웃에는 주황 표시
    if (prevEv && p.uid !== g?.uid) {
      const gain = prevEv.get(p.uid).total - r.total;
      if (gain) tag = `<span class="pill-tag ${gain > 0 ? 'orange' : 'bad'}">${gain > 0 ? '+' : ''}${gain}</span>`;
    } else if (links.has(p.uid)) tag = '<span class="pill-tag orange">조합</span>';
    const sub = `<span class="per">${r.bonuses.length ? '✦ ' : ''}하루 ${r.total}</span>`;
    html += pieceHTML(p, { cls: cls.join(' '), sub, tag });
  }
  if (g) {
    const valid = ghostValid();
    const tag = valid
      ? `<span class="pill-tag">+${prevEv.get(g.uid).total}</span>`
      : '<span class="pill-tag bad">✕ 놓을 수 없음</span>';
    html += pieceHTML(g, { cls: `ghost ${valid ? 'valid' : 'invalid'}`, tag });
  }
  $('board').innerHTML = html;
  $('legend').hidden = !sel;
  spark = new Set();
  press = null;

  renderPanel(ev, prevEv, coach);
  renderActions(coach);
}

function miniShape(id, rot = 0, cell = 14) {
  const sh = shapeOf(id, rot);
  const { w, h } = sizeOf(id, rot);
  const rects = sh.map(([x, y]) =>
    `<rect x="${x * cell + 1}" y="${y * cell + 1}" width="${cell - 3}" height="${cell - 3}" rx="3" fill="${ITEMS[id].color}"/>`).join('');
  return `<svg class="mini" style="width:${w * cell}px;height:${h * cell}px;stroke:none" viewBox="0 0 ${w * cell} ${h * cell}" aria-hidden="true">${rects}</svg>`;
}

function coachHTML(step, dir) {
  const t = {
    1: ['상품을 하나 골라 진열대에 놓아 보세요', '상품을 누른 뒤, 놓고 싶은 칸을 누르면 돼요.'],
    2: ['어울리는 상품을 붙여 놓으면 보너스!', '빵은 우유 옆에서 +3, 우유는 빵 옆에서 +2. 상하좌우로 맞닿아야 해요. 대각선은 안 돼요.'],
    3: ['예상 수익을 확인하고 영업을 시작해요', '놓은 상품은 다음 날에도 남아서 매일 수익을 내요. 규칙은 메뉴의 도움말에서 다시 볼 수 있어요.'],
  }[step];
  return `<div class="coach ${dir}"><div class="step">안내 ${step} / 3</div><div class="ttl">${t[0]}</div><p class="body">${t[1]}</p></div>`;
}

function infoHTML(id, { acts = '', chips = '', formulaHTML = '', hint = '', warn = false }) {
  const it = ITEMS[id];
  return `<div class="card info">
    <div class="head"><div class="thumb"><img src="${img(id)}" alt=""></div>
      <div><div class="nm">${it.name}</div><div class="meta">${it.size} · 기본 수익 ${it.base} / 일</div></div>
      <div class="acts">${acts}</div></div>
    <p class="eff">${it.effect}</p>
    ${chips ? `<div class="chips">${chips}</div>` : ''}
    ${formulaHTML ? `<div class="formula">${formulaHTML}</div>` : ''}
    ${hint ? `<p class="hint${warn ? ' warn' : ''}">${hint}</p>` : ''}
  </div>`;
}

// 보너스를 주고받는 이웃을 칩으로 보여준다
function chipsFor(pieces, ev, uid) {
  const r = ev.get(uid);
  if (!r) return '';
  const from = new Set(r.bonuses.flatMap((b) => b.from));
  const byUid = new Map(pieces.map((p) => [p.uid, p]));
  const names = [...new Set([...from].map((u) => ITEMS[byUid.get(u).id].name))];
  if (!names.length) return '';
  const total = r.bonuses.reduce((a, b) => a + b.amount, 0);
  return names.map((n) => `<span class="chip">${n}</span>`).join('') + `<span class="ok-mark">✓ 보너스 +${total}</span>`;
}

function renderPanel(ev, prevEv, coach) {
  const panel = $('panel');

  if (sel?.kind === 'piece') {
    const p = selectedPiece();
    const now = ev.get(p.uid);
    let f = formula(now);
    let hint = '옮길 칸을 누르거나 끌어 보세요. 회전도 미리 볼 수 있어요.';
    let warn = false;
    let chips = chipsFor(s.pieces, ev, p.uid);
    if (ghost) {
      if (prevEv) {
        const r = prevEv.get(p.uid);
        const diff = dailyIncome(previewPieces()) - dailyIncome(s.pieces);
        f += `<span class="after${diff < 0 ? ' down' : ''}">옮기면 ${formula(r)} · 전체 ${diff >= 0 ? '+' : ''}${diff}</span>`;
        chips = chipsFor(previewPieces(), prevEv, p.uid);
        hint = '';
      } else { hint = '다른 상품과 겹쳐서 놓을 수 없어요.'; warn = true; }
    }
    const acts = `<button class="mini-btn" data-act="discard">버리기</button><button class="mini-btn" data-act="deselect">닫기</button>`;
    panel.innerHTML = infoHTML(p.id, { acts, chips, formulaHTML: f, hint, warn });
    return;
  }

  if (s.phase === 'place' && s.hand) {
    const id = s.hand.id;
    if (!sel) {
      const acts = `<button class="mini-btn" data-act="hold">새 상품 들기</button>`;
      panel.innerHTML = infoHTML(id, { acts, hint: '진열대 정리 중이에요. 상품을 눌러 옮기거나 버린 뒤 [새 상품 들기]를 누르세요.' });
      return;
    }
    let f = '';
    let chips = '';
    let hint = '진열대에서 놓을 칸을 누르세요.';
    let warn = false;
    if (ghost) {
      if (prevEv) {
        const r = prevEv.get(-1);
        f = formula(r);
        chips = chipsFor(previewPieces(), prevEv, -1);
        hint = '';
      } else { hint = '다른 상품과 겹쳐서 놓을 수 없어요. 빗금 칸을 피해 보세요.'; warn = true; }
    } else if (!anyFit(id)) {
      hint = '놓을 자리가 없어요. [진열대 정리]로 옮기거나 버리고, 아니면 → 버튼으로 넘겨요.';
      warn = true;
    }
    const acts = `<button class="mini-btn" data-act="tidy">진열대 정리</button>`;
    panel.innerHTML = (coach ? coachHTML(coach, 'up') : '') + infoHTML(id, { acts, chips, formulaHTML: f, hint, warn });
    return;
  }

  if (s.phase === 'pick') {
    const cards = s.offers.map((id, i) => {
      const it = ITEMS[id];
      const hl = coach === 1 && id === 'bread' ? ' hl' : '';
      return `<button class="offer${hl}" data-offer="${i}">${miniShape(id)}
        <span class="nm">${it.name}</span><span class="meta">${it.size} · 기본 ${it.base}</span>
        <span class="eff">${it.effect}</span></button>`;
    }).join('');
    panel.innerHTML = (coach ? coachHTML(coach, 'down') : '') +
      `<div class="panel-head"><h3>오늘의 상품 고르기</h3><span>${s.pick + 1} / 2</span></div><div class="offers">${cards}</div>`;
    return;
  }

  // 정리 단계
  panel.innerHTML = `<div class="done-line"><svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg>오늘 상품 고르기 완료 · 2 / 2</div>` +
    `<p class="done-sub">상품을 눌러 옮기거나 돌려 조합을 다듬을 수 있어요.</p>` +
    (coach === 3 ? `<div style="margin-top:14px">${coachHTML(3, 'down')}</div>` : '');
}

function renderActions(coach) {
  $('btn-rotate').disabled = !sel;
  $('btn-undo').disabled = !G.canUndo(s);
  const skip = $('btn-skip');
  skip.hidden = !(s.phase === 'pick' || s.phase === 'place');
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
  else label = `상품 ${2 - s.pick}개를 고르면 영업 시작`;
  main.textContent = label;
  main.disabled = !enabled;
}

/* ---------- 첫 플레이 안내 ---------- */

function coachStep() {
  if (tutorialDone() || s.day !== 1) return 0;
  if (s.pick === 0) return 1;
  if (s.pick === 1) return 2;
  return 3;
}

/* ---------- 정산 ---------- */

function openShop() {
  if (!G.canOpen(s)) return;
  select(null);
  const ev = evaluate(s.pieces);
  const pieces = s.pieces.map((p) => ({ ...p }));
  const from = s.total;
  const last = G.openShop(s);
  if (!last) return;
  if (!tutorialDone()) store.set(KEY_TUTORIAL, true);
  save();
  let base = 0;
  for (const r of ev.values()) base += r.base;
  const tops = pieces.map((p) => ({ p, r: ev.get(p.uid) })).sort((a, b) => b.r.total - a.r.total).slice(0, 3);
  settling = { ...last, base, bonus: last.income - base, from, to: s.total, pieces, ev, tops };
  showSettle();
}

function showSettle() {
  const st = settling;
  $('settle-title').textContent = `${st.day}일 차 영업 끝!`;
  staticBoard($('settle-board'), st.pieces,
    (p) => `<span class="earn">+${st.perItem[p.uid] ?? 0}</span>`, 'pop');
  // 상품이 하나씩 떠오르도록
  $('settle-board').querySelectorAll('.piece').forEach((el, i) => {
    el.querySelectorAll('.pc, .lbl').forEach((c) => { c.style.animationDelay = `${i * 0.06}s`; });
  });
  $('sum-base').textContent = st.base;
  $('sum-bonus').textContent = `+${st.bonus}`;
  $('sum-today').textContent = `+${st.income}`;
  $('sum-from').textContent = st.from;
  $('sum-to').textContent = st.from;
  $('settle-tops').innerHTML = st.tops.map(({ p, r }, i) =>
    `<div><b>${i + 1} ${ITEMS[p.id].name}</b>${r.base}${r.bonuses.map((b) => ` + ${b.label} ${b.amount}`).join('')}</div>`).join('');
  $('btn-settle-next').textContent = s.phase === 'over' ? '결과 보기' : `${s.day}일 차로 넘어가기`;
  show('settle');
  const t0 = performance.now();
  const step = (t) => {
    if (settling !== st) return;
    const k = Math.min(1, (t - t0) / 900);
    $('sum-to').textContent = Math.round(st.from + (st.to - st.from) * k);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function finishSettle() {
  settling = null;
  if (s.phase === 'over') return showResult();
  show('play');
  render();
}

/* ---------- 결과 ---------- */

function showResult() {
  // 결과 확정은 한 번만: 최고 기록 갱신 여부를 상태에 남긴다
  if (!s.final) {
    const prevBest = bestRecord();
    const isNew = !prevBest || s.total > prevBest.total;
    if (isNew) store.set(KEY_BEST, { total: s.total, grade: gradeOf(s.total).name, at: Date.now() });
    s.final = { isNew, prevBest: prevBest?.total ?? null };
    save();
  }
  const sum = G.summary(s);
  $('result-total').textContent = s.total;
  $('result-grade').textContent = sum.grade.name;
  const badge = $('result-badge');
  badge.hidden = false;
  badge.className = 'badge-best';
  if (s.final.isNew) {
    badge.textContent = s.final.prevBest === null ? '첫 기록' : `최고 기록 갱신 · 이전 ${s.final.prevBest}`;
    badge.classList.add('new');
    celebrate();
  } else {
    badge.textContent = `개인 최고 ${bestRecord()?.total ?? s.total}`;
    badge.style.background = 'var(--muted)';
  }
  if (s.final.isNew) badge.style.background = '';

  // 등급 구간 막대: 첫 등급 기준 ~ 마지막 등급 기준
  const marks = GRADES.filter((g) => g.min > 0).slice().reverse();
  const lo = marks[0].min, hi = marks[marks.length - 1].min;
  const pos = (v) => Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
  $('result-labels').innerHTML = marks.map((g, i) => {
    const align = i === 0 ? 'left:0' : i === marks.length - 1 ? 'right:0' : `left:${pos(g.min) * 100}%;transform:translateX(-50%)`;
    return `<span class="${s.total >= g.min ? 'reached' : ''}" style="${align}">${g.min} ${g.short}</span>`;
  }).join('');
  $('result-fill').style.width = '0';
  requestAnimationFrame(() => requestAnimationFrame(() => { $('result-fill').style.width = `${pos(s.total) * 100}%`; }));
  const next = marks.find((g) => s.total < g.min);
  $('result-next').innerHTML = next ? `${next.name}까지 <b>${next.min - s.total}</b> 남았어요` : '최고 등급 달성!';

  staticBoard($('result-board'), s.pieces);
  const topEl = $('result-top');
  if (sum.top) {
    const p = s.pieces.find((q) => q.id === sum.top.id && (s.earned[q.uid] ?? 0) === sum.top.earned);
    const r = evaluate(s.pieces).get(p.uid);
    const with_ = r.bonuses.length ? `${r.bonuses.map((b) => b.label).join('·')} 덕분에 ` : '';
    topEl.innerHTML = `<div class="thumb"><img src="${img(p.id)}" alt=""></div>
      <div><div class="k">가장 많이 번 상품 · 8일간 ${sum.top.earned}</div><div class="v">${sum.top.name} · ${with_}하루 ${r.total}</div></div>`;
    topEl.hidden = false;
  } else topEl.hidden = true;
  show('result');
}

function celebrate() {
  const colors = ['#2f6b4f', '#e07b39', '#f2c14e', '#e57373', '#6ea3c8'];
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
  const canvas = await drawCard({ pieces: s.pieces, total: s.total, grade: G.summary(s).grade.name, url });
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  const href = URL.createObjectURL(blob);
  $('card-img').src = href;
  const a = $('card-download');
  a.href = href;
  a.download = `small-shop-${s.total}.png`;
  $('card-dialog').showModal();
}

/* ---------- 입력 ---------- */

function cellFromPoint(ev) {
  const r = $('board').getBoundingClientRect();
  const x = Math.floor(((ev.clientX - r.left) / r.width) * COLS);
  const y = Math.floor(((ev.clientY - r.top) / r.height) * ROWS);
  return { x: Math.max(0, Math.min(COLS - 1, x)), y: Math.max(0, Math.min(ROWS - 1, y)) };
}

function inPiece(p, x, y) {
  return p && cellsOf(p).some((c) => c[0] === x && c[1] === y);
}

function onTap(x, y) {
  const occ = occupancy(s.pieces)[y][x];
  if (!sel) {
    if (occ !== null) select({ kind: 'piece', uid: occ });
    else if (s.phase === 'place') { select({ kind: 'hand' }); setGhostAt(x, y, handRot); }
    return render();
  }
  if (ghost && inPiece(ghostPiece(), x, y)) {
    if (ghostValid()) commit();
    else toast('다른 상품과 겹쳐서 놓을 수 없어요');
    return;
  }
  if (sel.kind === 'piece' && !ghost) {
    if (occ === sel.uid) { select(null); return render(); }
    if (occ !== null) { select({ kind: 'piece', uid: occ }); return render(); }
  }
  setGhostAt(x, y, currentRot());
  render();
}

// 끌기: 선택한 상품(또는 미리보기)을 잡아 움직이고, 놓을 수 있는 곳에서 떼면 확정
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
    const occ = occupancy(s.pieces)[y][x];
    drag.moved = true;
    if (g && inPiece(g, x, y)) {
      drag.grab = [x - g.x, y - g.y];
      drag.rot = g.rot;
    } else if (sel?.kind === 'hand') {
      // 새 상품은 빈 곳에서 끌어도 손가락을 따라온다
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
  ghost = { ...clampAnchor(selectedId(), drag.rot, x - drag.grab[0], y - drag.grab[1]), rot: drag.rot };
  if (`${ghost.x},${ghost.y},${ghost.rot}` !== before) render();
}
function onPointerUp() {
  if (!drag) return;
  const d = drag;
  drag = null;
  if (!d.moved) return onTap(d.cell.x, d.cell.y);
  if (d.dead) return;
  if (ghostValid()) commit();
  else render();
}

function rotate() {
  if (!sel) return;
  if (sel.kind === 'hand' && !ghost) {
    handRot = (handRot + 1) % 4;
    s.hand.rot = handRot;
    save();
    return render();
  }
  const base = ghost ?? selectedPiece();
  const rot = (base.rot + 1) % 4;
  ghost = { ...clampAnchor(selectedId(), rot, base.x, base.y), rot };
  render();
}

function discardSelected() {
  if (sel?.kind !== 'piece') return;
  const p = selectedPiece();
  G.discard(s, p.uid);
  select(null);
  save();
  render();
  toast(`${ITEMS[p.id].name}을(를) 버렸어요. 되돌리기로 살릴 수 있어요.`);
}

function skip() {
  G.skip(s);
  resetSelection();
  save();
  render();
}

function undo() {
  if (G.undo(s)) {
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
  toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
}

function bind() {
  const board = $('board');
  board.addEventListener('pointerdown', onPointerDown);
  board.addEventListener('pointermove', onPointerMove);
  board.addEventListener('pointerup', onPointerUp);
  board.addEventListener('pointercancel', () => { drag = null; });
  // 키보드로 칸을 누를 때
  board.addEventListener('click', (e) => {
    if (e.detail !== 0) return;
    const c = e.target.closest('.cell');
    if (c) onTap(+c.dataset.x, +c.dataset.y);
  });

  $('panel').addEventListener('click', (e) => {
    const offer = e.target.closest('[data-offer]');
    if (offer) {
      G.choose(s, +offer.dataset.offer);
      select({ kind: 'hand' });
      save();
      return render();
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'deselect' || act === 'tidy') { select(null); render(); }
    if (act === 'hold') { select({ kind: 'hand' }); render(); }
    if (act === 'discard') discardSelected();
  });

  $('btn-rotate').onclick = rotate;
  $('btn-undo').onclick = undo;
  $('btn-skip').onclick = skip;
  $('btn-main').onclick = () => { if (ghost) commit(); else openShop(); };
  $('btn-coach-skip').onclick = () => { store.set(KEY_TUTORIAL, true); render(); };
  $('btn-menu').onclick = () => $('help').showModal();
  $('btn-settle-skip').onclick = finishSettle;
  $('btn-settle-next').onclick = finishSettle;
  $('btn-new').onclick = () => {
    const run = loadRun();
    if (run && run.phase !== 'over' && !confirm('진행 중인 상점이 있어요. 새로 시작할까요?')) return;
    startNew();
  };
  $('btn-continue').onclick = resume;
  $('btn-home').onclick = () => { $('help').close(); settling = null; goStart(); };
  $('btn-again').onclick = startNew;
  $('btn-result-home').onclick = goStart;
  $('btn-card').onclick = saveCard;
  document.querySelectorAll('[data-open-help]').forEach((b) => { b.onclick = () => $('help').showModal(); });

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
    return `<div class="help-item"><div class="pic"><img src="${img(id)}" alt=""></div>
      <b>${it.name}</b><div class="meta">${it.cat} · ${it.size} · 기본 ${it.base}</div><div>${it.effect}</div></div>`;
  }).join('');
  $('help-grades').innerHTML = GRADES.slice().reverse().map((g, i, arr) =>
    `<li>${g.min === 0 ? `${arr[1].min} 미만` : `${g.min} 이상`}: ${g.name}</li>`).join('');
}

// 시작 화면의 대표 진열대 (디자인 시안과 같은 배치)
const SAMPLE = [
  ['fridge', 0, 0, 0], ['milk', 2, 0, 0], ['bread', 3, 0, 0], ['apple', 5, 0, 0],
  ['sign', 3, 1, 0], ['apple', 5, 1, 0], ['fish', 0, 2, 0], ['safe', 5, 2, 0],
  ['boots', 0, 3, 0], ['perfume', 1, 3, 0], ['plant', 2, 3, 0], ['jewel', 3, 3, 0],
].map(([id, x, y, rot], i) => ({ uid: i + 1, id, x, y, rot }));

fillHelp();
bind();
staticBoard($('start-board'), SAMPLE);
goStart();
