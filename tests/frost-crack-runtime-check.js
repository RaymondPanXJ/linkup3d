#!/usr/bin/env node
/**
 * tests/frost-crack-runtime-check.js — 裂纹态视觉同步运行时仿真（issue #52）
 *
 * TechLead 真机插桩证据（issue #51 复验）：裂冰瞬间 .cracked 从未上屏、Frost.frozenList
 * 在 crack 后 600ms 内 0 次调用——即 eliminate 的立即同步与 250ms 心跳同步都未生效。
 * 本仿真在 Node 内以最小 DOM/浏览器宿主垫片 + 虚拟时钟加载真实 js/*.js（与 index.html
 * 同序），端到端驱动：星图 → L3「霜纹初现」（hunter:null 预冻关，restore 已过）→
 * 真实点击冰封邻格同值对 → 断言 .cracked 立即上屏并跨心跳持久。
 *
 * 断言组：
 *   R1 心跳独立性：无巡猎者关卡（enemyState=null）250ms 心跳仍持续调用 frozenList
 *      （缺陷1 回归：syncFrostVisuals 不得被 enemyState 门控）。
 *   R2 立即同步：消除瞬间（任何心跳之前）.cracked 已应用到冰封邻格 slot（issue #52 主案）。
 *   R3 持久性：瞬态 tile-cracking 420ms 后自动移除；.cracked 跨后续心跳持久不重置。
 *   R4 破裂清态：第二次邻近消除 hp→0 后 .cracked / .tile-frozen 均清除。
 *
 * 盘面发牌随机：多随机种子重跑场景，取首个「R4 可执行且期间未触发洗牌」的种子；
 * 洗牌会清全场冰封（issue #39 裁决1），属发牌运气而非裂纹缺陷，样本无效则换种子。
 *
 * 运行：node tests/run-tests.js 或单独 node tests/frost-crack-runtime-check.js
 */
'use strict';
var readUtf8 = require('./read-utf8.js');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var SCRIPT_ORDER = ['link3d', 'combo', 'timer', 'ranking', 'music', 'stars', 'mobile',
  'hint', 'tutorial', 'frost', 'enemy', 'campaign', 'save', 'ufo', 'fx', 'game'];
var EMOJIS = ['🍎', '🍇', '🍋', '🍉', '🚀', '🎲', '🐱', '🐼', '⚡', '🌙', '🍄', '🎈',
  '🍒', '🥕', '🌵', '🎸', '⚽', '🏀', '🐸', '🦊', '🍭', '🎯', '🔔', '🌈'];
var L3_FROZEN = [{ r: 2, c: 2 }, { r: 3, c: 5 }];

/* ---------------- 虚拟时钟 + 宿主垫片 ---------------- */
function mulberry32(seed) {
  var t = seed >>> 0;
  return function () {
    t += 0x6D2B79F5;
    var x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// innerHTML 极简解析：仅覆盖本仓库模板形态（单层属性、无自闭合、文本仅 emoji）
function parseFragment(htmlText) {
  var stack = [{ children: [] }];
  var re = /<(\/?)([a-zA-Z][\w-]*)((?:\s+[\w-]+="[^"]*")*)\s*(\/?)>|([^<]+)/g;
  var m;
  while ((m = re.exec(htmlText))) {
    if (m[5] !== undefined) {
      var text = m[5];
      if (text.trim()) stack[stack.length - 1].pendingText = (stack[stack.length - 1].pendingText || '') + text;
      continue;
    }
    if (m[1] === '/') { stack.pop(); continue; }
    var attrs = {};
    (m[3] || '').replace(/([\w-]+)="([^"]*)"/g, function (_, k, v) { attrs[k] = v; return ''; });
    stack[stack.length - 1].children.push({ tag: m[2], attrs: attrs, children: [] });
    if (!m[4]) stack.push(stack[stack.length - 1].children[stack[stack.length - 1].children.length - 1]);
  }
  return stack[0].children;
}

function createHost(seed) {
  var now = 1700000000000;
  var rng = mulberry32(seed);
  var timerSeq = 0;
  var timers = {};
  function addTimer(fn, ms, interval) {
    var id = ++timerSeq;
    timers[id] = { at: now + Math.max(0, Math.round(ms) || 0), fn: fn, every: interval ? Math.round(ms) : 0 };
    return id;
  }
  function advance(ms) {
    var target = now + ms;
    for (;;) {
      var dueId = 0, due = null;
      Object.keys(timers).forEach(function (id) {
        var t = timers[id];
        if (t.at <= target && (due === null || t.at < due.at)) { due = t; dueId = +id; }
      });
      if (!due) break;
      now = due.at;
      if (due.every) due.at = now + due.every;
      else delete timers[dueId];
      due.fn();
    }
    now = target;
  }

  function makeElement(node, doc) {
    var el = {
      tagName: String(node.tag || 'div').toUpperCase(),
      className: '',
      id: node.id || '',
      textContent: '',
      hidden: false, disabled: false, type: '', value: '',
      style: { setProperty: function () {}, removeProperty: function () {}, cssText: '' },
      dataset: {}, attrs: {}, children: [], parentNode: null, listeners: {},
      _inner: '', _ctx: null, _doc: doc
    };
    el.classList = (function () {
      function classes() { return el.className ? el.className.split(/\s+/).filter(Boolean) : []; }
      function write(l) { el.className = l.join(' '); }
      return {
        add: function () {
          var l = classes();
          Array.prototype.forEach.call(arguments, function (c) { if (l.indexOf(c) < 0) l.push(c); });
          write(l);
        },
        remove: function () {
          var l = classes();
          Array.prototype.forEach.call(arguments, function (c) {
            var i;
            while ((i = l.indexOf(c)) >= 0) l.splice(i, 1);
          });
          write(l);
        },
        contains: function (c) { return classes().indexOf(c) >= 0; },
        toggle: function (c, on) {
          var has = classes().indexOf(c) >= 0;
          if (on === undefined) on = !has;
          if (on) { if (!has) this.add(c); } else if (has) this.remove(c);
          return !!on;
        }
      };
    })();
    Object.defineProperty(el, 'innerHTML', {
      get: function () { return el._inner; },
      set: function (v) {
        el._inner = String(v);
        el.children = [];
        parseFragment(String(v)).forEach(function hydrate(n) {
          var child = makeElement({ tag: n.tag, id: n.attrs.id }, el._doc);
          Object.keys(n.attrs).forEach(function (k) { child.setAttribute(k, n.attrs[k]); });
          var txt = (n.pendingText || '').trim();
          if (txt) child.textContent = txt;
          el.appendChild(child);
          n.children.forEach(hydrate);
        });
      }
    });
    Object.defineProperty(el, 'offsetWidth', { get: function () { return 100; } });
    Object.defineProperty(el, 'offsetHeight', { get: function () { return 100; } });
    el.setAttribute = function (k, v) {
      el.attrs[k] = String(v);
      if (k === 'class') el.className = String(v);
      else if (k === 'id') { el.id = String(v); el._doc._register(String(v), el); }
      else if (k.indexOf('data-') === 0) {
        el.dataset[k.slice(5).replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); })] = String(v);
      }
    };
    el.getAttribute = function (k) { return k in el.attrs ? el.attrs[k] : null; };
    el.removeAttribute = function (k) { delete el.attrs[k]; };
    el.appendChild = function (c) { c.parentNode = el; el.children.push(c); return c; };
    el.removeChild = function (c) {
      var i = el.children.indexOf(c);
      if (i >= 0) el.children.splice(i, 1);
      c.parentNode = null;
      return c;
    };
    el.remove = function () { if (el.parentNode) el.parentNode.removeChild(el); };
    el.addEventListener = function (t, fn) { (el.listeners[t] = el.listeners[t] || []).push(fn); };
    el.removeEventListener = function (t, fn) {
      var l = el.listeners[t] || [], i = l.indexOf(fn);
      if (i >= 0) l.splice(i, 1);
    };
    el.dispatchEvent = function (ev) {
      (el.listeners[ev.type] || []).slice().forEach(function (fn) {
        fn(Object.assign({ target: el, currentTarget: el, preventDefault: function () {}, stopPropagation: function () {} }, ev));
      });
    };
    el.click = function () {
      var ev = { type: 'click', target: el, currentTarget: el, preventDefault: function () {}, stopPropagation: function () {} };
      var node = el;
      while (node) { // 冒泡：真实点击经父级委托（星图/确认盘）
        (node.listeners.click || []).slice().forEach(function (fn) { fn(ev); });
        node = node.parentNode;
      }
    };
    el.closest = function (sel) {
      var cls = sel.replace(/^\./, '');
      var node = el;
      while (node) {
        if (node.classList && node.classList.contains(cls)) return node;
        node = node.parentNode;
      }
      return null;
    };
    el.querySelector = function (sel) {
      var found = null;
      (function walk(n) {
        if (found) return;
        n.children.forEach(function (c) {
          if (found) return;
          if (sel.charAt(0) === '.' ? c.classList.contains(sel.slice(1))
            : sel.charAt(0) === '#' ? c.id === sel.slice(1)
              : c.tagName === sel.toUpperCase()) found = c;
          else walk(c);
        });
      })(el);
      return found;
    };
    el.querySelectorAll = function (sel) {
      var out = [];
      (function walk(n) {
        n.children.forEach(function (c) {
          if (sel.charAt(0) === '.' ? c.classList.contains(sel.slice(1))
            : sel.charAt(0) === '#' ? c.id === sel.slice(1)
              : c.tagName === sel.toUpperCase()) out.push(c);
          walk(c);
        });
      })(el);
      return out;
    };
    el.getBoundingClientRect = function () {
      return { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 };
    };
    el.getContext = function () {
      if (!el._ctx) {
        el._ctx = {
          scale: function () {}, setTransform: function () {}, clearRect: function () {},
          beginPath: function () {}, arc: function () {}, fill: function () {}, fillRect: function () {},
          fillStyle: '', globalAlpha: 1
        };
      }
      return el._ctx;
    };
    return el;
  }

  var registry = {};
  var documentShim = {
    body: null,
    documentElement: null,
    hidden: false,
    visibilityState: 'visible',
    _register: function (id, el) { registry[id] = el; },
    createElement: function (tag) { return makeElement({ tag: tag }, documentShim); },
    getElementById: function (id) {
      if (!registry[id]) {
        var el = makeElement({ tag: 'div', id: id }, documentShim);
        el.id = id;
        registry[id] = el;
        documentShim.body.appendChild(el);
      }
      return registry[id];
    },
    querySelector: function (sel) { return documentShim.body.querySelector(sel) || (function () {
      var el = documentShim.createElement(sel.charAt(0) === '.' ? 'div' : sel);
      if (sel.charAt(0) === '.') el.classList.add(sel.slice(1));
      documentShim.body.appendChild(el);
      return el;
    })(); },
    querySelectorAll: function (sel) { return documentShim.body.querySelectorAll(sel); },
    addEventListener: function () {},
    removeEventListener: function () {}
  };
  documentShim.documentElement = makeElement({ tag: 'html' }, documentShim);
  documentShim.body = makeElement({ tag: 'body' }, documentShim);
  documentShim.documentElement.appendChild(documentShim.body);
  // layout() 依赖的静态节点：给非零高度避免除零
  ['h1', '.subtitle'].forEach(function (sel) {
    var el = documentShim.querySelector(sel);
    el.getBoundingClientRect = function () { return { height: sel === 'h1' ? 40 : 20, width: 0, top: 0, left: 0, bottom: 0, right: 0 }; };
  });
  documentShim.querySelector('.hud').getBoundingClientRect = function () {
    return { height: 60, width: 0, top: 0, left: 0, bottom: 0, right: 0 };
  };

  var store = {};
  var storage = {
    getItem: function (k) { return k in store ? store[k] : null; },
    setItem: function (k, v) { store[k] = String(v); },
    removeItem: function (k) { delete store[k]; }
  };

  function audioNode() {
    function param() {
      return { value: 0, setValueAtTime: function () {}, cancelScheduledValues: function () {}, exponentialRampToValueAtTime: function () {} };
    }
    return { connect: function (n) { return n; }, disconnect: function () {}, start: function () {}, stop: function () {}, gain: param(), frequency: param(), type: '', buffer: null };
  }
  function audioCtxStub() {
    return {
      state: 'suspended', currentTime: 0, sampleRate: 44100, destination: audioNode(),
      createGain: audioNode, createOscillator: audioNode, createBufferSource: audioNode,
      createBiquadFilter: audioNode,
      createBuffer: function (ch, len) { return { getChannelData: function () { return new Float32Array(len); } }; },
      resume: function () { var c = this; return Promise.resolve().then(function () { c.state = 'running'; }); }
    };
  }

  var MathFake = Object.create(Math);
  MathFake.random = rng;

  function DateFake() { return new RealDate(now); }
  var RealDate = Date;
  DateFake.now = function () { return now; };
  DateFake.parse = RealDate.parse;
  DateFake.UTC = RealDate.UTC;
  DateFake.prototype = RealDate.prototype;

  var win = {
    innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1,
    document: documentShim, localStorage: storage,
    navigator: { userAgent: '', userActivation: { hasBeenActive: false, isActive: false } },
    AudioContext: audioCtxStub,
    matchMedia: function () { return { matches: false, addEventListener: function () {}, addListener: function () {} }; },
    addEventListener: function () {}, removeEventListener: function () {},
    getComputedStyle: function () { return { getPropertyValue: function () { return ''; } }; },
    requestAnimationFrame: function (fn) { return 0; }, cancelAnimationFrame: function () {},
    performance: { now: function () { return now; } }
  };

  return {
    win: win, document: documentShim, storage: storage, registry: registry,
    advance: advance, now: function () { return now; },
    sandboxArgs: {
      names: ['window', 'self', 'globalThis', 'document', 'localStorage', 'navigator', 'AudioContext',
        'webkitAudioContext', 'matchMedia', 'getComputedStyle', 'devicePixelRatio',
        'requestAnimationFrame', 'cancelAnimationFrame', 'performance',
        'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date', 'Math'],
      values: [win, win, win, documentShim, storage, win.navigator, audioCtxStub, audioCtxStub,
        win.matchMedia, win.getComputedStyle, 1, win.requestAnimationFrame,
        win.cancelAnimationFrame, win.performance,
        function (fn, ms) { return addTimer(fn, ms, true); },
        function (id) { delete timers[id]; },
        function (fn, ms) { return addTimer(fn, ms, false); },
        function (id) { delete timers[id]; },
        DateFake, MathFake]
    }
  };
}

/* ---------------- 场景：单一种子完整跑一遍，返回断言与样本有效性 ---------------- */
function runScenario(seed) {
  var out = { valid: false, results: [] };
  function push(name, pass, detail) {
    out.results.push({ name: name, pass: !!pass, detail: detail || (pass ? 'ok' : 'FAILED') });
  }
  var host = createHost(seed);
  // 战役存档：L1/L2 已通 → L3(idx2) 解锁；教程已看过跳过弹层
  host.storage.setItem('linkup3d.campaign.v1',
    '{"v":1,"levels":{"0":{"stars":1,"bestScore":100,"bestTimeSec":30},"1":{"stars":1,"bestScore":100,"bestTimeSec":30}}}');
  host.storage.setItem('linkup3d.tutorial', '1');

  // 加载真实脚本（沙箱注入宿主垫片）
  var args = host.sandboxArgs;
  var tail = '\n;return (typeof module === "object" && module.exports) ? module.exports : (typeof this !== "undefined" ? this : undefined);';
  SCRIPT_ORDER.forEach(function (name) {
    var code = readUtf8(path.join(ROOT, 'js', name + '.js'));
    var factory = new Function(args.names.concat('module').join(','), code + tail);
    factory.apply(host.win, args.values.concat([undefined]));
  });
  var win = host.win;
  var L = win.Link3D, FRZ = win.Frost;

  // 观察者探针（不改被测代码）：记录最近一次 frost 状态转移 + frozenList 调用计数
  var frostProbe = { state: null, broken: [] };
  ['telegraph', 'freeze', 'crackAround'].forEach(function (fn) {
    var orig = FRZ[fn];
    FRZ[fn] = function () {
      var o = orig.apply(FRZ, arguments);
      frostProbe.state = (o && o.state) ? o.state : o;
      if (fn === 'crackAround' && o) frostProbe.broken = o.broken || [];
      return o;
    };
  });
  var frozenListCalls = 0;
  var origFrozenList = FRZ.frozenList;
  FRZ.frozenList = function () { frozenListCalls++; return origFrozenList.apply(FRZ, arguments); };

  var boardEl = host.document.getElementById('board');
  function slotEl(r, c) {
    var found = null;
    boardEl.children.forEach(function (s) {
      var t = s.querySelector('.tile');
      if (t && (t.getAttribute('aria-label') || '').indexOf('第' + r + '行第' + c + '列') >= 0) found = s;
    });
    return found;
  }
  function tileEl(r, c) {
    var s = slotEl(r, c);
    return s ? s.querySelector('.tile') : null;
  }
  // 从 DOM 重建扩展网格（findPath 需要零边框，与 L.dealGrid 输出同构）
  function gridFromDom() {
    var rows = 4, cols = 6; // L3 霜纹初现
    var g = [];
    for (var i = 0; i < rows + 2; i++) g.push(new Array(cols + 2).fill(0));
    boardEl.children.forEach(function (s) {
      var t = s.querySelector('.tile');
      if (!t || s.classList.contains('removing')) return;
      var label = t.getAttribute('aria-label') || '';
      var m = label.match(/第(\d+)行第(\d+)列/);
      if (!m) return;
      var v = EMOJIS.indexOf(label.slice(0, label.indexOf('第')).trim()) + 1;
      if (v > 0) g[+m[1]][+m[2]] = v;
    });
    return g;
  }
  function findCrackPair() {
    var g = gridFromDom();
    for (var fi = 0; fi < L3_FROZEN.length; fi++) {
      var f = L3_FROZEN[fi];
      var adj = [[f.r - 1, f.c], [f.r + 1, f.c], [f.r, f.c - 1], [f.r, f.c + 1]];
      for (var ai = 0; ai < adj.length; ai++) {
        var a = { r: adj[ai][0], c: adj[ai][1] };
        var va = g[a.r] && g[a.r][a.c];
        if (!va || !FRZ.canSelect(frostProbe.state, a.r, a.c)) continue;
        for (var r = 1; r <= 4; r++) {
          for (var c = 1; c <= 6; c++) {
            if (g[r][c] !== va) continue;
            var b = { r: r, c: c };
            if (b.r === a.r && b.c === a.c) continue;
            if (!FRZ.canSelect(frostProbe.state, b.r, b.c)) continue;
            if (L.findPath(g, a, b)) return [a, b];
          }
        }
      }
    }
    return null;
  }

  // 端到端 UI 链路：战役按钮 → 星图 L3 节点（解锁态）→ 确认盘开始
  host.document.getElementById('campaign').click();
  var nodes = host.document.getElementById('starmapGrid').querySelectorAll('.starmap-node');
  var node3 = null;
  nodes.forEach(function (n) { if (n.dataset.idx === '2') node3 = n; });
  if (!node3 || node3.classList.contains('locked')) {
    push('R0 星图 L3 节点解锁可点', false, node3 ? 'locked' : 'node missing');
    return out;
  }
  node3.click();
  host.document.getElementById('confirmGo').click();

  // 越过预冻 restore 窗口（enterCampaign 预冻 t0=now-1，restore 2s 内不可消）
  var before = frozenListCalls;
  host.advance(2100); // ≈8+ 次 250ms 心跳
  push('R1a 无巡猎者关卡心跳持续调用 frozenList',
    frozenListCalls - before >= 7,
    '2.1s 增量 ' + (frozenListCalls - before) + '（期望 ≥7）');
  var s22 = slotEl(2, 2);
  push('R1b 预冻三态经心跳上屏', !!(s22 && s22.classList.contains('tile-frozen')),
    s22 ? s22.className : 'slot missing');

  // 消除冰封邻格同值对 → 裂冰
  var move = findCrackPair();
  if (!move) return out; // 样本无效：换种子
  var callsBefore = frozenListCalls;
  tileEl(move[0].r, move[0].c).click();
  tileEl(move[1].r, move[1].c).click();

  // issue #52 主案：消除瞬间（0ms，任何心跳前）.cracked 立即上屏
  s22 = slotEl(2, 2);
  var crackedNow = !!(s22 && s22.classList.contains('cracked'));
  push('R2a 裂冰瞬间 .cracked 立即上屏（无心跳介入）', crackedNow,
    'clicked ' + JSON.stringify(move) + ' class=' + (s22 ? s22.className : 'n/a'));
  push('R2b 立即同步触发 frozenList（eliminate 内同步调用）',
    frozenListCalls > callsBefore, '增量 ' + (frozenListCalls - callsBefore));
  if (!crackedNow) return out;

  // 瞬态震颤自动移除，裂纹态持久
  host.advance(450);
  s22 = slotEl(2, 2);
  push('R3a 瞬态 tile-cracking 420ms 后自动移除', !s22.classList.contains('tile-cracking'), s22.className);
  var mid = frozenListCalls;
  host.advance(1000);
  s22 = slotEl(2, 2);
  var stillFrozen = s22.classList.contains('tile-frozen');
  push('R3b 裂纹态 .cracked 跨心跳持久', s22.classList.contains('cracked') && frozenListCalls - mid >= 3,
    '心跳增量 ' + (frozenListCalls - mid) + ' class=' + s22.className);
  if (!stillFrozen) return out; // 期间触发洗牌（发牌运气），样本无效

  // 第二次邻近消除 → 破裂清态（probe 确认本样本确有破裂事件）
  var move2 = findCrackPair();
  if (!move2) return out;
  frostProbe.broken = [];
  tileEl(move2[0].r, move2[0].c).click();
  tileEl(move2[1].r, move2[1].c).click();
  if (!frostProbe.broken.length) return out; // 本样本未引发破裂（消序影响 crackAround 目标），换种子
  host.advance(450);
  var clean = true, desc = [];
  frostProbe.broken.forEach(function (p) {
    var sl = slotEl(p.r, p.c);
    var cls = sl ? sl.className : 'MISSING';
    desc.push(p.r + ',' + p.c + ' [' + cls + ']');
    if (!sl || sl.classList.contains('cracked') || sl.classList.contains('tile-frozen')) clean = false;
  });
  push('R4a 破裂冰封的 .cracked/.tile-frozen 清除（立即同步）', clean, desc.join(' '));
  host.advance(1000);
  var after = true;
  frostProbe.broken.forEach(function (p) {
    var sl = slotEl(p.r, p.c);
    if (sl && (sl.classList.contains('cracked') || sl.classList.contains('tile-frozen'))) after = false;
  });
  push('R4b 破裂后心跳不再同步回 .cracked/.tile-frozen', after, desc.join(' '));
  out.valid = true;
  return out;
}

function runChecks() {
  var last = null;
  for (var seed = 1; seed <= 12; seed++) {
    var run;
    try {
      run = runScenario(seed);
    } catch (e) {
      return [{ name: 'R0 运行时仿真无异常加载', pass: false, detail: (e && (e.stack || e.message)) || String(e) }];
    }
    last = run;
    if (run.valid) return run.results;
  }
  // 无有效样本（极端情况）：报告最后一次样本，R4 标注样本无效
  if (last && last.results.length) {
    return last.results.concat([{
      name: 'R4 破裂清态（样本有效性）', pass: false,
      detail: '12 个随机种子均未获得完整可评样本（裂冰对/未洗牌）——请检查发牌或冰封布局'
    }]);
  }
  return last ? last.results : [{ name: 'R0 场景执行', pass: false, detail: 'no results' }];
}

module.exports = { runChecks: runChecks };

if (require.main === module) {
  var rs = runChecks();
  var p = 0;
  rs.forEach(function (r) {
    console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + '  -> ' + r.detail);
    if (r.pass) p++;
  });
  console.log(p + '/' + rs.length + ' passed');
  process.exit(p === rs.length ? 0 : 1);
}
