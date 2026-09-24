/**
 * combo.js — 连击计分与分难度最高分（纯函数，无 DOM 依赖）
 *
 * 规则（对应 issue #8）：
 *   - 连续消除间隔 ≤ 5 秒（gap <= COMBO_WINDOW）则 combo 递增；
 *   - 间隔 > 5 秒或点错一对，combo 归 1；
 *   - 得分 = BASE_SCORE * min(combo, MAX_COMBO) = 15 * min(combo, 5)；
 *   - 最高分按难度分开记：linkup3d.best.<easy|standard|hard>。
 *
 * 该文件同时可在浏览器（window.Combo）与 Node（module.exports）中使用。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Combo = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var COMBO_WINDOW = 5000; // 连击窗口（毫秒），间隔 ≤ 该值视为连续
  var BASE_SCORE = 15;     // 单次消除基础分
  var MAX_COMBO = 5;       // 得分与显示封顶的连击数

  // 难度键 -> 最高分存储档位。内部难度键为 easy/normal/hard，
  // 其中 normal 档对外名称为 standard（存储键 linkup3d.best.standard）。
  var BEST_TIERS = { easy: 'easy', normal: 'standard', hard: 'hard' };

  // combo 状态恒 >= 1（0 仅表示「本局尚未消除」，等价于无连击）
  function nextCombo(combo, gapMs) {
    var cur = combo || 1;
    return gapMs <= COMBO_WINDOW ? cur + 1 : 1;
  }

  function comboScore(combo) {
    return BASE_SCORE * Math.min(combo || 1, MAX_COMBO);
  }

  function displayCombo(combo) {
    return combo >= 2 ? 'x' + combo : '—';
  }

  // 消除一次：返回 {combo, points}
  function applyMatch(combo, gapMs) {
    var next = nextCombo(combo, gapMs);
    return { combo: next, points: comboScore(next) };
  }

  // 点错一对：连击立即归 1
  function applyMismatch() {
    return 1;
  }

  // 消除后 HUD 是否应显示连击（combo >= 2）
  function isActive(combo) {
    return combo >= 2;
  }

  // 难度 -> 最高分 localStorage 键
  function bestKey(difficulty) {
    var tier = BEST_TIERS[difficulty] || BEST_TIERS.normal;
    return 'linkup3d.best.' + tier;
  }

  // 是否破纪录；storedBest 为 null/undefined 表示尚无记录（破纪录）
  function isRecord(score, storedBest) {
    return storedBest == null || score > storedBest;
  }

  // 破纪录时返回新纪录分，否则原样返回存储值（纯函数，不写存储）
  function updateBest(score, storedBest) {
    return isRecord(score, storedBest) ? score : storedBest;
  }

  return {
    COMBO_WINDOW: COMBO_WINDOW,
    BASE_SCORE: BASE_SCORE,
    MAX_COMBO: MAX_COMBO,
    BEST_TIERS: BEST_TIERS,
    nextCombo: nextCombo,
    comboScore: comboScore,
    displayCombo: displayCombo,
    applyMatch: applyMatch,
    applyMismatch: applyMismatch,
    isActive: isActive,
    bestKey: bestKey,
    isRecord: isRecord,
    updateBest: updateBest
  };
});
