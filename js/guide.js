// 운영 안내서(규칙)와 도감(상품 42종·손님 9종). 화면에 그리기만 하고 게임 상태는 바꾸지 않는다.
import { ITEMS, ITEM_IDS, CATS, CAT_IDS, CAT_GUEST, CUSTOMERS, GROW_NEED, effectText, mutName, mutText, shapeOf, sizeOf, roman } from './rules.js';
import { REGULAR, SPECIAL_GUESTS, STAGES, CONTRACTS, SETTLE_EVERY, FAVOR_TO_OFFER, MAX_ACTIVE, START_SUPPORT_UNTIL, MAX_TICKETS } from './game.js';

const img = (id) => `img/${id}.png`;
const hex = (id, m) => `<span class="hex-big ${m}">${mutName(id, m)[0]}</span>`;
const catIc = (c) => `<img class="cx-ic" src="img/cat_${c}.png" alt="">`;
const typeCount = (t) => Object.values(CONTRACTS).filter((c) => c.type === t).length;

// 안내서 열두 장. 시스템마다 한 장씩, 숫자는 규칙 코드에서 가져온다.
const SECTIONS = [
  {
    id: 'day', title: '하루의 흐름', icon: 'img/flame.png',
    body: `<div class="flow"><span>아침 예고</span><i>›</i><span>입고 2번</span><i>›</i><span>정리·합성</span><i>›</i><span>계약</span><i>›</i><span>영업</span><i>›</i><span>납부 판정</span></div>
      <p>아침마다 <b>오늘 납부액</b>과 오늘·내일 손님이 공개돼요. 납부액은 하루 도중에 바뀌지 않아요. 시간제한은 없으니 천천히 준비하세요.</p>
      <p>새 계약서에 서명하면 먼저 <b>시작 분야</b>를 골라요. 첫 주력 단골을 얻거나 ${START_SUPPORT_UNTIL}일 차가 끝날 때까지 입고 1번 자리가 그 분야에서 나오고, 그 분야 손님이 2일 차에 처음 찾아와요.</p>`,
  },
  {
    id: 'cats', title: '여섯 분야', icon: 'img/cat_food.png',
    body: `<div class="cat-legend">${CAT_IDS.map((c) => `<span>${catIc(c)}<b>${CATS[c].name}</b><small>${CATS[c].short}</small></span>`).join('')}</div>
      <p>분야 아이콘은 색과 모양이 함께 달라 색만으로 구분하지 않아도 돼요. 마계 식품은 여러 음식을 붙여 세트를, 보물·귀금속은 적은 수의 고등급과 정교한 진열을, 마수·알은 초반 매출 대신 성장을 노려요.</p>`,
  },
  {
    id: 'pay', title: '납부와 영혼의 불꽃', icon: 'img/flame.png',
    body: `<p>오늘 매출이 납부액 이상이면 남는 돈은 <b>잔금</b>으로 쌓여요. 모자라면 영혼의 불꽃이 하나 꺼지고 잔금은 늘지 않아요. 아무리 많이 모자라도 하루에 꺼지는 불꽃은 하나예요.</p>
      <p>불꽃 세 개가 모두 꺼지면 상점은 압류돼요. 꺼진 다음 날엔 <b>마왕의 유예</b>로 후보를 무료로 한 번 다시 뽑을 수 있어요.</p>`,
  },
  {
    id: 'place', title: '입고와 배치', icon: 'img/herb.png',
    body: `<p>후보 3개 중 하나를 골라 진열대에 놓아요. 자리마다 역할이 있어요.</p>
      <ul><li><b>1번</b> · 주력 단골 분야(없으면 시작 분야, 그것도 끝나면 자유)</li><li><b>2번</b> · 이미 가진 상품, 합성 재료가 모자란 것 우선</li><li><b>3번</b> · 새로운 상품, 최근 덜 나온 분야 우선(독점 입고 계약은 이 자리)</li></ul>
      <p>[전체 새로고침]은 잔금을 내고 자리 역할은 그대로 다시 뽑아요. <b>무료 이용권</b>은 1번 자리만 다시 뽑아요(최대 ${MAX_TICKETS}장 보관).</p>
      <p>상품은 팔려도 사라지지 않고 매일 매출을 내요. 상하좌우로 맞닿으면 붙은 거예요(대각선은 아님). 같은 이름의 지원은 한 상품에 한 번, 받은 보너스를 다른 지원이 다시 키우지 않아요.</p>
      <div class="row"><span class="demo"><img src="img/herb.png" alt="">약초</span><span class="demo">→ 붙은 물약 +2</span></div>`,
  },
  {
    id: 'merge', title: '합성과 등급', icon: 'img/cauldron.png',
    body: `<p>같은 상품·같은 등급 <b>3개 → 한 등급 위 1개</b>. 기본 매출은 약 2.4배라 셋을 따로 둔 것보다 조금 적지만, 칸이 비어요. 아직 놓지 않은 새 상품도 재료가 돼요.</p>
      <div class="row"><span class="demo">${roman(1)} 기본</span><span class="demo">${roman(2)} 금테</span><span class="demo">${roman(3)} 보라 빛</span><span class="demo">${roman(4)}+ 주황 빛·숫자</span></div>`,
  },
  {
    id: 'beast', title: '마수 성장', icon: 'img/slime_egg.png',
    body: `<p>마수는 <b>알</b>로 들어와 기본 매출이 낮아요. 알마다 성장 조건이 있고, 조건을 채운 채 영업이 끝나면 성장도 +1. 정령 둥지와 붙어 있으면 +1 더(둥지가 여럿이어도 한 번). <b>${GROW_NEED}</b>이 되면 성장 완료, 새 매출은 다음 영업부터예요.</p>
      <div class="row"><span class="demo"><img src="img/wyvern_egg.png" alt="">와이번 알</span><span class="demo">→</span><span class="demo"><img src="img/wyvern.png" alt="">아기 와이번</span></div>
      <p>성장 전에는 합성할 수 없고, 자라도 칸 모양은 그대로예요. 알을 누르면 조건·둥지·오늘 결과가 보여요.</p>`,
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
      <p>분야마다 한 집단, 여섯 집단만 단골이 될 수 있어요. 고블린·귀족·떠돌이는 <b>특별 손님</b>으로만 와요. 손님이 온 날 <b>호감 조건</b>을 채운 채 영업하면 호감도 +1(방문당 최대 1). ${FAVOR_TO_OFFER}이 되면 <b>단골 제안</b>이 와요.</p>
      <div class="tiers">${STAGES.map((t) => `<span><b>${t.at}♥ ${t.name}</b></span>`).join('')}</div>
      <p>단골은 최대 둘. 그중 <b>주력 단골</b> 하나가 입고 1번 자리를 자기 분야로 채우고, 결산일마다 보상을 줘요: 무료 다시 뽑기 이용권, 친한 단골이면 Ⅰ등급 상품 선택, VIP면 Ⅱ등급 상품 선택. 주력은 결산 뒤 바꿀 수 있고 다음 날부터 적용돼요. 단골을 교체하면 떠난 집단의 호감은 0이 돼요.</p>`,
  },
  {
    id: 'contract', title: '마왕의 계약', icon: 'img/demon.png',
    body: `<p>정해진 날(3·6·8·11·13…일)에 유형별로 하나씩 제안돼요. <b>서명하거나 모두 거절해야</b> 그날 영업할 수 있어요.</p>
      <div class="row"><span class="ctype instant">⇄ 즉시 거래 ${typeCount('instant')}</span><span class="ctype period">⧗ 기간형 ${typeCount('period')}</span><span class="ctype cond">◎ 조건형 ${typeCount('cond')}</span></div>
      <ul><li>즉시 거래는 바로 처리되고 자리를 차지하지 않아요.</li><li>기간형·조건형은 합쳐서 ${MAX_ACTIVE}개까지.</li><li>조건형은 계약금을 먼저 내고, 실패하면 계약금만 잃어요.</li><li>받는 것·대가·기간·끝나면·오늘 영향을 서명 전에 모두 보여 줘요.</li></ul>`,
  },
  {
    id: 'settle', title: '결산일과 성장', icon: 'img/chest.png',
    body: `<p>${SETTLE_EVERY}일마다 <b>결산일</b>이 와요. 납부액이 평소보다 높지만, 성공하면 성장 보상 셋 중 하나를 골라요. 1번은 지금 전략 강화(주력 분야 강화 또는 우선 입고), 2번은 성장 방식(중급 입고·지정 발주권·등급 올리기 이용권), 3번은 운영 안정(불꽃 회복 또는 그날 발주 한 번 값의 잔금). 분야 강화는 여섯 분야 모두 있고, 주력 단골이 없으면 최근 3번 영업에서 많이 판 분야가 나와요. 카드마다 지금 상점 기준 효과가 보여요.</p>
      <p><b>우선 입고</b>는 고른 상품이 후보에 더 자주 나오게 해요. 한 종류만, 매번 보장되지는 않고, 다음 결산일에 바꿀 수 있어요.</p>`,
  },
  {
    id: 'balance', title: '잔금과 조작', icon: 'img/pouch.png',
    body: `<ul><li>잔금으로 후보 새로고침, 추가 입고, <b>지정 발주</b>, <b>등급 올리기</b>를 살 수 있어요. 잔금으로 납부 부족분을 메우지는 못해요.</li>
      <li><b>지정 발주</b>: 정리 단계에서 진열 중인 상품 종류 하나를 1등급으로 확정 입고(마수는 알). 하루 두 번, 첫 주문 25 + 10×⌊날짜÷5⌋, 두 번째는 두 배. 받은 상품은 놓거나 손에 든 채 합성하거나 버려요. 받을 공간도 합성 재료도 없으면 주문할 수 없어요. 결산 보상의 지정 발주권(최대 2장)이면 무료.</li>
      <li><b>진열대</b>는 결산일 다음 날 아침에 저절로 넓어져요: 6일 6×4 · 11일 6×5 · 16일 7×5 · 21일 7×6 · 26일 8×6 · 31일 8×7. 납부에 실패해도 살아 있으면 넓어지고, 상품은 그 자리 그대로예요. 큰 진열대는 [확대 보기]로 밀어서 볼 수 있어요.</li>
      <li><b>등급 올리기</b>: 상품을 눌러 한 등급 위로. 하루 한 번, Ⅲ등급까지만(그 위는 합성), 알은 안 돼요. 값은 다음 등급 기본 매출의 6배 + 지금 등급×25에, 올릴 때마다 10씩 비싸져요. 결산 보상의 등급 올리기 이용권이 있으면 무료예요.</li>
      <li><b>팔기</b>: 상품을 빼면 기본 매출의 1.5배를 잔금으로 받아요. <b>넘기기</b>(→)도 잔금을 조금(2 + 날짜÷4) 줘요.</li>
      <li>빈칸이 3칸 이하로 줄면 입고 2번 자리는 고르는 즉시 합성되는 상품을 먼저 보여 줘요. 성장 조건을 못 채운 알이 있으면 3번 자리에 그 조건 상품이 자주 나와요.</li>
      <li>상품 누르기 → 놓을 칸 누르기 → 여기에 놓기. 끌어서 옮길 수도 있어요.</li>
      <li>영업 전까지는 되돌리기로 오늘 한 일을 되돌릴 수 있어요.</li>
      <li>키보드: R 회전 · Enter 놓기 · Ctrl+Z 되돌리기 · Esc 선택 해제 · Delete 팔기</li>
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
    filters.innerHTML = [['all', '전체'], ...CAT_IDS.map((c) => [c, CATS[c].name])]
      .map(([k, n]) => `<button data-filter="${k}" class="${filter === k ? 'on' : ''}">${k === 'all' ? '' : catIc(k)}${n}</button>`).join('');
    const ids = ITEM_IDS.filter((id) => filter === 'all' || ITEMS[id].cat === filter);
    body.innerHTML = `<div class="codex-grid">${ids.map((id) => {
      const it = ITEMS[id];
      const owned = state?.pieces?.filter((p) => p.id === id).length ?? 0;
      const chosen = state?.mutations?.[id];
      const art = it.egg ? `<span class="art evo"><img src="${img(`${id}_egg`)}" alt=""><i>→</i><img src="${img(id)}" alt=""></span>` : `<span class="art"><img src="${img(id)}" alt=""></span>`;
      return `<article class="cx">${art}
        <div class="h"><b>${it.egg ? `${it.egg.name} → ${it.name}` : it.name}</b><span class="cat" style="background:${CATS[it.cat].color}">${CATS[it.cat].name}</span>${owned ? `<span class="owned">진열 중 ${owned}</span>` : ''}</div>
        <div class="meta">${miniShape(id)} ${it.cells.length}칸 · 기본 ${it.egg ? `알 ${it.egg.base} → ${it.base}` : it.base}/일${it.egg ? ' · 자라도 모양 그대로' : ''}</div>
        ${it.egg ? `<div class="eff"><b>성장</b> ${it.egg.grow} · ${effectText(id, 1)}</div>` : `<div class="eff">${effectText(id, 1)}</div>`}
        <div class="mutcap">변이 · Ⅱ등급 기준 수치</div>
        <div class="muts">${['A', 'B'].map((m) => `<div class="mut"${chosen && chosen !== m ? ' style="opacity:.5"' : ''}><div class="mh">${hex(id, m)}${mutName(id, m)}${chosen === m ? ' ✓' : ''}</div>${mutText(id, m, 2)}</div>`).join('')}</div></article>`;
    }).join('')}</div>`;
    return;
  }
  filters.hidden = true;
  const regs = CAT_IDS.map((c) => CAT_GUEST[c]);
  const cards = regs.map((id) => {
    const c = CUSTOMERS[id];
    const fav = state?.favor?.[id] ?? 0;
    const reg = state?.regulars?.includes(id);
    const st = [...STAGES].reverse().find((t) => fav >= t.at);
    const now = state ? `<div class="state">${state.main === id ? '★ 주력 단골' : reg ? '★ 단골' : ''}${st && !reg ? st.name : ''} ${'♥'.repeat(Math.min(fav, 6)) || '호감 없음'}</div>` : '';
    return `<article class="gx"><img src="img/guest_${id}.png" alt=""><div><b>${c.name}</b><span class="cat" style="background:${CATS[c.fav].color}">${catIc(c.fav)}${CATS[c.fav].name}</span><div class="like">${c.text}</div>${now}</div>
      <dl><dt>호감 조건</dt><dd>${REGULAR[id].cond}</dd><dt>주력 효과</dt><dd>입고 1번 자리 ${CATS[c.fav].name} · 결산 보상</dd></dl></article>`;
  }).join('');
  body.innerHTML = `<p class="cx-lead">분야마다 한 집단. 최대 두 집단을 단골로 두고, 그중 주력 하나가 입고 1번 자리를 그 분야로 채워요.</p>
    <div class="codex-grid">${cards}</div>
    <div class="tier-box"><h4>친밀도 단계 · 호감은 방문 한 번에 최대 +1</h4><div class="tiers">
      <span><b>1 ♥ 관심 고객</b><small>관계 정보와 다음 목표 표시</small></span>
      <span><b>2 ♥ 단골</b><small>제안 수락 시 단골 자리 확보 · 주력이면 결산 때 무료 다시 뽑기 이용권</small></span>
      <span><b>4 ♥ 친한 단골</b><small>주력일 때 결산 보상에 Ⅰ등급 상품 선택 추가</small></span>
      <span><b>6 ♥ VIP 단골</b><small>주력일 때 결산 보상에 Ⅱ등급 상품 선택 추가</small></span></div></div>
    <p class="cx-lead">특별 손님 · 분야 입고는 맡지 않고 단골이 되지 않아요</p>
    <div class="sp-guests">${SPECIAL_GUESTS.map((id) => `<span><img src="img/guest_${id}.png" alt=""><b>${CUSTOMERS[id].name}</b><small>${CUSTOMERS[id].text}</small></span>`).join('')}</div>`;
}
