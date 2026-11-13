/* 画面の操作・数値表示・グラフ・保存比較 */
(function (L) {
'use strict';
const $ = id => document.getElementById(id);
const COL = { front: '#3987e5', drag: '#d95926', rear: '#199e70', y: '#c98500', road: '#8f8e84' };
const KEY = 'kurumaLab.state.v3', SLOTS = 'kurumaLab.slots.v2';
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 保存できない環境では何もしない */ } }
};
const sgn = (n, d) => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toFixed(d || 0);

let state = Object.assign(L.defaults('hatch'), store.get(KEY) || {});
if (!L.CARS[state.car]) state = L.defaults('hatch');
let slots = store.get(SLOTS) || [];
const show = { flow: true, press: false, force: true, xray: false };
const ctl = {}, sim = new L.Sim(), inp = { ay: 0, ax: 0 };
let P = null, H = null, top = 0, view = null, cache = {};

/* ---------- 入力部品 ---------- */
function mk(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
function sel(panel, id, label, opts) {
  const row = mk('label', '', label), s = mk('select');
  Object.keys(opts).forEach(k => { const o = mk('option'); o.value = k; o.textContent = opts[k].label || opts[k]; s.appendChild(o); });
  s.addEventListener('change', () => set(id, isNaN(+s.value) || s.value === '' ? s.value : (typeof state[id] === 'number' ? +s.value : s.value)));
  row.appendChild(s); panel.appendChild(row);
  ctl[id] = { el: s, row, sync() { s.value = String(state[id]); } };
}
function rng(panel, id, label, min, max, step, fmt, hint) {
  const row = mk('label', '', label + ' <b></b>' + (hint ? ' <small>' + hint + '</small>' : '')), r = mk('input');
  r.type = 'range'; r.min = min; r.max = max; r.step = step;
  r.addEventListener('input', () => set(id, +r.value));
  row.appendChild(r); panel.appendChild(row);
  ctl[id] = { el: r, row, name: row.firstChild, sync() { r.value = state[id]; row.querySelector('b').textContent = fmt(state[id]); },
    range(a, b) { r.min = a; r.max = b; state[id] = Math.max(a, Math.min(b, state[id])); row.classList.toggle('disabled', a === b); r.disabled = a === b; } };
}
function chk(panel, id, label) {
  const row = mk('label', 'chk'), c = mk('input'); c.type = 'checkbox';
  c.addEventListener('change', () => set(id, c.checked));
  row.appendChild(c); row.appendChild(document.createTextNode(label)); panel.appendChild(row);
  ctl[id] = { el: c, row, sync() { c.checked = !!state[id]; } };
}
function enable(id, on) { ctl[id].el.disabled = !on; ctl[id].row.classList.toggle('disabled', !on); }

function buildControls() {
  const PT = L.PARTS, st = $('stageCtl');
  rng(st, 'speed', '速度', 0, 250, 5, v => v + ' km/h');
  rng(st, 'wind', '横風（左から）', 0, 20, 1, v => v + ' m/s');
  sel(st, 'road', '路面', { bump: '段差（ハンプ）', one: '片輪だけ段差', wave: 'うねり', twist: 'ねじれ（左右逆のうねり）', rough: '荒れた路面', flat: 'フラット' });
  sel(st, 'mode', '走り方', { straight: '直進', corner: '定常円旋回（左）', slalom: 'スラローム', brake: 'ブレーキ', accel: '加速' });
  rng(st, 'gLevel', '旋回・加減速の強さ', 0, 1.5, 0.05, v => v.toFixed(2) + ' G');
  sel(st, 'ex', '上下動の表示倍率', { 1: '等倍', 2: '2倍に強調', 4: '4倍に強調' });

  const pv = $('p-vehicle');
  sel(pv, 'engine', 'エンジン', PT.engine); sel(pv, 'weight', '軽量化', PT.weight);
  sel(pv, 'wheel', 'ホイール', PT.wheel); sel(pv, 'tyre', 'タイヤ', PT.tyre);
  pv.appendChild(mk('div', 'table-wrap', '<table id="specTbl"></table>'));

  const ps = $('p-sus');
  sel(ps, 'kit', 'サスペンションキット', PT.kit);
  ps.appendChild(mk('p', 'sub', '', )).id = 'kitNote';
  let g = mk('div', 'cols2'); ps.appendChild(g);
  rng(g, 'kF', 'ばねレート 前', 1, 2, 1, v => v + ' N/mm'); rng(g, 'kR', 'ばねレート 後', 1, 2, 1, v => v + ' N/mm');
  rng(g, 'hF', '車高 前', -1, 0, 5, v => sgn(v) + ' mm'); rng(g, 'hR', '車高 後', -1, 0, 5, v => sgn(v) + ' mm');
  rng(g, 'bumpF', '減衰 前（縮み側）', 1, 16, 1, v => v + ' 段'); rng(g, 'bumpR', '減衰 後（縮み側）', 1, 16, 1, v => v + ' 段');
  rng(g, 'rebF', '減衰 前（伸び側）', 1, 16, 1, v => v + ' 段'); rng(g, 'rebR', '減衰 後（伸び側）', 1, 16, 1, v => v + ' 段');
  g = mk('div', 'cols2'); ps.appendChild(g);
  sel(g, 'arbF', 'スタビライザー 前', PT.arbF); sel(g, 'arbR', 'スタビライザー 後', PT.arbR);

  const pa = $('p-align');
  pa.appendChild(mk('p', 'sub', 'キャンバーは−でタイヤ上側が内向き。トーは＋でトーイン（前すぼまり）。'));
  g = mk('div', 'cols2'); pa.appendChild(g);
  rng(g, 'camF', 'キャンバー 前', -1, 0, 0.1, v => sgn(v, 1) + '°'); rng(g, 'camR', 'キャンバー 後', -3, 0, 0.1, v => sgn(v, 1) + '°');
  rng(g, 'toeF', 'トー 前', -0.4, 0.4, 0.05, v => sgn(v, 2) + '°'); rng(g, 'toeR', 'トー 後', -0.4, 0.4, 0.05, v => sgn(v, 2) + '°');

  const pe = $('p-aero');
  g = mk('div', 'cols2'); pe.appendChild(g);
  sel(g, 'front', 'フロント', PT.front); sel(g, 'rear', 'リア', PT.rear);
  rng(pe, 'wingAngle', 'ウイング角度', 0, 18, 1, v => v + '°', '（13°を超えると失速）');
  sel(pe, 'diff', 'ディフューザー', PT.diff);
  g = mk('div', 'cols2'); pe.appendChild(g);
  ['tray', 'skirt', 'canard', 'duct', 'gurney'].forEach(f => chk(g, f, PT.flags[f].label));

  const pb = $('p-brace');
  pb.appendChild(mk('p', 'sub', 'ボディのねじれと、足まわり取付部のたわみを減らすパーツです。足まわりを固めるほど効果が大きくなります。位置は「透視」表示で見られます。'));
  Object.keys(PT.brace).forEach(k => chk(pb, k, PT.brace[k].label));
  sel(pb, 'cage', 'ロールバー／ロールケージ', PT.cage);
}

function applyKit(reset) {
  const c = L.CARS[state.car], k = L.PARTS.kit[state.kit];
  [['kF', c.kF], ['kR', c.kR]].forEach(([id, base]) => {
    if (reset) state[id] = Math.round(base * k.kMul[2]);
    ctl[id].range(Math.round(base * k.kMul[0]), Math.round(base * k.kMul[1]));
  });
  ['hF', 'hR'].forEach(id => { if (reset) state[id] = k.h[2]; ctl[id].range(k.h[0], k.h[1]); });
  const fixed = k.damp === 'fixed', single = k.damp === 'single';
  ['bumpF', 'bumpR', 'rebF', 'rebR'].forEach(id => { if (fixed || reset) state[id] = 8; enable(id, !fixed); });
  if (single) { state.rebF = state.bumpF; state.rebR = state.bumpR; }
  ['rebF', 'rebR'].forEach(id => ctl[id].row.classList.toggle('hidden', single));
  ctl.bumpF.name.textContent = single ? '減衰力 前 ' : '減衰 前（縮み側） ';
  ctl.bumpR.name.textContent = single ? '減衰力 後 ' : '減衰 後（縮み側） ';
  ctl.camF.range(k.camF, 0);
  $('kitNote').textContent = fixed ? 'このキットはばね・車高・減衰力を調整できません。'
    : single ? 'ばねレート・車高と、伸び縮み同時の減衰力（16段）を調整できます。'
    : 'ばねレート・車高と、伸び側／縮み側の減衰力を別々に調整できます。';
}
function drawSpec() {
  const c = L.CARS[state.car];
  $('specTbl').innerHTML = '<thead><tr><th>' + c.short + ' の参照諸元</th><th>値</th><th>出どころ</th></tr></thead><tbody>'
    + c.spec.map(r => '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td><td>' + (r[2] ? '公表値' : '推定') + '</td></tr>').join('') + '</tbody>';
}
function syncAll() {
  const wing = state.rear === 'wingS' || state.rear === 'wingL';
  enable('wingAngle', wing); enable('gurney', state.rear !== 'none');
  enable('gLevel', state.mode !== 'straight');
  Object.keys(ctl).forEach(id => ctl[id].sync());
  document.querySelectorAll('#carSeg button').forEach(b => b.classList.toggle('on', b.dataset.car === state.car));
  drawSpec();
  $('speedNum').textContent = state.speed;
}

const STAGE = ['speed', 'wind', 'road', 'mode', 'gLevel', 'ex'];
function set(id, val) {
  state[id] = val;
  if (id === 'kit') applyKit(true);
  if (L.PARTS.kit[state.kit].damp === 'single') { state.rebF = state.bumpF; state.rebR = state.bumpR; }
  syncAll();
  if (id === 'speed' || id === 'wind') refreshSpeed();
  else if (STAGE.indexOf(id) >= 0) { cache = {}; drawChart1(); drawChart2(); }
  else refresh();
  store.set(KEY, state);
}
function setCar(car) {
  const keep = {}; STAGE.forEach(k => { keep[k] = state[k]; });
  state = Object.assign(L.defaults(car), keep);
  applyKit(false); sim.reset(); syncAll(); refresh(); store.set(KEY, state);
}

/* ---------- 数値タイル ---------- */
const TILES = [
  ['r-sus', 'freq', '固有振動数 前／後', 'Hz。1.2〜1.6が乗用車、2以上はスポーツ'],
  ['r-sus', 'zF', '減衰比 前（縮／伸）', '0.2〜0.4が快適、0.5〜0.7はスポーツ'],
  ['r-sus', 'zR', '減衰比 後（縮／伸）', '1を超えると動きが渋くなる'],
  ['r-sus', 'ride', '乗り心地（車体の揺れ）', 'm/s²。小さいほど快適'],
  ['r-sus', 'loadv', '接地荷重の変動', '%。小さいほどタイヤが路面に付く'],
  ['r-sus', 'dive', 'ノーズダイブ（1Gブレーキ）', '度。前のめりになる角度'],
  ['r-corner', 'maxG', '旋回限界', 'G。現在の速度での最大横G'],
  ['r-corner', 'bal', 'ハンドリング傾向', '限界付近で前後どちらが先に滑るか'],
  ['r-corner', 'rollg', 'ロール率', '度/G。小さいほどロールしない'],
  ['r-corner', 'rolld', 'ロール剛性配分（前）', '%。大きいほどアンダー傾向'],
  ['r-corner', 'cam', '旋回中の対地キャンバー 前／後', '度。外輪。−1°付近が最良'],
  ['r-corner', 'ktors', 'ボディねじり剛性', 'Nm/度。補強で上がる'],
  ['r-corner', 'twist', '旋回中のボディねじれ', '度。限界付近。小さいほど狙い通りに動く'],
  ['r-corner', 'ltd', '荷重移動配分（前）', '%。実際に前輪が受け持つ割合'],
  ['r-corner', 'rollnow', '今のロール角／ピッチ角', '度'],
  ['r-aero', 'cd', '空気抵抗係数 Cd', '小さいほど抵抗が少ない'],
  ['r-aero', 'drag', '空気抵抗', 'N。現在の速度'],
  ['r-aero', 'df', 'ダウンフォース 前／後', 'N。−は浮き上がる力'],
  ['r-aero', 'abal', '空力バランス（前）', '%。重量配分に近いと安定'],
  ['r-aero', 'ld', '揚抗比 L/D', 'ダウンフォース÷抵抗。効率の目安'],
  ['r-aero', 'pow', '必要な出力', 'kW。この速度を保つのに必要'],
  ['r-aero', 'top', '最高速（計算値）', 'km/h。出力と抵抗のつり合い'],
  ['r-aero', 'clr', '走行中の地上高 前／後', 'mm。空力による沈み込みを含む'],
  ['r-aero', 'side', '横風による横力', 'N。＋回頭モーメントは風下へ向く'],
  ['r-vehicle', 'mass', '車重（ドライバー込み）', 'kg'],
  ['r-vehicle', 'dist', '前後重量配分', '前：後'],
  ['r-vehicle', 'power', '最高出力', 'kW（PS）'],
  ['r-vehicle', 'pwr', 'パワーウェイトレシオ', 'kg/PS。小さいほど加速が良い'],
  ['r-vehicle', 'unspr', 'ばね下重量 前／後', 'kg（1輪あたり）'],
  ['r-vehicle', 'price', 'パーツ代の目安', '万円']
];
function buildTiles() {
  TILES.forEach(([p, id, label, hint]) => {
    const t = mk('div', 'tile', '<span>' + label + '</span><b id="t-' + id + '">–</b><small>' + hint + '</small>');
    $('p-' + p).appendChild(t);
  });
}
const T = (id, v) => { $('t-' + id).textContent = v; };
function balanceText(b) {
  const a = Math.abs(b), lv = a < 4 ? '' : a < 12 ? '弱' : a < 25 ? '' : '強';
  return a < 4 ? 'ニュートラル' : lv + (b > 0 ? 'アンダー' : 'オーバー');
}
function metrics(Px, Hx, topx) {
  const ae = Hx.ae, dfT = -(ae.liftF + ae.liftR);
  return {
    mass: Math.round(Px.mass), power: Math.round(Px.power), cd: ae.cd.toFixed(3), top: Math.round(topx),
    df: Math.round(dfT), maxG: Hx.maxG.toFixed(2), bal: balanceText(Hx.balance), rollg: Hx.rollGrad.toFixed(2),
    freq: Px.freqF.toFixed(2) + ' / ' + Px.freqR.toFixed(2), price: Px.price, ktors: Math.round(Px.kTors / 100) * 100
  };
}
function tilesStatic() {
  const c = P.car, ae = H.ae, v = state.speed / 3.6, ps = P.power * 1.36;
  T('freq', P.freqF.toFixed(2) + ' / ' + P.freqR.toFixed(2));
  T('zF', P.zBF.toFixed(2) + ' / ' + P.zRF.toFixed(2)); T('zR', P.zBR.toFixed(2) + ' / ' + P.zRR.toFixed(2));
  T('dive', (P.Ms * 9.81 * P.cgS / (2 * P.kF * P.a * P.a + 2 * P.kR * P.b * P.b) * 180 / Math.PI).toFixed(1));
  T('maxG', H.maxG.toFixed(2)); T('bal', balanceText(H.balance));
  T('rollg', H.rollGrad.toFixed(2)); T('rolld', H.rollDist.toFixed(0));
  T('cam', sgn(H.outF, 1) + ' / ' + sgn(H.outR, 1));
  T('ktors', Math.round(P.kTors / 100) * 100); T('twist', Math.abs(H.twist).toFixed(3)); T('ltd', H.ltDist.toFixed(1));
  T('cd', ae.cd.toFixed(3)); T('drag', Math.round(ae.drag));
  T('df', sgn(Math.round(-ae.liftF)) + ' / ' + sgn(Math.round(-ae.liftR)));
  const dfT = -(ae.liftF + ae.liftR);
  T('abal', dfT > 20 ? Math.round(-ae.liftF / dfT * 100) : '–');
  T('ld', ae.drag > 5 ? (dfT / ae.drag).toFixed(2) : '–');
  T('pow', (L.needPower(P, v, state.wind) / 0.88 / 1000).toFixed(1)); T('top', Math.round(top));
  T('clr', Math.round((P.clF0 + ae.sinkF) * 1000) + ' / ' + Math.round((P.clR0 + ae.sinkR) * 1000));
  T('side', Math.round(ae.side) + '（' + sgn(Math.round(ae.yawM)) + ' Nm）');
  T('mass', Math.round(P.mass)); T('dist', Math.round(c.fr * 100) + ' : ' + Math.round(100 - c.fr * 100));
  T('power', Math.round(P.power) + '（' + Math.round(ps) + '）'); T('pwr', (P.mass / ps).toFixed(1));
  T('unspr', P.muF.toFixed(1) + ' / ' + P.muR.toFixed(1)); T('price', P.price);
}
function tilesLive(ae, limited) {
  T('ride', Math.sqrt(sim.rideMS).toFixed(2)); T('loadv', (Math.sqrt(sim.loadMS) * 100).toFixed(1));
  T('rollnow', sgn(sim.phi * 180 / Math.PI, 1) + ' / ' + sgn(sim.th * 180 / Math.PI, 1));
  const b = [];
  if (limited) b.push('タイヤのグリップ限界（' + limited.toFixed(2) + 'G）で頭打ち');
  if (sim.bottom > 0.3) b.push('バンプタッチ（ストローク不足）');
  if (ae.stall) b.push('ウイング失速（角度の付けすぎ）');
  if (Math.min(ae.clF, ae.clR) < 0.045) b.push('地上高が不足（底を擦ります）');
  $('badges').innerHTML = b.map(x => '<span class="badge">' + x + '</span>').join('');
}

/* ---------- グラフ ---------- */
const c1 = $('chart1'), c2 = $('chart2');
function drawChart1() {
  const type = $('c1sel').value, tr = sim.trace;
  let cfg;
  if (type === 'freq') {
    if (!cache.freq) {
      const f = [], r = [];
      for (let lx = Math.log10(0.5); lx <= Math.log10(25) + 1e-9; lx += 0.02) { const hz = Math.pow(10, lx); f.push([lx, L.gain(P, true, hz)]); r.push([lx, L.gain(P, false, hz)]); }
      cache.freq = [{ name: '前', color: COL.front, pts: f }, { name: '後', color: COL.rear, pts: r }];
    }
    const wl = { wave: 12, twist: 10 }[state.road], fx = wl && state.speed > 0 ? state.speed / 3.6 / wl : null;
    cfg = { series: cache.freq, xmin: Math.log10(0.5), xmax: Math.log10(25), zero: true, unit: '倍',
      xticks: [0.5, 1, 2, 5, 10, 20].map(v => ({ x: Math.log10(v), label: v + (v === 20 ? 'Hz' : '') })),
      markerX: fx ? Math.log10(fx) : null, xfmt: x => Math.pow(10, x).toFixed(1) + ' Hz', vfmt: y => y.toFixed(2) + ' 倍' };
    $('note1').textContent = '路面の揺れが車体に何倍で伝わるか。左の山が車体の共振、右の山がタイヤのばたつき' + (fx ? '。点線＝今の速度でのうねりの周波数' : '') + '。';
  } else {
    if (tr.length < 2) return;
    const t1 = tr[tr.length - 1].t, t0 = t1 - 4, base = {
      xmin: t0, xmax: t1, xticks: [0, 1, 2, 3, 4].map(k => ({ x: t0 + k, label: k === 4 ? '今' : (k - 4) + '秒' })),
      xfmt: x => (x - t1).toFixed(1) + ' 秒'
    };
    if (type === 'heave') {
      let mx = 20; tr.forEach(p => { mx = Math.max(mx, Math.abs(p.f), Math.abs(p.r), Math.abs(p.road)); });
      const lim = Math.ceil(mx / 20) * 20;
      cfg = Object.assign(base, { ymin: -lim, ymax: lim, unit: 'mm', vfmt: y => sgn(y, 0) + ' mm', series: [
        { name: '路面（前輪の位置）', color: COL.road, thin: true, pts: tr.map(p => [p.t, p.road]) },
        { name: '車体 前', color: COL.front, pts: tr.map(p => [p.t, p.f]) },
        { name: '車体 後', color: COL.rear, pts: tr.map(p => [p.t, p.r]) }] });
      $('note1').textContent = '車体の前後が路面に対してどれだけ上下しているか。';
    } else if (type === 'angles') {
      cfg = Object.assign(base, { zero: true, minSpan: 2, unit: '度', vfmt: y => sgn(y, 2) + '°', series: [
        { name: 'ロール角（＋で右に傾く）', color: COL.front, pts: tr.map(p => [p.t, p.roll]) },
        { name: 'ピッチ角（＋で前上がり）', color: COL.drag, pts: tr.map(p => [p.t, p.pitch]) },
        { name: 'ボディねじれ×10', color: COL.rear, pts: tr.map(p => [p.t, p.twist * 10]) }] });
      $('note1').textContent = '旋回でロール、加減速でピッチが出ます。スタビやばねで変わります。';
    } else {
      const nm = ['左前', '右前', '左後', '右後'], cl = [COL.front, COL.drag, COL.rear, COL.y];
      cfg = Object.assign(base, { zero: true, minSpan: 2000, unit: 'N', vfmt: y => Math.round(y) + ' N',
        series: nm.map((n, i) => ({ name: n, color: cl[i], pts: tr.map(p => [p.t, p.l[i]]) })) });
      $('note1').textContent = '各タイヤが路面を押す力。0になるとタイヤが浮いています。';
    }
  }
  L.drawChart(c1, $('tip1'), cfg);
  if (c1._leg !== type) { L.legend($('leg1'), cfg.series); c1._leg = type; }
}
function drawChart2() {
  if (!P) return;
  const type = $('c2sel').value, v = state.speed / 3.6;
  let cfg;
  if (type === 'speed') {
    if (!cache.speed) {
      const a = [], b = [], d = [];
      for (let k = 0; k <= 250; k += 5) { const ae = L.aeroEq(P, k / 3.6, state.wind); a.push([k, -ae.liftF]); d.push([k, ae.drag]); b.push([k, -ae.liftR]); }
      cache.speed = [{ name: '前ダウンフォース', color: COL.front, pts: a }, { name: '空気抵抗', color: COL.drag, pts: d }, { name: '後ダウンフォース', color: COL.rear, pts: b }];
    }
    cfg = { series: cache.speed, xmin: 0, xmax: 250, zero: true, minSpan: 200, unit: 'N', markerX: state.speed,
      xticks: [0, 50, 100, 150, 200, 250].map(x => ({ x, label: x + (x === 250 ? 'km/h' : '') })), xfmt: x => x + ' km/h', vfmt: y => sgn(Math.round(y)) + ' N' };
    $('note2').textContent = '空気の力は速度の2乗で増えます。マイナスは浮き上がる力（リフト）。点線＝現在の速度。';
  } else if (type === 'height') {
    if (!cache.height) {
      const a = [], b = [], base = (P.clF0 + P.clR0) / 2 * 1000;
      for (let dh = -70; dh <= 40; dh += 5) {
        if (base + dh < 25) continue;
        const ae = L.aeroEq(P, v, state.wind, dh / 1000); a.push([base + dh, -ae.liftF]); b.push([base + dh, -ae.liftR]);
      }
      cache.height = { base, s: [{ name: '前ダウンフォース', color: COL.front, pts: a }, { name: '後ダウンフォース', color: COL.rear, pts: b }] };
    }
    const pts = cache.height.s[0].pts, x0 = pts[0][0], x1 = pts[pts.length - 1][0], tk = [];
    for (let x = Math.ceil(x0 / 20) * 20; x <= x1; x += 20) tk.push({ x, label: x + (x + 20 > x1 ? 'mm' : '') });
    cfg = { series: cache.height.s, xmin: x0, xmax: x1, zero: true, minSpan: 100, unit: 'N', markerX: cache.height.base, xticks: tk,
      xfmt: x => '地上高 ' + Math.round(x) + ' mm', vfmt: y => sgn(Math.round(y)) + ' N' };
    $('note2').textContent = '現在の速度で車高だけを変えた場合。床下パーツは地面に近いほど効き、下げすぎると失速します。点線＝今の車高。';
  } else {
    if (!cache.grip) {
      const a = [];
      for (let k = 0; k <= 250; k += 10) a.push([k, L.handling(P, k / 3.6, 0).maxG]);
      cache.grip = [{ name: '旋回限界', color: COL.front, pts: a }];
    }
    cfg = { series: cache.grip, xmin: 0, xmax: 250, minSpan: 0.2, unit: 'G', markerX: state.speed,
      xticks: [0, 50, 100, 150, 200, 250].map(x => ({ x, label: x + (x === 250 ? 'km/h' : '') })), xfmt: x => x + ' km/h', vfmt: y => y.toFixed(2) + ' G' };
    $('note2').textContent = 'ダウンフォースがあると速度が上がるほど曲がれるようになり、リフトがあると逆に下がります。';
  }
  L.drawChart(c2, $('tip2'), cfg);
  L.legend($('leg2'), cfg.series.length > 1 ? cfg.series : []);
}

/* ---------- 保存と比較 ---------- */
const ROWS = [['mass', '車重 (kg)'], ['power', '出力 (kW)'], ['freq', '固有振動数 前/後 (Hz)'], ['rollg', 'ロール率 (度/G)'], ['ktors', 'ボディねじり剛性 (Nm/度)'], ['maxG', '旋回限界 (G)'],
  ['bal', 'ハンドリング傾向'], ['cd', 'Cd'], ['df', 'ダウンフォース合計 (N)'], ['top', '最高速 (km/h)'], ['price', 'パーツ代 (万円)']];
function drawCompare() {
  const v = state.speed / 3.6;
  const cols = [{ name: '現在', m: metrics(P, H, top) }].concat(slots.map(s => {
    const st = Object.assign(L.defaults(s.state.car, true), s.state), Px = L.build(st);
    return { name: s.name + '（' + L.CARS[st.car].name + '）', m: metrics(Px, L.handling(Px, v, state.wind), L.topSpeed(Px)) };
  }));
  let h = '<thead><tr><th>' + state.speed + ' km/h での値</th>' + cols.map(c => '<th>' + c.name.replace(/</g, '&lt;') + '</th>').join('') + '</tr></thead><tbody>';
  ROWS.forEach(([k, label]) => { h += '<tr><td>' + label + '</td>' + cols.map(c => '<td>' + c.m[k] + '</td>').join('') + '</tr>'; });
  h += '<tr><td></td><td></td>' + slots.map((s, i) => '<td><button class="btn mini" data-load="' + i + '">読み込む</button><button class="btn mini ghost" data-del="' + i + '">削除</button></td>').join('') + '</tr></tbody>';
  $('cmp').innerHTML = h;
}
function loadState(st) {
  const keep = {}; STAGE.forEach(k => { keep[k] = state[k]; });
  state = Object.assign(L.defaults(st.car), st, keep);
  applyKit(false); sim.reset(); syncAll(); refresh(); store.set(KEY, state);
}

/* ---------- 再計算 ---------- */
function refresh() {
  P = L.build(state); H = L.handling(P, state.speed / 3.6, state.wind); top = L.topSpeed(P); cache = {};
  view.rebuild(P, H.ae.beta); view.setMode(show.press ? 'press' : 'paint', show.xray);
  tilesStatic(); drawChart1(); drawChart2(); drawCompare();
}
let lastBeta = 0;
function refreshSpeed() {
  H = L.handling(P, state.speed / 3.6, state.wind); cache = {};
  if (Math.abs(H.ae.beta - lastBeta) > 0.002) { view.setBeta(H.ae.beta); lastBeta = H.ae.beta; }
  tilesStatic(); drawChart1(); drawChart2(); drawCompare();
}

/* ---------- メインループ ---------- */
let last = 0, tileT = 0;
function frame(now) {
  const dt = Math.min(0.033, (now - last) / 1000 || 0.016); last = now;
  const v = state.speed / 3.6, g = state.gLevel;
  const ae = L.aero(P, v, state.wind, sim.z + P.a * sim.th, sim.z - P.b * sim.th);
  let ayT = 0, axT = 0, limited = 0;
  if (state.mode === 'corner' || state.mode === 'slalom') {
    const a = Math.min(g, H.maxG); if (g > H.maxG) limited = H.maxG;
    ayT = state.mode === 'corner' ? a : (v > 3 ? a * Math.sin(2 * Math.PI * sim.t * v / 36) : 0);
  } else if (state.mode === 'brake') {
    const bm = P.tyre.mu * Math.max(0, 1 - (ae.liftF + ae.liftR) / (P.mass * 9.81));
    axT = -Math.min(g, bm); if (g > bm) limited = bm;
  } else if (state.mode === 'accel') {
    const share = P.car.drive === 'FF' ? P.car.fr - 0.12 : 1 - P.car.fr + 0.12, am = P.tyre.mu * share;
    axT = Math.min(g, am); if (g > am) limited = am;
  }
  const kf = Math.min(1, dt / 0.12);
  inp.ay += (ayT - inp.ay) * kf; inp.ax += (axT - inp.ax) * kf;
  sim.step(P, dt, { v, ay: inp.ay, ax: inp.ax, liftF: ae.liftF, liftR: ae.liftR });
  view.update({ sim, ex: +state.ex, ae, v, dt, show, steer: inp.ay * 0.07 });
  if ($('c1sel').value !== 'freq') drawChart1();
  tileT += dt;
  if (tileT > 0.25) { tileT = 0; tilesLive(ae, limited); }
  requestAnimationFrame(frame);
}

/* ---------- 起動 ---------- */
function tabs(barId) {
  $(barId).addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    $(barId).querySelectorAll('button').forEach(x => { x.classList.toggle('on', x === b); $('p-' + x.dataset.tab).classList.toggle('on', x === b); });
  });
}
function init() {
  buildControls(); buildTiles(); tabs('setTabs'); tabs('resTabs');
  view = new L.View($('view'), $('labels')); view.resize();
  applyKit(false); syncAll(); refresh();

  $('carSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (b && b.dataset.car !== state.car) setCar(b.dataset.car); });
  $('camSeg').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    $('camSeg').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); view.setCamera(b.dataset.cam);
  });
  $('toggles').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const k = b.dataset.show; show[k] = !show[k]; b.classList.toggle('on', show[k]);
    view.setMode(show.press ? 'press' : 'paint', show.xray); $('cpLegend').classList.toggle('on', show.press);
  });
  $('c1sel').addEventListener('change', () => { c1._hf = null; drawChart1(); });
  $('c2sel').addEventListener('change', () => { c2._hf = null; drawChart2(); });
  L.chartHover(c1, drawChart1); L.chartHover(c2, drawChart2);
  $('saveBtn').addEventListener('click', () => {
    const copy = Object.assign({}, state); STAGE.forEach(k => delete copy[k]);
    slots.push({ name: $('slotName').value.trim() || '仕様' + (slots.length + 1), state: copy });
    if (slots.length > 4) slots.shift();
    $('slotName').value = ''; store.set(SLOTS, slots); drawCompare();
  });
  $('resetBtn').addEventListener('click', () => { const keep = {}; STAGE.forEach(k => { keep[k] = state[k]; }); state = Object.assign(L.defaults(state.car, true), keep); applyKit(false); sim.reset(); syncAll(); refresh(); store.set(KEY, state); });
  $('ownBtn').addEventListener('click', () => setCar(state.car));
  $('cmp').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.load != null) loadState(slots[+b.dataset.load].state);
    else if (b.dataset.del != null) { slots.splice(+b.dataset.del, 1); store.set(SLOTS, slots); drawCompare(); }
  });
  window.addEventListener('resize', () => { view.resize(); drawChart1(); drawChart2(); });
  requestAnimationFrame(frame);
  window.__lab = { get state() { return state; }, sim, get P() { return P; }, get H() { return H; } };
}
init();
})(window.Lab);
