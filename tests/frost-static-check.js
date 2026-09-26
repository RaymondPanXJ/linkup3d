#!/usr/bin/env node
/**
 * tests/frost-static-check.js — 冻冰状态层（frost.js）无浏览器静态断言（issue #27）
 * 验证 UMD 双端导出、纯函数约束（代码不含 document / localStorage / Date.now / window.）、
 * 时间由调用方注入（无内部定时器）、公开 API 齐备、状态结构可序列化，
 * 以及测试注册完整性。模式沿用 T1 campaign-static-check.js。
 *
 * 运行：node tests/run-tests.js 或单独 node tests/frost-static-check.js
 */
var fs = require('fs');
var path = require('path');

function runChecks() {
  var root = path.join(__dirname, '..');
  var frost = fs.readFileSync(path.join(root, 'js', 'frost.js'), 'utf8');
  var runner = fs.readFileSync(path.join(root, 'tests', 'run-tests.js'), 'utf8');
  var F = require('../js/frost.js');

  var results = [];
  function check(name, cond, detail) {
    results.push({ name: name, pass: !!cond, detail: detail || (cond ? 'ok' : 'FAILED') });
  }

  /* 1. UMD 双端导出（与 ranking.js / campaign.js 同构） */
  check('frost.js UMD：浏览器 window.Frost + Node module.exports',
    /root\.Frost = factory\(\)/.test(frost) &&
    /module\.exports = factory\(\)/.test(frost) &&
    /typeof self !== 'undefined' \? self : this/.test(frost));

  /* 2. 纯函数约束：代码（去注释后）不含 DOM / 存储 / 时钟 / 全局对象直接依赖 */
  function stripComments(src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  }
  var code = stripComments(frost);
  check('frost.js 代码不含 DOM/localStorage/Date.now/window. 直接依赖',
    !/\bdocument\b/.test(code) && !/\blocalStorage\b/.test(code) &&
    !/Date\.now\(/.test(code) && !/\bwindow\./.test(code));

  /* 3. 无内部定时器：时间一律由调用方注入（now / durationMs 参数） */
  check('frost.js 无定时器 API（setTimeout/setInterval/requestAnimationFrame）',
    !/setTimeout\(/.test(code) && !/setInterval\(/.test(code) &&
    !/requestAnimationFrame\(/.test(code));
  check('时间注入式 API：telegraph/freeze/isTelegraphActive 形参含 now',
    /function telegraph\(state, r, c, now, durationMs\)/.test(code) &&
    /function freeze\(state, r, c, now\)/.test(code) &&
    /function isTelegraphActive\(state, r, c, now\)/.test(code));

  /* 4. 公开 API 齐备（issue #27 交付清单） */
  var API = ['create', 'canSelect', 'canMatch', 'telegraph', 'isTelegraphActive',
    'freeze', 'thawAround', 'countFrozen', 'frozenList', 'snapshot', 'restore',
    'isBoardSolvable'];
  check('frost.js 公开 API 齐备：' + API.join('/'),
    API.every(function (k) { return typeof F[k] === 'function'; }));
  check('同屏冰冻上限常量 MAX_FROZEN === 4（规则4）', F.MAX_FROZEN === 4);

  /* 5. 状态可序列化：JSON 往返深等价（snapshot/restore 契约的行为侧证） */
  var s = F.telegraph(F.create(), 2, 3, 1000, 3000);
  var fr = F.freeze(s, 2, 3, 4000);
  var roundtrip = JSON.stringify(F.restore(F.snapshot(fr.state))) === JSON.stringify(fr.state);
  check('状态结构可 JSON 序列化且 snapshot/restore 往返深等价', roundtrip);

  /* 6. 规则硬约束的行为侧证：上限 4 / 正交四邻不含对角 */
  var cap = fr.state;
  var skipped = 0;
  for (var c = 4; c <= 7; c++) {
    var t = F.telegraph(cap, 2, c, 5000, 1000);
    var res = F.freeze(t, 2, c, 6000);
    if (res.applied) cap = res.state; else skipped++;
  }
  check('行为侧证：同屏冻结封顶 4 个，第 5 个起 applied=false',
    F.countFrozen(cap) === 4 && skipped === 1);
  var diag = { frozen: { '2,2': { at: 1 }, '3,2': { at: 2 } }, telegraphs: {} };
  var thawed = F.thawAround(diag, 2, 3, 9, 9);
  check('行为侧证：thawAround 解冻正交邻 (2,2)，保留对角 (3,2)（规则2不含对角）',
    F.canSelect(thawed, 2, 2) === true && F.canSelect(thawed, 3, 2) === false);

  /* 7. 测试注册：新用例与静态断言已挂入 run-tests.js */
  check('run-tests.js 注册 frost.define / frost-static-check',
    /require\('\.\/frost\.define\.js'\)/.test(runner) &&
    /require\('\.\/frost-static-check\.js'\)/.test(runner) &&
    /frostTests\.runAll\(\)/.test(runner) &&
    /frostChecks\.runChecks\(\)/.test(runner));

  return results;
}

if (require.main === module) {
  runChecks().forEach(function (r) {
    console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + '  -> ' + r.detail);
  });
}

module.exports = { runChecks: runChecks };
