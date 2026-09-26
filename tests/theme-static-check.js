#!/usr/bin/env node
/**
 * tests/theme-static-check.js - 主题系统 + 无障碍的无浏览器静态断言（issue #15）
 * 验证 index.html / css/style.css / js/game.js / js/stars.js 在
 * CSS 变量化、三主题覆盖、主题循环持久化、星点颜色读主题、键盘可达、
 * 高对比偏好、图案对比度 各端的接线一致性。
 *
 * 运行：node tests/run-tests.js 或单独 node tests/theme-static-check.js
 */
var fs = require('fs');
var path = require('path');

/* ---- WCAG 2.1 相对亮度 / 对比度 ---- */
function hexToRgb(hex) {
  var h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
  var n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function relLum(rgb) {
  var ch = rgb.map(function (v) {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
function contrast(hexA, hexB) {
  var la = relLum(hexToRgb(hexA)), lb = relLum(hexToRgb(hexB));
  var hi = Math.max(la, lb), lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/* 提取某选择器块内的 CSS 变量 map */
function varMapOf(css, selectorRe) {
  var m = css.match(selectorRe);
  if (!m) return null;
  var map = {};
  var re = /(--[\w-]+)\s*:\s*([^;]+)(?=[;}])/g, v;
  while ((v = re.exec(m[1])) !== null) map[v[1]] = v[2].trim();
  return map;
}

function runChecks() {
  var root = path.join(__dirname, '..');
  var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  var css = fs.readFileSync(path.join(root, 'css', 'style.css'), 'utf8');
  var game = fs.readFileSync(path.join(root, 'js', 'game.js'), 'utf8');
  var stars = fs.readFileSync(path.join(root, 'js', 'stars.js'), 'utf8');

  var results = [];
  function check(name, cond, detail) {
    results.push({ name: name, pass: !!cond, detail: detail || (cond ? 'ok' : 'FAILED') });
  }

  /* 1. CSS 全面变量化 */
  var rootVars = varMapOf(css, /:root\s*\{([\s\S]*?)\n\}/);
  var rootCount = rootVars ? Object.keys(rootVars).length : 0;
  check('CSS :root 主题变量 >= 40 个（全面变量化）',
    rootCount >= 40, 'count=' + rootCount);
  check('CSS html 背景使用 var(--bg-*)（主题驱动，保留深空回退值）',
    /html\s*\{[^}]*var\(--bg-glow-1/.test(css) && /var\(--bg-base/.test(css) &&
    /#060916/.test(css));

  /* 2. 三主题 data-theme 覆盖块 */
  var THEMES = ['deep-space', 'light', 'neon'];
  var missing = [];
  THEMES.forEach(function (t) {
    var block = css.match(new RegExp('\\[data-theme="' + t + '"\\]\\s*\\{([\\s\\S]*?)\\n\\}'));
    var n = block ? (block[1].match(/--[\w-]+\s*:/g) || []).length : 0;
    if (!block || n < 40) missing.push(t + '(' + n + ')');
  });
  check('CSS 三主题 [data-theme=deep-space|light|neon] 块存在且各 >=40 变量',
    missing.length === 0, missing.join(',') || 'ok');

  /* 3. HUD 主题按钮 + 循环顺序 + 持久化 */
  check('HTML 主题按钮 #theme（aria-label 含主题）',
    /<button id="theme"[^>]*aria-label="[^"]*主题[^"]*"/.test(html));
  check('HTML 全部图标按钮（theme/music/mute）均有 aria-label',
    ['theme', 'music', 'mute'].every(function (id) {
      return new RegExp('<button id="' + id + '"[^>]*aria-label=').test(html);
    }));
  check('game.js 主题顺序：深空 -> 浅色 -> 霓虹',
    /THEMES = \[\s*'deep-space',\s*'light',\s*'neon'\s*\]/.test(game));
  check('game.js 使用 linkup3d.theme 存储键（读+写，非法值回退 deep-space）',
    /THEME_KEY = 'linkup3d\.theme'/.test(game) &&
    /localStorage\.getItem\(THEME_KEY\)/.test(game) &&
    /localStorage\.setItem\(THEME_KEY, theme\)/.test(game) &&
    /THEMES\.indexOf\(t\) >= 0 \? t : 'deep-space'/.test(game));
  check('game.js 点击循环下一主题 + 应用 data-theme 属性',
    /theme = THEMES\[\(THEMES\.indexOf\(theme\) \+ 1\) % THEMES\.length\]/.test(game) &&
    /setAttribute\('data-theme', theme\)/.test(game));

  /* 4. stars.js 星点颜色读主题 */
  check('stars.js 通过 getComputedStyle 读取 --star-1/2/3（try/catch 回退）',
    /getComputedStyle\(document\.documentElement\)/.test(stars) &&
    /'--star-1'/.test(stars) && /'--star-2'/.test(stars) && /'--star-3'/.test(stars) &&
    /catch \(e\)/.test(stars));
  check('stars.js 绘制使用主题色对象（无写死字面量残留）',
    /ctx\.fillStyle = i % 7 === 3 \? colors\.star1/.test(stars) &&
    !/fillStyle = i % 7 === 3 \? '#/.test(stars));
  check('stars.js 主题切换触发颜色刷新（MutationObserver 监听 data-theme）',
    /MutationObserver/.test(stars) && /'data-theme'/.test(stars));
  var Stars = require(path.join(root, 'js', 'stars.js'));
  check('Node 环境调用 readThemeColors() 不抛错并回退深空默认色',
    (function () {
      try {
        var c = Stars.readThemeColors();
        return c.star1 === Stars.STAR_COLOR_DEFAULTS.star1 &&
               c.star2 === Stars.STAR_COLOR_DEFAULTS.star2 &&
               c.star3 === Stars.STAR_COLOR_DEFAULTS.star3;
      } catch (e) { return false; }
    })());

  /* 5. 棋盘无障碍 */
  check('game.js 棋盘容器 role=grid（含 aria-label）',
    /setAttribute\('role', 'grid'\)/.test(game) && /setAttribute\('aria-label'/.test(game));
  check('game.js 牌 role=gridcell + tabindex + aria-label（图案+行列）',
    /setAttribute\('role', 'gridcell'\)/.test(game) &&
    /setAttribute\('tabindex', '0'\)/.test(game) &&
    /EMOJIS\[v - 1\] \+ ' /.test(game));
  check('game.js 牌键盘可达：Enter/Space 触发选择（preventDefault）',
    /Enter/.test(game) && /preventDefault/.test(game) && /keydown/.test(game));
  check('洗牌后同步更新牌 aria-label（图案已变）',
    (game.match(/setAttribute\('aria-label', EMOJIS/g) || []).length >= 2);
  check('难度/静音/音乐按钮均有 aria-pressed（game.js 渲染）',
    /'aria-pressed', active/.test(game) &&
    /'aria-pressed', SFX\.isMuted\(\)/.test(game) &&
    /'aria-pressed', musicOn/.test(game));

  /* 6. CSS 无障碍：focus-visible + prefers-contrast */
  check('CSS :focus-visible 使用主题变量（三主题均可见）',
    /outline: 3px solid var\(--focus\)/.test(css) && /--focus:/.test(css));
  check('CSS prefers-contrast: more 提升牌面边框对比（纯 CSS）',
    /prefers-contrast: more/.test(css) && /--tile-border-strong/.test(css));

  /* 7. 对比度自查：三主题 图案前景色 vs 牌面底色 >= 3:1 */
  var perTheme = [];
  var bad = [];
  THEMES.forEach(function (t) {
    var vars = varMapOf(css, new RegExp('\\[data-theme="' + t + '"\\]\\s*\\{([\\s\\S]*?)\\n\\}'));
    if (!vars) { bad.push(t + ':missing'); return; }
    var pairs = [
      ['accent/tile', vars['--accent'], vars['--tile-2']],
      ['text/tile', vars['--text'], vars['--tile-1']]
    ];
    function firstHex(v) {
      if (!v) return null;
      var m = v.match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/);
      return m ? m[0] : null;
    }
    pairs.forEach(function (p) {
      var fg = firstHex(p[1]), bg = firstHex(p[2]);
      if (!fg || !bg) {
        bad.push(t + '/' + p[0] + ':non-hex');
        return;
      }
      var ratio = contrast(fg, bg);
      perTheme.push(t + '/' + p[0] + '=' + ratio.toFixed(2));
      if (ratio < 3) bad.push(t + '/' + p[0] + '=' + ratio.toFixed(2));
    });
  });
  check('三主题 图案前景色 vs 牌面底色 对比度 >= 3:1（WCAG 图形对比）',
    bad.length === 0, bad.length ? 'BELOW3: ' + bad.join(', ') : perTheme.join(' '));

  return results;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { runChecks: runChecks, contrast: contrast };
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
  console.log(pass + '/' + results.length + ' theme static checks passed');
  process.exit(pass === results.length ? 0 : 1);
}
