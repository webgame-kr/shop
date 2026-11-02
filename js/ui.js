// 화면: 시작·플레이·결과, 선택 후 위치 누르기(끌기는 보조), 정산 연출, 저장.
import {
  COLS, ROWS, DAYS, ITEMS, ITEM_IDS, GRADES,
  shapeOf, sizeOf, cellsOf, clampAnchor, canPlace, occupancy, evaluate, dailyIncome, linksOf, breakdownText,
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

let s = null;          // 게임 상태 (저장 대상)
let sel = null;        // { kind: 'hand' } | { kind: 'piece', uid }
let ghost = null;      // { x, y, rot } 미리보기
let handRot = 0;
let spark = new Set(); // 조합이 막 생긴 상품
let press = null;      // 방금 놓은 상품
let settling = null;   // 정산 연출 중 정보

/* ---------- 저장 ---------- */

function save() { if (s) store.set(KEY_RUN, s); }
function loadRun() {
  const r = store.get(KEY_RUN);
  return r && r.v === 1 && Array.isArray(r.pieces) ? r : null;
}
const bestRecord = () => store.get(KEY_BEST);
const tutorialDone = () => store.get(KEY_TUTORIAL) === true;

/* ---------- 화면 전환 ---------- */

function show(name) {
  for (const id of ['start', 'play', 'result']) $(`screen-${id}`).hidden = id !== name;
  window.scrollTo(0, 0);
}

function goStart() {
  const run = loadRun();
  $('btn-continue').hidden = !(run && run.phase !== 'over');
  const best = bestRecord();
  $('start-best').textContent = best ? `개인 최고 매출 ${best.total} · ${best.grade}` : '';
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

function cellRect(x, y, sides) {
  // sides: 바깥쪽 면이면 3px 띄운다 → 같은 상품의 칸끼리는 붙어 보인다
  // 안쪽 면은 반 픽셀 겹쳐 소수점 반올림으로 생기는 틈을 막는다
  const g = 3;
  const [t, r, b, l] = sides.map((o) => (o ? g : -0.5));
  return `left:calc(${pct(x, COLS)}% + ${l}px);top:calc(${pct(y, ROWS)}% + ${t}px);` +
    `width:calc(${pct(1, COLS)}% - ${l + r}px);height:calc(${pct(1, ROWS)}% - ${t + b}px)`;
}

function pieceHTML(p, { cls = '', badge = null, bonus = false, tag = '', extra = '' } = {}) {
  const cells = cellsOf(p);
  const has = (x, y) => cells.some((c) => c[0] === x && c[1] === y);
  const color = ITEMS[p.id].color;
  let html = `<div class="piece ${cls}" data-uid="${p.uid ?? ''}">`;
  for (const [x, y] of cells) {
    const out = [!has(x, y - 1), !has(x + 1, y), !has(x, y + 1), !has(x - 1, y)];
    const c = ['bt', 'br', 'bb', 'bl'].filter((_, i) => out[i]);
    if (out[0] && out[3]) c.push('rtl');
    if (out[0] && out[1]) c.push('rtr');
    if (out[2] && out[3]) c.push('rbl');
    if (out[2] && out[1]) c.push('rbr');
    html += `<div class="pc ${c.join(' ')}" style="${cellRect(x, y, out)};background:${color}"></div>`;
  }
  // 이름표: 네모난 상품은 전체 가운데, 꺾인 상품은 무게중심에 가까운 칸
  const { w, h } = sizeOf(p.id, p.rot);
  let box;
  if (cells.length === w * h) box = { x: p.x, y: p.y, w, h };
  else {
    const cx = cells.reduce((a, c) => a + c[0], 0) / cells.length;
    const cy = cells.reduce((a, c) => a + c[1], 0) / cells.length;
    const [bx, by] = cells.reduce((best, c) =>
      Math.hypot(c[0] - cx, c[1] - cy) < Math.hypot(best[0] - cx, best[1] - cy) ? c : best);
    box = { x: bx, y: by, w: 1, h: 1 };
  }
  const style = `left:${pct(box.x, COLS)}%;top:${pct(box.y, ROWS)}%;width:${pct(box.w, COLS)}%;height:${pct(box.h, ROWS)}%`;
  html += `<div class="lbl" style="${style}"><span class="ico">${ITEMS[p.id].icon}</span><span class="nm">${ITEMS[p.id].name}</span>`;
  if (badge !== null) html += `<span class="badge${bonus ? ' bonus' : ''}" aria-label="하루 ${badge}">${badge}</span>`;
  if (tag) html += `<span class="tag">${tag}</span>`;
  html += `${extra}</div></div>`;
  return html;
}

function cellsHTML(interactive) {
  let html = '';
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++) {
      const edge = x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1 ? ' edge' : '';
      const style = `left:${pct(x, COLS)}%;top:${pct(y, ROWS)}%;width:${pct(1, COLS)}%;height:${pct(1, ROWS)}%`;
      html += interactive
        ? `<button class="cell${edge}" data-x="${x}" data-y="${y}" style="${style}" aria-label="${y + 1}행 ${x + 1}열"></button>`
        : `<div class="cell${edge}" style="${style}"></div>`;
    }
  return html;
}

function staticBoard(el, pieces) {
  const ev = evaluate(pieces);
  el.innerHTML = cellsHTML(false) + pieces.map((p) => {
    const r = ev.get(p.uid);
    return pieceHTML(p, { badge: r.total, bonus: r.bonuses.length > 0 });
  }).join('');
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
function ghostPiece() {
  if (!ghost || !sel) return null;
  return { uid: sel.kind === 'piece' ? sel.uid : -1, id: selectedId(), ...ghost };
}
function ghostValid() {
  const g = ghostPiece();
  return !!g && canPlace(s.pieces, g, sel.kind === 'piece' ? sel.uid : undefined);
}
// 미리보기대로 놓였을 때의 진열대
function previewPieces() {
  const g = ghostPiece();
  if (!g || !ghostValid()) return null;
  if (sel.kind === 'hand') return [...s.pieces, g];
  return s.pieces.map((p) => (p.uid === g.uid ? g : p));
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

function render() {
  if (!s) return;
  if (s.phase === 'over' && !settling) return showResult();

  const ev = evaluate(s.pieces);
  const income = dailyIncome(s.pieces);
  const prev = previewPieces();
  const prevIncome = prev ? dailyIncome(prev) : null;

  // HUD
  $('hud-day').textContent = `${Math.min(s.day, DAYS)}일`;
  $('hud-total').textContent = settling ? settling.shownTotal : s.total;
  $('hud-income').textContent = income;
  const d = $('hud-delta');
  if (prevIncome !== null && prevIncome !== income) {
    const diff = prevIncome - income;
    d.textContent = `→ ${prevIncome} (${diff > 0 ? '+' : ''}${diff})`;
    d.className = diff > 0 ? 'up' : 'down';
  } else if (prevIncome !== null) {
    d.textContent = `→ ${prevIncome} (그대로)`;
    d.className = '';
  } else { d.textContent = ''; d.className = ''; }

  // 진열대
  const board = $('board');
  const links = sel?.kind === 'piece' ? linksOf(s.pieces, sel.uid) : new Set();
  const handLinks = new Set();
  if (prev && sel?.kind === 'hand') linksOf(prev, -1).forEach((u) => handLinks.add(u));
  let html = cellsHTML(true);
  for (const p of s.pieces) {
    const r = ev.get(p.uid);
    const cls = [];
    if (sel?.kind === 'piece' && sel.uid === p.uid) cls.push('selected', ghost ? 'lifted' : '');
    if (links.has(p.uid) || handLinks.has(p.uid)) cls.push('linked');
    if (spark.has(p.uid)) cls.push('spark');
    if (press === p.uid) cls.push('press');
    let extra = '';
    if (settling) extra = `<span class="float">+${settling.perItem[p.uid] ?? 0}</span>`;
    html += pieceHTML(p, { cls: cls.join(' '), badge: r.total, bonus: r.bonuses.length > 0, extra });
  }
  const g = ghostPiece();
  if (g) {
    const valid = ghostValid();
    let tag = '놓을 수 없음 ✕';
    let badge = null;
    if (valid) {
      const r = evaluate(prev).get(g.uid);
      badge = r.total;
      tag = `여기에 놓기 · 하루 ${r.total}`;
    }
    html += pieceHTML(g, { cls: `ghost ${valid ? 'valid' : 'invalid'}`, badge, bonus: valid && badge > ITEMS[g.id].base, tag });
  }
  board.innerHTML = html;
  spark = new Set();
  press = null;

  renderPanel(ev, prev);
  renderActions();
  renderCoach();
}

function miniShape(id, rot = 0, cell = 14) {
  const sh = shapeOf(id, rot);
  const { w, h } = sizeOf(id, rot);
  const rects = sh.map(([x, y]) =>
    `<rect x="${x * cell + 1}" y="${y * cell + 1}" width="${cell - 2}" height="${cell - 2}" rx="3" fill="${ITEMS[id].color}" stroke="#3b2a1c" stroke-width="1.5"/>`).join('');
  return `<svg class="mini" width="${w * cell}" height="${h * cell}" viewBox="0 0 ${w * cell} ${h * cell}" aria-hidden="true">${rects}</svg>`;
}

function infoHTML(id, rot, { title, actions = '', calc = '', hint = '', warn = false }) {
  const it = ITEMS[id];
  return `<div class="info">
    <div class="head"><span style="font-size:24px">${it.icon}</span><span class="nm">${title ?? it.name}</span>${actions}</div>
    <div>${miniShape(id, rot, 16)}</div>
    <div class="eff"><b>기본 ${it.base}/일</b><br>${it.effect}</div>
    ${calc ? `<div class="calc">${calc}</div>` : ''}
    ${hint ? `<p class="hint${warn ? ' warn' : ''}">${hint}</p>` : ''}
  </div>`;
}

function renderPanel(ev, prev) {
  const panel = $('panel');
  const closeBtn = `<button class="icon-btn" data-act="deselect" aria-label="선택 해제">✕</button>`;

  if (sel?.kind === 'piece') {
    const p = selectedPiece();
    const now = ev.get(p.uid);
    let calc = breakdownText(p.id, now);
    let hint = '옮길 칸을 누르거나 끌어 보세요. 회전도 미리 볼 수 있어요.';
    let warn = false;
    if (ghost) {
      if (prev) {
        const r = evaluate(prev).get(p.uid);
        const diff = dailyIncome(prev) - dailyIncome(s.pieces);
        calc += `<span class="new${diff < 0 ? ' down' : ''}">옮기면 → ${breakdownText(p.id, r)} · 전체 ${diff >= 0 ? '+' : ''}${diff}</span>`;
        hint = '미리보기를 한 번 더 누르거나 [놓기]로 확정해요.';
      } else { hint = '다른 상품과 겹쳐서 놓을 수 없어요.'; warn = true; }
    }
    const actions = `<button class="btn small" data-act="discard">버리기</button>${closeBtn}`;
    panel.innerHTML = infoHTML(p.id, ghost?.rot ?? p.rot, { actions, calc, hint, warn });
    return;
  }

  if (s.phase === 'place' && s.hand) {
    const id = s.hand.id;
    const rot = ghost?.rot ?? handRot;
    let calc = '';
    let hint = '진열대에서 놓을 칸을 누르세요.';
    let warn = false;
    if (!sel) {
      // 새 상품을 잠시 내려두고 진열대를 정리하는 중
      const actions = `<button class="btn small primary" data-act="hold">새 상품 들기</button><button class="btn small" data-act="skip">받지 않기</button>`;
      panel.innerHTML = `<h3>${pickLabel()} · 진열대 정리 중</h3>` +
        infoHTML(id, rot, { actions, hint: '진열대의 상품을 눌러 옮기거나 버릴 수 있어요. 정리가 끝나면 [새 상품 들기].' });
      return;
    }
    if (ghost) {
      if (prev) {
        const r = evaluate(prev).get(-1);
        const diff = dailyIncome(prev) - dailyIncome(s.pieces);
        calc = `${breakdownText(id, r)}<span class="new">전체 일 수익 +${diff}</span>`;
        hint = '미리보기를 한 번 더 누르거나 [놓기]로 확정해요.';
      } else { hint = '다른 상품과 겹쳐서 놓을 수 없어요. 빗금 칸을 피해 보세요.'; warn = true; }
    } else if (!anyFit(id)) {
      hint = '놓을 자리가 없어요. 기존 상품을 옮기거나 버리거나, 이번 상품을 받지 않을 수 있어요.';
      warn = true;
    }
    const actions = `<button class="btn small" data-act="tidy">진열대 정리</button><button class="btn small" data-act="skip">받지 않기</button>`;
    panel.innerHTML = `<h3>${pickLabel()} · 새 상품</h3>` +
      infoHTML(id, rot, { actions, calc, hint, warn });
    return;
  }

  if (s.phase === 'pick') {
    const cards = s.offers.map((id, i) => {
      const it = ITEMS[id];
      return `<button class="offer" data-offer="${i}">
        <span style="font-size:26px">${it.icon}</span>${miniShape(id)}
        <span class="nm">${it.name}</span><span class="base">기본 ${it.base}/일</span>
        <span class="eff">${it.effect}</span></button>`;
    }).join('');
    panel.innerHTML = `<h3><span>${pickLabel()} · 하나를 고르세요</span><button class="btn small" data-act="skip">받지 않기</button></h3><div class="offers">${cards}</div>`;
    return;
  }

  // 정리 단계
  const top = [...ev.entries()].sort((a, b) => b[1].total - a[1].total)[0];
  panel.innerHTML = `<p class="idle">오늘 상품을 모두 골랐어요. 상품을 눌러 옮기거나 돌려 조합을 다듬고, 준비되면 <b>영업 시작</b>을 누르세요.` +
    (top ? `<br>지금 가장 잘 버는 상품: ${ITEMS[s.pieces.find((p) => p.uid === top[0]).id].name} 하루 ${top[1].total}` : '') + `</p>`;
}

function pickLabel() {
  return `${s.day}일차 ${Math.min(s.pick + 1, 2)}/2번째 선택`;
}

function renderActions() {
  const has = !!sel;
  $('btn-rotate').disabled = !has || !!settling;
  $('btn-undo').disabled = !G.canUndo(s) || !!settling;
  $('btn-place').disabled = !ghostValid() || !!settling;
  $('btn-open').disabled = !G.canOpen(s) || !!settling;
  $('btn-open-label').textContent = G.canOpen(s)
    ? `영업 시작 +${dailyIncome(s.pieces)}`
    : `선택 ${2 - Math.min(s.pick, 2)}번 남음`;
}

/* ---------- 첫 플레이 안내 ---------- */

function coachStep() {
  if (tutorialDone() || s.day !== 1) return 0;
  if (s.pick === 0) return 1;
  if (s.pick === 1) return 2;
  return 3;
}

function renderCoach() {
  const step = coachStep();
  const el = $('coach');
  el.hidden = step === 0;
  if (!step) return;
  const text = {
    1: '상품 하나를 고른 뒤, 진열대에서 놓을 칸을 누르고 미리보기를 한 번 더 눌러 놓아 보세요.',
    2: '하나 더 골라 보세요. 빵과 우유처럼 맞닿으면 ✦ 보너스가 붙어요. 미리보기에서 수익 변화를 확인할 수 있어요.',
    3: '위의 <b>예상 일 수익</b>을 확인하고 <b>영업 시작</b>을 눌러요. 상품은 다음 날에도 계속 팔려요.',
  }[step];
  el.innerHTML = `<p><span class="step">${step}/3</span> ${text}</p><button class="link" data-act="coach-off">안내 끄기</button>`;
}

/* ---------- 정산 ---------- */

function openShop() {
  if (!G.canOpen(s) || settling) return;
  select(null);
  const before = s.total;
  const last = G.openShop(s);
  if (!last) return;
  if (!tutorialDone()) store.set(KEY_TUTORIAL, true);
  save();
  settling = { ...last, shownTotal: before, from: before };
  render();
  $('settle-day').textContent = `${last.day}일차 영업 결과`;
  $('settle-income').textContent = `+${last.income}`;
  $('settle-total').textContent = `누적 매출 ${before} → ${s.total}`;
  // 각 상품 위 수익이 떠오른 뒤 요약 상자가 뜬다. 어디든 누르면 바로 넘어간다.
  $('settle').hidden = false;
  const t0 = performance.now();
  const step = (t) => {
    if (!settling) return;
    const k = Math.min(1, (t - t0) / 900);
    settling.shownTotal = Math.round(before + (s.total - before) * k);
    $('hud-total').textContent = settling.shownTotal;
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function finishSettle() {
  if (!settling) return;
  settling = null;
  $('settle').hidden = true;
  if (s.phase === 'over') showResult();
  else render();
}

/* ---------- 결과 ---------- */

function showResult() {
  const sum = G.summary(s);
  // 결과 확정은 한 번만: 최고 기록 갱신 여부를 상태에 남긴다
  if (!s.final) {
    const prevBest = bestRecord();
    const isNew = !prevBest || s.total > prevBest.total;
    if (isNew) store.set(KEY_BEST, { total: s.total, grade: sum.grade.name, at: Date.now() });
    s.final = { isNew, prevBest: prevBest?.total ?? null };
    save();
  }
  $('result-grade').textContent = sum.grade.name;
  $('result-total').textContent = s.total;
  const bestEl = $('result-best');
  if (s.final.isNew) {
    bestEl.textContent = s.final.prevBest === null ? '첫 기록이에요!' : `최고 기록 갱신! (이전 ${s.final.prevBest})`;
    bestEl.className = 'result-best new';
    celebrate();
  } else {
    bestEl.textContent = `개인 최고 ${bestRecord()?.total ?? s.total}`;
    bestEl.className = 'result-best';
  }
  staticBoard($('result-board'), s.pieces);
  $('result-top').textContent = sum.top
    ? `가장 많이 번 상품: ${ITEMS[sum.top.id].icon} ${sum.top.name} (8일간 ${sum.top.earned})` : '';
  $('result-days').innerHTML = s.history.map((h) => `<li>${h.day}일<b>${h.income}</b></li>`).join('');
  show('result');
}

function celebrate() {
  for (let i = 0; i < 18; i++) {
    const c = document.createElement('span');
    c.className = 'confetti';
    c.textContent = ['✦', '🎉', '⭐', '🪙'][i % 4];
    c.style.left = `${Math.random() * 100}vw`;
    c.style.animationDelay = `${Math.random() * 0.6}s`;
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 2600);
  }
}

async function saveCard() {
  const url = `${location.host}${location.pathname.replace(/index\.html$/, '')}`;
  const canvas = drawCard({ pieces: s.pieces, total: s.total, grade: G.summary(s).grade.name, url });
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
  if (settling) return;
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
  const rot = ghost?.rot ?? (sel.kind === 'hand' ? handRot : selectedPiece().rot);
  setGhostAt(x, y, rot);
  render();
}

// 끌기: 선택한 상품(또는 미리보기)을 잡아 움직이고, 놓을 수 있는 곳에서 떼면 확정
let drag = null;
function onPointerDown(ev) {
  if (settling || ev.button > 0) return;
  const { x, y } = cellFromPoint(ev);
  drag = { x0: ev.clientX, y0: ev.clientY, cell: { x, y }, moved: false, grab: null };
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
      drag.rot = ghost?.rot ?? handRot;
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
  const id = selectedId();
  const prevGhost = ghost && `${ghost.x},${ghost.y},${ghost.rot}`;
  ghost = { ...clampAnchor(id, drag.rot, x - drag.grab[0], y - drag.grab[1]), rot: drag.rot };
  if (`${ghost.x},${ghost.y},${ghost.rot}` !== prevGhost) render();
}
function onPointerUp(ev) {
  if (!drag) return;
  const d = drag;
  drag = null;
  if (!d.moved) return onTap(d.cell.x, d.cell.y);
  if (d.dead) return;
  if (ghostValid()) commit();
  else render();
}

function rotate() {
  if (!sel || settling) return;
  const id = selectedId();
  if (sel.kind === 'hand' && !ghost) {
    handRot = (handRot + 1) % 4;
    s.hand.rot = handRot;
    save();
    return render();
  }
  const base = ghost ?? selectedPiece();
  const rot = (base.rot + 1) % 4;
  ghost = { ...clampAnchor(id, rot, base.x, base.y), rot };
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
  select(null);
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
    if (act === 'skip') skip();
  });
  $('coach').addEventListener('click', (e) => {
    if (e.target.closest('[data-act="coach-off"]')) { store.set(KEY_TUTORIAL, true); render(); }
  });

  $('btn-rotate').onclick = rotate;
  $('btn-undo').onclick = undo;
  $('btn-place').onclick = () => commit();
  $('btn-open').onclick = openShop;
  $('settle').onclick = finishSettle;
  $('btn-new').onclick = () => {
    const run = loadRun();
    if (run && run.phase !== 'over' && !confirm('진행 중인 상점이 있어요. 새로 시작할까요?')) return;
    startNew();
  };
  $('btn-continue').onclick = resume;
  $('btn-home').onclick = () => { finishSettle(); goStart(); };
  $('btn-again').onclick = startNew;
  $('btn-result-home').onclick = goStart;
  $('btn-card').onclick = saveCard;
  document.querySelectorAll('[data-open-help]').forEach((b) => { b.onclick = () => $('help').showModal(); });

  document.addEventListener('keydown', (e) => {
    if ($('screen-play').hidden || document.querySelector('dialog[open]')) return;
    if (settling) { if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') finishSettle(); return; }
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
    return `<div class="help-item"><div>${miniShape(id, 0, 14)}</div>
      <div><b>${it.icon} ${it.name}</b> · 기본 ${it.base}/일<br>${it.effect}</div></div>`;
  }).join('');
  $('help-grades').innerHTML = GRADES.slice().reverse().map((g, i, arr) =>
    `<li>${g.min === 0 ? `${arr[1].min} 미만` : `${g.min} 이상`}: ${g.name}</li>`).join('');
}

// 시작 화면의 대표 진열대
const SAMPLE = [
  ['bread', 0, 0, 0], ['milk', 2, 0, 0], ['fridge', 3, 0, 0], ['apple', 5, 0, 0], ['apple', 5, 1, 0],
  ['tshirt', 0, 1, 0], ['perfume', 1, 1, 0], ['plant', 2, 2, 0], ['fish', 3, 2, 0],
  ['sign', 0, 3, 0], ['sneakers', 2, 3, 0], ['apple', 0, 4, 0], ['safe', 1, 4, 1], ['jewel', 4, 3, 0],
].map(([id, x, y, rot], i) => ({ uid: i + 1, id, x, y, rot }));

fillHelp();
bind();
staticBoard($('start-board'), SAMPLE);
goStart();
