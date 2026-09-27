/**
 * tests/frost.define.js — 冻冰状态层纯函数用例（issue #27）
 * 覆盖规则 1-5 全部边界：不可选中/不可作端点、正交四邻解冻（不含对角）、
 * 预警期满才可冻结、同屏上限 4、重复冻结拒绝、快照往返、可解性判定接口。
 * 运行：node tests/run-tests.js
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../js/frost.js'), require('../js/link3d.js'));
  } else {
    root.FrostTests = factory(root.Frost, root.L3D || root.link3d);
  }
})(typeof self !== 'undefined' ? self : this, function (F, L) {
  'use strict';

  function case_(name, pass, detail) {
    return { name: name, pass: !!pass, detail: detail || (pass ? 'ok' : 'FAILED') };
  }

  // 辅助：telegraph + 到期满 freeze，得到 (r,c) 已冻结的新状态
  function frozenAt(state, r, c, t) {
    var s = F.telegraph(state, r, c, t, 1000);
    var res = F.freeze(s, r, c, t + 1000);
    return res.applied ? res.state : state;
  }

  // 用例F1 create：空状态、计数 0、列表空
  function f1() {
    var s = F.create();
    return case_('用例F1 create 返回可序列化空状态（计数0/列表空）',
      s && typeof s === 'object' && F.countFrozen(s) === 0 &&
      Array.isArray(F.frozenList(s)) && F.frozenList(s).length === 0);
  }

  // 用例F2 规则1 canSelect：未冻可选、冰冻不可选、两次邻近消除破裂后恢复可选（issue #49 更新）
  function f2() {
    var s = frozenAt(F.create(), 2, 3, 1000);
    var ok = F.canSelect(s, 2, 3) === false &&
      F.canSelect(s, 2, 4) === true &&
      F.canSelect(F.create(), 1, 1) === true;
    var once = F.crackAround(s, 2, 2, 5, 5); // (2,3) 与 (2,2) 正交相邻，第一次裂冰仍不可选
    var twice = F.crackAround(once.state, 2, 2, 5, 5); // 第二次破裂解冻
    return case_('用例F2 规则1 冰冻不可选中 / 裂纹态仍不可选 / 破裂后恢复可选',
      ok && F.canSelect(once.state, 2, 3) === false &&
      F.canSelect(twice.state, 2, 3) === true);
  }

  // 用例F3 规则1 canMatch：任一端点冰冻即 false，双端未冻 true
  function f3() {
    var s = frozenAt(F.create(), 2, 3, 1000);
    return case_('用例F3 规则1 canMatch 任一端点冰冻为 false / 双端未冻为 true',
      F.canMatch(s, 2, 3, 4, 4) === false &&
      F.canMatch(s, 4, 4, 2, 3) === false &&
      F.canMatch(s, 1, 1, 4, 4) === true);
  }

  // 用例F4 规则3 预警期内该牌仍可正常操作（telegraph 不冻结、不影响 canSelect）
  function f4() {
    var s = F.telegraph(F.create(), 2, 3, 1000, 3000);
    return case_('用例F4 规则3 预警期内仍可正常操作（canSelect 不受预警影响）',
      F.isTelegraphActive(s, 2, 3, 1500) === true &&
      F.canSelect(s, 2, 3) === true &&
      F.canMatch(s, 2, 3, 1, 1) === true &&
      F.countFrozen(s) === 0);
  }

  // 用例F5 规则3 isTelegraphActive：预警内 true，到点(=)与过期 false，未登记 false
  function f5() {
    var s = F.telegraph(F.create(), 2, 3, 1000, 3000);
    return case_('用例F5 规则3 预警到点判断：期内 true / 期满(≥) false / 未登记 false',
      F.isTelegraphActive(s, 2, 3, 1000) === true &&
      F.isTelegraphActive(s, 2, 3, 3999) === true &&
      F.isTelegraphActive(s, 2, 3, 4000) === false &&
      F.isTelegraphActive(s, 2, 3, 9999) === false &&
      F.isTelegraphActive(s, 9, 9, 2000) === false);
  }

  // 用例F6 规则3 freeze：无任何预警登记时拒绝冻结（必须先预警）
  function f6() {
    var res = F.freeze(F.create(), 2, 3, 5000);
    return case_('用例F6 规则3 无预警登记的 freeze 被拒绝（applied=false）',
      res.applied === false && F.countFrozen(res.state) === 0);
  }

  // 用例F7 规则3 freeze：预警未满拒绝；期满瞬间（now === until）生效
  function f7() {
    var s = F.telegraph(F.create(), 2, 3, 1000, 3000);
    var early = F.freeze(s, 2, 3, 3999);
    var exact = F.freeze(s, 2, 3, 4000);
    return case_('用例F7 规则3 预警未满不冻结 / 期满瞬间冻结生效',
      early.applied === false && F.countFrozen(early.state) === 0 &&
      exact.applied === true && F.countFrozen(exact.state) === 1 &&
      F.canSelect(exact.state, 2, 3) === false);
  }

  // 用例F8 freeze 成功后清除对应预警登记（不残留活动预警）
  function f8() {
    var s = F.telegraph(F.create(), 2, 3, 1000, 1000);
    var res = F.freeze(s, 2, 3, 2000);
    return case_('用例F8 freeze 生效后清除该格预警登记',
      res.applied === true && F.isTelegraphActive(res.state, 2, 3, 2000) === false);
  }

  // 用例F9 重复冻结拒绝：已冻结格再次预警+冻结 → applied=false 且时间不被覆盖
  function f9() {
    var s = frozenAt(F.create(), 2, 3, 1000);
    var s2 = F.telegraph(s, 2, 3, 5000, 1000); // 对已冻格登记预警应无效
    var res = F.freeze(s2, 2, 3, 6000);
    var list = F.frozenList(res.state);
    return case_('用例F9 重复冻结拒绝（applied=false，冻结时刻不被覆盖）',
      res.applied === false && F.countFrozen(res.state) === 1 &&
      list.length === 1 && list[0].at === 2000);
  }

  // 用例F10 规则4 上限4：第 5 个冻结动作直接跳过，后续全部跳过，计数封顶 4
  function f10() {
    var s = F.create();
    var applied = [];
    for (var c = 1; c <= 6; c++) {
      var t = F.telegraph(s, 2, c, 1000, 1000);
      var res = F.freeze(t, 2, c, 2000);
      applied.push(res.applied);
      if (res.applied) s = res.state;
    }
    return case_('用例F10 规则4 同屏上限4：前4个生效，第5/6个直接跳过',
      F.MAX_FROZEN === 4 &&
      applied.join(',') === 'true,true,true,true,false,false' &&
      F.countFrozen(s) === 4);
  }

  // 用例F11 规则2（issue #49 HP=2 更新）：crackAround 对正交四邻裂冰一次（hp-1），
  // 对角不裂；hp=2→hp=1 全部进入裂纹态（仍在 frozen 中，不可选），正交邻不入裂纹列表的是未冻结格
  function f11() {
    var s = F.create();
    // 先用 around 四邻验证 frozenAt 路径可用（上限 4 内全部冻结成功）
    var around = [[2, 2], [2, 4], [3, 3], [1, 3]];
    around.forEach(function (p, i) {
      s = frozenAt(s, p[0], p[1], 1000 + i);
    });
    // 直接构造含对角冻结的状态（hp=2），验证裂冰只影响正交四邻、对角血量不变
    var st = {
      frozen: {
        '2,2': { at: 1, hp: 2 }, '2,4': { at: 2, hp: 2 }, '3,3': { at: 3, hp: 2 }, '1,3': { at: 4, hp: 2 },
        '3,2': { at: 5, hp: 2 }, '3,4': { at: 6, hp: 2 }, '1,2': { at: 7, hp: 2 }, '1,4': { at: 8, hp: 2 }
      },
      telegraphs: {}
    };
    var out = F.crackAround(st, 2, 3, 6, 6); // 消除 (2,3) 与 (6,6)
    var crackedKeys = out.cracked.map(function (p) { return p.r + ',' + p.c; }).sort().join('|');
    var diagHp = ['3,2', '3,4', '1,2', '1,4'].every(function (k) { return out.state.frozen[k].hp === 2; });
    var orthoHp = ['2,2', '2,4', '3,3', '1,3'].every(function (k) { return out.state.frozen[k].hp === 1; });
    return case_('用例F11 规则2 crackAround 正交四邻裂冰(hp2→1裂纹态)、对角不裂（入参不变）',
      F.countFrozen(s) === 4 &&
      F.countFrozen(out.state) === 8 && // HP=2：裂冰不解冻，全部仍在 frozen 中
      crackedKeys === '1,3|2,2|2,4|3,3' &&
      out.broken.length === 0 && orthoHp && diagHp &&
      F.frozenList(st).length === 8 && st.frozen['3,2'].hp === 2, // 入参未被修改
      'cracked=' + crackedKeys);
  }

  // 用例F12b crackAround：同一次消除两牌各自四邻都裂冰；两次邻近消除才破裂解冻
  function f12b() {
    var s = frozenAt(F.create(), 2, 3, 1000);
    s = frozenAt(s, 5, 5, 1100);
    var r1 = F.crackAround(s, 2, 4, 5, 6); // (2,3)是(2,4)的正交邻，(5,5)是(5,6)的正交邻
    var r2 = F.crackAround(r1.state, 2, 4, 5, 6); // 第二次邻近消除 → 破裂解冻
    var noop = F.crackAround(F.create(), 1, 1, 2, 2);
    return case_('用例F12b crackAround 双端四邻均裂冰 / 两次消除破裂解冻 / 无冰冻时返回等价空态',
      F.countFrozen(r1.state) === 2 && r1.cracked.length === 2 && r1.broken.length === 0 &&
      F.countFrozen(r2.state) === 0 && r2.broken.length === 2 &&
      F.countFrozen(noop.state) === 0);
  }

  // 用例F13 纯函数：telegraph/freeze/crackAround 均不改入参、返回新状态（issue #49 更新）
  function f13() {
    var s0 = F.create();
    var s1 = F.telegraph(s0, 2, 3, 1000, 1000);
    var r2 = F.freeze(s1, 2, 3, 2000);
    var s3 = F.crackAround(r2.state, 2, 2, 9, 9).state;
    F.canSelect(s3, 1, 1);
    F.frozenList(s3);
    var ok = JSON.stringify(s0) === JSON.stringify(F.create()) &&
      Object.keys(s1.telegraphs).length === 1 && Object.keys(s1.frozen).length === 0 &&
      Object.keys(s3.frozen).length === 1 && s3.frozen['2,3'].hp === 1 && // 裂冰结果 hp=1
      r2.state.frozen['2,3'].hp === 2 && // 入参不被修改（仍 hp=2）
      r2.state !== s1;
    return case_('用例F13 纯函数：telegraph/freeze/crackAround 均不改入参、返回新状态', ok);
  }

  // 用例F14 frozenList 按冻结时间升序（等时保持登记顺序），字段 {r,c,at}
  function f14() {
    var st = {
      frozen: { '2,2': { at: 300 }, '1,1': { at: 100 }, '3,3': { at: 200 }, '4,4': { at: 100 } },
      telegraphs: {}
    };
    var list = F.frozenList(st);
    var seq = list.map(function (e) { return e.r + ',' + e.c + '@' + e.at; }).join('|');
    return case_('用例F14 frozenList 按 at 升序（等时稳定），元素含 r/c/at',
      seq === '1,1@100|4,4@100|3,3@200|2,2@300' &&
      list.every(function (e) {
        return typeof e.r === 'number' && typeof e.c === 'number' && typeof e.at === 'number';
      }));
  }

  // 用例F15 快照往返：snapshot→restore 深等价；损坏输入降级空态；restore 结果独立可改
  function f15() {
    var s = frozenAt(F.create(), 2, 3, 1000);
    s = F.telegraph(s, 4, 4, 5000, 1000);
    var snap = F.snapshot(s);
    var back = F.restore(snap);
    var roundtrip = JSON.stringify(back) === JSON.stringify(s);
    var bad1 = F.restore('{oops');
    var bad2 = F.restore('');
    var bad3 = F.restore(null);
    return case_('用例F15 snapshot/restore 往返一致，损坏输入安全降级空态',
      typeof snap === 'string' && roundtrip &&
      F.countFrozen(bad1) === 0 && F.countFrozen(bad2) === 0 && F.countFrozen(bad3) === 0);
  }

  // 用例F16 入参防御：null/畸形状态归一（不抛异常），非法坐标拒绝登记
  function f16() {
    var ok = F.countFrozen(null) === 0 &&
      F.canSelect(null, 1, 1) === true &&
      F.canSelect({ frozen: 'garbage' }, 1, 1) === true &&
      F.freeze(null, 1, 1, 1000).applied === false;
    var s = F.telegraph(F.create(), 0, 1, 1000, 1000); // r=0 非 1-based 内容格
    var s2 = F.telegraph(F.create(), 1.5, 1, 1000, 1000);
    var s3 = F.telegraph(F.create(), 1, 1, 1000, 0); // 预警时长必须 > 0
    return case_('用例F16 入参防御：null/畸形状态归一空态，非法坐标或时长不登记',
      ok && Object.keys(s.telegraphs).length === 0 &&
      Object.keys(s2.telegraphs).length === 0 &&
      Object.keys(s3.telegraphs).length === 0);
  }

  // 用例F17 规则5 isBoardSolvable：无冻可解 true；冰冻封死唯一可连对 → false
  function f17() {
    // 4×2 内容盘（扩展 6×4），图案1 位于内容 (2,1)(2,2)（扩展同索引）
    var g = L.createGrid(4, 2);
    g[2][1] = 1; g[2][2] = 1;
    var solvable = F.isBoardSolvable(F.create(), g, L);
    var st = { frozen: { '2,2': { at: 1 } }, telegraphs: {} };
    var blocked = F.isBoardSolvable(st, g, L);
    return case_('用例F17 规则5 可解性判定：开放盘面 true / 冰冻封死唯一对 false',
      solvable === true && blocked === false);
  }

  // 用例F18 规则5 边界：空盘面可解；缺失/非法 link3d 依赖 false；空盘面清空后回滚判定
  function f18() {
    var empty = F.isBoardSolvable(F.create(), L.createGrid(4, 2), L);
    var noDep = F.isBoardSolvable(F.create(), L.createGrid(4, 2), null);
    var badDep = F.isBoardSolvable(F.create(), L.createGrid(4, 2), {});
    var badGrid = F.isBoardSolvable(F.create(), [[0, 0]], L);
    return case_('用例F18 规则5 边界：空盘面 true / 非法依赖或网格 false',
      empty === true && noDep === false && badDep === false && badGrid === false);
  }

  // 用例F19 规则5 与裂冰联动（issue #49 更新）：裂纹态（hp=1）不解封，两次邻近消除破裂后
  // 可解性才恢复（调用方据此回滚冻结）
  function f19() {
    var g = L.createGrid(4, 2);
    g[2][1] = 1; g[2][2] = 1;
    var st = { frozen: { '2,2': { at: 1, hp: 2 } }, telegraphs: {} };
    var before = F.isBoardSolvable(st, g, L);
    var once = F.crackAround(st, 2, 1, 2, 3); // (2,2) 与 (2,1) 正交相邻，第一次裂冰
    var mid = F.isBoardSolvable(once.state, g, L);
    var twice = F.crackAround(once.state, 2, 1, 2, 3); // 第二次破裂解冻
    var after = F.isBoardSolvable(twice.state, g, L);
    return case_('用例F19 规则5 裂纹态仍封锁、破裂解冻后可解性恢复（回滚语义闭环）',
      before === false && mid === false && after === true);
  }

  // 用例F20（issue #49）crack 单格信封契约：未冻格 no-op / hp2→1 cracked / hp1→0 broken
  function f20() {
    var s = frozenAt(F.create(), 2, 3, 1000); // 冻结落位 hp=FREEZE_HP=2
    var none = F.crack(s, 5, 5);
    var c1 = F.crack(s, 2, 3);
    var c2 = F.crack(c1.state, 2, 3);
    return case_('用例F20 crack 契约：未冻格 no-op / hp2→1 cracked / hp1→0 broken（入参不变）',
      none.cracked === false && none.broken === false && F.countFrozen(none.state) === 1 &&
      c1.cracked === true && c1.broken === false && c1.state.frozen['2,3'].hp === 1 &&
      c2.broken === true && c2.cracked === false && F.countFrozen(c2.state) === 0 &&
      s.frozen['2,3'].hp === 2, // 入参未被修改
      'c1=' + c1.cracked + ' c2=' + c2.broken);
  }

  // 用例F21（issue #49）crackedList：仅列裂纹态（hp<FREEZE_HP），字段含 r/c/at/hp
  function f21() {
    var s = frozenAt(frozenAt(F.create(), 2, 3, 1000), 4, 4, 1100);
    var crackedOnly = F.crackedList(s); // 均为满血 hp=2 → 空
    var c1 = F.crack(s, 2, 3);
    var list = F.crackedList(c1.state);
    return case_('用例F21 crackedList 仅列裂纹态格（hp=1），满血不入列',
      crackedOnly.length === 0 &&
      list.length === 1 && list[0].r === 2 && list[0].c === 3 && list[0].hp === 1);
  }

  // 用例F22（issue #49）规则1 加强：裂纹态（hp=1）仍不可选、不可作连通端点
  function f22() {
    var s = F.crack(frozenAt(F.create(), 2, 3, 1000), 2, 3).state;
    return case_('用例F22 裂纹态 hp=1 仍拒绝 canSelect / canMatch（issue #49）',
      F.canSelect(s, 2, 3) === false &&
      F.canMatch(s, 2, 3, 1, 1) === false &&
      F.canSelect(s, 2, 4) === true);
  }

  // 用例F23（issue #49）兼容：旧存档冻结条目无 hp 字段视为满血；hp<=0 条目丢弃
  function f23() {
    var legacy = { frozen: { '2,3': { at: 100 } }, telegraphs: {} };
    var full = F.crack(legacy, 2, 3); // 无 hp → 视为满血，第一次裂冰只到 hp=1
    var dead = F.restore(JSON.stringify({ frozen: { '1,1': { at: 1, hp: 0 } }, telegraphs: {} }));
    return case_('用例F23 兼容：无 hp 旧条目视为满血 / hp<=0 条目归一时丢弃',
      full.cracked === true && full.broken === false && full.state.frozen['2,3'].hp === 1 &&
      F.countFrozen(dead) === 0);
  }

  return {
    runAll: function () {
      return [f1(), f2(), f3(), f4(), f5(), f6(), f7(), f8(), f9(),
              f10(), f11(), f12b(), f13(), f14(), f15(), f16(),
              f17(), f18(), f19(), f20(), f21(), f22(), f23()];
    }
  };
});
