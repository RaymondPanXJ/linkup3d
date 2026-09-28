#!/usr/bin/env node
/**
 * tests/gravity-static-check.js — 终章关「黑洞应力异常」静态断言（issue #59）
 * 无浏览器环境：对 js/gravity.js / js/stars.js / js/scene.js / js/campaign.js /
 * js/game.js / css/style.css / index.html 做结构与数值侧证。
 * 运行：node tests/run-tests.js
 */
var fs = require('fs');
var path = require('path');
var Stars = require('../js/stars.js');
var Scene = require('../js/scene.js');
var CP = require('../js/campaign.js');
var Gravity = require('../js/gravity.js');

var game = fs.readFileSync(path.join(__dirname, '..', 'js', 'game.js'), 'utf8');
var css = fs.readFileSync(path.join(__dirname, '..', 'css', 'style.css'), 'utf8');
var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function check(name, ok, detail) {
  return { name: name, pass: !!ok, detail: detail || (ok ? 'ok' : 'FAILED') };
}

function runChecks() {
  var out = [];

  /* ---------- 1. blackhole painter 与 s10 场景 ---------- */
  out.push(check('stars.js ELEMENT_PAINTERS 含 blackhole',
    typeof Stars.ELEMENT_PAINTERS.blackhole === 'function'));
  out.push(check('scene.js SCENES.s10 存在且通过 Scene.validateScene',
    (function () {
      var s = Scene.SCENES.s10;
      if (!s) return false;
      try { Scene.validateScene(s); return true; } catch (e) { return false; }
    })()));
  out.push(check('LEVEL_SCENE_IDS 第 11 项为 s10（场景表逐一对应扩到 11）',
    Scene.LEVEL_SCENE_IDS.length === 11 &&
    Scene.LEVEL_SCENE_IDS[10] === 's10' &&
    Scene.sceneForLevelIndex(10).id === 's10'));

  /* ---------- 2. LEVELS[10].gravity 结构 ---------- */
  out.push(check('LEVELS 第 11 关（id 10）gravity 配置结构合法',
    (function () {
      var lv = CP.LEVELS[10];
      return !!lv && lv.id === 10 && !!lv.gravity &&
        Number.isInteger(lv.gravity.warpEveryMs) && lv.gravity.warpEveryMs > 0 &&
        Number.isInteger(lv.gravity.warpHoldMs) && lv.gravity.warpHoldMs > 0 &&
        lv.gravity.warpHoldMs < lv.gravity.warpEveryMs;
    })()));
  out.push(check('campaign.js validateAll 全表通过（含 gravity 容忍）',
    (function () {
      try { CP.validateAll(); return true; } catch (e) { return false; }
    })()));

  /* ---------- 3. springStep 数值侧证：收敛 + 过冲回弹 ---------- */
  out.push(check('springStep 收敛：多步迭代后 value 无限接近 target',
    (function () {
      var v = 0, vel = 0;
      for (var i = 0; i < 600; i++) {
        var r = Gravity.springStep(v, 20, vel, 16.666, 0.04, 0.85);
        v = r.value; vel = r.vel;
      }
      return Math.abs(v - 20) < 1e-6 && Math.abs(vel) < 1e-6;
    })()));
  out.push(check('springStep 过冲：存在某步越过 target 再回落（力场迟滞手感）',
    (function () {
      var v = 0, vel = 0, overshoot = false, crossedBack = false;
      for (var i = 0; i < 300; i++) {
        var r = Gravity.springStep(v, 20, vel, 16.666, 0.04, 0.85);
        vel = r.vel;
        if (!overshoot && r.value > 20) overshoot = true;
        if (overshoot && r.value <= 20) crossedBack = true;
        v = r.value;
      }
      return overshoot && crossedBack;
    })()));
  out.push(check('springStep 非法入参安全（NaN/undefined 不产生 NaN）',
    (function () {
      var r = Gravity.springStep(NaN, undefined, 'x', -5, 0, 3);
      return isFinite(r.value) && isFinite(r.vel);
    })()));
  out.push(check('springStep 帧率无关：30Hz 大步与 60Hz 两步结果接近',
    (function () {
      var a = Gravity.springStep(0, 20, 0, 33.33, 0.04, 0.85);
      var b = Gravity.springStep(0, 20, 0, 16.666, 0.04, 0.85);
      b = Gravity.springStep(b.value, 20, b.vel, 16.666, 0.04, 0.85);
      return Math.abs(a.value - b.value) < 2.5;
    })()));

  /* ---------- 4. pickWarpTargets 确定性 ---------- */
  out.push(check('pickWarpTargets 确定性：同 seed rand 两次调用结果一致',
    (function () {
      function randFactory() {
        var s = 12345;
        return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
      }
      var a = Gravity.pickWarpTargets(48, 10000, randFactory(), { warpEveryMs: 3200 });
      var b = Gravity.pickWarpTargets(48, 10000, randFactory(), { warpEveryMs: 3200 });
      return JSON.stringify(a) === JSON.stringify(b);
    })()));
  out.push(check('pickWarpTargets 不重复、2~4 个、界内（多组 rand 扫描）',
    (function () {
      for (var seed = 1; seed <= 50; seed++) {
        var s = seed;
        var rand = function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
        var res = Gravity.pickWarpTargets(48, seed * 4000, rand, { warpEveryMs: 3200 });
        var t = res.targets;
        if (t.length < Gravity.WARP_MIN || t.length > Gravity.WARP_MAX) return false;
        if (new Set(t).size !== t.length) return false;
        for (var i = 0; i < t.length; i++) {
          if (!Number.isInteger(t[i]) || t[i] < 0 || t[i] >= 48) return false;
        }
      }
      return true;
    })()));
  out.push(check('pickWarpTargets 周期门控：同 warpEveryMs 周期内 phase 相同，跨周期递增',
    (function () {
      var rand = function () { return 0.5; };
      var p1 = Gravity.pickWarpTargets(48, 3200, rand, { warpEveryMs: 3200 }).phase;
      var p2 = Gravity.pickWarpTargets(48, 6399, rand, { warpEveryMs: 3200 }).phase;
      var p3 = Gravity.pickWarpTargets(48, 6400, rand, { warpEveryMs: 3200 }).phase;
      return p1 === p2 && p3 === p1 + 1;
    })()));
  out.push(check('pickWarpTargets 非法入参安全（count<2 / 负时间返回空）',
    Gravity.pickWarpTargets(1, 1000, Math.random, null).targets.length === 0 &&
    Gravity.pickWarpTargets(48, -1, Math.random, null).targets.length === 0));

  /* ---------- 5. warpTransform 纯函数侧证 ---------- */
  out.push(check('warpTransform 近距形变更大（skewX/rotate 随距离单调不增）',
    (function () {
      var near = Gravity.warpTransform(0.1, 0.5), far = Gravity.warpTransform(0.9, 0.5);
      return near.skewX > far.skewX && near.rotate > far.rotate;
    })()));
  out.push(check('warpTransform 确定性 + 幅度上限截断（越界 dist 安全）',
    (function () {
      var a = Gravity.warpTransform(0.42, 0.31), b = Gravity.warpTransform(0.42, 0.31);
      var oob = Gravity.warpTransform(99, -5);
      return JSON.stringify(a) === JSON.stringify(b) &&
        JSON.stringify(a) !== JSON.stringify(Gravity.warpTransform(0.42, 0.9)) &&
        isFinite(oob.skewX) && Math.abs(oob.skewX) <= 20 && Math.abs(oob.rotate) <= 8;
    })()));

  /* ---------- 6. DOM 接线静态断言 ---------- */
  out.push(check('gravity.js 命中格加类 tile-warp + 经 CSS 变量传形变幅度',
    (function () {
      var src = fs.readFileSync(path.join(__dirname, '..', 'js', 'gravity.js'), 'utf8');
      return /classList\.add\('tile-warp'\)/.test(src) &&
        /--warp-mag/.test(src) && /--warp-sign/.test(src) &&
        /--warp-hold/.test(src);
    })()));
  out.push(check('gravity.js 心跳 setInterval + 世代号作废在途回调',
    (function () {
      var src = fs.readFileSync(path.join(__dirname, '..', 'js', 'gravity.js'), 'utf8');
      return /setInterval\(/.test(src) && /if \(my !== token\) return/.test(src);
    })()));
  out.push(check('game.js 接线 Gravity.mount（getLevel 现取关卡定义）且 gravity.js 先于 game.js 加载',
    /GRAVITY\.mount\(board, \{/.test(game) &&
    /getLevel:/.test(game) &&
    html.indexOf('js/gravity.js') !== -1 &&
    html.indexOf('js/gravity.js') < html.indexOf('js/game.js')));
  out.push(check('game.js 倾斜弹簧接线：tiltTarget + springStep + 仅引力场景启用（isGravityScene）',
    /tiltTarget/.test(game) &&
    /GRAVITY\.springStep\(/.test(game) &&
    /isGravityScene\(\)/.test(game)));
  out.push(check('game.js pointerleave/触摸回弹走弹簧（releaseTilt），reduced-motion 有守卫',
    /releaseTilt/.test(game) && /gravityLayer\.isReduced\(\)/.test(game)));
  out.push(check('restart 与 exitCampaign 均清引力层（gravityLayer.reset + resetTilt）',
    /restart\(\)[\s\S]{0,600}gravityLayer\.reset\(\); resetTilt\(\)/.test(game) &&
    /exitCampaign[\s\S]{0,900}gravityLayer\.reset\(\); resetTilt\(\)/.test(game)));
  out.push(check('CSS tile-warp 动画只用 transform（gravity-warp keyframes）+ reduced-motion 关闭',
    /\.tile-slot\.tile-warp \.tile-spin \{[^}]*animation: gravity-warp/.test(css) &&
    /@keyframes gravity-warp \{[^}]*transform: skewX/.test(css) &&
    /@media \(prefers-reduced-motion: reduce\)[\s\S]{0,200}\.tile-slot\.tile-warp \.tile-spin \{ animation: none/.test(css)));

  return out;
}

module.exports = { runChecks: runChecks };

if (require.main === module) {
  var results = runChecks(), pass = 0;
  results.forEach(function (r) {
    console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + '  -> ' + r.detail);
    if (r.pass) pass++;
  });
  console.log(pass + '/' + results.length + ' passed');
  process.exit(pass === results.length ? 0 : 1);
}
