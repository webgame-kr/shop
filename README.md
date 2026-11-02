# 작은 배낭 상점

작은 진열대(6×5)에 상품을 채우고, 맞닿은 상품끼리의 조합으로 8일 동안 매출을 올리는 배치 전략 웹게임. 서버 없이 정적 파일만으로 돈다.

## 실행

ES 모듈을 쓰므로 `file://`이 아니라 아무 정적 서버로 연다.

```bash
python -m http.server 3600 --directory shop
```

`http://localhost:3600`. 저장소 루트의 `.claude/launch.json`에 `small-shop`으로도 등록돼 있다.

## 구조

| 파일 | 내용 |
|---|---|
| `js/rules.js` | 상품 12종, 모양 회전, 겹침 판정, 하루 수익 계산, 등급. DOM 없음 |
| `js/game.js` | 한 판의 상태(JSON 하나): 후보 제시(시드 고정), 선택·배치·이동·폐기·넘기기, 되돌리기, 영업 정산 |
| `js/ui.js` | 시작·플레이·결과 화면, 선택 후 위치 누르기(끌기는 보조), 첫 플레이 안내, 자동 저장 |
| `js/card.js` | 결과 공유용 1080×1350 이미지 |
| `scripts/simulate.js` | 봇으로 여러 판을 돌려 매출 분포와 등급 비율을 본다 |

## 테스트와 수치 검증

```bash
cd shop && node --test test/
cd shop && node scripts/simulate.js 300
```

등급 기준은 기획서 시험값(260/340/420)에서 320/420/520으로 올렸다. 시뮬레이션에서 아무 후보나 골라 처음 빈칸에 놓는 봇이 중앙값 323, 당장 수익만 보는 봇이 중앙값 492였기 때문이다. 실제 플레이 후 `js/rules.js`의 `GRADES`를 다시 조정한다.

## 저장

`localStorage`에 `small-shop:run`(진행 중인 판, 되돌리기 기록 포함), `small-shop:best`(개인 최고), `small-shop:tutorial-done`을 둔다. 후보는 시드와 난수 상태가 함께 저장되므로 새로고침해도 바뀌지 않는다.
