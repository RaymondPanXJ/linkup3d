/**
 * fire.js — 熔火残骸火焰状态层纯函数模块（issue #65 T1，无 DOM / 无存储 / 无内部定时器）
 *
 * 规则（ROADMAP 星系#2「熔火残骸」+ issue #65 T1 定稿）：
 *   1. 燃烧牌不可被选中、不可作为连通端点（canSelect / canMatch），图案仍可见
 *      （熔岩外观由 T2 渲染层负责）；
 *   2. 熔岩按回合制蔓延：spread(state, grid, rng, turn) 一次性推进一个蔓延回合——
 *      每个燃烧格的正交四邻（不含对角）中「有牌（占位）且未燃烧」的内圈格被引燃；
 *      引燃顺序 = 燃烧格插入顺序 × 固定邻向序，再经注入 rng 洗牌（同 rng 序列
 *      重放逐字节一致，仿真可复现）；无可引燃目标时 applied=false（蔓延终止态）；
 *   3. 同屏燃烧上限 4（MAX_BURNING）：ignite 到限直接 applied=false 跳过；
 *      spread 到限后剩余候选全部跳过（同样只算一次回合推进，不排队到下回合）；
 *   4. 消除灭火（与 frost 规则 2 对称）：成功消除一对后，对被消两牌的正交四邻
 *      燃烧格各扑灭一次（quenchAround；同格双邻只灭一次——一次消除 = 一次扑灭）。
 *      这是玩家对抗蔓延的唯一手段（ROADMAP#2「不消除邻近对子，火势扩张」的反面）；
 *   5. 不作弊保底：isBoardSolvable(state, grid, link3d) 供调用方在火势推进后检查
 *      「盘面是否仍可解」，不可解则调用方回滚（T3 仿真硬断言口径）。本模块只提供
 *      判定接口，不做洗牌（洗牌是既有 link3d.js 逻辑）。
 *
 * 返回值契约（镜像 js/frost.js issue #49 信封）：修改型 API 一律返回新状态、
 *   绝不改动入参；生效与否看信封 applied。
 *     ignite        → { state, applied }
 *     spread        → { state, applied, burned: [{r,c}] }
 *     quench        → { state, applied }
 *     quenchAround  → { state, quenched: [{r,c}] }
 *
 * 状态结构（纯数据、可 JSON 序列化）：
 *   { burning: { "r,c": { at: <引燃回合，调用方注入> } } }
 * 坐标为游戏内 1-based 内容格坐标（与 campaign.js LEVELS 约定一致，不含
 * link3d.js 扩展网格外圈空边框；扩展网格索引与内容格索引在 1-based 下重合）。
 *
 * 纯函数约束：代码不含 document / localStorage / Date.now / window.，
 * 时间与随机源一律由调用方注入（风格对齐 js/frost.js、js/ranking.js）。
 *
 * 该文件同时可在浏览器（window.Fire）与 Node（module.exports）中使用。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Fire = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX_BURNING = 4; // 同屏燃烧上限（规则 3）

  /* ---------------- 内部工具 ---------------- */

  function key(r, c) {
    return r + ',' + c;
  }

  function parseKey(k) {
    var i = k.indexOf(',');
    return { r: +k.slice(0, i), c: +k.slice(i + 1) };
  }

  function isCoord(v) {
    return typeof v === 'number' && isFinite(v) &&
      Math.floor(v) === v && v >= 1;
  }

  function isTurn(v) {
    return typeof v === 'number' && isFinite(v) && Math.floor(v) === v && v >= 0;
  }

  // 入参防御：非法/被篡改的状态一律归一为空状态
  function normalize(s) {
    var out = { burning: {} };
    if (!s || typeof s !== 'object') return out;
    var src = s.burning;
    if (src && typeof src === 'object') {
      Object.keys(src).forEach(function (k) {
        var e = src[k], p = parseKey(k);
        if (e && isCoord(p.r) && isCoord(p.c) && isTurn(e.at)) {
          out.burning[k] = { at: e.at };
        }
      });
    }
    return out;
  }

  function clone(s) {
    var n = { burning: {} };
    Object.keys(s.burning).forEach(function (k) {
      n.burning[k] = { at: s.burning[k].at };
    });
    return n;
  }

  // 正交四邻键列表（规则 2：不含对角；固定顺序上/下/左/右保证可复现）
  function orthogonalKeys(r, c) {
    return [key(r - 1, c), key(r + 1, c), key(r, c - 1), key(r, c + 1)];
  }

  // Fisher–Yates 洗牌（与 frost.js/link3d.shuffled 同式；rng 注入以便仿真复现）
  function shuffleList(arr, rng) {
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

  /* ---------------- 公开 API ---------------- */

  // 空状态
  function create() {
    return { burning: {} };
  }

  // 规则 1：燃烧格不可选中
  function canSelect(state, r, c) {
    var s = normalize(state);
    return !Object.prototype.hasOwnProperty.call(s.burning, key(r, c));
  }

  // 规则 1：燃烧格不可作为连通端点
  function canMatch(state, r1, c1, r2, c2) {
    return canSelect(state, r1, c1) && canSelect(state, r2, c2);
  }

  // 初始/事件引燃（如熔岩口喷发）：同屏上限 4；重复引燃拒绝。
  // 返回值契约：{ state, applied }；applied=false 时 state 为入参归一后的原样。
  function ignite(state, r, c, turn) {
    var s = clone(normalize(state));
    var k = key(r, c);
    var ok = isCoord(r) && isCoord(c) && isTurn(turn) &&
      !Object.prototype.hasOwnProperty.call(s.burning, k) &&
      Object.keys(s.burning).length < MAX_BURNING;
    if (!ok) return { state: s, applied: false };
    s.burning[k] = { at: turn };
    return { state: s, applied: true };
  }

  /**
   * 规则 2+3：推进一个蔓延回合。
   *   候选 = 所有燃烧格的正交四邻中，位于盘面内圈（1..rows / 1..cols）、
   *          grid[r][c] > 0（有牌可吞）且尚未燃烧的格；
   *   候选按「燃烧格插入顺序 × 固定邻向序」生成后由注入 rng 洗牌，
   *   依序引燃直至同屏上限 MAX_BURNING；到限后的候选全部跳过（规则 3）。
   * grid 为 link3d 扩展网格（0-based，含外圈边框；外圈不参与引燃——火烧不出盘）。
   * 返回值契约：{ state, applied, burned }；burned 为本回合实际引燃格列表。
   * 无燃烧源或无候选 → { state, applied: false, burned: [] }（蔓延终止口径）。
   */
  function spread(state, grid, rng, turn) {
    var s = clone(normalize(state));
    var burned = [];
    if (!Array.isArray(grid) || grid.length < 3 ||
        !grid[0] || typeof grid[0].length !== 'number' || grid[0].length < 3) {
      return { state: s, applied: false, burned: burned };
    }
    var rows = grid.length - 2, cols = grid[0].length - 2;
    var seen = {};
    var candidates = [];
    Object.keys(s.burning).forEach(function (bk) {
      var p = parseKey(bk);
      orthogonalKeys(p.r, p.c).forEach(function (k) {
        if (seen[k]) return;
        seen[k] = true;
        var q = parseKey(k);
        if (!isCoord(q.r) || !isCoord(q.c)) return;
        if (q.r < 1 || q.r > rows || q.c < 1 || q.c > cols) return; // 外圈不引燃
        var v = grid[q.r][q.c];
        if (typeof v !== 'number' || v <= 0) return;                // 空格无燃料
        if (Object.prototype.hasOwnProperty.call(s.burning, k)) return; // 已燃
        candidates.push(q);
      });
    });
    var order = shuffleList(candidates, rng);
    for (var i = 0; i < order.length; i++) {
      if (Object.keys(s.burning).length >= MAX_BURNING) break; // 规则 3：到限即止
      var q2 = order[i];
      s.burning[key(q2.r, q2.c)] = { at: turn };
      burned.push(q2);
    }
    return { state: s, applied: burned.length > 0, burned: burned };
  }

  // 规则 4：单格扑灭。燃烧格 → 移除并 applied=true；未燃格 applied=false。
  function quench(state, r, c) {
    var s = clone(normalize(state));
    var k = key(r, c);
    if (!Object.prototype.hasOwnProperty.call(s.burning, k)) {
      return { state: s, applied: false };
    }
    delete s.burning[k];
    return { state: s, applied: true };
  }

  // 规则 4：成功消除后，对被消两牌的正交四邻（不含对角）燃烧格各扑灭一次。
  // 同格同时邻接两消牌只灭一次（一次消除 = 一次扑灭，与 frost crackAround 单次语义对齐）。
  // 返回值契约：{ state, quenched: [{r,c}] }，供渲染/音效。
  function quenchAround(state, r1, c1, r2, c2) {
    var s = clone(normalize(state));
    var quenched = [];
    var seen = {};
    orthogonalKeys(r1, c1).concat(orthogonalKeys(r2, c2)).forEach(function (k) {
      if (seen[k] || !Object.prototype.hasOwnProperty.call(s.burning, k)) return;
      seen[k] = true;
      delete s.burning[k];
      var p = parseKey(k);
      quenched.push({ r: p.r, c: p.c });
    });
    return { state: s, quenched: quenched };
  }

  function countBurning(state) {
    return Object.keys(normalize(state).burning).length;
  }

  // 按引燃回合升序（等时按登记顺序稳定排序），供渲染与回滚
  function burningList(state) {
    var s = normalize(state);
    return Object.keys(s.burning).map(function (k) {
      var p = parseKey(k);
      return { r: p.r, c: p.c, at: s.burning[k].at };
    }).sort(function (a, b) { return a.at - b.at; });
  }

  function snapshot(state) {
    return JSON.stringify(normalize(state));
  }

  // 兼容 JSON 字符串或已解析对象；损坏输入安全降级为空状态
  function restore(json) {
    if (typeof json === 'object' && json !== null) return normalize(json);
    if (typeof json !== 'string' || !json) return create();
    var obj;
    try { obj = JSON.parse(json); } catch (e) { return create(); }
    return normalize(obj);
  }

  /* ---------------- 规则 5：可解性判定（保底接口，不做洗牌） ---------------- */

  function cloneGrid(grid) {
    return grid.map(function (row) { return row.slice(); });
  }

  // 盘面是否仍可解（与 link3d.hasSolvablePair 同一定义：存在至少一对可连同类牌）：
  // 燃烧格（内容格 1-based == 扩展网格索引）视同占用障碍——不可作端点、连线不可穿越。
  // link3d 为注入依赖（需含 findPath）。grid 采用 link3d 扩展网格（含外圈，0-based）。
  // 空盘面视为可解。镜像 frost.isBoardSolvable，仅词表由 frozen 换为 burning。
  function isBoardSolvable(state, grid, link3d) {
    var s = normalize(state);
    if (!link3d || typeof link3d.findPath !== 'function') return false;
    if (!Array.isArray(grid) || grid.length < 3 ||
        !grid[0] || typeof grid[0].length !== 'number' || grid[0].length < 3) return false;

    var work = cloneGrid(grid);
    var keys = Object.keys(s.burning);
    for (var i = 0; i < keys.length; i++) {
      var p = parseKey(keys[i]);
      var gr = p.r, gc = p.c;
      if (gr >= 1 && gr < grid.length - 1 && gc >= 1 && gc < grid[0].length - 1) {
        if (!(work[gr][gc] > 0)) return false; // 燃烧格必须是占位牌，数据异常判为不可解
        work[gr][gc] = -1;
      }
    }

    var counts = {};
    var total = 0;
    for (var r = 0; r < work.length; r++) {
      for (var c = 0; c < work[r].length; c++) {
        var v = work[r][c];
        if (v > 0) { counts[v] = (counts[v] || 0) + 1; total++; }
      }
    }
    if (total === 0) return true; // 盘面已清空

    var values = Object.keys(counts);
    for (var vi = 0; vi < values.length; vi++) {
      var val = +values[vi];
      var positions = [];
      for (var r2 = 0; r2 < work.length; r2++) {
        for (var c2 = 0; c2 < work[r2].length; c2++) {
          if (work[r2][c2] === val) positions.push({ r: r2, c: c2 });
        }
      }
      for (var a = 0; a < positions.length; a++) {
        for (var b = a + 1; b < positions.length; b++) {
          if (link3d.findPath(work, positions[a], positions[b])) return true;
        }
      }
    }
    return false;
  }

  /**
   * 熔火感知可连对搜索（镜像 frost.findUnfrozenSolvablePair，issue #65 T3 仿真用）：
   * 与 L.findSolvablePair 同构返回 {a, b, value, path} 或 null。端点仅取
   * Fire.canSelect 为真的格；燃烧格在 grid 上仍占位（吞牌不腾格），findPath 天然
   * 将其视为路径障碍。与 L.findSolvablePair 同一遍历/洗牌算法，无火时对同一 rng
   * 逐调用等价（确定性）。findPath 为注入依赖，签名 findPath(grid, a, b) → path|null。
   */
  function findUnburnedSolvablePair(fireState, grid, findPath, rng) {
    if (typeof findPath !== 'function') return null;
    if (!Array.isArray(grid) || grid.length < 3 ||
        !grid[0] || typeof grid[0].length !== 'number' || grid[0].length < 3) return null;
    var rows = grid.length - 2, cols = grid[0].length - 2;
    var byValue = {};
    for (var r = 1; r <= rows; r++) {
      for (var c = 1; c <= cols; c++) {
        var v = grid[r][c];
        if (v > 0 && canSelect(fireState, r, c)) {
          (byValue[v] = byValue[v] || []).push({ r: r, c: c });
        }
      }
    }
    var values = shuffleList(Object.keys(byValue), rng);
    for (var i = 0; i < values.length; i++) {
      var cells = byValue[values[i]];
      for (var x = 0; x < cells.length; x++) {
        for (var y = x + 1; y < cells.length; y++) {
          var path = findPath(grid, cells[x], cells[y]);
          if (path) {
            return { a: cells[x], b: cells[y], value: Number(values[i]), path: path };
          }
        }
      }
    }
    return null;
  }

  return {
    MAX_BURNING: MAX_BURNING,
    create: create,
    canSelect: canSelect,
    canMatch: canMatch,
    ignite: ignite,
    spread: spread,
    quench: quench,
    quenchAround: quenchAround,
    countBurning: countBurning,
    burningList: burningList,
    snapshot: snapshot,
    restore: restore,
    isBoardSolvable: isBoardSolvable,
    findUnburnedSolvablePair: findUnburnedSolvablePair
  };
});
