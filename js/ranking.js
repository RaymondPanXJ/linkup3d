/**
 * ranking.js — 分难度本地排行榜 Top10（纯函数，无 DOM / 无存储副作用）
 *
 * 规则（对应 issue #13）：
 *   - 每档难度一个 Top10 榜单，存储键 linkup3d.rank.<easy|standard|hard>；
 *   - 插入按得分降序；同分先到先排（新条目排在同分旧条目之后）；
 *   - 满 10 条后：新得分必须严格大于末位才入围，否则拒绝（溢出淘汰末位）；
 *   - 读取/写入为「字符串 <-> 条目数组」序列化；损坏 JSON 安全降级为空榜；
 *   - 时间戳一律由调用方注入（Date.now 不在本模块内直接调用），保证可测。
 *
 * 该文件同时可在浏览器（window.Ranking）与 Node（module.exports）中使用。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Ranking = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX_ENTRIES = 10; // 每档难度榜单容量

  // 内部难度键 -> 榜单存储档位（与 combo.js 的 best 档位命名一致）
  var RANK_TIERS = { easy: 'easy', normal: 'standard', hard: 'hard' };

  // 难度 -> 榜单存储键（读写由调用方完成）
  function rankKey(difficulty) {
    var tier = RANK_TIERS[difficulty] || RANK_TIERS.normal;
    return 'linkup3d.rank.' + tier;
  }

  function isInt(v) {
    return typeof v === 'number' && isFinite(v) && Math.floor(v) === v;
  }

  // 单条目合法性：{score>0, seconds>=0, maxCombo>=1, ts>0} 均为整数
  function isValidEntry(e) {
    return !!e && typeof e === 'object' &&
      isInt(e.score) && e.score > 0 &&
      isInt(e.seconds) && e.seconds >= 0 &&
      isInt(e.maxCombo) && e.maxCombo >= 1 &&
      isInt(e.ts) && e.ts > 0;
  }

  // 得分 > 0 才有资格上榜（issue 验收 2）
  function isEligible(score) {
    return isInt(score) && score > 0;
  }

  // 构建一条记录；时间戳由调用方注入（不直接调用 Date.now）
  function createEntry(score, seconds, maxCombo, ts) {
    return {
      score: Math.floor(score) || 0,
      seconds: Math.max(0, Math.floor(seconds) || 0),
      maxCombo: Math.max(1, Math.floor(maxCombo) || 1),
      ts: Math.floor(ts) || 0
    };
  }

  // 反序列化：非法 JSON / 非数组 / 非法条目一律安全降级（过滤或空榜）
  function parseBoard(raw) {
    if (typeof raw !== 'string' || !raw) return [];
    var arr;
    try { arr = JSON.parse(raw); } catch (e) { return []; }
    if (!Array.isArray(arr)) return [];
    var out = [];
    for (var i = 0; i < arr.length && out.length < MAX_ENTRIES; i++) {
      if (isValidEntry(arr[i])) out.push(arr[i]);
    }
    return out;
  }

  function serializeBoard(entries) {
    return JSON.stringify(Array.isArray(entries) ? entries : []);
  }

  // 插入（纯函数，返回新数组）：降序；同分先到先排；满员时严格大于末位才入围
  function insert(entries, entry) {
    var list = Array.isArray(entries) ? entries.slice() : [];
    if (!isValidEntry(entry)) return list;
    var at = list.length;
    for (var i = 0; i < list.length; i++) {
      if (list[i].score < entry.score) { at = i; break; }
    }
    list.splice(at, 0, entry);
    if (list.length > MAX_ENTRIES) list.length = MAX_ENTRIES;
    return list;
  }

  // 是否会进榜（不改变原数组的预判，用于「本局是否上榜」提示）
  function wouldEnter(entries, score) {
    var list = Array.isArray(entries) ? entries : [];
    if (!isInt(score) || score <= 0) return false;
    if (list.length < MAX_ENTRIES) return true;
    return score > list[list.length - 1].score;
  }

  function formatTime(s) {
    var m = Math.floor(s / 60), ss = s % 60;
    return (m < 10 ? '0' : '') + m + ':' + (ss < 10 ? '0' : '') + ss;
  }

  // ts 注入，本地时区 YYYY-MM-DD
  function formatDate(ts) {
    var d = new Date(ts);
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m +
      '-' + (day < 10 ? '0' : '') + day;
  }

  return {
    MAX_ENTRIES: MAX_ENTRIES,
    RANK_TIERS: RANK_TIERS,
    rankKey: rankKey,
    isValidEntry: isValidEntry,
    isEligible: isEligible,
    createEntry: createEntry,
    parseBoard: parseBoard,
    serializeBoard: serializeBoard,
    insert: insert,
    wouldEnter: wouldEnter,
    formatTime: formatTime,
    formatDate: formatDate
  };
});
