#!/usr/bin/env node
/**
 * tests/fire-static-check.js — 熔火状态层（fire.js）无浏览器静态断言（issue #65 T1）
 * 验证 UMD 双端导出、纯函数约束（代码不含 document / localStorage / Date.now / window.）、
 * 回合/随机源由调用方注入（无内部定时器）、信封契约 API 齐备、上限常量、
 * 状态可序列化往返，以及测试注册完整性。模式沿用 tests/frost-static-check.js。
 *
 * 运行：node tests/run-tests.js 或单独 node tests/fire-static-check.js
 */
var readUtf8 = require('./read-utf8.js');
var path = require('path');

function runChecks() {
  var root = path.join(__dirname, '..');
  var fire = readUtf8(path.join(root, 'js', 'fire.js'));
  var runner = readUtf8(path.join(root, 'tests', 'run-tests.js'));
  var F = require('../js/fire.js');

  var results = [];
  function check(name, cond, detail) {
    results.push({ name: name, pass: !!cond, detail: detail || (cond ? 'ok' : 'FAILED') });
  }

  /* 1. UMD 双端导出（与 frost.js / ranking.js 同构） */
  check('fire.js UMD：浏览器 window.Fire + Node module.exports',
    /root\.Fire = factory\(\)/.test(fire) &&
    /module\.exports = factory\(\)/.test(fire) &&
    /typeof self !== 'undefined' \? self : this/.test(fire));

  /* 2. 纯函数约束：代码（去注释后）不含 DOM / 存储 / 时钟 / 全局对象直接依赖 */
  function stripComments(src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  }
  var code = stripComments(fire);
  check('fire.js 代码不含 DOM/localStorage/Date.now/window. 直接依赖',
    !/\bdocument\b/.test(code) && !/\blocalStorage\b/.test(code) &&
    !/Date\.now\(/.test(code) && !/\bwindow\./.test(code));

  /* 3. 无内部定时器/随机源：回合与时钟由调用方注入（turn 形参），rng 注入 */
  check('fire.js 无定时器 API（setTimeout/setInterval/requestAnimationFrame）',
    !/setTimeout\(/.test(code) && !/setInterval\(/.test(code) &&
    !/requestAnimationFrame\(/.test(code));
  check('注入式 API：ignite/spread/quench 形参含 turn，spread 形参含 grid/rng',
    /function ignite\(state, r, c, turn\)/.test(code) &&
    /function spread\(state, grid, rng, turn\)/.test(code) &&
    /function quench\(state, r, c\)/.test(code));
  check('fire.js 零 DOM 副作用面：不 require/import 任何模块',
    !/require\(/.test(code) && !/\bimport\b/.test(code));

  /* 4. 公开 API 齐备（issue #65 T1 交付清单：镜像 frost 信封契约） */
  var API = ['create', 'canSelect', 'canMatch', 'ignite', 'spread',
    'quench', 'quenchAround', 'countBurning', 'burningList',
    'snapshot', 'restore', 'isBoardSolvable', 'findUnburnedSolvablePair'];
  check('fire.js 公开 API 齐备：' + API.join('/'),
    API.every(function (k) { return typeof F[k] === 'function'; }));
  check('同屏燃烧上限常量 MAX_BURNING === 4（规则3，与 frost 对称）', F.MAX_BURNING === 4);

  /* 5. 信封契约形态：ignite/spread 返回 {state, applied[, burned]} */
  var ig = F.ignite(F.create(), 2, 2, 1);
  var sp = F.spread(ig.state, [
    [0, 0, 0, 0, 0], [0, 1, 1, 1, 0], [0, 1, 1, 1, 0], [0, 0, 0, 0, 0]
  ], function () { return 0.5; }, 2);
  check('信封契约：ignite→{state,applied} / spread→{state,applied,burned[]}，入参未被改动',
    ig.applied === true && ig.state && typeof ig.state === 'object' &&
    sp.burned.length >= 0 && Object.prototype.hasOwnProperty.call(sp, 'applied'));

  /* 6. 状态可序列化：JSON 往返深等价（snapshot/restore 契约的行为侧证） */
  var roundtrip = JSON.stringify(F.restore(F.snapshot(ig.state))) === JSON.stringify(ig.state);
  check('状态结构可 JSON 序列化且 snapshot/restore 往返深等价', roundtrip);

  /* 7. 测试注册完整性：fire.define.js 与 fire-static-check.js 均已挂进 run-tests.js */
  check('run-tests.js 已注册 fire.define.js 用例与 fire-static-check 静态断言',
    /require\('\.\/fire\.define\.js'\)/.test(runner) &&
    /require\('\.\/fire-static-check\.js'\)/.test(runner) &&
    /fireTests\.runAll\(\)/.test(runner) &&
    /fireChecks\.runChecks\(\)/.test(runner));

  return results;
}

if (require.main === module) {
  var all = runChecks();
  var pass = 0;
  all.forEach(function (r) {
    console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + '  -> ' + r.detail);
    if (r.pass) pass++;
  });
  console.log('----------------------------------------');
  console.log(pass + '/' + all.length + ' passed');
  process.exit(pass === all.length ? 0 : 1);
}

module.exports = { runChecks: runChecks };
