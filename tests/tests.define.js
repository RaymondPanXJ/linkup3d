/**
 * tests/tests.define.js — 核心算法自测用例（Node 与浏览器共用）
 * 运行：node tests/run-tests.js  或  浏览器打开 tests.html
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../js/link3d.js'));
  } else {
    root.Link3DTests = factory(root.Link3D);
  }
})(typeof self !== 'undefined' ? self : this, function (L) {
  'use strict';

  /* ---------------- 测试工具 ---------------- */
  function emptyGrid() { return L.createGrid(); }

  function place(grid, r, c, v) { grid[r][c] = v; return grid; }

  /** 满盘布牌：vals 为 [r, c, v] 列表 */
  function fullGrid(pairs) {
    var g = emptyGrid();
    pairs.forEach(function (p) { place(g, p[0], p[1], p[2]); });
    return g;
  }

  /** 校验路径本身合法：端点正确、只走直线、转弯 <=2、途经空格 */
  function assertPathValid(grid, path, a, b) {
    if (!path || path.length < 2) return '路径为空';
    var p0 = path[0], pn = path[path.length - 1];
    if (p0.r !== a.r || p0.c !== a.c) return '起点不符';
    if (pn.r !== b.r || pn.c !== b.c) return '终点不符';
    var turns = 0;
    for (var i = 0; i < path.length - 1; i++) {
      var s = path[i], e = path[i + 1];
      if (s.r !== e.r && s.c !== e.c) return '第' + i + '段不是直线';
    }
    for (var t = 1; t < path.length - 1; t++) {
      var prev = path[t - 1], cur = path[t], next = path[t + 1];
      var dirPrev = prev.r === cur.r ? 'h' : 'v';
      var dirNext = next.r === cur.r ? 'h' : 'v';
      if (dirPrev !== dirNext) turns++;
    }
    if (turns > 2) return '转弯次数 ' + turns + ' 超过 2';
    for (var j = 0; j < path.length - 1; j++) {
      var s2 = path[j], e2 = path[j + 1];
      if (s2.r === e2.r) {
        var lo = Math.min(s2.c, e2.c), hi = Math.max(s2.c, e2.c);
        for (var c = lo; c <= hi; c++) {
          if ((s2.r !== a.r || c !== a.c) && (e2.r !== b.r || c !== b.c)) {
            if (!L.isFree(grid, s2.r, c)) return '途经点 (' + s2.r + ',' + c + ') 非空';
          }
        }
      } else {
        var lo2 = Math.min(s2.r, e2.r), hi2 = Math.max(s2.r, e2.r);
        for (var r = lo2; r <= hi2; r++) {
          if ((r !== a.r || s2.c !== a.c) && (r !== b.r || s2.c !== b.c)) {
            if (!L.isFree(grid, r, s2.c)) return '途经点 (' + r + ',' + s2.c + ') 非空';
          }
        }
      }
    }
    return null;
  }

  function expectPath(name, grid, a, b) {
    var path = L.findPath(grid, a, b);
    if (!path) return { name: name, pass: false, detail: '应存在路径，实际返回 null' };
    var err = assertPathValid(grid, path, a, b);
    if (err) return { name: name, pass: false, detail: err };
    return { name: name, pass: true, detail: '路径: ' + JSON.stringify(path) };
  }

  function expectNoPath(name, grid, a, b) {
    var path = L.findPath(grid, a, b);
    if (path) {
      return { name: name, pass: false,
               detail: '应无路径，实际找到 ' + JSON.stringify(path) };
    }
    return { name: name, pass: true, detail: '正确判定不可连' };
  }

  function eq(name, actual, expected, extra) {
    var ok = actual === expected;
    return { name: name, pass: ok,
             detail: (extra || '') + ' 期望=' + expected + ' 实际=' + actual };
  }

  /* ---------------- 用例 ---------------- */

  // 1. 同行直连（0 转弯）
  function t1() {
    var g = fullGrid([[1, 2, 5], [1, 5, 5]]);
    return expectPath('用例1 同行直连（0 转弯）', g, { r: 1, c: 2 }, { r: 1, c: 5 });
  }

  // 2. 相邻直连
  function t2() {
    var g = fullGrid([[2, 3, 7], [3, 3, 7]]);
    var path = L.findPath(g, { r: 2, c: 3 }, { r: 3, c: 3 });
    if (!path) return { name: '用例2 相邻直连', pass: false, detail: '返回 null' };
    var ok = path.length === 2 && assertPathValid(g, path, { r: 2, c: 3 }, { r: 3, c: 3 }) === null;
    return { name: '用例2 相邻直连', pass: ok, detail: '路径点数=' + path.length + '（应为 2）' };
  }

  // 3. 一次转弯（L 形）
  function t3() {
    var g = fullGrid([[1, 1, 3], [3, 4, 3]]);
    var path = L.findPath(g, { r: 1, c: 1 }, { r: 3, c: 4 });
    if (!path) return { name: '用例3 一次转弯', pass: false, detail: '返回 null' };
    var err = assertPathValid(g, path, { r: 1, c: 1 }, { r: 3, c: 4 });
    var isTurn = path.length === 3; // 算法优先找最少转弯
    return { name: '用例3 一次转弯（L 形）',
             pass: !err && isTurn,
             detail: (err || '') + ' 路径: ' + JSON.stringify(path) };
  }

  // 4. 中间被阻挡 -> 两转弯从上方绕行
  function t4() {
    var g = fullGrid([
      [2, 2, 9], [2, 3, 4], [2, 4, 9],
      [1, 2, 6], [1, 4, 6]
    ]);
    var path = L.findPath(g, { r: 2, c: 2 }, { r: 2, c: 4 });
    if (!path) return { name: '用例4 阻挡后两转弯', pass: false, detail: '返回 null' };
    var err = assertPathValid(g, path, { r: 2, c: 2 }, { r: 2, c: 4 });
    var isDirect = path.length === 2 ||
      (path.length === 3 && path[1].c === 3); // 不允许穿过 (2,3)
    return { name: '用例4 直线被挡，两转弯绕行',
             pass: !err && !isDirect,
             detail: (err || '') + ' 路径: ' + JSON.stringify(path) };
  }

  // 5. 完全阻挡 -> 不可连：满盘中 (2,2) 被四邻完全围死，
  //    任何 <=2 转弯路径的第一步都必须踏入其邻格，故无从连通
  function t5() {
    var specs = [];
    for (var r = 1; r <= 4; r++)
      for (var c = 1; c <= 6; c++)
        specs.push([r, c, (r === 2 && (c === 2 || c === 4)) ? 1 : 2]);
    var g = fullGrid(specs);
    return expectNoPath('用例5 被四邻围死，判定不可连', g, { r: 2, c: 2 }, { r: 2, c: 4 });
  }

  // 6. 边界外绕线：满盘时两端牌只能经棋盘外（边框行/列）连通
  function t6() {
    var specs = [];
    for (var r = 1; r <= 4; r++)
      for (var c = 1; c <= 6; c++)
        specs.push([r, c, (r === 1 && (c === 2 || c === 5)) ? 1 : 2]);
    var g = fullGrid(specs);
    var a = { r: 1, c: 2 }, b = { r: 1, c: 5 };
    var path = L.findPath(g, a, b);
    if (!path) return { name: '用例6 边界外绕线', pass: false, detail: '返回 null' };
    var err = assertPathValid(g, path, a, b);
    var usesBorder = path.some(function (p) {
      return p.r === 0 || p.r === 5 || p.c === 0 || p.c === 7;
    });
    return { name: '用例6 满盘经棋盘外绕线连通',
             pass: !err && usesBorder,
             detail: (err || '') + ' 路径经过边框外: ' + usesBorder +
                     ' ' + JSON.stringify(path) };
  }

  // 7. 洗牌保位 + 洗牌后必有解
  function t7() {
    var g = emptyGrid();
    place(g, 1, 1, 3); place(g, 2, 2, 3);
    place(g, 3, 3, 5); place(g, 4, 4, 5);
    var before = L.occupiedPositions(g)
      .map(function (p) { return p.r + ',' + p.c; }).sort().join('|');
    var res = L.shuffleGrid(g);
    var after = L.occupiedPositions(g)
      .map(function (p) { return p.r + ',' + p.c; }).sort().join('|');
    var posOk = before === after;
    var solvable = L.hasSolvablePair(g);
    var countsOk = L.countTiles(g) === 4;
    return { name: '用例7 洗牌保持占位且有解',
             pass: posOk && solvable && countsOk && res.attempts >= 1,
             detail: '占位不变=' + posOk + ' 有解=' + solvable +
                     ' 尝试次数=' + res.attempts };
  }

  // 8. 随机整局模拟：每步消除合法对子；死锁时洗牌保位且有解，直至清盘
  function t8() {
    var trials = 200, ok = true, detail = '';
    for (var t = 0; t < trials && ok; t++) {
      var g = L.dealGrid();
      var guard = 0;
      while (L.countTiles(g) > 0) {
        if (++guard > 1000) { ok = false; detail = '第' + t + '局未收敛'; break; }
        var pair = L.findSolvablePair(g);
        if (!pair) {
          var occBefore = L.occupiedPositions(g)
            .map(function (p) { return p.r + ',' + p.c; }).sort().join('|');
          L.shuffleGrid(g);
          var occAfter = L.occupiedPositions(g)
            .map(function (p) { return p.r + ',' + p.c; }).sort().join('|');
          if (occBefore !== occAfter) {
            ok = false; detail = '洗牌改变了占位（第' + t + '局）'; break;
          }
          if (L.countTiles(g) >= 2 && !L.hasSolvablePair(g)) {
            ok = false; detail = '洗牌后仍无解（第' + t + '局）'; break;
          }
          continue;
        }
        var err = assertPathValid(g, pair.path, pair.a, pair.b);
        if (err) { ok = false; detail = '第' + t + '局路径非法: ' + err; break; }
        g[pair.a.r][pair.a.c] = 0;
        g[pair.b.r][pair.b.c] = 0;
      }
    }
    return { name: '用例8 随机 200 局整局模拟（洗牌后必有解）',
             pass: ok, detail: ok ? '200 局全部合法消除并清盘' : detail };
  }

  // 9. 发牌规格：满盘 24 张、12 对、开局有解
  function t9() {
    var g = L.dealGrid();
    var counts = {};
    var total = 0;
    for (var r = 1; r <= 4; r++)
      for (var c = 1; c <= 6; c++)
        if (g[r][c]) { counts[g[r][c]] = (counts[g[r][c]] || 0) + 1; total++; }
    var allPairs = Object.keys(counts).every(function (k) { return counts[k] === 2; });
    return { name: '用例9 发牌 24 张 12 对且开局有解',
             pass: total === 24 && allPairs && L.hasSolvablePair(g),
             detail: '总牌数=' + total + ' 每种成对=' + allPairs +
                     ' 开局有解=' + L.hasSolvablePair(g) };
  }

  // 10. 同一张牌不可与自己配对
  function t10() {
    var g = fullGrid([[2, 2, 4]]);
    var path = L.findPath(g, { r: 2, c: 2 }, { r: 2, c: 2 });
    return { name: '用例10 同一张牌不能配对', pass: path === null,
             detail: path ? '意外返回路径' : '正确返回 null' };
  }

  // 11. 空位不能作为端点
  function t11() {
    var g = fullGrid([[1, 1, 2]]);
    var path = L.findPath(g, { r: 1, c: 1 }, { r: 2, c: 2 }); // (2,2) 为空
    return { name: '用例11 空格子不能作为连线端点', pass: path === null,
             detail: path ? '意外返回路径' : '正确返回 null' };
  }

  // 12. isSegmentClear 对异行异列返回 false
  function t12() {
    var g = emptyGrid();
    var bad = L.isSegmentClear(g, { r: 1, c: 1 }, { r: 2, c: 2 });
    return { name: '用例12 斜向线段判定为不通', pass: bad === false,
             detail: bad ? '意外为 true' : '正确为 false' };
  }

  /* ---------------- 难度尺寸（4x4 / 6x8）新增用例 ---------------- */

  /** 满盘发牌通用校验：尺寸、总牌数、成对、开局有解 */
  function checkDeal(rows, cols) {
    var g = L.dealGrid(rows, cols);
    var size = L.gridSize(g);
    var counts = {};
    var total = 0;
    for (var r = 1; r <= rows; r++)
      for (var c = 1; c <= cols; c++)
        if (g[r][c]) { counts[g[r][c]] = (counts[g[r][c]] || 0) + 1; total++; }
    var allPairs = Object.keys(counts).every(function (k) { return counts[k] === 2; });
    var dimOk = size.rows === rows && size.cols === cols &&
                g.length === rows + 2 && g[0].length === cols + 2;
    var solvable = L.hasSolvablePair(g);
    return { dimOk: dimOk, total: total, allPairs: allPairs, solvable: solvable,
             pairs: Object.keys(counts).length, pass:
               dimOk && total === rows * cols && allPairs && solvable };
  }

  // 13. 简单 4x4 发牌：满盘 16 张、8 对、开局有解
  function t13() {
    var res = checkDeal(4, 4);
    return { name: '用例13 简单 4x4 发牌 16 张 8 对且开局有解',
             pass: res.pass,
             detail: '尺寸正确=' + res.dimOk + ' 总牌数=' + res.total +
                     ' 每种成对=' + res.allPairs + ' 对数=' + res.pairs +
                     ' 开局有解=' + res.solvable };
  }

  // 14. 困难 6x8 发牌：满盘 48 张、24 对、开局有解
  function t14() {
    var res = checkDeal(6, 8);
    return { name: '用例14 困难 6x8 发牌 48 张 24 对且开局有解',
             pass: res.pass,
             detail: '尺寸正确=' + res.dimOk + ' 总牌数=' + res.total +
                     ' 每种成对=' + res.allPairs + ' 对数=' + res.pairs +
                     ' 开局有解=' + res.solvable };
  }

  // 15. 困难 6x8 随机整局模拟：每步消除合法对子；死锁时洗牌保位且有解，直至清盘
  function t15() {
    var trials = 50, ok = true, detail = '';
    for (var t = 0; t < trials && ok; t++) {
      var g = L.dealGrid(6, 8);
      var guard = 0;
      while (L.countTiles(g) > 0) {
        if (++guard > 2000) { ok = false; detail = '第' + t + '局未收敛'; break; }
        var pair = L.findSolvablePair(g);
        if (!pair) {
          var occBefore = L.occupiedPositions(g)
            .map(function (p) { return p.r + ',' + p.c; }).sort().join('|');
          L.shuffleGrid(g);
          var occAfter = L.occupiedPositions(g)
            .map(function (p) { return p.r + ',' + p.c; }).sort().join('|');
          if (occBefore !== occAfter) {
            ok = false; detail = '洗牌改变了占位（第' + t + '局）'; break;
          }
          if (L.countTiles(g) >= 2 && !L.hasSolvablePair(g)) {
            ok = false; detail = '洗牌后仍无解（第' + t + '局）'; break;
          }
          continue;
        }
        var err = assertPathValid(g, pair.path, pair.a, pair.b);
        if (err) { ok = false; detail = '第' + t + '局路径非法: ' + err; break; }
        g[pair.a.r][pair.a.c] = 0;
        g[pair.b.r][pair.b.c] = 0;
      }
    }
    return { name: '用例15 困难 6x8 随机 50 局整局模拟（整局自动可清）',
             pass: ok, detail: ok ? '50 局全部合法消除并清盘' : detail };
  }

  // 16. 尺寸校验与向后兼容：非法/奇数尺寸报错；旧签名 dealGrid(rng) 仍为 4x6
  function t16() {
    function throws(fn) {
      try { fn(); return false; } catch (e) { return e instanceof Error; }
    }
    var oddThrows = throws(function () { L.createGrid(3, 3); });      // 奇数格子
    var badThrows = throws(function () { L.createGrid(0, 6); });      // 非正整数
    var floatThrows = throws(function () { L.createGrid(2.5, 4); });  // 非整数
    var dealThrows = throws(function () { L.dealGrid(5, 5); });       // 奇数格子
    // 旧签名：第一参数为函数时视为 rng，尺寸仍为默认 4x6
    var g = L.dealGrid(function () { return 0.5; });
    var size = L.gridSize(g);
    var legacyOk = size.rows === 4 && size.cols === 6 && L.countTiles(g) === 24;
    var pass = oddThrows && badThrows && floatThrows && dealThrows && legacyOk;
    return { name: '用例16 非法尺寸报错 + 旧 dealGrid(rng) 签名兼容',
             pass: pass,
             detail: '奇数报错=' + oddThrows + ' 非法报错=' + badThrows +
                     ' 小数报错=' + floatThrows + ' 发牌奇数报错=' + dealThrows +
                     ' 旧签名默认4x6=' + legacyOk };
  }

  return {
    runAll: function () {
      return [t1(), t2(), t3(), t4(), t5(), t6(),
              t7(), t8(), t9(), t10(), t11(), t12(),
              t13(), t14(), t15(), t16()];
    }
  };
});
