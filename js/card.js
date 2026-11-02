// 공유 카드(1080×1920): 압류 통지서. 게임 이름, 생존 일수, 최후의 상점 별명, 최종 진열대, 누적 매출, 게임 주소.
import { ITEMS, CATS, cellsOf, sizeOf, gradeLabel } from './rules.js';

const JUA = '"Jua", "Noto Sans KR", sans-serif';
const NOTO = '"Noto Sans KR", system-ui, sans-serif';
const C = { paper: '#f3e6cc', ink: '#3a2a1c', soft: '#7a6450', red: '#8a1f1f', night: '#1f1727', wood: '#5b3d2c', woodDark: '#3a261b', slot: '#3a2c46' };

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

export async function drawCard({ dim, pieces, days, total, nickname, url }) {
  try { await Promise.all([document.fonts.load(`80px ${JUA}`), document.fonts.load(`700 30px ${NOTO}`)]); } catch { /* 기본 글꼴로 */ }
  const W = 1080, H = 1920;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');

  ctx.fillStyle = C.night;
  ctx.fillRect(0, 0, W, H);
  // 통지서 종이
  ctx.fillStyle = C.paper;
  roundRect(ctx, 60, 70, W - 120, H - 140, 14); ctx.fill();

  ctx.textAlign = 'center';
  ctx.fillStyle = C.soft;
  ctx.font = `38px ${JUA}`;
  ctx.fillText('마왕님, 내일 갚겠습니다', W / 2, 170);
  ctx.fillStyle = C.red;
  ctx.font = `92px ${JUA}`;
  ctx.fillText('압 류 통 지 서', W / 2, 290);
  ctx.fillStyle = C.ink;
  ctx.font = `500 44px ${NOTO}`;
  ctx.fillText('마왕에게', W / 2, 400);
  ctx.font = `200px ${JUA}`;
  const dayText = String(days);
  const dw = ctx.measureText(dayText).width;
  ctx.font = `64px ${JUA}`;
  const sw = ctx.measureText('일 버텼습니다').width;
  const x0 = (W - dw - sw - 10) / 2;
  ctx.textAlign = 'left';
  ctx.font = `200px ${JUA}`;
  ctx.fillText(dayText, x0, 590);
  ctx.font = `64px ${JUA}`;
  ctx.fillText('일 버텼습니다', x0 + dw + 10, 590);
  ctx.textAlign = 'center';
  ctx.fillStyle = C.red;
  ctx.font = `54px ${JUA}`;
  ctx.fillText(`최후의 상점: ${nickname}`, W / 2, 690);

  // 진열대
  const cell = Math.floor(Math.min(840 / dim.cols, 640 / dim.rows));
  const gap = 6;
  const bw = cell * dim.cols, bh = cell * dim.rows;
  const bx = (W - bw) / 2, by = 760;
  ctx.fillStyle = C.woodDark;
  roundRect(ctx, bx - 18, by - 18 + 14, bw + 36, bh + 36, 30); ctx.fill();
  ctx.fillStyle = C.wood;
  roundRect(ctx, bx - 18, by - 18, bw + 36, bh + 36, 30); ctx.fill();
  for (let y = 0; y < dim.rows; y++)
    for (let x = 0; x < dim.cols; x++) {
      ctx.fillStyle = C.slot;
      roundRect(ctx, bx + x * cell + gap, by + y * cell + gap, cell - gap * 2, cell - gap * 2, 12);
      ctx.fill();
    }

  for (const p of pieces) {
    const it = ITEMS[p.id];
    const cells = cellsOf(p);
    const has = (x, y) => cells.some((q) => q[0] === x && q[1] === y);
    ctx.fillStyle = CATS[it.cat].color;
    for (const [x, y] of cells) {
      const l = has(x - 1, y) ? 0 : gap, r = has(x + 1, y) ? 0 : gap;
      const t = has(x, y - 1) ? 0 : gap, b = has(x, y + 1) ? 0 : gap;
      const R = 14;
      const rad = [
        !has(x, y - 1) && !has(x - 1, y) ? R : 0, !has(x, y - 1) && !has(x + 1, y) ? R : 0,
        !has(x, y + 1) && !has(x + 1, y) ? R : 0, !has(x, y + 1) && !has(x - 1, y) ? R : 0,
      ];
      roundRect(ctx, bx + x * cell + l, by + y * cell + t, cell - l - r + (r ? 0 : 1), cell - t - b + (b ? 0 : 1), rad);
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
    const cx = bx + (box.x + box.w / 2) * cell, cy = by + (box.y + box.h / 2) * cell;
    const emo = Math.min(box.w * cell * 0.5, box.h * cell * 0.42, 110);
    ctx.textBaseline = 'middle';
    ctx.font = `${emo}px ${NOTO}`;
    ctx.fillText(it.icon, cx, cy - 14);
    ctx.fillStyle = '#1f1727';
    ctx.font = `700 ${Math.round(cell * 0.2)}px ${NOTO}`;
    ctx.fillText((p.g > 1 ? `${gradeLabel(p.g)} ` : '') + it.name, cx, cy + emo / 2 + 4);
    ctx.textBaseline = 'alphabetic';
  }

  const ty = by + bh + 120;
  ctx.fillStyle = C.soft;
  ctx.font = `500 40px ${NOTO}`;
  ctx.fillText('누적 매출', W / 2, ty);
  ctx.fillStyle = C.ink;
  ctx.font = `120px ${JUA}`;
  ctx.fillText(Number(total).toLocaleString('ko-KR'), W / 2, ty + 120);

  // 압류 도장
  ctx.save();
  ctx.translate(W - 230, 470);
  ctx.rotate(0.24);
  ctx.strokeStyle = 'rgba(178, 32, 32, .8)';
  ctx.lineWidth = 10;
  roundRect(ctx, -110, -60, 220, 120, 18); ctx.stroke();
  ctx.fillStyle = 'rgba(178, 32, 32, .8)';
  ctx.font = `76px ${JUA}`;
  ctx.textBaseline = 'middle';
  ctx.fillText('압류', 0, 6);
  ctx.restore();

  ctx.fillStyle = C.ink;
  ctx.font = `700 36px ${NOTO}`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(`${url} 에서 버텨 보세요`, W / 2, H - 120);
  return c;
}
