/**
 * tests/tilt.define.js — js/tilt.js 纯函数数值用例（issue #74 刀3）
 *
 * 覆盖：springStep 收敛/过冲/帧率无关/非法入参/常量兜底/决定论；pointerToTilt
 * 映射值；biasTarget 不动点与倍率；settled 严格边界；stepTick dt 钳制、入参
 * 不可变、收敛终止；Gravity.springStep 委托同一性（本体单源）；以及一局
 * 30 拍仿真——旧接线实现 vs 新 stepTick+注入包装逐步逐字节等值（行为零变化）。
 *
 * 运行：node tests/tilt.define.js 或 node tests/run-tests.js
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../js/tilt.js'), require('../js/gravity.js'));
  } else {
    root.TiltDefine = factory(root.Tilt, root.Gravity);
  }
})(typeof self !== 'undefined' ? self : this, function (T, GV) {
  'use strict';

  function case_(name, pass, detail) {
    return { name: name, pass: !!pass, detail: detail || (pass ? 'ok' : 'FAILED') };
  }

  function finite(v) { return typeof v === 'number' && isFinite(v); }

  function runAll() {
    var out = [];

    /* ---- springStep：数值侧证 ---- */
    var v = 0, vel = 0, conv = true;
    for (var i = 0; i < 600; i++) {
      var r = T.springStep(v, 20, vel, 16.666, 0.04, 0.85);
      v = r.value; vel = r.vel;
      if (!finite(v) || !finite(vel)) { conv = false; break; }
    }
    out.push(case_('用例T1 springStep 收敛：600 步后 value 无限接近 target',
      conv && Math.abs(v - 20) < 1e-3 && Math.abs(vel) < 1e-3, 'v=' + v.toFixed(6)));

    var over = false;
    v = 0; vel = 0;
    for (var j = 0; j < 400; j++) {
      var r2 = T.springStep(v, 20, vel, 16.666, 0.04, 0.85);
      v = r2.value; vel = r2.vel;
      if (v > 20) { over = true; break; }
    }
    out.push(case_('用例T2 springStep 过冲：存在越过 target 的步（力场迟滞手感保留）', over));

    var a = T.springStep(0, 20, 0, 33.33, 0.04, 0.85);
    var b = T.springStep(0, 20, 0, 16.666, 0.04, 0.85);
    b = T.springStep(b.value, 20, b.vel, 16.666, 0.04, 0.85);
    // 容差沿 gravity-static-check 既有帧率无关锁同口径（<2.5），不另发明更严阈值
    out.push(case_('用例T3 springStep 帧率无关：30Hz 一步与 60Hz 两步差在既有锁容差内',
      Math.abs(a.value - b.value) < 2.5,
      '30Hz=' + a.value.toFixed(4) + ' 60Hz×2=' + b.value.toFixed(4)));

    var bad = T.springStep(NaN, undefined, 'x', -5, 0, 3);
    out.push(case_('用例T4 springStep 非法入参安全（NaN/undefined/字符串不产 NaN）',
      finite(bad.value) && finite(bad.vel)));

    var d1 = T.springStep(0, 10, 0, 16.666, undefined, undefined);
    var d2 = T.springStep(0, 10, 0, 16.666, 0.04, 0.85);
    out.push(case_('用例T5 springStep 常量兜底：k/damp 非法时取 0.04/0.85 同值',
      d1.value === d2.value && d1.vel === d2.vel));

    // T6 决定论：同参双跑 + 100 步轨道字符串逐字节
    function orbit(seedK) {
      var x = 3, w = -2, s = [];
      for (var n = 0; n < 100; n++) {
        var rr = T.springStep(x, 17, w, 10 + (n % 7), seedK, 0.85);
        x = rr.value; w = rr.vel; s.push(rr.value.toFixed(9) + ':' + rr.vel.toFixed(9));
      }
      return s.join('|');
    }
    out.push(case_('用例T6 springStep 决定论：同参 100 步轨道两次运行逐字节一致',
      orbit(0.04) === orbit(0.04)));

    /* ---- pointerToTilt ---- */
    var pc = T.pointerToTilt(400, 300, 800, 600);
    var pt = T.pointerToTilt(0, 0, 800, 600), pb = T.pointerToTilt(800, 600, 800, 600);
    var pl = T.pointerToTilt(0, 300, 800, 600), pr = T.pointerToTilt(800, 300, 800, 600);
    out.push(case_('用例T7 pointerToTilt 映射值：中心(14,0)/顶18/底10/左-5/右5',
      pc.rx === 14 && pc.ry === 0 && pt.rx === 18 && pb.rx === 10 &&
      pl.ry === -5 && pr.ry === 5));

    var fb = T.pointerToTilt(NaN, undefined, 0, -3);
    out.push(case_('用例T8 pointerToTilt 非法视口/坐标安全回落（无 NaN）',
      finite(fb.rx) && finite(fb.ry)));

    /* ---- biasTarget ---- */
    var bp = T.biasTarget(16, 0);
    var bm = T.biasTarget(18, 2);
    var bo = T.biasTarget(18, 2, 2);
    out.push(case_('用例T9 biasTarget 不动点 16°/0°；默认×1.5；factor 覆写生效',
      bp.rx === 16 && bp.ry === 0 && bm.rx === 19 && bm.ry === 3 &&
      bo.rx === 20 && bo.ry === 4));

    /* ---- settled ---- */
    var sp = { rx: 20, ry: 0, vrx: 0, vry: 0 }, tg = { rx: 20, ry: 0 };
    var near1 = T.settled({ rx: 20.009, ry: 0, vrx: 0, vry: 0 }, tg);
    var near2 = T.settled({ rx: 20.01, ry: 0, vrx: 0, vry: 0 }, tg);
    var near3 = T.settled({ rx: 20, ry: 0, vrx: 0.02, vry: 0 }, tg);
    out.push(case_('用例T10 settled 严格边界：0.009 收/0.01 不收/速度分量未衰不尽不收',
      T.settled(sp, tg) === true && near1 === true && near2 === false && near3 === false));

    /* ---- stepTick ---- */
    var spring = { rx: 0, ry: 0, vrx: 0, vry: 0 };
    var target = { rx: 20, ry: 10 };
    var wrapper = function (cur, tgt, wl, dt) { return T.springStep(cur, tgt, wl, dt, 0.04, 0.85); };
    var t1 = T.stepTick(spring, target, wrapper, 1000, 0, 33);
    var t2 = T.stepTick(t1.spring, target, wrapper, 6000, 1000, 33); // 5000ms 断档
    var t3 = T.stepTick(t1.spring, target, wrapper, 1033, 1000, 33); // 33ms 常规
    var clampEq = JSON.stringify(t2.spring) ===
      JSON.stringify(T.stepTick(t1.spring, target, wrapper, 1100, 1000, 33).spring);
    var firstEq = JSON.stringify(t1.spring) ===
      JSON.stringify(T.stepTick(spring, target, wrapper, 1000, 0, 33).spring) &&
      t1.spring.rx !== spring.rx; // 首拍 dt=base(33) 而非真实间隔
    out.push(case_('用例T11 stepTick dt 钳制：断档 5s 按 dt=100 截断；首拍按基准步长',
      clampEq && firstEq && t1.lastTs === 1000));

    var before = JSON.stringify([spring, target]);
    T.stepTick(spring, target, wrapper, 2000, 1000, 33);
    out.push(case_('用例T12 stepTick 入参不可变：spring/target JSON 零变化且返回新对象',
      JSON.stringify([spring, target]) === before &&
      t1.spring !== spring && t1.spring.rx !== undefined));

    var conv2 = { rx: 20.001, ry: 0, vrx: 0.0001, vry: 0 };
    var q = T.stepTick(conv2, { rx: 20, ry: 0 }, wrapper, 1033, 1000, 33);
    out.push(case_('用例T13 stepTick 收敛终止：settled 域内 near=true',
      q.near === true));

    /* ---- 委托单源 ---- */
    out.push(case_('用例T14 委托单源：Gravity.springStep === Tilt.springStep（同一函数对象）',
      GV.springStep === T.springStep));

    /* ---- 接线等值仿真：旧实现 vs 新 stepTick，30 拍逐字节 ---- */
    // 旧 tiltSpringStepTick + applyTilt 引力分支的逐字复刻（dt 序列含一次断档钳制）
    var oldS = { rx: 16, ry: 0, vrx: 0, vry: 0 }, oldT = { rx: 16, ry: 0 };
    var oldLog = [];
    var dts = [null, 33, 33, 41, 33, 33, 250, 33, 33, 33, 33, 33, 17, 33, 33, 33,
      33, 90, 33, 33, 33, 33, 33, 33, 120, 33, 33, 33, 33, 33];
    var oldLast = 0;
    // 目标序列：引力偏转旧式内联计算（p 为虚拟指针位）
    var ptrs = [[400, 300], [520, 220], [300, 480], [640, 90], [120, 560],
      [400, 300], [760, 40], [40, 560], [400, 300], [500, 350]];
    var clock = 1000;
    var oldTrack = [], newTrack = [];
    var newS = { rx: 16, ry: 0, vrx: 0, vry: 0 }, newT = { rx: 16, ry: 0 };
    var newLast = 0;
    for (var k = 0; k < 30; k++) {
      var dt = dts[k];
      var tgt = ptrs[k % ptrs.length];
      // 旧 applyTilt：rx/ry 内联式 + 引力目标内联式
      var orx = 14 + ((tgt[1] / 600) - 0.5) * -8;
      var ory = ((tgt[0] / 800) - 0.5) * 10;
      oldT.rx = 16 + (orx - 16) * 1.5; oldT.ry = ory * 1.5;
      newT.rx = 16 + (orx - 16) * 1.5; newT.ry = ory * 1.5;
      // 旧 tick
      clock += dt;
      var odt = oldLast ? Math.min(100, clock - oldLast) : 33;
      oldLast = clock;
      var gx = T.springStep(oldS.rx, oldT.rx, oldS.vrx, odt, 0.04, 0.85);
      var gy = T.springStep(oldS.ry, oldT.ry, oldS.vry, odt, 0.04, 0.85);
      oldS.rx = gx.value; oldS.vrx = gx.vel; oldS.ry = gy.value; oldS.vry = gy.vel;
      oldTrack.push(oldS.rx.toFixed(9) + ',' + oldS.ry.toFixed(9) + ',' +
        oldS.vrx.toFixed(9) + ',' + oldS.vry.toFixed(9));
      // 新接线：pointerToTilt + biasTarget + stepTick(注入 GRAVITY.springStep 包装)
      var p = T.pointerToTilt(tgt[0], tgt[1], 800, 600);
      var bt = T.biasTarget(p.rx, p.ry, 1.5);
      newT.rx = bt.rx; newT.ry = bt.ry;
      var nt = T.stepTick(newS, newT, function (c, t, wl, dm) {
        return GV.springStep(c, t, wl, dm, 0.04, 0.85);
      }, clock, newLast, 33);
      newS = nt.spring; newLast = nt.lastTs;
      newTrack.push(newS.rx.toFixed(9) + ',' + newS.ry.toFixed(9) + ',' +
        newS.vrx.toFixed(9) + ',' + newS.vry.toFixed(9));
    }
    out.push(case_('用例T15 接线等值仿真：旧接线复刻 vs 新模块 30 拍轨道逐字节一致',
      oldTrack.join('|') === newTrack.join('|')));

    return out;
  }

  return { runAll: runAll };
});

if (typeof require === 'function' && typeof module === 'object' && require.main === module) {
  var rs = module.exports.runAll();
  var pass = 0;
  rs.forEach(function (r) {
    console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + '  -> ' + r.detail);
    if (r.pass) pass++;
  });
  console.log('----------------------------------------');
  console.log(pass + '/' + rs.length + ' passed');
  process.exit(pass === rs.length ? 0 : 1);
}
