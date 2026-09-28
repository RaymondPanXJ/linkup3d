/**
 * gravity.js — 终章关「黑洞应力异常」引力视效层（issue #59，纯表现层零逻辑）
 *
 * - window.Gravity，UMD 双端（Node 可 require 做纯函数侧证），与 ufo.js 同风格；
 * - 纯函数核心：
 *     pickWarpTargets(count, nowMs, rand, cfg) → {targets, phase}
 *       每 warpEveryMs 周期从 count 个格中随机选 2~4 个（rand 注入确定性可测，
 *       周期由 nowMs 整除门控，同周期重复调用幂等）；
 *     warpTransform(dist, seed) → {skewX, scaleX, rotate}
 *       归一化距离 [0,1] → 形变量（越近越大；上限截断防爆版；纯函数）；
 *     springStep(current, target, vel, dtMs, k, damp) → {value, vel}
 *       阻尼弹簧迭代（dt 归一到 60Hz 步长、damp 按步数幂次补偿，
 *       帧率无关；k≈0.04 / damp≈0.85 迟滞+过冲回弹手感）；
 * - DOM 适配 mount(board, cfg, opts)：心跳 setInterval（250ms，沿用 game.js
 *   onTimerTick 模式）内部按 warpEveryMs 门控；命中格加类 tile-warp
 *   ~warpHoldMs 后移除（延迟回调经 token 世代号作废防竞态）；形变方向按格子
 *   相对棋盘中心两档翻转（--warp-sign），幅度经 --warp-mag 传入 CSS keyframes；
 * - 纯视效：不触碰 grid 数据、不影响选中/连通判定（类名与 .tile-frost 等
 *   状态类正交）；reduced-motion 命中（opts.reducedMotion=true 或
 *   matchMedia 自检兜底）时整个引力层 no-op；
 * - reset() 立即清除所有在途 tile-warp 类并停用当前心跳（restart/exitCampaign
 *   与 gen 世代号配套）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Gravity = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var WARP_MIN = 2, WARP_MAX = 4;   // 每周期扭曲格数（issue 要求 2~4）
  var HEARTBEAT_MS = 250;           // 心跳间隔（game.js setInterval 惯用口径）
  var DEFAULT_EVERY_MS = 3200;
  var DEFAULT_HOLD_MS = 900;

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  /* ---------------- 纯函数：周期选靶 ---------------- */
  /**
   * 从 [0, count) 选中 2~4 个不重复格索引（rand 注入 → 可复现）。
   * phase = floor(nowMs / warpEveryMs) 随结果返回，调用方按周期号去重
   * （mount 心跳内 lastPhase 门控）。count<2 时 targets 为空。
   */
  function pickWarpTargets(count, nowMs, rand, cfg) {
    var every = (cfg && cfg.warpEveryMs > 0) ? cfg.warpEveryMs : DEFAULT_EVERY_MS;
    var out = { phase: 0, targets: [] };
    if (!Number.isInteger(count) || count < WARP_MIN ||
        typeof nowMs !== 'number' || !isFinite(nowMs) || nowMs < 0) {
      return out;
    }
    out.phase = Math.floor(nowMs / every);
    var rnd = typeof rand === 'function' ? rand : Math.random;
    var pool = [];
    for (var i = 0; i < count; i++) pool.push(i);
    var n = clamp(WARP_MIN + Math.floor(rnd() * (WARP_MAX - WARP_MIN + 1)),
      WARP_MIN, Math.min(WARP_MAX, count));
    // Fisher-Yates 取前 n（rand 注入 → 确定性）
    for (var k = 0; k < n; k++) {
      var j = k + Math.floor(rnd() * (pool.length - k));
      var tmp = pool[k]; pool[k] = pool[j]; pool[j] = tmp;
      out.targets.push(pool[k]);
    }
    return out;
  }

  /* ---------------- 纯函数：距离 → 形变 ---------------- */
  /**
   * dist ∈ [0,1]（0=贴着黑洞，1=最远）→ 形变量。近大远小、单调不增；
   * skewX ∈ [0,14]deg，scaleX ∈ [0.86,1.04]（近侧纵向拉伸感由 CSS 组合），
   * rotate ∈ [0,6]deg。seed ∈ [0,1] 做格间微差异（确定性注入，无逐帧随机）。
   */
  function warpTransform(dist, seed) {
    var d = clamp(typeof dist === 'number' && isFinite(dist) ? dist : 1, 0, 1);
    var s = clamp(typeof seed === 'number' && isFinite(seed) ? seed : 0.5, 0, 1);
    var pull = (1 - d) * (1 - d); // 近距平方衰减：越近形变越大
    var jit = 0.8 + 0.4 * s;
    return {
      skewX: +(14 * pull * jit).toFixed(2),
      scaleX: +(1 + 0.04 * pull * (s - 0.5) * 2 - 0.02 * pull).toFixed(4),
      rotate: +(6 * pull * jit).toFixed(2)
    };
  }

  /* ---------------- 纯函数：阻尼弹簧 ---------------- */
  /**
   * 单步弹簧：value 逼近 target。dt 归一到 16.666ms 基准步长（多帧合并步），
   * damp 按步数幂次补偿 → 帧率无关。返回 {value, vel}，非法入参安全原样返回。
   */
  function springStep(current, target, vel, dtMs, k, damp) {
    if (typeof current !== 'number' || !isFinite(current)) current = 0;
    if (typeof target !== 'number' || !isFinite(target)) target = current;
    if (typeof vel !== 'number' || !isFinite(vel)) vel = 0;
    var kk = typeof k === 'number' && k > 0 && isFinite(k) ? k : 0.04;
    var dm = typeof damp === 'number' && damp > 0 && damp < 1 ? damp : 0.85;
    var n = (typeof dtMs === 'number' && dtMs > 0 && isFinite(dtMs))
      ? dtMs / 16.666 : 1;
    var acc = (target - current) * kk;
    var v = (vel + acc * n) * Math.pow(dm, n);
    return { value: current + v * n, vel: v };
  }

  /* ---------------- DOM 适配层 ---------------- */
  /**
   * mount(board, opts)：opts = {slots, getLevel, reducedMotion, rand}。
   * slots 为 game.js 的 {"r,c": element} 共享映射（引用长期有效，建盘重建安全）；
   * getLevel() 返回当前战役关卡定义或 null（非引力关心跳直接空转）。
   * 启动一次 start() 后常驻；reset() 清在途类并重置周期门控。
   * 返回句柄 {start, reset, isReduced}；reduced-motion 下全 no-op。
   */
  function mount(board, opts) {
    var reduced = !!(opts && opts.reducedMotion);
    if (!reduced && typeof matchMedia === 'function') {
      try { reduced = matchMedia('(prefers-reduced-motion: reduce)').matches; }
      catch (e) { /* 视为非 reduced */ }
    }
    var noop = {
      start: function () {}, reset: function () {},
      isReduced: function () { return reduced; }
    };
    if (!board || !opts || !opts.slots || typeof opts.getLevel !== 'function') {
      return noop;
    }
    if (reduced) return noop;

    var rand = typeof opts.rand === 'function' ? opts.rand : Math.random;
    var token = 0;        // 世代号：reset/start 作废旧周期延迟回调（同 ufo.js 模式）
    var timerId = null;

    function keys() {
      return Object.keys(opts.slots);
    }

    var lastPhase = -1;

    function fire(nowMs) {
      var level = opts.getLevel();
      var cfg = level && level.gravity ? level.gravity : null;
      if (!cfg) return; // 非引力关：心跳空转（getLevel 每拍现取，切关即时生效）
      var every = cfg.warpEveryMs > 0 ? cfg.warpEveryMs : DEFAULT_EVERY_MS;
      var hold = cfg.warpHoldMs > 0 ? cfg.warpHoldMs : DEFAULT_HOLD_MS;
      var rows = level.rows, cols = level.cols;
      var list = Object.keys(opts.slots);
      var res = pickWarpTargets(list.length, nowMs, rand, { warpEveryMs: every });
      if (res.phase === lastPhase) return; // 同周期只发一次
      lastPhase = res.phase;
      var my = token;
      res.targets.forEach(function (idx) {
        var key = list[idx];
        var slot = opts.slots[key];
        if (!slot) return;
        var p = key.split(',');
        var r = +p[0], c = +p[1];
        // 方向两档：格在棋盘中心左侧 → -1，右侧 → +1（issue：简单两档即可）
        var sign = c <= cols / 2 ? -1 : 1;
        // 幅度：与 s10 painter 同口径黑洞锚点（cx=0.72, cy=0.28）归一化距离
        var dx = (c - 0.72 * cols) / cols;
        var dy = (r - 0.28 * rows) / rows;
        var dist = clamp(Math.sqrt(dx * dx + dy * dy), 0, 1);
        var tf = warpTransform(dist, ((r * 7 + c * 13) % 17) / 17);
        slot.style.setProperty('--warp-mag', String(tf.skewX));
        slot.style.setProperty('--warp-rot', String(tf.rotate));
        slot.style.setProperty('--warp-sx', String(tf.scaleX));
        slot.style.setProperty('--warp-sign', String(sign));
        slot.style.setProperty('--warp-hold', hold + 'ms');
        slot.classList.add('tile-warp');
        setTimeout(function () {
          if (my !== token) return; // 世代号作废：reset/restart 后不误清新局在途类
          var el = opts.slots[key];
          if (el) el.classList.remove('tile-warp');
        }, hold);
      });
    }

    function start() {
      if (timerId !== null) return; // 常驻单心跳：重复 start 幂等
      var my = ++token;
      timerId = setInterval(function () {
        if (my !== token) return;
        fire(Date.now());
      }, HEARTBEAT_MS);
    }

    function reset() {
      token++; // 作废旧周期在途移除回调（同 ufo.js 世代号模式）；心跳保持常驻
      lastPhase = -1;
      var slots = opts.slots;
      Object.keys(slots).forEach(function (key) {
        slots[key].classList.remove('tile-warp');
      });
    }

    return {
      start: start,
      reset: reset,
      isReduced: function () { return false; }
    };
  }

  return {
    WARP_MIN: WARP_MIN,
    WARP_MAX: WARP_MAX,
    HEARTBEAT_MS: HEARTBEAT_MS,
    pickWarpTargets: pickWarpTargets,
    warpTransform: warpTransform,
    springStep: springStep,
    mount: mount
  };
});
