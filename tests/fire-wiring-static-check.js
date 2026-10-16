#!/usr/bin/env node
/**
 * tests/fire-wiring-static-check.js — 熔岩口主循环接线（issue #65, T2）
 * 无浏览器环境的静态断言 + 纯函数管线仿真（结构镜像 tests/frost-wiring-static-check.js）：
 *   A. index.html：fire.js 按序加载且带 ?v= 缓存参数（issue #52 口径）、game.js 同步升版；
 *   B. js/game.js：模块别名、点击/匹配守卫、消除灭火联动、心跳推进、可解性双判回滚、
 *      restart/进关/洗牌复位、提示联合口径、音效声部、注册完整性；
 *   C. css/style.css：燃烧覆盖/扑灭蒸汽类名 + 动画 + prefers-reduced-motion 回退；
 *   D. 管线仿真：用真实 Fire/Frost 模块复现接线事件流（蔓延+上限+决定论、
 *      联合可解判定口径、消除灭火、冰封交互），验证接线口径与模块契约一致。
 *
 * 运行：node tests/run-tests.js 或单独 node tests/fire-wiring-static-check.js
 */
var readUtf8 = require('./read-utf8.js');
var path = require('path');

function runChecks() {
  var root = path.join(__dirname, '..');
  var html = readUtf8(path.join(root, 'index.html'));
  var css = readUtf8(path.join(root, 'css', 'style.css'));
  var game = readUtf8(path.join(root, 'js', 'game.js'));
  var runner = readUtf8(path.join(root, 'tests', 'run-tests.js'));
  var F = require('../js/fire.js');
  var L = require('../js/link3d.js');

  var results = [];
  function check(name, cond, detail) {
    results.push({ name: name, pass: !!cond, detail: detail || (cond ? 'ok' : 'FAILED') });
  }

  /* ================ A. index.html 资源加载 ================ */
  var scriptTags = (html.match(/<script src="([^"]+)"><\/script>/g) || []);
  var scriptSrcs = scriptTags.map(function (s) { return s.match(/src="([^"]+)"/)[1].split('?')[0]; });
  var iFire = scriptSrcs.indexOf('js/fire.js');
  var iGame = scriptSrcs.indexOf('js/game.js');
  check('A1 index.html 按序加载 fire.js → game.js（fire 在 enemy.js 之后）',
    iFire >= 0 && iGame > iFire &&
    scriptSrcs.indexOf('js/enemy.js') < iFire,
    'fire=' + iFire + ' game=' + iGame);
  check('A2 fire.js script 带 ?v= 缓存参数（issue #52 击穿机制）',
    /<script src="js\/fire\.js\?v=[^"]+"><\/script>/.test(html));
  check('A3 本 PR 改动的 game.js/style.css 均升缓存版本（game.js?v= 与 css?v= 相等）',
    /<script src="js\/game\.js\?v=([^"]+)"><\/script>/.test(html) &&
    /href="css\/style\.css\?v=([^"]+)"/.test(html) &&
    html.match(/js\/game\.js\?v=([^"]+)/)[1] === html.match(/css\/style\.css\?v=([^"]+)/)[1]);

  /* ================ B. game.js 接线 ================ */
  check('B1 game.js 引入 Fire 模块别名', /window\.Fire/.test(game));
  check('B2 点击守卫：onTileClick 经 Fire.canSelect 拦截燃烧格',
    /function onTileClick\([\s\S]{0,600}FIR\.canSelect\(fireState, r, c\)/.test(game));
  check('B3 匹配守卫：连通判定前经 Fire.canMatch 把关端点',
    /FIR\.canMatch\(fireState, a\.r, a\.c, b\.r, b\.c\)[\s\S]{0,400}L\.findPath\(grid, a, b\)/.test(game));
  check('B4 消除灭火联动：eliminate 内调用 Fire.quenchAround（规则4 邻格扑灭）',
    /function eliminate\([\s\S]{0,1500}FIR\.quenchAround\(fireState, a\.r, a\.c, b\.r, b\.c\)/.test(game));
  check('B5 心跳驱动：onFireTick 由 setInterval 轮询（沿用 onHunterTick 模式，无 rAF）',
    /setInterval\(onFireTick, \d+\)/.test(game) && !/requestAnimationFrame/.test(game));
  check('B6 蔓延回合：spread 经 (state, work, rng, turn) 注入调用，回合计数自增',
    /FIR\.spread\(next, work, Math\.random, fireTurn\)/.test(game) &&
    /fireTurn\+\+/.test(game) && /FIRE_SPREAD_MS/.test(game));
  check('B7 可解性双判回滚（取舍记录 #65）：spread/ignite 都过 isBoardSolvable 才落地',
    /FIR\.spread\([\s\S]{0,80}FIR\.isBoardSolvable\(out\.state, work, L\)/.test(game) &&
    /FIR\.ignite\(next, q\.r, q\.c, fireTurn\)[\s\S]{0,120}FIR\.isBoardSolvable\(ig\.state, work, L\)/.test(game) &&
    /取舍记录（issue #65）/.test(game));
  check('B8 工作格口径：冰封格经 frostBlockedGrid 置 -1 后送火侧判定',
    /function frostBlockedGrid\(\)[\s\S]{0,400}work\[p\.r\]\[p\.c\] = -1/.test(game));
  check('B9 restart 复位熔火（fireState = FIR.create()）',
    /function restart\(\)[\s\S]{0,800}fireState = FIR\.create\(\)/.test(game));
  check('B10 进关复位：enterCampaign 清熔岩口',
    /function enterCampaign\(i\)[\s\S]{0,2000}fireState = FIR\.create\(\)/.test(game));
  check('B11 洗牌全场灭火（镜像 #39 裁决1）：doShuffle 重置 fireState 并清 tile-burning 类',
    /function doShuffle\(\)[\s\S]{0,900}fireState = FIR\.create\(\)/.test(game) &&
    /function doShuffle\(\)[\s\S]{0,900}classList\.remove\('tile-burning'\)/.test(game));
  check('B12 心跳兜底：联合不可解触发既有 announceShuffle',
    /if \(!hasFireSafeSolvablePair\(\) \|\| !hasUnfrozenSolvablePair\(\)\) announceShuffle\(\)/.test(game));
  check('B13 提示联合口径（#61 同款）：燃烧端点时改走 FIR.findUnburnedSolvablePair',
    /FIR\.canMatch\(fireState, pair\.a\.r, pair\.a\.c, pair\.b\.r, pair\.b\.c\)[\s\S]{0,140}FIR\.findUnburnedSolvablePair\(fireState, frostBlockedGrid\(\), L\.findPath\)/.test(game));
  check('B14 渲染同步：burningList 数据驱动 toggle tile-burning',
    /FIR\.burningList\(fireState\)/.test(game) &&
    /classList\.toggle\('tile-burning', !!burning\[k\]\)/.test(game));
  check('B15 扑灭瞬间动画：playQuench 挂 tile-quenching 且 gen 守卫防跨局',
    /function playQuench\([\s\S]{0,300}classList\.add\('tile-quenching'\)[\s\S]{0,160}myGen === gen/.test(game));
  check('B16 音效接线：ignite/quench 两个新声部存在且在事件分支触发',
    /ignite: function/.test(game) && /quench: function/.test(game) &&
    /SFX\.ignite\(\)/.test(game) && /SFX\.quench\(\)/.test(game));

  /* ================ C. css/style.css 类名与回退 ================ */
  check('C1 CSS：燃烧覆盖 .tile-burning::after（熔壳）', /\.tile-slot\.tile-burning::after/.test(css));
  check('C2 CSS：熔壳呼吸动画 lavapulse', /@keyframes lavapulse/.test(css));
  check('C3 CSS：扑灭蒸汽 .tile-quenching::before + quenchpuff 动画',
    /\.tile-slot\.tile-quenching::before/.test(css) && /@keyframes quenchpuff/.test(css));
  check('C4 CSS：燃烧格 cursor 默认（不可交互语义，对齐 tile-frozen）',
    /\.tile-slot\.tile-burning \.tile \{ cursor: default; \}/.test(css));
  var rmBlocks = css.match(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\n\}/g) || [];
  check('C5 CSS：prefers-reduced-motion 回退（燃烧/扑灭动画关停）',
    rmBlocks.join('\n').indexOf('tile-burning::after { animation: none; }') >= 0 &&
    rmBlocks.join('\n').indexOf('tile-quenching::before { animation: none;') >= 0);

  /* ================ D. 纯函数管线仿真（真实 Fire 模块） ================ */
  function makeGridD() {
    // 5×7 扩展网格：内圈 3×5；值5/2/3 各一对 + 值1 单张（D1 火种）
    return [
      [0, 0, 0, 0, 0, 0, 0],
      [0, 5, 1, 0, 0, 5, 0],
      [0, 2, 0, 0, 0, 2, 0],
      [0, 0, 3, 3, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0]
    ];
  }
  function makeRng(seed) {
    var t = seed >>> 0;
    return function () {
      t = (t * 1664525 + 1013904223) >>> 0;
      return t / 4294967296;
    };
  }

  // D1: 接线路径「spread 落地判据」复现——applied 且 isBoardSolvable 才落地；决定论重放
  var gD = makeGridD();
  var fsD = F.create();
  var igD = F.ignite(fsD, 1, 2, 1); // 值1 单张 (1,2) 作火种：候选仅 (1,1)（值5 端点）
  var o1 = F.spread(igD.state, gD, makeRng(9), 2);
  var landed = o1.applied && F.isBoardSolvable(o1.state, gD, L);
  var o1b = F.spread(igD.state, gD, makeRng(9), 2);
  check('仿真D1a 接线判据：本回合 spread 落地且盘面仍可解（火种不封死值2对）',
    igD.applied && landed, 'applied=' + o1.applied + ' solvable=' + F.isBoardSolvable(o1.state, gD, L));
  check('仿真D1b 同 rng 重放逐字节一致（同种子同回合 burned 集合相等）',
    JSON.stringify(o1.burned) === JSON.stringify(o1b.burned) &&
    F.snapshot(o1.state) === F.snapshot(o1b.state));

  // D2: 上限 4 —— 接线 ignite 循环到第 5 口 applied=false，BURNING 状态字节不变
  var capped = F.create();
  var seq = [[1, 1], [1, 3], [2, 1], [3, 1]];
  for (var i = 0; i < seq.length; i++) capped = F.ignite(capped, seq[i][0], seq[i][1], 1).state;
  var fifth = F.ignite(capped, 3, 2, 2);
  check('仿真D2 熔岩口到第 5 口拒绝：applied=false 且燃烧数仍 4（心跳静默跳过口径）',
    fifth.applied === false && F.countBurning(fifth.state) === 4);

  // D3: 接线「不可解→回滚/洗牌」触发口径的正反例——火吞掉唯一可连对的端点：
  //     isBoardSolvable 翻 false（spread 结果将被接线回滚），随后 quenchAround
  //     模拟消除灭火（被消对 (1,2)+(2,2) 的邻格含火种 (1,1)）恢复 true
  var gDead = [
    [0, 0, 0, 0, 0, 0],
    [0, 1, 1, 2, 0, 0],
    [0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0]
  ];
  var fsBlock = F.ignite(F.create(), 1, 1, 1).state; // 火种吞值1对一端 (1,1)；余值1/值2 皆单张
  check('仿真D3a 火吞唯一可连对端点：isBoardSolvable 翻 false（接线将回滚/触发洗牌复位）',
    F.isBoardSolvable(F.create(), gDead, L) === true &&
    F.isBoardSolvable(fsBlock, gDead, L) === false);
  var quenchedD3 = F.quenchAround(fsBlock, 1, 2, 2, 2); // 模拟消除 (1,2)+(2,2)：邻格含 (1,1)
  check('仿真D3b 消除灭火恢复可解：quenchAround 扑灭端点火后判定翻回 true',
    quenchedD3.quenched.length === 1 &&
    quenchedD3.quenched[0].r === 1 && quenchedD3.quenched[0].c === 1 &&
    F.isBoardSolvable(quenchedD3.state, gDead, L) === true);

  // D4: 冰封联合口径——frostBlockedGrid 产物（frozen=-1 工作格）直接喂火感知搜索：
  //     -1 格不入端点候选，其同值伙伴无对可连，返回值必不含该值/该格
  //     （与 game.js hasFireSafeSolvablePair 的注入完全同构）
  var gMix = makeGridD();
  var workMix = gMix.map(function (row) { return row.slice(); });
  workMix[3][2] = -1; // 值3 一端 (3,2) 冰封（frostBlockedGrid 的等价产物）
  var pMix = F.findUnburnedSolvablePair(F.create(), workMix, L.findPath);
  check('仿真D4 frozen=-1 工作格上火感知搜索绕开冰封端点（返回值无值3/(3,2)）',
    pMix !== null && pMix.value !== 3 &&
    !(pMix.a.r === 3 && pMix.a.c === 2) && !(pMix.b.r === 3 && pMix.b.c === 2),
    pMix ? 'value=' + pMix.value : 'null');

  // D5: fire.js findUnburnedSolvablePair 与 L.findSolvablePair 无火时确定性等价
  //     （接线用其兜底不引入选择偏差，与 frost-hint #61 同法）
  var det = true;
  var gClean = makeGridD();
  for (var seed = 1; seed <= 30; seed++) {
    var pA = L.findSolvablePair(gClean, makeRng(seed));
    var pB = F.findUnburnedSolvablePair(F.create(), gClean, L.findPath, makeRng(seed));
    if (JSON.stringify(pA) !== JSON.stringify(pB)) det = false;
  }
  check('仿真D5 无火时与 L.findSolvablePair 同 rng 逐调用等价（30 seeds）', det);

  /* ================ E. 测试注册 ================ */
  check('E1 run-tests.js 注册 fire-wiring-static-check',
    /fire-wiring-static-check/.test(runner));

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
