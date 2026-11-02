// 결과 공유용 세로 카드(1080×1350): 게임 이름, 최종 진열대, 누적 매출과 등급, 게임 주소.
import { COLS, ROWS, ITEMS, cellsOf, sizeOf } from './rules.js';

const FONT = 'system-ui, -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif';

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function drawCard({ pieces, total, grade, url }) {
  const W = 1080, H = 1350;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');

  ctx.fillStyle = '#f6ead4';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#3b2a1c';
  ctx.textAlign = 'center';
  ctx.font = `800 64px ${FONT}`;
  ctx.fillText('작은 배낭 상점', W / 2, 120);
  ctx.font = `600 34px ${FONT}`;
  ctx.fillStyle = '#7a6450';
  ctx.fillText('8일 장사 결과', W / 2, 175);

  // 진열대
  const cell = 140, gap = 6;
  const bw = cell * COLS, bh = cell * ROWS;
  const bx = (W - bw) / 2, by = 225;
  ctx.fillStyle = '#c99a66';
  roundRect(ctx, bx - 22, by - 22, bw + 44, bh + 44, 28);
  ctx.fill();
  ctx.fillStyle = '#ead3ae';
  roundRect(ctx, bx, by, bw, bh, 14);
  ctx.fill();
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++) {
      ctx.fillStyle = '#f3e2c4';
      roundRect(ctx, bx + x * cell + gap, by + y * cell + gap, cell - gap * 2, cell - gap * 2, 12);
      ctx.fill();
    }

  for (const p of pieces) {
    const cells = cellsOf(p);
    const has = (x, y) => cells.some((q) => q[0] === x && q[1] === y);
    ctx.fillStyle = ITEMS[p.id].color;
    ctx.strokeStyle = '#3b2a1c';
    ctx.lineWidth = 5;
    for (const [x, y] of cells) {
      const l = has(x - 1, y) ? 0 : gap, r = has(x + 1, y) ? 0 : gap;
      const t = has(x, y - 1) ? 0 : gap, b = has(x, y + 1) ? 0 : gap;
      ctx.fillRect(bx + x * cell + l, by + y * cell + t, cell - l - r, cell - t - b);
    }
    // 바깥 테두리만
    ctx.beginPath();
    for (const [x, y] of cells) {
      const x0 = bx + x * cell, y0 = by + y * cell;
      const L = x0 + (has(x - 1, y) ? 0 : gap), R = x0 + cell - (has(x + 1, y) ? 0 : gap);
      const T = y0 + (has(x, y - 1) ? 0 : gap), B = y0 + cell - (has(x, y + 1) ? 0 : gap);
      if (!has(x, y - 1)) { ctx.moveTo(L, T); ctx.lineTo(R, T); }
      if (!has(x, y + 1)) { ctx.moveTo(L, B); ctx.lineTo(R, B); }
      if (!has(x - 1, y)) { ctx.moveTo(L, T); ctx.lineTo(L, B); }
      if (!has(x + 1, y)) { ctx.moveTo(R, T); ctx.lineTo(R, B); }
    }
    ctx.stroke();

    const { w, h } = sizeOf(p.id, p.rot);
    let cx, cy;
    if (cells.length === w * h) { cx = p.x + w / 2; cy = p.y + h / 2; }
    else {
      const mx = cells.reduce((a, q) => a + q[0], 0) / cells.length;
      const my = cells.reduce((a, q) => a + q[1], 0) / cells.length;
      const [nx, ny] = cells.reduce((best, q) =>
        Math.hypot(q[0] - mx, q[1] - my) < Math.hypot(best[0] - mx, best[1] - my) ? q : best);
      cx = nx + 0.5; cy = ny + 0.5;
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `64px ${FONT}`;
    ctx.fillText(ITEMS[p.id].icon, bx + cx * cell, by + cy * cell - 14);
    ctx.fillStyle = '#3b2a1c';
    ctx.font = `700 26px ${FONT}`;
    ctx.fillText(ITEMS[p.id].name, bx + cx * cell, by + cy * cell + 40);
    ctx.textBaseline = 'alphabetic';
  }

  // 매출과 등급
  const ty = by + bh + 95;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#7a6450';
  ctx.font = `600 36px ${FONT}`;
  ctx.fillText('누적 매출', W / 2, ty);
  ctx.fillStyle = '#3b2a1c';
  ctx.font = `900 120px ${FONT}`;
  ctx.fillText(String(total), W / 2, ty + 115);
  ctx.fillStyle = '#d9573b';
  ctx.font = `800 52px ${FONT}`;
  ctx.fillText(grade, W / 2, ty + 195);

  ctx.fillStyle = '#7a6450';
  ctx.font = `600 30px ${FONT}`;
  ctx.fillText(url, W / 2, H - 50);
  return c;
}
