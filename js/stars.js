/**
 * stars.js — 动态星空背景（canvas + requestAnimationFrame，issue #10）
 *
 * - 三层视差星场：远距离星慢、近处星快，附带缓慢横向漂移与正弦闪烁；
 * - prefers-reduced-motion 命中时静态渲染一帧，不启动动画循环；
 * - document.visibilitychange 隐藏时暂停 rAF，恢复时重启动画；
 * - 纯调度函数 pickStarRadii / starAlpha 抽出供 Node 测试。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Stars = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 每千平方像素的星星数量（三层合计），及每层占半径/速度权重
  var DENSITY = 0.00022;
  var LAYERS = [
    { rMin: 0.4, rMax: 0.9, vx: 2.0, vy: 1.2, tw: 0.9 },   // 远：小而慢
    { rMin: 0.7, rMax: 1.4, vx: 4.5, vy: 2.6, tw: 1.5 },
    { rMin: 1.0, rMax: 2.0, vx: 8.0, vy: 4.4, tw: 2.2 }    // 近：大而快
  ];

  function starCountFor(w, h) {
    return Math.max(40, Math.min(360, Math.round(w * h * DENSITY)));
  }

  // 半径（px）：layerIndex + [0,1) 随机量 -> 该层半径区间内的值
  function pickStarRadius(layerIndex, rand) {
    var l = LAYERS[layerIndex % LAYERS.length];
    return l.rMin + (l.rMax - l.rMin) * rand;
  }

  // 闪烁透明度：base + amp*sin(2π·phase)，phase 归一 [0,1) -> 映射到 [0,2π)
  function starAlpha(phase, base, amp) {
    var p = phase - Math.floor(phase);
    return base + amp * Math.sin(p * Math.PI * 2);
  }

  /**
   * 位移一步：星星越界后从对侧回绕（wrap），返回归一化坐标 [0,1]。
   * dt 秒；layer 提供 vx/vy（px/s，按 1080p 基准缩放为归一化速度）。
   */
  function advance(star, dt, layer, aspect) {
    var nx = star.x - (layer.vx / 1920) * dt;
    var ny = star.y - (layer.vy / aspect) * dt;
    if (nx < 0) nx += 1;
    if (ny < 0) ny += 1;
    return { x: nx - Math.floor(nx), y: ny - Math.floor(ny) };
  }

  /** 挂载到 canvas 并开始动画；返回 {stop()} 清理句柄 */
  function mount(canvas) {
    var ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) return { stop: function () {} };

    var dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    var stars = [], w = 0, h = 0, rafId = null, last = 0;
    var reduced = typeof matchMedia === 'function' &&
                  matchMedia('(prefers-reduced-motion: reduce)').matches;

    function resize() {
      w = canvas.clientWidth || window.innerWidth;
      h = canvas.clientHeight || window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
      if (reduced || rafId === null) draw(0);
    }

    function seed() {
      stars = [];
      var n = starCountFor(w, h);
      for (var i = 0; i < n; i++) {
        var li = i % LAYERS.length;
        stars.push({
          x: Math.random(), y: Math.random(),
          r: pickStarRadius(li, Math.random()),
          layer: li,
          ph: Math.random(),
          sp: 0.05 + Math.random() * 0.15   // 闪烁相位速度（周/秒）
        });
      }
    }

    function draw(dt) {
      ctx.clearRect(0, 0, w, h);
      var aspect = Math.max(1, h);
      for (var i = 0; i < stars.length; i++) {
        var s = stars[i];
        if (!reduced && dt > 0) {
          var p = advance(s, dt, LAYERS[s.layer], aspect);
          s.x = p.x; s.y = p.y;
          s.ph = (s.ph + s.sp * dt) % 1;
        }
        var a = starAlpha(s.ph, 0.55, 0.4);
        ctx.globalAlpha = a;
        ctx.fillStyle = i % 7 === 3 ? '#bcd4ff' : (i % 11 === 5 ? '#ffe9c4' : '#ffffff');
        ctx.beginPath();
        ctx.arc(s.x * w, s.y * h, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    function frame(now) {
      var dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now;
      draw(dt);
      rafId = requestAnimationFrame(frame);
    }

    function play() {
      if (reduced || rafId !== null) return;
      last = 0;
      rafId = requestAnimationFrame(frame);
    }
    function pause() {
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    }

    function onVisibility() {
      if (document.hidden) pause(); else play();
    }

    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', onVisibility);
    resize();
    if (!reduced) play();

    return {
      stop: function () {
        pause();
        window.removeEventListener('resize', resize);
        document.removeEventListener('visibilitychange', onVisibility);
      }
    };
  }

  return {
    DENSITY: DENSITY,
    LAYERS: LAYERS,
    starCountFor: starCountFor,
    pickStarRadius: pickStarRadius,
    starAlpha: starAlpha,
    advance: advance,
    mount: mount
  };
});
