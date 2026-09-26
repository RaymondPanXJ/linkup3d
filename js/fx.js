/**
 * fx.js — 视效粒子层（issue #41，T7 视效打磨，纯表现层零逻辑）
 *
 * - window.FX，UMD 双端（Node 可 require 做纯函数侧证）；
 * - 纯函数核心：createPool / makeBurst / step（可注入 rand，确定性可测）；
 * - canvas 渲染适配：mount(canvas) 返回 { burst(x, y, kind) }，
 *   kind: 'freeze' 冰晶迸溅 / 'thaw' 碎冰四散 / 'star' 通关星尘；
 * - 取舍（issue #41 二选一）：使用独立轻量 canvas #fxlayer + 按需 rAF，
 *   而非挂进 #starfield 的循环——#starfield 循环由 stars.js 独占且其
 *   行为已被既有静态断言锁定，共享需重构 stars.js 并触碰既有测试；
 *   独立画布零侵入，且无粒子时 rAF 完全停摆（零开销、移动端不降帧）。
 * - prefers-reduced-motion 命中时 burst 为 no-op（不生成粒子、不启动循环）；
 * - 单次 burst 粒子上限 60（性能约束）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.FX = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX_PER_BURST = 60; // 单次 burst 粒子上限（性能约束，issue #41）

  // 各 kind 的粒子画像：数量/速度区间/寿命区间/尺寸区间/配色/重力(px/s²)
  var KINDS = {
    freeze: { count: 26, speed: [40, 170],  life: [0.35, 0.70], size: [1.5, 3.5],
              gravity: 300, colors: ['#bfeaff', '#8ed7ff', '#ffffff'] },
    thaw:   { count: 44, speed: [70, 250],  life: [0.40, 0.90], size: [2.0, 5.0],
              gravity: 430, colors: ['#d2f5ff', '#9adcff', '#7ec8ff'] },
    star:   { count: 30, speed: [30, 150],  life: [0.50, 1.10], size: [1.5, 4.0],
              gravity: -50, colors: ['#ffd166', '#ffe9c4', '#ffffff'] }
  };

  function createPool() {
    return { items: [] };
  }

  function lerp(a, b, t) { return a + (b - a) * t; }
  function pick(arr, rand) { return arr[Math.floor(rand() * arr.length) % arr.length]; }

  /**
   * 生成一次 burst 的粒子数组（纯函数，rand 注入可确定复现）。
   * x/y 为视口坐标(px)；未知 kind 返回空数组；数量硬上限 MAX_PER_BURST。
   */
  function makeBurst(x, y, kind, rand) {
    var cfg = KINDS[kind];
    if (!cfg) return [];
    var r = typeof rand === 'function' ? rand : Math.random;
    var count = Math.min(cfg.count, MAX_PER_BURST);
    var out = [];
    for (var i = 0; i < count; i++) {
      var ang = r() * Math.PI * 2;
      var sp = lerp(cfg.speed[0], cfg.speed[1], r());
      var life = lerp(cfg.life[0], cfg.life[1], r());
      out.push({
        kind: kind,
        x: x, y: y,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp,
        size: lerp(cfg.size[0], cfg.size[1], r()),
        life: life,
        age: 0,
        gravity: cfg.gravity,
        color: pick(cfg.colors, r)
      });
    }
    return out;
  }

  /**
   * 粒子推进 dt 秒（原地更新并剔除死亡粒子，纯函数式状态迁移）。
   * 返回存活粒子数。
   */
  function step(pool, dt) {
    var alive = [];
    for (var i = 0; i < pool.items.length; i++) {
      var p = pool.items[i];
      p.age += dt;
      if (p.age >= p.life) continue;
      p.vy += (p.gravity || 0) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      alive.push(p);
    }
    pool.items = alive;
    return alive.length;
  }

  /**
   * 浏览器适配层：挂载到 canvas，返回 { burst }。
   * options.reducedMotion 可注入（测试用）；缺省查询 matchMedia。
   */
  function mount(canvas, options) {
    var opts = options || {};
    var reduced = false;
    if (opts.reducedMotion === true) {
      reduced = true;
    } else {
      try {
        reduced = typeof matchMedia === 'function' &&
                  matchMedia('(prefers-reduced-motion: reduce)').matches === true;
      } catch (e) { reduced = false; }
    }
    var ctx = (canvas && canvas.getContext) ? canvas.getContext('2d') : null;
    var pool = createPool();
    var rafId = null;
    var last = 0;

    function resize() {
      if (!canvas) return;
      var dpr = (typeof devicePixelRatio === 'number' && devicePixelRatio > 0) ?
        Math.min(devicePixelRatio, 2) : 1;
      canvas.width = Math.max(1, Math.round(window.innerWidth * dpr));
      canvas.height = Math.max(1, Math.round(window.innerHeight * dpr));
      ctx.scale(dpr, dpr);
    }
    if (ctx) {
      resize();
      window.addEventListener('resize', resize);
    }

    function frame(now) {
      var dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
      last = now;
      step(pool, dt);
      draw();
      if (pool.items.length) {
        rafId = requestAnimationFrame(frame);
      } else {
        rafId = null;
        last = 0;
        if (ctx) ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      }
    }

    function draw() {
      if (!ctx) return;
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      for (var i = 0; i < pool.items.length; i++) {
        var p = pool.items[i];
        ctx.globalAlpha = Math.max(0, 1 - p.age / p.life);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    function burst(x, y, kind) {
      if (reduced || !ctx) return; // reduced-motion：no-op（issue #41 约束）
      var parts = makeBurst(x, y, kind, Math.random);
      if (!parts.length) return;
      var head = pool.items;
      var overflow = Math.max(0, head.length + parts.length - MAX_PER_BURST * 3);
      if (overflow > 0) head.splice(0, overflow); // 池总量护栏：丢最旧
      for (var i = 0; i < parts.length; i++) {
        parts[i].kind = kind;
        head.push(parts[i]);
      }
      if (rafId === null) rafId = requestAnimationFrame(frame);
    }

    return { burst: burst, pool: pool, isReduced: function () { return reduced; } };
  }

  return {
    MAX_PER_BURST: MAX_PER_BURST,
    KINDS: KINDS,
    createPool: createPool,
    makeBurst: makeBurst,
    step: step,
    mount: mount
  };
});
