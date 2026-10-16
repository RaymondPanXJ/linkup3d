/**
 * tests/fire.define.js — 熔火状态层纯函数用例（issue #65 T1）
 * 覆盖规则 1-5 全部边界：不可选中/不可作端点、回合制蔓延与 rng 决定论、
 * 同屏上限 4（ignite/spread 两路）、蔓延终止、消除灭火单次语义、
 * 快照往返、入参不可变、以及 isBoardSolvable 的构造性不可解样例。
 * 运行：node tests/run-tests.js
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../js/fire.js'), require('../js/link3d.js'));
  } else {
    root.FireTests = factory(root.Fire, root.L3D || root.link3d);
  }
})(typeof self !== 'undefined' ? self : this, function (F, L) {
  'use strict';

  function case_(name, pass, detail) {
    return { name: name, pass: !!pass, detail: detail || (pass ? 'ok' : 'FAILED') };
  }

  // 确定性 rng（LCG），同 seed 重放序列一致
  function seeded(seed) {
    var x = seed >>> 0;
    return function () {
      x = (x * 1664525 + 1013904223) >>> 0;
      return x / 4294967296;
    };
  }

  // 扩展网格构造器：内圈 rows×cols 按 fill 函数填值（0=空）
  function makeGrid(rows, cols, fill) {
    var g = [];
    for (var r = 0; r < rows + 2; r++) {
      var row = [];
      for (var c = 0; c < cols + 2; c++) {
        row.push((r === 0 || c === 0 || r === rows + 1 || c === cols + 1) ?
          0 : (fill ? fill(r, c) : 1));
      }
      g.push(row);
    }
    return g;
  }

  // 用例G1 create：空状态、计数 0、列表空
  function g1() {
    var s = F.create();
    return case_('用例G1 create 返回可序列化空状态（计数0/列表空）',
      s && typeof s === 'object' && F.countBurning(s) === 0 &&
      Array.isArray(F.burningList(s)) && F.burningList(s).length === 0);
  }

  // 用例G2 规则1 canSelect/canMatch：燃烧不可选/不可作端点，未燃正常
  function g2() {
    var s = F.ignite(F.create(), 2, 3, 5).state;
    return case_('用例G2 规则1 燃烧格不可选中 / canMatch 任一端点燃烧为 false',
      F.canSelect(s, 2, 3) === false && F.canSelect(s, 2, 4) === true &&
      F.canMatch(s, 2, 3, 4, 4) === false && F.canMatch(s, 4, 4, 2, 3) === false &&
      F.canMatch(s, 1, 1, 4, 4) === true);
  }

  // 用例G3 规则3 ignite 上限：第 4 格起 applied=false 且状态原样
  function g3() {
    var s = F.create();
    var ok = [];
    var i, res;
    for (i = 1; i <= 5; i++) {
      res = F.ignite(s, 1, i, 0);
      ok.push(res.applied);
      s = res.state;
    }
    var frozen5 = F.snapshot(s);
    var denied = F.ignite(s, 4, 4, 9);
    return case_('用例G3 规则3 同屏燃烧上限 4：第5次 ignite applied=false 且状态不变',
      ok.join(',') === 'true,true,true,true,false' && F.countBurning(s) === 4 &&
      denied.applied === false && F.snapshot(denied.state) === frozen5);
  }

  // 用例G4 重复引燃拒绝（applied=false，计数不变）
  function g4() {
    var s = F.ignite(F.create(), 2, 2, 1).state;
    var dup = F.ignite(s, 2, 2, 7);
    return case_('用例G4 重复 ignite 同格 applied=false（回合 at 不被覆盖）',
      dup.applied === false && F.countBurning(dup.state) === 1 &&
      dup.state.burning['2,2'].at === 1);
  }

  // 用例G5 规则2 spread：只引燃正交四邻的占位格（对角/空格不燃；rng 决定子集时只做集合断言）
  function g5() {
    var grid = makeGrid(4, 4, function () { return 1; });
    grid[1][3] = 0; // (1,3) 空格无燃料
    var s = F.ignite(F.create(), 2, 2, 0).state;
    var out = F.spread(s, grid, seeded(7), 1);
    var allowed = { '2,2': 1, '1,2': 1, '3,2': 1, '2,1': 1, '2,3': 1 };
    var keys = Object.keys(out.state.burning);
    var inAllowed = keys.every(function (k) { return allowed[k] === 1; });
    return case_('用例G5 规则2 spread 只吞正交邻占位格（对角不燃、空格不燃、子集在候选内）',
      out.applied === true && out.burned.length === 3 && inAllowed &&
      F.countBurning(out.state) === 4 &&
      out.state.burning['1,3'] === undefined &&
      out.state.burning['3,3'] === undefined && out.state.burning['1,1'] === undefined);
  }

  // 用例G6 规则2 蔓延终止：四邻全空 → applied=false、burned 空、状态原样
  function g6() {
    var grid = makeGrid(4, 4, function () { return 0; });
    grid[2][2] = 1;
    var s = F.ignite(F.create(), 2, 2, 0).state;
    var before = F.snapshot(s);
    var out = F.spread(s, grid, seeded(3), 1);
    return case_('用例G6 规则2 蔓延终止：无可引燃候选 applied=false 且状态原样',
      out.applied === false && out.burned.length === 0 &&
      F.snapshot(out.state) === before);
  }

  // 用例G7 规则3 spread 到限：源+3 候选后触顶，恰停在 MAX_BURNING
  function g7() {
    var grid = makeGrid(4, 4, function () { return 1; });
    var s = F.ignite(F.create(), 2, 2, 0).state; // 四邻 3,2/1,2/2,1/2,3 全占位
    var out = F.spread(s, grid, seeded(11), 1);
    return case_('用例G7 规则3 spread 到上限即止：恰 1+3=4 格燃烧（含源触顶 MAX_BURNING）',
      out.applied === true && out.burned.length === 3 &&
      F.countBurning(out.state) === F.MAX_BURNING && F.MAX_BURNING === 4);
  }

  // 用例G8 rng 决定论：同 seed 两次 spread 逐字节一致；异 seed 允许分叉
  function g8() {
    var grid = makeGrid(6, 6, function () { return 1; });
    var s = F.ignite(F.create(), 3, 3, 0).state;
    var a = F.spread(s, grid, seeded(42), 1);
    var b = F.spread(s, grid, seeded(42), 1);
    var burnedSame = a.burned.map(function (p) { return p.r + ',' + p.c; }).join('|') ===
      b.burned.map(function (p) { return p.r + ',' + p.c; }).join('|');
    return case_('用例G8 决定论：同 seed rng 的 spread 快照与 burned 逐字节一致',
      F.snapshot(a.state) === F.snapshot(b.state) && burnedSame);
  }

  // 用例G9 规则4 quench：燃烧格扑灭 applied=true，未燃格 false
  function g9() {
    var s = F.ignite(F.create(), 2, 2, 0).state;
    var q = F.quench(s, 2, 2);
    var q2 = F.quench(q.state, 2, 2);
    return case_('用例G9 规则4 quench 单格扑灭（燃烧=true / 已灭或从未燃=false）',
      q.applied === true && F.countBurning(q.state) === 0 && q2.applied === false);
  }

  // 用例G10 规则4 quenchAround：四邻燃烧扑灭、同格双邻只灭一次（一次消除=一次扑灭）
  function g10() {
    var s = F.create();
    [[1, 2], [2, 1], [1, 4], [2, 3]].forEach(function (p) {
      s = F.ignite(s, p[0], p[1], 0).state; // 4 格恰触上限
    });
    // 消除 (2,2) 与 (2,4)：正交邻燃烧 = (1,2)(2,1)(2,3)(1,4)；(2,3) 双邻只灭一次
    var out = F.quenchAround(s, 2, 2, 2, 4);
    return case_('用例G10 规则4 quenchAround 扑灭全部正交邻燃烧格（双邻单灭，一次消除=一次扑灭）',
      out.quenched.length === 4 && F.countBurning(out.state) === 0);
  }

  // 用例G10b 规则4 对角保留：被消牌的斜向燃烧格不被扑灭
  function g10b() {
    var s = F.ignite(F.create(), 3, 3, 0).state; // (3,3) 只与 (2,2) 成对角
    var out = F.quenchAround(s, 2, 2, 2, 5);
    return case_('用例G10b 规则4 对角燃烧格不被 quenchAround 扑灭',
      out.quenched.length === 0 && F.countBurning(out.state) === 1);
  }

  // 用例G11 快照往返 + 损坏输入降级 + 部分非法条目丢弃
  function g11() {
    var s = F.ignite(F.create(), 2, 2, 3).state;
    var rt = JSON.stringify(F.restore(F.snapshot(s))) === JSON.stringify(s);
    var junk = F.restore('{oops');
    var partial = F.restore(JSON.stringify({
      burning: { '1,1': { at: 0 }, 'x': { at: 1 }, '2,3': { at: -5 }, '9,9': { at: 1 } }
    }));
    return case_('用例G11 snapshot/restore 往返深等价 / 损坏 JSON 降级空态 / 非法条目丢弃',
      rt && F.countBurning(junk) === 0 &&
      F.countBurning(partial) === 2 && partial.burning['1,1'] !== undefined &&
      partial.burning['9,9'] !== undefined);
  }

  // 用例G12 入参不可变：spread/quenchAround 不修改传入 state 与 grid
  function g12() {
    var grid = makeGrid(4, 4, function () { return 1; });
    var gridJson = JSON.stringify(grid);
    var s = F.ignite(F.create(), 2, 2, 0).state;
    var sJson = F.snapshot(s);
    F.spread(s, grid, seeded(5), 1);
    F.quenchAround(s, 1, 1, 4, 4);
    F.ignite(s, 4, 4, 2);
    return case_('用例G12 不可变：spread/quenchAround/ignite 均不改入参 state 与 grid',
      F.snapshot(s) === sJson && JSON.stringify(grid) === gridJson);
  }

  // 用例G13 规则5 构造性不可解样例：火墙四面包死同牌对 → isBoardSolvable=false；
  // 同一盘面火全灭后可解 → true（火直接把可解盘烧成不可解，检出必须精确）
  function g13() {
    // 内容 4×4：1 在 (2,2) 与 (3,3)，火墙 (1,2)(2,1)(2,3)(3,2) 封死 (2,2) 四邻
    var grid = makeGrid(4, 4, function () { return 0; });
    grid[2][2] = 1; grid[3][3] = 1;
    grid[1][2] = 5; grid[2][1] = 5; grid[2][3] = 5; grid[3][2] = 5;
    var walled = F.create();
    [[1, 2], [2, 1], [2, 3], [3, 2]].forEach(function (p) {
      walled = F.ignite(walled, p[0], p[1], 0).state;
    });
    var blocked = F.isBoardSolvable(walled, grid, L) === false;
    var open = F.isBoardSolvable(F.create(), grid, L) === true;
    var empty = F.isBoardSolvable(F.create(), makeGrid(4, 4, function () { return 0; }), L) === true;
    return case_('用例G13 规则5 构造性样例：火墙包死同牌对判不可解 / 同盘无火可解 / 空盘可解',
      blocked && open && empty);
  }

  // 用例G14 规则5 部分燃烧不误伤：火在旁边但仍有一对可连 → true
  function g14() {
    var grid = makeGrid(4, 4, function () { return 0; });
    grid[1][1] = 7; grid[1][4] = 7; grid[3][3] = 9; grid[4][1] = 9;
    var s = F.ignite(F.create(), 3, 3, 0).state; // 烧掉 (3,3) 的 9
    // 9 只剩一个无法配对，7 未被烧且顶边可绕外圈 → 仍可解
    return case_('用例G14 规则5 火烧单张致孤张：另一对可连时仍判可解（不夸大不可解）',
      F.isBoardSolvable(s, grid, L) === true);
  }

  // 用例G15 findUnburnedSolvablePair：燃烧端点被过滤；无火+同rng 与 L.findSolvablePair 等价
  function g15() {
    var grid = makeGrid(4, 4, function () { return 0; });
    grid[2][2] = 3; grid[2][3] = 3;
    var s = F.ignite(F.create(), 2, 2, 0).state;
    var nullWhenBlocked = F.findUnburnedSolvablePair(s, grid, L.findPath, seeded(1)) === null;
    var none = F.findUnburnedSolvablePair(F.create(), grid, L.findPath, seeded(1));
    var sameAsLink = none && none.value === 3 &&
      JSON.stringify(none.a) === JSON.stringify({ r: 2, c: 2 }) &&
      !!none.path;
    return case_('用例G15 findUnburnedSolvablePair 过滤燃烧端点 / 无火时与 link3d 等价',
      nullWhenBlocked && sameAsLink);
  }

  return {
    runAll: function () {
      return [g1(), g2(), g3(), g4(), g5(), g6(), g7(), g8(),
              g9(), g10(), g10b(), g11(), g12(), g13(), g14(), g15()];
    }
  };
});
