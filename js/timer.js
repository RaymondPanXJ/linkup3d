/**
 * timer.js — 计时器纯函数（无 DOM / 无 Date.now 依赖，浏览器 + Node 双用）
 *
 * 规则（对应 issue #12）：
 *   - 无尽模式：正计时，elapsed 秒数递增，永不超时；
 *   - 限时模式：总时长 LIMIT_SECONDS = 120 秒，remaining 倒扣，归零判负；
 *   - 暂停补偿：暂停时记录 pausedElapsed，恢复后 elapsed 从暂停点继续，
 *     暂停期间不消耗时间（不倒扣、不累积）；
 *   - 警示：限时模式 remaining <= WARN_SECONDS(10) 且未结束时进入警示态。
 *
 * 状态对象为普通数据（可序列化），所有函数均为纯函数：
 * 输入状态 + 单调时钟读数（毫秒），返回新状态。
 *
 * 该文件同时可在浏览器（window.Timer）与 Node（module.exports）中使用。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Timer = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LIMIT_SECONDS = 120; // 限时模式总时长
  var WARN_SECONDS = 10;   // 倒计时警示阈值（剩余 ≤ 该值进入警示态）

  // 模式常量与持久化
  var MODES = { endless: 'endless', timed: 'timed' };
  var MODE_KEY = 'linkup3d.mode';

  function normalizeMode(mode) {
    return MODES[mode] ? mode : MODES.endless;
  }

  /* 创建一个初始计时状态。mode: 'endless' | 'timed'。
   * 字段：
   *   mode            当前模式
   *   running         是否已起跑（首次有效交互后置 true）
   *   paused          是否处于暂停
   *   elapsedSec      已用时（秒，向下取整；暂停/超时后冻结）
   *   elapsedMs       已用时（毫秒，暂停/超时后冻结为暂停点）
   *   startAtMs       起跑时的时钟读数（running 且未暂停时有效）
   *   limitSec        限时模式总时长（无尽模式为 null）
   */
  function create(mode) {
    return {
      mode: normalizeMode(mode),
      running: false,
      paused: false,
      elapsedMs: 0,
      elapsedSec: 0,
      startAtMs: 0,
      limitSec: normalizeMode(mode) === MODES.timed ? LIMIT_SECONDS : null
    };
  }

  /* 首次起跑：nowMs 为单调时钟读数（如 performance.now()）。
   * 已在计时则原样返回（幂等）。 */
  function start(st, nowMs) {
    if (st.running) return st;
    return assign(st, {
      running: true,
      paused: false,
      startAtMs: nowMs,
      elapsedMs: 0,
      elapsedSec: 0
    });
  }

  /* 每 tick 调用：nowMs 为当前时钟读数。
   * 暂停/未起跑/已超时时 elapsed 冻结；否则由 nowMs - startAtMs 推导。
   * 返回新状态（含 elapsedMs/elapsedSec/remainingSec/warning/finished）。 */
  function tick(st, nowMs) {
    if (!st.running || st.paused) return withDerived(st);
    var elapsedMs = nowMs - st.startAtMs;
    if (elapsedMs < 0) elapsedMs = 0;
    if (st.limitSec !== null && elapsedMs >= st.limitSec * 1000) {
      elapsedMs = st.limitSec * 1000; // 超时冻结在限值
    }
    return withDerived(assign(st, {
      elapsedMs: elapsedMs,
      elapsedSec: Math.floor(elapsedMs / 1000)
    }));
  }

  /* 暂停：冻结当前 elapsed，记录暂停点。非运行态幂等。 */
  function pause(st, nowMs) {
    if (!st.running || st.paused) return st;
    var frozen = nowMs - st.startAtMs;
    if (frozen < 0) frozen = 0;
    if (st.limitSec !== null && frozen > st.limitSec * 1000) {
      frozen = st.limitSec * 1000;
    }
    return withDerived(assign(st, {
      paused: true,
      elapsedMs: frozen,
      elapsedSec: Math.floor(frozen / 1000)
    }));
  }

  /* 恢复：将 startAtMs 前移暂停时长（nowMs - 暂停点 elapsedMs），
   * 使恢复后 elapsed 从暂停点连续，暂停时长不计入用时。 */
  function resume(st, nowMs) {
    if (!st.running || !st.paused) return st;
    return withDerived(assign(st, {
      paused: false,
      startAtMs: nowMs - st.elapsedMs
    }));
  }

  /* 超时判定（仅限时模式）：tick 后的状态 remaining === 0 即判负。 */
  function isTimeout(st) {
    return st.limitSec !== null && !st.paused && st.running &&
           st.elapsedMs >= st.limitSec * 1000;
  }

  /* 剩余秒数：无尽模式返回 null。 */
  function remainingSec(st) {
    if (st.limitSec === null) return null;
    var rem = st.limitSec - Math.floor(st.elapsedMs / 1000);
    return rem < 0 ? 0 : rem;
  }

  /* 警示态：限时模式、已起跑、未暂停、剩余 ≤ WARN_SECONDS。 */
  function isWarning(st) {
    if (st.limitSec === null || !st.running || st.paused) return false;
    var rem = remainingSec(st);
    return rem <= WARN_SECONDS;
  }

  /* 内部：附加派生字段（remainingSec/warning/finished），便于 UI 直接消费。 */
  function withDerived(st) {
    return assign(st, {
      remainingSec: remainingSec(st),
      warning: isWarning(st),
      finished: isTimeout(st)
    });
  }

  function assign(target, patch) {
    var out = {};
    for (var k in target) out[k] = target[k];
    for (var k2 in patch) out[k2] = patch[k2];
    return out;
  }

  return {
    LIMIT_SECONDS: LIMIT_SECONDS,
    WARN_SECONDS: WARN_SECONDS,
    MODES: MODES,
    MODE_KEY: MODE_KEY,
    normalizeMode: normalizeMode,
    create: create,
    start: start,
    tick: tick,
    pause: pause,
    resume: resume,
    isTimeout: isTimeout,
    remainingSec: remainingSec,
    isWarning: isWarning
  };
});
