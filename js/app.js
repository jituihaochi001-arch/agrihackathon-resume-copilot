/* app.js — 状态、交互与导出 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var STORE_KEY = 'resume-polisher-v1';

  var S = {
    rawResume: '',
    rawJd: '',
    fileName: '',
    base: null,
    model: null,
    jd: null,
    suggestions: [],
    gaps: [],
    selected: Object.create(null),
    style: 'swiss',
    tpl: 'swiss',
    format: 'pdf',
    mode: 'relayout',
    photo: '',
    srcBuf: null,
    srcB64: '',
    srcKind: '',
    srcPages: 1,
    layout: null,
    layouts: null,
    flow: null,
    fit: 0,
    trimmed: 0,
    step: 1,
    filter: 'all',
    lastScore: 0,
    docId: ''
  };

  /* ---------------- 基础 ---------------- */

  function toast(msg) {
    var el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    document.body.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('is-in'); });
    setTimeout(function () {
      el.classList.remove('is-in');
      setTimeout(function () { el.remove(); }, 320);
    }, 2600);
  }

  /**
   * 把深色滑块移到当前步骤上。
   * 滑块是绝对定位的独立元素，宽度与位移按按钮实际尺寸算，
   * 因此窗口缩放、字体加载完成后都可以再校准一次。
   */
  function syncStepThumb() {
    var nav = $('steps');
    if (!nav) return;
    var thumb = nav.querySelector('.steps-thumb');
    var cur = nav.querySelector('.step.is-current');
    if (!thumb || !cur) return;
    // 用 rect 相对计算，避开 offsetParent 语义与 transform 干扰
    var nr = nav.getBoundingClientRect();
    var cr = cur.getBoundingClientRect();
    if (!cr.width) return;
    var cs = window.getComputedStyle(nav);
    var borderL = parseFloat(cs.borderLeftWidth) || 0;
    // 滑块 left:0 相对 nav 的 padding box（border 内侧），而 rect 是相对 border box
    var x = cr.left - nr.left - borderL;
    thumb.style.width = cr.width + 'px';
    thumb.style.transform = 'translateX(' + x + 'px)';
  }

  function setStep(n) {
    S.step = n;
    var work = $('viewWork');
    if (work) work.dataset.step = String(n);
    Array.prototype.forEach.call(document.querySelectorAll('.step'), function (el) {
      var k = +el.dataset.step;
      el.classList.toggle('is-active', k <= n);
      el.classList.toggle('is-current', k === n);
      el.setAttribute('aria-current', k === n ? 'step' : 'false');
      el.classList.toggle('is-locked', k > 1 && !S.base);
    });
    syncStepThumb();
  }

  /* ---------------- 视图切换 ---------------- */

  // 左栏四个功能区：resume / optimize / settings / interview
  var VIEW_META = {
    resume:    { title: '我的简历', kicker: '01 / RESUME LIBRARY', view: 'viewUpload' },
    editor:    { title: '编辑简历', kicker: '01 / RESUME EDITOR', view: 'viewEditor', parent: 'resume' },
    optimize:  { title: '简历优化', kicker: '02 / POLISH WORKBENCH', view: 'viewWork' },
    settings:  { title: 'API 设置', kicker: '03 / MODEL ACCESS', view: 'viewSettings' },
    interview: { title: '模拟面试', kicker: '04 / MOCK INTERVIEW', view: 'viewInterview' },
  };

  /** 只切左侧高亮与顶栏文案，不动视图（供 interview / ai 模块复用） */
  /* ---------------- 浏览器前进 / 后退 ----------------
     每个界面（简历库 / 优化台步骤 / 编辑器 / 设置 / 面试）都记一条历史，
     这样浏览器「后退」是在站内回到上一个界面，而不是直接退出网站。 */
  var CURRENT_ROUTE = { rp: 'resume', step: 1, docId: '' };
  var routeReady = false;    // 初始化完成前不写历史，避免刷新时多出无用条目
  var routeSilent = false;   // 由 popstate 回放时只改界面，不再压历史
  var editorPushed = false;  // 编辑器是否由一次 push 打开（决定关闭时 back 还是 replace）

  function sameRoute(a, b) {
    return !!a && !!b && a.rp === b.rp &&
      (a.step || 1) === (b.step || 1) &&
      (a.docId || '') === (b.docId || '');
  }

  /** 记录并压入一条历史；返回是否真的压入了 */
  function markRoute(rp, step, docId) {
    var next = { rp: rp, step: step || 1, docId: docId || '' };
    if (sameRoute(next, CURRENT_ROUTE)) return false;
    CURRENT_ROUTE = next;
    if (!routeReady || routeSilent) return false;
    try { history.pushState(next, ''); return true; } catch (e) { return false; }
  }

  /** 替换当前历史条目（关闭弹层/离开编辑器时用，避免堆出重复页面） */
  function replaceRoute(rp, step, docId) {
    CURRENT_ROUTE = { rp: rp, step: step || 1, docId: docId || '' };
    if (!routeReady) return;
    try { history.replaceState(CURRENT_ROUTE, ''); } catch (e) { /* 本地文件环境等忽略 */ }
  }

  /** 后退/前进时把界面还原到历史记录的状态 */
  function applyRoute(st) {
    var rp = st && st.rp;
    routeSilent = true;
    try {
      closeAllOverlays();
      if (rp === 'editor') {
        var doc = (st.docId && window.ResumeLib) ? window.ResumeLib.get(st.docId) : null;
        if (doc && window.ResumeEditor) {
          activate('editor');
          window.ResumeEditor.open(doc.id);
          CURRENT_ROUTE = { rp: 'editor', step: 1, docId: doc.id };
          editorPushed = false;
        } else {
          showUpload();
        }
      } else if (rp === 'optimize') {
        activate('optimize');
        setStep(st.step || 2);
        syncUploadState();
      } else if (rp === 'settings') {
        showSettings();
      } else if (rp === 'interview') {
        showInterview();
      } else {
        showUpload();
      }
      window.scrollTo({ top: 0, behavior: 'auto' });
    } finally {
      routeSilent = false;
    }
  }

  function initRoute() {
    var had = false;
    try { had = !!history.state; } catch (e) { }
    CURRENT_ROUTE = CURRENT_ROUTE || { rp: 'resume', step: 1, docId: '' };
    try { history.replaceState(CURRENT_ROUTE, ''); } catch (e) { }
    // 首次进入时多垫一条同样的记录：从第一个界面按后退也不会立刻退出网站
    if (!had) { try { history.pushState(CURRENT_ROUTE, ''); } catch (e) { } }
    routeReady = true;
  }

  function syncChrome(name) {
    var meta = VIEW_META[name] || VIEW_META.resume;
    var nav = meta.parent || name;
    document.body.dataset.section = nav;
    if ($('topbarTitle')) $('topbarTitle').textContent = meta.title;
    if ($('topbarKicker')) $('topbarKicker').textContent = meta.kicker;
    Array.prototype.forEach.call(document.querySelectorAll('.side-item'), function (b) {
      var on = b.dataset.view === nav;
      b.classList.toggle('is-on', on);
      if (on) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    if ($('btnReset')) $('btnReset').hidden = !S.base || name === 'settings' || name === 'editor';
    if ($('btnEditRaw')) $('btnEditRaw').hidden = name !== 'optimize' || !S.base;
  }

  /** 激活一个功能视图（负责 is-active / 顶栏 / 左栏高亮） */
  function activate(name) {
    var meta = VIEW_META[name] || VIEW_META.resume;
    Array.prototype.forEach.call(document.querySelectorAll('.view'), function (v) {
      v.classList.toggle('is-active', v.id === meta.view);
    });
    // 离开编辑器时先落盘，避免未保存的改动丢失
    if (name !== 'editor' && window.ResumeEditor && window.ResumeEditor.isOpen()) {
      window.ResumeEditor.close();
    }
    // 离开面试页时收起面试弹层，避免它们盖住其它页面
    if (name !== 'interview') {
      var so = $('ivStartOverlay');
      if (so) so.hidden = true;
      var ro = $('ivReportOverlay');
      if (ro) ro.hidden = true;
    }
    syncChrome(name);
  }

  /** 回到「我的简历」：数据不丢，随时可再回优化台
   *  mode='replace' 时替换当前历史项（离开编辑器用，避免历史里出现重复的简历库） */
  function showUpload(mode) {
    activate('resume');
    setStep(1);
    syncUploadState();
    if (window.ResumeLib) window.ResumeLib.render();
    persist();
    if (mode === 'replace') replaceRoute('resume', 1);
    else markRoute('resume', 1);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  /** 进入编辑器 */
  function openEditor(id) {
    if (!window.ResumeLib || !window.ResumeEditor) return;
    var doc = window.ResumeLib.get(id);
    if (!doc) { toast('没有找到这份简历'); return; }
    activate('editor');
    window.ResumeEditor.open(doc.id);
    editorPushed = markRoute('editor', 1, doc.id);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  /** 从编辑器返回简历库：优先用后退，历史里就不会出现「库 → 编辑器 → 库」 */
  function leaveEditor() {
    if (window.ResumeEditor && window.ResumeEditor.isOpen()) window.ResumeEditor.close();
    if (editorPushed) {
      editorPushed = false;
      try { history.back(); return; } catch (e) { }
    }
    showUpload('replace');
  }

  /** 把简历库中的一份载入优化台（不复制，回写时改原文） */
  function loadDoc(doc, goWork) {
    if (!doc || !doc.model) return;
    var text = window.ResumeLib.textOf(doc.model);
    S.docId = doc.id;
    S.rawResume = text;
    S.rawJd = doc.jd || '';
    S.fileName = doc.title || doc.model.name || '简历';
    S.photo = doc.model.photo || '';
    S.srcBuf = null;
    S.srcB64 = '';
    S.srcKind = '';
    S.srcPages = 1;
    S.layout = null;
    S.layouts = null;
    S.paints = [];
    S.fit = 0;
    S.mode = 'relayout';
    S.base = window.ResumeLib.normalizeModel(clone(doc.model));
    // 预览沿用这份简历自己选的模板，避免「编辑器里是两栏，优化台里变回瑞士」
    var tplOfDoc = window.ResumeLib.template(doc.template);
    if (tplOfDoc) { S.tpl = tplOfDoc.id; S.style = tplOfDoc.base; }
    S.jd = window.JD.extract(S.rawJd);
    var built = window.Suggest.build(S.base, S.jd);
    S.suggestions = built.items;
    S.gaps = built.gaps;
    S.selected = Object.create(null);
    S.lastScore = 0;
    rebuild(true);
    syncStyleUI();
    syncUploadState();
    if (goWork !== false) showWork(2);
    persist();
    toast('已载入「' + (doc.title || (doc.model && doc.model.name ? doc.model.name + '的简历' : '未命名简历')) + '」');
  }

  /** 进入「简历优化」 */
  function showWork(step) {
    activate('optimize');
    var n = step || 2;
    setStep(n);
    syncUploadState();
    persist();
    markRoute('optimize', n);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  /** 「API 设置」 */
  function showSettings() {
    activate('settings');
    if (window.AI) {
      var fill = function () { if (window.AI.fillSettings) window.AI.fillSettings(); };
      if (window.AI.isLoaded && window.AI.isLoaded()) fill();
      else window.AI.load().then(fill).catch(function () { /* 无代理时仍可手填 Key */ });
    }
    markRoute('settings', 1);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  /** 模拟面试视图（与优化台并列，共用已上传的简历与 JD） */
  function showInterview() {
    activate('interview');
    if (window.Interview) window.Interview.enter();
    markRoute('interview', 1);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  /** 上传页上回显「当前简历」与上次进度 */
  function syncUploadState() {
    var card = $('hubCard');
    if (card) {
      card.hidden = !S.base;
      if (S.base) {
        var name = String(S.base.name || '').trim() || S.fileName || '未命名简历';
        if ($('hubName')) $('hubName').textContent = name;
        var bits = [];
        var n = String(S.rawResume || '').replace(/\s/g, '').length;
        if (n) bits.push(n + ' 字');
        if (S.jd && S.jd.title) bits.push('目标：' + S.jd.title);
        if (S.suggestions.length) bits.push(S.suggestions.length + ' 条建议');
        var adopted = Object.keys(S.selected).length;
        if (adopted) bits.push('已采纳 ' + adopted + ' 条');
        if ($('hubMeta')) $('hubMeta').textContent = bits.join(' · ') || '—';
        if ($('hubScore')) $('hubScore').textContent = S.lastScore || 0;
      }
    }

    if ($('dropResumeState')) $('dropResumeState').textContent = S.base ? '✓ ' + (S.fileName || '已载入的简历') : '';
    if ($('dropResume')) $('dropResume').classList.toggle('is-filled', !!S.base);
    if ($('dropJdState')) $('dropJdState').textContent = S.rawJd ? '✓ 已载入 JD' : '';
    if ($('dropJd')) $('dropJd').classList.toggle('is-filled', !!S.rawJd);

    if ($('srcPickState')) {
      $('srcPickState').textContent = S.base
        ? (S.fileName || '已载入简历') + ' · ' + String(S.rawResume || '').replace(/\s/g, '').length + ' 字'
        : '尚未选择简历';
      $('srcPickState').classList.toggle('is-filled', !!S.base);
    }
    if ($('srcJdState')) {
      $('srcJdState').textContent = S.rawJd
        ? '已载入 JD · ' + String(S.rawJd).replace(/\s/g, '').length + ' 字'
        : '不提供时按通用规范诊断';
      $('srcJdState').classList.toggle('is-filled', !!S.rawJd);
    }
    if ($('srcStart')) $('srcStart').disabled = !S.base;

    if (window.Interview && window.Interview.renderHub) window.Interview.renderHub();
  }

  function openExport() {
    if (!S.base) { toast('先上传一份简历，才能导出'); return; }
    docExport = null;      // 优化台的导出面板，不要沿用编辑器上下文
    $('exportSub').textContent = '已采纳 ' + adoptCount() + ' / ' + S.suggestions.length + ' 条建议 · ' + ($('scoreNow').textContent) + ' 分';
    $('exportNote').textContent = '';
    syncStyleUI();
    openOverlay('exportOverlay');
    setStep(3);
    markRoute('optimize', 3);
  }

  /* ---------------- 导出：编辑器里的当前简历 ---------------- */

  // 编辑器导出上下文：{ doc, format }。存在时导出面板作用于这份简历，而不是优化台当前稿。
  var docExport = null;

  function isDocExport() { return !!(docExport && docExport.doc); }

  /** 统一绘制六种格式的单选状态；mutedList 里的格式置灰但保留点击提示 */
  function paintFormatCards(format, mutedList) {
    document.querySelectorAll('#formatGrid .format-card').forEach(function (b) {
      var muted = !!(mutedList && mutedList.indexOf(b.dataset.format) >= 0);
      b.classList.toggle('is-muted', muted);
      b.setAttribute('aria-disabled', muted ? 'true' : 'false');
      var on = b.dataset.format === format;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }

  function openDocExport(doc) {
    if (!doc) return;
    docExport = { doc: doc, format: (docExport && docExport.format) || 'pdf' };
    var sub = $('exportSub');
    if (sub) {
      var nm = doc.title || (doc.model && doc.model.name) || '未命名简历';
      sub.textContent = '编辑器当前简历 · ' + nm;
    }
    var note = $('exportNote');
    if (note) {
      note.textContent = '导出内容与编辑器右侧预览一致：PDF / DOCX / PNG 保留当前模板版式，' +
        'Markdown 与 TXT 为纯文本，JSON 为可再次导入的存档。';
    }
    paintFormatCards(docExport.format, null);
    openOverlay('exportOverlay');
  }

  /** 离屏渲染一份未缩放的纸面，供 PDF / PNG 精确量取（不受预览 transform 影响） */
  function docPaper(doc) {
    var stage = document.createElement('div');
    stage.className = 'ed-export-stage';
    var paper = document.createElement('div');
    stage.appendChild(paper);
    document.body.appendChild(stage);
    var lib = window.ResumeLib;
    var tpl = lib.template(doc.template);
    var t = lib.renderTemplate(doc.template, doc.theme);
    window.ResumeRender.render(paper, lib.visibleModel(doc), {
      style: tpl.base, photo: !!doc.model.photo, template: t, slot: false
    });
    paper.setAttribute('data-fit', '0');
    return { stage: stage, paper: paper };
  }

  function doDocExport() {
    var doc = docExport && docExport.doc;
    if (!doc) return;
    var fmt = docExport.format || 'pdf';
    var lib = window.ResumeLib;
    var model = lib.visibleModel(doc);
    var name = (doc.title || model.name || '简历').replace(/[\\\/:*?"<>|]/g, '');

    if (fmt === 'docx') {
      var tpl = lib.template(doc.template);
      var blob = window.ResumeDocx.build(model, { style: tpl.base, photo: !!model.photo, fit: 0 });
      window.ResumeRender.download(name + '.docx', blob);
      closeOverlay('exportOverlay');
      toast('已生成 DOCX，正在下载');
      return;
    }
    if (fmt === 'md') {
      window.ResumeRender.download(name + '.md', window.ResumeRender.toMarkdown(model), 'text/markdown;charset=utf-8');
      closeOverlay('exportOverlay');
      toast('已生成 Markdown（纯文本不保留版式）');
      return;
    }
    if (fmt === 'txt') {
      window.ResumeRender.download(name + '.txt', window.ResumeRender.toPlain(model), 'text/plain;charset=utf-8');
      closeOverlay('exportOverlay');
      toast('已生成 TXT（纯文本不保留版式）');
      return;
    }
    if (fmt === 'json') {
      window.ResumeRender.download(name + '.json', JSON.stringify(doc, null, 2), 'application/json;charset=utf-8');
      closeOverlay('exportOverlay');
      toast('已导出简历 JSON，可在「我的简历」导入恢复');
      return;
    }

    // PDF / PNG：先在离屏纸面上真实排版，再量取
    var btn = $('btnDownload');
    var hint = $('exportHint');
    if (btn) btn.disabled = true;
    if (hint) hint.textContent = fmt === 'pdf' ? '正在生成 PDF…' : '正在生成图片…';
    closeOverlay('exportOverlay');

    var made = docPaper(doc);
    var done = function () {
      if (btn) btn.disabled = false;
      if (hint) hint.textContent = '';
      if (made.stage.parentNode) made.stage.parentNode.removeChild(made.stage);
    };

    var job = fmt === 'pdf'
      ? window.ResumePdf.build(made.paper, { title: model.name || '简历' }).then(function (bytes) {
        window.ResumeRender.download(name + '.pdf', new Blob([bytes], { type: 'application/pdf' }));
        toast('已生成 PDF，正在下载');
      })
      : window.ResumeRaster.toPng(made.paper, { scale: 2 }).then(function (png) {
        window.ResumeRender.download(name + '.png', png);
        toast('已生成 PNG 图片，正在下载');
      });

    job.then(done).catch(function (err) {
      done();
      console.error(err);
      toast((err && err.message) ? err.message : (fmt === 'pdf' ? 'PDF 生成失败' : 'PNG 生成失败'));
    });
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function openOverlay(id) {
    var el = document.getElementById(id);
    el.hidden = false;
    var ta = el.querySelector('textarea');
    if (ta) setTimeout(function () { ta.focus(); }, 60);
  }
  function closeOverlay(id) {
    var el = document.getElementById(id);
    if (!el || el.hidden) return;
    el.hidden = true;
    if (id === 'exportOverlay' && $('viewWork').classList.contains('is-active')) {
      setStep(2);
      replaceRoute('optimize', 2);
    }
  }

  /* ---------------- 载入 ---------------- */

  function ingest(resumeText, jdText, fileName, extra) {
    if (!resumeText || !resumeText.replace(/\s/g, '')) {
      toast('简历内容为空，请重新上传或粘贴文本');
      return;
    }
    extra = extra || {};
    S.docId = extra.docId || '';
    S.rawResume = resumeText;
    S.rawJd = jdText || '';
    S.fileName = fileName || '';
    S.photo = extra.photo || '';
    S.srcBuf = extra.srcBuf || null;
    S.srcB64 = S.srcBuf ? bufToB64(S.srcBuf) : '';
    S.srcKind = extra.kind || '';
    S.srcPages = extra.pages || 1;
    S.layouts = extra.layouts || (extra.layout ? [extra.layout] : null);
    S.layout = S.layouts && S.layouts.length ? S.layouts[0] : null;
    S.paints = extra.paints || [];
    S.fit = 0;
    // 有原始 docx → 原位替换；有 PDF 版式 → 按原版式重建；都没有 → 重新排版
    S.mode = S.layout ? 'layout' : (S.srcBuf ? 'inplace' : 'relayout');

    S.base = window.ResumeModel.parse(resumeText, { photo: S.photo, sourceKind: S.srcKind });
    S.jd = window.JD.extract(jdText || '');

    var built = window.Suggest.build(S.base, S.jd);
    S.suggestions = built.items;
    S.gaps = built.gaps;

    // 默认采纳「无事实风险」的高价值建议：仅结构/格式类
    S.selected = Object.create(null);

    S.lastScore = 0;

    rebuild(true);
    syncStyleUI();
    showWork(2);
  }

  function rebuild(animateScore) {
    S.model = clone(S.base);
    S.suggestions.forEach(function (s) {
      if (S.selected[s.id]) {
        try { s.apply(S.model); } catch (e) { /* 单条失败不影响整体 */ }
      }
    });

    // 直接改简历库中的那一份，撤销采纳即回到上一版
    if (S.docId && window.ResumeLib) {
      var linked = window.ResumeLib.get(S.docId);
      if (linked) {
        linked.model = clone(S.model);
        linked.jd = S.rawJd || '';
        try {
          window.ResumeLib.save(linked);
          window.ResumeLib.render();
        } catch (e) { /* 存储满时不阻断诊断 */ }
      }
    }

    var result = window.JD.score(S.model, S.jd);
    renderScore(result, animateScore);
    renderKeywords(result);
    renderSuggestions();
    renderGaps();
    renderPaper();
    persist();
  }

  /* ---------------- 评分 ---------------- */

  function renderScore(result, animate) {
    var target = result.total;
    var from = S.lastScore || 0;
    var el = $('scoreNow');
    var fill = $('ringFill');

    if (animate && from > 0 && from !== target) {
      var start = performance.now();
      var dur = 620;
      var tick = function (now) {
        var k = Math.min(1, (now - start) / dur);
        var e = 1 - Math.pow(1 - k, 3);
        el.textContent = Math.round(from + (target - from) * e);
        if (k < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      setTimeout(function () { el.textContent = target; }, dur + 120);
    } else {
      el.textContent = target;
    }

    fill.style.strokeDashoffset = String(326.7 * (1 - target / 100));

    var label = result.hasJd ? '人岗匹配度' : '简历健康度';
    $('scoreLabel').textContent = label;

    var desc;
    if (!result.hasJd) {
      desc = '未提供 JD，按通用规范评分。上传 JD 后可得到逐项匹配分析。';
    } else if (target >= 80) {
      desc = '与岗位要求高度吻合，重点做表述精修即可。';
    } else if (target >= 65) {
      desc = '基本对口，关键词与量化表达还有提升空间。';
    } else if (target >= 45) {
      desc = '方向相关但覆盖不足，建议按建议逐条补齐核心要求。';
    } else {
      desc = '与 JD 的显性要求差距明显，优先补齐关键词与经历描述。';
    }
    if (result.gate && result.gate.notes.length) {
      desc += ' ' + result.gate.notes.join('；') + '。';
    }
    $('scoreLine').textContent = desc;

    var html = Object.keys(result.modules).map(function (k) {
      var v = result.modules[k];
      return '<li><span>' + k + '</span><span class="bar"><i style="width:' + v + '%"></i></span><span class="val">' + v + '</span></li>';
    }).join('');
    $('moduleBars').innerHTML = html;

    S.lastScore = target;
    if ($('hubScore')) $('hubScore').textContent = target;
  }

  function renderKeywords(result) {
    var box = $('kwList');
    var kw = result.keywords;
    if (!kw.all.length) {
      box.innerHTML = '<span class="kw">未上传 JD · 无关键词分析</span>';
      $('kwCount').textContent = '—';
      return;
    }
    $('kwCount').textContent = kw.matched.length + ' / ' + kw.all.length + ' 命中';
    var all = kw.all.slice();
    all.sort(function (a, b) { return (b.w - a.w) || 0; });
    box.innerHTML = all.slice(0, 20).map(function (k) {
      var hit = window.JD.has(window.ResumeModel.toText(S.model), k.k);
      return '<span class="kw ' + (hit ? 'hit' : 'miss') + (k.must ? ' must' : '') + '">' +
        '<i class="dot"></i>' + window.ResumeRender.esc(k.k) +
        (k.must ? '<em class="kw-must">必</em>' : '') + '</span>';
    }).join('');
  }

  /* ---------------- 建议列表 ---------------- */

  // 「保留原版式」只能改文字，这几类要移动/新增段落，原位改写时不会生效
  var STRUCTURAL_IDS = /^(order-sec|skill-order|summary-add|intent-add|skill-add)$/;

  function card(s) {
    var on = !!S.selected[s.id];
    var bodyBefore = window.ResumeRender.esc(s.before).replace(/\n/g, '<br/>');
    var bodyAfter = window.ResumeRender.esc(s.after).replace(/\n/g, '<br/>');
    var skip = (S.mode === 'inplace' || S.mode === 'layout') && STRUCTURAL_IDS.test(s.id);
    var skipNote = S.mode === 'layout'
      ? '当前是「保留原版式」：这条要新增或移动整段，只在切换到预览上方的模板时生效。'
      : '当前是「保留原版式」导出：这条要移动或新增段落，只在切换到预览上方的模板时生效。';
    return '<div class="sg' + (on ? ' is-on' : '') + '" data-id="' + s.id + '">' +
      '<button class="sg-check" data-toggle="' + s.id + '" aria-label="采纳该建议" aria-pressed="' + on + '"></button>' +
      '<div class="sg-main">' +
        '<div class="sg-top">' +
          '<span class="sg-sev" data-sev="' + s.severity + '"></span>' +
          '<span class="sg-tag">' + s.group + '</span>' +
          (s.ai ? '<span class="sg-tag sg-tag-ai">AI</span>' : '') +
          '<span class="sg-title">' + window.ResumeRender.esc(s.title) + '</span>' +
          '<span class="sg-applied">已采纳</span>' +
        '</div>' +
        '<p class="sg-why">' + window.ResumeRender.esc(s.why) + '</p>' +
        '<div class="sg-diff">' +
          '<div class="sg-cell before"><span class="lbl">原文</span><span class="txt">' + bodyBefore + '</span></div>' +
          '<div class="sg-cell after"><span class="lbl">改为</span><span class="txt">' + bodyAfter + '</span></div>' +
        '</div>' +
        (s.note ? '<p class="sg-note">' + window.ResumeRender.esc(s.note) + '</p>' : '') +
        (skip ? '<p class="sg-note">' + skipNote + '</p>' : '') +
      '</div>' +
    '</div>';
  }

  function renderSuggestions() {
    var list = $('suggestList');
    var items = S.suggestions.filter(function (s) { return S.filter === 'all' || s.group === S.filter; });
    list.innerHTML = items.length
      ? items.map(card).join('')
      : '<div class="sg" style="grid-template-columns:1fr"><div class="sg-main"><p class="sg-why" style="margin:0">该分类下没有可自动修改的条目。</p></div></div>';

    var n = S.suggestions.filter(function (s) { return S.selected[s.id]; }).length;
    $('adoptCount').textContent = '已采纳 ' + n + ' / ' + S.suggestions.length;
  }

  function renderGaps() {
    var block = $('gapBlock');
    if (!S.gaps.length) { block.hidden = true; return; }
    block.hidden = false;
    $('gapList').innerHTML = S.gaps.map(function (g) {
      return '<li><b>' + window.ResumeRender.esc(g.t) + '</b><span class="gap-ask">' + window.ResumeRender.esc(g.d) + '</span></li>';
    }).join('');
  }

  /* ---------------- 预览 ---------------- */

  var A4_H = 1123;   // 96dpi 下 A4 的高度（px）

  /** 纸张内容超出 A4 的像素数（>0 表示超页） */
  function overflowPx(paper) {
    // 严格判定：内容高度必须 <= A4_H，不留 1px 容差，避免预览多出一像素
    return paper.scrollHeight - A4_H;
  }

  /** 模板排版：装不下就逐级压紧（字号最多缩到 8.7pt，仍远高于可读下限） */
  function fitOnePage(paper) {
    var lv = 0;
    paper.setAttribute('data-fit', '0');
    while (lv < 5 && overflowPx(paper) > 0) {
      lv++;
      paper.setAttribute('data-fit', String(lv));
    }
    S.fit = lv;
    return overflowPx(paper) <= 0;
  }

  /**
   * 内容级收敛：超页时裁掉价值最低的内容，直到落进一页。
   * 注意：裁剪发生在 S.fitModel（渲染副本）上，S.model 始终保持完整，
   * 用户取消勾选建议后可以完整恢复。
   */
  function convergeToOnePage(paper) {
    var guard = 0;
    var trimmed = 0;
    while (overflowPx(paper) > 0 && guard++ < 240) {
      var cut = window.ResumeOnePage.trimOnce(S.fitModel);
      if (!cut) break;
      trimmed++;
      window.ResumeRender.render(paper, S.fitModel, { style: S.style, photo: true, template: currentTemplate() });
      fitOnePage(paper);
    }
    S.trimmed = trimmed;
    return trimmed;
  }

  /**
   * 把版面收紧到刚好装进一页。
   *
   * 关键：shrink() 是**幂等**的（相对自然基线按系数重算，不是在已压缩值上再乘），
   * 所以这里可以对系数 k 做二分搜索，找到「刚好装下」的最大 k —— 既不会压扁版面，
   * 也不会出现多次调用累乘导致的过度压缩。
   */
  function squeezeToFit(paper) {
    if (overflowPx(paper) <= 0) return;

    var lo = 0.8, hi = 1.0;            // lo: 保证装得下；hi: 装不下
    var guard = 0;
    while (guard++ < 8) {
      var mid = (lo + hi) / 2;
      window.ResumeLayout.shrink(S.flow, mid);
      window.ResumeRender.renderFlow(paper, S.flow);
      if (overflowPx(paper) > 0) hi = mid; else lo = mid;
    }
    window.ResumeLayout.shrink(S.flow, lo);
    window.ResumeRender.renderFlow(paper, S.flow);
  }

  /**
   * 原版式模式的一页收敛。
   * 原则（与用户诉求一致）：
   *   ① 优先保住内容 —— 只有「轻微收紧行距也救不回来」时才裁内容；
   *   ② 裁内容按价值排序，裁低价值要点，不动核心经历；
   *   ③ 版面收紧是幂等的，不会出现「反复相乘把版面压扁」；
   *   ④ 最终必须落在一页内 —— 兜底走轻微缩字号。
   */
  function convergeLayout(paper) {
    var trimmed = 0, tguard = 0;

    // 当前版面在「行距最多收紧 10%」的前提下能省下多少 px
    function squeezeRoomPx() {
      var slack = 0;
      (S.flow.lines || []).forEach(function (l) {
        var base = l.baseLineH != null ? l.baseLineH : l.lineH;
        var floor = l.size * 1.16;
        slack += Math.max(0, base - floor) + (l.baseGap != null ? l.baseGap : (l.gapBefore || 0));
      });
      return slack * 4 / 3 * 0.10;
    }

    // ① 内容级裁剪：溢出量大到收紧行距也救不回来时才动内容
    while (overflowPx(paper) > 0 && tguard++ < 400) {
      if (overflowPx(paper) <= squeezeRoomPx()) break;   // 轻微超页 → 留给行距收紧
      var cut = window.ResumeOnePage.trimOnce(S.fitModel);
      if (!cut) break;                                    // 内容已无可裁
      trimmed++;
      S.flow = buildFlowFor(S.fitModel);
      window.ResumeRender.renderFlow(paper, S.flow);
    }

    // ② 版面收紧：二分找到「刚好装下」的行距系数
    squeezeToFit(paper);

    // ③ 兜底：内容裁不动、行距也收不动 → 轻微缩字号，保证恒定一页
    var fg = 0;
    while (overflowPx(paper) > 0 && fg++ < 14) {
      window.ResumeLayout.scaleFont(S.flow, 0.97);
      window.ResumeRender.renderFlow(paper, S.flow);
    }

    S.trimmed = trimmed;
  }

  function pageLabel() {
    if (S.mode === 'layout') {
      if (S.paintSpec) {
        var n = S.paintSpec.stitched || (S.paintSpec.pages || []).length;
        var ps = 'A4 · 1 页 · 原版式照搬';
        if (n > 1) ps += ' · 原件 ' + n + ' 页已并入 1 页';
        return ps;
      }
      var s = 'A4 · 1 页';
      if (trimmedCount()) s += ' · 已精简 ' + trimmedCount() + ' 处';
      var fit = S.flow ? S.flow.fit : 1;
      if (fit < 0.995) s += ' · 行距已收紧 ' + Math.round((1 - fit) * 100) + '%';
      var fs = S.flow ? (S.flow.fontScale || 1) : 1;
      if (fs < 0.995) s += ' · 字号已微调 ' + Math.round((1 - fs) * 100) + '%';
      return s;
    }
    var s2 = 'A4 · 1 页';
    if (trimmedCount()) s2 += ' · 已精简 ' + trimmedCount() + ' 处';
    if (S.fit) s2 += ' · 已压紧 ' + S.fit + ' 档';
    return s2;
  }

  function trimmedCount() { return S.trimmed || 0; }

  function setPageLabel() {
    var el = $('previewPages');
    el.textContent = pageLabel();
    el.classList.remove('is-over');
    // 渲染是异步的（要等 paint 提取完），所以失败提示要在这里补一次，
    // 否则 syncStyleUI 早就跑过去了，用户只看到一份「不知为何不一样」的简历。
    var hint = $('previewHint');
    if (hint && S.mode === 'layout') {
      hint.textContent = S.paintFail
        ? '⚠ 原版式还原没成功（' + S.paintFail + '），当前显示的是临时重建的近似版式。'
        : '「保留原版式」是把原 PDF 的绘制指令原样搬回来：色块、分隔线、字号、颜色、字体、多列并排、证件照都按原坐标还原，只把文字换掉。';
    }
  }

  /** 按当前模式生成排版规格
   *  · 原文件版式（PDF）-> 逐行照搬原文档（含全部页面），只替换文字
   *  · 原文件是 DOCX     -> 原位替换文字（inplace 分支，不走这里）
   */
  function buildFlowFor(mdl) {
    var lays = (S.layouts && S.layouts.length) ? S.layouts : (S.layout ? [S.layout] : null);
    if (!lays) return null;
    return window.ResumeLayout.buildFlow(lays, window.ResumeInplace.collectOps(S.base, mdl));
  }

  /**
   * 「保留原版式」：按 PDF 的绘制原语原样还原，只把文字换掉。
   * 灰底通栏、标题左侧黑竖条、中英文双色双字号、三列并排、照片原位全部保留。
   */
  function buildPaintFor(mdl) {
    var paints = S.paints || [];
    S.paintFail = '';
    if (!paints.length) { S.paintFail = '未提取到绘制原语'; return null; }
    try {
      var ops = window.ResumeInplace.collectOps(S.base, mdl);

      // 校验必须在缝合之前做：stitch 会主动删掉一部分行来压成一页，
      // 拿缝合后的字符数去比，正常简历也会被判成「文字没取到」。
      var rawChars = 0;
      paints.forEach(function (pg) {
        (pg.runs || []).forEach(function (r) { rawChars += (r.text || '').length; });
      });
      var lineChars = 0;
      (S.layouts || []).forEach(function (l) {
        (l.lines || []).forEach(function (x) { lineChars += (x.text || '').length; });
      });
      if (!rawChars) { S.paintFail = '绘制指令里没有文字（可能是扫描件）'; return null; }
      if (lineChars > 60 && rawChars < lineChars * 0.5) {
        S.paintFail = '文字只取到 ' + rawChars + '/' + lineChars + ' 字符';
        return null;
      }

      // 多页原件：先跨页缝合、再整行删到一页（只删内容，不动任何版式参数）
      var merged = window.ResumePaintDoc.stitch(paints);
      var spec = window.ResumePaintDoc.build(merged, ops);
      spec.stitched = (merged[0] && merged[0].stitched) || 1;
      spec.removedRows = (merged[0] && merged[0].removedRows) || 0;
      return spec;
    } catch (e) {
      S.paintFail = '还原失败：' + ((e && e.message) || e);
      return null;
    }
  }

  /** 预览所用的模板：从简历库来的文档沿用它在编辑器里选的模板 */
  function currentTemplate() {
    if (!S.docId || !window.ResumeLib) return null;
    var d = window.ResumeLib.get(S.docId);
    if (!d || !d.template) return null;
    try {
      return window.ResumeLib.renderTemplate(d.template, d.theme);
    } catch (e) {
      return null;
    }
  }

  function renderPaper() {
    var paper = $('paper');

    // 渲染副本：内容级裁剪只作用在它上面，S.model 保持完整
    S.fitModel = clone(S.model);
    S.trimmed = 0;

    if (S.mode === 'layout' && S.layout) {
      // 首选：绘制原语照搬（真正保留原版式）
      var pspec = buildPaintFor(S.fitModel);
      if (pspec) {
        S.paintSpec = pspec;
        S.flow = null;
        window.ResumeRender.renderPaint(paper, pspec);
        paper.setAttribute('data-fit', '0');
        requestAnimationFrame(function () {
          window.ResumeRender.fit($('paperScale'), paper, $('paperShell'));
          setPageLabel();
        });
        return;
      }

      S.flow = buildFlowFor(S.fitModel);
      window.ResumeRender.renderFlow(paper, S.flow);
      paper.setAttribute('data-fit', '0');

      // 注意：必须等预览区真正可见后再量高度（载入时工作区还没显示，
      // scrollHeight 会是 0，收敛逻辑会被整体跳过）
      requestAnimationFrame(function () {
        convergeLayout(paper);
        window.ResumeRender.fit($('paperScale'), paper, $('paperShell'));
        setPageLabel();
      });
      return;
    }

    window.ResumeRender.render(paper, S.fitModel, { style: S.style, photo: true, template: currentTemplate() });
    requestAnimationFrame(function () {
      fitOnePage(paper);
      convergeToOnePage(paper);
      window.ResumeRender.fit($('paperScale'), paper, $('paperShell'));
      setPageLabel();
    });
  }

  /* ---------------- 导出 ---------------- */

  function adoptCount() { return S.suggestions.filter(function (s) { return S.selected[s.id]; }).length; }

  function fileBase() {
    var n = (S.model && S.model.name ? S.model.name : '简历').replace(/[\\\/:*?"<>|]/g, '');
    var intent = S.model && S.model.intent ? '-' + S.model.intent : '';
    return n + intent + '-优化版';
  }

  function doExport() {
    if (!S.model) return;
    var base = fileBase();
    var mdl = S.fitModel || S.model;      // 渲染副本：与预览完全一致（含一页收敛后的内容）

    // ---- 保留原版式：在原文件上原位替换文字 ----
    if (S.mode === 'inplace') {
      if (!S.srcBuf) {
        toast('原文件已不在内存中，请重新上传原简历后再用「保留原版式」导出');
        return;
      }
      var btn = $('btnDownload');
      btn.disabled = true;
      $('exportHint').textContent = '正在原文件上替换文字…';
      window.ResumeInplace.build(S.base, S.model, S.srcBuf).then(function (r) {
        $('exportHint').textContent = '';
        btn.disabled = false;
        window.ResumeRender.download(base + '.docx', r.blob);
        if (r.missing.length) {
          toast('已替换 ' + r.applied + ' 处；' + r.missing.length + ' 处在原文件中未定位到，未改动');
        } else {
          toast('已生成：原版式保留，共替换 ' + r.applied + ' 处文字');
        }
      }).catch(function (err) {
        $('exportHint').textContent = '';
        btn.disabled = false;
        toast(err && err.message ? err.message : '原版式导出失败');
      });
      return;
    }

    // ---- 按原版式重建：PDF 来源（照抄原文件版式参数，只换文字）----
    if (S.mode === 'layout') {
      // 首选：绘制原语照搬（预览看到什么，导出就是什么）
      var pspec = buildPaintFor(mdl);
      if (!S.flow && !pspec) S.flow = buildFlowFor(mdl);
      if (S.format === 'docx') {
        var blobL = pspec ? window.ResumeDocxLayout.buildPaint(pspec) : window.ResumeDocxLayout.build(S.flow);
        if (!blobL) blobL = window.ResumeDocxLayout.build(buildFlowFor(mdl));
        window.ResumeRender.download(base + '.docx', blobL);
        toast('已生成 DOCX：沿用原文件版式，1 页');
      } else if (S.format === 'pdf') {
        exportPdf(base);
      } else if (S.format === 'png') {
        exportPng(base);
      } else if (S.format === 'json') {
        exportJson(base);
      } else if (S.format === 'md') {
        window.ResumeRender.download(base + '.md', window.ResumeRender.toMarkdown(mdl), 'text/markdown;charset=utf-8');
        toast('已生成 Markdown（纯文本不保留版式）');
      } else {
        window.ResumeRender.download(base + '.txt', window.ResumeRender.toPlain(mdl), 'text/plain;charset=utf-8');
        toast('已生成 TXT（纯文本不保留版式）');
      }
      return;
    }

    // ---- 重新排版（套用所选模板）----
    if (S.format === 'docx') {
      var blob = window.ResumeDocx.build(mdl, { style: S.style, photo: !!mdl.photo, fit: S.fit });
      window.ResumeRender.download(base + '.docx', blob);
      toast('已生成 DOCX，正在下载');
    } else if (S.format === 'pdf') {
      exportPdf(base);
    } else if (S.format === 'png') {
      exportPng(base);
    } else if (S.format === 'json') {
      exportJson(base);
    } else if (S.format === 'md') {
      window.ResumeRender.download(base + '.md', window.ResumeRender.toMarkdown(mdl), 'text/markdown;charset=utf-8');
      toast('已生成 Markdown');
    } else {
      window.ResumeRender.download(base + '.txt', window.ResumeRender.toPlain(mdl), 'text/plain;charset=utf-8');
      toast('已生成 TXT');
    }
  }

  /** 导出 PDF：把当前预览的成稿 DOM 直接写成矢量 PDF 并下载，不跳打印界面 */
  function exportPdf(base) {
    var btn = $('btnDownload');
    var hint = $('exportHint');
    closeOverlay('exportOverlay');
    if (btn) btn.disabled = true;
    if (hint) hint.textContent = '正在生成 PDF…';
    var paper = $('paper');
    window.ResumePdf.build(paper, { title: (S.model && S.model.name) || '简历' }).then(function (bytes) {
      if (btn) btn.disabled = false;
      if (hint) hint.textContent = '';
      window.ResumeRender.download(base + '.pdf', new Blob([bytes], { type: 'application/pdf' }));
      toast('已生成 PDF，正在下载');
    }).catch(function (err) {
      if (btn) btn.disabled = false;
      if (hint) hint.textContent = '';
      console.error(err);
      toast((err && err.message) ? err.message : 'PDF 生成失败');
    });
  }

  /** 导出 PNG：把当前预览的成稿渲染成一张高清图片 */
  function exportPng(base) {
    var btn = $('btnDownload');
    var hint = $('exportHint');
    closeOverlay('exportOverlay');
    if (btn) btn.disabled = true;
    if (hint) hint.textContent = '正在生成图片…';
    window.ResumeRaster.toPng($('paper'), { scale: 2 }).then(function (blob) {
      if (btn) btn.disabled = false;
      if (hint) hint.textContent = '';
      window.ResumeRender.download(base + '.png', blob);
      toast('已生成 PNG 图片，正在下载');
    }).catch(function (err) {
      if (btn) btn.disabled = false;
      if (hint) hint.textContent = '';
      console.error(err);
      toast((err && err.message) ? err.message : 'PNG 生成失败');
    });
  }

  /** 导出 JSON 存档：可再次导入，无损恢复当前进度 */
  function exportJson(base) {
    var json = JSON.stringify(buildArchive(), null, 2);
    window.ResumeRender.download(base + '.json', json, 'application/json;charset=utf-8');
    toast('已导出 JSON 存档，可在新设备导入恢复');
  }

  /* ---------------- 导出：JSON 存档 ---------------- */

  /**
   * 把当前会话打包成 JSON 存档。
   * 内容与浏览器本地存储同构 —— 这样「导出存档 → 换设备导入」能无损还原。
   */
  function buildArchive() {
    return {
      app: 'resume-polisher',
      version: 1,
      exportedAt: new Date().toISOString(),
      r: S.rawResume || '',
      j: S.rawJd || '',
      n: S.fileName || '',
      sel: Object.keys(S.selected),
      style: S.style,
      tpl: S.tpl,
      format: S.format,
      mode: S.mode,
      photo: S.photo || '',
      lay: stripPaint(S.layout),
      lays: stripPaint(S.layouts),
      paints: S.paints || [],
      sb: (S.srcBuf && S.srcBuf.byteLength <= 1500000) ? S.srcB64 : ''
    };
  }

  /** 导入 JSON 存档：还原原文、JD、已采纳建议与版式设置 */
  function importArchive(text) {
    var d;
    try { d = JSON.parse(text); } catch (e) { throw new Error('这不是有效的 JSON 存档文件'); }
    if (!d || (d.app && d.app !== 'resume-polisher') || !d.r) {
      throw new Error('这不是简历精修导出的存档文件');
    }
    var extra = { photo: d.photo || '', srcBuf: null, kind: '', layout: d.lay || null, layouts: d.lays || null, paints: d.paints || [] };
    if (d.sb) {
      try { extra.srcBuf = b64ToBuf(d.sb); extra.kind = 'docx'; } catch (e) { extra.srcBuf = null; }
    }
    if (d.style) S.style = d.style;
    if (d.tpl) S.tpl = d.tpl;
    if (d.format) S.format = d.format;
    ingest(d.r || '', d.j || '', d.n || '存档.json', extra);
    // 已采纳的建议要重新勾上（ingest 会重置 selected）
    (d.sel || []).forEach(function (id) { S.selected[id] = true; });
    // 还原用户当时选的版式模式；「原位改写」依赖原 DOCX，缺原件时保持 ingest 判定
    if (d.mode === 'relayout' || d.mode === 'layout') S.mode = d.mode;
    rebuild(false);
    syncStyleUI();
    persist();
  }

  /* ---------------- 持久化 ---------------- */

  function bufToB64(buf) {
    var u8 = new Uint8Array(buf), out = '', CH = 0x8000;
    for (var i = 0; i < u8.length; i += CH) {
      out += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    }
    return out ? btoa(out) : '';
  }

  /**
   * 版式里带着「绘制原语」（含证件照的 base64），体积很大。
   * 存档 / 本地存储里不放它 —— 否则 localStorage 配额会被一张照片顶爆。
   */
  function stripPaint(lays) {
    if (!lays) return lays;
    var list = Array.isArray(lays) ? lays : [lays];
    return list.map(function (l) {
      if (!l || typeof l !== 'object') return l;
      var o = {};
      Object.keys(l).forEach(function (k) { if (k !== 'paint') o[k] = l[k]; });
      return o;
    });
  }

  function b64ToBuf(b64) {
    var bin = atob(b64), u8 = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8.buffer;
  }

  function writeStore(s) {
    var ok = true;
    try { localStorage.setItem(STORE_KEY, s); } catch (e) { ok = false; }
    try { sessionStorage.setItem(STORE_KEY, s); } catch (e2) { /* 隐私模式忽略 */ }
    return ok;
  }

  function readStore() {
    var v = null;
    try { v = localStorage.getItem(STORE_KEY); } catch (e) {}
    if (!v) { try { v = sessionStorage.getItem(STORE_KEY); } catch (e2) {} }
    if (!v) return null;
    try { return JSON.parse(v); } catch (e3) { return null; }
  }

  function persist() {
    var data = {
      r: S.rawResume, j: S.rawJd, n: S.fileName,
      doc: S.docId || '',
      sel: Object.keys(S.selected), style: S.style, tpl: S.tpl, format: S.format,
      mode: S.mode, step: S.step,
      photo: S.photo || '',
      lay: stripPaint(S.layout),
      lays: stripPaint(S.layouts),
      paints: S.paints || [],
      sb: (S.srcBuf && S.srcBuf.byteLength <= 1500000) ? S.srcB64 : ''
    };
    if (!writeStore(JSON.stringify(data))) {
      // 超出配额时退回：不带照片与原文件，至少保住文本与进度
      data.photo = '';
      data.sb = '';
      if (!writeStore(JSON.stringify(data))) {
        // 还超就丢掉绘制原语（体量最大），文字与进度优先
        data.paints = [];
        writeStore(JSON.stringify(data));
      }
    }
  }

  function restore() {
    try {
      var d = readStore();
      if (!d || !d.r) return false;
      S.style = d.style || 'swiss';
      S.tpl = d.tpl || S.style;
      S.format = d.format || 'pdf';
      var extra = { docId: d.doc || '', photo: d.photo || '', srcBuf: null, kind: '', layout: d.lay || null, layouts: d.lays || null, paints: d.paints || [] };
      if (d.sb) {
        try { extra.srcBuf = b64ToBuf(d.sb); extra.kind = 'docx'; } catch (e) { extra.srcBuf = null; }
      }
      ingest(d.r, d.j, d.n, extra);
      // ingest 会按文件类型自动选一次模式；这里恢复用户上次真正选的那个
      if (d.mode === 'relayout') {
        S.mode = 'relayout';
      } else if (d.mode === 'layout' && S.layout) {
        S.mode = 'layout';
      } else if (d.mode === 'inplace' && extra.srcBuf) {
        S.mode = 'inplace';
      }
      (d.sel || []).forEach(function (id) { S.selected[id] = true; });
      syncStyleUI();
      rebuild(false);
      if (d.step === 1) showUpload();
      else if (d.mode === 'inplace' && !extra.srcBuf) {
        setTimeout(function () { toast('已恢复上次内容；原文件未保留，重新上传原件才能用「保留原版式」'); }, 400);
      }
      return true;
    } catch (e) { return false; }
  }

  function reset() {
    try { localStorage.removeItem(STORE_KEY); } catch (e) {}
    S.rawResume = ''; S.rawJd = ''; S.base = null; S.model = null;
    S.suggestions = []; S.gaps = []; S.selected = Object.create(null); S.lastScore = 0;
    S.photo = ''; S.srcBuf = null; S.srcKind = ''; S.mode = 'relayout';
    S.srcB64 = ''; S.docId = '';
    S.layout = null; S.layouts = null; S.flow = null; S.fit = 0;
    if ($('fileResume')) $('fileResume').value = '';
    if ($('fileJd')) $('fileJd').value = '';
    activate('resume');
    setStep(1);
    syncUploadState();
  }

  /**
   * 预览区风格切换的四个选项：
   *   swiss / classic / academic —— 三套预设模板（重新排版）
   *   origin                      —— 保留原版式（沿用上传文件的版式，只换文字）
   * 「保留原版式」是否可用，取决于有没有原始文件（PDF 版式参数 / DOCX 原件）。
   */
  function hasOrigin() {
    return !!(S.layout || S.srcBuf);
  }

  /** 模板中心：应用一套模板（预设或自定义），立即重排预览 */
  function applyTemplate(t) {
    if (!t) return;
    S.tpl = t.id;
    S.style = t.base || 'swiss';
    S.mode = 'relayout';
    syncStyleUI();
    renderSuggestions();
    renderPaper();
    persist();
  }

  function syncStyleUI() {
    // 模板按钮高亮：处于「重新排版」时高亮对应模板
    document.querySelectorAll('#styleSeg .seg-btn').forEach(function (b) {
      var isOrigin = b.dataset.style === 'origin';
      var active = isOrigin
        ? (S.mode !== 'relayout')
        : (S.mode === 'relayout' && b.dataset.style === S.tpl);
      b.classList.toggle('is-active', active);
      // 没有原始文件时「保留原版式」不可用
      b.classList.toggle('is-muted', isOrigin && !hasOrigin());
      b.disabled = isOrigin && !hasOrigin();
    });

    // 从简历库载入的文档：模板在编辑器里选，这里只显示用的是哪套
    var linked = (S.docId && window.ResumeLib) ? window.ResumeLib.get(S.docId) : null;
    var pt = $('previewTpl');
    if (pt) {
      pt.hidden = !linked;
      if (linked) pt.textContent = '模板 · ' + window.ResumeLib.template(linked.template).name;
    }
    if ($('btnTemplates')) $('btnTemplates').hidden = !!linked;
    if ($('styleSeg')) $('styleSeg').hidden = !!linked;
    // DOCX 原位改写只能输出 DOCX；其余格式均可用
    if (S.mode === 'inplace' && S.format !== 'docx') S.format = 'docx';
    paintFormatCards(S.format, S.mode === 'inplace' ? ['pdf', 'png', 'md', 'txt', 'json'] : null);
    $('previewHint').hidden = (S.mode === 'relayout');

    var note;
    if (S.mode === 'inplace') {
      note = S.srcBuf
        ? '在原文件上直接替换文字：段落格式、字体、行距、分栏、页边距与照片全部不动。仅输出 DOCX，可用 Word 另存为 PDF。'
        : '当前内容来自粘贴或 PDF，没有原始 DOCX，无法原位改写，将按模板重排。';
    } else if (S.mode === 'layout') {
      note = '按原 PDF 的绘制指令原样还原：灰底通栏、标题竖条、双色标题、多列并排、证件照全部按原坐标贴回，只替换文字。';
    } else {
      note = '按预览上方选定的模板重新生成一份版式，原排版不再保留。';
    }
    $('exportNote').textContent = (S.mode === 'inplace' || S.mode === 'layout')
      ? note + ' 导出 PDF / PNG 与预览完全一致；Markdown 与 TXT 为纯文本，不保留版式。'
      : note + ' 导出 PDF / PNG 与预览完全一致；Markdown 与 TXT 为纯文本，不保留版式。';
    $('previewHint').textContent = S.mode === 'layout'
      ? (S.paintFail
        ? '⚠ 原版式还原没成功（' + S.paintFail + '），当前是临时重建的近似版式。请把这行提示告诉开发者。'
        : '「保留原版式」是把原 PDF 的绘制指令原样搬回来：色块、分隔线、字号、颜色、字体、多列并排、证件照都按原坐标还原，只把文字换掉。')
      : '「保留原版式」只替换文字，不移动、不重排任何元素：照片、表格、分栏、页眉页脚都原样保留。';
    if (window.Templates) window.Templates.syncLabel();
  }

  /* ---------------- 文件处理 ---------------- */

  function handleFile(kind, file) {
    if (!file) return;
    var stateEl = kind === 'resume' ? $('dropResumeState') : $('dropJdState');
    var dropEl = kind === 'resume' ? $('dropResume') : $('dropJd');
    if (stateEl) stateEl.textContent = '解析中…';

    window.ResumeParse.readFile(file).then(function (res) {
      if (stateEl) stateEl.textContent = '✓' + (file.name || '已读取') + '（' + res.text.replace(/\s/g, '').length + ' 字）';
      if (dropEl) dropEl.classList.add('is-filled');

      if (kind === 'resume') {
        S.rawResume = res.text;
        var docId = '';
        // 上传即入简历库：之后在优化台采纳的建议会直接改这一份
        if (window.ResumeLib) {
          try {
            var model = window.ResumeModel.parse(res.text, { photo: res.photo || '', sourceKind: res.kind || '' });
            var doc = window.ResumeLib.fromParsed(model, {
              title: model.name ? model.name + '的简历' : (String(file.name || '').replace(/\.[^.]+$/, '') || '我的简历')
            });
            window.ResumeLib.save(doc);
            window.ResumeLib.render();
            docId = doc.id;
          } catch (e) { /* 入库失败仍可继续诊断 */ }
        }
        ingest(S.rawResume, S.rawJd, file.name, { docId: docId, photo: res.photo, srcBuf: res.srcBuf, kind: res.kind, layout: res.layout, layouts: res.layouts, paints: res.paints, pages: res.pages });
        if (res.photo) toast('已从文件中提取到证件照，导出时会保留');
        else if (res.layout) toast('已读取原 PDF 版式（页边距 / 字号 / 行距 / 分隔线）');
      } else {
        S.rawJd = res.text;
        if (S.rawResume) ingest(S.rawResume, S.rawJd, S.fileName, { docId: S.docId, photo: S.photo, srcBuf: S.srcBuf, kind: S.srcKind, layout: S.layout, layouts: S.layouts, paints: S.paints, pages: S.srcPages });
        else { toast('JD 已就绪，再上传简历即可开始'); syncUploadState(); }
      }
    }).catch(function (err) {
      if (stateEl) stateEl.textContent = '';
      if (dropEl) dropEl.classList.remove('is-filled');
      toast(err && err.message ? err.message : '文件解析失败');
    });
  }

  /* ---------------- 事件绑定 ---------------- */

  /** 左侧功能栏 / 页面内快捷跳转（data-view 只出现在导航与快捷按钮上）
   *  单独绑定：即使后续某个模块的元素缺失、初始抛错，四个导航入口也始终可用 */
  function bindNav() {
    if (bindNav.done) return;
    bindNav.done = true;
    document.addEventListener('click', function (e) {
      var t = e.target.closest && e.target.closest('[data-view]');
      if (!t) return;
      var name = t.dataset.view;
      if (!VIEW_META[name]) return;
      if (t.tagName === 'A') e.preventDefault();
      // 切页时收起所有弹层：不让上一个模块的遮罩留在页面上
      closeAllOverlays();
      if (name === 'resume') {
        // 编辑器里点「我的简历」：用后退回库，不额外压一条历史
        if (CURRENT_ROUTE.rp === 'editor') { leaveEditor(); return; }
        showUpload(); return;
      }
      if (name === 'optimize') {
        // 左侧入口永远先到 01 步（选简历 + JD），再让用户点「开始诊断」
        showWork(1); return;
      }
      if (name === 'settings') { showSettings(); return; }
      if (name === 'interview') { showInterview(); return; }
    });
  }

  /** 收起所有打开的弹层（含简历库自己创建的） */
  function closeAllOverlays() {
    Array.prototype.forEach.call(document.querySelectorAll('.overlay'), function (o) {
      if (!o.hidden) {
        try { closeOverlay(o.id); } catch (err) { o.hidden = true; }
      }
    });
  }

  function bind() {
    bindNav();
    // 上传（简历库与优化台共用这两个隐藏输入）
    ['resume', 'jd'].forEach(function (kind) {
      var drop = kind === 'resume' ? $('dropResume') : $('dropJd');
      var input = kind === 'resume' ? $('fileResume') : $('fileJd');
      if (!input) return;

      input.addEventListener('change', function () {
        handleFile(kind, input.files && input.files[0]);
        input.value = '';
      });

      if (!drop) return;
      drop.addEventListener('click', function (e) {
        if (e.target.closest('input')) return;
        input.click();
      });

      ['dragenter', 'dragover'].forEach(function (ev) {
        drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('is-over'); });
      });
      ['dragleave', 'drop'].forEach(function (ev) {
        drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('is-over'); });
      });
      drop.addEventListener('drop', function (e) {
        var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) handleFile(kind, f);
      });
    });

    window.addEventListener('dragover', function (e) { e.preventDefault(); });
    window.addEventListener('drop', function (e) { e.preventDefault(); });

    // 粘贴
    function openPaste() {
      $('taResume').value = S.rawResume || '';
      $('taJd').value = S.rawJd || '';
      openOverlay('pasteOverlay');
    }
    if ($('btnPaste')) $('btnPaste').addEventListener('click', openPaste);
    if ($('srcPaste')) $('srcPaste').addEventListener('click', openPaste);
    if ($('srcJdPaste')) $('srcJdPaste').addEventListener('click', openPaste);
    if ($('btnEditRaw')) $('btnEditRaw').addEventListener('click', function () {
      // 从简历库来的文档：直接进可视化编辑器，而不是弹粘贴框
      if (S.docId) {
        if (window.App && window.App.openEditor) window.App.openEditor(S.docId);
        return;
      }
      openPaste();
    });

    $('btnPasteConfirm').addEventListener('click', function () {
      var r = $('taResume').value;
      var j = $('taJd').value;
      if (!r.replace(/\s/g, '')) { $('pasteHint').textContent = '请先粘贴简历原文'; return; }
      $('pasteHint').textContent = '';
      closeOverlay('pasteOverlay');
      var docId = '';
      if (window.ResumeLib) {
        try {
          var model = window.ResumeModel.parse(r, {});
          var doc = window.ResumeLib.fromParsed(model, {
            title: model.name ? model.name + '的简历' : '粘贴的简历'
          });
          window.ResumeLib.save(doc);
          window.ResumeLib.render();
          docId = doc.id;
        } catch (e) {}
      }
      ingest(r, j, '粘贴的简历', { docId: docId });
    });

    // 优化台 01 步：从简历库选择 / 上传 / 粘贴
    if ($('srcPickLib')) $('srcPickLib').addEventListener('click', function () {
      if (!window.ResumeLib) return;
      window.ResumeLib.pickDoc(function (doc) { loadDoc(doc, true); });
    });
    if ($('srcUpload')) $('srcUpload').addEventListener('click', function () {
      if ($('fileResume')) $('fileResume').click();
    });
    if ($('srcJdUpload')) $('srcJdUpload').addEventListener('click', function () {
      if ($('fileJd')) $('fileJd').click();
    });
    if ($('srcStart')) $('srcStart').addEventListener('click', function () {
      if (!S.base) { toast('先选一份简历'); return; }
      showWork(2);
    });

    // 示例
    function loadSample() {
      var doc = null;
      if (window.ResumeLib && window.SAMPLE) {
        try {
          var model = window.ResumeModel.parse(window.SAMPLE.resume, {});
          doc = window.ResumeLib.save(window.ResumeLib.fromParsed(model, {
            title: '示例简历 · 数据分析师',
            jd: window.SAMPLE.jd
          }));
          window.ResumeLib.render();
        } catch (e) { doc = null; }
      }
      if (doc) { loadDoc(doc, true); return; }
      ingest(window.SAMPLE.resume, window.SAMPLE.jd, '示例简历.txt');
    }
    if ($('btnSample')) $('btnSample').addEventListener('click', loadSample);
    if ($('srcSample')) $('srcSample').addEventListener('click', loadSample);

    // 重开
    if ($('btnReset')) $('btnReset').addEventListener('click', reset);

    // 建议交互
    $('suggestList').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-toggle]');
      if (!btn) return;
      var id = btn.dataset.toggle;
      if (S.selected[id]) delete S.selected[id];
      else S.selected[id] = true;
      rebuild(false);
    });

    $('btnAdoptAll').addEventListener('click', function () {
      S.suggestions.forEach(function (s) { S.selected[s.id] = true; });
      rebuild(true);
    });
    $('btnClearAll').addEventListener('click', function () {
      S.selected = Object.create(null);
      rebuild(true);
    });

    // 过滤
    $('filterRow').addEventListener('click', function (e) {
      var chip = e.target.closest('.chip');
      if (!chip) return;
      S.filter = chip.dataset.filter;
      Array.prototype.forEach.call($('filterRow').children, function (c) {
        c.classList.toggle('is-active', c === chip);
      });
      renderSuggestions();
    });

    // 风格切换（预览区）：三种模板 + 「保留原版式」
    $('styleSeg').addEventListener('click', function (e) {
      var b = e.target.closest('.seg-btn');
      if (!b) return;
      if (b.dataset.style === 'origin') {
        if (!hasOrigin()) {
          toast('当前简历没有原始文件，无法沿用原版式。上传 PDF / DOCX 后可用');
          return;
        }
        // 有 PDF 版式参数走「按原版式重建」，只有 DOCX 原件走「原位替换」
        S.mode = S.layout ? 'layout' : 'inplace';
        if (S.mode === 'inplace') S.format = 'docx';
      } else {
        S.style = b.dataset.style;
        S.tpl = b.dataset.style;
        S.mode = 'relayout';
      }
      syncStyleUI();
      renderSuggestions();
      renderPaper();
      persist();
    });

    // AI 版简历建议（大模型生成，复用采纳机制；失败回落规则版）
    $('btnAiSuggest').addEventListener('click', function () {
      if (window.AIPolish) window.AIPolish.run();
    });

    // 步骤条：01 回到选择简历 / 02 回诊断台 / 03 打开导出
    $('steps').addEventListener('click', function (e) {
      var b = e.target.closest('.step');
      if (!b) return;
      var n = +b.dataset.step;
      if (n === 1) { showWork(1); return; }
      if (!S.base) { toast('先上传一份简历，才能进入' + (n === 2 ? '诊断' : '导出')); return; }
      if (n === 2) { showWork(2); return; }
      openExport();
    });

    // 导出面板
    $('btnExport').addEventListener('click', openExport);

    $('formatGrid').addEventListener('click', function (e) {
      var b = e.target.closest('.format-card');
      if (!b) return;
      // 置灰项仍可点击，但要给出明确原因（不用 disabled，否则事件不派发）
      if (b.classList.contains('is-muted') || b.getAttribute('aria-disabled') === 'true') {
        toast('「保留原版式」只输出 DOCX，需要其他格式请切换到预览上方的模板');
        return;
      }
      // 单选：一次只生成一种文件
      if (isDocExport()) {
        if (docExport.format === b.dataset.format) return;
        docExport.format = b.dataset.format;
        paintFormatCards(docExport.format, null);
        return;
      }
      if (S.format === b.dataset.format) return;
      S.format = b.dataset.format;
      syncStyleUI();
      persist();
    });

    // 键盘可达：radiogroup 支持上下/左右方向键切换
    $('formatGrid').addEventListener('keydown', function (e) {
      var keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'];
      if (keys.indexOf(e.key) < 0) return;
      var cards = Array.prototype.slice.call(
        $('formatGrid').querySelectorAll('.format-card:not(.is-muted)'));
      if (!cards.length) return;
      var cur = cards.indexOf(e.target.closest('.format-card'));
      if (cur < 0) return;
      e.preventDefault();
      var step = (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 1 : -1;
      var next = cards[(cur + step + cards.length) % cards.length];
      next.focus();
      if (isDocExport()) {
        docExport.format = next.dataset.format;
        paintFormatCards(docExport.format, null);
        return;
      }
      S.format = next.dataset.format;
      syncStyleUI();
      persist();
    });

    // 导入 JSON 存档
    if ($('btnImportArchive')) $('btnImportArchive').addEventListener('click', function () { $('fileArchive').click(); });
    $('fileArchive').addEventListener('change', function () {
      var f = this.files && this.files[0];
      if (!f) return;
      var self = this;
      f.text().then(function (txt) {
        importArchive(txt);
        toast('已导入存档，继续优化吧');
      }).catch(function (err) {
        toast((err && err.message) ? err.message : '存档导入失败');
      }).then(function () { self.value = ''; });
    });

    // 证件照：默认始终保留；点预览里的照片位可上传或更换
    if ($('paper')) $('paper').addEventListener('click', function (e) {
      var ph = e.target.closest('.r-photo');
      if (!ph) return;
      $('filePhoto').click();
    });

    $('filePhoto').addEventListener('change', function () {
      var f = this.files && this.files[0];
      if (!f) return;
      var fr = new FileReader();
      fr.onload = function () {
        S.photo = String(fr.result || '');
        if (S.base) S.base.photo = S.photo;
        if (S.model) S.model.photo = S.photo;
        renderPaper();
        persist();
        toast('照片已更新');
      };
      fr.readAsDataURL(f);
    });

    $('btnDownload').addEventListener('click', function () {
      if (isDocExport()) doDocExport();
      else doExport();
    });

    // 关闭
    document.addEventListener('click', function (e) {
      var c = e.target.closest('[data-close]');
      if (c) closeOverlay(c.dataset.close);
      if (e.target.classList && e.target.classList.contains('overlay')) closeOverlay(e.target.id);
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        document.querySelectorAll('.overlay').forEach(function (o) {
          if (!o.hidden) closeOverlay(o.id);
        });
      }
    });

    // 尺寸变化
    var shell = $('paperShell');
    var ro = new ResizeObserver(function () {
      if (S.model) window.ResumeRender.fit($('paperScale'), $('paper'), shell);
    });
    ro.observe(shell);
    window.addEventListener('resize', function () {
      if (S.model) window.ResumeRender.fit($('paperScale'), $('paper'), shell);
      syncStepThumb();
    });
    // 字体加载完成后按钮宽度会变，重新校准滑块
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(syncStepThumb);
    }
  }

  /* ---------------- 兜底：出错时给出可见提示，而不是整页失灵 ---------------- */
  function fatal(where, err) {
    var msg = (err && (err.message || String(err))) || '未知错误';
    try { console.error('[rp] ' + where + ' 失败：', err); } catch (e) { }
    try {
      var bar = $('rpFatal');
      if (!bar) {
        bar = document.createElement('div');
        bar.id = 'rpFatal';
        bar.className = 'rp-fatal';
        bar.innerHTML =
          '<div class="rp-fatal-txt"><b>页面有一部分没能启动</b><span></span></div>' +
          '<button type="button" class="rp-fatal-btn">刷新页面</button>' +
          '<button type="button" class="rp-fatal-x" aria-label="关闭">×</button>';
        document.body.appendChild(bar);
        bar.querySelector('.rp-fatal-btn').addEventListener('click', function () { location.reload(); });
        bar.querySelector('.rp-fatal-x').addEventListener('click', function () { bar.remove(); });
      }
      bar.querySelector('span').textContent = where + '：' + msg;
    } catch (e) { }
  }

  window.addEventListener('error', function (ev) {
    if (!ev || !ev.message) return;
    // 浏览器噪声：ResizeObserver 循环提醒、跨域 Script error、扩展脚本
    if (/ResizeObserver loop|Script error\.?$/i.test(ev.message)) return;
    if (ev.filename && !/^(https?|file):/i.test(ev.filename)) return;
    var f = ev.filename ? String(ev.filename).split('/').pop() : '';
    fatal(f ? f + ':' + ev.lineno : '脚本', ev.error || ev.message);
  });
  window.addEventListener('unhandledrejection', function (ev) {
    var r = ev && ev.reason;
    if (!r || (r.name === 'AbortError')) return;
    fatal('请求', r);
  });

  document.addEventListener('DOMContentLoaded', function () {
    // 导航先绑：即使某个模块的元素缺失或初始化抛错，左侧四项也始终可点
    bindNav();

    // 尽早暴露给其他模块（editor / interview / ai 都依赖它）
    window.App = {
      state: S,
      toast: toast,
      rebuild: rebuild,
      renderSuggestions: renderSuggestions,
      openOverlay: openOverlay,
      closeOverlay: closeOverlay,
      showUpload: showUpload,
      showWork: showWork,
      showSettings: showSettings,
      showInterview: showInterview,
      activateView: activate,
      syncView: syncChrome,
      syncUploadState: syncUploadState,
      applyTemplate: applyTemplate,
      openEditor: openEditor,
      leaveEditor: leaveEditor,
      loadDoc: loadDoc,
      openDocExport: openDocExport,
    };

    // 单个模块初始化失败不该拖垮整页：各自包一层，把原因显示出来
    try {
      bind();
    } catch (err) {
      fatal('交互绑定', err);
    }
    try {
      if (window.ResumeLib) window.ResumeLib.init();
    } catch (err) {
      fatal('简历库', err);
    }
    activate('resume');
    setStep(1);
    requestAnimationFrame(syncStepThumb);
    // 调试入口：?debug 时暴露内部状态，便于自动化验证
    if (location.search.indexOf('debug') >= 0) window.__rp = S;
    // 有存档就先恢复上次现场（刷新不丢），没有才走示例
    var restored = false;
    try {
      restored = !!restore();
    } catch (err) {
      fatal('恢复存档', err);
    }
    // 把当前界面写成历史的第一条：后退时停在站内，而不是直接退出
    try { initRoute(); } catch (err) { fatal('页面历史', err); }
    if (!restored && location.hash === '#demo' && $('btnSample')) $('btnSample').click();
  });

  // 浏览器后退 / 前进：回到站内上一个界面
  window.addEventListener('popstate', function (ev) {
    try {
      applyRoute(ev.state || { rp: 'resume', step: 1 });
    } catch (err) {
      fatal('页面历史', err);
    }
  });
})();
