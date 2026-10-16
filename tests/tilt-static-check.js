/**
 * tests/tilt-static-check.js — js/tilt.js 静态断言（issue #74 刀3）
 *
 * 无浏览器环境：锁 UMD 双端、纯函数纪律（去注释后零 DOM/零定时器/零时钟/
 * 零随机/零 require）、API 齐备、弹簧公式单源（gravity.js 已委托不残留）、
 * game.js 适配器与接线点、index.html/SCRIPT_ORDER 加载清单、注册完整性。
 *
 * 运行：node tests/tilt-static-check.js 或 node tests/run-tests.js
 */
'use strict';
var path = require('path');
var readUtf8 = require('./read-utf8.js');

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function runChecks() {
  var root = path.join(__dirname, '..');
  var tilt = readUtf8(path.join(root, 'js', 'tilt.js'));
  var gravity = readUtf8(path.join(root, 'js', 'gravity.js'));
  var game = readUtf8(path.join(root, 'js', 'game.js'));
  var html = readUtf8(path.join(root, 'index.html'));
  var frostCrack = readUtf8(path.join(root, 'tests', 'frost-crack-runtime-check.js'));
  var runner = readUtf8(path.join(root, 'tests', 'run-tests.js'));
  var bare = stripComments(tilt);
  var results = [];

  function check(name, pass, detail) {
    results.push({ name: name, pass: !!pass, detail: detail || (pass ? 'ok' : 'FAILED') });
  }

  check('S1 tilt.js UMD 双端（module.exports + root.Tilt，镜像 gravity.js 信封）',
    /module\.exports = factory\(\)/.test(tilt) && /root\.Tilt = factory\(\)/.test(tilt));
  check('S2 tilt.js 零 DOM（去注释后无 document/getElementById/querySelector/style）',
    !/document|getElementById|querySelector|\.style/.test(bare));
  check('S3 tilt.js 零定时器零时钟零随机（无 setInterval/setTimeout/Date.now/Math.random）',
    !/setInterval|setTimeout|Date\.now|Math\.random/.test(bare));
  check('S4 tilt.js 零 require/import（去注释后；UMD Node 分支直接 factory()）',
    !/require\s*\(|\bimport\b/.test(bare));
  check('S5 tilt.js API 齐备（springStep/pointerToTilt/biasTarget/settled/stepTick 导出）',
    ['springStep', 'pointerToTilt', 'biasTarget', 'settled', 'stepTick'].every(function (fn) {
      return new RegExp('return \\{[\\s\\S]*' + fn + ': ' + fn).test(tilt) ||
        new RegExp('    ' + fn + ': ' + fn + ',').test(tilt);
    }));
  check('S6 弹簧公式单源：Math.pow(dm, n) 在 tilt.js 且 gravity.js 无残留',
    /Math\.pow\(dm, n\)/.test(tilt) && !/Math\.pow\(dm, n\)/.test(gravity));
  check('S7 gravity.js 委托 tilt.js（UMD 注入 Tilt + springStep: Tilt.springStep + fail-fast 门）',
    /factory\(require\('\.\/tilt\.js'\)\)/.test(gravity) &&
    /factory\(root\.Tilt\)/.test(gravity) &&
    /springStep: Tilt\.springStep/.test(gravity) &&
    /需要 tilt\.js/.test(gravity));
  check('S8 game.js DOM/定时器适配器留守（setTiltVars/tiltStartSpring/cancelTiltSpring/心跳）',
    /function setTiltVars/.test(game) && /board\.style\.setProperty\('--rx'/.test(game) &&
    /function tiltStartSpring/.test(game) && /function cancelTiltSpring/.test(game) &&
    /setInterval\(tiltSpringStepTick, TILT_TICK_MS\)/.test(game));
  check('S9 game.js 接线走 Tilt（stepTick/pointerToTilt/biasTarget + GRAVITY.springStep 注入包装在位）',
    /Tilt\.stepTick\(/.test(game) && /Tilt\.pointerToTilt\(/.test(game) &&
    /Tilt\.biasTarget\(/.test(game) && /GRAVITY\.springStep\(/.test(game));
  check('S10 game.js 纯数学零残留（旧指针式/旧 near 四条件/16.666 均不在 game.js）',
    !/\(\(x \/ window\.innerWidth\) - 0\.5\) \* 10/.test(game) &&
    !/Math\.abs\(tiltSpring\.vrx\) < 0\.01/.test(game) &&
    !/16\.666/.test(game));
  check('S11 index.html 按序加载 tilt.js（gravity.js 之前、game.js 之前）',
    html.indexOf('js/tilt.js') !== -1 &&
    html.indexOf('js/tilt.js') < html.indexOf('js/gravity.js') &&
    html.indexOf('js/tilt.js') < html.indexOf('js/game.js'));
  check('S12 frost-crack SCRIPT_ORDER 已含 tilt（加载清单同步，刀1 audio-ui 先例）',
    /'tilt'/.test(frostCrack));
  check('S13 run-tests.js 已注册本套件与 tilt.define（require + 调用）',
    /tilt-static-check/.test(runner) && /tilt\.define/.test(runner));

  return results;
}

if (require.main === module) {
  var rs = runChecks();
  var pass = 0;
  rs.forEach(function (r) {
    console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + '  -> ' + r.detail);
    if (r.pass) pass++;
  });
  console.log('----------------------------------------');
  console.log(pass + '/' + rs.length + ' passed');
  process.exit(pass === rs.length ? 0 : 1);
}

module.exports = { runChecks: runChecks };
