/**
 * ufo.js — 巡猎者冰冻视效：外星飞碟进场 + 冷光束（issue #57，纯表现层零逻辑）
 *
 * - window.UFO，UMD 双端（Node 可 require 做纯函数侧证），与 fx.js 同风格；
 * - 渲染：独立轻量 DOM 层（div，absolute 于 #board 容器内、translateZ 抬至牌面之上、
 *   盖于弹层之下），CSS transform/transition 动画。不用 canvas：#starfield 循环由
 *   stars.js 独占、#fxlayer 按需 rAF burst 结束即停，均不能寄生持续悬停动画；
 * - 纯函数核心：chooseSide / hoverOffset / nextState / session 状态机
 *   （可注入 rand，确定性可测）；
 * - 时序：telegraph → 屏外随机侧飞入（≤1.2s）减速后悬停于目标格正上方
 *   （40~60px，内部 bob 层上下浮动）；freeze → 底部锥形冷光束 ~200ms 达峰，
 *   亮起的同一帧 game.js 原逻辑照常上冰（UFO 绝不推迟冰封）；峰值后 ~300ms 淡出，
 *   UFO 向上爬升并向悬停侧反方向飞离，strike→离场 ≤2s；cancel → 收光束直接飞离
 *   （不发射）；reset() → 立即清除（restart/洗牌场景，延迟回调经 token 世代号
 *   作废防竞态，与 game.js 的 gen 模式对应）。
 * - 同时只允许一只 UFO：telegraph 期间再来 telegraph，旧的飞离、新的进场替换。
 * - prefers-reduced-motion 命中时 telegraph/strike/cancel 全 no-op（静默原逻辑）；
 *   动画只用 transform/opacity；document.hidden 时不启动新飞入动画。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.UFO = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 状态机：idle →(telegraph) hovering →(freeze) striking →(finish) idle
  //        hovering/striking →(cancel/被顶替后 finish) → idle；telegraph 可从任意态顶替
  var STATES = ['idle', 'hovering', 'striking', 'departing'];
  var HOVER_MIN = 40, HOVER_MAX = 60; // 悬停高度：目标格上方 40~60px（issue 要求）
  var FLY_MS = 1150;        // 飞入用时（≤1.2s）
  var ENTER_MS = 450;       // 就位后衔接浮动的首段过渡
  var HOVER_Y = 7;          // 就位下沉量(px)，bob 循环负责持续上下浮动
  var BEAM_RISE_MS = 200;   // 光束达峰
  var BEAM_HOLD_MS = 320;   // 峰值保持（合计光束亮时 ~820ms）
  var BEAM_FADE_MS = 300;   // 光束淡出
  var LEAVE_MS = 800;       // 爬升+反向飞离（strike→离场总计 ~1.7s ≤ 2s）

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  /** 飞入侧选择（纯函数）：rand<0.5 → 'left'，否则 'right' */
  function chooseSide(rand) {
    return rand() < 0.5 ? 'left' : 'right';
  }

  /** 悬停高度（纯函数）：tau ∈ [0,1] 线性映射到 [40,60] px */
  function hoverOffset(tau) {
    return clamp(HOVER_MIN + tau * (HOVER_MAX - HOVER_MIN), HOVER_MIN, HOVER_MAX);
  }

  /**
   * 状态机迁移（纯函数）：未知事件返回原状态。
   * telegraph 从任意态均可顶替 → hovering（同刻新 telegraph 替换旧 telegraph）。
   */
  function nextState(state, event) {
    if (event === 'telegraph') return 'hovering';
    if (event === 'freeze') return state === 'hovering' ? 'striking' : state;
    if (event === 'cancel') {
      return (state === 'hovering' || state === 'striking') ? 'departing' : state;
    }
    if (event === 'finish') {
      return (state === 'departing' || state === 'striking') ? 'idle' : state;
    }
    return state;
  }

  /* ---- 会话状态机（纯结构侧证；telegraph 直接覆盖 active = 顶替语义） ---- */

  function createSession() { return { state: 'idle', active: null }; }

  function telegraphSession(session, r, c, side, tau) {
    session.state = nextState(session.state, 'telegraph');
    session.active = { r: r, c: c, side: side, tau: tau };
    return session;
  }

  function strikeSession(session) {
    session.state = nextState(session.state, 'freeze');
    return session;
  }

  function cancelSession(session) {
    session.state = nextState(session.state, 'cancel');
    return session;
  }

  function finishSession(session) {
    session.state = nextState(session.state, 'finish');
    session.active = null;
    return session;
  }

  /**
   * 浏览器适配层：mount(containerEl, options) → { telegraph, strike, cancel, reset }。
   * containerEl 为 #board 内的 #ufoLayer 容器节点（index.html 静态声明）。
   * options（均可注入以便 Node 侧证）：rand / reducedMotion / motionQuery /
   * isHidden / global（window 替身：rAF、setTimeout）。
   */
  function mount(containerEl, options) {
    var opts = options || {};
    var rand = typeof opts.rand === 'function' ? opts.rand : Math.random;
    var globalObj = opts.global ||
      (typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : {}));
    var isHidden = typeof opts.isHidden === 'function' ? opts.isHidden : function () {
      try { return typeof document !== 'undefined' && document.hidden === true; }
      catch (e) { return false; }
    };
    var motionQuery = typeof opts.motionQuery === 'function' ? opts.motionQuery :
      (typeof matchMedia === 'function' ? function () {
        return matchMedia('(prefers-reduced-motion: reduce)');
      } : null);
    var reduced = opts.reducedMotion === true || (function () {
      try { return !!(motionQuery && motionQuery().matches === true); }
      catch (e) { return false; }
    })();

    var session = createSession();
    var token = 0; // 世代号：顶替/strike/cancel/reset 后作废旧会话挂起的延迟回调
    var rootEl = containerEl || null;

    function raf(fn) {
      return typeof globalObj.requestAnimationFrame === 'function'
        ? globalObj.requestAnimationFrame(fn) : globalObj.setTimeout(fn, 16);
    }
    function later(fn, ms) {
      var g = globalObj;
      return typeof g.setTimeout === 'function' ? g.setTimeout(fn, ms) : setTimeout(fn, ms);
    }

    // 目标格中心在 #board 局部坐标系中的位置：纯 CSS 变量推算，与 game.js
    // positionSlot 的 left/top 公式一致（3D 变换下 getBoundingClientRect 失真，不可用；
    // 自定义属性沿 #board→#ufoLayer 继承，直接读 rootEl 计算样式即可）
    function targetLocal(r, c) {
      if (!rootEl || typeof getComputedStyle !== 'function') return null;
      var cs = getComputedStyle(rootEl);
      var cellW = parseFloat(cs.getPropertyValue('--cell-w'));
      if (!(cellW > 0)) return null;
      var cellH = parseFloat(cs.getPropertyValue('--cell-h'));
      if (!(cellH > 0)) cellH = cellW;
      var tileW = parseFloat(cs.getPropertyValue('--tile-w'));
      if (!(tileW > 0)) tileW = cellW * 0.84;
      var tileH = parseFloat(cs.getPropertyValue('--tile-h'));
      if (!(tileH > 0)) tileH = tileW;
      return {
        x: (c - 1) * cellW + cellW * 0.08 + tileW / 2,
        y: (r - 1) * cellH + cellH * 0.08 + tileH / 2,
        w: tileW
      };
    }

    function buildUfo(p, w) {
      var ufo = document.createElement('div');
      ufo.className = 'ufo';
      ufo.style.width = w + 'px';
      ufo.style.marginLeft = (-w / 2) + 'px'; // 水平居中于 translate 锚点（静态偏移）
      ufo.innerHTML =
        '<div class="ufo-bob">' +
        '<div class="ufo-dome"></div>' +
        '<div class="ufo-body"><div class="ufo-lights"></div></div>' +
        '<div class="ufo-glow"></div>' +
        '</div>';
      return ufo;
    }

    // 飞离：向上爬升 + 悬停侧反方向飞出（纯 transform）；withBeam 时先发射冷光束。
    // 最终清理回调不经 token 守卫（顶替场景旧碟必须自我清走）；done 由调用方守卫。
    function flyAway(myToken, p, ufo, withBeam, done) {
      var tau = p.hover; // 悬停高度（已含 clamp）
      var beam = null;
      if (withBeam) {
        var bw = Math.round(p.w * 0.8);
        var beamTop = p.y - tau + p.h / 2 + 2; // 碟底缘
        beam = document.createElement('div');
        beam.className = 'ufo-beam';
        beam.style.left = p.x + 'px';
        beam.style.top = beamTop + 'px';
        beam.style.width = bw + 'px';
        beam.style.marginLeft = (-bw / 2) + 'px';
        beam.style.height = Math.max(14, p.y - beamTop + 6) + 'px';
        rootEl.appendChild(beam);
        // 下一帧点亮 → CSS 过渡在 BEAM_RISE_MS 内达到峰值亮度（issue 时序）
        raf(function () {
          if (myToken === token && beam) beam.style.opacity = '1';
        });
        later(function () {
          if (myToken !== token || !beam.parentNode) return;
          beam.style.transition = 'opacity ' + BEAM_FADE_MS + 'ms ease-out';
          beam.style.opacity = '0';
        }, BEAM_RISE_MS + BEAM_HOLD_MS);
      }
      var exitX = (p.side === 'left' ? -1 : 1) * (Math.abs(p.x) + 320);
      ufo.classList.add('leaving');
      ufo.style.transition = 'transform ' + LEAVE_MS + 'ms cubic-bezier(.5,.05,.75,.4)';
      ufo.style.transform = 'translate(' + (exitX - p.x).toFixed(1) + 'px,' +
        (p.y - tau - p.h / 2 - 70).toFixed(1) + 'px)';
      later(function () {
        if (beam && beam.parentNode) beam.parentNode.removeChild(beam);
        if (ufo.parentNode) ufo.parentNode.removeChild(ufo);
        if (done) done();
      }, LEAVE_MS + 40);
    }

    function telegraphFn(r, c) {
      if (reduced || !rootEl) return; // reduced-motion：完全 no-op（issue 要求5）
      var p = targetLocal(r, c);
      if (!p) return;
      var side = chooseSide(rand);
      if (session.state === 'hovering' || session.state === 'striking') {
        // 同刻新 telegraph：旧 UFO 立即飞离（不发射），新 UFO 进场替换
        var oldUfo = rootEl.querySelector('.ufo:not(.leaving)');
        if (oldUfo) {
          token++; // 作废旧碟挂起的就位/浮动回调
          flyAway(token, session.active, oldUfo, false);
        }
      }
      token++;
      var myToken = token;
      session = telegraphSession(session, r, c, side, rand());
      // 会话内缓存几何与尺度：strike/cancel 时无需重测（避免 3D 失真）
      var active = session.active;
      active.hover = hoverOffset(active.tau);
      active.w = p.w;
      active.h = Math.round(p.w * 1.4 * 0.5); // 碟高 = 碟宽 ×0.5（CSS 同步）
      active.x = p.x;
      active.y = p.y;

      var ufo = buildUfo(p, Math.round(p.w * 1.4)); // 碟宽 ≈ 目标格宽 ×1.4
      var anchorY = p.y - active.hover - active.h / 2; // 碟中心 = 目标格上方 hover px
      var startX = (side === 'left' ? -1 : 1) * (p.x + 240); // 屏外起点（board 局部系）
      ufo.style.transition = 'none';
      ufo.style.transform = 'translate(' + startX.toFixed(1) + 'px,' +
        anchorY.toFixed(1) + 'px)';
      rootEl.appendChild(ufo);

      if (isHidden()) return; // 页面不可见：不启动新飞入（状态照常推进，视效静默）

      raf(function () {
        if (myToken !== token) return;
        // 飞入：长缓出减速就位，随后衔接上下浮动循环
        ufo.style.transition = 'transform ' + FLY_MS + 'ms cubic-bezier(.15,.6,.3,1)';
        ufo.style.transform = 'translate(' + p.x.toFixed(1) + 'px,' +
          anchorY.toFixed(1) + 'px)';
        later(function () {
          if (myToken !== token) return;
          ufo.style.transition = 'transform ' + ENTER_MS + 'ms ease-out';
          ufo.style.transform = 'translate(' + p.x.toFixed(1) + 'px,' +
            (anchorY + HOVER_Y).toFixed(1) + 'px)';
          ufo.classList.add('hovering'); // 启用 bob 循环动画（内层 transform，不冲突）
        }, FLY_MS + 20);
      });
    }

    function strikeFn(r, c) {
      if (reduced || !rootEl) return; // 冰封本体由 game.js 在本帧照常执行，与 UFO 无关
      if (session.state !== 'hovering') return; // 无悬停 UFO：静默
      token++;
      var myToken = token;
      session = strikeSession(session);
      var p = session.active;
      var ufo = rootEl.querySelector('.ufo:not(.leaving)');
      if (!ufo || !p) return;
      flyAway(myToken, p, ufo, !isHidden(), function () {
        if (myToken === token) session = finishSession(session);
      });
    }

    function cancelFn(r, c) {
      if (reduced || !rootEl) return;
      if (session.state !== 'hovering' && session.state !== 'striking') return;
      token++;
      var myToken = token;
      session = cancelSession(session);
      var p = session.active;
      var ufo = rootEl.querySelector('.ufo:not(.leaving)');
      if (!ufo || !p) { session = finishSession(session); return; }
      flyAway(myToken, p, ufo, false, function () { // cancel：不发射，直接飞离
        if (myToken === token) session = finishSession(session);
      });
    }

    function reset() {
      token++; // 作废全部挂起回调（restart/洗牌等 gen 竞态场景）
      session = createSession();
      if (rootEl) rootEl.innerHTML = '';
    }

    return {
      telegraph: telegraphFn,
      strike: strikeFn,
      cancel: cancelFn,
      reset: reset,
      isReduced: function () { return reduced; },
      _session: function () { return session; }
    };
  }

  return {
    STATES: STATES,
    HOVER_MIN: HOVER_MIN,
    HOVER_MAX: HOVER_MAX,
    FLY_MS: FLY_MS,
    BEAM_RISE_MS: BEAM_RISE_MS,
    LEAVE_MS: LEAVE_MS,
    chooseSide: chooseSide,
    hoverOffset: hoverOffset,
    nextState: nextState,
    createSession: createSession,
    telegraphSession: telegraphSession,
    strikeSession: strikeSession,
    cancelSession: cancelSession,
    finishSession: finishSession,
    mount: mount
  };
});
