#!/usr/bin/env node
/**
 * tests/campaign-static-check.js — 战役模块（campaign.js / save.js）无浏览器静态断言（issue #25）
 * 验证 UMD 双端导出、纯函数约束（无 DOM / 无 localStorage / 无 Date.now）、
 * TechLead 基线数据表逐字段一致、存档键与 schema，以及测试注册完整性。
 *
 * 运行：node tests/run-tests.js 或单独 node tests/campaign-static-check.js
 */
var fs = require('fs');
var path = require('path');

function runChecks() {
  var root = path.join(__dirname, '..');
  var campaign = fs.readFileSync(path.join(root, 'js', 'campaign.js'), 'utf8');
  var save = fs.readFileSync(path.join(root, 'js', 'save.js'), 'utf8');
  var runner = fs.readFileSync(path.join(root, 'tests', 'run-tests.js'), 'utf8');
  var C = require('../js/campaign.js');
  var S = require('../js/save.js');

  var results = [];
  function check(name, cond, detail) {
    results.push({ name: name, pass: !!cond, detail: detail || (cond ? 'ok' : 'FAILED') });
  }

  /* 1. UMD 双端导出（与 ranking.js 同构） */
  check('campaign.js UMD：浏览器 window.Campaign + Node module.exports',
    /root\.Campaign = factory\(\)/.test(campaign) &&
    /module\.exports = factory\(\)/.test(campaign) &&
    /typeof self !== 'undefined' \? self : this/.test(campaign));
  check('save.js UMD：浏览器 window.CampaignSave + Node module.exports',
    /root\.CampaignSave = factory\(\)/.test(save) &&
    /module\.exports = factory\(\)/.test(save) &&
    /typeof self !== 'undefined' \? self : this/.test(save));

  /* 2. 纯函数约束：无 DOM、无 localStorage、无 Date.now（时间由调用方注入） */
  function stripComments(src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  }
  ['campaign', 'save'].forEach(function (name, i) {
    var src = stripComments(i === 0 ? campaign : save);
    check(name + '.js 代码不含 DOM/localStorage/Date.now 直接依赖',
      !/\bdocument\b/.test(src) && !/\blocalStorage\b/.test(src) &&
      !/Date\.now\(/.test(src) && !/\bwindow\./.test(src));
  });

  /* 3. TechLead 基线数据表逐字段一致（T2-T8 依赖，不得漂移） */
  var baseline = [
    [0, '冷眠醒转', 4, 4, 8, 0, 60, 0, null],
    [1, '微光航道', 4, 6, 12, 180, 90, 0, null],
    [2, '霜纹初现', 4, 6, 12, 180, 100, 2, null],
    [3, '巡猎初鸣', 4, 6, 12, 240, 150, 0, [25000, 3000]],
    [4, '冰湖', 4, 6, 12, 240, 150, 0, [20000, 3000]],
    [5, '双子冰缝', 6, 8, 24, 300, 200, 4, null],
    [6, '极夜', 6, 8, 24, 360, 240, 0, [30000, 3000]],
    [7, '白毛风', 6, 8, 24, 360, 260, 0, [22000, 3000]],
    [8, '冰下回声', 6, 8, 24, 420, 300, 2, [18000, 3000]],
    [9, '星核之眼', 6, 8, 24, 480, 340, 0, [15000, 2500]]
  ];
  var mismatch = '';
  baseline.forEach(function (b) {
    var d = C.LEVELS[b[0]];
    if (!d) { mismatch = '缺第' + b[0] + '关'; return; }
    if (d.name !== b[1] || d.rows !== b[2] || d.cols !== b[3] ||
        d.pairs !== b[4] || d.timeLimitSec !== b[5] || d.parSec !== b[6] ||
        d.frost.length !== b[7]) {
      mismatch = '第' + b[0] + '关: ' + JSON.stringify(d);
      return;
    }
    if (b[8] === null ? d.hunter !== null :
        !d.hunter || d.hunter.cadenceMs !== b[8][0] || d.hunter.telegraphMs !== b[8][1]) {
      mismatch = '第' + b[0] + '关 hunter: ' + JSON.stringify(d.hunter);
    }
  });
  check('LEVELS 与 TechLead 基线表逐字段一致（10 关）',
    !mismatch && C.LEVELS.length === 10, mismatch || 'ok');

  /* 4. 数据表整体自检通过 + 公开 API 齐备 */
  var validateOk = true;
  try { C.validateAll(); } catch (e) { validateOk = false; }
  check('campaign.js validateAll 自检通过', validateOk);
  check('campaign.js 公开 API：LEVELS/validateLevel/validateAll/levelAt/isUnlocked/nextLevel/starsFor',
    ['LEVELS', 'validateLevel', 'validateAll', 'levelAt', 'isUnlocked', 'nextLevel', 'starsFor']
      .every(function (k) { return k in C; }));
  check('save.js 公开 API：STORAGE_KEY/SCHEMA_VERSION/initialData/isValidData/load/save/recordResult',
    ['STORAGE_KEY', 'SCHEMA_VERSION', 'initialData', 'isValidData', 'load', 'save', 'recordResult']
      .every(function (k) { return k in S; }));

  /* 5. 存档契约：键名、版本、storage 注入式（save.js 内不出现 localStorage 已在 §2 断言） */
  check("存档键为 'linkup3d.campaign.v1' 且 SCHEMA_VERSION === 1",
    S.STORAGE_KEY === 'linkup3d.campaign.v1' && S.SCHEMA_VERSION === 1);
  check('存档条目字段为 stars/bestScore/bestTimeSec',
    /stars: e\.stars, bestScore: e\.bestScore, bestTimeSec: e\.bestTimeSec/.test(save));

  /* 6. 测试注册：三套新用例已挂入 run-tests.js */
  check('run-tests.js 注册 campaign.define / save.define / campaign-static-check',
    /require\('\.\/campaign\.define\.js'\)/.test(runner) &&
    /require\('\.\/save\.define\.js'\)/.test(runner) &&
    /require\('\.\/campaign-static-check\.js'\)/.test(runner) &&
    /campaignTests\.runAll\(\)/.test(runner) &&
    /saveTests\.runAll\(\)/.test(runner) &&
    /campaignChecks\.runChecks\(\)/.test(runner));

  return results;
}

if (require.main === module) {
  runChecks().forEach(function (r) {
    console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + '  -> ' + r.detail);
  });
}

module.exports = { runChecks: runChecks };
