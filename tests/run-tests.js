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

var results = tests.runAll().concat(comboTests.runAll(), rankingTests.runAll(),
  spaceTests.runAll(), timerTests.runAll(), hintTests.runAll(), uiChecks.runChecks(),
  spaceChecks.runChecks(), timerChecks.runChecks(), rankChecks.runChecks(),
  themeChecks.runChecks(), hintChecks.runChecks(),
  campaignTests.runAll(), saveTests.runAll(), campaignChecks.runChecks());
var pass = 0;

results.forEach(function (r) {
  console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + '  -> ' + r.detail);
  if (r.pass) pass++;
});

console.log('----------------------------------------');
console.log(pass + '/' + results.length + ' passed');
process.exit(pass === results.length ? 0 : 1);
