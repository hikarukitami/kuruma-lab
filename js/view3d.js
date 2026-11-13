/* 3D表示：車体・パーツ・タイヤ・路面・気流・力の矢印 */
(function (L) {
'use strict';
const T = window.THREE;
const FLOW_H = 3.4, FLOOR = 0.17;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

L.View = function (host, labelHost) {
  const renderer = new T.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  host.prepend(renderer.domElement);
  const scene = new T.Scene();
  scene.background = new T.Color(0x141a22);
  scene.fog = new T.Fog(0x141a22, 12, 26);
  const camera = new T.PerspectiveCamera(36, 2, 0.1, 80);
  const controls = new T.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.enablePan = false;
  controls.minDistance = 3.5; controls.maxDistance = 16; controls.maxPolarAngle = Math.PI / 2 - 0.03;
  controls.target.set(0, 0.55, 0);
  scene.add(new T.HemisphereLight(0xdfe8ff, 0x20242b, 1.5));
  const sun = new T.DirectionalLight(0xffffff, 2.4); sun.position.set(4, 8, 5); scene.add(sun);
  [[-6, 5, -4, 1.4], [6, 3, -6, 1.0], [-3, 4, 7, 0.9]].forEach(q => { const d = new T.DirectionalLight(0xdfe8ff, q[3]); d.position.set(q[0], q[1], q[2]); scene.add(d); });

  // 路面
  const groundGeo = new T.PlaneGeometry(44, 36, 176, 8); groundGeo.rotateX(-Math.PI / 2);
  const ground = new T.Mesh(groundGeo, new T.MeshStandardMaterial({ color: 0x30353d, roughness: 1 }));
  scene.add(ground);
  const dashes = [];
  const dashGeo = new T.BoxGeometry(1.6, 0.02, 0.09), dashMat = new T.MeshBasicMaterial({ color: 0x59606a });
  for (let k = 0; k < 22; k++) { const m = new T.Mesh(dashGeo, dashMat); m.position.z = k % 2 ? 2.7 : -2.7; scene.add(m); dashes.push(m); }

  const bodyGroup = new T.Group(); scene.add(bodyGroup);
  const wheels = [], springs = [], bars = [];
  const flowGroup = new T.Group(); scene.add(flowGroup);
  const arrowGroup = new T.Group(); scene.add(arrowGroup);
  let P = null, bodyMesh = null, faces = [], flow = null, wingGroup = null, mode = 'paint', xray = false;
  let parts = null, particles = null, lines = [];

  /* ---------- 小道具 ---------- */
  const mat = (color, o) => new T.MeshStandardMaterial(Object.assign({ color, roughness: 0.6, metalness: 0.1 }, o || {}));
  const partMat = mat(0x9aa2ad, { roughness: 0.4, metalness: 0.3 });
  // 車の座標(x:後→前, h:高さ, s:左+) の箱を車体ローカルに置く
  function box(x0, x1, h0, h1, s0, s1, material) {
    const m = new T.Mesh(new T.BoxGeometry(Math.abs(x1 - x0), Math.abs(h1 - h0), Math.abs(s1 - s0)), material || partMat);
    m.position.set((x0 + x1) / 2 - P.xcg, (h0 + h1) / 2, -(s0 + s1) / 2);
    return m;
  }
  function makeArrow(color) {
    const g = new T.Group(), m = new T.MeshBasicMaterial({ color });
    const shaft = new T.Mesh(new T.CylinderGeometry(0.028, 0.028, 1, 10), m); shaft.geometry.translate(0, 0.5, 0);
    const head = new T.Mesh(new T.ConeGeometry(0.085, 0.22, 14), m); head.geometry.translate(0, 0.11, 0);
    g.add(shaft, head); arrowGroup.add(g);
    const up = new T.Vector3(0, 1, 0), d = new T.Vector3();
    g.set = (x, y, z, dx, dy, dz, len) => {
      g.visible = len > 0.08; if (!g.visible) return;
      const hl = Math.min(0.22, len * 0.6);
      g.position.set(x, y, z); d.set(dx, dy, dz).normalize(); g.quaternion.setFromUnitVectors(up, d);
      shaft.scale.y = len - hl; head.position.y = len - hl; head.scale.setScalar(hl / 0.22);
    };
    return g;
  }
  const arrows = { drag: makeArrow(0xd95926), dfF: makeArrow(0x3987e5), dfR: makeArrow(0x199e70), side: makeArrow(0xc98500) };
  const labels = {};
  function label(id, text, x, y, z, show) {
    let el = labels[id];
    if (!el) { el = labels[id] = document.createElement('div'); el.className = 'lbl'; labelHost.appendChild(el); }
    if (!show) { el.style.display = 'none'; return; }
    const v = new T.Vector3(x, y, z).project(camera);
    if (v.z > 1) { el.style.display = 'none'; return; }
    el.style.display = 'block'; el.textContent = text;
    el.style.left = ((v.x * 0.5 + 0.5) * host.clientWidth) + 'px';
    el.style.top = ((-v.y * 0.5 + 0.5) * host.clientHeight) + 'px';
  }

  /* ---------- 気流の簡易モデル ---------- */
  function buildProfile() {
    const c = P.car, s = P.s, x0 = -5.2, step = 0.05, n = Math.ceil((c.L + 9) / step);
    const drop = -(P.hF + P.hR) / 2;
    let rearH = c.rearH - drop;
    if (s.rear === 'spoiler') rearH += 0.06;
    if (s.rear === 'wingS' || s.rear === 'wingL') rearH += 0.1 + 0.012 * s.wingAngle;
    const wl = c.wakeLen * (s.diff !== 'none' ? 0.88 : 1), raw = [];
    for (let i = 0; i < n; i++) {
      const x = x0 + i * step;
      raw.push(x < 0 ? rearH * Math.exp(x / wl) : x > c.L ? 0.6 * Math.exp(-(x - c.L) / 0.45) : L.topAt(c, x) - drop);
    }
    const Tm = raw.map((_, i) => { let a = 0, m = 0; for (let j = i - 6; j <= i + 6; j++) if (j >= 0 && j < n) { a += raw[j]; m++; } return a / m; });
    const at = x => Tm[clamp(Math.round((x - x0) / step), 0, n - 1)];
    return { at, max: Math.max.apply(null, Tm), ratio: x => FLOW_H / (FLOW_H - at(x)) };
  }
  function speedColor(r, out) {
    const base = [0.55, 0.72, 0.92], slow = [0.2, 0.36, 0.66], fast = [1, 0.56, 0.3];
    const t = r < 1 ? clamp((1 - r) / 0.5, 0, 1) : clamp((r - 1) / 0.75, 0, 1), o = r < 1 ? slow : fast;
    out[0] = lerp(base[0], o[0], t); out[1] = lerp(base[1], o[1], t); out[2] = lerp(base[2], o[2], t);
  }
  function buildFlow(beta) {
    while (flowGroup.children.length) { const o = flowGroup.children.pop(); o.geometry.dispose(); }
    lines = [];
    const c = P.car, W = c.width, xoff = c.rearAxle + c.wb / 2, tb = Math.tan(beta || 0);
    const ys = [0, 0.38, -0.38, 0.74, -0.74, 1.05, -1.05, 1.4, -1.4], hs = [0.22, 0.55, 0.9, 1.25, 1.65];
    const col = [0, 0, 0], lm = new T.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.24 });
    const xStart = c.L + 3.4, N = 82;
    ys.forEach(y0 => hs.forEach(h0 => {
      const pos = new Float32Array(N * 3), cols = new Float32Array(N * 3), rs = new Float32Array(N);
      const d = Math.abs(y0) - W / 2 * 0.85, wy = d <= 0 ? 1 : Math.exp(-Math.pow(d / 0.35, 2));
      const edge = Math.exp(-Math.pow((Math.abs(y0) - W / 2) / 0.45, 2)), lowK = h0 < 1.5 ? 1 - h0 / 1.5 : 0;
      for (let i = 0; i < N; i++) {
        const x = xStart - i * 0.1, Tw = flow.at(x) * wy;
        const h = Tw + h0 * (FLOW_H - Tw) / FLOW_H;
        const y = y0 + Math.sign(y0) * 0.45 * edge * lowK * (flow.at(x) / flow.max) - tb * (xStart - x);
        let r = FLOW_H / (FLOW_H - Tw);
        if (x < 0) r = h0 < 1 && wy > 0.5 ? 1 - 0.5 * Math.exp(x / 2.5) : 1 + (r - 1) * Math.exp(x / 0.8);
        pos[i * 3] = x - xoff; pos[i * 3 + 1] = h; pos[i * 3 + 2] = -y;
        speedColor(r, col); cols.set(col, i * 3); rs[i] = r;
      }
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('color', new T.BufferAttribute(cols, 3));
      flowGroup.add(new T.Line(g, lm));
      lines.push({ pos, cols, rs, N, wake: h0 < 1 && wy > 0.5 });
    }));
    const per = 4, cnt = lines.length * per, pp = new Float32Array(cnt * 3), pc = new Float32Array(cnt * 3);
    const pg = new T.BufferGeometry();
    pg.setAttribute('position', new T.BufferAttribute(pp, 3)); pg.setAttribute('color', new T.BufferAttribute(pc, 3));
    const pts = new T.Points(pg, new T.PointsMaterial({ size: 0.075, vertexColors: true, transparent: true, opacity: 0.95 }));
    flowGroup.add(pts);
    const u = particles ? particles.u : null;
    particles = { pts, per, u: u && u.length === cnt ? u : Float32Array.from({ length: cnt }, (_, i) => ((i % per) + Math.random()) / per * (N - 1)) };
  }
  function moveParticles(dt, v, t) {
    if (!particles) return;
    const pp = particles.pts.geometry.attributes.position, pc = particles.pts.geometry.attributes.color;
    const wob = 0.1 * (P.cdNow || 0.3) / 0.3 * P.car.wake * Math.min(1, v / 15);
    for (let k = 0; k < particles.u.length; k++) {
      const ln = lines[(k / particles.per) | 0];
      let u = particles.u[k]; const i0 = Math.min(ln.N - 2, u | 0), f = u - i0;
      u += dt * v * ln.rs[i0] * 3.5;                         // 0.1m刻み × 0.35倍速
      if (u >= ln.N - 1) u -= ln.N - 1;
      particles.u[k] = u;
      const a = i0 * 3, b = a + 3;
      let y = lerp(ln.pos[a + 1], ln.pos[b + 1], f);
      const x = lerp(ln.pos[a], ln.pos[b], f);
      const xr = x + P.car.rearAxle + P.car.wb / 2;        // 車の後端からの距離
      if (ln.wake && xr < 0) y += wob * (1 - Math.exp(xr / 0.5)) * Math.exp(xr / 3) * Math.sin(xr * 5 + t * 0.27 * v + k);
      pp.array[k * 3] = x; pp.array[k * 3 + 1] = y; pp.array[k * 3 + 2] = lerp(ln.pos[a + 2], ln.pos[b + 2], f);
      pc.array[k * 3] = ln.cols[a]; pc.array[k * 3 + 1] = ln.cols[a + 1]; pc.array[k * 3 + 2] = ln.cols[a + 2];
    }
    pp.needsUpdate = true; pc.needsUpdate = true;
  }

  /* ---------- 車体メッシュ ---------- */
  const nA = 9, nB = 5, nC = 7, M = nA + nB + nC;
  function profile(c) {                       // 屋根ラインをなめらかな曲線にする（行き過ぎない3次補間）
    const p = c.top, n = p.length, d = [], m = [];
    for (let i = 0; i < n - 1; i++) d.push((p[i + 1][1] - p[i][1]) / (p[i + 1][0] - p[i][0]));
    for (let i = 0; i < n; i++) m.push(i === 0 ? d[0] : i === n - 1 ? d[n - 2] : d[i - 1] * d[i] <= 0 ? 0 : 2 * d[i - 1] * d[i] / (d[i - 1] + d[i]));
    return x => {
      x = clamp(x, p[0][0], p[n - 1][0]);
      let i = 0; while (i < n - 2 && x > p[i + 1][0]) i++;
      const h = p[i + 1][0] - p[i][0], t = (x - p[i][0]) / h, t2 = t * t, t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * p[i][1] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * p[i + 1][1] + (t3 - t2) * h * m[i + 1];
    };
  }
  function halfW(c, x) {                      // 上から見た幅（前後の角を丸める）
    const u = Math.abs(x - c.L / 2) / (c.L / 2), e = Math.max(0, Math.min(x, c.L - x));
    return c.width / 2 * (1 - 0.14 * Math.pow(u, 3)) * (e < 0.5 ? 0.74 + 0.26 * Math.pow(Math.sin(Math.PI / 2 * e / 0.5), 0.55) : 1);
  }
  function floorAt(c, x) {
    const e = Math.max(0, Math.min(x, c.L - x));
    return FLOOR + (e < 0.4 ? 0.13 * Math.pow(1 - e / 0.4, 2) : 0);
  }
  // 断面：サイド(A)→ガラス面(B)→屋根(C) を曲線でつなぐ。返り値は右半分 [x, 高さ, 横] の点列
  function section(c, Tf, x) {
    const top = Tf(x), w = halfW(c, x), fl = floorAt(c, x);
    const g = clamp((top - c.belt) / 0.4, 0, 1), sm = g * g * (3 - 2 * g), crown = lerp(0.1, 0.06, sm);
    const hb = Math.max(fl + 0.05, Math.min(c.belt, top - crown)), ghB = Math.max(0, top - crown - hb);
    const wr = lerp(0.955 * w, 0.7 * w, sm), pts = [];
    for (let i = 0; i < nA; i++) { const t = i / (nA - 1); pts.push([x, fl + (hb - fl) * t, w * (1 - 0.12 * Math.pow(1 - t, 3) - 0.03 * t * t)]); }
    for (let i = 0; i < nB; i++) { const t = (i + 1) / nB; pts.push([x, hb + ghB * t, lerp(0.97 * w, wr, Math.pow(t, 0.7))]); }
    for (let i = 0; i < nC; i++) { const th = (i + 1) / nC * Math.PI / 2; pts.push([x, hb + ghB + crown * Math.pow(Math.sin(th), 0.8), i === nC - 1 ? 0 : wr * Math.pow(Math.cos(th), 0.5)]); }
    return { pts, ghB, sm };
  }
  function buildBody() {
    const c = P.car, Tf = profile(c), R = 2 * M - 1, xs = [];
    const ns = Math.round(c.L / 0.05);
    for (let j = 0; j <= ns; j++) xs.push(c.L * j / ns);
    const secs = xs.map(x => section(c, Tf, x)), verts = [];
    secs.forEach(sc => {
      for (let k = 0; k < R; k++) { const q = sc.pts[k < M ? k : 2 * M - 2 - k], sgn = k < M ? 1 : -1; verts.push([q[0], q[1], sgn * q[2]]); }
    });
    const flat = xs.filter((x, j) => secs[j].sm > 0.9 && Math.abs(Tf(x + 0.03) - Tf(x - 0.03)) / 0.06 < 0.3);
    const xB = flat.length ? (flat[0] + flat[flat.length - 1]) / 2 - 0.1 : -9;
    const axles = [c.rearAxle, c.rearAxle + c.wb], idx = [];
    faces = [];
    const tri = (a, b, cc, kind) => { idx.push(a, b, cc); faces.push({ v: [a, b, cc], kind }); };
    for (let j = 0; j < xs.length - 1; j++) {
      const xm = (xs[j] + xs[j + 1]) / 2, slope = Math.abs(Tf(xs[j + 1]) - Tf(xs[j])) / (xs[j + 1] - xs[j]);
      const gh = (secs[j].ghB + secs[j + 1].ghB) / 2;
      for (let k = 0; k < R; k++) {
        const k2 = (k + 1) % R, a = j * R + k, b = j * R + k2, d = (j + 1) * R + k, e = (j + 1) * R + k2;
        let kind = 'paint';
        if (k === R - 1) kind = 'floor';
        else {
          const ci = k < M - 1 ? k : 2 * M - 3 - k;
          if (ci <= nA - 2) {
            const hm = (verts[a][1] + verts[b][1]) / 2;
            if (axles.some(xa => Math.pow(xm - xa, 2) + Math.pow(hm - c.wheelR, 2) < Math.pow(1.15 * c.wheelR, 2))) continue;   // ホイールハウスの穴
          } else if (ci <= nA + nB - 2) {
            if (gh > 0.2 && ci - (nA - 1) <= nB - 2 && Math.abs(xm - xB) > 0.035) kind = 'glass';
          } else if (slope > 0.3 && gh > 0.1 && ci - (nA - 1 + nB) >= 1) kind = 'glass';
        }
        tri(a, b, e, kind); tri(a, e, d, kind);
      }
    }
    [0, xs.length - 1].forEach(j => {             // 前後の端をふさぐ
      const sc = secs[j].pts, ci = verts.length; verts.push([xs[j], (sc[0][1] + sc[M - 1][1]) / 2, 0]);
      for (let k = 0; k < R; k++) tri(ci, j * R + k, j * R + (k + 1) % R, 'paint');
    });
    const center = [c.L / 2, 0.6, 0];
    faces.forEach(f => {
      const a = verts[f.v[0]], b = verts[f.v[1]], cc = verts[f.v[2]];
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [cc[0] - a[0], cc[1] - a[1], cc[2] - a[2]];
      let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const len = Math.hypot(n[0], n[1], n[2]) || 1; n = n.map(q => q / len);
      const mid = [0, 1, 2].map(i => (a[i] + b[i] + cc[i]) / 3);
      if (n[0] * (mid[0] - center[0]) + n[1] * (mid[1] - center[1]) + n[2] * (mid[2] - center[2]) < 0) n = n.map(q => -q);
      f.n = n; f.x = mid[0];
    });
    const pos = new Float32Array(verts.length * 3);
    verts.forEach((q, i) => { pos[i * 3] = q[0] - P.xcg; pos[i * 3 + 1] = q[1]; pos[i * 3 + 2] = -q[2]; });
    let g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setIndex(idx);
    g.computeVertexNormals();
    g = g.toNonIndexed();                         // 法線はなめらかなまま、色だけ面ごとに塗れるようにする
    g.setAttribute('color', new T.BufferAttribute(new Float32Array(faces.length * 9), 3));
    bodyMesh = new T.Mesh(g, new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.35, side: T.DoubleSide }));
    bodyGroup.add(bodyMesh);
    P.Tf = Tf;
  }
  function cpOf(f) {
    const r = flow.ratio(f.x), q = r * r - 1, fx = f.n[0];
    if (f.kind === 'floor') return -0.25 - (P.s.tray ? 0.25 : 0) - (P.s.diff !== 'none' ? 0.3 : 0);
    if (fx > 0.25) return fx * fx - (1 - fx * fx) * 0.5 * q;
    if (fx < -0.25) return -0.25 * -fx - (1 - fx * fx) * 0.5 * q;
    return -0.5 * q * (Math.abs(f.n[1]) > 0.5 ? 1 : 0.6);
  }
  function colorize() {
    if (!bodyMesh) return;
    const arr = bodyMesh.geometry.attributes.color.array, paint = new T.Color(P.car.color), col = new T.Color();
    const neg = [0.224, 0.529, 0.898], zero = [0.5, 0.5, 0.48], posC = [0.85, 0.35, 0.15];
    faces.forEach((f, k) => {
      if (mode === 'press') {
        const cp = cpOf(f), t = clamp(Math.abs(cp) / (cp < 0 ? 1.2 : 1), 0, 1), o = cp < 0 ? neg : posC;
        col.setRGB(lerp(zero[0], o[0], t), lerp(zero[1], o[1], t), lerp(zero[2], o[2], t));
      } else if (f.kind === 'glass') col.setHex(P.car.glass);
      else if (f.kind === 'floor') col.setHex(0x0e0f11);
      else col.copy(paint);
      for (let i = 0; i < 3; i++) { arr[k * 9 + i * 3] = col.r; arr[k * 9 + i * 3 + 1] = col.g; arr[k * 9 + i * 3 + 2] = col.b; }
    });
    bodyMesh.geometry.attributes.color.needsUpdate = true;
    bodyMesh.material.transparent = xray; bodyMesh.material.opacity = xray ? 0.22 : 1; bodyMesh.material.depthWrite = !xray;
    bodyMesh.material.needsUpdate = true;
  }

  function buildParts() {
    const c = P.car, s = P.s, W = c.width, g = new T.Group();
    const fa = c.rearAxle + c.wb, Tf = P.Tf, tailH = c.top[0][1];
    const lightF = new T.MeshBasicMaterial({ color: 0xfff1c4 }), lightR = new T.MeshBasicMaterial({ color: 0xff3b30 });
    const paintMat = mat(c.color, { roughness: 0.32, metalness: 0.35 }), wellMat = new T.MeshBasicMaterial({ color: 0x050607 });
    const wf = halfW(c, c.L - 0.12), wt = halfW(c, 0.08), hl = Tf(c.L - 0.12);
    let xw = c.L; while (xw > 0 && Tf(xw) < c.belt + 0.08) xw -= 0.02;       // フロントガラスの付け根
    [c.rearAxle, fa].forEach(x => {                                          // ホイールハウスの内側
      const m = new T.Mesh(new T.CylinderGeometry(c.wheelR * 1.13, c.wheelR * 1.13, c.width * 0.93, 24), wellMat);
      m.rotation.x = Math.PI / 2; m.position.set(x - P.xcg, c.wheelR, 0); g.add(m);
    });
    [-1, 1].forEach(sd => {
      g.add(box(c.L - 0.2, c.L - 0.05, hl - 0.14, hl - 0.04, sd * 0.42 * wf, sd * 0.84 * wf, lightF));
      g.add(box(0.035, 0.13, tailH - 0.17, tailH - 0.05, sd * 0.5 * wt, sd * 0.88 * wt, lightR));
      [c.rearAxle, fa].forEach(x => {                         // フェンダーアーチ
        const m = new T.Mesh(new T.TorusGeometry(c.wheelR * 1.17, 0.03, 8, 28, Math.PI), paintMat);
        m.position.set(x - P.xcg, c.wheelR, -sd * (halfW(c, x) * 0.975)); g.add(m);
      });
      const wm = halfW(c, xw - 0.15);
      g.add(box(xw - 0.24, xw - 0.1, c.belt + 0.03, c.belt + 0.13, sd * 0.9 * wm, sd * (0.9 * wm + 0.17), paintMat));   // ドアミラー
      if (s.skirt) g.add(box(c.rearAxle + 0.42, fa - 0.42, FLOOR - 0.05, FLOOR + 0.03, sd * (W / 2 - 0.03), sd * (W / 2 + 0.05)));
      if (s.canard) {
        const m = box(c.L - 0.5, c.L - 0.18, 0.4, 0.425, sd * (W / 2 - 0.14), sd * (W / 2 + 0.06)); m.rotation.z = -0.22; g.add(m);
        const m2 = box(c.L - 0.42, c.L - 0.16, 0.26, 0.285, sd * (W / 2 - 0.14), sd * (W / 2 + 0.04)); m2.rotation.z = -0.22; g.add(m2);
      }
    });
    if (s.front === 'lip') g.add(box(c.L - 0.14, c.L + 0.05, FLOOR - 0.05, FLOOR + 0.01, -W * 0.4, W * 0.4));
    if (s.front === 'splitter') g.add(box(c.L - 0.3, c.L + 0.15, FLOOR - 0.04, FLOOR - 0.012, -W * 0.46, W * 0.46));
    if (s.duct) { const x = c.L - 0.85, h = P.Tf(x) + 0.09; g.add(box(x - 0.2, x + 0.2, h - 0.03, h + 0.012, -0.3, 0.3, mat(0x050607))); }
    if (s.tray) g.add(box(0.5, c.L - 0.35, FLOOR - 0.022, FLOOR - 0.004, -W * 0.42, W * 0.42, mat(0x8d949d)));
    if (s.diff !== 'none') {
      const big = s.diff === 'large', len = big ? 0.75 : 0.5, ang = big ? 0.26 : 0.17;
      const d = new T.Group(); d.position.set(len - P.xcg, FLOOR - 0.01, 0); d.rotation.z = -ang;
      const pl = new T.Mesh(new T.BoxGeometry(len, 0.02, W * 0.8), partMat); pl.position.x = -len / 2; d.add(pl);
      if (big) for (let i = -2; i <= 2; i++) { const fin = new T.Mesh(new T.BoxGeometry(len, 0.11, 0.015), partMat); fin.position.set(-len / 2, -0.055, i * W * 0.17); d.add(fin); }
      g.add(d);
    }
    wingGroup = null;
    if (s.rear === 'spoiler') { const sp = c.spoiler; g.add(box(sp.x0, sp.x1, sp.h0, sp.h1, -sp.half, sp.half)); }
    if (s.rear === 'wingS' || s.rear === 'wingL') {
      const wp = L.PARTS.rear[s.rear], wg = c.wing;
      [-1, 1].forEach(sd => g.add(box(wg.x + 0.02, wg.x + 0.07, wg.base - 0.06, wg.h, sd * 0.3, sd * 0.33)));
      wingGroup = new T.Group(); wingGroup.position.set(wg.x - P.xcg, wg.h, 0);
      const foil = new T.Mesh(new T.BoxGeometry(wp.chord, 0.03, wp.span), partMat); wingGroup.add(foil);
      [-1, 1].forEach(sd => { const e = new T.Mesh(new T.BoxGeometry(wp.chord + 0.08, 0.17, 0.012), partMat); e.position.set(0, 0.03, sd * wp.span / 2); wingGroup.add(e); });
      if (s.gurney) { const gf = new T.Mesh(new T.BoxGeometry(0.012, 0.035, wp.span), mat(0xc98500)); gf.position.set(-wp.chord / 2, 0.03, 0); wingGroup.add(gf); }
      wingGroup.rotation.z = -s.wingAngle * Math.PI / 180;
      g.add(wingGroup);
    }
    parts = g; bodyGroup.add(g);
  }
  function buildWheels() {
    wheels.splice(0).forEach(w => scene.remove(w));
    springs.splice(0).forEach(w => scene.remove(w));
    bars.splice(0).forEach(w => scene.remove(w));
    const c = P.car, R = c.wheelR, rimCol = { stock: 0x8b9199, alloy: 0xc9ced6, forged: 0xd9b45a }[P.s.wheel];
    const tyreMat = mat(0x141517, { roughness: 0.9 }), rimMat = mat(rimCol, { metalness: 0.6, roughness: 0.35 });
    const hp = []; for (let i = 0; i <= 80; i++) { const a = i / 80 * Math.PI * 2 * 7; hp.push(Math.cos(a) * 0.055, i / 80, Math.sin(a) * 0.055); }
    const helix = new T.BufferGeometry(); helix.setAttribute('position', new T.Float32BufferAttribute(hp, 3));
    for (let i = 0; i < 4; i++) {
      const wg = new T.Group(), spin = new T.Group(); wg.add(spin); wg.spin = spin;
      const ty = new T.Mesh(new T.CylinderGeometry(R, R, c.tyreW, 28), tyreMat); ty.rotation.x = Math.PI / 2; spin.add(ty);
      const rim = new T.Mesh(new T.CylinderGeometry(R * 0.66, R * 0.66, c.tyreW + 0.012, 24), rimMat); rim.rotation.x = Math.PI / 2; spin.add(rim);
      for (let k = 0; k < 5; k++) {
        const sp = new T.Mesh(new T.BoxGeometry(R * 1.2, 0.035, c.tyreW + 0.02), mat(0x2a2d32)); sp.rotation.z = k * Math.PI / 5; spin.add(sp);
      }
      scene.add(wg); wheels.push(wg);
      const sl = new T.Line(helix, new T.LineBasicMaterial({ color: 0xffc94d })); scene.add(sl); springs.push(sl);
      const bar = new T.Mesh(new T.BoxGeometry(0.07, 1, 0.07), new T.MeshBasicMaterial({ color: 0x86b6ef })); bar.geometry.translate(0, 0.5, 0);
      scene.add(bar); bars.push(bar);
    }
  }

  /* ---------- 外から呼ぶ関数 ---------- */
  this.rebuild = function (p, beta) {
    P = p;
    while (bodyGroup.children.length) {
      const o = bodyGroup.children.pop();
      o.traverse(q => { if (q.geometry) q.geometry.dispose(); });
    }
    flow = buildProfile();
    buildBody(); buildParts(); buildWheels(); buildFlow(beta); colorize();
  };
  this.setBeta = function (beta) { if (P) buildFlow(beta); };
  this.setMode = function (m, x) { mode = m; xray = x; colorize(); };
  this.setCamera = function (name) {
    const p = { iso: [4.6, 2.2, 5.7], side: [0, 1.1, 9.5], front: [9.5, 1.5, 0.01], rear: [-9.5, 2.2, 0.01], top: [0.01, 12, 0.01] }[name];
    camera.position.set(p[0], p[1], p[2]); controls.update();
  };
  this.resize = function () {
    const w = host.clientWidth, h = host.clientHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.fov = w / h < 1.3 ? 52 : 36; camera.updateProjectionMatrix();
  };
  const tmp = new T.Vector3();
  this.update = function (d) {
    if (!P) return;
    const c = P.car, sim = d.sim, ex = d.ex, ae = d.ae, half = c.wb / 2, R = c.wheelR, road = P.s.road;
    P.cdNow = ae.cd;
    // 路面
    const gp = groundGeo.attributes.position;
    for (let i = 0; i < gp.count; i++) {
      const x = gp.getX(i), z = gp.getZ(i), t = clamp((z + 0.75) / 1.5, 0, 1);
      gp.setY(i, ex * lerp(L.roadZ(road, sim.X + x + half, 1), L.roadZ(road, sim.X + x + half, -1), t));
    }
    gp.needsUpdate = true; groundGeo.computeVertexNormals();
    dashes.forEach((m, k) => { m.position.x = ((((k >> 1) * 4 - sim.X) % 44) + 44) % 44 - 22; m.position.y = 0.011; });
    // 車体
    bodyGroup.position.set(P.b - half, P.hR + (P.hF - P.hR) * (P.b / c.wb) + ex * sim.z, 0);
    bodyGroup.rotation.set(ex * sim.phi, 0, (P.hF - P.hR) / c.wb + ex * sim.th);
    // タイヤ・ばね・荷重バー
    const xs = [half, half, -half, -half], sd = [1, -1, 1, -1], tr = [c.tF, c.tF, c.tR, c.tR];
    const names = ['左前', '右前', '左後', '右後'];
    bodyGroup.updateMatrixWorld();
    for (let i = 0; i < 4; i++) {
      const w = wheels[i], fr = i < 2, z = -sd[i] * tr[i] / 2, cam = (fr ? P.s.camF : P.s.camR) * Math.PI / 180, toe = (fr ? P.s.toeF : P.s.toeR) * Math.PI / 180;
      w.position.set(xs[i], R + ex * sim.zu[i], z);
      w.rotation.set(-sd[i] * cam, (fr ? d.steer : 0) - sd[i] * toe, 0);
      w.spin.rotation.z = -sim.X / R;
      const sp = springs[i]; sp.visible = d.show.xray;
      if (sp.visible) {
        tmp.set((fr ? P.a : -P.b), 0.74, z + sd[i] * 0.2); bodyGroup.localToWorld(tmp);
        const by = w.position.y + 0.06;
        sp.position.set(xs[i], by, z + sd[i] * 0.2); sp.scale.y = Math.max(0.05, tmp.y - by);
      }
      const bar = bars[i]; bar.visible = d.show.force;
      const bz = z - sd[i] * 0.36;
      bar.position.set(xs[i], 0, bz); bar.scale.y = Math.max(0.01, sim.load[i] / 5000);
      label('w' + i, names[i] + ' ' + Math.round(sim.load[i]) + 'N', xs[i], sim.load[i] / 5000 + 0.14, bz, d.show.force);
    }
    // 気流
    flowGroup.visible = d.show.flow;
    if (d.show.flow) moveParticles(d.dt, d.v, sim.t);
    // 力の矢印
    arrowGroup.visible = d.show.force;
    const sc = 1 / 1200, f = d.show.force && d.v > 2;
    const dl = Math.min(2.6, ae.drag * sc), rx = -half - c.rearAxle;
    arrows.drag.set(rx - 0.15, 0.7, 0, -1, 0, 0, f ? dl : 0);
    label('drag', '空気抵抗 ' + Math.round(ae.drag) + 'N', rx - 0.15 - dl, 0.95, 0, f && dl > 0.08);
    [['dfF', half, ae.liftF, '前'], ['dfR', -half, ae.liftR, '後']].forEach(([id, x, lift, nm]) => {
      const len = Math.min(1.6, Math.abs(lift) * sc), topY = L.topAt(c, x + half + c.rearAxle) + 0.25;
      if (lift < 0) arrows[id].set(x, topY + len + 0.1, 0, 0, -1, 0, f ? len : 0);
      else arrows[id].set(x, topY, 0, 0, 1, 0, f ? len : 0);
      label(id, nm + (lift < 0 ? ' ダウンフォース ' : ' リフト ') + Math.round(Math.abs(lift)) + 'N', x, topY + len + 0.3, 0, f && len > 0.08);
    });
    const sl = Math.min(2, Math.abs(ae.side) * sc), cx = half - c.cop * c.wb;
    arrows.side.set(cx, 0.85, -(c.width / 2 + 0.1) * Math.sign(ae.side || 1) * -1, 0, 0, Math.sign(ae.side || 1), f ? sl : 0);
    label('side', '横力 ' + Math.round(Math.abs(ae.side)) + 'N', cx, 1.1, (c.width / 2 + 0.1 + sl) * Math.sign(ae.side || 1), f && sl > 0.08);
    controls.update();
    renderer.render(scene, camera);
  };
  this.setCamera('iso');
};
})(window.Lab);
