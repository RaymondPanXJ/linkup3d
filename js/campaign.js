/**
 * campaign.js — 《连星远航》战役数据表与关卡纯函数（无 DOM / 无存储副作用）
 *
 * 规则（对应 issue #25，设计决策已由 TechLead 定稿）：
 *   - LEVELS 为 10 关数据表，字段固定：
 *     {id, name, rows, cols, pairs, timeLimitSec, parSec, frost, hunter}；
 *   - timeLimitSec = 0 表示不限时（第 0 关「冷眠醒转」）；
 *   - frost 为冰封格列表 [{r, c}]，坐标使用游戏内 1-based 内容格坐标
 *     （即不含 link3d.js 扩展网格的外圈空边框）；
 *   - hunter = {cadenceMs, telegraphMs} 或 null（无巡猎者）；
 *   - 解锁规则：第 0 关恒解锁，第 i 关需前一关获得 ≥1 星；
 *   - 星级规则：≤parSec = 3 星，≤parSec×1.5 = 2 星，其余（已通关）= 1 星，
 *     未通关（timeUsed ≤ 0）= 0 星；
 *   - validateLevel(def) 非法即抛 Error，用于数据表自检与后续内容管线校验。
 *
 * 该文件同时可在浏览器（window.Campaign）与 Node（module.exports）中使用。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Campaign = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------------- 关卡数据表（TechLead 基线，不得随意改动） ---------------- */
  /*
   * frost 固定格为自选合法位置（均在对应盘面 1-based 范围内、互不重复），
   * 选取原则：对称分布、避开盘面四角，避免开局即封死边缘连线位。
   *   L2 霜纹初现   4×6：对角对称 (2,2) (3,5)
   *   L5 双子冰缝   6×8：四角对称 (2,2) (2,7) (5,2) (5,7)
   *   L8 冰下回声   6×8：横向对称 (3,3) (4,6)
   */
  var LEVELS = [
    {
      id: 0, name: '冷眠醒转', rows: 4, cols: 4, pairs: 8,
      timeLimitSec: 0, parSec: 60,
      frost: [], hunter: null
    },
    {
      id: 1, name: '微光航道', rows: 4, cols: 6, pairs: 12,
      timeLimitSec: 180, parSec: 90,
      frost: [], hunter: null
    },
    {
      id: 2, name: '霜纹初现', rows: 4, cols: 6, pairs: 12,
      timeLimitSec: 180, parSec: 100,
      frost: [{ r: 2, c: 2 }, { r: 3, c: 5 }], hunter: null
    },
    {
      id: 3, name: '巡猎初鸣', rows: 4, cols: 6, pairs: 12,
      timeLimitSec: 240, parSec: 150,
      frost: [], hunter: { cadenceMs: 25000, telegraphMs: 3000 }
    },
    {
      id: 4, name: '冰湖', rows: 4, cols: 6, pairs: 12,
      timeLimitSec: 240, parSec: 150,
      frost: [], hunter: { cadenceMs: 20000, telegraphMs: 3000 }
    },
    {
      id: 5, name: '双子冰缝', rows: 6, cols: 8, pairs: 24,
      timeLimitSec: 300, parSec: 200,
      frost: [{ r: 2, c: 2 }, { r: 2, c: 7 }, { r: 5, c: 2 }, { r: 5, c: 7 }],
      hunter: null
    },
    {
      id: 6, name: '极夜', rows: 6, cols: 8, pairs: 24,
      timeLimitSec: 360, parSec: 240,
      frost: [], hunter: { cadenceMs: 30000, telegraphMs: 3000 }
    },
    {
      id: 7, name: '白毛风', rows: 6, cols: 8, pairs: 24,
      timeLimitSec: 360, parSec: 260,
      frost: [], hunter: { cadenceMs: 22000, telegraphMs: 3000 }
    },
    {
      id: 8, name: '冰下回声', rows: 6, cols: 8, pairs: 24,
      timeLimitSec: 420, parSec: 300,
      frost: [{ r: 3, c: 3 }, { r: 4, c: 6 }],
      hunter: { cadenceMs: 18000, telegraphMs: 3000 }
    },
    {
      id: 9, name: '星核之眼', rows: 6, cols: 8, pairs: 24,
      timeLimitSec: 480, parSec: 340,
      frost: [], hunter: { cadenceMs: 15000, telegraphMs: 2500 }
    }
  ];

  /* ---------------- 基础校验工具 ---------------- */
  function isInt(v) {
    return typeof v === 'number' && isFinite(v) && Math.floor(v) === v;
  }

  function isPosInt(v) {
    return isInt(v) && v > 0;
  }

  function isNonNegInt(v) {
    return isInt(v) && v >= 0;
  }

  function isFrostCell(cell) {
    return !!cell && typeof cell === 'object' && isPosInt(cell.r) && isPosInt(cell.c);
  }

  /* ---------------- 关卡校验（非法即抛 Error） ---------------- */
  function validateLevel(def) {
    if (!def || typeof def !== 'object' || Array.isArray(def)) {
      throw new Error('关卡定义必须为对象');
    }
    var required = ['id', 'name', 'rows', 'cols', 'pairs',
      'timeLimitSec', 'parSec', 'frost', 'hunter'];
    for (var i = 0; i < required.length; i++) {
      if (!(required[i] in def)) throw new Error('缺少字段: ' + required[i]);
    }
    if (!isNonNegInt(def.id)) throw new Error('id 必须为非负整数: ' + def.id);
    if (typeof def.name !== 'string' || !def.name) {
      throw new Error('name 必须为非空字符串: ' + def.name);
    }
    // 盘面 ≥4×4：与 link3d.js 尺寸校验（偶数、正整数）及现有难度档位一致
    if (!isPosInt(def.rows) || def.rows < 4) {
      throw new Error('盘面行数必须为 ≥4 的整数: ' + def.rows);
    }
    if (!isPosInt(def.cols) || def.cols < 4) {
      throw new Error('盘面列数必须为 ≥4 的整数: ' + def.cols);
    }
    if (!isPosInt(def.pairs) || def.pairs * 2 > def.rows * def.cols) {
      throw new Error('对数非法或超出盘面: pairs=' + def.pairs +
        ' 盘面=' + def.rows + 'x' + def.cols);
    }
    if (typeof def.timeLimitSec !== 'number' || !isFinite(def.timeLimitSec) ||
        def.timeLimitSec < 0) {
      throw new Error('timeLimitSec 必须为 ≥0 的数值（0 = 不限时）: ' + def.timeLimitSec);
    }
    if (!isPosInt(def.parSec)) throw new Error('parSec 必须为正整数: ' + def.parSec);
    if (!Array.isArray(def.frost)) throw new Error('frost 必须为数组');
    var seen = {};
    for (var j = 0; j < def.frost.length; j++) {
      var cell = def.frost[j];
      if (!isFrostCell(cell)) {
        throw new Error('frost[' + j + '] 必须为 {r, c} 正整数格（1-based）');
      }
      if (cell.r > def.rows || cell.c > def.cols) {
        throw new Error('frost[' + j + '] 越界 (' + cell.r + ',' + cell.c +
          ') 盘面=' + def.rows + 'x' + def.cols);
      }
      var key = cell.r + ':' + cell.c;
      if (seen[key]) throw new Error('frost 存在重复格: ' + key);
      seen[key] = true;
    }
    if (def.hunter !== null) {
      var h = def.hunter;
      if (!h || typeof h !== 'object') {
        throw new Error('hunter 必须为 {cadenceMs, telegraphMs} 或 null');
      }
      if (!isPosInt(h.cadenceMs)) {
        throw new Error('hunter.cadenceMs 必须为正整数: ' + h.cadenceMs);
      }
      if (!isPosInt(h.telegraphMs)) {
        throw new Error('hunter.telegraphMs 必须为正整数: ' + h.telegraphMs);
      }
      if (h.telegraphMs >= h.cadenceMs) {
        throw new Error('hunter.telegraphMs 必须小于 cadenceMs: ' +
          h.telegraphMs + ' >= ' + h.cadenceMs);
      }
    }
    return true;
  }

  // 自检整张数据表（含索引连续性），任一非法即抛
  function validateAll(levels) {
    var list = Array.isArray(levels) ? levels : LEVELS;
    for (var i = 0; i < list.length; i++) {
      validateLevel(list[i]);
      if (list[i].id !== i) {
        throw new Error('关卡 id 与索引不一致: LEVELS[' + i + '].id=' + list[i].id);
      }
    }
    return true;
  }

  /* ---------------- 解锁 / 推进 ---------------- */
  function levelAt(idx) {
    return (Number.isInteger(idx) && idx >= 0 && idx < LEVELS.length)
      ? LEVELS[idx] : null;
  }

  function starsAt(progress, idx) {
    var entry = progress && progress.levels
      ? progress.levels[String(idx)] : null;
    return entry && isInt(entry.stars) ? Math.max(0, entry.stars) : 0;
  }

  // 第 0 关恒解锁；第 i 关需第 i-1 关 ≥1 星
  function isUnlocked(idx, progress) {
    if (!Number.isInteger(idx) || idx < 0 || idx >= LEVELS.length) return false;
    if (idx === 0) return true;
    return starsAt(progress, idx - 1) >= 1;
  }

  // 下一关（已到末关或非法索引返回 null）
  function nextLevel(idx) {
    if (!Number.isInteger(idx) || idx < 0 || idx + 1 >= LEVELS.length) return null;
    return LEVELS[idx + 1];
  }

  /* ---------------- 星级 ---------------- */
  // ≤par = 3 星；≤par×1.5 = 2 星；其余已通关 = 1 星；未通关（≤0）= 0 星
  function starsFor(parSec, timeUsed) {
    if (!isPosInt(parSec)) throw new Error('parSec 必须为正整数: ' + parSec);
    if (typeof timeUsed !== 'number' || !isFinite(timeUsed) || timeUsed <= 0) return 0;
    if (timeUsed <= parSec) return 3;
    if (timeUsed <= parSec * 1.5) return 2;
    return 1;
  }

  return {
    LEVELS: LEVELS,
    validateLevel: validateLevel,
    validateAll: validateAll,
    levelAt: levelAt,
    isUnlocked: isUnlocked,
    nextLevel: nextLevel,
    starsFor: starsFor
  };
});
