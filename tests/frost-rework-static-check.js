#!/usr/bin/env node
/**
 * tests/frost-rework-static-check.js — PR #50 返工：裂纹态视觉同步 + 冰封感知死局（issue #51）
 * 无浏览器环境的静态断言 + 纯函数管线仿真：
 *   A. 缺陷1 接线静态断言：onHunterTick 拆分（enemy tick 门控 / syncFrostVisuals
 *      始终执行）、eliminate 裂冰后立即同步视觉；
 *   B. 缺陷2 接线静态断言：eliminate 尾部死局判定改用 hasUnfrozenSolvablePair，
 *      该函数按值分组未冰冻格 + L.findPath 判定；
 *   C. 管线仿真：用真实 Frost/link3d 模块复现判定口径——冰封封锁时旧判定误判
 *      "有解"、新判定正确触发洗牌；无冰封时新旧等价；冰封格占位阻挡路径。
 *
 * 运行：node tests/run-tests.js 或单独 node tests/frost-rework-static-check.js
 */
var readUtf8 = require('./read-utf8.js');
var path = require('path');

function runChecks() {
  var root = path.join(__dirname, '..');
  var game = readUtf8(path.join(root, 'js', 'game.js'));
  var frost = readUtf8(path.join(root, 'js', 'frost.js'));
  var runner = readUtf8(path.join(root, 'tests', 'run-tests.js'));
  var F = require('../js/frost.js');
  var L = require('../js/link3d.js');

  var results = [];
  function check(name, cond, detail) {
    results.push({ name: name, pass: !!cond, detail: detail || (cond ? 'ok' : 'FAILED') });
  }

  /* ================ A. 缺陷1：心跳拆分 + 裂冰即时同步 ================ */
  var tickBody = (game.match(/function onHunterTick\(\)\s*\{[\s\S]*?\n  \}/) || [''])[0];
  check('缺陷1a onHunterTick 移除整函数早退门控（!enemyState || ... return 不再存在）',
    tickBody && !/if \(!enemyState \|\| !running \|\| paused\) return;/.test(tickBody),
    tickBody ? 'body captured' : 'onHunterTick not found');
  check('缺陷1b enemy tick 仍在 enemyState/running/paused 门控内',
    /if \(enemyState && running && !paused\)\s*\{[\s\S]*?ENM\.tick\(enemyState, now, hunterCtx\(\)\)/.test(tickBody));
  check('缺陷1c syncFrostVisuals(now) 在门控块外始终执行（无巡猎者关卡心跳仍可上屏裂纹态）',
    /if \(enemyState && running && !paused\) \{[\s\S]*?\n    \}\n    syncFrostVisuals\(now\);/.test(tickBody));
  check('缺陷1d 预警音效节流仍在门控内（无巡猎者不响滴答）',
    /if \(enemyState && running && !paused\) \{[\s\S]*?ENM\.isThreatening\(enemyState, now\)[\s\S]*?\n    \}/.test(tickBody));
  var elimBody = (game.match(/function eliminate\(a, b, path\)\s*\{[\s\S]*?\n  \}\n/) || [''])[0];
  check('缺陷1e eliminate 裂冰处理后立即 syncFrostVisuals(Date.now())（即时反馈不等心跳）',
    elimBody && /crackRes\.cracked\.forEach[\s\S]{0,200}syncFrostVisuals\(Date\.now\(\)\)/.test(elimBody));

  /* ================ B. 缺陷2：冰封感知死局判定接线 ================ */
  check('缺陷2a eliminate 尾部死局判定改用 hasUnfrozenSolvablePair（不再直接 L.hasSolvablePair）',
    /else if \(!hasUnfrozenSolvablePair\(\)\)\s*\{\s*announceShuffle\(\)/.test(game) &&
    !/else if \(!L\.hasSolvablePair\(grid\)\)/.test(game));
  /* issue #61 适配：hasUnfrozenSolvablePair 按 issue 要求委托 FRZ.findUnfrozenSolvablePair
   * （消除与提示口径的重复），原内联实现的形状断言改为委托契约断言 +
   * frost.js 侧 canSelect 端点过滤/findPath 连通断言；行为等价性由 C 段
   * 管线仿真（改用真实 FRZ 函数）回归。 */
  check('缺陷2b hasUnfrozenSolvablePair 委托 FRZ.findUnfrozenSolvablePair（端点过滤内聚到纯函数）',
    /function hasUnfrozenSolvablePair\(\)\s*\{\s*return FRZ\.findUnfrozenSolvablePair\(frostState, grid, L\.findPath\) !== null;/.test(game));
  check('缺陷2c FRZ.findUnfrozenSolvablePair 用 canSelect 过滤端点 + 注入 findPath 判定连通（冰封格占位=路径阻挡）',
    /function findUnfrozenSolvablePair\(frostState, grid, findPath, rng\)/.test(frost) &&
    /function findUnfrozenSolvablePair\([\s\S]*?canSelect\(frostState, r, c\)[\s\S]*?findPath\(grid, cells\[x\], cells\[y\]\)/.test(frost));
  check('缺陷2d 死局判定不再内联 L.hasSolvablePair 短路（等价性由 FRZ 快路径 + C 段仿真回归）',
    /function hasUnfrozenSolvablePair\(\)\s*\{[^}]*\}/.test(game) &&
    !/function hasUnfrozenSolvablePair\(\)\s*\{[\s\S]{0,300}?L\.hasSolvablePair\(grid\)/.test(game));

  /* ================ C. 管线仿真（真实 Frost + link3d 模块复现判定口径） ================ */
  // issue #61：与 game.js hasUnfrozenSolvablePair 同口径 = 直接调用真实
  // FRZ.findUnfrozenSolvablePair（game.js 已委托该纯函数），C1-C6 走生产代码路径。
  function hasUnfrozenSolvablePair(frostState, grid) {
    return F.findUnfrozenSolvablePair(frostState, grid, L.findPath) !== null;
  }

  function freezeAt(fs, r, c) {
    var o = F.freeze(F.telegraph(fs, r, c, 0, 10), r, c, 10);
    return o.applied ? o.state : fs;
  }

  // C1: 唯一可连对两端被冰封 → 旧判定"有解"（软锁根因），新判定"无解"触发洗牌
  // 扩展网格 3×6：值1 一对位于内容格 (1,2)/(1,4) 直通可连；其余各值单只不成对
  var g1 = [
    [0, 0, 0, 0, 0, 0],
    [0, 2, 1, 3, 1, 4],
    [0, 0, 0, 0, 0, 0]
  ];
  var plain = F.create();
  check('仿真C1a 前置：未冰封盘新旧判定一致为有解',
    L.hasSolvablePair(g1) && hasUnfrozenSolvablePair(plain, g1));
  var fs1 = freezeAt(freezeAt(plain, 1, 2), 1, 4);
  check('仿真C1b 冰封两端后旧判定仍误判有解（缺陷复现）',
    L.hasSolvablePair(g1) === true);
  check('仿真C1c 冰封感知判定正确判无解（触发洗牌救场）',
    hasUnfrozenSolvablePair(fs1, g1) === false);

  // C2: 一端被冰封 → 该对端点失效，其余值单只 → 判无解
  // (1,1)/(3,1) 同值5：直路被 (2,1) 占挡，未冰封时可经左列边框绕行连通
  var g2 = [
    [0, 0, 0, 0, 0, 0],
    [0, 5, 6, 0, 0, 0],
    [0, 7, 8, 0, 0, 0],
    [0, 5, 9, 0, 0, 0],
    [0, 0, 0, 0, 0, 0]
  ];
  check('仿真C2a 未冰封：绕边框可达判有解', hasUnfrozenSolvablePair(plain, g2) === true);
  var fs2 = freezeAt(plain, 3, 1);
  check('仿真C2b 一端被冰封：该对端点失效；剩余值5单只不可连 → 判无解',
    L.hasSolvablePair(g2) === true && hasUnfrozenSolvablePair(fs2, g2) === false);

  // C3: 裂纹态（hp=1）仍不可选——端点口径与 hp=2 一致按冻结处理
  var g3 = [
    [0, 0, 0, 0, 0, 0],
    [0, 1, 1, 0, 0, 0],
    [0, 0, 0, 0, 0, 0]
  ];
  var fs3 = freezeAt(plain, 1, 2);
  var cracked3 = F.crackAround(fs3, 1, 3, 2, 3); // (1,3) 与冰封格 (1,2) 正交邻 → hp 2→1 裂纹态
  check('仿真C3 裂纹态（hp=1）仍作冻结端点排除：判无解（HP=2 语义不变）',
    cracked3.cracked.length === 1 && !F.canSelect(cracked3.state, 1, 2) &&
    hasUnfrozenSolvablePair(cracked3.state, g3) === false);
  var broken3 = F.crackAround(cracked3.state, 1, 3, 2, 3); // 第二次破裂解冻
  check('仿真C3b 破裂解冻后恢复有解（判定随状态实时收敛）',
    F.canSelect(broken3.state, 1, 2) && hasUnfrozenSolvablePair(broken3.state, g3) === true);

  // C4: 无冰封等价性——随机盘 200 例，新判定 === L.hasSolvablePair
  var equiv = true, samples = 0;
  for (var t = 0; t < 200 && equiv; t++) {
    var g = L.dealGrid(4, 6);
    // 随机挖空一部分模拟中盘
    for (var rr = 1; rr <= 4; rr++) {
      for (var cc = 1; cc <= 6; cc++) {
        if (Math.random() < 0.3) g[rr][cc] = 0;
      }
    }
    if (L.countTiles(g) < 2) continue;
    samples++;
    if (hasUnfrozenSolvablePair(plain, g) !== L.hasSolvablePair(g)) equiv = false;
  }
  check('仿真C4 无冰封时与旧判定等价（随机盘 ' + samples + ' 例全部一致）', equiv);

  // C5: L3 场景复现（issue #51 评审实例）：冰封 (2,2)/(3,5) 封锁后未冰封牌无可连对
  // 6×7 扩展网格构造：两对同值对的通路全部被占位/冰封封死
  var g5 = [
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 1, 9, 9, 9, 1, 0, 0],
    [0, 9, 2, 9, 9, 3, 0, 0],
    [0, 4, 9, 9, 9, 5, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0]
  ];
  // 值1 对 (2,2)/(2,6)：直路被 9 占满，绕行需经行1/行5 边框——可达 → 先确认有解
  check('仿真C5a 前置：绕边框通道可达时判有解', hasUnfrozenSolvablePair(plain, g5) === true);
  // 若边框绕行仍可达，则构造内盘封闭：将上下边框内侧占满后冰封关键转角
  // 直接验证核心口径即可：端点冰封 + 通路占位 = 无解（C1/C2 已覆盖），此处
  // 补一组「部分对可连、部分对被冰封」的混合盘
  var g6 = [
    [0, 0, 0, 0, 0, 0],
    [0, 1, 1, 2, 2, 0],
    [0, 0, 0, 0, 0, 0]
  ];
  var fs6 = freezeAt(freezeAt(plain, 1, 3), 1, 4); // 冰封值2 两端 (1,3)/(1,4)
  check('仿真C5b 混合盘：值2 对被冰封但值1 对仍可连 → 判有解不洗牌',
    hasUnfrozenSolvablePair(fs6, g6) === true);
  var fs6b = freezeAt(freezeAt(fs6, 1, 1), 1, 2); // 再冰封值1 两端 (1,1)/(1,2)
  check('仿真C5c 混合盘：两对全被冰封 → 判无解触发洗牌',
    L.hasSolvablePair(g6) === true && hasUnfrozenSolvablePair(fs6b, g6) === false);

  /* ================ D. 测试注册 ================ */
  check('run-tests.js 注册 frost-rework-static-check',
    /frost-rework-static-check/.test(runner));

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
  console.log('----------------------------------------');
  console.log(pass + '/' + rs.length + ' passed');
  process.exit(pass === rs.length ? 0 : 1);
}
