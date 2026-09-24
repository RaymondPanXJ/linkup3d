#!/usr/bin/env node
/**
 * tests/space-static-check.js — 太空主题背景 + BGM 的无浏览器接线静态断言（issue #10）
 * 验证 index.html / css/style.css / js/game.js / js/music.js / js/stars.js
 * 在「音乐开关、自动播放策略、星空挂载、无障碍与降级」各端的接线一致性。
 *
 * 运行：node tests/run-tests.js 或单独 node tests/space-static-check.js
 */
var fs = require('fs');
var path = require('path');

function runChecks() {
  var root = path.join(__dirname, '..');
  var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  var css = fs.readFileSync(path.join(root, 'css', 'style.css'), 'utf8');
  var game = fs.readFileSync(path.join(root, 'js', 'game.js'), 'utf8');
  var music = fs.readFileSync(path.join(root, 'js', 'music.js'), 'utf8');
  var stars = fs.readFileSync(path.join(root, 'js', 'stars.js'), 'utf8');

  var results = [];
  function check(name, cond, detail) {
    results.push({ name: name, pass: !!cond, detail: detail || (cond ? 'ok' : 'FAILED') });
  }

  /* 1. index.html：星空 canvas、音乐按钮、脚本顺序 */
  check('HTML 存在全屏星空 canvas#starfield（aria-hidden）',
    /<canvas id="starfield"[^>]*aria-hidden="true"/.test(html));
  check('HTML 音乐开关按钮 ♪（独立于 🔊）',
    /<button id="music"[^>]*aria-label="背景音乐"/.test(html) &&
    /♪<\/button>/.test(html) && /id="mute"/.test(html));
  check('HTML 按序加载 music.js / stars.js（game.js 之前）',
    html.indexOf('js/music.js') > 0 && html.indexOf('js/stars.js') > 0 &&
    html.indexOf('js/music.js') < html.indexOf('js/game.js') &&
    html.indexOf('js/stars.js') < html.indexOf('js/game.js'));

  /* 2. game.js：localStorage 持久化 linkup3d.music，读写同键 + try/catch */
  check('game.js 使用 linkup3d.music 存储键（读+写）',
    /MUSIC_KEY = 'linkup3d\.music'/.test(game) &&
    /localStorage\.getItem\(MUSIC_KEY\)/.test(game) &&
    /localStorage\.setItem\(MUSIC_KEY, musicOn \? '1' : '0'\)/.test(game));
  check('linkup3d.music 读取有 try/catch 保护，缺省视为开',
    /try \{[^}]{0,80}getItem\(MUSIC_KEY\)[\s\S]{0,80}catch/.test(game) &&
    /getItem\(MUSIC_KEY\) !== '0'/.test(game));

  /* 3. game.js：自动播放策略 —— 首次用户手势启动；与 SFX 静音相互独立 */
  check('首次用户手势（pointerdown/touchstart/keydown）触发音乐启动',
    /gestureEvents = \['pointerdown', 'touchstart', 'keydown'\]/.test(game) &&
    /function onFirstGesture\(\)[\s\S]{0,200}ensureMusicStarted\(\)/.test(game));
  check('ensureMusicStarted 仅在偏好为开且未运行时启动',
    /function ensureMusicStarted\(\)[\s\S]{0,80}!musicOn \|\| musicPlayer\.isRunning\(\)/.test(game));
  check('音乐启停不触碰 SFX 静音（两开关相互独立）',
    !/musicOn[\s\S]{0,60}SFX\.(set)?[Mm]uted/.test(game) &&
    !/SFX\.isMuted\(\)[\s\S]{0,60}musicOn/.test(game));
  check('音乐开关渲染 ♪/♩ + aria-pressed',
    /musicOn \? '♪' : '♩'/.test(game) &&
    /setAttribute\('aria-pressed', musicOn/.test(game));
  check('game.js 挂载星空 Stars.mount(starfield)',
    /window\.Stars\.mount\(document\.getElementById\('starfield'\)\)/.test(game));

  /* 4. css：星空 canvas 层级、内容浮层、音乐开启态 */
  check('CSS #starfield 固定全屏且 pointer-events:none',
    /#starfield\s*\{[^}]*position:\s*fixed/.test(css) &&
    /#starfield\s*\{[^}]*pointer-events:\s*none/.test(css));
  check('CSS 内容层置于星空之上（z-index）',
    /h1, \.subtitle, \.hud, #stage\s*\{[^}]*z-index:\s*1/.test(css));
  check('CSS 存在深空底色（html 渐变含深空蓝紫）',
    /html\s*\{[^}]*radial-gradient[^}]*#2a1e52/.test(css) && /#060916/.test(css));
  check('CSS 音乐按钮开启态 button#music.on',
    /button#music\.on\s*\{/.test(css));

  /* 5. music.js：零外部资源、前瞻调度、多声部合成 */
  check('music.js 无外部音频资源（无 fetch/new Audio/XMLHttpRequest）',
    !/new Audio\(|fetch\(|XMLHttpRequest/.test(music));
  check('music.js 使用前瞻调度（setInterval tick + currentTime 视界）',
    /setInterval\(tick/.test(music) && /ctx\.currentTime \+ /.test(music));
  check('music.js 合成 bass/琶音/kick/snare/hat 五类声部',
    /role === 'kick'/.test(music) && /role === 'hat'/.test(music) &&
    /role === 'snare'/.test(music) && /'bass'/.test(music) && /'arp'/.test(music));

  /* 6. stars.js：rAF 动画、reduced-motion 降级、visibilitychange 暂停 */
  check('stars.js 使用 requestAnimationFrame 驱动',
    /requestAnimationFrame\(frame\)/.test(stars));
  check('stars.js 尊重 prefers-reduced-motion（静态单帧不循环）',
    /prefers-reduced-motion: reduce/.test(stars) &&
    /function play\(\)\s*\{\s*if \(reduced \|\| rafId !== null\) return;/.test(stars));
  check('stars.js 页面隐藏时暂停 rAF（visibilitychange）',
    /visibilitychange/.test(stars) &&
    /if \(document\.hidden\) pause\(\); else play\(\);/.test(stars));

  return results;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { runChecks: runChecks };
}

if (require.main === module) {
  var results = runChecks();
  var pass = 0;
  results.forEach(function (r) {
    console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.name +
      (r.detail ? '  -> ' + r.detail : ''));
    if (r.pass) pass++;
  });
  console.log('----------------------------------------');
  console.log(pass + '/' + results.length + ' space static checks passed');
  process.exit(pass === results.length ? 0 : 1);
}
