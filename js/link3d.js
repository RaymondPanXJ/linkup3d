/**
 * link3d.js — 3D 连连看核心算法（纯函数，无依赖）
 *
 * 网格模型：采用「扩展网格」，即在棋盘外围补一圈恒为空的边框格子，
 * 这样连线就可以绕到棋盘外侧（边界外绕线），符合经典连连看规则。
 *
 * 尺寸约定：棋盘尺寸由网格本身决定（rows = grid.length - 2，
 * cols = grid[0].length - 2），所有路径/洗牌/发牌函数都从网格推导，
 * 不依赖模块级常量。
 *
 * 坐标：grid[r][c]，r ∈ [0, rows+1]，c ∈ [0, cols+1]
 *   - r = 0 / rows+1 与 c = 0 / cols+1 是边框（永远为空）
 *   - 棋盘实际格子为 r ∈ [1, rows]，c ∈ [1, cols]
 * 取值：0 = 空；>0 = 图案编号（同编号即同一对图案）
 *
 * 该文件同时可在浏览器（window.Link3D）与 Node（module.exports）中使用。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Link3D = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 默认难度：标准 4x6。仅作 createGrid/dealGrid 的默认参数，
  // 运行期尺寸一律由网格本身推导（见「尺寸约定」）。
  var DEFAULT_ROWS = 4;
  var DEFAULT_COLS = 6;
  // 保留只读常量以兼容既有外部引用（如 game.js 的 L.ROWS / L.COLS）
  var ROWS = DEFAULT_ROWS;
  var COLS = DEFAULT_COLS;
  var PAIRS = (DEFAULT_ROWS * DEFAULT_COLS) / 2;

  /* ---------------------------------------------------------------- *
   * 基础工具
   * ---------------------------------------------------------------- */

  function isDim(n) {
    return typeof n === 'number' && isFinite(n) && Math.floor(n) === n && n > 0;
  }

  /** 校验棋盘内容尺寸合法且格子数为偶数（能恰好铺满成对的牌） */
  function checkDims(rows, cols) {
    if (!isDim(rows) || !isDim(cols)) {
      throw new Error('invalid grid size: rows and cols must be positive integers');
    }
    if ((rows * cols) % 2 !== 0) {
      throw new Error('invalid grid size: ' + rows + 'x' + cols +
        ' has an odd number of cells, tiles cannot be paired');
    }
  }

  /** 从扩展网格推导内容尺寸（网格本身决定尺寸） */
  function gridSize(grid) {
    if (!grid || typeof grid.length !== 'number' || grid.length < 3 ||
        !grid[0] || typeof grid[0].length !== 'number' || grid[0].length < 3) {
      throw new Error('invalid grid: expected an extended grid of at least 3x3');
    }
    return { rows: grid.length - 2, cols: grid[0].length - 2 };
  }

  /** 创建空网格（含外边框），返回 (rows+2) x (cols+2) 的二维数组。
   *  无参调用等价于 createGrid(4, 6)，与旧行为完全一致。 */
  function createGrid(rows, cols) {
    if (rows === undefined) rows = DEFAULT_ROWS;
    if (cols === undefined) cols = DEFAULT_COLS;
    checkDims(rows, cols);
    var grid = [];
    for (var r = 0; r < rows + 2; r++) {
      var row = [];
      for (var c = 0; c < cols + 2; c++) row.push(0);
      grid.push(row);
    }
    return grid;
  }

  function inBounds(grid, r, c) {
    return r >= 0 && r < grid.length && c >= 0 && c < grid[0].length;
  }

  /** 该格子是否为「可通行」（空位）；边框恒为空所以天然可通行 */
  function isFree(grid, r, c) {
    return inBounds(grid, r, c) && grid[r][c] === 0;
  }

  /** Fisher–Yates 洗牌（rng 可注入以便测试复现） */
  function shuffled(arr, rng) {
    var a = arr.slice();
    var random = rng || Math.random;
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(random() * (i + 1));
      var t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  /* ---------------------------------------------------------------- *
   * 连通性判定（核心）
   *
   * 规则：两张牌之间存在一条折线，满足
   *   1) 只能沿水平/垂直方向走；
   *   2) 转折次数 <= 2；
   *   3) 除两个端点外，路径经过的格子必须全部为空。
   * 分三类逐级查找（转弯由少到多），找到即返回路径点数组。
   * ---------------------------------------------------------------- */

  /**
   * a、b 是否在同一行或同一列，且两者之间（不含端点）全为空。
   * 相邻时中间无格子，直接为 true。
   */
  function isSegmentClear(grid, a, b) {
    if (a.r !== b.r && a.c !== b.c) return false;
    if (a.r === b.r) {
      var lo = Math.min(a.c, b.c);
      var hi = Math.max(a.c, b.c);
      for (var c = lo + 1; c < hi; c++) {
        if (!isFree(grid, a.r, c)) return false;
      }
      return true;
    }
    var lo2 = Math.min(a.r, b.r);
    var hi2 = Math.max(a.r, b.r);
    for (var r = lo2 + 1; r < hi2; r++) {
      if (!isFree(grid, r, a.c)) return false;
    }
    return true;
  }

  /** 0 转弯：同行/同列直连 */
  function findDirectPath(grid, a, b) {
    if (a.r === b.r && a.c === b.c) return null;
    if ((a.r === b.r || a.c === b.c) && isSegmentClear(grid, a, b)) {
      return [{ r: a.r, c: a.c }, { r: b.r, c: b.c }];
    }
    return null;
  }

  /** 1 转弯：经由一个拐点 (a.r,b.c) 或 (b.r,a.c)，拐点必须为空 */
  function findOneTurnPath(grid, a, b) {
    var corners = [
      { r: a.r, c: b.c },
      { r: b.r, c: a.c }
    ];
    for (var i = 0; i < corners.length; i++) {
      var m = corners[i];
      if (m.r === a.r && m.c === a.c) continue;
      if (m.r === b.r && m.c === b.c) continue;
      if (!isFree(grid, m.r, m.c)) continue;
      if (isSegmentClear(grid, a, m) && isSegmentClear(grid, m, b)) {
        return [{ r: a.r, c: a.c }, { r: m.r, c: m.c }, { r: b.r, c: b.c }];
      }
    }
    return null;
  }

  /**
   * 2 转弯：先在 a 所在行/列上找一个空格子 m（a→m 直线通畅），
   * 再从 m 用 <=1 转弯到达 b。任何 2 转弯路径的第一个拐点
   * 必然与 a 同行或同列，所以该枚举是完备的。
   */
  function findTwoTurnPath(grid, a, b) {
    var r, c, m, sub;
    // 沿 a 所在行扫描（含边框列）
    for (c = 0; c < grid[0].length; c++) {
      if (c === a.c) continue;
      m = { r: a.r, c: c };
      if (!isFree(grid, m.r, m.c)) continue;
      if (!isSegmentClear(grid, a, m)) continue;
      sub = findDirectPath(grid, m, b) || findOneTurnPath(grid, m, b);
      if (sub) return [{ r: a.r, c: a.c }].concat(sub);
    }
    // 沿 a 所在列扫描（含边框行）
    for (r = 0; r < grid.length; r++) {
      if (r === a.r) continue;
      m = { r: r, c: a.c };
      if (!isFree(grid, m.r, m.c)) continue;
      if (!isSegmentClear(grid, a, m)) continue;
      sub = findDirectPath(grid, m, b) || findOneTurnPath(grid, m, b);
      if (sub) return [{ r: a.r, c: a.c }].concat(sub);
    }
    return null;
  }

  /**
   * 判定 a、b 是否可连（<=2 转弯），返回路径点数组（含端点）或 null。
   * 优先返回转弯数最少的路径，便于动画展示更好看的折线。
   */
  function findPath(grid, a, b) {
    if (!inBounds(grid, a.r, a.c) || !inBounds(grid, b.r, b.c)) return null;
    if (grid[a.r][a.c] === 0 || grid[b.r][b.c] === 0) return null;
    if (a.r === b.r && a.c === b.c) return null;
    return (
      findDirectPath(grid, a, b) ||
      findOneTurnPath(grid, a, b) ||
      findTwoTurnPath(grid, a, b)
    );
  }

  /* ---------------------------------------------------------------- *
   * 局面查询 / 洗牌
   * ---------------------------------------------------------------- */

  /** 返回棋盘上所有占位格子的坐标列表 */
  function occupiedPositions(grid) {
    var size = gridSize(grid);
    var list = [];
    for (var r = 1; r <= size.rows; r++) {
      for (var c = 1; c <= size.cols; c++) {
        if (grid[r][c] > 0) list.push({ r: r, c: c });
      }
    }
    return list;
  }

  /** 找出场上任意一个「同图案且可连」的对子；无解时返回 null */
  function findSolvablePair(grid, rng) {
    var size = gridSize(grid);
    var byValue = {};
    for (var r = 1; r <= size.rows; r++) {
      for (var c = 1; c <= size.cols; c++) {
        var v = grid[r][c];
        if (v > 0) (byValue[v] = byValue[v] || []).push({ r: r, c: c });
      }
    }
    var values = shuffled(Object.keys(byValue), rng);
    for (var i = 0; i < values.length; i++) {
      var cells = byValue[values[i]];
      for (var x = 0; x < cells.length; x++) {
        for (var y = x + 1; y < cells.length; y++) {
          var path = findPath(grid, cells[x], cells[y]);
          if (path) {
            return {
              a: cells[x],
              b: cells[y],
              value: Number(values[i]),
              path: path
            };
          }
        }
      }
    }
    return null;
  }

  /** 场上是否还存在可连的对子 */
  function hasSolvablePair(grid, rng) {
    return findSolvablePair(grid, rng) !== null;
  }

  /**
   * 仅依据「占位情况」（忽略图案）找任意两个可连的占位格。
   * 这样的 pair 一定存在：棋盘四周是恒空边框，取每列最上方的占位格
   * 可经由边框行用两转弯互通。用于洗牌兜底。
   */
  function findConnectablePositions(grid, rng) {
    var pos = shuffled(occupiedPositions(grid), rng);
    for (var i = 0; i < pos.length; i++) {
      for (var j = i + 1; j < pos.length; j++) {
        if (findPath(grid, pos[i], pos[j])) return [pos[i], pos[j]];
      }
    }
    return null;
  }

  /**
   * 原地洗牌：把所有剩余图案随机重新铺到「当前已被占用的位置」上，
   * 位置占用集合保持不变，并保证洗牌后的局面至少存在一个可连对子。
   * 返回 { grid, attempts, forced }。
   */
  function shuffleGrid(grid, rng) {
    var positions = occupiedPositions(grid);
    if (positions.length < 2) return { grid: grid, attempts: 0, forced: false };

    var values = positions.map(function (p) { return grid[p.r][p.c]; });
    var attempts = 200;
    for (var i = 0; i < attempts; i++) {
      var perm = shuffled(values, rng);
      for (var k = 0; k < positions.length; k++) {
        grid[positions[k].r][positions[k].c] = perm[k];
      }
      if (hasSolvablePair(grid, rng)) {
        return { grid: grid, attempts: i + 1, forced: false };
      }
    }

    // 兜底：随机 200 次仍无解，则先固定一对一定可连的位置放同图案，
    // 其余图案随机分布，这样构造性保证有解。
    var pair = findConnectablePositions(grid, rng);
    var counts = {};
    values.forEach(function (v) { counts[v] = (counts[v] || 0) + 1; });
    var chosen = null;
    Object.keys(counts).some(function (v) {
      if (counts[v] >= 2) { chosen = Number(v); return true; }
      return false;
    });
    if (pair && chosen !== null) {
      var rest = values.slice();
      rest.splice(rest.indexOf(chosen), 1);
      rest.splice(rest.indexOf(chosen), 1);
      var perm2 = shuffled(rest, rng);
      var free = positions.filter(function (p) {
        return !(
          (p.r === pair[0].r && p.c === pair[0].c) ||
          (p.r === pair[1].r && p.c === pair[1].c)
        );
      });
      grid[pair[0].r][pair[0].c] = chosen;
      grid[pair[1].r][pair[1].c] = chosen;
      for (var m = 0; m < free.length; m++) {
        grid[free[m].r][free[m].c] = perm2[m];
      }
      return { grid: grid, attempts: attempts + 1, forced: true };
    }
    return { grid: grid, attempts: attempts + 1, forced: false };
  }

  /** 发一副新牌：满盘 rows*cols 张、rows*cols/2 对，且保证开局有解。
   *  向后兼容：
   *    dealGrid()            -> 4x6（旧行为）
   *    dealGrid(rng)         -> 4x6，第一参数为函数时视为 rng（旧签名）
   *    dealGrid(rows, cols, rng) -> 任意合法尺寸 */
  function dealGrid(rows, cols, rng) {
    if (typeof rows === 'function') { rng = rows; rows = undefined; }
    if (rows === undefined) { rows = DEFAULT_ROWS; cols = DEFAULT_COLS; }
    var grid = createGrid(rows, cols);
    var pairs = (rows * cols) / 2;
    var values = [];
    for (var v = 1; v <= pairs; v++) {
      values.push(v, v);
    }
    var cells = [];
    for (var r = 1; r <= rows; r++) {
      for (var c = 1; c <= cols; c++) cells.push({ r: r, c: c });
    }
    var perm = shuffled(values, rng);
    for (var i = 0; i < cells.length; i++) {
      grid[cells[i].r][cells[i].c] = perm[i];
    }
    shuffleGrid(grid, rng); // 保证开局存在可连对子
    return grid;
  }

  /** 剩余未消除的牌数 */
  function countTiles(grid) {
    var size = gridSize(grid);
    var n = 0;
    for (var r = 1; r <= size.rows; r++) {
      for (var c = 1; c <= size.cols; c++) if (grid[r][c] > 0) n++;
    }
    return n;
  }

  /** 把网格打印成字符串（调试 / 测试用） */
  function gridToString(grid) {
    var out = [];
    for (var r = 0; r < grid.length; r++) {
      out.push(
        grid[r]
          .map(function (v) { return v === 0 ? '.' : String.fromCharCode(96 + v); })
          .join(' ')
      );
    }
    return out.join('\n');
  }

  return {
    // 兼容保留：默认尺寸常量（新代码请使用 gridSize(grid) 从网格推导）
    ROWS: ROWS,
    COLS: COLS,
    PAIRS: PAIRS,
    createGrid: createGrid,
    gridSize: gridSize,
    isFree: isFree,
    isSegmentClear: isSegmentClear,
    findDirectPath: findDirectPath,
    findOneTurnPath: findOneTurnPath,
    findTwoTurnPath: findTwoTurnPath,
    findPath: findPath,
    findSolvablePair: findSolvablePair,
    hasSolvablePair: hasSolvablePair,
    findConnectablePositions: findConnectablePositions,
    shuffleGrid: shuffleGrid,
    dealGrid: dealGrid,
    occupiedPositions: occupiedPositions,
    countTiles: countTiles,
    shuffled: shuffled,
    gridToString: gridToString
  };
});
