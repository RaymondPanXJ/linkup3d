/**
 * hint.js — 提示系统与新手引导的纯逻辑层（无 DOM 依赖）
 *
 * 包含：
 *   1) describePath(path[, grid]) -> 一句话中文描述路径拓扑
 *      （直线 / 一次转弯 / 两次转弯 + 是否绕行棋盘外框）
 *   2) 引导状态机：STEPS / nextStep(step, action)，step 从 1 开始，
 *      返回 0 表示引导结束（或跳过）。
 *   3) HINTS_PER_GAME：每局提示次数（不持久化，重开一局即重置）。
 *
 * 该文件同时可在浏览器（window.Hint）与 Node（module.exports）中使用。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Hint = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var HINTS_PER_GAME = 3;
  var TUT_KEY = 'linkup3d.tutorial';

  /* ---------------- describePath ---------------- */

  function isPoint(p) {
    return p && typeof p.r === 'number' && typeof p.c === 'number' &&
      isFinite(p.r) && isFinite(p.c) &&
      Math.floor(p.r) === p.r && Math.floor(p.c) === p.c;
  }

  /** 折叠连续重复点（零长度段），返回新数组 */
  function collapse(path) {
    var out = [path[0]];
    for (var i = 1; i < path.length; i++) {
      var prev = out[out.length - 1];
      if (path[i].r !== prev.r || path[i].c !== prev.c) out.push(path[i]);
    }
    return out;
  }

  /**
   * 描述一条连连路径（findPath 的返回值，仅含端点与拐点）。
   * 返回形如「一次转弯连接，绕行棋盘外框」的一句话。
   *
   * grid 可选：提供时用扩展网格尺寸精确判定外框绕行（含 r=rows+1 /
   * c=cols+1 一侧）；省略时仅能按 r<=0 / c<=0 判定边框侧绕行。
   * 非法路径（点序不足、坐标非法、折线段、转弯超过两次）抛出 Error。
   */
  function describePath(path, grid) {
    if (!Array.isArray(path) || path.length < 2) {
      throw new Error('invalid path: expected an array of at least 2 points');
    }
    for (var i = 0; i < path.length; i++) {
      if (!isPoint(path[i])) {
        throw new Error('invalid path: point ' + i +
          ' must have integer r/c coordinates');
      }
    }
    var pts = collapse(path);
    if (pts.length < 2) {
      throw new Error('invalid path: all points coincide');
    }
    for (var s = 0; s < pts.length - 1; s++) {
      var p1 = pts[s], p2 = pts[s + 1];
      if (p1.r !== p2.r && p1.c !== p2.c) {
        throw new Error('invalid path: segment ' + s + ' is not axis-aligned');
      }
    }

    var turns = 0;
    for (var t = 1; t < pts.length - 1; t++) {
      var prev = pts[t - 1], cur = pts[t], next = pts[t + 1];
      var dPrev = prev.r === cur.r ? 'h' : 'v';
      var dNext = next.r === cur.r ? 'h' : 'v';
      if (dPrev !== dNext) turns++;
    }
    if (turns > 2) {
      throw new Error('invalid path: more than 2 turns (' + turns + ')');
    }

    var desc = turns === 0 ? '直线连接' :
      turns === 1 ? '一次转弯连接' : '两次转弯连接';

    // 绕行外框判定：路径经过的任何格子（不含两个端点）落在内容区之外
    if (touchesFrame(pts, grid)) desc += '，绕行棋盘外框';
    return desc;
  }

  function touchesFrame(pts, grid) {
    var rows, cols;
    if (grid && grid.length >= 3 && grid[0] && grid[0].length >= 3) {
      rows = grid.length - 2;
      cols = grid[0].length - 2;
    }
    for (var s = 0; s < pts.length - 1; s++) {
      var p1 = pts[s], p2 = pts[s + 1];
      var dr = Math.sign(p2.r - p1.r), dc = Math.sign(p2.c - p1.c);
      var r = p1.r, c = p1.c;
      while (r !== p2.r || c !== p2.c) {
        // 跳过起点（端点必为内容区的牌），终点在最后一段结束时才检查
        if (!(s === 0 && r === pts[0].r && c === pts[0].c)) {
          if (isFrameCell(r, c, rows, cols)) return true;
        }
        r += dr; c += dc;
      }
      if (isFrameCell(p2.r, p2.c, rows, cols)) return true;
    }
    return false;
  }

  function isFrameCell(r, c, rows, cols) {
    if (rows !== undefined) {
      return r <= 0 || r >= rows + 1 || c <= 0 || c >= cols + 1;
    }
    // 无网格信息：只有 0 一侧的边框可辨认
    return r <= 0 || c <= 0;
  }

  /* ---------------- 引导状态机 ---------------- */

  // step 从 1 计；0 = 未开始 / 已结束
  var STEPS = [
    {
      title: '欢迎来到 3D 连连看',
      text: '点选两张相同图案的牌，只要能用转弯不超过两次的折线连通，就能消除得分。'
    },
    {
      title: '试试看',
      text: '先点一张牌让它高亮，再点另一张同图案的牌。连续快速消除还能触发连击加成。'
    },
    {
      title: '认识 HUD 按钮',
      text: '顶部可切换难度（简单 / 标准 / 困难）、重新开始、♪ 音乐与 🔊 静音、◐ 主题切换（深空 / 浅色 / 霓虹）；💡 提示每局 3 次，会高亮一对可连的牌并解释为什么能连。'
    },
    {
      title: '更多玩法',
      text: '试试顶部的「限时 120s」挑战模式和「◐」主题切换，还有 💡 提示与「排行」本地排行榜。准备好了吗？开始你的第一次消除吧！'
    }
  ];

  /**
   * 状态机：nextStep(step, action) -> 下一步（0 = 结束）。
   * action: 'next' 进入下一步（最后一步之后结束）；'skip' 任意步直接结束。
   */
  function nextStep(step, action) {
    if (!Number.isInteger(step) || step < 0 || step > STEPS.length) {
      throw new Error('invalid step: ' + step);
    }
    if (action === 'skip') return 0;
    if (action === 'next') return step >= STEPS.length ? 0 : step + 1;
    throw new Error('invalid action: ' + action);
  }

  return {
    HINTS_PER_GAME: HINTS_PER_GAME,
    TUT_KEY: TUT_KEY,
    describePath: describePath,
    STEPS: STEPS,
    nextStep: nextStep
  };
});
