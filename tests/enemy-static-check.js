#!/usr/bin/env node
/**
 * tests/enemy-static-check.js — 巡猎者大脑（enemy.js）无浏览器静态断言（issue #29）
 * 验证 UMD 双端导出、纯函数约束（代码不含 document / localStorage / Date.now / window.）、
 * 无内部定时器（时间由调用方注入）、无内置随机源（Math.random 禁入，rng 一律 ctx 注入）、
 * 公开 API 齐备、事件词汇表与 TechLead 时序契约一致、状态结构可序列化、
 * campaign.js 关卡 hunter 数据表未被改动，以及测试注册完整性。
 * 模式沿用 T1 campaign-static-check.js / T2 frost-static-check.js。
 *
 * 运行：node tests/run-tests.js 或单独 node tests/enemy-static-check.js
 */
var fs = require('fs');
var path = require('path');

function runChecks() {
  var root = path.join(__dirname, '..');
  var enemy = fs.readFileSync(path.join(root, 'js', 'enemy.js'), 'utf8');
  var campaign = fs.readFileSync(path.join(root, 'js', 'campaign.js'), 'utf8');
  var runner = fs.readFileSync(path.join(root, 'tests', 'run-tests.js'), 'utf8');
  var E = require('../js/enemy.js');

  var results = [];
  function check(name, cond, detail) {
    results.push({ name: name, pass: !!cond, detail: detail || (cond ? 'ok' : 'FAILED') });
  }

  /* 1. UMD 双端导出（与 frost.js / campaign.js 同构） */
  check('enemy.js UMD：浏览器 window.Enemy + Node module.exports',
    /root\.Enemy = factory\(\)/.test(enemy) &&
    /module\.exports = factory\(\)/.test(enemy) &&
    /typeof self !== 'undefined' \? self : this/.test(enemy));

  /* 2. 纯函数约束：代码（去注释后）不含 DOM / 存储 / 时钟 / 全局对象直接依赖 */
  function stripComments(src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  }
  var code = stripComments(enemy);
  check('enemy.js 代码不含 DOM/localStorage/Date.now/window. 直接依赖',
    !/\bdocument\b/.test(code) && !/\blocalStorage\b/.test(code) &&
    !/Date\.now\(/.test(code) && !/\bwindow\./.test(code));

  /* 3. 无内部定时器：节奏一律由调用方按注入 now 驱动（T4 用 rAF/帧循环接线） */
  check('enemy.js 无定时器 API（setTimeout/setInterval/requestAnimationFrame）',
    !/setTimeout\(/.test(code) && !/setInterval\(/.test(code) &&
    !/requestAnimationFrame\(/.test(code));

  /* 4. 无内置随机源：随机必须经 ctx.rng 注入（保证 Node 确定性测试与回放） */
  check('enemy.js 不含 Math.random（随机源一律 ctx.rng 注入）',
    !/Math\.random/.test(code));

  /* 5. 公开 API 齐备（issue #29 交付清单） */
  var API = ['create', 'tick', 'cancelTarget', 'isThreatening', 'snapshot', 'restore'];
  check('enemy.js 公开 API 齐备：' + API.join('/'),
    API.every(function (k) { return typeof E[k] === 'function'; }));

  /* 6. TechLead 时序契约（issue #29）：事件词汇表 telegraph/freeze/skip/cancel，
      tick 形参为 (state, now, ctx)，telegraph 事件携带 untilMs = now + telegraphMs */
  check('契约：tick(state, now, ctx) 注入式签名 + 事件词汇表齐备',
    /function tick\(state, now, ctx\)/.test(code) &&
    /'telegraph'/.test(code) && /'freeze'/.test(code) &&
    /'skip'/.test(code) && /'cancel'/.test(code));
  var ev = E.tick(E.create(10000, 3000, 0), 10000,
    { tiles: { '2,3': true }, rng: function () { return 0; } }).events[0];
  check('行为侧证：到点事件为 telegraph 且 untilMs = now + telegraphMs（规则：先预警后冻结）',
    ev.type === 'telegraph' && ev.r === 2 && ev.c === 3 && ev.untilMs === 13000);

  /* 7. 敌人参数消费 campaign 关卡表 hunter = {cadenceMs, telegraphMs}（issue #26 定稿字段） */
  check('campaign.js 关卡表 hunter 字段口径未漂移（cadenceMs/telegraphMs）',
    /cadenceMs:\s*\d+/.test(campaign) && /telegraphMs:\s*\d+/.test(campaign));

  /* 8. 状态可序列化：JSON 往返深等价（snapshot/restore 契约的行为侧证） */
  var s = E.tick(E.create(10000, 3000, 0), 10000,
    { tiles: { '1,1': true }, rng: function () { return 0; } }).state;
  check('状态结构可 JSON 序列化且 snapshot/restore 往返深等价',
    JSON.stringify(E.restore(E.snapshot(s))) === JSON.stringify(s) &&
    s.cadenceMs === 10000 && s.telegraphMs === 3000 &&
    s.target && s.target.until === 13000);

  /* 9. 测试注册：新用例与静态断言已挂入 run-tests.js */
  check('run-tests.js 注册 enemy.define / enemy-static-check',
    /require\('\.\/enemy\.define\.js'\)/.test(runner) &&
    /require\('\.\/enemy-static-check\.js'\)/.test(runner) &&
    /enemyTests\.runAll\(\)/.test(runner) &&
    /enemyChecks\.runChecks\(\)/.test(runner));

  return results;
}

if (require.main === module) {
  runChecks().forEach(function (r) {
    console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + '  -> ' + r.detail);
  });
}

module.exports = { runChecks: runChecks };
