/**
 * tilt.js — 棋盘倾斜/引力弹簧纯数学层（issue #74 刀3：game.js 拆单收官刀）
 *
 * 从 game.js 倾斜簇与 js/gravity.js 抽出的无 DOM、无全局、无时钟纯函数：
 *   - springStep(current, target, vel, dtMs, k, damp) → {value, vel}
 *     阻尼弹簧单步迭代（自 gravity.js 本体逐字迁入，公式零改动；gravity.js
 *     改为委托本模块，Gravity.springStep 同一引用，API 不变）。dt 归一到
 *     16.666ms 基准步长、damp 按步数幂次补偿 → 帧率无关；非法入参安全归一。
 *   - pointerToTilt(x, y, vw, vh) → {rx, ry}
 *     指针视口坐标 → 基准倾角（原 game.js applyTilt 内联公式逐字迁出：
 *     rx = 14 + (y/vh - 0.5) × -8，ry = (x/vw - 0.5) × 10）。
 *   - biasTarget(rx, ry, factor) → {rx, ry}
 *     引力场目标偏转：以基准视角 (16°, 0°) 为不动点放大 factor 倍（默认 1.5，
 *     原 game.js applyTilt 引力分支内联式逐字迁出）。
 *   - settled(spring, target, eps) → boolean
 *     收敛判据：双轴位移与双轴速度四路全部 |·| < eps（严格小于；原
 *     tiltSpringStepTick 的 near 四条件内联式逐字迁出，eps 默认 0.01）。
 *   - stepTick(spring, target, stepFn, nowMs, lastTs, baseTickMs)
 *     → {spring, lastTs, near}
 *     一个弹簧拍的完整积分（原 tiltSpringStepTick 的 dt 钳制/双轴步进/速度
 *     回写/收敛判定编排逐字迁出）：dt = lastTs ? min(100, now-lastTs) :
 *     baseTickMs；步进积分器 stepFn 由调用方注入（game.js 注入
 *     GRAVITY.springStep 包装，保持接线行为与旧调用逐点等值）。入参不可变：
 *     返回全新 spring 对象，不触任何入参。
 *
 * 本模块零 DOM、零定时器、零时钟、零随机、零 require（UMD Node 侧直接
 * factory()）；DOM/CSS 变量写操作（setTiltVars）、定时器编排
 * （tiltStartSpring/cancelTiltSpring）、事件绑定全部留守 game.js 适配器。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Tilt = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * 单步弹簧：value 逼近 target。dt 归一到 16.666ms 基准步长（多帧合并步），
   * damp 按步数幂次补偿 → 帧率无关。返回 {value, vel}，非法入参安全原样返回。
   * （本体自 js/gravity.js 逐字迁入——issue #74 刀3；gravity.js 委托本函数。）
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

  /** 指针视口坐标 → 基准倾角（原 game.js applyTilt 内联式逐字迁出）。 */
  function pointerToTilt(x, y, vw, vh) {
    var w = (typeof vw === 'number' && vw > 0 && isFinite(vw)) ? vw : 1;
    var h = (typeof vh === 'number' && vh > 0 && isFinite(vh)) ? vh : 1;
    var px = (typeof x === 'number' && isFinite(x)) ? x : w / 2;
    var py = (typeof y === 'number' && isFinite(y)) ? y : h / 2;
    return {
      rx: 14 + ((py / h) - 0.5) * -8,
      ry: ((px / w) - 0.5) * 10
    };
  }

  /** 引力场目标偏转：以 (16°, 0°) 为不动点放大 factor 倍（默认 1.5）。 */
  function biasTarget(rx, ry, factor) {
    var f = (typeof factor === 'number' && isFinite(factor)) ? factor : 1.5;
    var base = 16;
    return { rx: base + (rx - base) * f, ry: ry * f };
  }

  /** 收敛判据：双轴位移 + 双轴速度四路全部严格小于 eps（默认 0.01）。 */
  function settled(spring, target, eps) {
    var e = (typeof eps === 'number' && eps > 0 && isFinite(eps)) ? eps : 0.01;
    return Math.abs(spring.rx - target.rx) < e &&
           Math.abs(spring.ry - target.ry) < e &&
           Math.abs(spring.vrx) < e && Math.abs(spring.vry) < e;
  }

  /**
   * 一个弹簧拍的完整积分（原 tiltSpringStepTick 编排逐字迁出）。
   * stepFn(cur, tgt, vel, dtMs) → {value, vel} 由调用方注入（决定手感常量
   * k/damp 的归属留在注入方，本函数不持常量）。入参零突变。
   */
  function stepTick(spring, target, stepFn, nowMs, lastTs, baseTickMs) {
    var step = typeof stepFn === 'function' ? stepFn : springStep;
    var base = (typeof baseTickMs === 'number' && baseTickMs > 0 && isFinite(baseTickMs))
      ? baseTickMs : 33;
    var now = (typeof nowMs === 'number' && isFinite(nowMs)) ? nowMs : 0;
    var dt = lastTs ? Math.min(100, now - lastTs) : base;
    var out = { spring: { rx: spring.rx, ry: spring.ry, vrx: spring.vrx, vry: spring.vry },
                lastTs: now };
    if (dt < 0) dt = 0;
    var gx = step(out.spring.rx, target.rx, out.spring.vrx, dt);
    var gy = step(out.spring.ry, target.ry, out.spring.vry, dt);
    out.spring.rx = gx.value; out.spring.vrx = gx.vel;
    out.spring.ry = gy.value; out.spring.vry = gy.vel;
    out.near = settled(out.spring, target);
    return out;
  }

  return {
    springStep: springStep,
    pointerToTilt: pointerToTilt,
    biasTarget: biasTarget,
    settled: settled,
    stepTick: stepTick
  };
});
