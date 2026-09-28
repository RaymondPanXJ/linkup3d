#!/usr/bin/env node
/**
 * tests/frost-static-check.js — 冻冰状态层（frost.js）无浏览器静态断言（issue #27）
 * 验证 UMD 双端导出、纯函数约束（代码不含 document / localStorage / Date.now / window.）、
 * 时间由调用方注入（无内部定时器）、公开 API 齐备、状态结构可序列化，
 * 以及测试注册完整性。模式沿用 T1 campaign-static-check.js。
 *
 * 运行：node tests/run-tests.js 或单独 node tests/frost-static-check.js
 */
var readUtf8 = require('./read-utf8.js');
var path = require('path');

function runChecks() {
  var root = path.join(__dirname, '..');
  var frost = readUtf8(path.join(root, 'js', 'frost.js'));
  var runner = readUtf8(path.join(root, 'tests', 'run-tests.js'));
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
  var diag = { frozen: { '2,2': { at: 1, hp: 2 }, '3,2': { at: 2, hp: 2 } }, telegraphs: {} };
  var crackedOnce = F.crackAround(diag, 2, 3, 9, 9); // 第一次邻近消除：正交邻裂冰 hp2→1，对角不裂
  var crackedTwice = F.crackAround(crackedOnce.state, 2, 3, 9, 9); // 第二次：正交邻破裂解冻
  check('行为侧证：crackAround 第一次裂冰不解封(HP=2)，第二次才解冻正交邻 (2,2)，对角 (3,2) 始终保留（规则2不含对角）',
    F.canSelect(crackedOnce.state, 2, 2) === false &&
    F.canSelect(crackedTwice.state, 2, 2) === true &&
    F.canSelect(crackedTwice.state, 3, 2) === false);

  /* 6b. issue #49 HP=2 公开 API 与视觉接线侧证 */
  check('issue #49：crack/crackAround/crackedList/FREEZE_HP=2 公开可用',
    typeof F.crack === 'function' && typeof F.crackAround === 'function' &&
    typeof F.crackedList === 'function' && F.FREEZE_HP === 2);
  var hp2 = { frozen: { '5,5': { at: 1, hp: 2 } }, telegraphs: {} };
  var hp2c = F.crack(hp2, 5, 5);
  check('issue #49：裂纹态（hp=1）仍不可选（渲染层 cracked 变体的行为侧证）',
    hp2c.cracked === true && F.canSelect(hp2c.state, 5, 5) === false &&
    F.crackedList(hp2c.state).length === 1);

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
