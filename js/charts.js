/* 折れ線グラフ（canvas）。cfg.series = [{name, color, pts:[[x,y]...], thin}] */
(function (L) {
'use strict';
function niceStep(x) {
  const p = Math.pow(10, Math.floor(Math.log10(x))), n = x / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}
function nearest(pts, x) {
  let best = null, d = Infinity;
  for (const p of pts) { const dd = Math.abs(p[0] - x); if (dd < d) { d = dd; best = p; } }
  return best;
}
L.drawChart = function (cv, tip, cfg) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2), w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const m = { l: 48, r: 14, t: 22, b: 26 }, pw = w - m.l - m.r, ph = h - m.t - m.b;
  let ymin = cfg.ymin, ymax = cfg.ymax;
  if (ymin == null) {
    ymin = Infinity; ymax = -Infinity;
    cfg.series.forEach(s => s.pts.forEach(p => { ymin = Math.min(ymin, p[1]); ymax = Math.max(ymax, p[1]); }));
    if (cfg.zero) { ymin = Math.min(0, ymin); ymax = Math.max(0, ymax); }
    if (ymax - ymin < (cfg.minSpan || 1e-6)) { const mid = (ymax + ymin) / 2, sp = cfg.minSpan || 1; ymin = mid - sp / 2; ymax = mid + sp / 2; }
  }
  const step = niceStep((ymax - ymin) / 4);
  ymin = Math.floor(ymin / step + 1e-9) * step; ymax = Math.ceil(ymax / step - 1e-9) * step;
  const X = x => m.l + (x - cfg.xmin) / (cfg.xmax - cfg.xmin) * pw;
  const Y = y => m.t + (1 - (y - ymin) / (ymax - ymin)) * ph;
  ctx.clearRect(0, 0, w, h);
  ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = '#8f8e84'; ctx.lineWidth = 1;
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let y = ymin; y <= ymax + step / 2; y += step) {
    ctx.strokeStyle = Math.abs(y) < step / 1000 ? '#5a5a52' : '#2c2c29';
    ctx.beginPath(); ctx.moveTo(m.l, Y(y)); ctx.lineTo(w - m.r, Y(y)); ctx.stroke();
    ctx.fillText(String(Math.round(y * 1000) / 1000), m.l - 6, Y(y));
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  cfg.xticks.forEach(t => ctx.fillText(t.label, X(t.x), h - m.b + 7));
  ctx.textAlign = 'left'; ctx.fillText(cfg.unit || '', 4, 2);
  if (cfg.markerX != null && cfg.markerX >= cfg.xmin && cfg.markerX <= cfg.xmax) {
    ctx.strokeStyle = '#c3c2b7'; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(X(cfg.markerX), m.t); ctx.lineTo(X(cfg.markerX), m.t + ph); ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.save(); ctx.beginPath(); ctx.rect(m.l, m.t - 2, pw, ph + 4); ctx.clip();
  ctx.lineJoin = 'round';
  cfg.series.forEach(s => {
    ctx.strokeStyle = s.color; ctx.lineWidth = s.thin ? 1.2 : 2; ctx.setLineDash(s.thin ? [3, 3] : []);
    ctx.beginPath(); s.pts.forEach((p, i) => (i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1])))); ctx.stroke();
  });
  ctx.restore(); ctx.setLineDash([]);
  cv._m = m; cv._pw = pw;
  if (cv._hf != null && tip) {
    const hx = cfg.xmin + cv._hf * (cfg.xmax - cfg.xmin);
    let html = '', px = null;
    cfg.series.forEach(s => {
      const p = nearest(s.pts, hx); if (!p) return;
      if (px == null) {
        px = X(p[0]); ctx.strokeStyle = '#6b6b63'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(px, m.t); ctx.lineTo(px, m.t + ph); ctx.stroke();
        html = '<div>' + cfg.xfmt(p[0]) + '</div>';
      }
      ctx.fillStyle = s.color; ctx.strokeStyle = '#1a1a19'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(X(p[0]), Y(p[1]), 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      html += '<div><i style="background:' + s.color + '"></i>' + s.name + '：<b>' + cfg.vfmt(p[1]) + '</b></div>';
    });
    tip.innerHTML = html; tip.style.display = 'block';
    const tw = tip.offsetWidth;
    tip.style.left = Math.max(0, Math.min(w - tw, px + (px > w / 2 ? -tw - 12 : 12))) + 'px';
  } else if (tip) tip.style.display = 'none';
};
L.chartHover = function (cv, redraw) {
  const move = e => {
    if (!cv._m) return;
    const r = cv.getBoundingClientRect(), px = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
    cv._hf = Math.max(0, Math.min(1, (px - cv._m.l) / cv._pw)); redraw();
  };
  const leave = () => { cv._hf = null; redraw(); };
  cv.addEventListener('mousemove', move); cv.addEventListener('mouseleave', leave);
  cv.addEventListener('touchstart', move, { passive: true }); cv.addEventListener('touchmove', move, { passive: true });
  cv.addEventListener('touchend', leave);
};
L.legend = function (el, series, extra) {
  el.innerHTML = series.filter(s => s.name).map(s => '<span><i style="background:' + s.color + '"></i>' + s.name + '</span>').join('') + (extra || '');
};
})(window.Lab);
