/**
 * audio-ui-static-check.js — 音频 UI 模块迁移静态断言（issue #74 刀1，无浏览器依赖）
 *
 * 锁四件事：
 *   A. 加载顺序：index.html 中 audio-ui.js 在 music.js 之后、game.js 之前，且带 ?v= 缓存参数；
 *   B. 模块形态：audio-ui.js 镜像 music.js 的 UMD 双端惯用法，自身不新建 AudioContext、
 *      无 require/import（去注释后查）、DOM 只经 init 注入不抓 getElementById；
 *   C. game.js 接线点保留：init 注入（SFX 同源）+ __audioDiag 走 AudioUI.diag()，
 *      且既有簇在 game.js 无残留（迁移非复制）；
 *   D. 行为语义随迁：issue #45/#47 的手势重试/重新武装/开机门/幂等锁逐条落在新模块上。
 */
'use strict';

var fs = require('fs');
var path = require('path');

function readUtf8(p) { return fs.readFileSync(p, 'utf8'); }

function stripComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function runChecks() {
  var results = [];
  function check(name, cond, detail) {
    results.push({ name: name, pass: !!cond, detail: detail || (cond ? 'ok' : 'FAILED') });
  }

  var root = path.join(__dirname, '..');
  var html = readUtf8(path.join(root, 'index.html'));
  var game = readUtf8(path.join(root, 'js', 'game.js'));
  var mod = readUtf8(path.join(root, 'js', 'audio-ui.js'));
  var bare = stripComments(mod);
  var runner = readUtf8(path.join(__dirname, 'run-tests.js'));
  var frostCrack = readUtf8(path.join(__dirname, 'frost-crack-runtime-check.js'));

  /* ================ A. 加载顺序 ================ */
  check('A1 index.html 按序加载 audio-ui.js（music.js 之后、game.js 之前）',
    /<script src="js\/music\.js(\?[^"]*)?"><\/script>/.test(html) &&
    /<script src="js\/audio-ui\.js(\?[^"]*)?"><\/script>/.test(html) &&
    html.indexOf('js/audio-ui.js') > html.indexOf('js/music.js') &&
    html.indexOf('js/audio-ui.js') < html.indexOf('js/game.js'));
  check('A2 audio-ui.js script 带 ?v= 缓存参数（issue #52 击穿机制）',
    /<script src="js\/audio-ui\.js\?v=[^"]+"><\/script>/.test(html));

  /* ================ B. 模块形态（镜像 music.js UMD） ================ */
  check('B1 audio-ui.js UMD 双端（module.exports + root.AudioUI，镜像 music.js）',
    /typeof module === 'object' && module\.exports/.test(mod) &&
    /module\.exports = factory\(\)/.test(mod) &&
    /root\.AudioUI = factory\(\)/.test(mod) &&
    /typeof self !== 'undefined' \? self : this/.test(mod));
  check('B2 audio-ui.js 不新建 AudioContext（音源依赖只走注入 SFX 与 window.Music）',
    !/new (webkit)?AudioContext/.test(bare) &&
    /window\.Music/.test(bare) &&
    /opts\.SFX \|\| \(typeof window !== 'undefined' \? window\.SFX : null\)/.test(bare));
  check('B3 audio-ui.js 无 require/import（去注释后查）',
    !/require\(/.test(bare) && !/^\s*import\s/m.test(bare));
  check('B4 audio-ui.js DOM 走注入惯例（不抓 getElementById，元素由 game 传入）',
    !/getElementById/.test(bare) &&
    /opts\.muteBtn/.test(bare) && /opts\.musicBtn/.test(bare));

  /* ================ C. game.js 接线点保留 + 原簇无残留 ================ */
  check('C1 game.js 同签名接线（init 注入 muteBtn/musicBtn/SFX 同源句柄）',
    /var AudioUI = window\.AudioUI\.init\(\{ muteBtn: muteBtn, musicBtn: musicBtn, SFX: SFX \}\);/.test(game));
  check('C2 game.js __audioDiag 消费点走 AudioUI.diag()（形状零变化）',
    /window\.__audioDiag = function \(\)/.test(game) &&
    /var s = SFX\.diag\(\), m = AudioUI\.diag\(\);/.test(game) &&
    /running: m\.running/.test(game));
  check('C3 既有簇已迁出 game.js 无残留（迁移非复制）',
    !/function renderMuteBtn|function renderMusicBtn|function ensureMusicStarted|function onFirstGesture|var musicPlayer|var MUSIC_KEY/.test(game));
  check('C4 SFX 引擎留守 game.js 原地（工单口径：audio 依赖走现有接口不新造）',
    /var SFX = \(function \(\) \{/.test(game) &&
    /freeze: function/.test(game) && /ignite: function/.test(game));

  /* ================ D. 行为语义随迁（新模块承接 #45/#47 锁） ================ */
  check('D1 手势集合随迁（pointerdown/touchstart/keydown + click 扩展）',
    /gestureEvents = \['pointerdown', 'touchstart', 'keydown'\]/.test(bare) &&
    /musicRetryEvents = gestureEvents\.concat\('click'\)/.test(bare));
  check('D2 addMusicGestureListeners 幂等锁随迁（已武装不重复注册）',
    /function addMusicGestureListeners\(\) \{\s*if \(musicGestureActive\) return;/.test(bare));
  check('D3 持续重试语义随迁（isRunning 或偏好关闭才移除监听，issue #45 根因2）',
    /function onFirstGesture\(\)[\s\S]{0,300}ensureMusicStarted\(\)[\s\S]{0,300}if \(musicPlayer\.isRunning\(\) \|\| !musicOn\) removeMusicGestureListeners\(\)/.test(bare));
  check('D4 ♪ 切回重新武装随迁（toggle-on 路径先 add 再 ensure，issue #47）',
    /musicOn = !musicOn;[\s\S]{0,300}if \(musicOn\) \{[\s\S]{0,200}addMusicGestureListeners\(\);[\s\S]{0,120}ensureMusicStarted\(\)/.test(bare));
  check('D5 开机门随迁（偏好与 userActivation.isActive === true 同判 + 门内 ensureMusicStarted，issue #47）',
    /musicOn && navigator\.userActivation && navigator\.userActivation\.isActive === true/.test(bare) &&
    /isActive === true\) \{\s*ensureMusicStarted\(\);/.test(bare));
  check('D6 linkup3d.music 读写同键 + try/catch 随迁（缺省视为开）',
    /MUSIC_KEY = 'linkup3d\.music'/.test(bare) &&
    /getItem\(MUSIC_KEY\) !== '0'/.test(bare) &&
    /localStorage\.setItem\(MUSIC_KEY, musicOn \? '1' : '0'\)/.test(bare) &&
    /try \{[^}]{0,80}getItem\(MUSIC_KEY\)[\s\S]{0,80}catch/.test(bare));
  check('D7 音乐启停不触碰 SFX 静音（两开关独立语义在新模块保持）',
    !/musicOn[\s\S]{0,60}SFX\.(set)?[Mm]uted/.test(bare) &&
    !/SFX\.isMuted\(\)[\s\S]{0,60}musicOn/.test(bare));
  check('D8 diag() 只读返回随迁（running/ctxState/currentTime/musicOn/listenersActive）',
    /diag: function \(\) \{[\s\S]{0,200}running: m\.running[\s\S]{0,200}musicOn: musicOn, listenersActive: musicGestureActive/.test(bare));
  check('D9 按钮渲染随迁（♪/♩ + aria-pressed 双按钮 + aria-label）',
    /musicOn \? '♪' : '♩'/.test(bare) &&
    /setAttribute\('aria-pressed', musicOn/.test(bare) &&
    /setAttribute\('aria-pressed', SFX\.isMuted\(\)/.test(bare) &&
    /setAttribute\('aria-label', musicOn/.test(bare));
  check('D10 开机即武装监听随迁（安全网默认在位，init 顶层直调）',
    /^\s*addMusicGestureListeners\(\);/m.test(bare));

  /* ================ E. 注册完整性 ================ */
  check('E1 run-tests.js 已注册本套件（require + 调用）',
    /audio-ui-static-check/.test(runner));
  check('E2 frost-crack-runtime-check.js SCRIPT_ORDER 已含 audio-ui（加载清单同步）',
    /'audio-ui'/.test(frostCrack));

  return results;
}

if (require.main === module) {
  var rs = runChecks();
  var pass = 0;
  rs.forEach(function (r) {
    console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + '  -> ' + r.detail);
    if (r.pass) pass++;
  });
  console.log('----------------------------------------');
  console.log(pass + '/' + rs.length + ' passed');
  process.exit(pass === rs.length ? 0 : 1);
}

module.exports = { runChecks: runChecks };
