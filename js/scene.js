/**
 * scene.js — 战役场景系统数据表与纯函数（issue #53，无 DOM / 无副作用）
 *
 * - SCENES：每关独立场景（palette 色调 + 星群密度/色温 + 叠加元素参数表）；
 * - sceneForLevel(id)：关卡 → 场景，损坏/缺失关卡号安全回退默认场景；
 * - endlessSceneIdFor(diff)：无尽模式三常驻场景（easy=s1 光带 /
 *   normal=s6 极光 / hard=s9 星核，PR 说明）；
 * - blend(prev, next, t)：场景渐变参数（数值线性插值、hex 色通道插值），
 *   关间切换渐变而非突跳；
 * - elementItems(scene, rand)：叠加元素的确定性伪随机布点（rng 注入惯例，
 *   同 enemy.js/fx.js 风格），Node 侧可断言元素坐标计算；
 * - validateScene(s)：非法即抛 Error（数据表自检）。
 *
 * 元素坐标一律归一化 [0,1]，速度 px/s、尺寸比例按视口分量换算，
 * 位置为 (item, clock) 的纯函数（解析式推进，无状态突变），渲染层见 stars.js。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Scene = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULT_SCENE_ID = 'default';

  /* ---------------- 场景数据表 ----------------
   * palette：背景/星点色温（hex）；density：星群数量倍率 (0,1]；
   * elements：叠加元素 [{kind,count,alpha,speed,color...}]，
   *   alpha ∈ (0,1]、count 正整数、speed ≥0。 */
  var SCENES = {
    'default': {
      id: 'default', name: '深空（默认）',
      palette: { base: '#060916', glow1: '#2a1e52', glow2: '#14264f',
        star1: '#bcd4ff', star2: '#ffe9c4', star3: '#ffffff' },
      density: 1, elements: []
    },
    's0': {
      id: 's0', name: '沉眠深空',
      palette: { base: '#03050e', glow1: '#0a1330', glow2: '#050a1c',
        star1: '#8fa6d8', star2: '#c9d8ff', star3: '#eef4ff' },
      density: 0.8,
      elements: [
        { kind: 'pulse', count: 3, alpha: 0.16, speed: 0.05, color: '#26408a', radius: 0.5 }
      ]
    },
    's1': {
      id: 's1', name: '光带航道',
      palette: { base: '#04101c', glow1: '#0d3b56', glow2: '#072234',
        star1: '#7fe3ff', star2: '#d5f4ff', star3: '#ffffff' },
      density: 0.9,
      elements: [
        { kind: 'streaks', count: 26, alpha: 0.35, speed: 60, color: '#59d8ff', len: 90, angleDeg: -20 }
      ]
    },
    's2': {
      id: 's2', name: '霜野',
      palette: { base: '#071019', glow1: '#1d3c55', glow2: '#0e2231',
        star1: '#cfe8ff', star2: '#ffffff', star3: '#e6f4ff' },
      density: 0.85,
      elements: [
        { kind: 'hexgrid', count: 1, alpha: 0.1, speed: 0.03, color: '#bfe4ff', cell: 120 }
      ]
    },
    's3': {
      id: 's3', name: '警戒宙域',
      palette: { base: '#0a0616', glow1: '#2a1444', glow2: '#150a28',
        star1: '#c7a6ff', star2: '#e8dcff', star3: '#ffffff' },
      density: 0.8,
      elements: [
        { kind: 'sweep', count: 1, alpha: 0.16, speed: 0.22, color: '#9a6bff', cx: 0.78, cy: 0.2, radius: 0.75 }
      ]
    },
    's4': {
      id: 's4', name: '冰原反射',
      palette: { base: '#04121a', glow1: '#114a56', glow2: '#082830',
        star1: '#8fe6ff', star2: '#d9f7ff', star3: '#ffffff' },
      density: 0.9,
      elements: [
        { kind: 'mirror', count: 1, alpha: 0.22, speed: 0.08, color: '#8fe6ff' }
      ]
    },
    's5': {
      id: 's5', name: '双星裂隙',
      palette: { base: '#060a18', glow1: '#1c3a6e', glow2: '#3a2c14',
        star1: '#9fc0ff', star2: '#ffd9a0', star3: '#ffffff' },
      density: 0.85,
      elements: [
        { kind: 'twin', count: 2, alpha: 0.3, speed: 0.06, colorA: '#6fa8ff', colorB: '#ffd27a', radius: 0.34 }
      ]
    },
    's6': {
      id: 's6', name: '暗夜极光',
      palette: { base: '#04100c', glow1: '#0c3a2c', glow2: '#1c1038',
        star1: '#a8ffd8', star2: '#cbb8ff', star3: '#ffffff' },
      density: 0.85,
      elements: [
        { kind: 'aurora', count: 3, alpha: 0.18, speed: 0.1, colorA: '#39d98a', colorB: '#7a5cff', band: 0.24 }
      ]
    },
    's7': {
      id: 's7', name: '风雪星云',
      palette: { base: '#0d1014', glow1: '#3a4450', glow2: '#20262e',
        star1: '#e8eef7', star2: '#cfd8e6', star3: '#ffffff' },
      density: 0.7,
      elements: [
        { kind: 'snow', count: 80, alpha: 0.5, speed: 340, color: '#e8eef7', maxR: 2.4 }
      ]
    },
    's8': {
      id: 's8', name: '深渊回声',
      palette: { base: '#020614', glow1: '#0a1f4a', glow2: '#05102a',
        star1: '#5f8fd8', star2: '#8fb8ff', star3: '#dfeaff' },
      density: 0.75,
      elements: [
        { kind: 'ripple', count: 4, alpha: 0.14, speed: 0.35, color: '#4aa8ff', radius: 0.7 }
      ]
    },
    's9': {
      id: 's9', name: '星核',
      palette: { base: '#140802', glow1: '#5a2608', glow2: '#311404',
        star1: '#ffcf8f', star2: '#ff9a3c', star3: '#fff3dc' },
      density: 0.8,
      elements: [
        { kind: 'core', count: 1, alpha: 0.4, speed: 0.5, color: '#ff9a3c', radius: 0.3 },
        { kind: 'orbit', count: 24, alpha: 0.6, speed: 1.1, color: '#ffd166', radius: 0.34 }
      ]
    },
    's10': {
      id: 's10', name: '应力视界',
      /* 近乎纯黑底 + 吸积盘橙金辉光（低饱和）+ 冷白星点（issue #59） */
      palette: { base: '#050208', glow1: '#3a1e08', glow2: '#120a1e',
        star1: '#dfe6f5', star2: '#ffd9a0', star3: '#ffffff' },
      density: 0.6,
      elements: [
        { kind: 'blackhole', count: 1, alpha: 0.85, speed: 0.05,
          color: '#ff9e40', cx: 0.72, cy: 0.28, radius: 0.2 }
      ]
    },
    /* 无尽模式三常驻场景（复用战役风格，PR 说明选型） */
    'se-easy': {
      id: 'se-easy', name: '光带航道（无尽·简单）',
      palette: SCENES_copyS1Palette(), density: 0.9,
      elements: [{ kind: 'streaks', count: 22, alpha: 0.3, speed: 55, color: '#59d8ff', len: 90, angleDeg: -20 }]
    },
    'se-normal': {
      id: 'se-normal', name: '暗夜极光（无尽·标准）',
      palette: { base: '#04100c', glow1: '#0c3a2c', glow2: '#1c1038',
        star1: '#a8ffd8', star2: '#cbb8ff', star3: '#ffffff' },
      density: 0.85,
      elements: [{ kind: 'aurora', count: 3, alpha: 0.16, speed: 0.1, colorA: '#39d98a', colorB: '#7a5cff', band: 0.24 }]
    },
    'se-hard': {
      id: 'se-hard', name: '星核（无尽·困难）',
      palette: { base: '#140802', glow1: '#5a2608', glow2: '#311404',
        star1: '#ffcf8f', star2: '#ff9a3c', star3: '#fff3dc' },
      density: 0.8,
      elements: [
        { kind: 'core', count: 1, alpha: 0.36, speed: 0.5, color: '#ff9a3c', radius: 0.3 },
        { kind: 'orbit', count: 20, alpha: 0.55, speed: 1.1, color: '#ffd166', radius: 0.34 }
      ]
    }
  };

  function SCENES_copyS1Palette() {
    return { base: '#04101c', glow1: '#0d3b56', glow2: '#072234',
      star1: '#7fe3ff', star2: '#d5f4ff', star3: '#ffffff' };
  }

  /* 关卡 id → 场景 id（与 campaign.js LEVELS 索引一一对应，0..10） */
  var LEVEL_SCENE_IDS = ['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10'];
  var ENDLESS_SCENE_IDS = { easy: 'se-easy', normal: 'se-normal', hard: 'se-hard' };

  /* ---------------- 校验 ---------------- */
  var HEX_RE = /^#[0-9a-fA-F]{6}$/;

  function validateScene(s) {
    if (!s || typeof s !== 'object') throw new Error('场景必须为对象');
    if (typeof s.id !== 'string' || !s.id) throw new Error('场景 id 非法: ' + s.id);
    if (!s.palette || typeof s.palette !== 'object') throw new Error('palette 非法: ' + s.id);
    ['base', 'glow1', 'glow2', 'star1', 'star2', 'star3'].forEach(function (k) {
      if (!HEX_RE.test(s.palette[k])) throw new Error('palette.' + k + ' 必须为 #rrggbb: ' + s.palette[k]);
    });
    if (typeof s.density !== 'number' || !(s.density > 0 && s.density <= 1)) {
      throw new Error('density 必须在 (0,1]: ' + s.density);
    }
    if (!Array.isArray(s.elements)) throw new Error('elements 必须为数组: ' + s.id);
    s.elements.forEach(function (el, i) {
      if (!el || typeof el.kind !== 'string' || !el.kind) throw new Error('elements[' + i + '].kind 非法');
      if (!Number.isInteger(el.count) || el.count < 1) throw new Error('elements[' + i + '].count 必须为正整数: ' + el.count);
      if (typeof el.alpha !== 'number' || !(el.alpha > 0 && el.alpha <= 1)) throw new Error('elements[' + i + '].alpha 必须在 (0,1]: ' + el.alpha);
      if (typeof el.speed !== 'number' || !isFinite(el.speed) || el.speed < 0) throw new Error('elements[' + i + '].speed 必须 ≥0: ' + el.speed);
    });
    return true;
  }

  (function validateTable() {
    Object.keys(SCENES).forEach(function (k) { validateScene(SCENES[k]); });
  })();

  /* ---------------- 查询 ---------------- */
  function byId(id) {
    return Object.prototype.hasOwnProperty.call(SCENES, id) ? SCENES[id] : null;
  }

  // 关卡 → 场景；非法/越界 id 安全回退默认场景
  function sceneForLevel(id) {
    if (!Number.isInteger(id) || id < 0 || id >= LEVEL_SCENE_IDS.length) {
      return SCENES[DEFAULT_SCENE_ID];
    }
    return SCENES[LEVEL_SCENE_IDS[id]] || SCENES[DEFAULT_SCENE_ID];
  }

  // 星图索引 i（campaign LEVELS 下标）→ 场景；越界/非法安全回退默认场景
  function sceneForLevelIndex(i) {
    return sceneForLevel(i);
  }

  // HUD 场景标签 id（issue #53 验收：HUD 显示当前场景名）。
  // 战役由调用方折算为 mode='campaign' + 星图索引 → 's<idx>'；
  // 无尽/计时（非战役）按难度档 → se-*；其它/非法一律默认场景 id。纯函数可断言。
  function hudSceneIdFor(mode, idxOrDiff) {
    if (mode === 'campaign') {
      if (!Number.isInteger(idxOrDiff) || idxOrDiff < 0 || idxOrDiff >= LEVEL_SCENE_IDS.length) {
        return DEFAULT_SCENE_ID;
      }
      return LEVEL_SCENE_IDS[idxOrDiff];
    }
    if (mode === 'endless' || mode === 'timed') return endlessSceneIdFor(idxOrDiff);
    return DEFAULT_SCENE_ID;
  }

  function endlessSceneIdFor(diff) {
    return ENDLESS_SCENE_IDS[diff] || ENDLESS_SCENE_IDS.normal;
  }

  function sceneForDifficulty(diff) {
    return SCENES[endlessSceneIdFor(diff)];
  }

  /* ---------------- blend：场景渐变参数 ---------------- */
  function clamp01(t) {
    if (typeof t !== 'number' || !isFinite(t)) return 0;
    return t < 0 ? 0 : (t > 1 ? 1 : t);
  }

  function lerp(a, b, t) { return a + (b - a) * t; }

  function hexToRgb(hex) {
    var n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function rgbToHex(rgb) {
    function h(v) {
      var s = Math.round(Math.max(0, Math.min(255, v))).toString(16);
      return s.length === 1 ? '0' + s : s;
    }
    return '#' + h(rgb[0]) + h(rgb[1]) + h(rgb[2]);
  }

  function mixHex(a, b, t) {
    var ca = hexToRgb(a), cb = hexToRgb(b), out = [];
    for (var i = 0; i < 3; i++) out.push(lerp(ca[i], cb[i], t));
    return rgbToHex(out);
  }

  function isScene(s) {
    try { validateScene(s); return true; } catch (e) { return false; }
  }

  function cloneScene(s) {
    return JSON.parse(JSON.stringify(s));
  }

  function blendPalette(pa, pb, t) {
    var out = {};
    Object.keys(pb).forEach(function (k) {
      var a = pa && HEX_RE.test(pa[k]) ? pa[k] : pb[k];
      out[k] = HEX_RE.test(a) && HEX_RE.test(pb[k]) ? mixHex(a, pb[k], t) : pb[k];
    });
    return out;
  }

  function blendElement(ea, eb, t) {
    var out = {};
    Object.keys(eb).forEach(function (k) {
      var a = ea && ea[k];
      if (typeof eb[k] === 'number') {
        out[k] = typeof a === 'number' ? lerp(a, eb[k], t) : eb[k];
      } else if (typeof eb[k] === 'string' && HEX_RE.test(eb[k])) {
        out[k] = HEX_RE.test(a) ? mixHex(a, eb[k], t) : eb[k];
      } else {
        out[k] = eb[k];
      }
    });
    return out;
  }

  /**
   * prev→next 在 t∈[0,1] 的渐变场景（纯函数，数值/色通道线性插值）。
   * 非法入参安全降级：prev 非法返回 next 克隆，next 非法返回 prev 克隆，
   * 双非法返回默认场景克隆。t 越界钳制（单调性护栏）。
   */
  function blend(prev, next, t) {
    var k = clamp01(t);
    var pOk = isScene(prev), nOk = isScene(next);
    if (!pOk && !nOk) return cloneScene(SCENES[DEFAULT_SCENE_ID]);
    if (!pOk) return cloneScene(next);
    if (!nOk) return cloneScene(prev);
    var elements = next.elements.map(function (eb, i) {
      var ea = null;
      for (var j = 0; j < prev.elements.length; j++) {
        if (prev.elements[j].kind === eb.kind) { ea = prev.elements[j]; break; }
      }
      return ea ? blendElement(ea, eb, k) : cloneScene({ e: eb }).e;
    });
    return {
      id: next.id, name: next.name,
      palette: blendPalette(prev.palette, next.palette, k),
      density: lerp(prev.density, next.density, k),
      elements: elements
    };
  }

  /* ---------------- 元素确定性布点 ----------------
   * 返回 [{kind, i, x, y, ...}]，坐标归一化 [0,1]；速度/相位等参数内联。
   * 解析式推进（位置 = f(item, clock)），渲染层不做状态突变。 */
  function elementItems(scene, rand) {
    var rnd = typeof rand === 'function' ? rand : Math.random;
    var out = [];
    if (!scene || !Array.isArray(scene.elements)) return out;
    scene.elements.forEach(function (el) {
      for (var i = 0; i < el.count; i++) {
        var it = { kind: el.kind, i: i };
        switch (el.kind) {
          case 'pulse':
            it.x = rnd(); it.y = rnd();
            it.radius = el.radius || 0.5;
            it.ph = rnd();
            break;
          case 'streaks':
            it.x = rnd(); it.y = rnd();
            it.sp = el.speed * (0.7 + 0.6 * rnd());
            break;
          case 'snow':
            it.x = rnd(); it.y = rnd();
            it.sp = el.speed * (0.6 + 0.8 * rnd());
            it.r = 0.8 + rnd() * (el.maxR || 2);
            it.dip = rnd();
            break;
          case 'orbit':
            it.ang = (i / el.count) * Math.PI * 2 + rnd() * 0.4;
            it.rad = (el.radius || 0.34) * (0.7 + 0.6 * rnd());
            it.sp = el.speed * (0.8 + 0.4 * rnd());
            break;
          default:
            // hexgrid/sweep/mirror/twin/aurora/ripple/core：几何由 index/参数定，无随机
            break;
        }
        out.push(it);
      }
    });
    return out;
  }

  return {
    SCENES: SCENES,
    DEFAULT_SCENE_ID: DEFAULT_SCENE_ID,
    LEVEL_SCENE_IDS: LEVEL_SCENE_IDS,
    ENDLESS_SCENE_IDS: ENDLESS_SCENE_IDS,
    validateScene: validateScene,
    byId: byId,
    sceneForLevel: sceneForLevel,
    sceneForLevelIndex: sceneForLevelIndex,
    hudSceneIdFor: hudSceneIdFor,
    endlessSceneIdFor: endlessSceneIdFor,
    sceneForDifficulty: sceneForDifficulty,
    blend: blend,
    elementItems: elementItems
  };
});
