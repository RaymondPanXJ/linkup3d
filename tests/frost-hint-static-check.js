#!/usr/bin/env node
/**
 * tests/frost-hint-static-check.js — 提示按钮冰封感知（issue #61）
 * 无浏览器环境的静态断言 + 纯函数仿真：
 *   A. 缺陷复现+修复：冰封端点被 FRZ.findUnfrozenSolvablePair 排除、
 *      L.findSolvablePair 同布局下仍返回冰封对子（对照组证明缺陷曾存在）；
 *   B. cracked 态（hp=1）端点同样排除（issue #49 口径）；
 *   C. 无冰封时与 L.findSolvablePair 注入同一 rng 确定性等价；
 *   D. 路径不穿冰封格（describePath 展示的 path 天然绕行）；
 *   E. game.js 接线静态断言：提示 handler 弃用 L.findSolvablePair 改调 FRZ 版本，
 *      hasUnfrozenSolvablePair 已委托同一函数。
 *
 * 运行：node tests/run-tests.js 或单独 node tests/frost-hint-static-check.js
 */
var readUtf8 = require('./read-utf8.js');
var path = require('path');

function runChecks() {
  var root = path.join(__dirname, '..');
  var game = readUtf8(path.join(root, 'js', 'game.js'));
  var F = require('../js/frost.js');
  var L = require('../js/link3d.js');

  var results = [];
  function check(name, cond, detail) {
    results.push({ name: name, pass: !!cond, detail: detail || (cond ? 'ok' : 'FAILED') });
  }

  function freezeAt(fs, r, c) {
    var o = F.freeze(F.telegraph(fs, r, c, 0, 10), r, c, 10);
    return o.applied ? o.state : fs;
  }
  function pathHits(pathPts, r, c) {
    return pathPts.some(function (p) { return p.r === r && p.c === c; });
  }

  /* ===== 布局（扩展网格 6×6 = 内容 4×4，issue 要求 4×4 盘面） =====
   * 值1 一对 (1,1)/(1,4) 同行直通（途经 (1,2)(1,3) 空）；
   * 值2 两对：(3,1)/(3,4) 直通，(4,1)/(4,4) 经边框 2 转弯可达。
   * 总牌数 6（偶数），全值成对。 */
  function makeGrid() {
    var g = L.createGrid(4, 4);
    g[1][1] = 1; g[1][4] = 1;
    g[3][1] = 2; g[3][4] = 2;
    g[4][1] = 2; g[4][4] = 2;
    return g;
  }

  /* ================ A. 缺陷复现 + 修复：冰封端点排除 ================ */
  // A-复现布局：值1 一对 (1,2)/(1,4) 是唯一可连对（其余值单只不成对），
  // L.findSolvablePair（默认 Math.random）也必然返回它 → 冰封后对照组确定性复现缺陷。
  var gCtrl = [
    [0, 0, 0, 0, 0, 0],
    [0, 0, 1, 0, 1, 0],
    [0, 2, 0, 0, 0, 3],
    [0, 0, 0, 0, 0, 0]
  ];
  var fsCtrl = freezeAt(F.create(), 1, 2);
  var ctrl = L.findSolvablePair(gCtrl);
  check('A1 对照组：L.findSolvablePair 无视冰封返回含被冻端点的对子（缺陷存在证明）',
    ctrl && ctrl.value === 1 &&
    (!F.canSelect(fsCtrl, ctrl.a.r, ctrl.a.c) || !F.canSelect(fsCtrl, ctrl.b.r, ctrl.b.c)),
    ctrl ? 'value=' + ctrl.value + ' pair=(' + ctrl.a.r + ',' + ctrl.a.c + ')-(' + ctrl.b.r + ',' + ctrl.b.c + ')' : 'null');
  check('A1b 修复后同布局 FRZ 版返回 null（不再高亮玩家点不了的对子）',
    F.findUnfrozenSolvablePair(fsCtrl, gCtrl, L.findPath) === null);

  var grid = makeGrid();
  var fs = freezeAt(freezeAt(F.create(), 1, 1), 1, 4); // 值1对两端全部冰封 → 玩家点不了
  var pair = F.findUnfrozenSolvablePair(fs, grid, L.findPath);
  check('A2 FRZ.findUnfrozenSolvablePair 返回非空且两端点均可选',
    pair && F.canSelect(fs, pair.a.r, pair.a.c) && F.canSelect(fs, pair.b.r, pair.b.c),
    pair ? 'value=' + pair.value : 'null');
  check('A3 返回对子结构与 L.findSolvablePair 同构（a/b/value/path 字段）',
    pair && pair.a && pair.b && typeof pair.value === 'number' && Array.isArray(pair.path));
  check('A4 冰封唯一可连对的全部端点后仍可为其余值配对（冰封格占位不影响其他对）',
    pair && pair.value === 2);

  /* 冰封推进到死局（gCtrl 布局，受 MAX_FROZEN=4 约束）：值1对两端全冰封 → 无解 */
  var fsDead = freezeAt(freezeAt(F.create(), 1, 2), 1, 4);
  check('A5 唯一可连对两端冰封后：FRZ 版返回 null（死局，与 hasUnfrozenSolvablePair 口径一致，触发洗牌）',
    F.findUnfrozenSolvablePair(fsDead, gCtrl, L.findPath) === null);
  check('A6 对照组：死局盘面 L.findSolvablePair 仍误报有解（旧口径软锁根因）',
    L.findSolvablePair(gCtrl) !== null);

  /* ================ B. cracked（hp=1）端点排除（issue #49 口径） ================ */
  var cracked = F.crack(fs, 1, 1).state; // hp 2→1 裂纹态
  check('B1 前置：crack 后 (1,1) 为裂纹态且仍不可选',
    F.canSelect(cracked, 1, 1) === false &&
    F.crackedList(cracked).some(function (p) { return p.r === 1 && p.c === 1; }));
  var pairB = F.findUnfrozenSolvablePair(cracked, grid, L.findPath);
  check('B2 cracked 态端点同样被排除（返回值不含裂纹格）',
    pairB && pairB.value === 2 &&
    !(pairB.a.r === 1 && pairB.a.c === 1) && !(pairB.b.r === 1 && pairB.b.c === 1),
    pairB ? 'value=' + pairB.value : 'null');

  /* ================ C. 无冰封时与 L.findSolvablePair 确定性等价 ================ */
  function makeRng(seed) {
    var t = seed >>> 0;
    return function () {
      t = (t * 1664525 + 1013904223) >>> 0;
      return t / 4294967296;
    };
  }
  var gridPlain = makeGrid();
  var same = true, det = true;
  for (var seed = 1; seed <= 100; seed++) {
    var p1 = L.findSolvablePair(gridPlain, makeRng(seed));
    var p2 = F.findUnfrozenSolvablePair(F.create(), gridPlain, L.findPath, makeRng(seed));
    if (JSON.stringify(p1) !== JSON.stringify(p2)) same = false;
  }
  for (var s2 = 1; s2 <= 30; s2++) { // 同 rng 重放确定性
    var q1 = F.findUnfrozenSolvablePair(F.create(), gridPlain, L.findPath, makeRng(7));
    var q2 = F.findUnfrozenSolvablePair(F.create(), gridPlain, L.findPath, makeRng(7));
    if (JSON.stringify(q1) !== JSON.stringify(q2)) det = false;
  }
  check('C1 无冰封：注入同一 rng 时 FRZ 版与 L.findSolvablePair 返回逐 seed 深等价（100 seeds）', same);
  check('C2 同 rng 重放确定性（结构含 a/b/value/path 全等）', det);
  var full = L.createGrid(4, 4); // 空白盘 → 双方均 null
  check('C3 空白盘双方均为 null',
    L.findSolvablePair(full) === null &&
    F.findUnfrozenSolvablePair(F.create(), full, L.findPath) === null);

  /* ================ D. 路径不穿冰封格 ================ */
  var gridD = makeGrid();
  var fsD = freezeAt(F.create(), 2, 1); // (2,1) 在值2对 (3,1)-(4,1) 的直连列上，占位阻断直连
  var pairD = F.findUnfrozenSolvablePair(fsD, gridD, L.findPath);
  check('D1 冰封格占位使路径绕行：返回值非空且路径不经过任何冰封格',
    pairD && pairD.path.every(function (pt) {
      return !(pt.r === 2 && pt.c === 1);
    }),
    pairD ? JSON.stringify(pairD.path) : 'null');
  var fsD2 = freezeAt(freezeAt(F.create(), 1, 1), 1, 4); // 值1对两端冰封
  var pairD2 = F.findUnfrozenSolvablePair(fsD2, gridD, L.findPath);
  check('D2 提示路径端点绕开全部冰封格（describePath 输入即该 path，不再误导）',
    pairD2 && pairD2.path.every(function (pt) { return F.canSelect(fsD2, pt.r, pt.c) || gridD[pt.r][pt.c] === 0; }));

  /* ================ E. game.js 接线静态断言 ================ */
  var hintHandler = (game.match(/hintBtn\.addEventListener\('click'[\s\S]*?\n  \}\);/) || [''])[0];
  check('E1 提示 handler 不再直接调用 L.findSolvablePair',
    hintHandler.length > 0 && !/L\.findSolvablePair\(/.test(hintHandler));
  check('E2 提示 handler 改调 FRZ.findUnfrozenSolvablePair(frostState, grid, L.findPath)',
    /FRZ\.findUnfrozenSolvablePair\(frostState, grid, L\.findPath\)/.test(hintHandler));
  check('E3 提示无解时静默返回不消耗次数（hintsLeft-- 在 pair 判空之后）',
    /if \(!pair\) return;[\s\S]*?hintsLeft--/.test(hintHandler));
  check('E4 提示高亮/describePath 沿用返回的 pair.path（天然绕开冰封格）',
    /Hint\.describePath\(pair\.path, grid\)/.test(hintHandler) &&
    /slots\[pair\.a\.r/.test(hintHandler));
  check('E5 hasUnfrozenSolvablePair 已委托 FRZ.findUnfrozenSolvablePair（与提示同一口径）',
    /function hasUnfrozenSolvablePair\(\)\s*\{\s*return FRZ\.findUnfrozenSolvablePair\(frostState, grid, L\.findPath\) !== null;/.test(game));
  check('E6 game.js 全文不再调用 L.findSolvablePair（提示是唯一调用点）',
    !/L\.findSolvablePair\(/.test(game));
  check('E7 FRZ 公开 API 新增 findUnfrozenSolvablePair 且既有签名零改动',
    typeof F.findUnfrozenSolvablePair === 'function' &&
    F.findUnfrozenSolvablePair.length === 4 &&
    F.canSelect.length === 4 - 1 && F.frozenList.length === 1);

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
