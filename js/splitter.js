/* splitter.js — 诊断区 ↔ 预览区 之间的可拖拽分割线
 *
 * 做法：改写 .workbench 上的 --pw（预览区宽度，单位 px）。
 * 预览区是固定宽的一栏，拖动分割线即改变它，
 * 左边诊断区（1fr）自动吃掉剩余空间。
 *
 * 宽度来源，优先级从高到低：
 *   ① 用户拖过 → 记在 localStorage，一直生效
 *   ② 媒体查询给的默认值（窄屏自动收窄预览区）
 *   ③ 行内 --pw（由本模块写入）
 *
 * 注意：工作区未显示时（.view 默认 display:none）clientWidth 为 0，
 * 此时算出来的宽度是错的 —— 所以恢复时要等到它真正可见。
 */
(function () {
  'use strict';

  var STORE_KEY = 'resume-polisher-split';

  var MIN_PREVIEW = 380;   // 预览区最小宽
  var MIN_ANALYSIS = 360;  // 诊断区最小宽
  var DEFAULT_PW = 652;    // 复位后的预览区宽度

  function $(id) { return document.getElementById(id); }

  function readStore() {
    try {
      var v = parseFloat(localStorage.getItem(STORE_KEY));
      return isFinite(v) && v > 0 ? v : null;
    } catch (e) { return null; }
  }

  function writeStore(v) {
    try { localStorage.setItem(STORE_KEY, String(Math.round(v))); } catch (e) { /* 无痕模式等 */ }
  }

  /** 分割线自身占的宽度（grid 中间那一列，实测而非写死） */
  function gripWidth(split) {
    return split && split.offsetWidth ? split.offsetWidth : 20;
  }

  /** 单列布局（窄屏）下分割线被隐藏，此时不参与宽度分配 */
  function isStacked(split) {
    return !split || split.offsetWidth === 0;
  }

  /** 除分割线外，诊断区 + 预览区可分配的总宽 */
  function totalWidth(bench, split) {
    return bench.clientWidth - gripWidth(split);
  }

  /** 把预览宽夹到合法区间 */
  function clamp(bench, split, pw) {
    var total = totalWidth(bench, split);
    var max = Math.max(MIN_PREVIEW, total - MIN_ANALYSIS);
    var min = Math.min(MIN_PREVIEW, max);
    return Math.round(Math.max(min, Math.min(max, pw)));
  }

  /** 当前生效的预览宽（CSS 变量可能被媒体查询改过，取计算值最准） */
  function currentWidth(bench) {
    var v = parseFloat(getComputedStyle(bench).getPropertyValue('--pw'));
    return isFinite(v) && v > 0 ? v : DEFAULT_PW;
  }

  /** 同步无障碍属性 */
  function syncAria(bench, split, w) {
    if (!split) return;
    var total = totalWidth(bench, split);
    if (total <= 0) return;
    split.setAttribute('aria-valuenow', String(Math.round((w / total) * 100)));
    split.setAttribute('aria-valuemin', String(Math.round(MIN_PREVIEW / total * 100)));
    split.setAttribute('aria-valuemax', String(Math.round((total - MIN_ANALYSIS) / total * 100)));
  }

  function init() {
    var bench = document.querySelector('.workbench');
    var split = $('splitter');
    if (!bench || !split) return;

    // 用户显式设置过的宽度（null = 跟随 CSS 默认 / 媒体查询）
    var pref = readStore();
    var restored = false;

    function apply(pw) {
      var w = clamp(bench, split, pw);
      bench.style.setProperty('--pw', w + 'px');
      syncAria(bench, split, w);
      return w;
    }

    /**
     * 恢复上次的位置。
     * 工作区在 .view 里，未激活时 display:none → clientWidth = 0，
     * 这时候夹宽度会得到 MIN_PREVIEW 的错误结果。
     * 所以等它真正可见（宽度 > 0）再应用。
     */
    function restore() {
      if (restored) return;
      if (bench.clientWidth <= 0) return;      // 还没显示，等下次
      restored = true;
      if (pref) {
        apply(pref);
      } else {
        // 跟随 CSS 默认值；若默认不合规才写行内
        var css = currentWidth(bench);
        var clamped = clamp(bench, split, css);
        if (Math.abs(clamped - css) > 0.5) {
          bench.style.setProperty('--pw', clamped + 'px');
        }
        syncAria(bench, split, clamped);
      }
    }

    // 首次可见时恢复
    if (typeof ResizeObserver === 'function') {
      var ro = new ResizeObserver(function () { restore(); });
      ro.observe(bench);
    }
    restore();
    // 兜底：视图切换不一定会触发 ResizeObserver
    document.addEventListener('click', function () { setTimeout(restore, 0); }, true);
    window.addEventListener('resize', function () { setTimeout(restore, 0); });

    var dragging = false;
    var startX = 0;
    var startPw = 0;

    function onMove(e) {
      if (!dragging) return;
      // 分割线在右栏左侧边缘：往左拖 → 右栏变宽
      var dx = e.clientX - startX;
      apply(startPw - dx);
    }

    function onUp() {
      if (!dragging) return;
      dragging = false;
      split.classList.remove('is-dragging');
      document.documentElement.classList.remove('is-splitting');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      // 记住当前位置
      var pw = parseFloat(bench.style.getPropertyValue('--pw'));
      if (isFinite(pw)) {
        pref = pw;
        writeStore(pw);
      }
    }

    split.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      dragging = true;
      startX = e.clientX;
      startPw = currentWidth(bench);
      split.classList.add('is-dragging');
      document.documentElement.classList.add('is-splitting');
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
      try { split.focus({ preventScroll: true }); } catch (err) { split.focus(); }
      e.preventDefault();
    });

    // 双击复位
    split.addEventListener('dblclick', function () {
      pref = null;
      try { localStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ }
      bench.style.removeProperty('--pw');
      apply(DEFAULT_PW);
    });

    // 键盘可达：左右方向键移动
    split.addEventListener('keydown', function (e) {
      var step = e.shiftKey ? 64 : 16;
      var cur = currentWidth(bench);
      var next = cur;
      if (e.key === 'ArrowLeft') next = cur + step;
      else if (e.key === 'ArrowRight') next = cur - step;
      else if (e.key === 'Home') next = DEFAULT_PW;
      else return;
      e.preventDefault();
      pref = apply(next);
      writeStore(pref);
    });

    // 窗口尺寸变化时重新夹一次，避免窄窗口下把诊断区挤没
    var rt = null;
    window.addEventListener('resize', function () {
      if (rt) clearTimeout(rt);
      rt = setTimeout(function () {
        if (isStacked(split)) {
          // 单列布局：--pw 不参与分配，清掉行内值即可
          bench.style.removeProperty('--pw');
          return;
        }
        if (pref) {
          apply(pref);
        } else {
          var css = currentWidth(bench);
          var clamped = clamp(bench, split, css);
          if (Math.abs(clamped - css) > 0.5) {
            bench.style.setProperty('--pw', clamped + 'px');
          } else {
            bench.style.removeProperty('--pw');
          }
          syncAria(bench, split, clamped);
        }
      }, 120);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
