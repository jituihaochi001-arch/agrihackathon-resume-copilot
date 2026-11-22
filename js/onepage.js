/* onepage.js — 恒定一页的内容级收敛
 *
 * 目标：优化后的简历必须落在 A4 一页内。
 * 做法不是无限压字号（压到 8pt 就不可读了），而是按「价值」分级裁内容：
 *   第 1 级：删掉低价值要点（无数字、无关键词、重复表述）
 *   第 2 级：截断超长要点
 *   第 3 级：仍然超高 → 才逐档收紧版式（字号/行距）
 * 每一步都尽量少动内容，保留简历的核心竞争力。
 */
(function (root) {
  'use strict';

  /* ---------- 价值评估 ---------- */

  var STRONG = /(%|％|倍|万|亿|k|K|ms|秒|分钟|小时|天|人|家|次|个|条|万\+|\+)/;
  var WEAK = /^(负责|参与|协助|配合|完成|跟进|维护|支持|协助|其他| misc)/;

  /** 给一条要点打分：越高越该保留 */
  function scoreBullet(b, i) {
    var s = 50 - i * 3;                        // 靠前的要点更重要
    var t = String(b || '');
    if (STRONG.test(t)) s += 22;              // 有数字证据
    if (t.length >= 14) s += 8;
    if (t.length > 46) s -= 14;               // 太长占地方
    if (WEAK.test(t)) s -= 16;                // 纯职责描述，价值低
    if (/(系统|平台|架构|核心|主导|负责.*设计|从 0 到 1|0-1|搭建)/.test(t)) s += 10;
    if (/(熟悉|熟练|精通|掌握)/.test(t)) s -= 8;
    return s;
  }

  function scoreSection(sec, idx) {
    var s = 40;
    var t = sec.type || '';
    if (t === 'experience' || t === 'project') s += 25;
    if (t === 'education') s += 12;
    if (t === 'summary' || t === 'skills') s += 10;
    if (t === 'award' || t === 'award' || t === 'language' || t === 'campus') s -= 18;
    var n = (sec.items || []).length;
    s -= idx * 2;
    if (n === 0) s -= 10;
    return s;
  }

  /* ---------- 内容级裁剪 ---------- */

  /**
   * 裁掉一个「价值最低」的可裁剪单元，返回被裁掉的内容描述（用于给用户提示）
   * @returns {string|null} 被裁掉的内容；null 表示已经没得裁了
   */
  function trimOnce(model) {
    var sections = model.sections || [];

    // ① 要点：挑整个简历里价值最低的一条
    var worst = null;
    sections.forEach(function (sec, si) {
      if (sec.mode !== 'entries') return;
      (sec.items || []).forEach(function (it, ii) {
        (it.bullets || []).forEach(function (b, bi) {
          var sc = scoreBullet(b, bi);
          if (!worst || sc < worst.score) {
            worst = { score: sc, sec: sec, item: it, bi: bi, text: b };
          }
        });
      });
    });

    // ② 段落型内容（个人简介）
    var para = null;
    sections.forEach(function (sec, si) {
      if (sec.mode === 'para' && sec.text && sec.text.length > 40) {
        var sc = scoreSection(sec, si) - (sec.text.length > 110 ? 14 : 0);
        if (!para || sc < para.score) para = { score: sc, sec: sec };
      }
    });

    // 要点比段落更该被裁
    if (worst && (!para || worst.score <= para.score)) {
      var arr = worst.item.bullets;
      arr.splice(worst.bi, 1);
      if (!arr.length) {
        // 这一条经历没内容了 → 移除该条
        var its = worst.sec.items;
        if (its.length > 1) its.splice(its.indexOf(worst.item), 1);
      }
      return worst.text;
    }
    if (para) {
      // 简介超长 → 按比例逐级压缩（每次都必须真的变短，否则会空转）
      var t = para.sec.text;
      var target = Math.max(24, Math.round(t.length * 0.62));
      var cut = t.slice(0, target);
      var lastPunct = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('；'),
        cut.lastIndexOf('，'), cut.lastIndexOf('、'), cut.lastIndexOf(' '));
      if (lastPunct > target * 0.45) cut = cut.slice(0, lastPunct + 1);
      if (cut.length >= t.length) return null;      // 已经压到极限，没得裁了
      para.sec.text = cut;
      return t;
    }
    return null;
  }

  /** 统计模型当前大概占多少行（用于估算是否还需要裁） */
  function estimateLines(model) {
    var n = 0;
    (model.sections || []).forEach(function (sec) {
      if (sec.mode === 'para') { n += Math.ceil((sec.text || '').length / 46) + 2; return; }
      if (sec.mode === 'chips') { n += 2; return; }
      n += 2;                                   // 栏目标题
      (sec.items || []).forEach(function (it) {
        n += 1;                                 // 机构行
        (it.bullets || []).forEach(function (b) {
          n += Math.max(1, Math.ceil(String(b).length / 44));
        });
      });
    });
    return n;
  }

  var api = {
    trimOnce: trimOnce,
    estimateLines: estimateLines,
    scoreBullet: scoreBullet,
    scoreSection: scoreSection
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ResumeOnePage = api;
})(typeof window !== 'undefined' ? window : this);
