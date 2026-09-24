#!/usr/bin/env node
/**
 * tests/hint.define.js — 提示系统 describePath 与引导状态机纯函数用例（issue #16）
 * 运行：node tests/run-tests.js
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../js/link3d.js'), require('../js/hint.js'));
  } else {
    root.HintTests = factory(root.Link3D, root.Hint);
  }
})(typeof self !== 'undefined' ? self : this, function (L, H) {
  'use strict';

  function case_(name, pass, detail) {
    return { name: name, pass: !!pass, detail: detail || (pass ? 'ok' : 'FAILED') };
  }

  function throwsError(fn) {
    try { fn(); return false; } catch (e) { return e instanceof Error; }
  }

  // 用例H1 直线：同行直连，无绕行
  function h1() {
    var g = L.createGrid();
    g[1][1] = 1; g[1][3] = 1; // (1,2) 为空
    var p = L.findPath(g, { r: 1, c: 1 }, { r: 1, c: 3 });
    var d = H.describePath(p, g);
    return case_('用例H1 直线路径 → 「直线连接」',
      d === '直线连接', JSON.stringify(p) + ' -> ' + d);
  }

  // 用例H2 一次转弯：L 形
  function h2() {
    var g = L.createGrid();
    g[1][1] = 1; g[3][3] = 1;
    // 清出 L 形通道：经拐点 (1,3)
    var p = L.findPath(g, { r: 1, c: 1 }, { r: 3, c: 3 });
    var d = H.describePath(p, g);
    var expectTurns = p.length === 3;
    return case_('用例H2 一次转弯路径 → 「一次转弯连接」',
      expectTurns && d === '一次转弯连接',
      JSON.stringify(p) + ' -> ' + d);
  }

  // 用例H3 两次转弯（不碰外框）：同行被挡、向上被挡，只能经场内空行绕行
  function h3() {
    // 扩展网格 6x8（内容区 4x6）。a=(2,2) b=(2,5) 同行被 (2,3),(2,4) 挡；
    // 上侧被 (1,2)(1,3)(1,4)(1,5) 挡死，外框角经 (1,1)(1,6) 的接近也被挡，
    // 只能经场内空行 r=3 两转弯绕行
    var g = L.createGrid(4, 6);
    g[2][2] = 1; g[2][5] = 1;
    g[2][3] = 2; g[2][4] = 2;
    g[1][2] = 4; g[1][3] = 4; g[1][4] = 4; g[1][5] = 4;
    g[1][1] = 5; g[1][6] = 5;
    var a = { r: 2, c: 2 }, b = { r: 2, c: 5 };
    var p = L.findPath(g, a, b);
    var d = H.describePath(p, g);
    var turns = 0;
    for (var t = 1; t < p.length - 1; t++) {
      var dp = p[t - 1].r === p[t].r ? 'h' : 'v';
      var dn = p[t + 1].r === p[t].r ? 'h' : 'v';
      if (dp !== dn) turns++;
    }
    var inField = p.every(function (pt) {
      return pt.r >= 1 && pt.r <= 4 && pt.c >= 1 && pt.c <= 6;
    });
    return case_('用例H3 两次转弯（场内）→ 「两次转弯连接」且无绕行标注',
      turns === 2 && inField && d === '两次转弯连接',
      JSON.stringify(p) + ' -> ' + d);
  }

  // 用例H4 绕外框：同行两端被挡，经边框行 r=0 绕行
  function h4() {
    var g = L.createGrid();
    g[1][1] = 1; g[1][4] = 1;
    g[1][2] = 2; g[1][3] = 2; // 挡住直线
    var p = L.findPath(g, { r: 1, c: 1 }, { r: 1, c: 4 });
    var d = H.describePath(p, g);
    var usesRow0 = p.some(function (pt) { return pt.r === 0; }) ||
      p.some(function (pt) { return pt.c === 0 || pt.c === 7; });
    return case_('用例H4 绕行外框 → 描述含「绕行棋盘外框」',
      usesRow0 && d === '两次转弯连接，绕行棋盘外框',
      JSON.stringify(p) + ' -> ' + d);
  }

  // 用例H5 边框坐标转换：经过 r=rows+1 / c=cols+1 一侧，仅当传入 grid 时可判定
  function h5() {
    // 4x6 内容区（扩展网格 6x8）：手工构造经 r=5（rows+1）远侧边框绕行的路径
    // （引擎按扫描序会优先近侧 r=0 边框，远侧绕行需直接给 describePath 验证）
    var g = L.createGrid(4, 6);
    g[4][2] = 1; g[4][5] = 1;
    var p = [{ r: 4, c: 2 }, { r: 5, c: 2 }, { r: 5, c: 5 }, { r: 4, c: 5 }];
    var farSide = p.some(function (pt) { return pt.r >= 5 || pt.c >= 7; });
    var withGrid = H.describePath(p, g);
    var noGrid = H.describePath(p);
    // 无 grid 时 r=5/c=7 一侧无法辨认（仅 r<=0||c<=0 可辨），应判定为不绕行
    return case_('用例H5 边框远侧绕行：传 grid 可判定，不传则按 0 侧规则',
      farSide && withGrid === '两次转弯连接，绕行棋盘外框' &&
      noGrid === '两次转弯连接',
      JSON.stringify(p) + ' with=' + withGrid + ' without=' + noGrid);
  }

  // 用例H6 非法路径报错：点数不足 / 坐标非法 / 斜线段 / 转弯>2 / 全部重合
  function h6() {
    var e1 = throwsError(function () { H.describePath([]); });
    var e2 = throwsError(function () { H.describePath([{ r: 1, c: 1 }]); });
    var e3 = throwsError(function () { H.describePath(null); });
    var e4 = throwsError(function () {
      H.describePath([{ r: 1, c: 1 }, { r: 1.5, c: 2 }]);
    });
    var e5 = throwsError(function () {
      H.describePath([{ r: 1, c: 1 }, { r: 2, c: 3 }]); // 斜线段
    });
    var e6 = throwsError(function () {
      H.describePath([{ r: 1, c: 1 }, { r: 1, c: 3 }, { r: 3, c: 3 },
        { r: 3, c: 5 }, { r: 4, c: 5 }]); // 三转弯
    });
    var e7 = throwsError(function () {
      H.describePath([{ r: 2, c: 2 }, { r: 2, c: 2 }]); // 全部重合
    });
    var e8 = throwsError(function () {
      H.describePath([{ r: 1, c: 1 }, { r: 1 }]); // 缺 c 字段
    });
    var ok = e1 && e2 && e3 && e4 && e5 && e6 && e7 && e8;
    return case_('用例H6 非法路径一律抛 Error（8 种畸形输入）', ok,
      [e1, e2, e3, e4, e5, e6, e7, e8].join(','));
  }

  // 用例H7 与真实引擎集成：随机对局中所有 findSolvablePair 路径均可描述
  function h7() {
    var ok = true, detail = '';
    for (var t = 0; t < 30 && ok; t++) {
      var g = L.dealGrid(4, 6);
      var guard = 0;
      while (L.countTiles(g) > 0) {
        if (++guard > 500) { ok = false; detail = '未收敛'; break; }
        var pair = L.findSolvablePair(g);
        if (!pair) { L.shuffleGrid(g); continue; }
        var d;
        try { d = H.describePath(pair.path, g); } catch (e) {
          ok = false; detail = 'describePath 抛错: ' + e.message; break;
        }
        if (!/^(直线连接|一次转弯连接|两次转弯连接)(，绕行棋盘外框)?$/.test(d)) {
          ok = false; detail = '描述格式异常: ' + d; break;
        }
        g[pair.a.r][pair.a.c] = 0;
        g[pair.b.r][pair.b.c] = 0;
      }
    }
    return case_('用例H7 30 局随机对局全部路径可描述（格式稳定）', ok,
      ok ? '30 局全部通过' : detail);
  }

  // 用例H8 引导状态机：next 从 1 走到 4 后归 0；步数 = 4
  function h8() {
    var s = 1, seq = [];
    for (var i = 0; i < 4; i++) { s = H.nextStep(s, 'next'); seq.push(s); }
    var ok = H.STEPS.length === 4 && seq.join(',') === '2,3,4,0';
    return case_('用例H8 nextStep：1→2→3→4→0（共 4 步）', ok, seq.join('→'));
  }

  // 用例H9 引导状态机：skip 任意步归 0；非法 step/action 抛错
  function h9() {
    var skipAll = [1, 2, 3, 4].every(function (s) { return H.nextStep(s, 'skip') === 0; });
    var badStep = throwsError(function () { H.nextStep(9, 'next'); });
    var badStep2 = throwsError(function () { H.nextStep(-1, 'skip'); });
    var badStep3 = throwsError(function () { H.nextStep(1.5, 'next'); });
    var badAction = throwsError(function () { H.nextStep(1, 'back'); });
    var ok = skipAll && badStep && badStep2 && badStep3 && badAction;
    return case_('用例H9 skip 任意步结束；非法 step/action 抛错', ok,
      'skip=' + skipAll + ' 非法step=' + (badStep && badStep2 && badStep3) +
      ' 非法action=' + badAction);
  }

  return {
    runAll: function () {
      return [h1(), h2(), h3(), h4(), h5(), h6(), h7(), h8(), h9()];
    }
  };
});
