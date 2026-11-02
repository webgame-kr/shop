// 인스타 공유 카드(1080×1920, 디자인 시안 09): 기울어진 압류 통지서, 버틴 날, 상점 별명, 최종 진열대(일러스트),
// 누적 매출·하루 최고·계약 수, 게임 주소.
import { ITEMS, cellsOf, sizeOf, roman, imgKey } from './rules.js';

const DH = '"Do Hyeon", "Noto Sans KR", sans-serif';
const BT = '"Gowun Batang", serif';
const NOTO = '"Noto Sans KR", system-ui, sans-serif';
const C = { bg: '#1D1524', ink: '#F4E9D8', parch: '#F1E4C8', pInk: '#2B1E14', pSoft: '#6E5C49', seal: '#9E2B25', gold: '#F2C46B', board: '#3A2A45', slot: '#4A3A58', foot: '#2A1F33' };

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function loadImages(ids) {
  return Promise.all([...new Set(ids)].map((id) => new Promise((ok) => {
    const im = new Image();
    im.onload = () => ok([id, im]);
    im.onerror = () => ok([id, null]);
    im.src = `img/${id}.png`;
  }))).then((pairs) => new Map(pairs));
}

export async function drawCard({ dim, pieces, days, total, bestDay, signed, nickname, url }) {
  try { await Promise.all([document.fonts.load(`80px ${DH}`), document.fonts.load(`40px ${BT}`)]); } catch { /* 기본 글꼴로 */ }
  const pics = await loadImages(pieces.map(imgKey));
  const W = 1080, H = 1920;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const fmt = (n) => Number(n).toLocaleString('ko-KR');

  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.fillStyle = C.ink;
  ctx.font = `44px ${BT}`;
  ctx.fillText('마왕님,', W / 2, 128);
  ctx.font = `100px ${DH}`;
  ctx.fillText('내일 갚겠습니다', W / 2, 236);

  // 아래 받침과 주소
  ctx.fillStyle = C.foot;
  ctx.fillRect(100, 1690, W - 200, 110);
  ctx.fillStyle = C.gold;
  ctx.font = `46px ${DH}`;
  ctx.fillText(`${url}에서 마왕에게 빚져 보세요`, W / 2, 1810);

  // 기울어진 통지서
  ctx.save();
  ctx.translate(W / 2, 990);
  ctx.rotate(-0.012);
  const PW = 1050, PH = 1400;
  ctx.fillStyle = 'rgba(0,0,0,.45)';
  ctx.fillRect(-PW / 2 + 6, -PH / 2 + 14, PW, PH);
  ctx.fillStyle = C.parch;
  ctx.fillRect(-PW / 2, -PH / 2, PW, PH);
  ctx.translate(-W / 2, -990);

  ctx.fillStyle = C.pInk;
  ctx.font = `44px ${BT}`;
  ctx.fillText('압  류  통  지  서', W / 2, 400);
  ctx.font = `122px ${DH}`;
  ctx.fillText('마왕에게', W / 2, 560);
  ctx.fillText(`${days}일 버텼습니다`, W / 2, 690);
  ctx.font = `44px ${BT}`;
  ctx.fillStyle = C.pSoft;
  const pre = '최후의 상점: ';
  const preW = ctx.measureText(pre).width;
  ctx.font = `bold 44px ${BT}`;
  const nickW = ctx.measureText(nickname).width;
  const x0 = (W - preW - nickW) / 2;
  ctx.textAlign = 'left';
  ctx.font = `44px ${BT}`;
  ctx.fillText(pre, x0, 780);
  ctx.fillStyle = C.pInk;
  ctx.font = `bold 44px ${BT}`;
  ctx.fillText(nickname, x0 + preW, 780);
  ctx.textAlign = 'center';

  // 진열대
  const cell = Math.floor(Math.min(780 / dim.cols, 640 / dim.rows));
  const bw = cell * dim.cols, bh = cell * dim.rows;
  const bx = (W - bw) / 2, by = 830 + (640 - bh) / 2;
  ctx.fillStyle = C.board;
  roundRect(ctx, bx - 20, by - 20, bw + 40, bh + 40, 26); ctx.fill();
  const g = 5;
  for (let y = 0; y < dim.rows; y++)
    for (let x = 0; x < dim.cols; x++) {
      ctx.fillStyle = C.slot;
      roundRect(ctx, bx + x * cell + g, by + y * cell + g, cell - g * 2, cell - g * 2, 12);
      ctx.fill();
    }
  for (const p of pieces) {
    const cells = cellsOf(p);
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
    // 꺾인 상품은 전체 바운딩 박스에 그림을 그린다(시안의 장화처럼)
    if (cells.length !== w * h) box = { x: p.x, y: p.y, w, h };
    const pic = pics.get(imgKey(p));
    const cx = bx + (box.x + box.w / 2) * cell, cy = by + (box.y + box.h / 2) * cell;
    if (pic) {
      const base = sizeOf(p.id, 0);
      const turned = base.w !== base.h && p.rot % 2 === 1;
      const aw = box.w * cell - 18, ah = box.h * cell - 18;
      const [nw, nh] = turned ? [pic.height, pic.width] : [pic.width, pic.height];
      const k = Math.min(aw / nw, ah / nh);
      ctx.save();
      ctx.translate(cx, cy);
      if (turned) ctx.rotate(Math.PI / 2);
      ctx.drawImage(pic, -pic.width * k / 2, -pic.height * k / 2, pic.width * k, pic.height * k);
      ctx.restore();
    }
    if ((p.g ?? 1) >= 2) {
      const rx = bx + (box.x + box.w) * cell - 26, ry = by + (box.y + box.h) * cell - 26;
      ctx.fillStyle = '#1a1220';
      ctx.beginPath(); ctx.arc(rx, ry, 20, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = C.gold; ctx.lineWidth = 4; ctx.stroke();
      ctx.fillStyle = C.gold;
      ctx.font = `bold 22px ${BT}`;
      ctx.textBaseline = 'middle';
      ctx.fillText(roman(p.g), rx, ry + 1);
      ctx.textBaseline = 'alphabetic';
    }
  }

  // 기록 세 개
  const stats = [['누적 매출', fmt(total)], ['하루 최고', fmt(bestDay)], ['계약', `${signed}건`]];
  stats.forEach(([k, v], i) => {
    const x = 240 + i * 300;
    ctx.fillStyle = C.pSoft;
    ctx.font = `34px ${NOTO}`;
    ctx.fillText(k, x, 1555);
    ctx.fillStyle = C.pInk;
    ctx.font = `66px ${DH}`;
    ctx.fillText(v, x, 1625);
  });
  ctx.restore();

  // 압류 도장
  ctx.save();
  ctx.translate(965, 345);
  ctx.rotate(-0.26);
  ctx.strokeStyle = 'rgba(158, 43, 37, .9)';
  ctx.lineWidth = 9;
  ctx.beginPath(); ctx.arc(0, 0, 112, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = 'rgba(158, 43, 37, .92)';
  ctx.font = `78px ${DH}`;
  ctx.textBaseline = 'middle';
  ctx.fillText('압류', 0, 4);
  ctx.restore();
  return c;
}
