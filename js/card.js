// 인스타 결과 카드(1080×1920, 디자인 시안 4번): 게임 이름, 최종 진열대(일러스트 포함), 누적 매출과 등급, 게임 주소.
import { COLS, ROWS, ITEMS, cellsOf, sizeOf } from './rules.js';

const JUA = '"Jua", "Noto Sans KR", sans-serif';
const NOTO = '"Noto Sans KR", system-ui, sans-serif';
const C = { bg: '#f3eadb', ink: '#2a2118', soft: '#6d5d4b', green: '#2f6b4f', wood: '#b9814c', woodDark: '#94653a', slot: '#eed9b6' };

function roundRect(ctx, x, y, w, h, r) {
  const [tl, tr, br, bl] = Array.isArray(r) ? r : [r, r, r, r];
  ctx.beginPath();
  ctx.moveTo(x + tl, y);
  ctx.arcTo(x + w, y, x + w, y + h, tr);
  ctx.arcTo(x + w, y + h, x, y + h, br);
  ctx.arcTo(x, y + h, x, y, bl);
  ctx.arcTo(x, y, x + w, y, tl);
  ctx.closePath();
}

function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.round(v * k);
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

export async function drawCard({ pieces, total, grade, url }) {
  try { await Promise.all([document.fonts.load(`80px ${JUA}`), document.fonts.load(`700 30px ${NOTO}`)]); } catch { /* 기본 글꼴로 */ }
  const pics = new Map(await Promise.all([...new Set(pieces.map((p) => p.id))].map((id) => new Promise((ok) => {
    const im = new Image();
    im.onload = () => ok([id, im]);
    im.onerror = () => ok([id, null]);
    im.src = `img/${id}.png`;
  }))));
  const W = 1080, H = 1920;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');

  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  // 차양
  ctx.fillStyle = C.green;
  for (let x = 0; x < W; x += 140) ctx.fillRect(x, 0, 70, 80);
  ctx.fillRect(0, 80, W, 14);

  ctx.textAlign = 'center';
  ctx.fillStyle = C.soft;
  ctx.font = `40px ${JUA}`;
  ctx.fillText('8일간의 장사 기록', W / 2, 230);
  ctx.fillStyle = C.green;
  ctx.font = `120px ${JUA}`;
  ctx.fillText('작은 배낭 상점', W / 2, 360);

  // 진열대
  const cell = 132, gap = 6;
  const bw = cell * COLS, bh = cell * ROWS;
  const bx = (W - bw) / 2, by = 450;
  ctx.fillStyle = C.woodDark;
  roundRect(ctx, bx - 18, by - 18 + 14, bw + 36, bh + 36, 30); ctx.fill();
  ctx.fillStyle = C.wood;
  roundRect(ctx, bx - 18, by - 18, bw + 36, bh + 36, 30); ctx.fill();
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++) {
      ctx.fillStyle = C.slot;
      roundRect(ctx, bx + x * cell + gap, by + y * cell + gap, cell - gap * 2, cell - gap * 2, 12);
      ctx.fill();
    }

  for (const p of pieces) {
    const it = ITEMS[p.id];
    const cells = cellsOf(p);
    const has = (x, y) => cells.some((q) => q[0] === x && q[1] === y);
    for (const [x, y] of cells) {
      const l = has(x - 1, y) ? 0 : gap, r = has(x + 1, y) ? 0 : gap;
      const t = has(x, y - 1) ? 0 : gap, b = has(x, y + 1) ? 0 : gap;
      const R = 14;
      const rad = [
        !has(x, y - 1) && !has(x - 1, y) ? R : 0, !has(x, y - 1) && !has(x + 1, y) ? R : 0,
        !has(x, y + 1) && !has(x + 1, y) ? R : 0, !has(x, y + 1) && !has(x - 1, y) ? R : 0,
      ];
      const X = bx + x * cell + l, Y = by + y * cell + t, w = cell - l - r + (r ? 0 : 1), h = cell - t - b + (b ? 0 : 1);
      if (b) { ctx.fillStyle = shade(it.color, 0.84); roundRect(ctx, X, Y, w, h, rad); ctx.fill(); }
      ctx.fillStyle = it.color;
      roundRect(ctx, X, Y, w, h - (b ? 9 : 0), b ? [rad[0], rad[1], 0, 0] : rad);
      ctx.fill();
    }
    const { w, h } = sizeOf(p.id, p.rot);
    let box;
    if (cells.length === w * h) box = { x: p.x, y: p.y, w, h };
    else {
      const mx = cells.reduce((a, q) => a + q[0], 0) / cells.length;
      const my = cells.reduce((a, q) => a + q[1], 0) / cells.length;
      const [nx, ny] = cells.reduce((best, q) =>
        Math.hypot(q[0] - mx, q[1] - my) < Math.hypot(best[0] - mx, best[1] - my) ? q : best);
      box = { x: nx, y: ny, w: 1, h: 1 };
    }
    // 일러스트(화면과 같은 규칙: 길쭉한 상품을 세로로 돌리면 그림도 90도) + 이름
    const pic = pics.get(p.id);
    const areaW = box.w * cell - 24, areaH = Math.min(box.h * cell - 62, 250);
    const base = sizeOf(p.id, 0);
    const turned = base.w !== base.h && p.rot % 2 === 1;
    const cx = bx + (box.x + box.w / 2) * cell;
    const nameH = 30, gapY = 8;
    let ih = 0, iw = 0;
    if (pic) {
      const [nw, nh] = turned ? [pic.height, pic.width] : [pic.width, pic.height];
      const k = Math.min(areaW / nw, areaH / nh);
      iw = nw * k; ih = nh * k;
    }
    const top = by + (box.y + box.h / 2) * cell - (ih + gapY + nameH) / 2 - 4;
    if (pic) {
      ctx.save();
      ctx.translate(cx, top + ih / 2);
      if (turned) ctx.rotate(Math.PI / 2);
      const [dw, dh] = turned ? [ih, iw] : [iw, ih];
      ctx.drawImage(pic, -dw / 2, -dh / 2, dw, dh);
      ctx.restore();
    }
    ctx.fillStyle = it.light ? '#fff' : C.ink;
    ctx.font = `700 30px ${NOTO}`;
    ctx.textBaseline = 'middle';
    ctx.fillText(it.name, cx, top + ih + gapY + nameH / 2);
    ctx.textBaseline = 'alphabetic';
  }

  // 매출과 등급
  const ty = by + bh + 130;
  ctx.fillStyle = C.soft;
  ctx.font = `500 38px ${NOTO}`;
  ctx.fillText('누적 매출', W / 2, ty);
  ctx.fillStyle = C.ink;
  ctx.font = `230px ${JUA}`;
  ctx.fillText(String(total), W / 2, ty + 220);

  ctx.font = `60px ${JUA}`;
  const gw = ctx.measureText(grade).width + 80;
  ctx.fillStyle = C.green;
  roundRect(ctx, (W - gw) / 2, ty + 280, gw, 96, 48); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.fillText(grade, W / 2, ty + 330);
  ctx.textBaseline = 'alphabetic';

  ctx.fillStyle = C.ink;
  ctx.font = `700 38px ${NOTO}`;
  ctx.fillText(`${url} 에서 도전해 보세요`, W / 2, H - 110);
  return c;
}
