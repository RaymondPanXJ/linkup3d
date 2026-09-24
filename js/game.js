/**
 * game.js — 3D 连连看 UI 与游戏逻辑（纯原生 JS）
 * 依赖：js/link3d.js（window.Link3D）、js/combo.js（window.Combo）、
 *       js/music.js（window.Music）、js/stars.js（window.Stars）
 */
(function () {
  'use strict';

  var L = window.Link3D;
  var CB = window.Combo;

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
  var finalScoreEl = document.getElementById('finalScore');
  var finalTimeEl = document.getElementById('finalTime');
  var muteBtn = document.getElementById('mute');
  var musicBtn = document.getElementById('music');

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
      // 通关：四音上行小号角
      win: function () {
        play(function (c, t) {
          var seq = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
          for (var i = 0; i < seq.length; i++) {
            tone(seq[i], t + i * 0.13, 0.3, 'square', 0.07);
            tone(seq[i] * 2, t + i * 0.13, 0.24, 'sine', 0.05);
          }
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
  var lastMatchAt = 0;
  var best = 0;              // 当前难度的历史最高分
  var seconds = 0;
  var timerId = null;
  var running = false;
  var busy = false;         // 消除/洗牌动画期间锁定输入
  var gen = 0;              // 局号：restart 后作废旧局的延时回调
  var cellW = 0, cellH = 0;

  var REMOVE_MS = 560;
  var SHUFFLE_MS = 900;

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

  /* ---------------- 布局（响应式） ---------------- */
  function layout() {
    var dims = currentDims();
    var ROWS = dims.rows, COLS = dims.cols;
    var padX = window.innerWidth < 560 ? 24 : 60;
    var hudH = document.querySelector('.hud').getBoundingClientRect().height;
    var titleH = document.querySelector('h1').getBoundingClientRect().height +
                 document.querySelector('.subtitle').getBoundingClientRect().height;
    var availW = Math.max(280, window.innerWidth - padX * 2);
    var availH = Math.max(240, window.innerHeight - titleH - hudH - 90);
    cellW = Math.min(100, availW / (COLS + 0.6), availH / (ROWS + 0.9));
    cellW = Math.max(42, cellW);
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

    // 窗口过小时缩小整个场景，保证不破版
    var fit = Math.min(1, availW / (bw + 30), availH / (bh + 30));
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

  /* 轻微跟随指针转动棋盘，强化 3D 感 */
  stage.addEventListener('pointermove', function (e) {
    if (window.matchMedia('(pointer: coarse)').matches) return;
    var rx = 14 + ((e.clientY / window.innerHeight) - 0.5) * -8;
    var ry = ((e.clientX / window.innerWidth) - 0.5) * 10;
    board.style.setProperty('--rx', rx.toFixed(2) + 'deg');
    board.style.setProperty('--ry', ry.toFixed(2) + 'deg');
  });
  stage.addEventListener('pointerleave', function () {
    board.style.setProperty('--rx', '16deg');
    board.style.setProperty('--ry', '0deg');
  });

  /* ---------------- 建盘 ---------------- */
  function buildBoard() {
    var dims = currentDims();
    var ROWS = dims.rows, COLS = dims.cols;
    Object.keys(slots).forEach(function (k) { slots[k].remove(); delete slots[k]; });
    pathLayer.innerHTML = '';
    grid = L.dealGrid(ROWS, COLS);
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
        tile.addEventListener('click', onTileClick.bind(null, r, c));
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
    if (busy || !running || !grid[r][c]) return;
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

    var now = Date.now();
    var gap = lastMatchAt ? now - lastMatchAt : Infinity;
    var res = CB.applyMatch(combo, gap);
    combo = res.combo;
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
        doShuffle();
      }
    }, REMOVE_MS);
  }

  function doShuffle() {
    busy = true;
    SFX.shuffle();
    showToast('无可连对子，自动洗牌');
    L.shuffleGrid(grid);
    var myGen = gen;
    Object.keys(slots).forEach(function (k) {
      var slot = slots[k], p = k.split(','), v = grid[+p[0]][+p[1]];
      slot.classList.add('shuffle');
      setTimeout(function () {
        if (myGen !== gen) return;
        slot.querySelector('.face.front').textContent = EMOJIS[v - 1];
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
    bestEl.textContent = best;
    pairsEl.textContent = L.countTiles(grid) / 2;
  }

  function fmt(s) {
    var m = Math.floor(s / 60), ss = s % 60;
    return (m < 10 ? '0' : '') + m + ':' + (ss < 10 ? '0' : '') + ss;
  }

  function startTimerIfNeeded() {
    if (timerId || !running) return;
    timerId = setInterval(function () {
      seconds++;
      timeEl.textContent = fmt(seconds);
    }, 1000);
  }

  var toastTimer = null;
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 1600);
  }

  function win() {
    running = false;
    SFX.win();
    clearInterval(timerId);
    timerId = null;
    board.classList.add('won');
    finalScoreEl.textContent = score;
    finalTimeEl.textContent = '用时 ' + fmt(seconds);
    setTimeout(function () { overlay.classList.add('show'); }, 700);
  }

  function restart() {
    gen++;
    clearInterval(timerId);
    timerId = null;
    score = 0; combo = 0; seconds = 0; lastMatchAt = 0;
    bestStat.classList.remove('record');
    selected = null; busy = false; running = true;
    timeEl.textContent = '00:00';
    overlay.classList.remove('show');
    board.classList.remove('won');
    refreshBest();
    buildBoard();
    renderHud();
  }

  document.getElementById('restart').addEventListener('click', restart);
  document.getElementById('again').addEventListener('click', restart);
  window.addEventListener('resize', layout);

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
  restart();

  /* ---------------- 动态星空背景 ---------------- */
  window.Stars.mount(document.getElementById('starfield'));
})();
