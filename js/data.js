/* 車両データとパーツデータ（学習用の目安値） */
window.Lab = window.Lab || {};
(function (L) {
'use strict';

// 寸法は m、ばねは N/mm（ホイールレート）、スタビは Nm/rad。top は後ろ(0)→前(L) の屋根ライン
L.CARS = {
  hatch: {
    name: 'コンパクトハッチ', drive: 'FF', mass: 1080, fr: 0.62, L: 3.9, wb: 2.5, rearAxle: 0.65,
    width: 1.70, tF: 1.48, tR: 1.47, cgH: 0.54, wheelR: 0.30, tyreW: 0.19, clear: 0.15,
    cd: 0.33, area: 2.05, clf: 0.08, clr: 0.12, cy: 2.2, cop: 0.45, power: 80,
    kF: 22, kR: 17, muF: 36, muR: 32, arbF: 9000, arbR: 3000, rcF: 0.06, rcR: 0.12,
    camGainF: 0.25, camGainR: 0.45, belt: 0.97, rearH: 1.38, wakeLen: 1.7, wake: 1.3, color: 0xd8473b,
    top: [[0, 0.95], [0.12, 1.38], [0.5, 1.5], [1.9, 1.5], [2.2, 1.46], [2.95, 1.0], [3.75, 0.86], [3.9, 0.6]],
    spoiler: { x0: -0.2, x1: 0.14, h0: 1.37, h1: 1.42, half: 0.62 },
    wing: { x: -0.02, h: 1.7, base: 1.42 }
  },
  coupe: {
    name: 'クーペ', drive: 'FR', mass: 1320, fr: 0.53, L: 4.4, wb: 2.6, rearAxle: 0.85,
    width: 1.78, tF: 1.52, tR: 1.54, cgH: 0.47, wheelR: 0.33, tyreW: 0.23, clear: 0.13,
    cd: 0.29, area: 1.95, clf: 0.06, clr: 0.09, cy: 1.8, cop: 0.40, power: 170,
    kF: 28, kR: 26, muF: 42, muR: 40, arbF: 14000, arbR: 7000, rcF: 0.04, rcR: 0.09,
    camGainF: 0.45, camGainR: 0.5, belt: 0.93, rearH: 0.92, wakeLen: 1.1, wake: 0.8, color: 0x2f6fd0,
    top: [[0, 0.82], [0.4, 0.95], [0.55, 0.96], [1.55, 1.27], [2.2, 1.3], [2.5, 1.25], [3.1, 0.92], [4.2, 0.76], [4.4, 0.55]],
    spoiler: { x0: -0.04, x1: 0.14, h0: 0.8, h1: 0.94, half: 0.72 },
    wing: { x: 0.1, h: 1.24, base: 0.84 }
  }
};

// mass: kg（車重への増減）、price: 万円（目安）
L.PARTS = {
  engine: {
    stock:  { label: '純正', pmul: 1 },
    intake: { label: '吸排気チューン（+6%）', pmul: 1.06, mass: -2, price: 15 },
    ecu:    { label: '吸排気＋ECU（+15%）', pmul: 1.15, mass: -2, price: 30 },
    turbo:  { label: 'ターボ化（+45%）', pmul: 1.45, mass: 25, price: 90 }
  },
  weight: {
    none: { label: 'なし' },
    light: { label: 'ライト軽量化（-40kg）', mass: -40, price: 10 },
    full: { label: 'フル軽量化（-110kg）', mass: -110, price: 60, dcg: -0.01 }
  },
  wheel: {
    stock:  { label: '純正ホイール', du: 0 },
    alloy:  { label: '軽量アルミ（1本 -2.5kg）', du: -2.5, price: 16 },
    forged: { label: '鍛造ホイール（1本 -4.5kg）', du: -4.5, price: 40 }
  },
  tyre: {
    eco:     { label: 'エコタイヤ', mu: 0.85, kt: 200, crr: 0.008, price: 6 },
    comfort: { label: 'コンフォートタイヤ', mu: 0.92, kt: 190, crr: 0.010, price: 8 },
    sport:   { label: 'スポーツタイヤ', mu: 1.05, kt: 220, crr: 0.012, price: 12 },
    semi:    { label: 'セミスリック', mu: 1.25, kt: 250, crr: 0.014, price: 18 }
  },
  kit: {
    stock:   { label: '純正サスペンション', kMul: [1, 1, 1], h: [0, 0, 0], damp: 'fixed', dBase: 1, camF: -1.0 },
    lower:   { label: 'ダウンサス＋純正ダンパー', kMul: [1.3, 1.3, 1.3], h: [-30, -30, -30], damp: 'fixed', dBase: 1, camF: -1.0, mass: -1, price: 4 },
    street:  { label: 'ストリート車高調（減衰調整）', kMul: [1.4, 3.0, 1.8], h: [-60, 0, -25], damp: 'single', dBase: 1.35, camF: -2.5, mass: -3, price: 15 },
    circuit: { label: 'サーキット車高調（伸び縮み別調整）', kMul: [2.0, 5.0, 3.2], h: [-80, -10, -40], damp: 'double', dBase: 1.8, camF: -4.0, mass: -5, price: 40 }
  },
  arbF: {
    stock: { label: '純正', mul: 1 },
    hard:  { label: '強化（1.6倍）', mul: 1.6, mass: 1, price: 4 },
    race:  { label: 'レース用（2.4倍）', mul: 2.4, mass: 2, price: 7 }
  },
  arbR: {
    none:  { label: '取り外し', mul: 0, mass: -3 },
    stock: { label: '純正', mul: 1 },
    hard:  { label: '強化（1.6倍）', mul: 1.6, mass: 1, price: 4 },
    race:  { label: 'レース用（2.4倍）', mul: 2.4, mass: 2, price: 7 }
  },
  front: {
    none: { label: 'なし' },
    lip: { label: 'リップスポイラー', mass: 2, price: 4 },
    splitter: { label: 'フロントスプリッター', mass: 5, price: 12 }
  },
  rear: {
    none: { label: 'なし' },
    spoiler: { label: 'リアスポイラー', mass: 3, price: 5 },
    wingS: { label: 'GTウイング 1400mm', mass: 6, price: 12, size: 1, span: 1.4, chord: 0.24 },
    wingL: { label: 'GTウイング 1700mm', mass: 8, price: 20, size: 1.45, span: 1.7, chord: 0.3 }
  },
  diff: {
    none: { label: 'なし' },
    small: { label: 'ディフューザー（小）', mass: 3, price: 6 },
    large: { label: 'ディフューザー（大・フィン付き）', mass: 7, price: 18 }
  },
  flags: {
    canard: { label: 'カナード', mass: 1, price: 3 },
    duct:   { label: 'ボンネットダクト', mass: -1, price: 8 },
    skirt:  { label: 'サイドスカート', mass: 4, price: 6 },
    gurney: { label: 'ガーニーフラップ', mass: 0, price: 1 },
    tray:   { label: 'フラットアンダーパネル', mass: 8, price: 15 }
  }
};

L.defaults = function (car) {
  return {
    car: car || 'hatch', speed: 80, wind: 0, road: 'bump', mode: 'straight', gLevel: 0.6, ex: 2,
    engine: 'stock', weight: 'none', wheel: 'stock', tyre: 'comfort',
    kit: 'stock', arbF: 'stock', arbR: 'stock',
    kF: L.CARS[car || 'hatch'].kF, kR: L.CARS[car || 'hatch'].kR, hF: 0, hR: 0,
    bumpF: 8, rebF: 8, bumpR: 8, rebR: 8,
    camF: -0.5, camR: -1.0, toeF: 0, toeR: 0.1,
    front: 'none', canard: false, duct: false, skirt: false,
    rear: 'none', wingAngle: 6, gurney: false, tray: false, diff: 'none'
  };
};

L.topAt = function (c, x) {
  const p = c.top;
  if (x <= p[0][0]) return p[0][1];
  for (let i = 1; i < p.length; i++) {
    if (x <= p[i][0]) {
      const t = (x - p[i - 1][0]) / (p[i][0] - p[i - 1][0]);
      return p[i - 1][1] + t * (p[i][1] - p[i - 1][1]);
    }
  }
  return p[p.length - 1][1];
};

L.roadZ = function (type, x, side) {       // side: +1=左輪, -1=右輪
  const hump = (p, len, h) => (p >= 0 && p < len ? h * Math.sin(Math.PI * p / len) : 0);
  switch (type) {
    case 'bump': return hump(((x % 25) + 25) % 25, 0.6, 0.04);
    case 'one':  return side > 0 ? hump(((x % 25) + 25) % 25, 0.6, 0.04) : 0;
    case 'wave': return 0.025 * Math.sin(2 * Math.PI * x / 12);
    case 'twist': return side * 0.02 * Math.sin(2 * Math.PI * x / 10);
    case 'rough': {
      const o = side > 0 ? 0 : 2.3;
      return 0.004 * Math.sin(x * 8.9 + 1 + o) + 0.005 * Math.sin(x * 4.7 + 2.1 + o * 2) + 0.006 * Math.sin(x * 2.2 + 0.4 + o)
           + 0.007 * Math.sin(x * 1.21 + 4) + 0.008 * Math.sin(x * 0.57 + 3);
    }
    default: return 0;
  }
};
})(window.Lab);
