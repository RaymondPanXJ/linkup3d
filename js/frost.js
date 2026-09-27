/**
 * frost.js — 冻冰状态层纯函数模块（无 DOM / 无存储 / 无内部定时器）
 *
 * 规则（issue #27 定稿 + issue #49 HP=2 加强，TechLead 裁决）：
 *   1. 冰冻牌不可被选中、不可作为连通端点（canSelect / canMatch），图案仍可见（覆冰外观由 T4 渲染）；
 *      hp>0（含裂纹态 hp=1）一律拒绝；
 *   2. 冰封 HP=2（issue #49）：freeze 落位 hp=FREEZE_HP；被消两牌每格正交邻（四邻，不含对角）
 *      的冰冻格经一次邻近消除 hp-1（crackAround / crack）。hp=1 为裂纹态（仍不可选不可连），
 *      hp=0 解冻移除。即一块冰需要两次邻近消除才能打碎；
 *   3. 冻结动作必须有预警期：telegraph 登记预警，预警期满（由调用方注入 now 判断，
 *      本模块不做任何定时器）后 freeze 才生效；
 *   4. 同屏冰冻上限 4（MAX_FROZEN），达到上限后新的冻结动作直接跳过（applied=false）；
 *   5. 敌人不作弊保底：isBoardSolvable(state, grid, link3d) 供调用方在冻结生效后检查
 *      "盘面是否仍可解"，不可解则调用方回滚（冻结不生效）。本模块只提供判定接口，
 *      不做洗牌（洗牌是既有 link3d.js 逻辑）。
 *
 * 返回值契约（issue #49 验收）：修改型 API 一律返回新状态、绝不改动入参。
 *   freeze/crack 返回 freeze 同款信封 {state, ...}；telegraph/thaw 类批量入口
 *   （telegraph / crackAround）返回裸新状态或 {state, cracked, broken} 信封，见各函数注释。
 *
 * 状态结构（纯数据、可 JSON 序列化）：
 *   { frozen: { "r,c": { at: <冻结时刻，调用方注入>, hp: <剩余冰层 1..FREEZE_HP> } },
 *     telegraphs: { "r,c": { until: <预警到期时刻，调用方注入> } } }
 * 坐标为游戏内 1-based 内容格坐标（与 campaign.js LEVELS.frost 一致，
 * 不含 link3d.js 扩展网格的外圈空边框）。
 *
 * 纯函数约束：所有修改型 API 一律返回新状态，绝不改动入参；代码不含
 * document / localStorage / Date.now / window.，时间一律由调用方注入
 * （风格对齐 js/ranking.js，静态断言沿用 T1 的约束检查）。
 *
 * 该文件同时可在浏览器（window.Frost）与 Node（module.exports）中使用。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Frost = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX_FROZEN = 4; // 同屏冰冻上限（规则 4）
  var FREEZE_HP = 2;  // 冰封血量（issue #49：两次邻近消除才能打碎）

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

  function isTime(v) {
    return typeof v === 'number' && isFinite(v) && v >= 0;
  }

  // 入参防御：非法/被篡改的状态一律归一为空状态
  function normalize(s) {
    var out = { frozen: {}, telegraphs: {} };
    if (!s || typeof s !== 'object') return out;
    var src = s.frozen;
    if (src && typeof src === 'object') {
      Object.keys(src).forEach(function (k) {
        var e = src[k], p = parseKey(k);
        if (e && isCoord(p.r) && isCoord(p.c) && isTime(e.at)) {
          // hp 兼容：旧存档无 hp 字段视为满血（issue #49 兼容要求）；越界值归一
          var hp = typeof e.hp === 'number' && isFinite(e.hp) ?
            Math.min(FREEZE_HP, Math.floor(e.hp)) : FREEZE_HP;
          if (hp <= 0) return; // hp<=0 即已解冻，视为无效条目丢弃
          out.frozen[k] = { at: e.at, hp: hp };
        }
      });
    }
    var tg = s.telegraphs;
    if (tg && typeof tg === 'object') {
      Object.keys(tg).forEach(function (k) {
        var e = tg[k], p = parseKey(k);
        if (e && isCoord(p.r) && isCoord(p.c) && isTime(e.until)) {
          out.telegraphs[k] = { until: e.until };
        }
      });
    }
    return out;
  }

  function clone(s) {
    var n = { frozen: {}, telegraphs: {} };
    Object.keys(s.frozen).forEach(function (k) {
      n.frozen[k] = { at: s.frozen[k].at, hp: s.frozen[k].hp };
    });
    Object.keys(s.telegraphs).forEach(function (k) {
      n.telegraphs[k] = { until: s.telegraphs[k].until };
    });
    return n;
  }

  // 正交四邻键列表（规则 2：不含对角）
  function orthogonalKeys(r, c) {
    return [key(r - 1, c), key(r + 1, c), key(r, c - 1), key(r, c + 1)];
  }

  /* ---------------- 公开 API ---------------- */

  // 空状态
  function create() {
    return { frozen: {}, telegraphs: {} };
  }

  // 规则 1：冰冻格不可选中（hp>0 一律拒绝，含裂纹态 hp=1；normalize 保证条目 hp 恒 >0）
  function canSelect(state, r, c) {
    var s = normalize(state);
    return !Object.prototype.hasOwnProperty.call(s.frozen, key(r, c));
  }

  // 规则 1：冰冻格不可作为连通端点
  function canMatch(state, r1, c1, r2, c2) {
    return canSelect(state, r1, c1) && canSelect(state, r2, c2);
  }

  // 规则 3：登记冻结预警（不冻结牌本身；到点与否由调用方用 isTelegraphActive 判断）
  function telegraph(state, r, c, now, durationMs) {
    var s = clone(normalize(state));
    if (isCoord(r) && isCoord(c) && isTime(now) &&
        isTime(durationMs) && durationMs > 0 &&
        !Object.prototype.hasOwnProperty.call(s.frozen, key(r, c))) {
      s.telegraphs[key(r, c)] = { until: now + durationMs };
    }
    return s;
  }

  // 预警是否仍在进行中（尚未期满；期满即返回 false）
  function isTelegraphActive(state, r, c, now) {
    var s = normalize(state);
    var e = s.telegraphs[key(r, c)];
    return !!e && isTime(now) && now < e.until;
  }

  // 冻结：预警期满才生效；同屏上限 4；重复冻结拒绝。applied=false 时状态原样返回。
  // 落位血量 hp=FREEZE_HP（issue #49）。返回值契约：freeze 信封 {state, applied}。
  function freeze(state, r, c, now) {
    var s = normalize(state);
    var k = key(r, c);
    var ok = isCoord(r) && isCoord(c) && isTime(now) &&
      !Object.prototype.hasOwnProperty.call(s.frozen, k) &&
      Object.keys(s.frozen).length < MAX_FROZEN &&
      Object.prototype.hasOwnProperty.call(s.telegraphs, k) &&
      now >= s.telegraphs[k].until;
    if (!ok) return { state: s, applied: false };
    s.frozen[k] = { at: now, hp: FREEZE_HP };
    delete s.telegraphs[k];
    return { state: s, applied: true };
  }

  // 规则 2（issue #49 HP=2 版）：单格裂冰，hp-1。hp=2 → hp=1（裂纹态）；hp=1 → 解冻移除。
  // 返回值契约（与 freeze 同为信封式）：
  //   { state: <新状态>, cracked: <本次进入裂纹态>, broken: <本次解冻移除> }
  // 未冻结格：state 归一后原样返回，cracked/broken 均 false。入参不被修改。
  function crack(state, r, c) {
    var s = clone(normalize(state));
    var k = key(r, c);
    var e = s.frozen[k];
    if (!e) return { state: s, cracked: false, broken: false };
    e.hp -= 1;
    if (e.hp <= 0) {
      delete s.frozen[k];
      return { state: s, cracked: false, broken: true };
    }
    return { state: s, cracked: true, broken: false };
  }

  // 规则 2：成功消除后，对被消两牌的正交四邻（不含对角）冰冻格各裂冰一次（hp-1）。
  // 同格同时邻接两消牌时只裂一次（与旧 thawAround 的单次语义对齐：一次消除 = 一次裂冰）。
  // 返回值契约：{ state: <新状态>, cracked: [裂纹格 {r,c}], broken: [解冻格 {r,c}] }，供渲染/音效。
  function crackAround(state, r1, c1, r2, c2) {
    var s = clone(normalize(state));
    var cracked = [], broken = [];
    var seen = {};
    orthogonalKeys(r1, c1).concat(orthogonalKeys(r2, c2)).forEach(function (k) {
      if (seen[k] || !Object.prototype.hasOwnProperty.call(s.frozen, k)) return;
      seen[k] = true;
      var p = parseKey(k);
      var out = crack(s, p.r, p.c);
      s = out.state;
      if (out.cracked) cracked.push(p);
      else if (out.broken) broken.push(p);
    });
    return { state: s, cracked: cracked, broken: broken };
  }

  // 兼容保留（issue #31 接线口径名）：语义 = crackAround 的 state 分量。
  // 注意 HP=2 后此函数不再保证「一次消除即解冻」，仅作四邻裂冰后的状态投影。
  function thawAround(state, r1, c1, r2, c2) {
    return crackAround(state, r1, c1, r2, c2).state;
  }

  function countFrozen(state) {
    return Object.keys(normalize(state).frozen).length;
  }

  // 按冻结时间升序（等时按登记顺序稳定排序），供渲染与回滚
  function frozenList(state) {
    var s = normalize(state);
    return Object.keys(s.frozen).map(function (k) {
      var p = parseKey(k);
      return { r: p.r, c: p.c, at: s.frozen[k].at, hp: s.frozen[k].hp };
    }).sort(function (a, b) { return a.at - b.at; });
  }

  // 裂纹态（hp < FREEZE_HP）列表，供渲染 .tile-frozen.cracked（issue #49）
  function crackedList(state) {
    return frozenList(state).filter(function (e) { return e.hp < FREEZE_HP; });
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

  function collectValues(grid) {
    var counts = {};
    for (var r = 0; r < grid.length; r++) {
      var row = grid[r];
      for (var c = 0; c < row.length; c++) {
        var v = row[c];
        if (v > 0) counts[v] = (counts[v] || 0) + 1;
      }
    }
    return counts;
  }

  function cloneGrid(grid) {
    return grid.map(function (row) { return row.slice(); });
  }

  // 盘面是否仍可解（与 link3d.hasSolvablePair 同一定义：存在至少一对可连同类牌）：
  // 冰冻格（内容格 1-based → 扩展网格 0-based）视同占用障碍——不可作端点、连线不可穿越。
  // link3d 为注入依赖（js/link3d.js 模块对象），需含 findPath。
  // grid 采用 link3d 扩展网格坐标（含外圈边框，0-based）。空盘面视为可解。
  function isBoardSolvable(state, grid, link3d) {
    var s = normalize(state);
    if (!link3d || typeof link3d.findPath !== 'function') return false;
    if (!Array.isArray(grid) || grid.length < 3 ||
        !grid[0] || typeof grid[0].length !== 'number' || grid[0].length < 3) return false;

    var work = cloneGrid(grid);
    var frozenKeys = Object.keys(s.frozen);
    for (var i = 0; i < frozenKeys.length; i++) {
      var p = parseKey(frozenKeys[i]);
      var gr = p.r, gc = p.c; // 内容格 1-based == 扩展网格 0-based（外圈边框占索引 0）
      if (gr >= 1 && gr < grid.length - 1 && gc >= 1 && gc < grid[0].length - 1) {
        if (!work[gr][gc]) return false; // 冰冻格必须是占位牌，数据异常判为不可解
        work[gr][gc] = -1;
      }
    }

    var counts = collectValues(work);
    var values = Object.keys(counts);
    var total = 0;
    for (var vi = 0; vi < values.length; vi++) total += counts[values[vi]];
    if (total === 0) return true; // 盘面已清空

    for (var v2 = 0; v2 < values.length; v2++) {
      var v = +values[v2];
      var positions = [];
      for (var r = 0; r < work.length; r++) {
        for (var c = 0; c < work[r].length; c++) {
          if (work[r][c] === v) positions.push({ r: r, c: c });
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

  return {
    MAX_FROZEN: MAX_FROZEN,
    FREEZE_HP: FREEZE_HP,
    create: create,
    canSelect: canSelect,
    canMatch: canMatch,
    telegraph: telegraph,
    isTelegraphActive: isTelegraphActive,
    freeze: freeze,
    crack: crack,
    crackAround: crackAround,
    thawAround: thawAround,
    countFrozen: countFrozen,
    frozenList: frozenList,
    crackedList: crackedList,
    snapshot: snapshot,
    restore: restore,
    isBoardSolvable: isBoardSolvable
  };
});
