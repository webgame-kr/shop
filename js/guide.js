// 운영 안내서(규칙)와 도감(상품 24종·손님 6종). 화면에 그리기만 하고 게임 상태는 바꾸지 않는다.
import { ITEMS, ITEM_IDS, CATS, CUSTOMERS, effectText, mutName, mutText, shapeOf, sizeOf, roman } from './rules.js';
import { REGULAR, CONTRACTS, SETTLE_EVERY, FAVOR_TO_OFFER, MAX_ACTIVE } from './game.js';

const img = (id) => `img/${id}.png`;
const hex = (id, m) => `<span class="hex-big ${m}">${mutName(id, m)[0]}</span>`;
const typeCount = (t) => Object.values(CONTRACTS).filter((c) => c.type === t).length;

// 안내서 아홉 장. 시스템마다 한 장씩, 숫자는 규칙 코드에서 가져온다.
const SECTIONS = [
  {
    id: 'day', title: '하루의 흐름', icon: 'img/flame.png',
    body: `<div class="flow"><span>아침 예고</span><i>›</i><span>입고 2번</span><i>›</i><span>정리·합성</span><i>›</i><span>계약</span><i>›</i><span>영업</span><i>›</i><span>납부 판정</span></div>
      <p>아침마다 <b>오늘 납부액</b>과 오늘·내일 손님이 공개돼요. 납부액은 하루 도중에 바뀌지 않아요. 시간제한은 없으니 천천히 준비하세요.</p>`,
  },
  {
    id: 'pay', title: '납부와 영혼의 불꽃', icon: 'img/flame.png',
    body: `<p>오늘 매출이 납부액 이상이면 남는 돈은 <b>잔금</b>으로 쌓여요. 모자라면 영혼의 불꽃이 하나 꺼지고 잔금은 늘지 않아요. 아무리 많이 모자라도 하루에 꺼지는 불꽃은 하나예요.</p>
      <p>불꽃 세 개가 모두 꺼지면 상점은 압류돼요. 꺼진 다음 날엔 <b>마왕의 유예</b>로 후보를 무료로 한 번 다시 뽑을 수 있어요.</p>`,
  },
  {
    id: 'place', title: '입고와 배치', icon: 'img/herb.png',
    body: `<p>후보 3개 중 하나를 골라 진열대에 놓아요. 후보마다 나온 이유가 붙어요: <b>같은 종류</b>(합성용) · <b>손님·단골</b>(선호) · <b>새 선택</b>.</p>
      <p>상품은 팔려도 사라지지 않고 매일 매출을 내요. 상하좌우로 맞닿으면 붙은 거예요(대각선은 아님). 같은 이름의 지원은 한 상품에 한 번, 받은 보너스를 다른 지원이 다시 키우지 않아요.</p>
      <div class="row"><span class="demo"><img src="img/herb.png" alt="">약초</span><span class="demo">→ 붙은 물약 +2</span></div>`,
  },
  {
    id: 'merge', title: '합성과 등급', icon: 'img/cauldron.png',
    body: `<p>같은 상품·같은 등급 <b>3개 → 한 등급 위 1개</b>. 기본 매출은 약 2.4배라 셋을 따로 둔 것보다 조금 적지만, 칸이 비어요. 아직 놓지 않은 새 상품도 재료가 돼요.</p>
      <div class="row"><span class="demo">${roman(1)} 기본</span><span class="demo">${roman(2)} 금테</span><span class="demo">${roman(3)} 보라 빛</span><span class="demo">${roman(4)}+ 주황 빛·숫자</span></div>`,
  },
  {
    id: 'mut', title: '변이', icon: 'img/potion.png',
    body: `<p>한 상품 종류가 <b>처음 Ⅱ등급</b>이 되면 두 변이 중 하나를 골라요. 그 판 동안 그 종류의 Ⅱ등급 이상 전체에 적용되고, Ⅰ등급엔 효과가 없어요.</p>
      <div class="row"><span class="demo">${hex('potion', 'A')} 농축 · 자기 매출</span><span class="demo">${hex('potion', 'B')} 공명 · 주변 지원</span></div>
      <p>금색 육각형은 변이 A, 민트는 변이 B예요. 상품마다 두 운영 방식을 비교해 고르세요.</p>`,
  },
  {
    id: 'guest', title: '손님과 단골', icon: 'img/guest_witches.png',
    body: `<p>매일 특별 손님 한 무리가 와서 좋아하는 상품에 보너스를 줘요. 오늘과 내일 손님은 미리 보여요.</p>
      <p>손님이 온 날 그 손님의 <b>호감 조건</b>을 채운 채 영업하면 호감도 +1(방문당 최대 1). ${FAVOR_TO_OFFER}이 되면 <b>단골 제안</b>이 와요. 단골은 최대 두 집단, 불꽃을 잃어도 떠나지 않고 입고·방문·비용에 혜택을 줘요.</p>`,
  },
  {
    id: 'contract', title: '마왕의 계약', icon: 'img/demon.png',
    body: `<p>정해진 날(3·6·8·11·13…일)에 유형별로 하나씩 제안돼요. <b>서명하거나 모두 거절해야</b> 그날 영업할 수 있어요.</p>
      <div class="row"><span class="ctype instant">⇄ 즉시 거래 ${typeCount('instant')}</span><span class="ctype period">⧗ 기간형 ${typeCount('period')}</span><span class="ctype cond">◎ 조건형 ${typeCount('cond')}</span></div>
      <ul><li>즉시 거래는 바로 처리되고 자리를 차지하지 않아요.</li><li>기간형·조건형은 합쳐서 ${MAX_ACTIVE}개까지.</li><li>조건형은 계약금을 먼저 내고, 실패하면 계약금만 잃어요.</li><li>받는 것·대가·기간·끝나면·오늘 영향을 서명 전에 모두 보여 줘요.</li></ul>`,
  },
  {
    id: 'settle', title: '결산일과 성장', icon: 'img/chest.png',
    body: `<p>${SETTLE_EVERY}일마다 <b>결산일</b>이 와요. 납부액이 평소보다 높지만, 성공하면 성장 보상 셋 중 하나를 골라요: 우선 입고 지정, 분야 강화, 진열대 확장, 불꽃 회복 등.</p>
      <p><b>우선 입고</b>는 고른 상품이 후보에 더 자주 나오게 해요. 한 종류만, 매번 보장되지는 않고, 다음 결산일에 바꿀 수 있어요.</p>`,
  },
  {
    id: 'balance', title: '잔금과 조작', icon: 'img/pouch.png',
    body: `<ul><li>잔금으로 후보 새로고침, 추가 입고, 자물쇠 칸 열기(최대 7×6)를 살 수 있어요. 잔금으로 납부 부족분을 메우지는 못해요.</li>
      <li>상품 누르기 → 놓을 칸 누르기 → 여기에 놓기. 끌어서 옮길 수도 있어요.</li>
      <li>영업 전까지는 되돌리기로 오늘 한 일을 되돌릴 수 있어요.</li>
      <li>키보드: R 회전 · Enter 놓기 · Ctrl+Z 되돌리기 · Esc 선택 해제 · Delete 버리기</li>
      <li>진행과 기록은 이 브라우저에만 저장돼요.</li></ul>`,
  },
];

export function renderGuide(body, toc) {
  toc.innerHTML = SECTIONS.map((x, i) => `<a href="#g-${x.id}">${i + 1}. ${x.title}</a>`).join('');
  body.innerHTML = SECTIONS.map((x, i) => `<section class="g-card" id="g-${x.id}">
    <div class="gh"><span class="num">${i + 1}</span><h3>${x.title}</h3><img class="gi" src="${x.icon}" alt=""></div>${x.body}</section>`).join('');
}

function miniShape(id, cell = 9) {
  const sh = shapeOf(id, 0);
  const { w, h } = sizeOf(id, 0);
  const rects = sh.map(([x, y]) => `<rect x="${x * cell + 1}" y="${y * cell + 1}" width="${cell - 2}" height="${cell - 2}" rx="2" fill="${CATS[ITEMS[id].cat].color}"/>`).join('');
  return `<svg style="width:${w * cell}px;height:${h * cell}px;stroke:none" viewBox="0 0 ${w * cell} ${h * cell}" aria-hidden="true">${rects}</svg>`;
}

// state가 있으면 진열 중·변이 선택 여부, 손님 호감도·단골 여부를 함께 보여 준다
export function renderCodex(body, filters, tab, filter, state) {
  if (tab === 'items') {
    filters.hidden = false;
    filters.innerHTML = [['all', '전체'], ['alch', '연금술'], ['gear', '모험 장비'], ['magic', '마법 잡화']]
      .map(([k, n]) => `<button data-filter="${k}" class="${filter === k ? 'on' : ''}">${n}</button>`).join('');
    const ids = ITEM_IDS.filter((id) => filter === 'all' || ITEMS[id].cat === filter);
    body.innerHTML = `<div class="codex-grid">${ids.map((id) => {
      const it = ITEMS[id];
      const owned = state?.pieces?.filter((p) => p.id === id).length ?? 0;
      const chosen = state?.mutations?.[id];
      return `<article class="cx"><span class="art"><img src="${img(id)}" alt=""></span>
        <div class="h"><b>${it.name}</b><span class="cat" style="background:${CATS[it.cat].color}">${CATS[it.cat].name}</span>${owned ? `<span class="owned">진열 중 ${owned}</span>` : ''}</div>
        <div class="meta">${miniShape(id)} ${it.cells.length}칸 · 기본 ${it.base}/일</div>
        <div class="eff">${effectText(id, 1)}</div>
        <div class="mutcap">변이 · Ⅱ등급 기준 수치</div>
        <div class="muts">${['A', 'B'].map((m) => `<div class="mut"${chosen && chosen !== m ? ' style="opacity:.5"' : ''}><div class="mh">${hex(id, m)}${mutName(id, m)}${chosen === m ? ' ✓' : ''}</div>${mutText(id, m, 2)}</div>`).join('')}</div></article>`;
    }).join('')}</div>`;
    return;
  }
  filters.hidden = true;
  body.innerHTML = `<div class="codex-grid">${Object.entries(CUSTOMERS).map(([id, c]) => {
    const fav = state?.favor?.[id] ?? 0;
    const reg = state?.regulars?.includes(id);
    return `<article class="gx"><img src="img/guest_${id}.png" alt=""><div><b>${c.name}</b><div class="like">${c.text}</div>
      ${state ? `<div class="state">${reg ? '★ 단골' : `호감 ${'♥'.repeat(fav) || '없음'}`}</div>` : ''}</div>
      <dl><dt>호감 조건</dt><dd>${REGULAR[id].cond}</dd><dt>단골 효과</dt><dd>${REGULAR[id].effect}</dd></dl></article>`;
  }).join('')}</div>`;
}
