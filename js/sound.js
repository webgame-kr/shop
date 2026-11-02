// 효과음과 배경음. 기획서대로 처음엔 꺼져 있고, 켤 때 처음으로 파일을 받아 Web Audio로 재생한다.
const KEY = 'demon-shop:sound';

// 이름 → 파일 개수(여러 개면 _1.._n 중 하나를 무작위로)
const SFX = {
  ui_tap: 3, item_pick: 1, item_place: 3, item_rotate: 1, place_invalid: 1, undo: 1, discard: 1, reroll: 1,
  merge_ready: 1, merge_complete: 1, contract_open: 1, contract_sign: 1, contract_reject: 1,
  open_shop: 1, coin_tick: 5, pay_success: 1, pay_fail: 1, flame_out: 1, settlement_toll: 1,
  reward_pick: 1, seized: 1, demon_voice: 3,
};
const VOLUME = { sfx: 0.8, bgm: 0.32 };

let ctx = null;
let master = { sfx: null, bgm: null };
const buffers = new Map();
const loading = new Map();
let bgmSource = null;
let prefs = { sfx: false, bgm: false };
try { prefs = { ...prefs, ...JSON.parse(localStorage.getItem(KEY)) }; } catch { /* 기본값 */ }

function files(name) {
  const n = SFX[name] ?? 1;
  return n === 1 ? [`${name}.wav`] : Array.from({ length: n }, (_, i) => `${name}_${i + 1}.wav`);
}

function ensureContext() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  for (const k of ['sfx', 'bgm']) {
    master[k] = ctx.createGain();
    master[k].gain.value = VOLUME[k];
    master[k].connect(ctx.destination);
  }
  return ctx;
}

function load(file) {
  if (buffers.has(file)) return Promise.resolve(buffers.get(file));
  if (!loading.has(file)) {
    loading.set(file, fetch(`sound/${file}`)
      .then((r) => r.arrayBuffer())
      .then((a) => new Promise((ok, bad) => ctx.decodeAudioData(a, ok, bad)))
      .then((b) => { buffers.set(file, b); return b; })
      .catch(() => null));
  }
  return loading.get(file);
}

function preloadSfx() {
  for (const name of Object.keys(SFX)) files(name).forEach(load);
}

// 브라우저는 사용자가 누른 뒤에만 소리를 낼 수 있다
function unlock() {
  if (ctx && ctx.state === 'suspended') ctx.resume();
}

export function isOn(kind) { return prefs[kind]; }

export function setOn(kind, on) {
  prefs[kind] = on;
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* 저장 불가 */ }
  if (on && ensureContext()) {
    unlock();
    if (kind === 'sfx') preloadSfx();
  }
  if (kind === 'bgm') (on ? startBgm() : stopBgm());
}

export function play(name, { delay = 0, rate = 1 } = {}) {
  if (!prefs.sfx || !ensureContext()) return;
  const list = files(name);
  const file = list[Math.floor(Math.random() * list.length)];
  const go = (buf) => {
    if (!buf || !prefs.sfx) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    src.connect(master.sfx);
    src.start(ctx.currentTime + delay);
  };
  const b = buffers.get(file);
  if (b) go(b); else load(file).then(go);
}

async function startBgm() {
  if (!prefs.bgm || bgmSource || !ensureContext()) return;
  const buf = await load('bgm_loop.wav');
  if (!buf || !prefs.bgm || bgmSource) return;
  bgmSource = ctx.createBufferSource();
  bgmSource.buffer = buf;
  bgmSource.loop = true;
  bgmSource.connect(master.bgm);
  bgmSource.start();
}

function stopBgm() {
  if (!bgmSource) return;
  try { bgmSource.stop(); } catch { /* 이미 멈춤 */ }
  bgmSource = null;
}

// 저장된 설정이 켜져 있으면 첫 터치 때 소리를 시작한다. 다른 탭으로 가면 멈춘다.
export function init() {
  const first = () => {
    if (prefs.sfx || prefs.bgm) {
      ensureContext();
      unlock();
      if (prefs.sfx) preloadSfx();
      startBgm();
    }
  };
  window.addEventListener('pointerdown', first, { once: true, capture: true });
  window.addEventListener('keydown', first, { once: true, capture: true });
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) ctx.suspend(); else if (prefs.sfx || prefs.bgm) ctx.resume();
  });
}
