#!/usr/bin/env node
/**
 * tests/scenes-static-check.js — 场景接线模块拆出（issue #74 刀2）静态断言
 * 无浏览器环境（项目纪律：静态断言+curl，禁浏览器自动化）：
 *   A. index.html：scenes.js 按序加载（scene.js→stars.js→scenes.js→game.js）
 *      且带 ?v= 缓存参数（#52 击穿机制），与 game.js/css 同步升版（三件套纪律）；
 *   B. game.js 同签名接线保留：SceneUI.init 注入 + applyScene/initSceneSystem
 *      同名别名 + 三 getter 注入行 + 原调用点不丢；
 *   C. 簇迁出无残留：game.js 不得再出现四函数定义、SC.* 数据表访问、starsHandle、
 *      hudSceneIdFor、data-scene 等簇内实现标识；
 *   D. scenes.js 注入纪律（核心锁）：不抓 DOM（无 getElementById）、状态只经
 *      getter 读取（剥离声明行与映射表达式行后，game.js 私有标识符 campaignIdx/
 *      mode/difficulty 不得出现——防闭包偷读的正则扫描）、不碰关卡表/require；
 *   E. 加载清单同步：frost-crack 沙箱 SCRIPT_ORDER 已含 scenes（沿 ufo/刀1 先例）。
 *
 * 运行：node tests/run-tests.js 或单独 node tests/scenes-static-check.js
 */
var readUtf8 = require('./read-utf8.js');
var path = require('path');

function runChecks() {
  var root = path.join(__dirname, '..');
  var html = readUtf8(path.join(root, 'index.html'));
  var css = readUtf8(path.join(root, 'css', 'style.css'));
  var game = readUtf8(path.join(root, 'js', 'game.js'));
  var scenes = readUtf8(path.join(root, 'js', 'scenes.js'));
  var runner = readUtf8(path.join(root, 'tests', 'run-tests.js'));
  var runtime = readUtf8(path.join(root, 'tests', 'frost-crack-runtime-check.js'));

  var results = [];
  function check(name, cond, detail) {
    results.push({ name: name, pass: !!cond, detail: detail || (cond ? 'ok' : 'FAILED') });
  }

  /* ================ A. index.html 资源加载 ================ */
  var srcs = (html.match(/<script src="([^"]+)"><\/script>/g) || [])
    .map(function (s) { return s.match(/src="([^"]+)"/)[1].split('?')[0]; });
  check('A1 index.html 按序加载 scene.js → stars.js → scenes.js → game.js',
    (function () {
      var a = srcs.indexOf('js/scene.js'), b = srcs.indexOf('js/stars.js'),
        c = srcs.indexOf('js/scenes.js'), d = srcs.indexOf('js/game.js');
      return a >= 0 && a < b && b < c && c < d;
    })(), 'scene=' + srcs.indexOf('js/scene.js') + ' stars=' +
    srcs.indexOf('js/stars.js') + ' scenes=' + srcs.indexOf('js/scenes.js'));
  check('A2 scenes.js script 带 ?v= 缓存参数（issue #52 击穿机制）',
    /<script src="js\/scenes\.js\?v=[^"]+"><\/script>/.test(html));
  check('A3 本刀改动的 game.js/scenes.js/style.css 三者缓存版本一致（三件套纪律）',
    (function () {
      var g = html.match(/js\/game\.js\?v=([^"]+)/);
      var s = html.match(/js\/scenes\.js\?v=([^"]+)/);
      var c = html.match(/css\/style\.css\?v=([^"]+)/);
      return !!(g && s && c && g[1] === s[1] && s[1] === c[1]);
    })());

  /* ================ B. game.js 同签名接线 ================ */
  check('B1 game.js 经 window.Scenes.init 注入接线（DOM 传入 + 三状态 getter 注入）',
    /window\.Scenes\.init\(\{/.test(game) &&
    /getCampaignIdx: function \(\) \{ return campaignIdx; \}/.test(game) &&
    /getMode: function \(\) \{ return mode; \}/.test(game) &&
    /getDifficulty: function \(\) \{ return difficulty; \}/.test(game) &&
    /sceneNameEl: document\.getElementById\('sceneName'\)/.test(game));
  check('B2 game.js 同签名别名接线（applyScene/initSceneSystem 调用点签名零变化）',
    /var applyScene = SceneUI\.applyScene;/.test(game) &&
    /var initSceneSystem = SceneUI\.initSceneSystem;/.test(game));
  check('B3 game.js 调用点保留：applyScene(); ≥3（restart/进关/退局）+ initSceneSystem(); ≥1',
    (game.match(/applyScene\(\);/g) || []).length >= 3 &&
    (game.match(/initSceneSystem\(\);/g) || []).length >= 1,
    'applyScene=' + (game.match(/applyScene\(\);/g) || []).length);

  /* ================ C. 簇迁出无残留（game.js 侧） ================ */
  check('C1 game.js 无四函数定义残留',
    !/function currentSceneId|function applyScene\(|function renderSceneName|function initSceneSystem/.test(game));
  check('C2 game.js 无 Scene 数据表/句柄访问残留（SC.* / hudSceneIdFor / starsHandle / DEFAULT_SCENE_ID）',
    !/\bSC\./.test(game) && !/hudSceneIdFor/.test(game) &&
    !/starsHandle/.test(game) && !/DEFAULT_SCENE_ID/.test(game));
  check('C3 game.js 无 DOM 场景副作用残留（data-scene 属性写入在 scenes.js 侧）',
    !/data-scene/.test(game));

  /* ================ D. scenes.js 注入纪律（防闭包偷读核心锁） ================ */
  check('D1 scenes.js 为 UMD 模块且挂载 window.Scenes.init',
    /module\.exports = factory\(\)/.test(scenes) && /root\.Scenes = factory\(\)/.test(scenes) &&
    /return \{ init: init \}/.test(scenes));
  check('D2 scenes.js DOM 抓取收口：getElementById 全程仅 1 处且在 #53 原文逐字的 starfield 挂载行',
    (scenes.match(/getElementById/g) || []).length === 1 &&
    /window\.Stars\.mount\(document\.getElementById\('starfield'\)\)/.test(scenes));
  check('D3 scenes.js 状态只经 opts getter 读取（三 getter 声明在册）',
    /opts\.getCampaignIdx/.test(scenes) && /opts\.getMode/.test(scenes) &&
    /opts\.getDifficulty/.test(scenes));
  check('D4 正则扫 scenes.js 无 game.js 私有标识符偷读：剥离 getter 声明行与映射表达式行后，' +
    'campaignIdx/mode/difficulty 零出现',
    (function () {
      var stripped = scenes.split('\n').filter(function (line) {
        // 注释行不参与代码扫描
        if (/^\s*(\*|\/\*|\/\/)/.test(line)) return false;
        // getter 落位声明行（合法的唯一注入通道）
        if (/var (campaignIdx|mode|difficulty) = (getCampaignIdx|getMode|getDifficulty)\(\);/.test(line)) return false;
        // hudSceneIdFor 映射表达式行（#53 老锁逐字保留区，消费的是上面落位的局部量）
        if (/hudSceneIdFor|'campaign' : mode|campaignIdx : difficulty/.test(line)) return false;
        return true;
      }).join('\n');
      var m = stripped.match(/\b(campaignIdx|mode|difficulty)\b/);
      return m ? false : true;
    })());
  check('D5 scenes.js 不 require/不读关卡表（关卡映射只经注入的 campaignIdx 走 hudSceneIdFor）',
    !/require\(/.test(scenes) && !/LEVELS/.test(scenes));
  check('D6 scenes.js 保留 Scene/Stars 缺失静默降级语义（!SC 守卫 + try/catch 适配器）',
    /if \(!SC\) return null;/.test(scenes) && /if \(!SC\) return;/.test(scenes) &&
    /try \{ return window\.Scene \|\| null; \} catch \(e\) \{ return null; \}/.test(scenes));

  /* ================ E. 加载清单与注册 ================ */
  check('E1 frost-crack-runtime-check SCRIPT_ORDER 已含 scenes（沙箱与 index.html 清单同步，沿刀1先例）',
    /'stars', 'scenes'/.test(runtime));
  check('E2 run-tests.js 注册 scenes-static-check', /scenes-static-check/.test(runner));

  return results;
}

module.exports = { runChecks: runChecks };

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
