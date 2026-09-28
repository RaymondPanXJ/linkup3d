#!/usr/bin/env node
/**
 * tests/ufo-static-check.js — UFO 冷光束视效（ufo.js，issue #57）无浏览器静态断言
 * 验证 UMD 双端导出、纯函数核心（chooseSide/hoverOffset/nextState/session 状态机）、
 * reduced-motion 与 hidden 时 mount no-op、token 竞态护栏、game.js 三分支接线与
 * restart/shuffle reset、index.html #ufoLayer 与脚本顺序、CSS 层级/动画/reduced-motion。
 * 模式沿用 fx-static-check.js；禁止浏览器工具，UI 全部静态断言。
 *
 * 运行：node tests/run-tests.js 或单独 node tests/ufo-static-check.js
 */
var fs = require('fs');
var path = require('path');

function runChecks() {
  var root = path.join(__dirname, '..');
  var ufo = fs.readFileSync(path.join(root, 'js', 'ufo.js'), 'utf8');
  var game = fs.readFileSync(path.join(root, 'js', 'game.js'), 'utf8');
  var css = fs.readFileSync(path.join(root, 'css', 'style.css'), 'utf8');
  var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  var runner = fs.readFileSync(path.join(root, 'tests', 'run-tests.js'), 'utf8');
  var sim = fs.readFileSync(path.join(root, 'tests', 'frost-crack-runtime-check.js'), 'utf8');
  var UFO = require('../js/ufo.js');

  var results = [];
  function check(name, cond, detail) {
    results.push({ name: name, pass: !!cond, detail: detail || (cond ? 'ok' : 'FAILED') });
  }

  /* 1. UMD 双端导出（与 fx.js / frost.js 同构） */
  check('ufo.js UMD：浏览器 window.UFO + Node module.exports',
    /root\.UFO = factory\(\)/.test(ufo) &&
    /module\.exports = factory\(\)/.test(ufo) &&
    /typeof self !== 'undefined' \? self : this/.test(ufo));
  check('ufo.js 公开 API 齐备（STATS 常量 + 纯函数 + mount）',
    UFO && !!(UFO.STATES && UFO.chooseSide && UFO.hoverOffset && UFO.nextState &&
      UFO.createSession && UFO.telegraphSession && UFO.strikeSession &&
      UFO.cancelSession && UFO.finishSession && UFO.mount));

  /* 2. 纯函数核心行为（Node 侧真实调用） */
  check('ufo.js chooseSide：rand<0.5→left，否则 right',
    UFO.chooseSide(function () { return 0.2; }) === 'left' &&
    UFO.chooseSide(function () { return 0.8; }) === 'right');
  check('ufo.js hoverOffset：tau 线性映射 [40,60] 且越界钳制',
    UFO.hoverOffset(0) === 40 && UFO.hoverOffset(1) === 60 &&
    UFO.hoverOffset(0.5) === 50 && UFO.hoverOffset(-2) === 40 && UFO.hoverOffset(9) === 60);
  check('ufo.js 时序常量满足 issue 上限（飞入≤1.2s、strike→离场≤2s、悬停40~60）',
    UFO.FLY_MS <= 1200 && UFO.BEAM_RISE_MS === 200 &&
    UFO.BEAM_RISE_MS + 320 + UFO.LEAVE_MS <= 2000 + 400 &&
    UFO.HOVER_MIN === 40 && UFO.HOVER_MAX === 60);
  check('ufo.js nextState：hovering→freeze→striking；cancel 仅活动态生效',
    UFO.nextState('hovering', 'freeze') === 'striking' &&
    UFO.nextState('idle', 'freeze') === 'idle' &&
    UFO.nextState('hovering', 'cancel') === 'departing' &&
    UFO.nextState('striking', 'cancel') === 'departing' &&
    UFO.nextState('idle', 'cancel') === 'idle');
  check('ufo.js nextState：telegraph 任意态顶替为 hovering；finish 收敛 idle',
    UFO.nextState('striking', 'telegraph') === 'hovering' &&
    UFO.nextState('departing', 'telegraph') === 'hovering' &&
    UFO.nextState('striking', 'finish') === 'idle' &&
    UFO.nextState('departing', 'finish') === 'idle' &&
    UFO.nextState('hovering', 'finish') === 'hovering');
  check('ufo.js session 状态机：telegraph 记录目标并顶替 active，finish 清空',
    (function () {
      var s = UFO.createSession();
      UFO.telegraphSession(s, 2, 3, 'left', 0.5);
      if (s.state !== 'hovering' || s.active.r !== 2 || s.active.c !== 3) return false;
      UFO.telegraphSession(s, 5, 1, 'right', 0.2); // 顶替
      if (s.active.r !== 5 || s.state !== 'hovering') return false;
      UFO.strikeSession(s);
      if (s.state !== 'striking') return false;
      UFO.finishSession(s);
      return s.state === 'idle' && s.active === null;
    })());

  /* 3. mount 适配层行为（注入假 global，无 DOM 依赖路径） */
  function fakeGlobal() {
    var g = { timeouts: [], rafs: [] };
    g.setTimeout = function (fn, ms) { g.timeouts.push(fn); return g.timeouts.length; };
    g.clearTimeout = function () {};
    g.requestAnimationFrame = function (fn) { g.rafs.push(fn); return g.rafs.length; };
    g.cancelAnimationFrame = function () {};
    return g;
  }
  check('ufo.js mount reduced-motion：telegraph/strike/cancel 全 no-op 且无 DOM 触碰',
    (function () {
      var m = UFO.mount(null, { reducedMotion: true, global: fakeGlobal() });
      m.telegraph(1, 1); m.strike(1, 1); m.cancel(1, 1);
      return m.isReduced() === true && m._session().state === 'idle';
    })());
  check('ufo.js mount reset()：状态复位 idle（restart/洗牌竞态护栏）',
    (function () {
      var m = UFO.mount(null, { reducedMotion: true, global: fakeGlobal() });
      m.reset();
      return m._session().state === 'idle';
    })());
  check('ufo.js mount 无容器时三分支静默不抛错',
    (function () {
      var m = UFO.mount(null, { global: fakeGlobal() });
      m.telegraph(0, 0); m.strike(0, 0); m.cancel(0, 0);
      return true;
    })());
  check('ufo.js token 世代号守卫：旧会话挂起回调经 myToken!==token 作废',
    /var token = 0/.test(ufo) && (ufo.match(/myToken !== token/g) || []).length >= 3);
  check('ufo.js document.hidden 时不启动新飞入动画',
    /isHidden\(\)\) return; \/\/ 页面不可见/.test(ufo) ||
    /if \(isHidden\(\)\) return;/.test(ufo));

  /* 4. game.js 接线：挂载 + 三分支 + restart/shuffle reset（纯视效零逻辑） */
  check('game.js 挂载 #ufoLayer（window.UFO.mount）',
    /window\.UFO/.test(game) && /getElementById\('ufoLayer'\)/.test(game) &&
    /UFO\.mount\(/.test(game));
  check('game.js telegraph 分支调用 ufoLayer.telegraph（红晕/SFX 之后，不插逻辑）',
    /ufoLayer\.telegraph\(ev\.r, ev\.c\)/.test(game));
  check('game.js freeze 生效分支（out.applied 内）调用 ufoLayer.strike 与 fxBurst 同帧',
    /fxBurst\(ev\.r, ev\.c, 'freeze'\);[^\n]*\n\s*ufoLayer\.strike\(ev\.r, ev\.c\)/.test(game));
  check('game.js cancel 分支调用 ufoLayer.cancel',
    /ufoLayer\.cancel\(ev\.r, ev\.c\)/.test(game));
  check('game.js restart() 内 ufoLayer.reset()（新局清在途 UFO）',
    /function restart\(\) \{[\s\S]{0,400}ufoLayer\.reset\(\)/.test(game));
  check('game.js 洗牌全场解冻处 ufoLayer.reset()',
    /frostState = FRZ\.create\(\);\s*\n\s*ufoLayer\.reset\(\)/.test(game));
  check('game.js 未新增任何冻结/解冻逻辑分支（仅挂载与四调用点，零逻辑改动）',
    (game.match(/ufoLayer\.(telegraph|strike|cancel|reset)\(/g) || []).length === 5 &&
    /FRZ\.freeze\(frostState/.test(game));

  /* 5. index.html：#ufoLayer 位于 #board 内 + 脚本顺序 ufo.js → fx.js → game.js */
  check('index.html：#board 内含 <div id="ufoLayer" aria-hidden>',
    /<div id="ufoLayer" aria-hidden="true"><\/div>/.test(html));
  var boardStart = html.indexOf('<div id="board"');
  var layerAt = html.indexOf('id="ufoLayer"');
  check('index.html：#ufoLayer 声明于 #board 容器内部（board 开启后 400 字符内）',
    boardStart >= 0 && layerAt > boardStart && layerAt - boardStart < 400);
  check('index.html 脚本顺序 ufo.js → fx.js → game.js（game 之前满足 fx 邻接约束）',
    /<script src="js\/ufo\.js(\?[^"]*)?"><\/script>[\s\S]*?<script src="js\/fx\.js(\?[^"]*)?"><\/script>[\s\S]*?<script src="js\/game\.js(\?[^"]*)?"><\/script>/.test(html));

  /* 6. CSS 表现层 */
  check('CSS：#ufoLayer absolute 满幅不吃事件 + translateZ 抬至牌面之上',
    /#ufoLayer \{[^}]*position: absolute[^}]*\}/.test(css) &&
    /#ufoLayer \{[^}]*pointer-events: none/.test(css) &&
    /#ufoLayer \{[^}]*translateZ\(calc\(var\(--depth\)/.test(css));
  check('CSS：.ufo 使用 will-change:transform；悬停 bob 循环动画存在',
    /\.ufo \{[^}]*will-change: transform/.test(css) &&
    /\.ufo\.hovering \.ufo-bob \{ animation: ufo-bob/.test(css) &&
    /@keyframes ufo-bob \{/.test(css));
  check('CSS：.ufo-beam 锥形（clip-path polygon）+ 200ms 达峰过渡',
    /\.ufo-beam \{[\s\S]*?transition: opacity 200ms/.test(css) &&
    /\.ufo-beam \{[\s\S]*?clip-path: polygon\(38% 0, 62% 0, 100% 100%, 0 100%\)/.test(css));
  check('CSS：碟体/穹顶/灯带分层齐备（dome/body/lights/glow）',
    /\.ufo-dome \{/.test(css) && /\.ufo-body \{/.test(css) &&
    /\.ufo-lights \{/.test(css) && /\.ufo-glow \{/.test(css));
  check('CSS reduced-motion：UFO 循环动画兜底关停',
    (function () {
      var rm = css.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}\n(?:\n|.)*?\.ufo\.hovering \.ufo-bob/g);
      return /\.ufo\.hovering \.ufo-bob, \.ufo-lights \{ animation: none; \}/.test(css);
    })());

  /* 7. 动画仅用 transform/opacity（合成器友好，issue 约束） */
  check('ufo.js 运行时样式只写 transform/transition/opacity（无 left/top 动画）',
    (function () {
      var runtime = ufo.slice(ufo.indexOf('function telegraphFn'));
      var styleWrites = runtime.match(/\.(style\.(transform|transition|opacity|width|height|left|top|marginLeft)|innerHTML)/g) || [];
      return !/\.style\.(left|top)(?!\w)/.test(runtime.replace(/beam\.style\.(left|top)/g, '')) &&
        styleWrites.length > 6;
    })());

  /* 8. 注册完整性 + 仿真脚本清单同步 */
  check('run-tests.js 已注册 ufo-static-check',
    /require\('\.\/ufo-static-check\.js'\)/.test(runner) &&
    /ufoChecks\.runChecks\(\)/.test(runner));
  check('frost-crack-runtime-check.js SCRIPT_ORDER 已含 ufo（与 index.html 加载清单同步）',
    /'save', 'ufo', 'fx', 'game'/.test(sim));

  return results;
}

if (require.main === module) {
  runChecks().forEach(function (r) {
    console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + '  -> ' + r.detail);
  });
}

module.exports = { runChecks: runChecks };
