(() => {
'use strict';

/* ============ 定数・データ ============ */
const G = 9.81, RHO = 1.225;
const EX = 3;            // 上下動の表示倍率
const FLOW_H = 3.3;      // 気流を描く高さ(m)
const COL = { front: '#3987e5', drag: '#d95926', rear: '#199e70', road: '#8f8e84' };

// 寸法はm。top は後ろ(0)から前(L)への屋根ライン
const CARS = {
  hatch: {
    name: 'コンパクトハッチ', mass: 1100, frontRatio: 0.62, L: 3.9, wb: 2.5, rearAxle: 0.65,
    cd: 0.33, area: 2.05, clf: 0.08, clr: 0.12, powerKW: 80, kF: 22, kR: 16, mu: 35,
    cgH: 0.55, track: 1.48, wheelR: 0.30, rearH: 1.38, wake: 1.3, wakeLen: 1.7, body: '#d8473b',
    top: [[0, 0.95], [0.12, 1.38], [0.5, 1.5], [1.9, 1.5], [2.2, 1.46], [2.95, 1.0], [3.75, 0.86], [3.9, 0.6]],
    win: [[0.35, 1.05], [0.55, 1.4], [1.9, 1.4], [2.15, 1.37], [2.75, 1.02]],
    spoiler: [[0.14, 1.39], [-0.16, 1.44], [-0.16, 1.40], [0.1, 1.33]],
    wing: [0.02, 1.66, 1.36]
  },
  coupe: {
    name: 'クーペ', mass: 1350, frontRatio: 0.54, L: 4.4, wb: 2.6, rearAxle: 0.85,
    cd: 0.29, area: 1.95, clf: 0.06, clr: 0.09, powerKW: 200, kF: 30, kR: 28, mu: 40,
    cgH: 0.48, track: 1.54, wheelR: 0.33, rearH: 0.92, wake: 0.8, wakeLen: 1.1, body: '#2f6fd0',
    top: [[0, 0.82], [0.4, 0.95], [0.55, 0.96], [1.55, 1.27], [2.2, 1.3], [2.5, 1.25], [3.1, 0.92], [4.2, 0.76], [4.4, 0.55]],
    win: [[1.0, 0.98], [1.6, 1.2], [2.2, 1.22], [2.45, 1.18], [2.95, 0.93]],
    spoiler: [[0.42, 0.95], [-0.04, 1.03], [-0.04, 0.82], [0.02, 0.82]],
    wing: [0.2, 1.24, 0.9]
  }
};
const SPRINGS = { stock: { k: 1, drop: 0 }, sport: { k: 1.35, drop: 25 }, coil: { k: 2.2, drop: 45 } };
const TYRES = {
  comfort: { mu: 0.90, kt: 190, crr: 0.010 },
  sport:   { mu: 1.05, kt: 220, crr: 0.012 },
  semi:    { mu: 1.25, kt: 250, crr: 0.014 }
};

const state = {
  car: 'hatch', speed: 80, road: 'bump',
  spring: 'stock', damper: 'stock', clicks: 8, stab: 'stock', tyre: 'comfort',
  front: 'none', rear: 'none', wingAngle: 6, tray: false, diff: false,
  showFlow: true, showForce: true
};

let D = {};   // 現在の組み合わせから計算した値

/* ============ 計算 ============ */
function derive() {
  const c = CARS[state.car], sp = SPRINGS[state.spring], ty = TYRES[state.tyre];
  const dMult = state.damper === 'stock' ? 1 : state.damper === 'sport' ? 1.5 : 0.7 + (state.clicks - 1) * 0.16;
  const axle = (ratio, kStock) => {
    const ms = c.mass * ratio / 2 - c.mu;
    const k = kStock * 1000 * sp.k;
    const cStock = 2 * 0.28 * Math.sqrt(kStock * 1000 * ms);
    const cc = cStock * dMult;
    return { ms, mu: c.mu, k, c: cc, kt: ty.kt * 1000, W: (ms + c.mu) * G,
             freq: Math.sqrt(k / ms) / (2 * Math.PI), zeta: cc / (2 * Math.sqrt(k * ms)) };
  };
  const F = axle(c.frontRatio, c.kF), R = axle(1 - c.frontRatio, c.kR);

  // 空力係数
  let cd = c.cd, clf = c.clf, clr = c.clr;
  if (state.front === 'lip') { cd += 0.004; clf -= 0.04; }
  if (state.front === 'splitter') { cd += 0.010; clf -= 0.11; clr += 0.01; }
  if (state.rear === 'spoiler') { cd += 0.006; clr -= 0.07; }
  if (state.rear === 'wing') {
    const a = state.wingAngle;
    cd += 0.015 + 0.0035 * a; clr -= 0.12 + 0.022 * a; clf += 0.01 + 0.002 * a;
  }
  if (state.tray) { cd -= 0.015; clf -= 0.025; clr -= 0.02; }
  if (state.diff) { cd -= 0.004; clf -= 0.015; clr -= state.tray ? 0.09 : 0.06; }
  cd -= 0.0002 * sp.drop; clf -= 0.0005 * sp.drop; clr -= 0.0005 * sp.drop;

  // ロール剛性
  const stockRoll = (c.kF + c.kR) * 1000 * c.track * c.track / 2;
  const kRoll = stockRoll * sp.k + stockRoll * 0.4 * (state.stab === 'hard' ? 1.6 : 1);
  const hRoll = c.cgH - sp.drop / 1000 - 0.1;
  const roll = (c.mass - 4 * c.mu) * 0.8 * G * hRoll / kRoll * 180 / Math.PI;

  D = { car: c, F, R, cd, clf, clr, drop: sp.drop / 1000, tyre: ty, roll };

  // 最高速（二分法）
  const pWheel = c.powerKW * 1000 * 0.88;
  let lo = 0, hi = 130;
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if (needPower(m) < pWheel) lo = m; else hi = m;
  }
  D.top = lo * 3.6;

  // グラフ用（速度ごとの力）
  D.curve = [];
  for (let kmh = 0; kmh <= 250; kmh += 5) {
    const a = aeroAt(kmh / 3.6);
    D.curve.push({ x: kmh, drag: a.drag, dfF: -a.liftF, dfR: -a.liftR });
  }
  buildFlow();
  updateStaticTiles();
  drawAeroChart();
}

function aeroAt(v) {
  const q = 0.5 * RHO * v * v * D.car.area;
  return { drag: q * D.cd, liftF: q * D.clf, liftR: q * D.clr };
}
function needPower(v) {
  return (aeroAt(v).drag + D.tyre.crr * D.car.mass * G) * v;
}
function topAt(c, x) {
  const p = c.top;
  if (x <= p[0][0]) return p[0][1];
  for (let i = 1; i < p.length; i++) {
    if (x <= p[i][0]) {
      const t = (x - p[i - 1][0]) / (p[i][0] - p[i - 1][0]);
      return p[i - 1][1] + t * (p[i][1] - p[i - 1][1]);
    }
  }
  return p[p.length - 1][1];
}

/* ---- 気流の簡易モデル：車体の高さに沿って流線を持ち上げる ---- */
const flow = { x0: -4, step: 0.05, T: [] };
function buildFlow() {
  const c = D.car, n = Math.ceil(11.5 / flow.step);
  let rearH = c.rearH - D.drop;
  if (state.rear === 'spoiler') rearH += 0.06;
  if (state.rear === 'wing') rearH += 0.1 + 0.012 * state.wingAngle;
  const wakeLen = c.wakeLen * (state.diff ? 0.88 : 1);
  const raw = [];
  for (let i = 0; i < n; i++) {
    const x = flow.x0 + i * flow.step;
    if (x < 0) raw.push(rearH * Math.exp(x / wakeLen));
    else if (x > c.L) raw.push(0.6 * Math.exp(-(x - c.L) / 0.45));
    else raw.push(topAt(c, x) - D.drop);
  }
  flow.T = raw.map((_, i) => {
    let s = 0, m = 0;
    for (let j = i - 6; j <= i + 6; j++) if (j >= 0 && j < n) { s += raw[j]; m++; }
    return s / m;
  });
}
function flowT(x) {
  const i = Math.round((x - flow.x0) / flow.step);
  return flow.T[Math.max(0, Math.min(flow.T.length - 1, i))] || 0;
}

/* ---- 路面 ---- */
function roadZ(x) {
  switch (state.road) {
    case 'bump': { const p = ((x % 25) + 25) % 25; return p < 0.6 ? 0.04 * Math.sin(Math.PI * p / 0.6) : 0; }
    case 'wave': return 0.025 * Math.sin(2 * Math.PI * x / 12);
    case 'rough':
      return 0.004 * Math.sin(x * 8.9 + 1) + 0.005 * Math.sin(x * 4.7 + 2.1) + 0.006 * Math.sin(x * 2.2 + 0.4)
           + 0.007 * Math.sin(x * 1.21 + 4) + 0.008 * Math.sin(x * 0.57 + 3);
    default: return 0;
  }
}

/* ---- サスペンション（前後それぞれ2自由度） ---- */
const sim = { X: 0, t: 0, traceT: 0, trace: [], rideMS: 0, loadMS: 0, ax: null };
function resetSim() {
  sim.ax = [0, 1].map(() => ({ zs: 0, vs: 0, zu: 0, vu: 0, zr: 0, acc: 0, load: 0 }));
  sim.trace = []; sim.rideMS = 0; sim.loadMS = 0;
}
function stepAxle(a, p, zr, lift, dt) {
  const travel = a.zs - a.zu, rel = a.vs - a.vu, lim = 0.075;
  let fs = -p.k * travel - p.c * rel;
  if (travel < -lim) fs += p.k * 10 * (-lim - travel);       // バンプストップ
  else if (travel > lim) fs -= p.k * 10 * (travel - lim);
  const load = Math.max(0, p.W + p.kt * (zr - a.zu));          // タイヤは路面を引っ張れない
  const as = (fs + lift) / p.ms;
  const au = (-fs + load - p.W) / p.mu;
  a.vs += as * dt; a.vu += au * dt;
  a.zs += a.vs * dt; a.zu += a.vu * dt;
  a.zr = zr; a.acc = as; a.load = load;
}
function stepSim(dtFrame) {
  const v = state.speed / 3.6, c = D.car;
  const aero = aeroAt(v);
  const n = Math.max(1, Math.ceil(dtFrame / 0.0005)), dt = dtFrame / n;
  for (let i = 0; i < n; i++) {
    sim.X += v * dt; sim.t += dt;
    stepAxle(sim.ax[0], D.F, roadZ(sim.X + c.wb), aero.liftF / 2, dt);
    stepAxle(sim.ax[1], D.R, roadZ(sim.X), aero.liftR / 2, dt);
    const k = dt / 2;   // 約2秒の移動平均
    const acc = (sim.ax[0].acc + sim.ax[1].acc) / 2;
    sim.rideMS += (acc * acc - sim.rideMS) * k;
    const expF = D.F.W - aero.liftF / 2, expR = D.R.W - aero.liftR / 2;
    const dv = ((sim.ax[0].load - expF) / D.F.W) ** 2 / 2 + ((sim.ax[1].load - expR) / D.R.W) ** 2 / 2;
    sim.loadMS += (dv - sim.loadMS) * k;
    sim.traceT += dt;
    if (sim.traceT >= 0.02) {
      sim.traceT = 0;
      sim.trace.push({ t: sim.t, f: sim.ax[0].zs * 1000, r: sim.ax[1].zs * 1000, road: sim.ax[0].zr * 1000 });
      if (sim.trace.length > 200) sim.trace.shift();
    }
  }
}

/* ============ 描画：メイン画面 ============ */
const scene = document.getElementById('scene');
const sx = scene.getContext('2d');
let view = { w: 0, h: 0, s: 1, viewW: 10, rearX: 3.6, groundY: 0 };
let flowPhase = 0;

function fitCanvas(cv, cssH) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = cv.clientWidth;
  if (cssH) cv.style.height = cssH + 'px';
  const h = cssH || cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { w, h };
}
function resizeScene() {
  const w = scene.clientWidth, narrow = w < 560;
  const viewW = narrow ? 8.4 : 10;
  const h = Math.round(w * (narrow ? 0.58 : 0.44));
  fitCanvas(scene, h);
  const s = w / viewW;
  view = { w, h, s, viewW, rearX: viewW * 0.36, groundY: h - 0.42 * s };
}
const PX = x => (view.rearX + x) * view.s;          // 車の座標(m) → 画面x
const PY = y => view.groundY - y * view.s;          // 高さ(m) → 画面y

function mix(a, b, t) { t = Math.max(0, Math.min(1, t)); return a.map((v, i) => Math.round(v + (b[i] - v) * t)); }
function flowColor(r) {
  const base = [150, 190, 230], slow = [62, 100, 170], fast = [255, 150, 85];
  const c = r < 1 ? mix(base, slow, (1 - r) / 0.55) : mix(base, fast, (r - 1) / 0.8);
  return `rgba(${c[0]},${c[1]},${c[2]},0.8)`;
}
function drawFlow(v) {
  const c = D.car, s = view.s;
  const xL = -view.rearX, xR = view.viewW - view.rearX;
  const mkGrad = lower => {
    const g = sx.createLinearGradient(0, 0, view.w, 0);
    for (let i = 0; i <= 24; i++) {
      const x = xL + (xR - xL) * i / 24;
      let r = FLOW_H / (FLOW_H - flowT(x));
      if (x < 0) r = lower ? 1 - 0.55 * Math.exp(x / 2.5) : 1 + (r - 1) * Math.exp(x / 0.8);
      g.addColorStop(i / 24, flowColor(r));
    }
    return g;
  };
  const gUp = mkGrad(false), gLow = mkGrad(true);
  const NL = 13, wakeAmp = 0.1 * (D.cd / 0.3) * c.wake * Math.min(1, v / 15);
  sx.lineWidth = 1.6; sx.setLineDash([14, 10]); sx.lineDashOffset = flowPhase;
  for (let i = 0; i < NL; i++) {
    const h0 = 0.12 + i * (3.05 - 0.12) / (NL - 1);
    sx.strokeStyle = i < 4 ? gLow : gUp;
    sx.beginPath();
    for (let x = xL; x <= xR + 0.01; x += 0.08) {
      const T = flowT(x);
      let y = T + h0 * (FLOW_H - T) / FLOW_H;
      if (x < 0 && i < 5) {
        y += wakeAmp * Math.exp(x / 3) * (1 - i / 5) * (1 - Math.exp(x / 0.5))
           * Math.sin(x * 5 + sim.t * 0.27 * v + i * 1.7);
      }
      if (x === xL) sx.moveTo(PX(x), PY(y)); else sx.lineTo(PX(x), PY(y));
    }
    sx.stroke();
  }
  sx.setLineDash([]);
}

function drawRoad() {
  const c = D.car, s = view.s;
  const axV = view.rearX + c.rearAxle;       // 後輪の画面位置(m)
  sx.beginPath();
  sx.moveTo(0, view.h);
  for (let vx = 0; vx <= view.viewW + 0.05; vx += 0.04) {
    sx.lineTo(vx * s, view.groundY - EX * roadZ(sim.X + vx - axV) * s);
  }
  sx.lineTo(view.w, view.h); sx.closePath();
  sx.fillStyle = '#23262b'; sx.fill();
  sx.strokeStyle = '#5b6068'; sx.lineWidth = 2; sx.stroke();
  // 流れる目印
  sx.fillStyle = '#3d4249';
  const start = Math.floor(sim.X - axV);
  for (let m = start; m < start + view.viewW + 2; m += 2) {
    const vx = m - (sim.X - axV);
    sx.fillRect(vx * s, view.groundY + 0.16 * s, 0.7 * s, 0.05 * s);
  }
}

function poly(pts, ox) {
  sx.beginPath();
  pts.forEach((p, i) => { const x = (p[0] - ox) * view.s, y = -p[1] * view.s; i ? sx.lineTo(x, y) : sx.moveTo(x, y); });
  sx.closePath();
}
function drawCar() {
  const c = D.car, s = view.s, a = sim.ax;
  const oF = -D.drop + EX * a[0].zs, oR = -D.drop + EX * a[1].zs;
  const pitch = Math.atan2(oF - oR, c.wb), ox = c.rearAxle;
  const part = '#b4bcc6';

  sx.save();
  sx.translate(PX(c.rearAxle), PY(oR));
  sx.rotate(-pitch);
  sx.lineJoin = 'round';

  // GTウイング
  if (state.rear === 'wing') {
    const [wx, wy, base] = c.wing;
    sx.strokeStyle = part; sx.lineWidth = 0.035 * s;
    sx.beginPath(); sx.moveTo((wx + 0.12 - ox) * s, -base * s + 0.1 * s); sx.lineTo((wx + 0.05 - ox) * s, -wy * s); sx.stroke();
    sx.save();
    sx.translate((wx - ox) * s, -wy * s);
    sx.rotate(state.wingAngle * Math.PI / 180);
    sx.fillStyle = part;
    sx.beginPath(); sx.ellipse(0, 0, 0.21 * s, 0.028 * s, 0, 0, Math.PI * 2); sx.fill();
    sx.fillRect(-0.22 * s, -0.11 * s, 0.03 * s, 0.17 * s);
    sx.restore();
  }
  // ボディ
  const body = [[0, 0.24], ...c.top, [c.L, 0.24]];
  poly(body, ox); sx.fillStyle = c.body; sx.fill();
  sx.strokeStyle = 'rgba(0,0,0,.35)'; sx.lineWidth = 1.5; sx.stroke();
  poly(c.win, ox); sx.fillStyle = '#1b2733'; sx.fill();
  // 下まわりの帯
  sx.fillStyle = 'rgba(0,0,0,.28)';
  sx.fillRect(-ox * s, -0.42 * s, c.L * s, 0.18 * s);
  // ライト
  sx.fillStyle = '#ffe9a8'; sx.fillRect((c.L - 0.2 - ox) * s, -(c.top[c.top.length - 1][1] + 0.1) * s, 0.16 * s, 0.07 * s);
  sx.fillStyle = '#ff5a4d'; sx.fillRect((0.0 - ox) * s, -(c.top[0][1] - 0.08) * s, 0.07 * s, 0.1 * s);

  // 空力パーツ
  sx.fillStyle = part;
  if (state.rear === 'spoiler') { poly(c.spoiler, ox); sx.fill(); }
  if (state.front === 'lip') sx.fillRect((c.L - 0.12 - ox) * s, -0.26 * s, 0.2 * s, 0.06 * s);
  if (state.front === 'splitter') sx.fillRect((c.L - 0.2 - ox) * s, -0.235 * s, 0.38 * s, 0.035 * s);
  if (state.diff) { poly([[0.55, 0.2], [0, 0.4], [0, 0.24], [0.1, 0.2]], ox); sx.fill(); }
  if (state.tray) { sx.fillStyle = part; sx.fillRect((0.6 - ox) * s, -0.235 * s, (c.L - 0.9) * s, 0.025 * s); }

  // ホイールアーチ
  sx.fillStyle = '#0d0e10';
  [0, c.wb].forEach(x => { sx.beginPath(); sx.arc(x * s, -(c.wheelR + D.drop * 0.3) * s, c.wheelR * 1.2 * s, Math.PI, 0); sx.fill(); });
  sx.restore();

  // タイヤ（路面に追従）
  const rot = sim.X / c.wheelR;
  [[c.rearAxle, a[1].zu], [c.rearAxle + c.wb, a[0].zu]].forEach(([x, zu]) => {
    const cx = PX(x), cy = PY(c.wheelR + EX * zu), r = c.wheelR * s;
    sx.fillStyle = '#17181a'; sx.beginPath(); sx.arc(cx, cy, r, 0, Math.PI * 2); sx.fill();
    sx.fillStyle = '#b9bec6'; sx.beginPath(); sx.arc(cx, cy, r * 0.62, 0, Math.PI * 2); sx.fill();
    sx.strokeStyle = '#4a4f57'; sx.lineWidth = Math.max(1.5, r * 0.1);
    for (let k = 0; k < 5; k++) {
      const ang = rot + k * Math.PI * 2 / 5;
      sx.beginPath(); sx.moveTo(cx, cy); sx.lineTo(cx + Math.cos(ang) * r * 0.6, cy + Math.sin(ang) * r * 0.6); sx.stroke();
    }
  });
}

function arrow(x1, y1, x2, y2, color, label, align) {
  const ang = Math.atan2(y2 - y1, x2 - x1), hd = 9;
  sx.strokeStyle = color; sx.fillStyle = color; sx.lineWidth = 3; sx.lineCap = 'round';
  sx.beginPath(); sx.moveTo(x1, y1); sx.lineTo(x2, y2); sx.stroke();
  sx.beginPath(); sx.moveTo(x2, y2);
  sx.lineTo(x2 - hd * Math.cos(ang - 0.45), y2 - hd * Math.sin(ang - 0.45));
  sx.lineTo(x2 - hd * Math.cos(ang + 0.45), y2 - hd * Math.sin(ang + 0.45));
  sx.closePath(); sx.fill();
  sx.font = '600 12px system-ui, sans-serif'; sx.textAlign = align || 'center';
  sx.lineWidth = 3; sx.strokeStyle = 'rgba(12,15,20,.85)';
  const lx = align === 'right' ? Math.min(x1, x2) - 6 : x1, ly = align === 'right' ? y1 + 4 : Math.min(y1, y2) - 8;
  sx.strokeText(label, lx, ly); sx.fillStyle = '#f0efec'; sx.fillText(label, lx, ly);
}
function drawForces(v) {
  if (v < 3) return;
  const c = D.car, a = aeroAt(v), s = view.s;
  const dl = Math.min(2.6, a.drag / 1200);
  if (dl > 0.08) arrow(PX(-0.25), PY(0.62), PX(-0.25 - dl), PY(0.62), COL.drag, `抵抗 ${Math.round(a.drag)}N`, 'right');
  [[c.rearAxle + c.wb, a.liftF, COL.front, '前'], [c.rearAxle, a.liftR, COL.rear, '後']].forEach(([x, lift, col, name]) => {
    const len = Math.min(1.3, Math.abs(lift) / 1200);
    if (len < 0.06) return;
    const topY = topAt(c, x) - D.drop + 0.3;
    if (lift < 0) arrow(PX(x), PY(topY + len + 0.25), PX(x), PY(topY + 0.25), col, `${name} ↓${Math.round(-lift)}N`);
    else arrow(PX(x), PY(topY), PX(x), PY(topY + len), col, `${name} ↑${Math.round(lift)}N`);
  });
}

function drawScene() {
  const v = state.speed / 3.6;
  sx.clearRect(0, 0, view.w, view.h);
  const g = sx.createLinearGradient(0, 0, 0, view.h);
  g.addColorStop(0, '#0c0f14'); g.addColorStop(1, '#151a22');
  sx.fillStyle = g; sx.fillRect(0, 0, view.w, view.h);
  if (state.showFlow) drawFlow(v);
  drawRoad();
  drawCar();
  if (state.showForce) drawForces(v);
}

/* ============ グラフ ============ */
function niceStep(x) {
  const p = Math.pow(10, Math.floor(Math.log10(x))), n = x / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}
function drawChart(cv, cfg) {
  const { w, h } = fitCanvas(cv);
  const ctx = cv.getContext('2d');
  const m = { l: 46, r: 12, t: 22, b: 26 }, pw = w - m.l - m.r, ph = h - m.t - m.b;
  let ymin = cfg.ymin, ymax = cfg.ymax;
  const step = niceStep((ymax - ymin) / 4);
  ymin = Math.floor(ymin / step) * step; ymax = Math.ceil(ymax / step) * step;
  const X = x => m.l + (x - cfg.xmin) / (cfg.xmax - cfg.xmin) * pw;
  const Y = y => m.t + (1 - (y - ymin) / (ymax - ymin)) * ph;
  ctx.clearRect(0, 0, w, h);
  ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = '#8f8e84'; ctx.lineWidth = 1;
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let y = ymin; y <= ymax + step / 2; y += step) {
    ctx.strokeStyle = Math.abs(y) < step / 1000 ? '#5a5a52' : '#2c2c29';
    ctx.beginPath(); ctx.moveTo(m.l, Y(y)); ctx.lineTo(w - m.r, Y(y)); ctx.stroke();
    ctx.fillText(String(Math.round(y * 100) / 100), m.l - 6, Y(y));
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  cfg.xticks.forEach(t => ctx.fillText(t.label, X(t.x), h - m.b + 7));
  ctx.textAlign = 'left'; ctx.fillText(cfg.unit, 4, 0);
  if (cfg.markerX != null) {
    ctx.strokeStyle = '#c3c2b7'; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(X(cfg.markerX), m.t); ctx.lineTo(X(cfg.markerX), m.t + ph); ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.lineJoin = 'round';
  cfg.series.forEach(sr => {
    ctx.strokeStyle = sr.color; ctx.lineWidth = sr.thin ? 1.2 : 2;
    ctx.setLineDash(sr.thin ? [3, 3] : []);
    ctx.beginPath();
    sr.pts.forEach((p, i) => i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1])));
    ctx.stroke();
  });
  ctx.setLineDash([]);
  if (cfg.hoverX != null) {
    ctx.strokeStyle = '#6b6b63'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(X(cfg.hoverX), m.t); ctx.lineTo(X(cfg.hoverX), m.t + ph); ctx.stroke();
    cfg.series.forEach(sr => {
      const p = nearest(sr.pts, cfg.hoverX); if (!p) return;
      ctx.fillStyle = sr.color; ctx.strokeStyle = '#1a1a19'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(X(p[0]), Y(p[1]), 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    });
  }
  cv._geo = { m, pw, xmin: cfg.xmin, xmax: cfg.xmax, X };
}
function nearest(pts, x) {
  let best = null, d = Infinity;
  for (const p of pts) { const dd = Math.abs(p[0] - x); if (dd < d) { d = dd; best = p; } }
  return best;
}
function attachHover(cv, tip, onMove) {
  const move = e => {
    const g = cv._geo; if (!g) return;
    const r = cv.getBoundingClientRect();
    const px = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
    const t = Math.max(0, Math.min(1, (px - g.m.l) / g.pw));
    const html = onMove(g.xmin + t * (g.xmax - g.xmin));
    if (!html) { tip.style.display = 'none'; return; }
    tip.innerHTML = html; tip.style.display = 'block';
    const tw = tip.offsetWidth;
    tip.style.left = Math.max(0, Math.min(r.width - tw, px + (px > r.width / 2 ? -tw - 12 : 12))) + 'px';
    tip.style.top = '8px';
  };
  const leave = () => { tip.style.display = 'none'; onMove(null); };
  cv.addEventListener('mousemove', move); cv.addEventListener('mouseleave', leave);
  cv.addEventListener('touchstart', move, { passive: true }); cv.addEventListener('touchmove', move, { passive: true });
  cv.addEventListener('touchend', leave);
}
const row = (color, name, val) => `<div><i style="background:${color}"></i>${name}：<b>${val}</b></div>`;
function legend(el, items) {
  el.innerHTML = items.map(i => `<span><i style="background:${i[0]}"></i>${i[1]}</span>`).join('');
}

const chartAero = document.getElementById('chartAero'), chartSus = document.getElementById('chartSus');
let aeroHover = null, susHover = null;
function drawAeroChart() {
  if (!D.curve) return;
  const all = D.curve.flatMap(p => [p.drag, p.dfF, p.dfR]);
  drawChart(chartAero, {
    xmin: 0, xmax: 250, ymin: Math.min(0, ...all), ymax: Math.max(100, ...all), unit: 'N',
    xticks: [0, 50, 100, 150, 200, 250].map(x => ({ x, label: x + (x === 250 ? 'km/h' : '') })),
    markerX: state.speed, hoverX: aeroHover,
    series: [
      { color: COL.front, pts: D.curve.map(p => [p.x, p.dfF]) },
      { color: COL.drag, pts: D.curve.map(p => [p.x, p.drag]) },
      { color: COL.rear, pts: D.curve.map(p => [p.x, p.dfR]) }
    ]
  });
}
function drawSusChart() {
  const tr = sim.trace; if (tr.length < 2) return;
  const t1 = tr[tr.length - 1].t, t0 = t1 - 4;
  let mx = 20;
  tr.forEach(p => { mx = Math.max(mx, Math.abs(p.f), Math.abs(p.r), Math.abs(p.road)); });
  const lim = Math.ceil(mx / 20) * 20;
  drawChart(chartSus, {
    xmin: t0, xmax: t1, ymin: -lim, ymax: lim, unit: 'mm',
    xticks: [0, 1, 2, 3, 4].map(k => ({ x: t0 + k, label: k === 4 ? '今' : `${k - 4}秒` })),
    hoverX: susHover == null ? null : t1 - susHover,
    series: [
      { color: COL.road, thin: true, pts: tr.map(p => [p.t, p.road]) },
      { color: COL.front, pts: tr.map(p => [p.t, p.f]) },
      { color: COL.rear, pts: tr.map(p => [p.t, p.r]) }
    ]
  });
}

/* ============ 数値タイル ============ */
const $ = id => document.getElementById(id);
const sgn = n => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n);
function updateStaticTiles() {
  $('tFreq').textContent = `${D.F.freq.toFixed(2)} / ${D.R.freq.toFixed(2)}`;
  $('tZeta').textContent = `${D.F.zeta.toFixed(2)} / ${D.R.zeta.toFixed(2)}`;
  $('tRoll').textContent = D.roll.toFixed(1);
  $('tCd').textContent = D.cd.toFixed(3);
  $('tTop').textContent = Math.round(D.top);
  updateSpeedTiles();
}
function updateSpeedTiles() {
  const v = state.speed / 3.6, a = aeroAt(v), c = D.car;
  $('speedNum').textContent = state.speed;
  $('tDrag').textContent = Math.round(a.drag);
  $('tDf').textContent = `${sgn(Math.round(-a.liftF))} / ${sgn(Math.round(-a.liftR))}`;
  $('tPow').textContent = (needPower(v) / 0.88 / 1000).toFixed(1);
  $('tSink').textContent = `${sgn(Math.round(a.liftF / 2 / D.F.k * 1000))} / ${sgn(Math.round(a.liftR / 2 / D.R.k * 1000))}`;
  const gmax = D.tyre.mu * Math.max(0, 1 - (a.liftF + a.liftR) / (c.mass * G));
  $('tG').textContent = gmax.toFixed(2);
}
function updateLiveTiles() {
  $('tRide').textContent = Math.sqrt(sim.rideMS).toFixed(2);
  $('tLoad').textContent = (Math.sqrt(sim.loadMS) * 100).toFixed(1);
}

/* ============ 操作 ============ */
function bind() {
  document.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.seg button').forEach(x => x.classList.toggle('on', x === b));
    state.car = b.dataset.car; derive(); resetSim();
  }));
  $('speed').addEventListener('input', e => { state.speed = +e.target.value; updateSpeedTiles(); drawAeroChart(); });
  ['road', 'spring', 'damper', 'stab', 'tyre', 'front', 'rear'].forEach(id =>
    $(id).addEventListener('change', e => { state[id] = e.target.value; sync(); derive(); }));
  $('clicks').addEventListener('input', e => { state.clicks = +e.target.value; sync(); derive(); });
  $('wingAngle').addEventListener('input', e => { state.wingAngle = +e.target.value; sync(); derive(); });
  ['tray', 'diff', 'showFlow', 'showForce'].forEach(id =>
    $(id).addEventListener('change', e => { state[id] = e.target.checked; derive(); }));

  attachHover(chartAero, $('tipAero'), x => {
    if (x == null) { aeroHover = null; drawAeroChart(); return; }
    const p = D.curve[Math.round(x / 5)]; aeroHover = p.x; drawAeroChart();
    return `<div>${p.x} km/h</div>` + row(COL.front, '前ダウンフォース', sgn(Math.round(p.dfF)) + ' N')
      + row(COL.drag, '空気抵抗', Math.round(p.drag) + ' N') + row(COL.rear, '後ダウンフォース', sgn(Math.round(p.dfR)) + ' N');
  });
  attachHover(chartSus, $('tipSus'), x => {
    if (x == null || !sim.trace.length) { susHover = null; return; }
    const t1 = sim.trace[sim.trace.length - 1].t;
    susHover = t1 - x;
    const p = sim.trace.reduce((b, q) => Math.abs(q.t - x) < Math.abs(b.t - x) ? q : b);
    return row(COL.front, '車体フロント', sgn(Math.round(p.f)) + ' mm') + row(COL.rear, '車体リア', sgn(Math.round(p.r)) + ' mm')
      + row(COL.road, '路面（前輪）', sgn(Math.round(p.road)) + ' mm');
  });
  legend($('legAero'), [[COL.front, '前ダウンフォース'], [COL.drag, '空気抵抗'], [COL.rear, '後ダウンフォース'], ['#c3c2b7', '点線＝現在の速度']]);
  legend($('legSus'), [[COL.front, '車体フロント'], [COL.rear, '車体リア'], [COL.road, '路面（前輪の位置）']]);
  window.addEventListener('resize', () => { resizeScene(); drawAeroChart(); });
}
function sync() {
  const adj = state.damper === 'adj', wing = state.rear === 'wing';
  $('clicks').disabled = !adj; $('clicksRow').classList.toggle('disabled', !adj);
  $('wingAngle').disabled = !wing; $('wingRow').classList.toggle('disabled', !wing);
  $('clicksVal').textContent = state.clicks; $('wingVal').textContent = state.wingAngle;
}

/* ============ メインループ ============ */
let last = 0, tileT = 0;
function frame(now) {
  const dt = Math.min(0.033, (now - last) / 1000 || 0.016); last = now;
  stepSim(dt);
  flowPhase = (flowPhase + state.speed / 3.6 * view.s * dt * 0.25) % 24;
  drawScene();
  drawSusChart();
  tileT += dt;
  if (tileT > 0.25) { tileT = 0; updateLiveTiles(); }
  requestAnimationFrame(frame);
}

resetSim();
resizeScene();
bind();
sync();
derive();
requestAnimationFrame(frame);
window.__lab = { state, sim, get D() { return D; } };
})();
