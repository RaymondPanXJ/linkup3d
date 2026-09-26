#!/usr/bin/env node
/**
 * tests/timer-static-check.js — 计时挑战模式的无浏览器接线静态断言（issue #12）
 * 验证 index.html / css/style.css / js/game.js / js/timer.js 在
 * 「模式切换、倒计时渲染、暂停冻结、警示态、归零判负、持久化」各端的接线一致性。
 *
 * 运行：node tests/run-tests.js 或单独 node tests/timer-static-check.js
 */
var fs = require('fs');
var path = require('path');

function runChecks() {
  var root = path.join(__dirname, '..');
  var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  var css = fs.readFileSync(path.join(root, 'css', 'style.css'), 'utf8');
  var game = fs.readFileSync(path.join(root, 'js', 'game.js'), 'utf8');
  var timer = fs.readFileSync(path.join(root, 'js', 'timer.js'), 'utf8');

  var results = [];
  function check(name, cond, detail) {
    results.push({ name: name, pass: !!cond, detail: detail || (cond ? 'ok' : 'FAILED') });
  }

  /* 1. timer.js：纯函数模块，双端导出，常量正确 */
  check('timer.js 双端导出（module.exports + window.Timer）',
    /module\.exports = factory\(\)/.test(timer) && /root\.Timer = factory\(\)/.test(timer));
  check('timer.js 限时总长 120s、警示阈值 10s',
    /LIMIT_SECONDS = 120/.test(timer) && /WARN_SECONDS = 10/.test(timer));
  check('timer.js 不依赖 DOM / Date.now（纯函数：时钟由调用方喂入）',
    (function () {
      var code = timer
        .replace(/\/\*[\s\S]*?\*\//g, '')   // 去块注释
        .replace(/\/\/[^\n]*/g, '');        // 去行注释
      return !/document\.|Date\.now|navigator|localStorage/.test(code) &&
             !/window\.(?!Timer)/.test(code);
    })());

  /* 2. index.html：时间显示、模式按钮、暂停按钮与暂停面板、脚本加载 */
  check('HTML 时间显示容器 #statTime（含 #timeLabel / #time）',
    /id="statTime"/.test(html) && /id="timeLabel"/.test(html) && /id="time"/.test(html));
  check('HTML 模式切换按钮组（无尽 / 限时，data-mode + aria）',
    /data-mode="endless"/.test(html) && /data-mode="timed"/.test(html) &&
    /role="group" aria-label="模式选择"/.test(html));
  check('HTML 暂停按钮 #pause 与暂停面板 #pauseScreen（dialog + 继续按钮）',
    /<button id="pause"[^>]*aria-pressed="false"/.test(html) &&
    /<div id="pauseScreen"[^>]*role="dialog"/.test(html) &&
    /<button id="resume"/.test(html));
  check('HTML 在 game.js 之前加载 timer.js',
    html.indexOf('js/timer.js') > 0 && html.indexOf('js/timer.js') < html.indexOf('js/game.js'));

  /* 3. game.js：模式持久化 linkup3d.mode（读+写 + try/catch + 归一化） */
  check("game.js 使用 linkup3d.mode 存储键（读+写）",
    /MODE_KEY = 'linkup3d\.mode'/.test(game) ||
    /TM\.MODE_KEY/.test(game) && /localStorage\.setItem\(MODE_KEY/.test(game));
  check('模式读取经 normalizeMode 归一且有 try/catch 保护',
    /normalizeMode\(localStorage\.getItem\(MODE_KEY\)\)/.test(game) &&
    /try \{[^}]{0,120}getItem\(MODE_KEY\)[\s\S]{0,120}catch/.test(game));

  /* 4. game.js：倒计时渲染 / 警示 / 归零 / 暂停接线 */
  check('限时模式渲染 remaining，无尽模式渲染 elapsed',
    /mode === TM\.MODES\.timed[\s\S]{0,120}tState\.remainingSec[\s\S]{0,80}tState\.elapsedSec/.test(game));
  check('警示态：warning class 仅在限时+未暂停+计时中切换',
    /statTime\.classList\.toggle\('warning'/.test(game) &&
    /!paused && tState\.running && tState\.warning/.test(game));
  check('归零判负：finished 触发 lose()，结算面板显示「时间到」',
    /tState\.finished[\s\S]{0,80}lose\(\)/.test(game) &&
    /showResult\('时间到'/.test(game));
  check('暂停/恢复调用 TM.pause / TM.resume（计时冻结由纯函数保证）',
    /TM\.pause\(tState, nowMs\(\)\)/.test(game) && /TM\.resume\(tState, nowMs\(\)\)/.test(game));
  check('暂停遮罩：board.paused + pauseScreen.show 同步切换',
    /board\.classList\.add\('paused'\)/.test(game) &&
    /pauseScreen\.classList\.add\('show'\)/.test(game));
  check('空格键触发暂停切换',
    /ev\.code === 'Space'[\s\S]{0,120}togglePause\(\)/.test(game));
  check('restart 通过 TM.create(mode) 重置计时状态',
    /tState = TM\.create\(mode\)/.test(game));
  check('暂停期间牌面输入被锁定',
    /if \(busy \|\| paused \|\| !running/.test(game));

  /* 5. css：警示态、暂停遮罩、面板样式 */
  check("css 警示态 #statTime.warning（红色 + 脉动动画）",
    /#statTime\.warning[\s\S]{0,200}animation: time-pulse/.test(css) &&
    /@keyframes time-pulse/.test(css));
  check('css 暂停遮罩：#board.paused 模糊牌面 + #pauseScreen 浮层',
    /#board\.paused[\s\S]{0,120}blur\(/.test(css) &&
    /#pauseScreen\.show \{ opacity: 1; pointer-events: auto; \}/.test(css));
  check('css 模式按钮组样式存在（.mode / .mode-btn + active 态）',
    /\.mode-btn/.test(css) && /\.mode-btn\.active|\.mode \.mode-btn\[class\*=/.test(css));

  return results;
}

module.exports = { runChecks: runChecks };

if (require.main === module) {
  var rs = runChecks();
  var pass = 0;
  rs.forEach(function (r) {
    console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + '  -> ' + r.detail);
    if (r.pass) pass++;
  });
  console.log(pass + '/' + rs.length + ' passed');
  process.exit(pass === rs.length ? 0 : 1);
}
