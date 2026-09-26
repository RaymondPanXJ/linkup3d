#!/usr/bin/env node
/**
 * tests/timer.define.js — js/timer.js 纯函数用例（issue #12 计时挑战模式）
 * Node 与浏览器共用；浏览器侧通过 window.Timer 使用同一断言。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TimerTests = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var T = (typeof module === 'object' && module.exports)
    ? require('../js/timer.js')
    : root.Timer;

  var cases = [];
  function test(name, fn) { cases.push({ name: name, fn: fn }); }

  function eq(actual, expected) {
    if (actual !== expected) {
      throw new Error('expected ' + JSON.stringify(expected) +
        ' but got ' + JSON.stringify(actual));
    }
    return 'ok';
  }

  /* 1. 模式归一化 */
  test('normalizeMode 未知值回退 endless', function () {
    return eq(T.normalizeMode('bogus'), 'endless') &&
           eq(T.normalizeMode('timed'), 'timed') &&
           eq(T.normalizeMode(undefined), 'endless');
  });

  /* 2. create：限时 120s，无尽无限值 */
  test('create(timed) limitSec=120 / create(endless) limitSec=null', function () {
    var t = T.create('timed'), e = T.create('endless');
    return eq(t.limitSec, 120) && eq(t.elapsedSec, 0) && !t.running &&
           eq(e.limitSec, null) && eq(T.remainingSec(e), null);
  });

  /* 3. start 幂等 */
  test('start 幂等：重复 start 不重置起点', function () {
    var s = T.start(T.create('endless'), 1000);
    var s2 = T.start(s, 5000);
    return eq(s2.startAtMs, 1000) && s2.running === true;
  });

  /* 4. tick 正计时（无尽） */
  test('tick 无尽模式：elapsed 随时钟递增', function () {
    var s = T.start(T.create('endless'), 0);
    s = T.tick(s, 3400);
    return eq(s.elapsedSec, 3) && eq(s.elapsedMs, 3400) && !s.finished;
  });

  /* 5. tick 限时倒计时 */
  test('tick 限时模式：remaining = 120 - elapsed', function () {
    var s = T.start(T.create('timed'), 0);
    s = T.tick(s, 30000);
    return eq(s.remainingSec, 90) && !s.warning && !s.finished;
  });

  /* 6. 暂停补偿：恢复后不倒扣暂停时长 */
  test('暂停补偿：暂停 60s 后恢复，elapsed 从暂停点连续', function () {
    var s = T.start(T.create('timed'), 0);
    s = T.tick(s, 20000);          // 用时 20s
    s = T.pause(s, 20000);
    s = T.tick(s, 80000);          // 暂停期间 60s，elapsed 冻结
    var frozen = s.elapsedMs;
    s = T.resume(s, 80000);
    s = T.tick(s, 85000);          // 恢复后又走 5s
    return eq(frozen, 20000) && eq(s.elapsedMs, 25000) &&
           eq(s.remainingSec, 95);
  });

  /* 7. 暂停幂等：未起跑 pause / 重复 pause / 未暂停 resume 均安全 */
  test('pause/resume 幂等与非法态安全', function () {
    var fresh = T.create('timed');
    var a = T.pause(fresh, 1000);              // 未起跑
    var b = T.resume(fresh, 1000);             // 未暂停
    var s = T.start(fresh, 0);
    s = T.pause(s, 5000);
    var again = T.pause(s, 9000);              // 重复暂停不移动暂停点
    return eq(a.elapsedMs, 0) && eq(b.elapsedMs, 0) &&
           eq(again.elapsedMs, s.elapsedMs);
  });

  /* 8. 超时判定：恰好归零判负，elapsed 冻结在限值 */
  test('限时归零：finished=true 且 elapsed 冻结在 120s', function () {
    var s = T.start(T.create('timed'), 0);
    s = T.tick(s, 130000);
    return eq(s.finished, true) && eq(T.isTimeout(s), true) &&
           eq(s.elapsedMs, 120000) && eq(s.remainingSec, 0);
  });

  /* 9. 警示阈值：≤10s 进入警示，暂停时不警示 */
  test('警示态：剩余 ≤10s 为 true，暂停期间为 false', function () {
    var s = T.start(T.create('timed'), 0);
    s = T.tick(s, 109999);
    var before = s.warning;                      // 剩余 10.001s -> 10s floor? floor(109999/1000)=109 -> rem 11
    s = T.tick(s, 110000);                       // rem 10
    var at = s.warning;
    var p = T.pause(s, 110000);
    return eq(before, false) && eq(at, true) && eq(p.warning, false);
  });

  /* 10. 无尽模式永不超时、永不警示 */
  test('无尽模式：任意时长不超时不警示', function () {
    var s = T.start(T.create('endless'), 0);
    s = T.tick(s, 3600000);
    return eq(s.finished, false) && eq(s.warning, false) &&
           eq(s.remainingSec, null) && eq(s.elapsedSec, 3600);
  });

  /* 11. 暂停中的超时边界：暂停点已超时则恢复即判负 */
  test('超时后暂停再恢复仍保持超时态', function () {
    var s = T.start(T.create('timed'), 0);
    s = T.tick(s, 125000);     // 超时
    s = T.pause(s, 125000);
    s = T.resume(s, 200000);
    s = T.tick(s, 200001);
    return eq(T.isTimeout(s), true) && eq(s.elapsedMs, 120000);
  });

  function runAll() {
    return cases.map(function (c) {
      try {
        return { name: '[timer] ' + c.name, pass: true, detail: c.fn() };
      } catch (e) {
        return { name: '[timer] ' + c.name, pass: false, detail: e.message };
      }
    });
  }

  return { runAll: runAll, cases: cases };
});
