/**
 * stars.js — 动态星空背景（canvas + requestAnimationFrame，issue #10）
 *
 * - 三层视差星场：远距离星慢、近处星快，附带缓慢横向漂移与正弦闪烁；
 * - prefers-reduced-motion 命中时静态渲染一帧，不启动动画循环；
 * - document.visibilitychange 隐藏时暂停 rAF，恢复时重启动画；
 * - 纯调度函数 pickStarRadii / starAlpha 抽出供 Node 测试。
 *
 * issue #53 场景感知扩展（不新建第二块 canvas、共用单一 rAF）：
 * - mount(canvas) 返回 { stop, setScene(scene) }；scene 为 js/scene.js 场景对象；
 * - palette 覆盖星点色温（star1/2/3），density 缩放星点绘制数量（子集绘制，免重播种）；
 * - elements 叠加元素在星群之上绘制，每类一个 paint 函数（ELEMENT_PAINTERS），
 *   布点经 Scene.elementItems + 场景 id 种子的 mulberry32（确定性、Node 可断言坐标）；
 * - 场景切换 BLEND_MS=1000ms 渐变：palette/density 经 Scene.blend 插值，
 *   旧/新元素 alpha 交叉淡入淡出；reduced-motion 下元素静止单帧（不销毁）；
 * - 主题色仍走 readThemeColors + MutationObserver（无场景时行为与 issue #10 一致）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Stars = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Scene 库引用：浏览器取 self.Scene（scene.js 先于本文件加载）；
  // Node 侧仅纯函数被使用，mount 不依赖加载顺序成功 require。
  var SceneLib = (typeof self !== 'undefined' && self.Scene) ? self.Scene : null;
  if (!SceneLib && typeof require === 'function') {
    try { SceneLib = require('./scene.js'); } catch (e) { SceneLib = null; }
  }

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function sceneSeed(id) {
    var h = 0x9E3779B9;
    var s = String(id || 'default');
    for (var i = 0; i < s.length; i++) {
      h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
    }
    return h;
  }

  function hexToRgb(hex) {
    var n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function rgba(hex, a) {
    var c = hexToRgb(hex);
    var v = a < 0 ? 0 : (a > 1 ? 1 : a);
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + v.toFixed(3) + ')';
  }

  function easeInOut(t) { return t * t * (3 - 2 * t); }

  // 密度子集绘制数量：density∈(0,1] 线性缩星点数，非法回退全量。纯函数供 Node 测试。
  function starDrawCount(total, density) {
    var d = (typeof density === 'number' && density > 0 && density <= 1) ? density : 1;
    return Math.max(1, Math.round(total * d));
  }

  // 每千平方像素的星星数量（三层合计），及每层占半径/速度权重
  var DENSITY = 0.00022;

  // 星点颜色：优先读主题 CSS 变量（--star-1/2/3），无 DOM（Node）时回退深空默认值
  var STAR_COLOR_DEFAULTS = { star1: '#bcd4ff', star2: '#ffe9c4', star3: '#ffffff' };
  function readThemeColors() {
    var out = { star1: STAR_COLOR_DEFAULTS.star1, star2: STAR_COLOR_DEFAULTS.star2, star3: STAR_COLOR_DEFAULTS.star3 };
    try {
      var cs = getComputedStyle(document.documentElement);
      var names = { star1: '--star-1', star2: '--star-2', star3: '--star-3' };
      for (var k in names) {
        var v = cs.getPropertyValue(names[k]);
        if (v && v.trim()) out[k] = v.trim();
      }
    } catch (e) { /* Node / 无 CSSOM 环境：回退默认值 */ }
    return out;
  }
  var LAYERS = [
    { rMin: 0.4, rMax: 0.9, vx: 2.0, vy: 1.2, tw: 0.9 },   // 远：小而慢
    { rMin: 0.7, rMax: 1.4, vx: 4.5, vy: 2.6, tw: 1.5 },
    { rMin: 1.0, rMax: 2.0, vx: 8.0, vy: 4.4, tw: 2.2 }    // 近：大而快
  ];

  // scale：性能降级系数（移动端传 0.5，星星减半）；缺省 1 保持原行为
  function starCountFor(w, h, scale) {
    var s = (typeof scale === 'number' && scale > 0 && scale <= 1) ? scale : 1;
    return Math.round(Math.max(40, Math.min(360, Math.round(w * h * DENSITY))) * s);
  }

  // 是否为触摸（粗指针）设备：无 matchMedia / 查询异常一律视为桌面
  function isCoarsePointer(matchMedia) {
    try {
      return typeof matchMedia === 'function' &&
             matchMedia('(pointer: coarse)').matches === true;
    } catch (e) { return false; }
  }

  // 星星密度降级系数：触摸设备 0.5（减半），桌面 1
  function densityScaleFor(coarse) {
    return coarse ? 0.5 : 1;
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

  /* ---------------- 场景叠加元素绘制（issue #53） ----------------
   * 每类元素一个 paint 函数；位置为 (item, t) 的解析式纯函数（无状态突变），
   * 布点由 Scene.elementItems + 注入 rng 决定（确定性、Node 侧可断言坐标）。
   * 坐标归一化 [0,1] × 视口尺寸；速度 px/s 按 h 归一，视口无关。 */
  var ELEMENT_PAINTERS = {
    // L1 沉眠深空：超慢速星云径向辉光 alpha 呼吸振荡
    pulse: function (ctx, el, items, t, w, h, fade) {
      items.forEach(function (it) {
        var ph = t * el.speed * Math.PI * 2 + it.ph * Math.PI * 2;
        var grow = 0.5 + 0.5 * Math.sin(ph);
        var cx = it.x * w, cy = it.y * h;
        var r = (el.radius || 0.5) * Math.max(w, h) * (0.3 + 0.7 * grow);
        var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, rgba(el.color, el.alpha * fade * grow));
        g.addColorStop(1, rgba(el.color, 0));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      });
    },
    // L2 光带航道：斜向流动光带（沿 angleDeg 方向漂移，尾迹渐隐）
    streaks: function (ctx, el, items, t, w, h, fade) {
      var ang = (el.angleDeg || 0) * Math.PI / 180;
      var len = el.len || 60;
      var dx = Math.cos(ang) * len, dy = Math.sin(ang) * len;
      var spanX = w + 2 * Math.abs(dx);
      ctx.lineWidth = 1.2;
      ctx.lineCap = 'round';
      items.forEach(function (it) {
        var sp = (it.sp != null ? it.sp : el.speed) / (w || 1);
        var u = (it.x + t * sp) % 1; if (u < 0) u += 1;
        var x = -Math.abs(dx) + u * spanX;
        var y = it.y * h;
        var tail = ctx.createLinearGradient(x, y, x - dx, y - dy);
        tail.addColorStop(0, rgba(el.color, el.alpha * fade));
        tail.addColorStop(1, rgba(el.color, 0));
        ctx.strokeStyle = tail;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - dx, y - dy); ctx.stroke();
      });
    },
    // L3 霜野：低透明度六边形晶格缓慢漂移
    hexgrid: function (ctx, el, items, t, w, h, fade) {
      var cell = el.cell || 120;
      var hh = cell * Math.sqrt(3) / 2;
      var off = (t * (el.speed || 0.03) * cell) % (cell * 1.5);
      ctx.strokeStyle = rgba(el.color, el.alpha * fade);
      ctx.lineWidth = 1;
      for (var gy = -1; gy * hh < h + hh; gy++) {
        for (var gx = -1; gx * cell * 1.5 < w + cell * 2; gx++) {
          var cx = gx * cell * 1.5 - off;
          var cy = gy * hh + (gx % 2 ? hh / 2 : 0);
          ctx.beginPath();
          for (var s = 0; s < 6; s++) {
            var a = Math.PI / 3 * s;
            var px = cx + cell * 0.5 * Math.cos(a), py = cy + cell * 0.5 * Math.sin(a);
            if (s === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          }
          ctx.closePath(); ctx.stroke();
        }
      }
    },
    // L4 警戒宙域：探照弧规律扫过（雷达感，纯氛围）
    sweep: function (ctx, el, items, t, w, h, fade) {
      var cx = (el.cx != null ? el.cx : 0.78) * w;
      var cy = (el.cy != null ? el.cy : 0.2) * h;
      var r = (el.radius || 0.75) * Math.max(w, h);
      var ang = t * el.speed * Math.PI * 2;
      var ex = cx + Math.cos(ang) * r, ey = cy + Math.sin(ang) * r;
      var g = ctx.createLinearGradient(cx, cy, ex, ey);
      g.addColorStop(0, rgba(el.color, el.alpha * fade));
      g.addColorStop(1, rgba(el.color, 0));
      ctx.strokeStyle = g;
      ctx.lineWidth = Math.max(6, r * 0.05);
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ex, ey); ctx.stroke();
    },
    // L5 冰原反射：底部横向镜面反光带（慢速闪动横纹）
    mirror: function (ctx, el, items, t, w, h, fade) {
      var horizon = h * 0.72;
      var g = ctx.createLinearGradient(0, horizon, 0, h);
      g.addColorStop(0, rgba(el.color, el.alpha * fade));
      g.addColorStop(1, rgba(el.color, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, horizon, w, h - horizon);
      var sh = t * (el.speed || 0.08);
      ctx.fillStyle = rgba('#ffffff', el.alpha * fade * 0.4);
      for (var m = 0; m < 5; m++) {
        var yy = horizon + ((m * 37 + sh * h) % (h - horizon));
        var ww = w * (0.2 + 0.15 * Math.sin(sh * 2 + m));
        ctx.fillRect((w - ww) / 2 + Math.sin(sh + m * 1.7) * w * 0.2, yy, Math.max(0, ww), 1.5);
      }
    },
    // L6 双星裂隙：蓝金双星互转辉光 + 中缝暗带
    twin: function (ctx, el, items, t, w, h, fade) {
      var cx = w * 0.5, cy = h * 0.42;
      var orbit = (el.radius || 0.34) * Math.min(w, h) * 0.4;
      var ang = t * (el.speed || 0.06) * Math.PI * 2;
      var rr = Math.min(w, h) * 0.06;
      var cols = [el.colorA, el.colorB];
      for (var k = 0; k < 2; k++) {
        var ox = cx + Math.cos(ang + k * Math.PI) * orbit;
        var oy = cy + Math.sin(ang + k * Math.PI) * orbit * 0.4;
        var g = ctx.createRadialGradient(ox, oy, 0, ox, oy, rr);
        g.addColorStop(0, rgba(cols[k], el.alpha * fade));
        g.addColorStop(0.4, rgba(cols[k], el.alpha * fade * 0.5));
        g.addColorStop(1, rgba(cols[k], 0));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(ox, oy, rr, 0, Math.PI * 2); ctx.fill();
      }
      // 中缝暗带（双色之间）
      var g2 = ctx.createLinearGradient(cx - rr * 1.5, 0, cx + rr * 1.5, 0);
      g2.addColorStop(0, 'rgba(0,0,0,0)');
      g2.addColorStop(0.5, 'rgba(2,4,10,' + (el.alpha * fade * 0.8).toFixed(3) + ')');
      g2.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g2;
      ctx.fillRect(cx - rr * 1.5, 0, rr * 3, h);
    },
    // L7 暗夜极光：顶部正弦波形色带缓动
    aurora: function (ctx, el, items, t, w, h, fade) {
      var band = (el.band || 0.24) * h;
      items.forEach(function (it, idx) {
        var baseY = h * (0.18 + 0.16 * idx);
        var col = idx % 2 ? el.colorB : el.colorA;
        var ph = t * (el.speed || 0.1) * Math.PI * 2 + idx;
        ctx.beginPath();
        for (var x = 0; x <= w; x += 12) {
          var yv = baseY + Math.sin(ph + x / w * 4 + it.i) * band * 0.4;
          if (x === 0) ctx.moveTo(x, yv); else ctx.lineTo(x, yv);
        }
        var g = ctx.createLinearGradient(0, baseY - band, 0, baseY + band);
        g.addColorStop(0, rgba(col, 0));
        g.addColorStop(0.5, rgba(col, el.alpha * fade));
        g.addColorStop(1, rgba(col, 0));
        ctx.strokeStyle = g;
        ctx.lineWidth = band * 0.8;
        ctx.stroke();
      });
    },
    // L8 风雪星云：快速横向飘雪（速度比星群快一个量级）
    snow: function (ctx, el, items, t, w, h, fade) {
      ctx.fillStyle = rgba(el.color, el.alpha * fade);
      items.forEach(function (it) {
        var hx = (it.sp != null ? it.sp : el.speed) / (w || 1);
        var u = (it.x + t * hx) % 1; if (u < 0) u += 1;
        var v = (it.y + t * hx * 0.12 + Math.sin(t * 1.2 + it.dip * 6.283) * 0.01 + 2) % 1;
        ctx.beginPath();
        ctx.arc(u * w, v * h, it.r || 1.5, 0, Math.PI * 2);
        ctx.fill();
      });
    },
    // L9 深渊回声：同心声波涟漪自中心周期扩散
    ripple: function (ctx, el, items, t, w, h, fade) {
      var n = items.length || el.count;
      items.forEach(function (it, i) {
        var cyc = (t * el.speed + i / n) % 1;
        var r = cyc * (el.radius || 0.7) * Math.max(w, h) * 0.5;
        ctx.strokeStyle = rgba(el.color, el.alpha * fade * (1 - cyc));
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(w * 0.5, h * 0.5, r, 0, Math.PI * 2);
        ctx.stroke();
      });
    },
    // L10 星核：中心脉动辉光核心
    core: function (ctx, el, items, t, w, h, fade) {
      var pulse = 0.85 + 0.15 * Math.sin(t * el.speed * Math.PI * 2);
      var r = (el.radius || 0.3) * Math.min(w, h) * pulse;
      var g = ctx.createRadialGradient(w * 0.5, h * 0.45, 0, w * 0.5, h * 0.45, r);
      g.addColorStop(0, rgba('#fff3dc', el.alpha * fade));
      g.addColorStop(0.35, rgba(el.color, el.alpha * fade * 0.8));
      g.addColorStop(1, rgba(el.color, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(w * 0.5, h * 0.45, r, 0, Math.PI * 2); ctx.fill();
    },
    // L10 星核：环绕加速粒子（椭圆轨道）
    orbit: function (ctx, el, items, t, w, h, fade) {
      ctx.fillStyle = rgba(el.color, el.alpha * fade);
      items.forEach(function (it) {
        var a = it.ang + t * it.sp;
        var rad = it.rad * Math.min(w, h) * 0.5;
        var x = w * 0.5 + Math.cos(a) * rad;
        var y = h * 0.45 + Math.sin(a) * rad * 0.35;
        ctx.beginPath(); ctx.arc(x, y, 1.6, 0, Math.PI * 2); ctx.fill();
      });
    },
    // L11 黑洞应力异常（issue #59）：事件视界黑盘 + 倾斜椭圆吸积盘 + 透镜光晕环。
    // 全解析式绘制（渐变/圆弧/相位角由 t 驱动，无逐帧随机、无逐像素运算）。
    blackhole: function (ctx, el, items, t, w, h, fade) {
      var cx = w * (typeof el.cx === 'number' ? el.cx : 0.72);
      var cy = h * (typeof el.cy === 'number' ? el.cy : 0.28);
      var r = (el.radius || 0.2) * Math.min(w, h);
      var a = el.alpha * fade;
      var tilt = 0.34;        // 椭圆盘纵向压缩（倾斜视角）
      var lean = -0.28;       // 盘面倾角（rad）
      var spin = t * el.speed * Math.PI * 2;
      function disk(alpha) {
        // 吸积盘环带：内缘白热 → 金 → 外缘橙渐隐（在已 translate/rotate/scale 系内）
        var g = ctx.createRadialGradient(0, 0, r * 0.55, 0, 0, r * 1.65);
        g.addColorStop(0, rgba('#fff6e0', alpha));
        g.addColorStop(0.32, rgba('#ffd166', alpha * 0.9));
        g.addColorStop(0.66, rgba(el.color, alpha * 0.7));
        g.addColorStop(1, rgba(el.color, 0));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(0, 0, r * 1.65, 0, Math.PI * 2); ctx.fill();
      }
      // 1) 后盘（上缘=多普勒增亮侧，全亮）
      ctx.save();
      ctx.translate(cx, cy); ctx.rotate(lean); ctx.scale(1, tilt);
      disk(a);
      ctx.restore();
      // 2) 透镜光晕细环
      ctx.strokeStyle = rgba('#ffe0b0', a * 0.5);
      ctx.lineWidth = Math.max(1, r * 0.045);
      ctx.beginPath(); ctx.arc(cx, cy, r * 1.12, 0, Math.PI * 2); ctx.stroke();
      // 3) 事件视界：纯黑圆盘
      ctx.fillStyle = rgba('#000000', Math.min(1, a + 0.15));
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      // 4) 前盘（下缘横跨盘面，暗示多普勒：较暗档）
      ctx.save();
      ctx.translate(cx, cy); ctx.rotate(lean); ctx.scale(1, tilt);
      ctx.beginPath();
      ctx.rect(-r * 1.7, 0, r * 3.4, r * 1.7); // 只放行盘面下半（近侧）
      ctx.clip();
      disk(a * 0.45);
      ctx.restore();
      // 5) 吸积热斑：三点沿盘缘匀速公转（相位由 t 驱动，确定性）
      ctx.save();
      ctx.translate(cx, cy); ctx.rotate(lean); ctx.scale(1, tilt);
      for (var i = 0; i < 3; i++) {
        var ang = spin + i * (Math.PI * 2 / 3);
        var px = Math.cos(ang) * r * 1.18, py = Math.sin(ang) * r * 1.18;
        var hot = ctx.createRadialGradient(px, py, 0, px, py, r * 0.34);
        hot.addColorStop(0, rgba('#fff6e0', a * 0.5 * (0.6 + 0.4 * Math.cos(ang))));
        hot.addColorStop(1, rgba(el.color, 0));
        ctx.fillStyle = hot;
        ctx.beginPath(); ctx.arc(px, py, r * 0.34, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
  };

  function paintElements(ctx, scene, items, t, w, h, fade) {
    if (!scene || !Array.isArray(scene.elements)) return;
    var f = fade < 0 ? 0 : (fade > 1 ? 1 : fade);
    scene.elements.forEach(function (el) {
      var paint = ELEMENT_PAINTERS[el.kind];
      if (!paint) return;
      var list = [];
      for (var i = 0; i < items.length; i++) {
        if (items[i].kind === el.kind) list.push(items[i]);
      }
      paint(ctx, el, list, t, w, h, f);
    });
  }

  /** 挂载到 canvas 并开始动画；返回 {stop(), setScene(scene)} 句柄 */
  function mount(canvas) {
    var ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) return { stop: function () {}, setScene: function () {} };

    var dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    // 移动端（pointer:coarse）星星减半；无 matchMedia 视为桌面
    var densityScale = densityScaleFor(isCoarsePointer(
      typeof matchMedia === 'function' ? matchMedia : null));
    var stars = [], w = 0, h = 0, rafId = null, last = 0;
    var reduced = typeof matchMedia === 'function' &&
                  matchMedia('(prefers-reduced-motion: reduce)').matches;
    var colors = readThemeColors();

    /* ---------------- 场景状态（issue #53） ----------------
     * base/from/target 为 Scene 场景对象；k∈[0,1] 渐变进度（BLEND_MS 内 0→1）。
     * eff = Scene.blend(from, target, easeInOut(k))：palette/density 插值生效；
     * 元素层旧/新各自 alpha = 1-k / k 交叉淡入淡出。 */
    var DEFAULT_SCENE = SceneLib ? SceneLib.SCENES[SceneLib.DEFAULT_SCENE_ID] : null;
    var fromScene = DEFAULT_SCENE;
    var targetScene = DEFAULT_SCENE;
    var blendK = 1;
    var eff = DEFAULT_SCENE;
    var fromItems = [], targetItems = [];
    var elapsed = 0;
    var BLEND_MS = 1000;

    // 主题切换（html[data-theme] 变化）时刷新星点颜色
    var themeObserver = null;
    if (typeof MutationObserver === 'function' && typeof document !== 'undefined') {
      themeObserver = new MutationObserver(function () { colors = readThemeColors(); });
      try {
        themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
      } catch (e) { themeObserver = null; }
    }

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
      var n = starCountFor(w, h, densityScale);
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

    /* 星点色温：场景 palette 优先，默认场景回退主题色（三主题不受影响）。
     * 就地更新 colors 对象，绘制行保持不变（issue #15 静态断言依赖其字面形式）。 */
    function syncStarColors() {
      var theme = readThemeColors();
      var p = (SceneLib && eff && eff.palette && eff.id !== SceneLib.DEFAULT_SCENE_ID)
        ? eff.palette : null;
      colors.star1 = p ? p.star1 : theme.star1;
      colors.star2 = p ? p.star2 : theme.star2;
      colors.star3 = p ? p.star3 : theme.star3;
    }

    function draw(dt) {
      ctx.clearRect(0, 0, w, h);
      var aspect = Math.max(1, h);
      syncStarColors();
      var n = eff ? starDrawCount(stars.length, eff.density) : stars.length;
      for (var i = 0; i < n; i++) {
        var s = stars[i];
        if (!reduced && dt > 0) {
          var p = advance(s, dt, LAYERS[s.layer], aspect);
          s.x = p.x; s.y = p.y;
          s.ph = (s.ph + s.sp * dt) % 1;
        }
        var a = starAlpha(s.ph, 0.55, 0.4);
        ctx.globalAlpha = a;
        ctx.fillStyle = i % 7 === 3 ? colors.star1 : (i % 11 === 5 ? colors.star2 : colors.star3);
        ctx.beginPath();
        ctx.arc(s.x * w, s.y * h, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      drawSceneElements();
    }

    /* 叠加元素：星群之上，旧/新场景交叉淡入淡出（reduced-motion 静止 t=0 单帧）。
     * k≥1 时只画目标层（fromScene 已在 stepBlend 归一，重复绘制会二次混合）。 */
    function drawSceneElements() {
      if (!SceneLib || !eff) return;
      var t = reduced ? 0 : elapsed;
      var k = blendK;
      if (k < 1 && fromScene && fromScene.elements && fromScene.elements.length) {
        paintElements(ctx, fromScene, fromItems, t, w, h, 1 - k);
      }
      var fade = (k < 1 && targetScene !== fromScene) ? k : 1;
      if (targetScene && targetScene.elements && targetScene.elements.length) {
        paintElements(ctx, targetScene, targetItems, t, w, h, fade);
      }
    }

    function frame(now) {
      var dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now;
      elapsed += dt;
      stepBlend(dt);
      draw(dt);
      rafId = requestAnimationFrame(frame);
    }

    /* 渐变推进：k→1 时把 target 归一为当前态（旧元素层淡出完毕） */
    function stepBlend(dt) {
      if (blendK >= 1) return;
      blendK = Math.min(1, blendK + (dt * 1000) / BLEND_MS);
      eff = SceneLib ? SceneLib.blend(fromScene, targetScene, easeInOut(blendK)) : targetScene;
      if (blendK >= 1) {
        fromScene = targetScene;
        fromItems = targetItems;
      }
    }

    /**
     * 切换场景（issue #53）。非法入参静默忽略（维持当前场景）；
     * 同 id 重复调用为 no-op；reduced-motion 下不销毁场景，直接跳到
     * 终态并静止重绘单帧（元素 t=0 相位）。
     */
    function setScene(scene) {
      if (!SceneLib || !scene || typeof scene.id !== 'string' ||
          !scene.palette || !Array.isArray(scene.elements)) return;
      if (targetScene && scene.id === targetScene.id && blendK >= 1) return;
      // 渐变中途打断：以当前目标场景为淡出层（其布点沿用，不重播种）
      fromScene = targetScene;
      fromItems = targetItems;
      targetScene = scene;
      targetItems = itemsOf(scene);
      blendK = 0;
      if (reduced) {
        // 静态模式：立即完成渐变并单帧重绘（元素静止，不销毁）
        blendK = 1;
        eff = scene;
        fromScene = scene;
        fromItems = targetItems;
        if (rafId === null) draw(0);
      } else {
        eff = SceneLib.blend(fromScene, targetScene, 0);
      }
      syncStarColors();
    }

    function itemsOf(scene) {
      if (!SceneLib || !scene) return [];
      return SceneLib.elementItems(scene, mulberry32(sceneSeed(scene.id)));
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
        if (themeObserver) { try { themeObserver.disconnect(); } catch (e) { /* 忽略 */ } }
        window.removeEventListener('resize', resize);
        document.removeEventListener('visibilitychange', onVisibility);
      },
      setScene: setScene
    };
  }

  return {
    DENSITY: DENSITY,
    LAYERS: LAYERS,
    STAR_COLOR_DEFAULTS: STAR_COLOR_DEFAULTS,
    readThemeColors: readThemeColors,
    starCountFor: starCountFor,
    isCoarsePointer: isCoarsePointer,
    densityScaleFor: densityScaleFor,
    pickStarRadius: pickStarRadius,
    starAlpha: starAlpha,
    advance: advance,
    ELEMENT_PAINTERS: ELEMENT_PAINTERS,
    paintElements: paintElements,
    mulberry32: mulberry32,
    sceneSeed: sceneSeed,
    starDrawCount: starDrawCount,
    mount: mount
  };
});
