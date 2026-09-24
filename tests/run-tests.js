#!/usr/bin/env node
/**
 * tests/run-tests.js — 在 Node 中运行核心算法自测
 * 用法：node tests/run-tests.js
 */
var tests = require('./tests.define.js');
var uiChecks = require('./ui-static-check.js');

var results = tests.runAll().concat(uiChecks.runChecks());
var pass = 0;

results.forEach(function (r) {
  console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + '  -> ' + r.detail);
  if (r.pass) pass++;
});

console.log('----------------------------------------');
console.log(pass + '/' + results.length + ' passed');
process.exit(pass === results.length ? 0 : 1);
