/**
 * tests/combo.define.js — 连击计分与最高分纯函数用例（issue #8）
 * 运行：node tests/run-tests.js
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../js/combo.js'));
  } else {
    root.ComboTests = factory(root.Combo);
  }
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';

  function case_(name, pass, detail) {
    return { name: name, pass: !!pass, detail: detail || (pass ? 'ok' : 'FAILED') };
  }

  // 用例C1 连击递增：间隔 ≤ 5000ms 时 combo +1
  function c1() {
    var ok = C.nextCombo(1, 0) === 2 &&
             C.nextCombo(2, 4999) === 3 &&
             C.nextCombo(0, 100) === 2 &&   // 首次消除前（0 态）同样进入 x2 判定路径
             C.nextCombo(null, 100) === 2;
    return case_('用例C1 连击递增（间隔 ≤5s combo+1）', ok);
  }

  // 用例C2 得分封顶：得分 = 15 * min(combo, 5)
  function c2() {
    var ok = C.comboScore(1) === 15 &&
             C.comboScore(2) === 30 &&
             C.comboScore(3) === 45 &&
             C.comboScore(5) === 75 &&
             C.comboScore(6) === 75 &&
             C.comboScore(99) === 75 &&
             C.BASE_SCORE === 15 && C.MAX_COMBO === 5;
    return case_('用例C2 得分公式 15*min(combo,5)，combo 显示/得分封顶', ok);
  }

  // 用例C3 超时归 1：间隔 > 5000ms 重置
  function c3() {
    var ok = C.nextCombo(4, 5001) === 1 &&
             C.nextCombo(5, 60000) === 1 &&
             C.nextCombo(3, 5000) === 4; // 恰好等于窗口仍算连续
    return case_('用例C3 超窗（>5s）combo 归 1，恰 5s 仍连续', ok);
  }

  // 用例C4 点错归 1
  function c4() {
    return case_('用例C4 点错一对 combo 归 1', C.applyMismatch() === 1);
  }

  // 用例C5 applyMatch 组合行为：递增 + 得分 + 长连击链
  function c5() {
    var combo = 0, score = 0;
    var seq = [100, 100, 100, 100, 100, 100, 9000, 100]; // 6 次快消 + 1 次超时 + 1 次快消
    var expected = [[2, 30], [3, 45], [4, 60], [5, 75], [6, 75], [7, 75], [1, 15], [2, 30]];
    var ok = true;
    for (var i = 0; i < seq.length; i++) {
      var r = C.applyMatch(combo, seq[i]);
      if (r.combo !== expected[i][0] || r.points !== expected[i][1]) { ok = false; break; }
      combo = r.combo;
      score += r.points;
    }
    return case_('用例C5 applyMatch 连击链（递增/封顶75/超时归1）', ok,
      '总分=' + score);
  }

  // 用例C6 HUD 显示：combo≥2 显示 xN，否则 —；isActive 与之一致
  function c6() {
    var ok = C.displayCombo(0) === '—' &&
             C.displayCombo(1) === '—' &&
             C.displayCombo(2) === 'x2' &&
             C.displayCombo(7) === 'x7' &&
             C.isActive(1) === false && C.isActive(2) === true;
    return case_('用例C6 HUD 显示规则（x3 样式 / combo≥2 激活）', ok);
  }

  // 用例C7 最高分存储键：linkup3d.best.<easy|standard|hard>
  function c7() {
    var ok = C.bestKey('easy') === 'linkup3d.best.easy' &&
             C.bestKey('normal') === 'linkup3d.best.standard' &&
             C.bestKey('hard') === 'linkup3d.best.hard' &&
             C.bestKey('未知') === 'linkup3d.best.standard'; // 非法值回退标准档
    return case_('用例C7 最高分键 linkup3d.best.<easy|standard|hard>', ok);
  }

  // 用例C8 破纪录判定与纪录更新（纯函数）
  function c8() {
    var ok = C.isRecord(100, null) === true &&    // 首局即建档
             C.isRecord(100, 90) === true &&
             C.isRecord(100, 100) === false &&    // 平纪录不算破
             C.isRecord(99, 100) === false &&
             C.updateBest(120, 100) === 120 &&
             C.updateBest(80, 100) === 100 &&
             C.updateBest(50, null) === 50;
    return case_('用例C8 破纪录判定 + 纪录更新', ok);
  }

  return {
    runAll: function () {
      return [c1(), c2(), c3(), c4(), c5(), c6(), c7(), c8()];
    }
  };
});
