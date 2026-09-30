#!/usr/bin/env node
/**
 * tests/elapsed-static-check.js — HUD「已用」计时（issue #63）的无浏览器接线静态断言
 * 验证 index.html / css/style.css / js/game.js 在「DOM 接线、mm:ss 渲染、
 * 暂停冻结/恢复连续、抗节流计时基准、模式显隐」各端的接线一致性。
 *
 * 运行：node tests/run-tests.js 或单独 node tests/elapsed-static-check.js
 */
var readUtf8 = require('./read-utf8.js');
var path = require('path');

function runChecks() {
  var root = path.join(__dirname, '..');
  var html = readUtf8(path.join(root, 'index.html'));
  var css = readUtf8(path.join(root, 'css', 'style.css'));
  var game = readUtf8(path.join(root, 'js', 'game.js'));
  var timer = readUtf8(path.join(root, 'js', 'timer.js'));

  var results = [];
  function check(name, cond, detail) {
    results.push({ name: name, pass: !!cond, detail: detail || (cond ? 'ok' : 'FAILED') });
  }

  /* 1. index.html：hud-stats 内新增 .stat.elapsed（#statElapsed + #elapsed） */
  check('HTML hud-stats 内存在 #statElapsed（class stat elapsed，含「已用」label）',
    /<div class="stat elapsed" id="statElapsed">[\s\S]{0,120}<span class="label">已用<\/span>/.test(html));
  check('HTML #statElapsed 内含数值容器 #elapsed，初始 00:00',
    /<span class="value" id="elapsed">00:00<\/span>/.test(html) &&
    html.indexOf('id="elapsed"') < html.indexOf('</div>', html.indexOf('id="elapsed"')));
  check('HTML #statElapsed 位于 hud-stats 容器内（statTime 之后、剩余对数之前）',
    (function () {
      var hud = html.slice(html.indexOf('class="hud-stats"'),
        html.indexOf('</div>\n    <div class="hud-controls"'));
      return hud.indexOf('id="statTime"') >= 0 &&
        hud.indexOf('id="statElapsed"') > hud.indexOf('id="statTime"') &&
        hud.indexOf('id="pairs"') > hud.indexOf('id="statElapsed"');
    })());

  /* 2. game.js：DOM 引用与 renderTime 渲染 */
  check('game.js 引用 #statElapsed / #elapsed 两个元素',
    /getElementById\('statElapsed'\)/.test(game) &&
    /getElementById\('elapsed'\)/.test(game));
  check('renderTime 用 fmt(tState.elapsedSec) 渲染 #elapsed（mm:ss）',
    /function renderTime\(\)[\s\S]{0,400}elapsedEl\.textContent = fmt\(tState\.elapsedSec\)/.test(game));
  check('fmt 输出 mm:ss 零填充格式',
    /function fmt\(s\)[\s\S]{0,200}\(m < 10 \? '0' : ''\) \+ m \+ ':' \+ \(ss < 10 \? '0' : ''\) \+ ss/.test(game));

  /* 3. game.js：显隐策略 —— 无尽模式 #statTime 已显示用时，本格仅限时模式显示 */
  check('无尽模式隐藏 #statElapsed（避免与 #statTime 正计时重复）',
    /statElapsed\.hidden = mode !== TM\.MODES\.timed/.test(game));

  /* 4. game.js + timer.js：暂停停走 / 恢复连续 / 抗节流计时基准 */
  check('计时基准为单调时钟差值：nowMs 优先 performance.now（抗后台标签节流）',
    /function nowMs\(\)[\s\S]{0,150}performance && window\.performance\.now[\s\S]{0,100}performance\.now\(\)/.test(game));
  check('elapsed 由 timer.js 纯函数差值推导（nowMs - startAtMs），非 setInterval 累加',
    /var elapsedMs = nowMs - st\.startAtMs/.test(timer) && !/elapsedMs \+= \d+/.test(timer));
  check('暂停时 renderTime 刷新冻结值（TM.pause 后同函数内调用）',
    /TM\.pause\(tState, nowMs\(\)\)[\s\S]{0,250}renderTime\(\)/.test(game));
  check('恢复时 renderTime 刷新连续值（TM.resume 后同函数内调用）',
    /TM\.resume\(tState, nowMs\(\)\)[\s\S]{0,250}renderTime\(\)/.test(game));
  check('restart 经 TM.create 重置并由 renderTime 归零显示',
    /tState = TM\.create\(mode\)[\s\S]{0,900}renderTime\(\)/.test(game));

  /* 5. css：已用配色与显隐收起（.stat 的 flex 会覆盖 UA [hidden]，须显式规则） */
  check('css 定义 .stat.elapsed 数值配色',
    /\.stat\.elapsed \.value\s*\{/.test(css));
  check('css 显式收起 #statElapsed[hidden]（display:none）',
    /#statElapsed\[hidden\]\s*\{\s*display:\s*none/.test(css));

  return results;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { runChecks: runChecks };
}

if (require.main === module) {
  var results = runChecks();
  var pass = 0;
  results.forEach(function (r) {
    console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.name +
      (r.detail ? '  -> ' + r.detail : ''));
    if (r.pass) pass++;
  });
  console.log('----------------------------------------');
  console.log(pass + '/' + results.length + ' elapsed static checks passed');
  process.exit(pass === results.length ? 0 : 1);
}
