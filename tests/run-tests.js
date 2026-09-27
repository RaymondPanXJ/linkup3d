#!/usr/bin/env node
/**
 * tests/run-tests.js — 在 Node 中运行核心算法自测
 * 用法：node tests/run-tests.js
 */
var tests = require('./tests.define.js');
var comboTests = require('./combo.define.js');
var rankingTests = require('./ranking.define.js');
var spaceTests = require('./space.define.js');
var timerTests = require('./timer.define.js');
var uiChecks = require('./ui-static-check.js');
var spaceChecks = require('./space-static-check.js');
var timerChecks = require('./timer-static-check.js');
var rankChecks = require('./rank-static-check.js');
var themeChecks = require('./theme-static-check.js');
var hintTests = require('./hint.define.js');
var hintChecks = require('./hint-static-check.js');
var campaignTests = require('./campaign.define.js');
var saveTests = require('./save.define.js');
var campaignChecks = require('./campaign-static-check.js');
var frostTests = require('./frost.define.js');
var frostChecks = require('./frost-static-check.js');
var enemyTests = require('./enemy.define.js');
var enemyChecks = require('./enemy-static-check.js');
var frostWiringChecks = require('./frost-wiring-static-check.js');
var frostReworkChecks = require('./frost-rework-static-check.js');
var starmapChecks = require('./starmap-static-check.js');
var fxChecks = require('./fx-static-check.js');
var bgmRaceChecks = require('./bgm-race-check.js');
var audioGestureChecks = require('./audio-gesture-static-check.js');
var simulationTests = require('./level-simulation.define.js');

var results = tests.runAll().concat(comboTests.runAll(), rankingTests.runAll(),
  spaceTests.runAll(), timerTests.runAll(), hintTests.runAll(), uiChecks.runChecks(),
  spaceChecks.runChecks(), timerChecks.runChecks(), rankChecks.runChecks(),
  themeChecks.runChecks(), hintChecks.runChecks(),
  campaignTests.runAll(), saveTests.runAll(), campaignChecks.runChecks(),
  frostTests.runAll(), frostChecks.runChecks(),
  enemyTests.runAll(), enemyChecks.runChecks(),
  frostWiringChecks.runChecks(), frostReworkChecks.runChecks(), starmapChecks.runChecks(),
  fxChecks.runChecks(),
  simulationTests.runAll());
var pass = 0;

function report(all) {
  all.forEach(function (r) {
    console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + '  -> ' + r.detail);
    if (r.pass) pass++;
  });

  console.log('----------------------------------------');
  console.log(pass + '/' + all.length + ' passed');
  process.exit(pass === all.length ? 0 : 1);
}

// bgm-race-check / audio-gesture-static-check 含异步仿真（Promise 决议），
// 等其完成后再并入汇总输出（issue #45 / #47）
Promise.all([
  Promise.resolve(bgmRaceChecks.runChecks()),
  Promise.resolve(audioGestureChecks.runChecks())
]).then(function (asyncGroups) {
  report(results.concat(asyncGroups[0], asyncGroups[1]));
});
