/**
 * tests/ranking.define.js — 本地排行榜 Top10 纯函数用例（issue #13）
 * 运行：node tests/run-tests.js
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../js/ranking.js'));
  } else {
    root.RankingTests = factory(root.Ranking);
  }
})(typeof self !== 'undefined' ? self : this, function (R) {
  'use strict';

  function case_(name, pass, detail) {
    return { name: name, pass: !!pass, detail: detail || (pass ? 'ok' : 'FAILED') };
  }

  function entry(score, seconds, maxCombo, ts) {
    return R.createEntry(score, seconds, maxCombo, ts);
  }

  // 用例R1 存储键：linkup3d.rank.<easy|standard|hard>，非法难度回退标准档
  function r1() {
    var ok = R.rankKey('easy') === 'linkup3d.rank.easy' &&
             R.rankKey('normal') === 'linkup3d.rank.standard' &&
             R.rankKey('hard') === 'linkup3d.rank.hard' &&
             R.rankKey('未知') === 'linkup3d.rank.standard';
    return case_('用例R1 存储键 linkup3d.rank.<easy|standard|hard>', ok);
  }

  // 用例R2 插入排序：乱序插入后按得分降序，容量内全保留
  function r2() {
    var list = [];
    [100, 300, 200, 50].forEach(function (s, i) {
      list = R.insert(list, entry(s, 60, 1, 1000 + i));
    });
    var ok = list.length === 4 &&
             list.map(function (e) { return e.score; }).join(',') === '300,200,100,50';
    return case_('用例R2 插入按得分降序', ok);
  }

  // 用例R3 同分先到先排：后到的同分条目排在既有同分条目之后
  function r3() {
    var first = entry(200, 40, 3, 1000);   // 先到
    var second = entry(200, 55, 2, 2000);  // 后到，同分
    var list = R.insert([], first);
    list = R.insert(list, second);
    var ok = list.length === 2 && list[0].ts === 1000 && list[1].ts === 2000;
    return case_('用例R3 同分先到先排（新条目置于同分旧条目后）', ok);
  }

  // 用例R4 恰好第 10 名：满 9 条时第 10 条（即使分数最低）也入围
  function r4() {
    var list = [];
    for (var s = 100; s >= 20; s -= 10) list = R.insert(list, entry(s, 60, 1, s)); // 9 条
    list = R.insert(list, entry(5, 60, 1, 999)); // 恰好第 10 名
    var ok = list.length === 10 && list[9].score === 5;
    return case_('用例R4 恰好第 10 名入围', ok, 'len=' + list.length);
  }

  // 用例R5 溢出淘汰：满 10 条后 ≤ 末位分拒绝，> 末位分挤入并淘汰旧末位
  function r5() {
    var list = [];
    for (var s = 100; s >= 10; s -= 10) list = R.insert(list, entry(s, 60, 1, s)); // 10 条
    var rejected = R.insert(list, entry(10, 60, 1, 9999)); // 与末位同分 → 拒绝
    var kept = rejected.length === 10 && rejected[9].score === 10 && rejected[9].ts === 10;
    var bumped = R.insert(list, entry(15, 60, 1, 9999));   // 挤入末位，旧末位 10 淘汰
    var bumpedOk = bumped.length === 10 && bumped[9].score === 15 &&
                   bumped.every(function (e) { return e.score !== 10; });
    var notLower = R.insert(list, entry(9, 60, 1, 9999)).length === 10 &&
                   R.insert(list, entry(9, 60, 1, 9999))[9].score === 10;
    return case_('用例R5 满员溢出（同末位分拒绝/更大分挤入淘汰末位/更低分拒绝）',
      kept && bumpedOk && notLower);
  }

  // 用例R6 wouldEnter 预判与写档决策一致
  function r6() {
    var list = [];
    for (var s = 100; s >= 10; s -= 10) list = R.insert(list, entry(s, 60, 1, s));
    var ok = R.wouldEnter([], 1) === true &&
             R.wouldEnter(list, 11) === true &&
             R.wouldEnter(list, 10) === false &&   // 与末位同分：满员时拒绝
             R.wouldEnter(list, 9) === false &&
             R.wouldEnter(list, 0) === false &&    // 0 分不入榜
             R.wouldEnter([], 0) === false;
    return case_('用例R6 wouldEnter（0 分/满员末位边界）', ok);
  }

  // 用例R7 损坏 JSON 安全降级为空榜
  function r7() {
    var ok = R.parseBoard('{not json').length === 0 &&
             R.parseBoard('[1,2,').length === 0 &&
             R.parseBoard('null').length === 0 &&
             R.parseBoard('{"score":1}').length === 0 && // 合法 JSON 但非数组
             R.parseBoard('').length === 0 &&
             R.parseBoard(undefined).length === 0;
    return case_('用例R7 损坏/非法 JSON 降级为空榜', ok);
  }

  // 用例R8 条目级过滤：非法条目剔除、合法保留、超容量截断前 10
  function r8() {
    var good = [entry(100, 60, 2, 1), entry(90, 70, 1, 2)];
    var raw = JSON.stringify(good.concat([
      { score: 0, seconds: 1, maxCombo: 1, ts: 1 },     // score<=0
      { score: 50, seconds: -2, maxCombo: 1, ts: 1 },   // 负秒数
      { score: 50.5, seconds: 1, maxCombo: 1, ts: 1 },  // 非整数分
      { score: '50', seconds: 1, maxCombo: 1, ts: 1 },  // 字符串分
      null, 42, 'x'
    ]));
    var filtered = R.parseBoard(raw);
    var tooLongRaw = JSON.stringify(
      Array.apply(null, Array(15)).map(function (_, i) { return entry(100 - i, 10, 1, i + 1); }));
    var capped = R.parseBoard(tooLongRaw);
    var ok = filtered.length === 2 &&
             filtered[0].score === 100 &&
             capped.length === 10 && capped[9].score === 91;
    return case_('用例R8 非法条目过滤 + 超容量截断', ok,
      'filtered=' + filtered.length + ' capped=' + capped.length);
  }

  // 用例R9 序列化往返：serialize → parse 内容一致
  function r9() {
    var list = [entry(300, 65, 4, 1700000000000), entry(120, 200, 2, 1700000001000)];
    var round = R.parseBoard(R.serializeBoard(list));
    var ok = round.length === 2 &&
             JSON.stringify(round) === JSON.stringify(list) &&
             R.serializeBoard([]) === '[]';
    return case_('用例R9 读写序列化往返一致', ok);
  }

  // 用例R10 记录构建：ts 完全由参数注入，字段归一（秒取整、combo 下限 1）
  function r10() {
    var e = entry(150.9, 95.7, 0, 1700000000123);
    var ok = e.score === 150 && e.seconds === 95 && e.maxCombo === 1 &&
             e.ts === 1700000000123;
    // 模块不直接调用 Date.now（纯函数可测性约束）
    var src = require('fs').readFileSync(require.resolve('../js/ranking.js'), 'utf8');
    var noDateNow = !/Date\.now\(/.test(src);
    return case_('用例R10 createEntry 归一 + 模块零 Date.now 直调', ok && noDateNow);
  }

  // 用例R11 展示格式化：用时 mm:ss 补零、日期 YYYY-MM-DD（本地时区）
  function r11() {
    var d = new Date(2026, 0, 5, 12, 0, 0); // 本地时区 2026-01-05
    var ok = R.formatTime(0) === '00:00' &&
             R.formatTime(65) === '01:05' &&
             R.formatTime(600) === '10:00' &&
             R.formatDate(d.getTime()) === '2026-01-05';
    return case_('用例R11 formatTime/formatDate 展示格式', ok);
  }

  // 用例R12 整局链模拟：多局成绩逐局写入，榜单始终有序 ≤10 且含并列分
  function r12() {
    var stored = '[]';
    var scores = [60, 120, 120, 30, 300, 90, 45, 15, 75, 105, 150, 5];
    scores.forEach(function (s, i) {
      var board = R.parseBoard(stored);
      if (R.wouldEnter(board, s)) {
        stored = R.serializeBoard(R.insert(board, entry(s, 30 + i, 2, 1000 + i)));
      }
    });
    var final = R.parseBoard(stored);
    var scoresOut = final.map(function (e) { return e.score; });
    var sortedDesc = scoresOut.every(function (s, i) { return i === 0 || scoresOut[i - 1] >= s; });
    var tie = final[2].ts === 1001 && final[3].ts === 1002; // 两个 120 先到先排
    var ok = final.length === 10 && sortedDesc && tie &&
             scoresOut[0] === 300 && scoresOut.indexOf(5) === -1 &&
             scoresOut[9] === 30; // 15 曾被 150 挤出，末位 30
    return case_('用例R12 12 局逐局写入（容量/有序/并列/淘汰）', ok,
      '榜=' + scoresOut.join(','));
  }

  return {
    runAll: function () {
      return [r1(), r2(), r3(), r4(), r5(), r6(), r7(), r8(), r9(), r10(), r11(), r12()];
    }
  };
});
