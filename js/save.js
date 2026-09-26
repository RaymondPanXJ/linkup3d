/**
 * save.js — 《连星远航》战役存档（纯逻辑 + 可注入 storage 适配器）
 *
 * 规则（对应 issue #25，schema v1）：
 *   - 存储键 linkup3d.campaign.v1；
 *   - 结构 {v:1, levels:{ "<idx>": {stars:0-3, bestScore:int, bestTimeSec:int} }}；
 *   - storage 适配器约定 {getItem(k), setItem(k, v)}（由调用方注入，
 *     game.js 接线为后续任务，本模块不直接触碰 localStorage）；
 *   - load 对损坏 JSON / 缺 key / 非法字段一律降级为初始档，绝不抛异常；
 *   - recordResult 为纯函数返回新档：星级只升不降，bestScore 取大，
 *     bestTimeSec 取小（各字段仅在有效值时参与比较）。
 *
 * 该文件同时可在浏览器（window.CampaignSave）与 Node（module.exports）中使用。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CampaignSave = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STORAGE_KEY = 'linkup3d.campaign.v1';
  var SCHEMA_VERSION = 1;

  function isInt(v) {
    return typeof v === 'number' && isFinite(v) && Math.floor(v) === v;
  }

  function initialData() {
    return { v: SCHEMA_VERSION, levels: {} };
  }

  // 单关卡条目合法性：stars ∈ 0..3 整数，bestScore/bestTimeSec 非负整数
  function isValidLevelEntry(e) {
    return !!e && typeof e === 'object' && !Array.isArray(e) &&
      isInt(e.stars) && e.stars >= 0 && e.stars <= 3 &&
      isInt(e.bestScore) && e.bestScore >= 0 &&
      isInt(e.bestTimeSec) && e.bestTimeSec >= 0;
  }

  // 整档结构合法性（含 v 版本匹配、levels 键为非负整数字符串）
  function isValidData(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
    if (data.v !== SCHEMA_VERSION) return false;
    if (!data.levels || typeof data.levels !== 'object' || Array.isArray(data.levels)) {
      return false;
    }
    var keys = Object.keys(data.levels);
    for (var i = 0; i < keys.length; i++) {
      if (!/^(0|[1-9][0-9]*)$/.test(keys[i])) return false;
      if (!isValidLevelEntry(data.levels[keys[i]])) return false;
    }
    return true;
  }

  // 深拷贝一份档（防止调用方持有引用被后续修改污染）
  function cloneData(data) {
    var out = { v: SCHEMA_VERSION, levels: {} };
    var keys = Object.keys(data.levels);
    for (var i = 0; i < keys.length; i++) {
      var e = data.levels[keys[i]];
      out.levels[keys[i]] = { stars: e.stars, bestScore: e.bestScore, bestTimeSec: e.bestTimeSec };
    }
    return out;
  }

  /* ---------------- storage 读写 ---------------- */
  // 读取：任何异常（storage 缺失/抛错、无键、JSON 损坏、结构非法）→ 初始档
  function load(storage) {
    if (!storage || typeof storage.getItem !== 'function') return initialData();
    var raw;
    try {
      raw = storage.getItem(STORAGE_KEY);
    } catch (e) {
      return initialData();
    }
    if (typeof raw !== 'string' || !raw) return initialData();
    var parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      return initialData();
    }
    return isValidData(parsed) ? cloneData(parsed) : initialData();
  }

  // 写入：合法档序列化写入；非法档或 storage 抛错返回 false，不抛异常
  function save(storage, data) {
    if (!storage || typeof storage.setItem !== 'function') return false;
    if (!isValidData(data)) return false;
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      return false;
    }
  }

  /* ---------------- 结果合并（纯函数） ---------------- */
  // 返回新档：星级只升不降；bestScore 取大；bestTimeSec 取小。
  // idx / stars 非法（越界或非整数）时原样返回原档。
  function recordResult(data, idx, stars, score, timeUsed) {
    if (!isValidData(data)) return initialData();
    if (!isInt(idx) || idx < 0) return cloneData(data);
    if (!isInt(stars) || stars < 0 || stars > 3) return cloneData(data);

    var key = String(idx);
    var prev = data.levels[key];
    var next = prev
      ? { stars: prev.stars, bestScore: prev.bestScore, bestTimeSec: prev.bestTimeSec }
      : { stars: 0, bestScore: 0, bestTimeSec: 0 };

    if (stars > next.stars) next.stars = stars;
    if (isInt(score) && score > next.bestScore) next.bestScore = score;
    if (isInt(timeUsed) && timeUsed > 0 &&
        (next.bestTimeSec === 0 || timeUsed < next.bestTimeSec)) {
      next.bestTimeSec = timeUsed;
    }

    var out = cloneData(data);
    out.levels[key] = next;
    return out;
  }

  return {
    STORAGE_KEY: STORAGE_KEY,
    SCHEMA_VERSION: SCHEMA_VERSION,
    initialData: initialData,
    isValidLevelEntry: isValidLevelEntry,
    isValidData: isValidData,
    load: load,
    save: save,
    recordResult: recordResult
  };
});
