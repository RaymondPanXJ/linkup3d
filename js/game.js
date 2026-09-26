/**
 * game.js — 3D 连连看 UI 与游戏逻辑（纯原生 JS）
 * 依赖：js/link3d.js（window.Link3D）、js/combo.js（window.Combo）、
 *       js/ranking.js（window.Ranking）、js/music.js（window.Music）、
 *       js/stars.js（window.Stars）、js/timer.js（window.Timer）、
 *       js/mobile.js（window.Link3DMobile）
 */
(function () {
  'use strict';

  var L = window.Link3D;
  var CB = window.Combo;
  var TM = window.Timer;
  var RK = window.Ranking;
  var Mobile = window.Link3DMobile;
  var Hint = window.Hint;
  var FRZ = window.Frost;   // js/frost.js 冻冰状态层（issue #27）
  var ENM = window.Enemy;   // js/enemy.js 巡猎者大脑（issue #29）
  var CP = window.Campaign;      // js/campaign.js 关卡数据/星级纯函数（issue #33）
  var SV = window.CampaignSave;  // js/save.js 战役存档（storage 注入式，issue #33）

  /* ---------------- 难度 ---------------- */
  var DIFFICULTIES = {
    easy:   { rows: 4, cols: 4 },
    normal: { rows: 4, cols: 6 },
    hard:   { rows: 6, cols: 8 }
  };
  var DIFF_KEY = 'linkup3d.difficulty';

  function loadDifficulty() {
    var key = null;
    try { key = localStorage.getItem(DIFF_KEY); } catch (e) { /* 无存储环境忽略 */ }
    return DIFFICULTIES[key] ? key : 'normal';
  }

  var difficulty = loadDifficulty();

  function currentDims() { return DIFFICULTIES[difficulty]; }

  // 图案池需覆盖最大难度的对数（6x8 -> 24 对）
  var EMOJIS = ['🍎', '🍇', '🍋', '🍉', '🚀', '🎲', '🐱', '🐼', '⚡', '🌙', '🍄', '🎈',
                '🍒', '🥕', '🌵', '🎸', '⚽', '🏀', '🐸', '🦊', '🍭', '🎯', '🔔', '🌈'];

  /* ---------------- DOM ---------------- */
  var board = document.getElementById('board');
  var scene = document.getElementById('scene');
  var stage = document.getElementById('stage');
  var pathLayer = document.getElementById('pathLayer');
  var scoreEl = document.getElementById('score');
  var comboEl = document.getElementById('combo');
  var comboStat = document.getElementById('comboStat');
  var timeEl = document.getElementById('time');
  var pairsEl = document.getElementById('pairs');
  var bestEl = document.getElementById('best');
  var bestStat = document.getElementById('bestStat');
  var toastEl = document.getElementById('toast');
  var overlay = document.getElementById('overlay');
  var finalTitleEl = document.getElementById('finalTitle');
  var finalScoreEl = document.getElementById('finalScore');
  var finalTimeEl = document.getElementById('finalTime');
  var muteBtn = document.getElementById('mute');
  var musicBtn = document.getElementById('music');
  var pauseBtn = document.getElementById('pause');
  var pauseScreen = document.getElementById('pauseScreen');
  var statTime = document.getElementById('statTime');
  var rankBtn = document.getElementById('rank');
  var rankOverlay = document.getElementById('rankOverlay');
  var rankTabs = document.getElementById('rankTabs');
  var rankTbody = document.getElementById('rankTbody');
  var rankClose = document.getElementById('rankClose');
  var themeBtn = document.getElementById('theme');
  var campaignBtn = document.getElementById('campaign');
  var starMapEl = document.getElementById('starMap');
  var starMapClose = document.getElementById('starMapClose');
  var starmapGridEl = document.getElementById('starmapGrid');
  var starmapBack = document.getElementById('starmapBack');
  var levelConfirmEl = document.getElementById('levelConfirm');
  var confirmTitleEl = document.getElementById('confirmTitle');
  var confirmInfoEl = document.getElementById('confirmInfo');
  var confirmWarnEl = document.getElementById('confirmWarn');
  var confirmCancelBtn = document.getElementById('confirmCancel');
  var confirmGoBtn = document.getElementById('confirmGo');
  var finalStarsEl = document.getElementById('finalStars');
  var nextLevelBtn = document.getElementById('nextLevel');
  var toStarMapBtn = document.getElementById('toStarMap');
  var timeLabelEl = document.getElementById('timeLabel');
  var settleBtnIds = ['restart', 'hint', 'help', 'pause', 'rank'];

  /* ---------------- 视效粒子层（issue #41，T7，纯表现层零逻辑） ----------------
   * fx.js 独立 canvas #fxlayer + 按需 rAF（取舍见 fx.js 头注释）；
   * reduced-motion 时 FX 内部保证 burst 为 no-op。 */
  var FX = window.FX;
  var fxLayer = FX.mount(document.getElementById('fxlayer'));

  // 目标格中心的视口坐标 → 触发一次粒子 burst
  function fxBurst(r, c, kind) {
    var s = slots[r + ',' + c];
    if (!s) return;
    var rect = s.getBoundingClientRect();
    fxLayer.burst(rect.left + rect.width / 2, rect.top + rect.height / 2, kind);
  }

  // 预警收缩圈时长与 telegraphMs 同步（CSS 用 --telegraph-ms 驱动动画，issue #41）
  function setTelegraphMs(ms) {
    document.documentElement.style.setProperty('--telegraph-ms', ms + 'ms');
  }

  /* ---------------- 主题（深空→浅色→霓虹 循环，issue #15） ---------------- */
  var THEME_KEY = 'linkup3d.theme';
  var THEMES = ['deep-space', 'light', 'neon'];
  var THEME_NAMES = { 'deep-space': '深空', 'light': '浅色', 'neon': '霓虹' };

  function loadTheme() {
    var t = null;
    try { t = localStorage.getItem(THEME_KEY); } catch (e) { /* 无存储环境忽略 */ }
    return THEMES.indexOf(t) >= 0 ? t : 'deep-space';
  }

  var theme = loadTheme();

  function applyTheme() {
    document.documentElement.setAttribute('data-theme', theme);
    themeBtn.setAttribute('aria-label', '切换主题，当前：' + THEME_NAMES[theme]);
    themeBtn.setAttribute('aria-pressed', theme === 'deep-space' ? 'false' : 'true');
  }

  themeBtn.addEventListener('click', function () {
    theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) { /* 忽略 */ }
    applyTheme();
  });

  applyTheme();
  var hintBtn = document.getElementById('hint');
  var hintCountEl = document.getElementById('hintCount');
  var helpBtn = document.getElementById('help');

  /* ---------------- 音效（WebAudio 程序化合成，零音频文件） ---------------- */
  var SFX = (function () {
    var MUTE_KEY = 'linkup3d.muted';
    var muted = false;
    try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch (e) { /* 无存储环境忽略 */ }

    var ctx = null;
    function ensureCtx() {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      if (!ctx) { try { ctx = new AC(); } catch (e) { return null; } }
      // 浏览器自动播放策略：上下文初始为 suspended，需在用户手势中恢复
      if (ctx.state === 'suspended' && ctx.resume) { try { ctx.resume(); } catch (e) { /* 忽略 */ } }
      return ctx;
    }

    // 在 [t0, t0+dur] 播放一个带包络的振荡器音； glideTo 为可选滑音目标频率
    function tone(freq, t0, dur, type, gain, glideTo) {
      var o = ctx.createOscillator();
      var g = ctx.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, t0);
      if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
      var peak = gain || 0.15;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(ctx.destination);
      o.start(t0);
      o.stop(t0 + dur + 0.03);
    }

    function play(voice) {
      if (muted) return;
      var c = ensureCtx();
      if (!c) return;
      voice(c, c.currentTime + 0.01);
    }

    return {
      isMuted: function () { return muted; },
      setMuted: function (m) {
        muted = !!m;
        try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch (e) { /* 忽略 */ }
      },
      // 消除成功：双音上行叮声
      match: function () {
        play(function (c, t) {
          tone(784, t, 0.09, 'triangle', 0.16);          // G5
          tone(1046.5, t + 0.06, 0.16, 'triangle', 0.16); // C6
        });
      },
      // 连击：半音阶递进，combo 越高音调越高（静音经 play() 统一拦截）
      combo: function (level) {
        var freq = 523.25 * Math.pow(2, Math.min(level - 1, 12) / 12); // C5 起，每级 +1 半音
        play(function (c, t) {
          tone(freq, t, 0.12, 'triangle', 0.14);
          tone(freq * 2, t + 0.03, 0.1, 'sine', 0.06);
        });
      },
      // 配对失败：低滑音蜂鸣
      fail: function () {
        play(function (c, t) {
          tone(220, t, 0.22, 'sawtooth', 0.09, 140);
        });
      },
      // 洗牌：快速上滑刮奏
      shuffle: function () {
        play(function (c, t) {
          tone(262, t, 0.3, 'triangle', 0.12, 784);
          tone(330, t + 0.05, 0.26, 'sine', 0.08, 988);
        });
      },
      // 倒计时滴答：≤10s 每秒一次；critical（≤5s）用更高更急的双音
      tick: function (critical) {
        play(function (c, t) {
          if (critical) {
            tone(1320, t, 0.05, 'square', 0.07);
            tone(1320, t + 0.08, 0.05, 'square', 0.07);
          } else {
            tone(988, t, 0.05, 'square', 0.07);
          }
        });
      },
      // 通关：四音上行小号角
      win: function () {
        play(function (c, t) {
          var seq = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
          for (var i = 0; i < seq.length; i++) {
            tone(seq[i], t + i * 0.13, 0.3, 'square', 0.07);
            tone(seq[i] * 2, t + i * 0.13, 0.24, 'sine', 0.05);
          }
        });
      },
      // 限时超时：三音下行低音号
      lose: function () {
        play(function (c, t) {
          var seq = [392, 311.13, 261.63]; // G4 Eb4 C4
          for (var i = 0; i < seq.length; i++) {
            tone(seq[i], t + i * 0.16, 0.34, 'square', 0.07);
          }
        });
      },
      // 冻结（issue #31）：玻璃质感下行滑音 + 噪声脆响
      freeze: function () {
        play(function (c, t) {
          tone(1568, t, 0.3, 'sine', 0.11, 523.25); // G6 → C5 下行
          tone(2093, t + 0.05, 0.18, 'triangle', 0.06, 1046.5);
          var dur = 0.09;
          var buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate);
          var data = buf.getChannelData(0);
          for (var i = 0; i < data.length; i++) {
            data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2);
          }
          var src = c.createBufferSource();
          src.buffer = buf;
          var bp = c.createBiquadFilter();
          bp.type = 'bandpass';
          bp.frequency.value = 4200;
          var g = c.createGain();
          g.gain.value = 0.12;
          src.connect(bp).connect(g).connect(c.destination);
          src.start(t);
        });
      },
      // 解冻：明亮三连琶音
      thaw: function () {
        play(function (c, t) {
          var seq = [1046.5, 1318.5, 1568]; // C6 E6 G6
          for (var i = 0; i < seq.length; i++) {
            tone(seq[i], t + i * 0.05, 0.12, 'triangle', 0.11);
          }
        });
      },
      // 猎杀预警：轻滴答（预警期内每秒一次，由主循环节流）
      warn: function () {
        play(function (c, t) {
          tone(1760, t, 0.035, 'square', 0.05);
        });
      }
    };
  })();

  function renderMuteBtn() {
    muteBtn.textContent = SFX.isMuted() ? '🔇' : '🔊';
    muteBtn.setAttribute('aria-pressed', SFX.isMuted() ? 'true' : 'false');
    muteBtn.setAttribute('aria-label', SFX.isMuted() ? '取消静音' : '静音');
  }
  muteBtn.addEventListener('click', function () {
    SFX.setMuted(!SFX.isMuted());
    renderMuteBtn();
  });
  renderMuteBtn();

  /* ---------------- 背景音乐（WebAudio 程序化合成，独立于 SFX 静音，issue #10） ---------------- */
  var MUSIC_KEY = 'linkup3d.music';
  var MU = window.Music;
  var musicPlayer = MU.createPlayer();
  var musicOn = false;
  try { musicOn = localStorage.getItem(MUSIC_KEY) !== '0'; } catch (e) { /* 无存储环境默认开 */ }

  function renderMusicBtn() {
    musicBtn.textContent = musicOn ? '♪' : '♩';
    musicBtn.classList.toggle('on', musicOn);
    musicBtn.setAttribute('aria-pressed', musicOn ? 'true' : 'false');
    musicBtn.setAttribute('aria-label', musicOn ? '关闭背景音乐' : '开启背景音乐');
  }

  // 浏览器自动播放策略：AudioContext 需在用户手势中才能恢复运行，
  // 因此「首次交互」统一在这里触发启动（偏好为开时）。
  function ensureMusicStarted() {
    if (!musicOn || musicPlayer.isRunning()) return;
    musicPlayer.start();
  }

  musicBtn.addEventListener('click', function () {
    musicOn = !musicOn;
    try { localStorage.setItem(MUSIC_KEY, musicOn ? '1' : '0'); } catch (e) { /* 忽略 */ }
    if (musicOn) ensureMusicStarted(); else musicPlayer.stop();
    renderMusicBtn();
  });

  var gestureEvents = ['pointerdown', 'touchstart', 'keydown'];
  function onFirstGesture() {
    ensureMusicStarted();
    gestureEvents.forEach(function (ev) {
      window.removeEventListener(ev, onFirstGesture);
    });
  }
  gestureEvents.forEach(function (ev) {
    window.addEventListener(ev, onFirstGesture, { once: true, passive: true });
  });

  renderMusicBtn();
  if (musicOn) ensureMusicStarted(); // 支持自动播放的浏览器无需等待手势

  /* ---------------- 状态 ---------------- */
  var grid = null;          // link3d 扩展网格（0 为边框）
  var slots = {};           // key "r,c" -> .tile-slot 元素
  var selected = null;      // {r, c}
  var score = 0;
  var combo = 0;
  var maxCombo = 0;        // 本局连击最高值（用于排行榜记录）
  var lastMatchAt = 0;
  var best = 0;              // 当前难度的历史最高分
  var timerId = null;
  var running = false;
  var busy = false;         // 消除/洗牌动画期间锁定输入
  var gen = 0;              // 局号：restart 后作废旧局的延时回调
  var cellW = 0, cellH = 0;

  /* ---------------- 模式（无尽 / 限时）与计时状态 ---------------- */
  var MODE_KEY = 'linkup3d.mode';
  var mode = TM.MODES.endless;
  try {
    mode = TM.normalizeMode(localStorage.getItem(MODE_KEY));
  } catch (e) { mode = TM.MODES.endless; }

  var tState = TM.create(mode);   // timer.js 纯函数状态
  var paused = false;

  /* ---------------- 战役状态（issue #33 T5） ----------------
   * campaignIdx：当前战役关卡索引（null = 自由模式）。战役局禁用模式/
   * 难度按钮，胜利经 CampaignSave 存档；自由模式的 mode 偏好不被战役改写。 */
  var campaignIdx = null;
  var campaignData = SV.load(typeof localStorage !== 'undefined' ? localStorage : null);

  function nowMs() {
    return (window.performance && window.performance.now)
      ? window.performance.now() : Date.now();
  }

  var REMOVE_MS = 560;
  var SHUFFLE_MS = 900;
  var SHUFFLE_NOTICE_MS = 900; // 「正在洗牌」toast 至少展示时长（issue #16 ≥800ms）

  var hintsLeft = Hint.HINTS_PER_GAME; // 每局 3 次，不持久化
  var hintTimer = null;

  /* ---------------- 最高分（按难度分键存储） ---------------- */
  function loadBest() {
    try {
      var v = parseInt(localStorage.getItem(CB.bestKey(difficulty)), 10);
      return isNaN(v) ? 0 : v;
    } catch (e) { return 0; }
  }

  function refreshBest() {
    best = loadBest();
  }

  /* ---------------- 移动端判定（issue #14） ---------------- */
  // pointer:coarse 或 UA 兜底；无 matchMedia 的旧设备视为桌面（不倾斜逻辑另行降级）
  var IS_TOUCH = (function () {
    try {
      if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return true;
    } catch (e) { /* 忽略 */ }
    return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
  })();
  if (IS_TOUCH && document.body) document.body.classList.add('mobile-lite');

  /* ---------------- 布局（响应式） ---------------- */
  function layout() {
    var dims = currentDims();
    if (campaignIdx !== null) dims = CP.LEVELS[campaignIdx]; // 战役局：关卡表尺寸（issue #33）
    var ROWS = dims.rows, COLS = dims.cols;
    var padX = window.innerWidth < 560 ? 10 : 60;
    var hudH = document.querySelector('.hud').getBoundingClientRect().height;
    var titleH = document.querySelector('h1').getBoundingClientRect().height +
                 document.querySelector('.subtitle').getBoundingClientRect().height;
    var availW = Math.max(280, window.innerWidth - padX * 2);
    var availH = Math.max(240, window.innerHeight - titleH - hudH - (window.innerWidth < 560 ? 20 : 90));
    // 窄屏（≤420px）不乘 3D 透视缩放，保证 360px 竖屏下 6×8 牌 ≥32px 完整可见
    var narrow = window.innerWidth <= 420;
    cellW = Math.min(100, availW / (COLS + 0.6), availH / (ROWS + 0.9));
    cellW = Math.max(narrow ? 32 : 42, cellW);
    cellH = cellW;

    var bw = COLS * cellW, bh = ROWS * cellH;
    board.style.width = bw + 'px';
    board.style.height = bh + 'px';
    board.style.setProperty('--cell-w', cellW + 'px');
    board.style.setProperty('--cell-h', cellH + 'px');
    board.style.setProperty('--tile-w', Math.round(cellW * 0.84) + 'px');
    board.style.setProperty('--tile-h', Math.round(cellH * 0.84) + 'px');
    board.style.setProperty('--depth', Math.max(12, Math.round(cellW * 0.2)) + 'px');
    board.style.setProperty('--emoji-size', Math.round(cellW * 0.46) + 'px');
    document.documentElement.style.setProperty('--cell-w', cellW + 'px');
    document.documentElement.style.setProperty('--cell-h', cellH + 'px');

    // 窗口过小时缩小整个场景，保证不破版；窄屏跳过缩放（热区/最小牌宽优先，见 mobile.js）
    var fit = Mobile.sceneScale(window.innerWidth,
      Math.min(availW / (bw + 30), availH / (bh + 30)));
    scene.style.transform = 'scale(' + fit.toFixed(3) + ')';

    for (var key in slots) {
      var p = key.split(',');
      positionSlot(slots[key], +p[0], +p[1]);
    }
  }

  function positionSlot(slot, r, c) {
    slot.style.left = ((c - 1) * cellW + cellW * 0.08) + 'px';
    slot.style.top = ((r - 1) * cellH + cellH * 0.08) + 'px';
  }

  /* 轻微跟随指针转动棋盘，强化 3D 感（issue #14：指针事件兼容 + 触摸驱动 + 降级） */
  function applyTilt(x, y) {
    var rx = 14 + ((y / window.innerHeight) - 0.5) * -8;
    var ry = ((x / window.innerWidth) - 0.5) * 10;
    board.style.setProperty('--rx', rx.toFixed(2) + 'deg');
    board.style.setProperty('--ry', ry.toFixed(2) + 'deg');
  }
  function resetTilt() {
    board.style.setProperty('--rx', '16deg');
    board.style.setProperty('--ry', '0deg');
  }

  var HAS_POINTER = ('onpointermove' in window) ||
                    (typeof window.PointerEvent === 'function');
  if (HAS_POINTER) {
    // 桌面（鼠标等精确指针）：pointermove 驱动
    stage.addEventListener('pointermove', function (e) {
      if (e.pointerType === 'touch') return; // 触摸由下方 touchmove 处理
      applyTilt(e.clientX, e.clientY);
    });
    stage.addEventListener('pointerleave', resetTilt);
  }
  if (typeof window.TouchEvent === 'function') {
    // 触摸驱动倾斜：非 passive 以便 preventDefault 阻止页面滚动误触
    stage.addEventListener('touchmove', function (e) {
      var t = e.touches[0];
      if (!t) return;
      e.preventDefault();
      applyTilt(t.clientX, t.clientY);
    }, { passive: false });
    stage.addEventListener('touchend', resetTilt);
    stage.addEventListener('touchcancel', resetTilt);
  }
  /* 无 pointer 事件且无 touch 事件的旧设备：不注册任何倾斜监听，退化为固定视角 */

  /* ---------------- 建盘 ---------------- */
  function buildBoard() {
    var dims = currentDims();
    if (campaignIdx !== null) dims = CP.LEVELS[campaignIdx];
    var ROWS = dims.rows, COLS = dims.cols;
    grid = L.dealGrid(ROWS, COLS);
    Object.keys(slots).forEach(function (k) { slots[k].remove(); delete slots[k]; });
    pathLayer.innerHTML = '';
    board.setAttribute('role', 'grid');
    board.setAttribute('aria-label', ROWS + ' 行 ' + COLS + ' 列连连看棋盘');
    for (var r = 1; r <= ROWS; r++) {
      for (var c = 1; c <= COLS; c++) {
        var v = grid[r][c];
        if (!v) continue;
        var slot = document.createElement('div');
        slot.className = 'tile-slot';
        slot.innerHTML =
          '<div class="tile-spin"><div class="tile">' +
          '<div class="face front">' + EMOJIS[v - 1] + '</div>' +
          '<div class="face back"></div>' +
          '<div class="face left"></div><div class="face right"></div>' +
          '<div class="face top"></div><div class="face bottom"></div>' +
          '</div></div><div class="tile-shadow"></div>';
        var tile = slot.querySelector('.tile');
        tile.setAttribute('role', 'gridcell');
        tile.setAttribute('tabindex', '0');
        tile.setAttribute('aria-label', EMOJIS[v - 1] + ' 第' + r + '行第' + c + '列');
        tile.addEventListener('click', onTileClick.bind(null, r, c));
        tile.addEventListener('keydown', function (ev, rr, cc) {
          if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
            ev.preventDefault();
            onTileClick(rr, cc);
          }
        }.bind(null, r, c));
        board.appendChild(slot);
        slots[r + ',' + c] = slot;
      }
    }
    layout();
  }

  function tileEl(r, c) {
    var s = slots[r + ',' + c];
    return s ? s.querySelector('.tile') : null;
  }

  /* ---------------- 交互 ---------------- */
  function onTileClick(r, c) {
    if (busy || paused || !running || !grid[r][c]) return;
    // 冰冻格守卫（issue #31）：不可选中，抖动反馈 + toast
    if (!FRZ.canSelect(frostState, r, c)) {
      var s = slots[r + ',' + c];
      if (s) {
        s.classList.remove('shake');
        void s.offsetWidth;
        s.classList.add('shake');
      }
      showToast('这颗牌被冰封了');
      return;
    }
    startTimerIfNeeded();

    if (selected && selected.r === r && selected.c === c) {
      tileEl(r, c).classList.remove('selected');
      selected = null;
      return;
    }
    if (!selected) {
      selected = { r: r, c: c };
      tileEl(r, c).classList.add('selected');
      return;
    }

    var a = selected, b = { r: r, c: c };
    var ta = tileEl(a.r, a.c), tb = tileEl(b.r, b.c);

    if (grid[a.r][a.c] !== grid[b.r][b.c]) {
      rejectPair(ta, tb);
      return;
    }
    // 连通判定入口把关（issue #31）：冰冻格不得作为端点
    // （选中后目标格被冻结的竞态由这里兜住）
    if (!FRZ.canMatch(frostState, a.r, a.c, b.r, b.c)) {
      rejectPair(ta, tb);
      showToast('这颗牌被冰封了');
      return;
    }
    var path = L.findPath(grid, a, b);
    if (!path) {
      rejectPair(ta, tb);
      return;
    }
    // 合法消除
    ta.classList.remove('selected');
    selected = null;
    eliminate(a, b, path);
  }

  function rejectPair(ta, tb) {
    SFX.fail();
    [ta, tb].forEach(function (t) {
      var slot = t.parentNode.parentNode;
      slot.classList.remove('shake');
      void slot.offsetWidth; // 重置动画
      slot.classList.add('shake');
      t.classList.remove('selected');
    });
    selected = null;
    combo = CB.applyMismatch();
    renderHud();
  }

  function eliminate(a, b, path) {
    busy = true;
    SFX.match();
    drawPath(path);

    // 敌人联动（issue #31）：消除预警中的目标格 → 取消本次猎杀并撤红晕
    if (enemyState && enemyState.target) {
      if ((enemyState.target.r === a.r && enemyState.target.c === a.c) ||
          (enemyState.target.r === b.r && enemyState.target.c === b.c)) {
        enemyState = ENM.cancelTarget(enemyState, enemyState.target.r, enemyState.target.c);
        clearWarn(a.r, a.c);
        clearWarn(b.r, b.c);
      }
    }
    // 消除联动（规则2）：解冻被消两牌的正交邻冻结格，解冻瞬间播放碎裂动画
    var thawed = FRZ.frozenList(frostState);
    var thawKeys = thawed.filter(function (p) {
      return Math.abs(p.r - a.r) + Math.abs(p.c - a.c) === 1 ||
             Math.abs(p.r - b.r) + Math.abs(p.c - b.c) === 1;
    });
    if (thawKeys.length) {
      frostState = FRZ.thawAround(frostState, a.r, a.c, b.r, b.c);
      SFX.thaw();
      thawKeys.forEach(function (p) { playThaw(p.r, p.c); fxBurst(p.r, p.c, 'thaw'); });
    }

    var now = Date.now();
    var gap = lastMatchAt ? now - lastMatchAt : Infinity;
    var res = CB.applyMatch(combo, gap);
    combo = res.combo;
    if (combo > maxCombo) maxCombo = combo;
    lastMatchAt = now;
    score += res.points;
    if (CB.isActive(combo)) {
      SFX.combo(combo);
      comboStat.classList.remove('bump');
      void comboStat.offsetWidth;
      comboStat.classList.add('bump');
      showToast('连击 x' + Math.min(combo, CB.MAX_COMBO) + '！+' + res.points);
    }
    // 实时最高分：破纪录即写档并提示
    if (CB.isRecord(score, best)) {
      best = score;
      try { localStorage.setItem(CB.bestKey(difficulty), String(best)); } catch (e) { /* 忽略 */ }
      bestStat.classList.remove('record');
      void bestStat.offsetWidth;
      bestStat.classList.add('record');
      showToast('🏆 新纪录 ' + best + ' 分');
    }
    renderHud();

    grid[a.r][a.c] = 0;
    grid[b.r][b.c] = 0;

    var sa = slots[a.r + ',' + a.c], sb = slots[b.r + ',' + b.c];
    sa.classList.add('removing');
    sb.classList.add('removing');

    var myGen = gen;
    setTimeout(function () {
      if (myGen !== gen) return; // 已重新开始，丢弃旧局回调
      sa.remove(); sb.remove();
      delete slots[a.r + ',' + a.c];
      delete slots[b.r + ',' + b.c];
      clearPath();
      busy = false;
      renderHud();

      if (L.countTiles(grid) === 0) {
        win();
      } else if (!L.hasSolvablePair(grid)) {
        announceShuffle();
      }
    }, REMOVE_MS);
  }

  /* 无可连对：先解释 ≥800ms 再洗牌，避免玩家对突然变化摸不着头脑（issue #16） */
  function announceShuffle() {
    busy = true;
    showToast('无可连对，正在洗牌', SHUFFLE_NOTICE_MS);
    var myGen = gen;
    setTimeout(function () {
      if (myGen !== gen) return;
      doShuffle();
    }, SHUFFLE_NOTICE_MS);
  }

  function doShuffle() {
    busy = true;
    SFX.shuffle();
    // 洗牌全场解冻（issue #39 裁决1）：洗牌保底只看值配对、不看冰冻遮挡，
    // 冻结封锁点位会使保底失效；洗牌重建盘面时冻结状态本就无意义，
    // 清除全部冰冻与预警以恢复「洗牌后必有解」的硬保证。
    // enemyState 目标若洗牌后失效，由既有 ctx.tiles 自愈机制处理，无需额外代码。
    frostState = FRZ.create();
    Object.keys(slots).forEach(function (k) {
      slots[k].classList.remove('tile-frozen');
      slots[k].classList.remove('tile-frost-warn');
    });
    lastWarnSoundAt = 0;
    showToast('搅动星尘,寒冰消融');
    L.shuffleGrid(grid);
    // 洗牌只换图案不换格子位置，frost 坐标口径不变（issue #31 接线要求 1 的决定）
    var myGen = gen;
    Object.keys(slots).forEach(function (k) {
      var slot = slots[k], p = k.split(','), v = grid[+p[0]][+p[1]];
      slot.classList.add('shuffle');
      setTimeout(function () {
        if (myGen !== gen) return;
        slot.querySelector('.face.front').textContent = EMOJIS[v - 1];
        var t = slot.querySelector('.tile');
        t.setAttribute('aria-label', EMOJIS[v - 1] + ' 第' + p[0] + '行第' + p[1] + '列');
      }, SHUFFLE_MS / 2 - 60);
      setTimeout(function () { slot.classList.remove('shuffle'); }, SHUFFLE_MS);
    });
    setTimeout(function () { if (myGen === gen) busy = false; }, SHUFFLE_MS + 60);
  }

  /* ---------------- 连线绘制 ---------------- */
  function drawPath(path) {
    clearPath();
    for (var i = 0; i < path.length - 1; i++) {
      var p1 = path[i], p2 = path[i + 1];
      var x1 = (p1.c - 1) * cellW + cellW / 2, y1 = (p1.r - 1) * cellH + cellH / 2;
      var x2 = (p2.c - 1) * cellW + cellW / 2, y2 = (p2.r - 1) * cellH + cellH / 2;
      var seg = document.createElement('div');
      seg.className = 'path-seg';
      var len = Math.hypot(x2 - x1, y2 - y1);
      var ang = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
      seg.style.left = x1 + 'px';
      seg.style.top = (y1 - 3) + 'px';
      seg.style.width = len + 'px';
      seg.style.setProperty('--ang', ang + 'deg');
      pathLayer.appendChild(seg);
    }
  }
  function clearPath() { pathLayer.innerHTML = ''; }

  /* ---------------- HUD / 计时 / 弹窗 ---------------- */
  function renderHud() {
    scoreEl.textContent = score;
    comboEl.textContent = CB.displayCombo(combo);
    comboStat.classList.toggle('active', CB.isActive(combo));
    // 连击 ≥3 棋盘呼吸光晕钩子（issue #41，纯 CSS 由 body.combo-active 驱动）
    document.body.classList.toggle('combo-active', CB.isActive(combo));
    bestEl.textContent = best;
    pairsEl.textContent = L.countTiles(grid) / 2;
  }

  function fmt(s) {
    var m = Math.floor(s / 60), ss = s % 60;
    return (m < 10 ? '0' : '') + m + ':' + (ss < 10 ? '0' : '') + ss;
  }

  /* ---------------- 计时驱动 ----------------
   * tState 为 js/timer.js 的纯函数状态；本层只负责：
   *   - 单调时钟读数（nowMs）喂给 tick
   *   - 将 elapsed/remaining 渲染到 HUD（无尽=正计时，限时=倒计时）
   *   - ≤10s 警示态（红色脉动 + 每秒滴答音）与归零判负
   */
  function timeLabel() {
    if (mode === TM.MODES.timed) {
      return tState.running
        ? fmt(tState.remainingSec)
        : fmt(tState.limitSec);
    }
    return fmt(tState.elapsedSec);
  }

  function renderTime() {
    timeEl.textContent = timeLabel();
    statTime.classList.toggle('warning', mode === TM.MODES.timed &&
      !paused && tState.running && tState.warning);
  }

  function startTimerIfNeeded() {
    if (!running || paused || tState.running) return;
    tState = TM.start(tState, nowMs());
    if (!timerId) {
      timerId = setInterval(onTimerTick, 250);
    }
  }

  function onTimerTick() {
    if (!running || paused || !tState.running) return;
    var prevSec = tState.remainingSec;
    tState = TM.tick(tState, nowMs());
    if (mode === TM.MODES.timed) {
      // 警示区间：每秒一次滴答（暂停/未起跑不响）
      if (tState.running && !tState.paused && tState.warning &&
          tState.remainingSec !== prevSec && tState.remainingSec > 0) {
        SFX.tick(tState.remainingSec <= 5);
      }
      if (tState.finished) {
        lose();
        return;
      }
    }
    renderTime();
  }

  function stopTimer() {
    clearInterval(timerId);
    timerId = null;
  }

  /* ---------------- 暂停 / 继续 ----------------
   * HUD「暂停」按钮与空格键触发；冻结计时、遮住棋盘（防暂停偷看）、
   * 暂停期间一切输入锁定（牌面、难度、模式、重开在面板内仍可用）。
   */
  function togglePause() {
    if (!running || paused) {
      if (paused) resumeGame();
      return;
    }
    paused = true;
    tState = TM.pause(tState, nowMs());
    board.classList.add('paused');
    pauseScreen.classList.add('show');
    pauseBtn.textContent = '▶';
    pauseBtn.setAttribute('aria-pressed', 'true');
    renderTime();
  }

  function resumeGame() {
    if (!paused) return;
    paused = false;
    tState = TM.resume(tState, nowMs());
    board.classList.remove('paused');
    pauseScreen.classList.remove('show');
    pauseBtn.textContent = '⏸';
    pauseBtn.setAttribute('aria-pressed', 'false');
    renderTime();
  }

  pauseBtn.addEventListener('click', togglePause);
  document.getElementById('resume').addEventListener('click', resumeGame);

  window.addEventListener('keydown', function (ev) {
    var t = ev.target;
    if (t && (t.tagName === 'BUTTON' || t.tagName === 'INPUT' ||
              t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    if (ev.code === 'Space' || ev.key === ' ') {
      ev.preventDefault();
      togglePause();
    }
  });

  var toastTimer = null;
  function showToast(msg, ms) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); },
      ms || 1600);
  }

  function showResult(title, note) {
    finalTitleEl.textContent = title;
    finalScoreEl.textContent = score;
    finalTimeEl.textContent = note;
    if (campaignIdx === null) {
      finalStarsEl.hidden = true;
      finalStarsEl.classList.remove('show');
      nextLevelBtn.hidden = true;
      nextLevelBtn.disabled = true;
      toStarMapBtn.hidden = true;
      document.getElementById('again').textContent = '再来一局';
    }
    setTimeout(function () { overlay.classList.add('show'); }, 700);
  }

  function win() {
    running = false;
    SFX.win();
    stopTimer();
    board.classList.add('won');
    recordRound(); // 通关结算写入排行榜（issue #13）
    if (campaignIdx !== null) { settleCampaignWin(); return; }
    showResult('恭喜通关', '用时 ' + fmt(tState.elapsedSec));
  }

  /* 限时模式倒计时归零：本局判负，弹出结算面板（得分保留展示，不入排行榜） */
  function lose() {
    running = false;
    stopTimer();
    SFX.lose();
    statTime.classList.remove('warning');
    timeEl.textContent = fmt(0);
    if (paused) {
      paused = false;
      board.classList.remove('paused');
      pauseScreen.classList.remove('show');
      pauseBtn.textContent = '⏸';
      pauseBtn.setAttribute('aria-pressed', 'false');
    }
    showResult('时间到', '得分 ' + score + ' · 剩余 ' +
      (L.countTiles(grid) / 2) + ' 对');
    if (campaignIdx !== null) settleCampaignLoss();
  }

  function restart() {
    gen++;
    stopTimer();
    // 冻冰/巡猎者重置（issue #31）：首次 restart() 早于接线段初始化，typeof 兜底
    if (typeof frostState !== 'undefined') {
      frostState = FRZ.create();
      enemyState = null;
      lastWarnSoundAt = 0;
    }
    score = 0; combo = 0; maxCombo = 0; lastMatchAt = 0;
    if (campaignIdx !== null) exitCampaign(); // 重新开始 = 退出战役局，回自由模式
    tState = TM.create(mode);
    paused = false;
    lastRoundTs = 0;
    hintsLeft = Hint.HINTS_PER_GAME;
    clearHintHighlight();
    renderHintBtn();
    bestStat.classList.remove('record');
    selected = null; busy = false; running = true;
    board.classList.remove('paused');
    pauseScreen.classList.remove('show');
    pauseBtn.textContent = '⏸';
    pauseBtn.setAttribute('aria-pressed', 'false');
    renderTime();
    overlay.classList.remove('show');
    board.classList.remove('won');
    refreshBest();
    buildBoard();
    renderHud();
  }

  document.getElementById('restart').addEventListener('click', restart);
  document.getElementById('again').addEventListener('click', restart);
  window.addEventListener('resize', layout);

  /* ---------------- 冻冰 / 巡猎者接线（issue #31，T4） ----------------
   * frostState / enemyState 为 frost.js / enemy.js 的纯函数状态；本层负责：
   *   - 心跳驱动 Enemy.tick（沿用 onTimerTick 的 setInterval 250ms 模式，
   *     独立 interval，内部按 running/paused/enabled 门控）
   *   - 事件 → Frost 状态迁移 + DOM 类名 + 音效
   *   - 可解性回滚：本单不做（T2 isBoardSolvable 为接口预留；上限 4 +
   *     玩家消除邻格解冻通道已保证实践可解，T6 内容调优时再验证）——取舍记录见 issue。
   */
  var frostState = FRZ.create();  // 冻冰状态（洗牌不换格子位置，坐标不变，洗牌后原样保留）
  var enemyState = null;          // null = 巡猎者未上线
  var lastWarnSoundAt = 0;        // 预警滴答节流：每秒至多一次

  // T4 临时调试参数：战役 L3「巡猎初鸣」（campaign.js LEVELS[3].hunter，正式装载归 T5）
  function hunterCtx() {
    var tiles = {}, frozen = {};
    Object.keys(slots).forEach(function (k) { tiles[k] = true; });
    FRZ.frozenList(frostState).forEach(function (p) {
      frozen[p.r + ',' + p.c] = true;
      delete tiles[p.r + ',' + p.c]; // 已冻结格不可作目标
    });
    return {
      tiles: tiles,
      frozen: frozen,
      canFreeze: FRZ.countFrozen(frostState) < FRZ.MAX_FROZEN,
      rng: Math.random
    };
  }

  function setSlotClass(r, c, cls, on) {
    var s = slots[r + ',' + c];
    if (s) s.classList.toggle(cls, on);
  }

  function clearWarn(r, c) {
    setSlotClass(r, c, 'tile-frost-warn', false);
  }

  function playThaw(r, c) {
    var s = slots[r + ',' + c];
    if (!s) return;
    s.classList.remove('tile-thawing');
    void s.offsetWidth; // 重置动画
    s.classList.add('tile-thawing');
    var myGen = gen;
    setTimeout(function () { if (myGen === gen) s.classList.remove('tile-thawing'); }, 640);
  }

  // 预警红晕：仍在预警期，或期满但敌人本周期目标仍是该格（等下一 tick 发 freeze，避免闪烁）
  function warnActive(k, now) {
    var p = k.split(',');
    if (FRZ.isTelegraphActive(frostState, +p[0], +p[1], now)) return true;
    return !!(enemyState && enemyState.target &&
      enemyState.target.r === +p[0] && enemyState.target.c === +p[1]);
  }

  function syncFrostVisuals(now) {
    var frozen = {};
    FRZ.frozenList(frostState).forEach(function (p) { frozen[p.r + ',' + p.c] = true; });
    Object.keys(slots).forEach(function (k) {
      var s = slots[k];
      s.classList.toggle('tile-frozen', !!frozen[k]);
      var warn = warnActive(k, now);
      if (!warn) s.classList.remove('tile-frost-warn');
      else if (frozen[k] !== true) s.classList.add('tile-frost-warn');
    });
  }

  var HUNTER_TELEGRAPH_MS = 3000; // 预警 3s（issue #29 定稿，供 enemy.tick 兜底）
  setTelegraphMs(HUNTER_TELEGRAPH_MS); // 预警收缩圈动画时长默认值（issue #41）

  function handleEnemyEvent(ev, now) {
    if (ev.type === 'telegraph') {
      frostState = FRZ.telegraph(frostState, ev.r, ev.c, now, HUNTER_TELEGRAPH_MS);
      setSlotClass(ev.r, ev.c, 'tile-frost-warn', true);
      SFX.warn();
      lastWarnSoundAt = now;
    } else if (ev.type === 'freeze') {
      var out = FRZ.freeze(frostState, ev.r, ev.c, now);
      frostState = out.state;
      if (out.applied) {
        clearWarn(ev.r, ev.c);
        setSlotClass(ev.r, ev.c, 'tile-frozen', true);
        SFX.freeze();
        fxBurst(ev.r, ev.c, 'freeze'); // 冻结瞬间冰晶迸溅（issue #41）
      }
      // applied=false（上限/重复竞态）：Frost 兜底拒绝，静默
      // 取舍记录（issue #31 要求5）：本单不做可解性回滚——T2 isBoardSolvable 为接口
      // 预留，上限 4 + 玩家消除邻格解冻通道已保证实践可解，T6 内容调优时再验证。
    } else if (ev.type === 'cancel') {
      clearWarn(ev.r, ev.c);
    }
    // 'skip'：无目标/达上限，本无红晕与音效，无需处理
  }

  function onHunterTick() {
    if (!enemyState || !running || paused) return;
    var now = Date.now();
    var res = ENM.tick(enemyState, now, hunterCtx());
    enemyState = res.state;
    res.events.forEach(function (ev) { handleEnemyEvent(ev, now); });
    syncFrostVisuals(now);
    if (ENM.isThreatening(enemyState, now) && now - lastWarnSoundAt >= 1000) {
      lastWarnSoundAt = now;
      SFX.warn();
    }
  }

  setInterval(onHunterTick, 250); // 沿用现有 setInterval 心跳模式（同 onTimerTick）


  /* ---------------- 战役：星图 / 关卡装载 / 结算存档（issue #33 T5） ----------------
   * 状态机：自由模式 ⇄ 战役局（campaignIdx 非空）。星图节点点击（仅解锁关）→
   * 确认弹层 → enterCampaign 装载盘面/预冻/巡猎/时限 → win/lose 经
   * settleCampaignWin / settleCampaignLoss 结算（胜利 recordResult+save 存档，
   * 失败不存档）；restart/星图[返回游戏] 退出战役回自由模式。 */
  var confirmIdx = null;

  function storageSafe() {
    try { return typeof localStorage !== 'undefined' ? localStorage : null; }
    catch (e) { return null; }
  }
  function refreshCampaignData() {
    campaignData = SV.load(storageSafe());
  }

  /* 模式/难度/重开/提示/帮助/排行/暂停按钮：战役期间禁用（主题/音乐/静音保留） */
  function setCampaignControlsDisabled(dis) {
    diffBtns.concat(modeBtns).forEach(function (btn) {
      btn.disabled = dis;
      if (dis) btn.title = '战役进行中';
      else btn.removeAttribute('title');
    });
    settleBtnIds.forEach(function (id) {
      var b = document.getElementById(id);
      if (!b) return;
      b.disabled = dis;
      if (dis) b.title = '战役进行中';
      else b.removeAttribute('title');
    });
  }

  function syncCampaignTimeUi() {
    if (campaignIdx === null) return;
    if (mode === TM.MODES.timed) {
      timeLabelEl.textContent = '剩余';
      campaignBtn.setAttribute('aria-pressed', 'true');
    } else {
      timeLabelEl.textContent = '用时';
      campaignBtn.setAttribute('aria-pressed', 'false');
    }
  }

  function renderStarMap() {
    var total = CP.LEVELS.length;
    var unlockedIdx = total;
    for (var u = 0; u < total; u++) {
      if (CP.isUnlocked(u, campaignData)) unlockedIdx = u;
    }
    starmapGridEl.innerHTML = '';
    for (var i = 0; i < total; i++) {
      var lv = CP.LEVELS[i];
      var unlocked = CP.isUnlocked(i, campaignData);
      var entry = campaignData.levels[String(i)];
      var stars = entry ? entry.stars : 0;
      var node = document.createElement('button');
      node.type = 'button';
      node.className = 'starmap-node ' + (unlocked ? 'unlocked' : 'locked') +
        (i === unlockedIdx && campaignIdx === null ? ' current' : '');
      node.dataset.idx = String(i);
      if (!unlocked) node.disabled = true;
      var status = campaignIdx === i ? '进行中' : unlocked ? '可玩' : '未解锁';
      node.setAttribute('aria-label',
        '第' + (i + 1) + '关 ' + lv.name + ' ' + status + ' ' + stars + '星');
      var meta = lv.rows + '×' + lv.cols + ' · ' + lv.pairs + ' 对 · ' +
        (lv.timeLimitSec > 0 ? '限时 ' + fmt(lv.timeLimitSec) : '无尽') +
        ' · Par ' + fmt(lv.parSec);
      var starHtml = '';
      for (var s = 1; s <= 3; s++) {
        starHtml += '<span class="' + (s <= stars ? 'on' : 'off') + '">★</span>';
      }
      node.innerHTML =
        '<span class="node-index" aria-hidden="true">' + (unlocked ? (i + 1) : '🔒') + '</span>' +
        '<span class="node-main"><span class="node-name">' + lv.name + '</span>' +
        '<span class="node-meta">' + meta + '</span></span>' +
        '<span class="node-stars" aria-hidden="true">' + starHtml + '</span>';
      starmapGridEl.appendChild(node);
    }
  }

  function openStarMap() {
    refreshCampaignData();
    renderStarMap();
    starMapEl.classList.add('show');
  }
  function closeStarMap() { starMapEl.classList.remove('show'); }

  function openLevelConfirm(i) {
    confirmIdx = i;
    var lv = CP.LEVELS[i];
    confirmTitleEl.textContent = '第' + (i + 1) + '关 · ' + lv.name;
    confirmInfoEl.textContent = lv.rows + '×' + lv.cols + ' · ' + lv.pairs + ' 对 · ' +
      (lv.timeLimitSec > 0 ? '限时 ' + fmt(lv.timeLimitSec) : '无尽') +
      ' · Par ' + fmt(lv.parSec) + (lv.frost.length ? ' · 预冻 ' + lv.frost.length + ' 格' : '') +
      (lv.hunter ? ' · 巡猎者' : '');
    confirmWarnEl.hidden = !(running || overlay.classList.contains('show'));
    levelConfirmEl.classList.add('show');
  }
  function closeLevelConfirm() { levelConfirmEl.classList.remove('show'); }

  function enterCampaign(i) {
    campaignIdx = i;
    gen++;
    stopTimer();
    if (paused) resumeGame();
    var lv = CP.LEVELS[i];
    mode = lv.timeLimitSec > 0 ? TM.MODES.timed : TM.MODES.endless;
    setCampaignControlsDisabled(true);
    syncCampaignTimeUi();
    score = 0; combo = 0; maxCombo = 0; lastMatchAt = 0;
    tState = TM.create(mode, lv.timeLimitSec > 0 ? lv.timeLimitSec : undefined);
    hintsLeft = Hint.HINTS_PER_GAME;
    clearHintHighlight();
    renderHintBtn();
    bestStat.classList.remove('record');
    selected = null; busy = false; running = true;
    board.classList.remove('won');
    overlay.classList.remove('show');
    finalStarsEl.classList.remove('show');
    refreshBest();
    buildBoard();
    // 预冻落位：无预警期，telegraph(过去时刻)→freeze 直链，冻结音只播一次
    frostState = FRZ.create();
    var t0 = Date.now() - 1;
    lv.frost.forEach(function (p) {
      frostState = FRZ.telegraph(frostState, p.r, p.c, t0 - 1, 1);
      frostState = FRZ.freeze(frostState, p.r, p.c, t0).state;
    });
    if (lv.frost.length) SFX.freeze();
    // 巡猎者：hunter 非空按关卡参数启动（时刻回拨一个周期，立即走真实 tick 管线选目标）
    if (lv.hunter) {
      var hn = Date.now();
      // 预警收缩圈动画时长与本关 telegraphMs 同步（issue #41；L8 为 2500ms）
      setTelegraphMs(lv.hunter.telegraphMs);
      enemyState = ENM.create(lv.hunter.cadenceMs, lv.hunter.telegraphMs,
        hn - lv.hunter.cadenceMs);
      var res = ENM.tick(enemyState, hn, hunterCtx());
      enemyState = res.state;
      res.events.forEach(function (ev) { handleEnemyEvent(ev, hn); });
    } else {
      enemyState = null;
    }
    lastWarnSoundAt = 0;
    syncFrostVisuals(Date.now());
    finalTitleEl.textContent = '恭喜通关';
    renderTime();
    renderHud();
    showToast('第' + (i + 1) + '关 · ' + lv.name);
  }

  function exitCampaign() {
    if (campaignIdx === null) return;
    campaignIdx = null;
    setCampaignControlsDisabled(false);
    campaignBtn.setAttribute('aria-pressed', 'false');
    timeLabelEl.textContent = mode === TM.MODES.timed ? '倒计时' : '用时';
  }

  function renderFinalStars(n) {
    finalStarsEl.classList.remove('show');
    Array.prototype.forEach.call(
      finalStarsEl.querySelectorAll('.fstar'),
      function (el) { el.classList.remove('lit'); });
    void finalStarsEl.offsetWidth; // 强制重排，重触逐颗点亮过渡
    finalStarsEl.classList.add('show');
    Array.prototype.forEach.call(
      finalStarsEl.querySelectorAll('.fstar'),
      function (el, i) {
        if (i >= n) return;
        el.classList.add('lit');
        // 点亮瞬间星尘 burst，与逐颗点亮过渡延迟（300ms/颗）同步（issue #41）
        var rect = el.getBoundingClientRect();
        var cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
        var myGen = gen;
        setTimeout(function () {
          if (myGen === gen) fxLayer.burst(cx, cy, 'star');
        }, i * 300 + 200);
      });
  }

  function showSettleButtons(next) {
    finalStarsEl.hidden = false;
    nextLevelBtn.hidden = !next;
    nextLevelBtn.disabled = !next;
    nextLevelBtn.textContent = '下一关';
    toStarMapBtn.hidden = false;
    document.getElementById('again').textContent = '重玩';
  }

  function isNextUnlocked(idx) {
    return idx + 1 < CP.LEVELS.length && CP.isUnlocked(idx + 1, campaignData);
  }

  function settleCampaignWin() {
    var idx = campaignIdx;
    var lv = CP.LEVELS[idx];
    var used = tState.elapsedSec;
    var stars = CP.starsFor(lv.parSec, used);
    // SV.save 返回写盘成败布尔，绝不能赋给数据变量（PR #34 评审修复）
    var nextData = SV.recordResult(campaignData, idx, stars, score, used);
    SV.save(storageSafe(), nextData);
    campaignData = nextData;
    renderFinalStars(stars);
    showSettleButtons(isNextUnlocked(idx));
    showResult('通关 · ' + lv.name, '用时 ' + fmt(used) + ' · Par ' + fmt(lv.parSec));
  }

  // 失败：不存档、不解锁下一关（campaignData 不写入，星图仍显示旧进度）
  function settleCampaignLoss() {
    renderFinalStars(0);
    showSettleButtons(false);
    document.getElementById('again').textContent = '重试';
  }

  campaignBtn.addEventListener('click', openStarMap);
  starMapClose.addEventListener('click', closeStarMap);
  starmapBack.addEventListener('click', function () {
    closeStarMap();
    if (campaignIdx !== null) exitCampaign(); // 退出战役：恢复自由模式（盘面保持）
  });
  starmapGridEl.addEventListener('click', function (ev) {
    var node = ev.target.closest ? ev.target.closest('.starmap-node') : null;
    if (!node || node.disabled) return; // 锁定关不响应（仅解锁关可入）
    var i = parseInt(node.dataset.idx, 10);
    if (!CP.isUnlocked(i, campaignData)) return; // 以存档态复核解锁
    closeStarMap();
    openLevelConfirm(i);
  });
  confirmCancelBtn.addEventListener('click', closeLevelConfirm);
  confirmGoBtn.addEventListener('click', function () {
    closeLevelConfirm();
    if (confirmIdx !== null) enterCampaign(confirmIdx);
  });
  nextLevelBtn.addEventListener('click', function () {
    var next = campaignIdx + 1;
    if (campaignIdx !== null && CP.isUnlocked(next, campaignData)) {
      enterCampaign(next);
    }
  });
  toStarMapBtn.addEventListener('click', function () {
    if (campaignIdx !== null) exitCampaign();
    openStarMap();
  });

  /* ---------------- 难度选择 ---------------- */
  var diffBtns = Array.prototype.slice.call(
    document.querySelectorAll('#difficulty .diff-btn'));

  function renderDifficulty() {
    diffBtns.forEach(function (btn) {
      var active = btn.dataset.key === difficulty;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  diffBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (btn.dataset.key === difficulty) return;
      difficulty = btn.dataset.key;
      try { localStorage.setItem(DIFF_KEY, difficulty); } catch (e) { /* 忽略 */ }
      renderDifficulty();
      restart();
    });
  });

  renderDifficulty();

  /* ---------------- 模式切换（无尽 / 限时） ----------------
   * 切换即开新局（简单取舍：不做跨局保时，见 PR 说明）；
   * 偏好持久化到 linkup3d.mode，重开页面自动恢复。 */
  var modeBtns = Array.prototype.slice.call(
    document.querySelectorAll('#mode .mode-btn'));

  function renderMode() {
    modeBtns.forEach(function (btn) {
      var active = btn.dataset.mode === mode;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    document.getElementById('timeLabel').textContent =
      mode === TM.MODES.timed ? '倒计时' : '用时';
  }

  modeBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var next = TM.normalizeMode(btn.dataset.mode);
      if (next === mode) return;
      mode = next;
      try { localStorage.setItem(MODE_KEY, mode); } catch (e) { /* 忽略 */ }
      renderMode();
      restart();
    });
  });

  renderMode();
  restart();

  /* ---------------- 本地排行榜（Top10 分难度，issue #13） ---------------- */
  // 记录时机说明：仅「通关」入榜（win 调用）；限时判负（lose）保留得分展示但不入榜，
  // 榜单只收完整通关成绩。与 linkup3d.best.* 体系并存：best 仍在消除时实时写入
  // （HUD 即时反馈），ranking 记录完整明细（用时/连击/日期），两者互不覆盖。
  var lastRoundTs = 0;          // 本局记录的 ts，用于面板高亮
  var rankView = difficulty;    // 面板当前查看的难度档

  function loadBoard(diff) {
    try {
      return RK.parseBoard(localStorage.getItem(RK.rankKey(diff)));
    } catch (e) { return []; }
  }

  function recordRound() {
    lastRoundTs = 0;
    if (!RK.isEligible(score)) return; // 得分 0 不入榜
    var entry = RK.createEntry(score, tState.elapsedSec, Math.max(maxCombo, 1), Date.now());
    var board = loadBoard(difficulty);
    if (!RK.wouldEnter(board, score)) return;
    var next = RK.insert(board, entry);
    try { localStorage.setItem(RK.rankKey(difficulty), RK.serializeBoard(next)); } catch (e) { /* 忽略 */ }
    lastRoundTs = entry.ts;
  }

  var RANK_DIFFS = [
    { key: 'easy', label: '简单' },
    { key: 'normal', label: '标准' },
    { key: 'hard', label: '困难' }
  ];

  function renderRankTabs() {
    rankTabs.innerHTML = '';
    RANK_DIFFS.forEach(function (d) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'rank-tab' + (d.key === rankView ? ' active' : '');
      b.dataset.key = d.key;
      b.textContent = d.label;
      b.setAttribute('aria-pressed', d.key === rankView ? 'true' : 'false');
      rankTabs.appendChild(b);
    });
  }

  function renderRankPanel() {
    renderRankTabs();
    var board = loadBoard(rankView);
    rankTbody.innerHTML = '';
    if (!board.length) {
      var tr = document.createElement('tr');
      tr.className = 'rank-empty';
      var td = document.createElement('td');
      td.colSpan = 5;
      td.textContent = '暂无记录，快来创造第一条吧';
      tr.appendChild(td);
      rankTbody.appendChild(tr);
      return;
    }
    board.forEach(function (e, i) {
      var tr = document.createElement('tr');
      if (e.ts === lastRoundTs) tr.className = 'rank-new';
      function cell(text) {
        var td = document.createElement('td');
        td.textContent = text;
        tr.appendChild(td);
      }
      cell(String(i + 1));
      cell(String(e.score));
      cell(RK.formatTime(e.seconds));
      cell('x' + e.maxCombo);
      cell(RK.formatDate(e.ts));
      rankTbody.appendChild(tr);
    });
  }

  function openRankPanel() {
    rankView = difficulty;
    renderRankPanel();
    rankOverlay.classList.add('show');
  }

  // 关闭方式：点遮罩 + 关闭钮 + Esc（issue 验收三选二+，全部实现）
  function closeRankPanel() { rankOverlay.classList.remove('show'); }

  rankBtn.addEventListener('click', openRankPanel);
  rankClose.addEventListener('click', closeRankPanel);
  rankOverlay.addEventListener('click', function (ev) {
    if (ev.target === rankOverlay) closeRankPanel();
  });
  window.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && rankOverlay.classList.contains('show')) closeRankPanel();
  });
  rankTabs.addEventListener('click', function (ev) {
    var btn = ev.target.closest('.rank-tab');
    if (!btn || btn.dataset.key === rankView) return;
    rankView = btn.dataset.key;
    renderRankPanel();
  });

  /* ---------------- 提示（issue #16：每局 3 次，高亮可连对 + 解释路径） ---------------- */
  function renderHintBtn() {
    hintCountEl.textContent = hintsLeft;
    hintBtn.disabled = hintsLeft <= 0;
  }

  function clearHintHighlight() {
    clearTimeout(hintTimer);
    Object.keys(slots).forEach(function (k) {
      slots[k].classList.remove('hint');
    });
  }

  hintBtn.addEventListener('click', function () {
    if (busy || !running || hintsLeft <= 0) return;
    var pair = L.findSolvablePair(grid);
    if (!pair) return; // 理论上无解时已自动洗牌，这里不做额外处理
    hintsLeft--;
    renderHintBtn();
    clearHintHighlight();
    var sa = slots[pair.a.r + ',' + pair.a.c], sb = slots[pair.b.r + ',' + pair.b.c];
    if (sa) sa.classList.add('hint');
    if (sb) sb.classList.add('hint');
    showToast(Hint.describePath(pair.path, grid), 2400);
    hintTimer = setTimeout(clearHintHighlight, 2400);
  });

  /* ---------------- 新手引导（issue #16：首访 4 步卡片，「?」随时重放） ---------------- */
  var tutorial = window.Tutorial.mount({
    container: document.getElementById('tutorial'),
    nextBtn: document.getElementById('tutNext'),
    skipBtn: document.getElementById('tutSkip'),
    dots: document.getElementById('tutDots'),
    title: document.getElementById('tutTitle'),
    text: document.getElementById('tutText'),
    storage: {
      get: function () { return localStorage.getItem(Hint.TUT_KEY); },
      set: function () { localStorage.setItem(Hint.TUT_KEY, '1'); }
    }
  });

  helpBtn.addEventListener('click', function () { tutorial.show(); });

  var seenTutorial = false;
  try { seenTutorial = !!localStorage.getItem(Hint.TUT_KEY); } catch (e) { /* 无存储视为未看过 */ }
  if (!seenTutorial) tutorial.show();

  /* ---------------- 动态星空背景 ---------------- */
  window.Stars.mount(document.getElementById('starfield'));
})();
