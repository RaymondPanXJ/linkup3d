/**
 * tutorial.js — 新手引导的分步卡片 UI（浏览器端）
 * 状态机与文案来自 js/hint.js（window.Hint），本文件只负责渲染与交互。
 * 首次访问（localStorage linkup3d.tutorial 为空）自动弹出；
 * HUD「?」按钮可随时重放。完成或跳过后写入 localStorage。
 */
(function () {
  'use strict';

  var H = window.Hint;

  function mount(opts) {
    var container = opts.container;
    var nextBtn = opts.nextBtn;
    var skipBtn = opts.skipBtn;
    var dotsEl = opts.dots;
    var titleEl = opts.title;
    var textEl = opts.text;
    var storage = opts.storage; // { get(), set() }，异常安全由调用方保证

    var step = 0; // 0 = 关闭

    function persist() {
      try { storage.set(); } catch (e) { /* 无存储环境忽略 */ }
    }

    function render() {
      var open = step > 0;
      container.classList.toggle('show', open);
      container.setAttribute('aria-hidden', open ? 'false' : 'true');
      if (!open) return;
      var s = H.STEPS[step - 1];
      titleEl.textContent = s.title;
      textEl.textContent = s.text;
      nextBtn.textContent = step >= H.STEPS.length ? '开始游戏' : '下一步';
      var dots = dotsEl.children;
      for (var i = 0; i < dots.length; i++) {
        dots[i].classList.toggle('active', i === step - 1);
      }
    }

    function show() {
      step = 1;
      render();
    }

    function finish() {
      step = 0;
      render();
      persist();
    }

    nextBtn.addEventListener('click', function () {
      step = H.nextStep(step, 'next');
      if (step === 0) finish(); else render();
    });
    skipBtn.addEventListener('click', finish);

    return {
      show: show,
      isOpen: function () { return step > 0; }
    };
  }

  window.Tutorial = { mount: mount };
})();
