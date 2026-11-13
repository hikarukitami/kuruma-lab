/* 計算部分：車両モデルの組み立て、空力、コーナリング、7自由度の車体モデル */
(function (L) {
'use strict';
const G = 9.81, RHO = 1.225;
const clickMul = n => 0.5 + (n - 1) * 0.07;      // 減衰ダイヤル 1〜16段 → 倍率

/* ---- 現在の仕様から車両パラメータを作る ---- */
L.build = function (s) {
  const c = L.CARS[s.car], PT = L.PARTS;
  const eng = PT.engine[s.engine], wt = PT.weight[s.weight], wh = PT.wheel[s.wheel], ty = PT.tyre[s.tyre], kit = PT.kit[s.kit];
  const list = [eng, wt, wh, ty, kit, PT.arbF[s.arbF], PT.arbR[s.arbR], PT.front[s.front], PT.rear[s.rear], PT.diff[s.diff]];
  ['canard', 'duct', 'skirt', 'gurney', 'tray'].forEach(f => { if (s[f]) list.push(PT.flags[f]); });
  let mass = c.mass + 70 + 4 * wh.du, price = 0;           // 70kg はドライバー
  list.forEach(p => { mass += p.mass || 0; price += p.price || 0; });

  const muF = c.muF + wh.du, muR = c.muR + wh.du;
  const msF = mass * c.fr / 2 - muF, msR = mass * (1 - c.fr) / 2 - muR, Ms = 2 * (msF + msR);
  const b = c.wb * (2 * msF / Ms), a = c.wb - b;           // 重心→後軸, 重心→前軸
  const kF = s.kF * 1000, kR = s.kR * 1000, hF = s.hF / 1000, hR = s.hR / 1000;
  const c0F = 2 * 0.30 * Math.sqrt(c.kF * 1000 * msF), c0R = 2 * 0.30 * Math.sqrt(c.kR * 1000 * msR);
  const cBF = c0F * kit.dBase * clickMul(s.bumpF) * 0.7, cRF = c0F * kit.dBase * clickMul(s.rebF) * 1.3;
  const cBR = c0R * kit.dBase * clickMul(s.bumpR) * 0.7, cRR = c0R * kit.dBase * clickMul(s.rebR) * 1.3;
  const arbF = c.arbF * PT.arbF[s.arbF].mul, arbR = c.arbR * PT.arbR[s.arbR].mul;
  const cg = c.cgH + hF * c.fr + hR * (1 - c.fr) + (wt.dcg || 0), cgS = cg + 0.03;
  const rcF = c.rcF + hF * 1.2, rcR = c.rcR + hR * 1.1;    // 車高を下げるとロールセンターはそれ以上に下がる
  const hroll = cgS - (rcF * b + rcR * a) / c.wb;
  const KrF = kF * c.tF * c.tF / 2 + arbF, KrR = kR * c.tR * c.tR / 2 + arbR;
  const crit = (k, m) => 2 * Math.sqrt(k * m);
  return {
    s, car: c, mass, price, power: c.power * eng.pmul, tyre: ty, kit,
    muF, muR, msF, msR, Ms, a, b, xcg: c.rearAxle + b,
    WF: (msF + muF) * G, WR: (msR + muR) * G,
    kF, kR, cBF, cRF, cBR, cRR, arbF, arbR, kt: ty.kt * 1000, hF, hR,
    cg, cgS, rcF, rcR, hroll, KrF, KrR,
    Ix: Ms * Math.pow(0.36 * c.width, 2), Iy: Ms * a * b,
    limF: Math.max(0.02, 0.085 + hF * 0.75), limR: Math.max(0.02, 0.085 + hR * 0.75),
    clF0: c.clear + hF, clR0: c.clear + hR,
    freqF: Math.sqrt(kF / msF) / (2 * Math.PI), freqR: Math.sqrt(kR / msR) / (2 * Math.PI),
    zBF: cBF / crit(kF, msF), zRF: cRF / crit(kF, msF), zBR: cBR / crit(kR, msR), zRR: cRR / crit(kR, msR),
    crr: ty.crr * (1 + 0.8 * (Math.abs(s.toeF) + Math.abs(s.toeR)))
  };
};

/* ---- 空力：係数の積み上げ＋地上高・前傾角・横風の影響 ---- */
// sinkF/R: 車体の前後軸位置での上下変位(m, 上が+)。wind: 横風(m/s, 左から)
L.aero = function (P, v, wind, sinkF, sinkR) {
  const s = P.s, c = P.car;
  const clF = Math.max(0.02, P.clF0 + (sinkF || 0)), clR = Math.max(0.02, P.clR0 + (sinkR || 0));
  const cAvg = (clF + clR) / 2, rake = (clR - clF) / c.wb * 180 / Math.PI;
  const low = (c.clear - cAvg) * 1000;
  const gh = x => 0.3 + 1.3 * Math.exp(-Math.pow((x - 0.07) / 0.05, 2));   // 地面効果（7cm付近が最大、下げすぎると失速）
  let cd = c.cd - 0.0002 * low + 0.004 * Math.abs(rake);
  let clf = c.clf - 0.0004 * low - 0.03 * rake, clr = c.clr - 0.0004 * low + 0.01 * rake;
  let stall = false;

  if (s.front === 'lip') { cd += 0.004; clf -= 0.04; }
  if (s.front === 'splitter') { cd += 0.010; clf -= 0.07 + 0.04 * gh(clF); clr += 0.01; }
  if (s.canard) { cd += 0.008; clf -= 0.035; }
  if (s.duct) { cd -= 0.002; clf -= 0.02; }

  let uF = 0, uR = 0;                                   // 床下で作るダウンフォース
  if (s.tray) { cd -= 0.015; uF += 0.030; uR += 0.025; }
  if (s.diff !== 'none') {
    const m = s.tray ? 1.3 : 1, big = s.diff === 'large';
    uF += (big ? 0.018 : 0.010) * m; uR += (big ? 0.080 : 0.045) * m; cd += big ? 0.002 : -0.003;
  }
  const uMul = gh(cAvg) * (s.skirt ? 1.15 : 1);
  if (s.skirt) cd += 0.002;
  clf -= uF * uMul; clr -= uR * uMul;

  if (s.rear === 'spoiler') { cd += 0.006; clr -= 0.07 + (s.gurney ? 0.015 : 0); if (s.gurney) cd += 0.003; }
  if (s.rear === 'wingS' || s.rear === 'wingL') {
    const a = s.wingAngle, size = L.PARTS.rear[s.rear].size;
    let cw = 0.10 + 0.021 * Math.min(a, 13), dw = 0.012 + 0.0032 * a;
    if (a > 13) { cw -= 0.025 * (a - 13); dw += 0.008 * (a - 13); stall = true; }   // 立てすぎると失速
    if (s.gurney) { cw += 0.03; dw += 0.006; }
    cw *= size; dw *= size;
    clr -= cw; clf += 0.14 * cw; cd += dw;
  }

  const vv = Math.max(v, 0), vrel = Math.hypot(vv, wind || 0);
  const beta = vv > 0.5 ? Math.min(0.5, Math.atan2(wind || 0, vv)) : 0;
  cd *= 1 + 2.5 * beta * beta; clf += 0.15 * beta * beta; clr += 0.15 * beta * beta;
  const q = 0.5 * RHO * vrel * vrel * c.area;
  const side = q * c.cy * beta;
  return {
    cd, clf, clr, drag: q * cd, liftF: q * clf, liftR: q * clr, side,
    yawM: side * (P.a - c.cop * c.wb), beta, clF, clR, rake, stall
  };
};

// 空力で車体が沈む（浮く）分を含めたつり合い状態
L.aeroEq = function (P, v, wind, dh) {
  let sF = 0, sR = 0, ae = null;
  for (let i = 0; i < 5; i++) {
    ae = L.aero(P, v, wind, sF + (dh || 0), sR + (dh || 0));
    sF += (ae.liftF / 2 * (1 / P.kF + 1 / P.kt) - sF) * 0.7;
    sR += (ae.liftR / 2 * (1 / P.kR + 1 / P.kt) - sR) * 0.7;
  }
  ae.sinkF = sF; ae.sinkR = sR;
  return ae;
};
L.needPower = function (P, v, wind) {
  return (L.aeroEq(P, v, wind).drag + P.crr * P.mass * G) * v;
};
L.topSpeed = function (P) {
  const pw = P.power * 1000 * 0.88;
  let lo = 0, hi = 140;
  for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (L.needPower(P, m, 0) < pw) lo = m; else hi = m; }
  return lo * 3.6;
};

/* ---- 定常旋回：4輪の荷重とタイヤの余力 ---- */
L.wheelLoads = function (P, ay, ae) {       // ay: 横G（+で左旋回）
  const c = P.car;
  const FzF = Math.max(0, 2 * P.WF - ae.liftF), FzR = Math.max(0, 2 * P.WR - ae.liftR);
  const M = P.Ms * G * P.hroll, phi = M * ay / Math.max(1, P.KrF + P.KrR - M);
  let dF = (P.KrF * phi + 2 * P.msF * G * ay * P.rcF + 2 * P.muF * G * ay * c.wheelR) / c.tF;
  let dR = (P.KrR * phi + 2 * P.msR * G * ay * P.rcR + 2 * P.muR * G * ay * c.wheelR) / c.tR;
  dF = Math.max(-FzF / 2, Math.min(FzF / 2, dF)); dR = Math.max(-FzR / 2, Math.min(FzR / 2, dR));
  return { loads: [FzF / 2 - dF, FzF / 2 + dF, FzR / 2 - dR, FzR / 2 + dR], roll: phi * 180 / Math.PI, dF, dR };
};
function tyreCap(P, Fz, cam) {
  const mu = P.tyre.mu * Math.max(0.55, 1 - 0.13 * (Fz / 3500 - 1));      // 荷重が増えるほど摩擦係数は少し下がる
  return mu * Math.max(0.85, 1 - 0.012 * Math.pow(cam + 1.0, 2)) * Fz;   // 対地キャンバー -1°付近が最良
}
L.cornerUse = function (P, ay, ae) {
  const s = P.s, c = P.car, w = L.wheelLoads(P, ay, ae), r = Math.abs(w.roll);
  const outF = s.camF + r * (1 - c.camGainF), outR = s.camR + r * (1 - c.camGainR);
  const inF = -s.camF + r * (1 - c.camGainF), inR = -s.camR + r * (1 - c.camGainR);
  const lo = (i, j) => Math.min(w.loads[i], w.loads[j]), hi = (i, j) => Math.max(w.loads[i], w.loads[j]);
  const capF = tyreCap(P, hi(0, 1), outF) + tyreCap(P, lo(0, 1), inF);
  const capR = tyreCap(P, hi(2, 3), outR) + tyreCap(P, lo(2, 3), inR);
  const a = Math.abs(ay);
  return { uF: P.mass * c.fr * a * G / Math.max(1, capF), uR: P.mass * (1 - c.fr) * a * G / Math.max(1, capR), roll: w.roll, outF, outR, w };
};
L.handling = function (P, v, wind) {
  const ae = L.aeroEq(P, v, wind);
  let lo = 0, hi = 3;
  for (let i = 0; i < 28; i++) {
    const m = (lo + hi) / 2, u = L.cornerUse(P, m, ae);
    if (Math.max(u.uF, u.uR) < 1) lo = m; else hi = m;
  }
  const u = L.cornerUse(P, lo * 0.9, ae);
  const balance = (u.uF / u.uR - 1) * 100 + (P.s.toeF + P.s.toeR) * 10;   // +でアンダーステア傾向
  const M = P.Ms * G * P.hroll;
  return {
    maxG: lo, balance, ae, outF: u.outF, outR: u.outR,
    rollGrad: M / Math.max(1, P.KrF + P.KrR - M) * 180 / Math.PI,
    rollDist: P.KrF / (P.KrF + P.KrR) * 100,
    ltDist: Math.abs(u.w.dF) / Math.max(1, Math.abs(u.w.dF) + Math.abs(u.w.dR)) * 100
  };
};

/* ---- 周波数応答（クォーターカーモデル）：路面の揺れが車体に何倍で伝わるか ---- */
L.gain = function (P, front, f) {
  const ms = front ? P.msF : P.msR, mu = front ? P.muF : P.muR, k = front ? P.kF : P.kR;
  const cc = front ? (P.cBF + P.cRF) / 2 : (P.cBR + P.cRR) / 2, kt = P.kt, w = 2 * Math.PI * f;
  // H = kt(k+jwc) / [(k-ms w²+jwc)(kt+k-mu w²+jwc) - (k+jwc)²]
  const ar = k - ms * w * w, ai = w * cc, br = kt + k - mu * w * w, bi = w * cc;
  const dr = ar * br - ai * bi - (k * k - w * w * cc * cc), di = ar * bi + ai * br - 2 * k * w * cc;
  return kt * Math.hypot(k, w * cc) / Math.hypot(dr, di);
};

/* ---- 走行シミュレーション：車体(上下・ロール・ピッチ)＋4輪 ---- */
L.Sim = function () { this.reset(); };
L.Sim.prototype.reset = function () {
  Object.assign(this, {
    z: 0, vz: 0, phi: 0, vphi: 0, th: 0, vth: 0, zu: [0, 0, 0, 0], vu: [0, 0, 0, 0],
    load: [0, 0, 0, 0], lp: null, travel: [0, 0, 0, 0], zr: [0, 0, 0, 0],
    X: 0, t: 0, traceT: 0, trace: [], rideMS: 0, loadMS: 0, bottom: 0
  });
};
// 順番は FL, FR, RL, RR
L.Sim.prototype.step = function (P, dtFrame, inp) {
  const c = P.car, n = Math.max(1, Math.ceil(dtFrame / 0.0005)), dt = dtFrame / n;
  const xs = [P.a, P.a, -P.b, -P.b], ys = [c.tF / 2, -c.tF / 2, c.tR / 2, -c.tR / 2];
  const W = [P.WF, P.WF, P.WR, P.WR], mu = [P.muF, P.muF, P.muR, P.muR];
  const E = [inp.liftF / 2, inp.liftF / 2, inp.liftR / 2, inp.liftR / 2];
  const gF = (2 * P.msF * P.rcF + 2 * P.muF * c.wheelR) * G * inp.ay / c.tF;
  const gR = (2 * P.msR * P.rcR + 2 * P.muR * c.wheelR) * G * inp.ay / c.tR;
  const geo = [gF, -gF, gR, -gR];
  const aF = P.arbF / (c.tF * c.tF), aR = P.arbR / (c.tR * c.tR);
  const F = [0, 0, 0, 0], tr = this.travel, zr = this.zr, road = P.s.road;
  if (!this.lp) this.lp = W.slice();
  for (let it = 0; it < n; it++) {
    this.X += inp.v * dt; this.t += dt;
    zr[0] = L.roadZ(road, this.X + c.wb, 1); zr[1] = L.roadZ(road, this.X + c.wb, -1);
    zr[2] = L.roadZ(road, this.X, 1); zr[3] = L.roadZ(road, this.X, -1);
    for (let i = 0; i < 4; i++) {
      const fr = i < 2, k = fr ? P.kF : P.kR, lim = fr ? P.limF : P.limR;
      const t = this.z + xs[i] * this.th + ys[i] * this.phi - this.zu[i];
      const rel = this.vz + xs[i] * this.vth + ys[i] * this.vphi - this.vu[i];
      let f = -k * t - (rel > 0 ? (fr ? P.cRF : P.cRR) : (fr ? P.cBF : P.cBR)) * rel;
      if (t < -lim) { f += k * 12 * (-lim - t); this.bottom = 1; }       // バンプラバー
      else if (t > 0.09) f -= k * 12 * (t - 0.09);
      F[i] = f; tr[i] = t;
    }
    let fa = aF * (tr[0] - tr[1]); F[0] -= fa; F[1] += fa;              // スタビライザー
    fa = aR * (tr[2] - tr[3]); F[2] -= fa; F[3] += fa;
    let sum = 0, Mphi = P.Ms * G * P.hroll * inp.ay, Mth = P.Ms * G * P.cgS * inp.ax;
    for (let i = 0; i < 4; i++) { const f = F[i] + E[i]; sum += f; Mphi += ys[i] * f; Mth += xs[i] * f; }
    const az = sum / P.Ms;
    this.vz += az * dt; this.vphi += Mphi / P.Ix * dt; this.vth += Mth / P.Iy * dt;
    this.z += this.vz * dt; this.phi += this.vphi * dt; this.th += this.vth * dt;
    let dv = 0;
    for (let i = 0; i < 4; i++) {
      const ld = Math.max(0, W[i] + P.kt * (zr[i] - this.zu[i]));        // タイヤは路面を引っ張れない
      this.vu[i] += (-F[i] + ld - W[i] + geo[i]) / mu[i] * dt;
      this.zu[i] += this.vu[i] * dt;
      this.load[i] = ld;
      this.lp[i] += (ld - this.lp[i]) * dt / 0.6;
      dv += Math.pow((ld - this.lp[i]) / W[i], 2) / 4;
    }
    const kk = dt / 2;
    this.rideMS += (az * az - this.rideMS) * kk; this.loadMS += (dv - this.loadMS) * kk;
    this.traceT += dt;
    if (this.traceT >= 0.02) {
      this.traceT = 0;
      this.trace.push({
        t: this.t, f: (this.z + P.a * this.th) * 1000, r: (this.z - P.b * this.th) * 1000, road: (zr[0] + zr[1]) * 500,
        roll: this.phi * 180 / Math.PI, pitch: this.th * 180 / Math.PI, l: this.load.slice()
      });
      if (this.trace.length > 200) this.trace.shift();
    }
  }
  this.bottom *= 0.97;
};
})(window.Lab);
