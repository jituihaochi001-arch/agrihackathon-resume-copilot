/* editor.js — 简历编辑器：模块编排、表单、实时 A4 预览、自动保存、撤销 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var doc = null;
  var zoom = 1;
  var saveTimer = 0;
  var dirty = false;
  var undoStack = [];
  var redoStack = [];
  var lastSnap = '';
  var bound = false;

  var PRESETS = [
    { type: 'summary',    name: '自我评价', mode: 'para' },
    { type: 'experience', name: '工作经历', mode: 'entries' },
    { type: 'project',    name: '项目经历', mode: 'entries' },
    { type: 'education',  name: '教育经历', mode: 'entries' },
    { type: 'skills',     name: '专业技能', mode: 'chips' },
    { type: 'awards',     name: '荣誉证书', mode: 'chips' },
    { type: 'language',   name: '语言能力', mode: 'chips' },
    { type: 'portfolio',  name: '作品集',   mode: 'entries' },
    { type: 'other',      name: '自定义模块', mode: 'entries' }
  ];

  var FIELDS = {
    education: [['org', '学校'], ['major', '专业'], ['degree', '学历'], ['place', '城市'], ['meta', '时间']],
    experience: [['org', '公司'], ['role', '职位'], ['place', '城市'], ['meta', '时间']],
    project: [['org', '项目名称'], ['role', '角色'], ['meta', '时间']],
    campus: [['org', '组织 / 社团'], ['role', '角色'], ['meta', '时间']],
    other: [['org', '标题'], ['role', '副标题'], ['meta', '时间']]
  };

  var BASIC_CONTACTS = ['电话', '邮箱', '城市'];

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function sections() {
    return (doc.model.sections || []).slice().sort(function (a, b) {
      return (a.order == null ? 9999 : a.order) - (b.order == null ? 9999 : b.order);
    });
  }
  function sectionByUid(uid) {
    var list = doc.model.sections || [];
    for (var i = 0; i < list.length; i++) if (list[i].uid === uid) return list[i];
    return null;
  }
  function itemByUid(sec, uid) {
    var list = sec.items || [];
    for (var i = 0; i < list.length; i++) if (list[i].uid === uid) return list[i];
    return null;
  }
  function contactValue(label) {
    var list = doc.model.contact || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].label === label) return list[i].value || '';
    }
    return '';
  }
  function setContact(label, value) {
    var list = doc.model.contact || (doc.model.contact = []);
    for (var i = 0; i < list.length; i++) {
      if (list[i].label === label) {
        list[i].value = value;
        if (!value) list.splice(i, 1);
        return;
      }
    }
    if (value) list.push({ label: label, value: value });
  }
  function extraContacts() {
    var list = doc.model.contact || [];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      if (BASIC_CONTACTS.indexOf(list[i].label) < 0) out.push({ idx: i, label: list[i].label, value: list[i].value });
    }
    return out;
  }
  function contactIndex(label) {
    var list = doc.model.contact || [];
    for (var i = 0; i < list.length; i++) if (list[i].label === label) return i;
    return -1;
  }

  function snapshot() {
    return JSON.stringify({
      title: doc.title, template: doc.template, theme: doc.theme, model: doc.model
    });
  }

  function pushHistory() {
    if (!doc) return;
    var snap = snapshot();
    if (snap === lastSnap) return;
    if (lastSnap) undoStack.push(lastSnap);
    lastSnap = snap;
    if (undoStack.length > 60) undoStack.shift();
    redoStack = [];
    syncUndo();
  }

  function restoreSnap(snap) {
    var d = JSON.parse(snap);
    doc.title = d.title;
    doc.template = d.template;
    doc.theme = d.theme;
    doc.model = d.model;
    lastSnap = snapshot();
    renderAll();
    markDirty();
  }

  function undo() {
    if (!undoStack.length) return;
    pushHistory();
    var prev = undoStack.pop();
    redoStack.push(snapshot());
    restoreSnap(prev);
    syncUndo();
  }

  function redo() {
    if (!redoStack.length) return;
    var next = redoStack.pop();
    undoStack.push(snapshot());
    restoreSnap(next);
    syncUndo();
  }

  function syncUndo() {
    var u = $('edUndo'), r = $('edRedo');
    if (u) u.disabled = !undoStack.length;
    if (r) r.disabled = !redoStack.length;
  }

  /* ---------------- 保存 ---------------- */

  function markDirty() {
    if (!doc) return;
    dirty = true;
    setStatus('保存中…', true);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 420);
  }

  function flushSave() {
    clearTimeout(saveTimer);
    if (!doc || !dirty) return;
    try {
      window.ResumeLib.save(doc);
      dirty = false;
      setStatus('已保存 · ' + timeNow());
    } catch (e) {
      setStatus('保存失败：' + (e.message || '存储空间不足'), true);
      if (window.App && window.App.toast) window.App.toast(e.message || '保存失败');
    }
  }

  function timeNow() {
    var d = new Date();
    var p = function (x) { return ('0' + x).slice(-2); };
    return p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function setStatus(text, warn) {
    var el = $('edStatus');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('is-warn', !!warn);
  }

  /* ---------------- 左侧模块列表 ---------------- */

  function renderSecList() {
    var box = $('edSecList');
    if (!box) return;
    box.innerHTML = '';
    var list = sections();
    if (!list.length) {
      box.innerHTML = '<li class="ed-sec-empty">还没有模块，点右上角「添加」开始。</li>';
      return;
    }
    list.forEach(function (s, i) {
      var li = document.createElement('li');
      li.className = 'ed-sec-item' + (s.visible === false ? ' is-off' : '');
      li.dataset.uid = s.uid;
      var count = s.mode === 'entries' ? (s.items || []).length
        : s.mode === 'chips' ? (s.chips || []).length
        : (s.text ? 1 : 0);
      li.innerHTML =
        '<button type="button" class="ed-mini ed-eye" data-act="vis" title="' + (s.visible === false ? '显示' : '隐藏') + '">' + (s.visible === false ? '○' : '●') + '</button>' +
        '<span class="ed-sec-name">' + esc(s.heading) + '</span>' +
        '<span class="ed-sec-count">' + (count ? count : '') + '</span>' +
        '<button type="button" class="ed-mini" data-act="up" title="上移" ' + (i === 0 ? 'disabled' : '') + '>↑</button>' +
        '<button type="button" class="ed-mini" data-act="down" title="下移" ' + (i === list.length - 1 ? 'disabled' : '') + '>↓</button>';
      box.appendChild(li);
    });
  }

  /* ---------------- 中间表单 ---------------- */

  function basicsCard() {
    var m = doc.model;
    var extras = extraContacts().map(function (c) {
      return '<div class="ed-contact-row">' +
        '<input type="text" data-cf="' + c.idx + '" value="' + esc(c.label) + '" placeholder="标签，如微信" />' +
        '<input type="text" data-cv="' + c.idx + '" value="' + esc(c.value) + '" placeholder="内容" />' +
        '<button type="button" class="ed-mini" data-act="contact-del" data-idx="' + c.idx + '" title="删除">×</button>' +
        '</div>';
    }).join('');

    return '<div class="ed-card" data-sec="__basics">' +
      '<div class="ed-card-head"><span class="ed-card-title">基本信息</span>' +
        '<span class="ed-card-hint">姓名、联系方式与头像</span></div>' +
      '<div class="ed-card-body">' +
        '<div class="ed-basic-top">' +
          '<div class="ed-avatar' + (m.photo ? ' has-img' : '') + '" id="edAvatar">' +
            (m.photo ? '<img src="' + esc(m.photo) + '" alt="头像" />' : '<span>＋<br/>头像</span>') +
          '</div>' +
          '<div class="ed-avatar-acts">' +
            '<button type="button" class="line-btn sm" data-act="photo">' + (m.photo ? '更换头像' : '上传头像') + '</button>' +
            (m.photo ? '<button type="button" class="text-btn" data-act="photo-del">移除</button>' : '') +
          '</div>' +
        '</div>' +
        '<div class="ed-row">' +
          '<label class="ed-field"><span>姓名</span><input type="text" data-bf="name" value="' + esc(m.name) + '" placeholder="你的姓名" /></label>' +
          '<label class="ed-field"><span>求职意向</span><input type="text" data-bf="intent" value="' + esc(m.intent) + '" placeholder="如：产品经理" /></label>' +
        '</div>' +
        '<div class="ed-row">' +
          '<label class="ed-field"><span>电话</span><input type="text" data-bc="电话" value="' + esc(contactValue('电话')) + '" placeholder="138 0000 0000" /></label>' +
          '<label class="ed-field"><span>邮箱</span><input type="text" data-bc="邮箱" value="' + esc(contactValue('邮箱')) + '" placeholder="name@example.com" /></label>' +
        '</div>' +
        '<div class="ed-row">' +
          '<label class="ed-field"><span>城市</span><input type="text" data-bc="城市" value="' + esc(contactValue('城市')) + '" placeholder="上海" /></label>' +
          '<div class="ed-field ed-field-inline"><span>其他联系方式</span>' +
            '<button type="button" class="text-btn" data-act="contact-add">＋ 添加一行</button></div>' +
        '</div>' +
        (extras ? '<div class="ed-contacts">' + extras + '</div>' : '') +
      '</div>' +
    '</div>';
  }

  function sectionCard(s) {
    var body = '';
    if (s.mode === 'para') {
      body = '<label class="ed-field"><span>正文</span>' +
        '<textarea data-sf="text" rows="5" placeholder="用 2–4 句话概括你的优势与方向">' + esc(s.text) + '</textarea></label>';
    } else if (s.mode === 'chips') {
      body = '<label class="ed-field"><span>标签 <em class="ed-em">一行一个</em></span>' +
        '<textarea data-sf="chips" rows="4" placeholder="React\nTypeScript\n性能优化">' + esc((s.chips || []).join('\n')) + '</textarea></label>';
    } else {
      body = '<div class="ed-items">';
      (s.items || []).forEach(function (it, i) {
        body += itemCard(s, it, i);
      });
      body += '</div>' +
        '<button type="button" class="line-btn sm ed-add-item" data-act="item-add">＋ 添加一条经历</button>';
    }

    return '<div class="ed-card" data-sec="' + s.uid + '">' +
      '<div class="ed-card-head">' +
        '<input class="ed-card-title-input" type="text" data-sf="heading" value="' + esc(s.heading) + '" maxlength="16" title="模块标题" />' +
        '<div class="ed-card-tools">' +
          '<button type="button" class="ed-mini" data-act="sec-up" title="上移">↑</button>' +
          '<button type="button" class="ed-mini" data-act="sec-down" title="下移">↓</button>' +
          '<button type="button" class="text-btn is-danger" data-act="sec-del">删除</button>' +
        '</div>' +
      '</div>' +
      '<div class="ed-card-body">' + body + '</div>' +
    '</div>';
  }

  function itemCard(s, it, i) {
    var fields = FIELDS[s.type] || FIELDS.other;
    var grid = fields.map(function (f) {
      return '<label class="ed-field"><span>' + esc(f[1]) + '</span>' +
        '<input type="text" data-si="' + f[0] + '" value="' + esc(it[f[0]]) + '" /></label>';
    }).join('');

    return '<div class="ed-item" data-item="' + it.uid + '">' +
      '<div class="ed-item-head">' +
        '<span class="ed-item-no">' + ('0' + (i + 1)).slice(-2) + '</span>' +
        '<div class="ed-item-tools">' +
          '<button type="button" class="ed-mini" data-act="item-up" title="上移" ' + (i === 0 ? 'disabled' : '') + '>↑</button>' +
          '<button type="button" class="ed-mini" data-act="item-down" title="下移" ' + (i === (s.items || []).length - 1 ? 'disabled' : '') + '>↓</button>' +
          '<button type="button" class="ed-mini" data-act="item-del" title="删除">×</button>' +
        '</div>' +
      '</div>' +
      '<div class="ed-grid2">' + grid + '</div>' +
      '<label class="ed-field"><span>要点 <em class="ed-em">一行一条，不用写圆点</em></span>' +
        '<textarea data-si="bullets" rows="4" placeholder="负责……\n推动……，结果提升 30%">' + esc((it.bullets || []).join('\n')) + '</textarea></label>' +
    '</div>';
  }

  function renderForm() {
    var box = $('edForm');
    if (!box) return;
    var y = box.scrollTop;
    box.innerHTML = basicsCard() + sections().map(sectionCard).join('');
    box.scrollTop = y;
  }

  /* ---------------- 右侧预览 ---------------- */

  function renderPreview() {
    if (!doc) return;
    var paper = $('edPaper');
    if (!paper) return;
    var tpl = window.ResumeLib.template(doc.template);
    var t = window.ResumeLib.renderTemplate(doc.template, doc.theme);
    try {
      window.ResumeRender.render(paper, window.ResumeLib.visibleModel(doc), {
        style: tpl.base, photo: !!doc.model.photo, template: t, slot: true, showEmpty: true
      });
      paper.classList.add('ed-flow');
      paper.setAttribute('data-fit', '0');
    } catch (e) {
      paper.innerHTML = '<div class="ed-preview-fail">预览失败：' + esc(e.message || e) + '</div>';
    }
    requestAnimationFrame(function () {
      drawBreaks();
      fitPreview();
    });
  }

  /** 自然分页参考线：每 1123px（A4@96dpi）画一条虚线，打印时由浏览器真实分页 */
  function drawBreaks() {
    var paper = $('edPaper');
    if (!paper) return;
    Array.prototype.forEach.call(paper.querySelectorAll('.ed-break'), function (el) { el.remove(); });
    var h = paper.scrollHeight;
    var pages = Math.max(1, Math.ceil(h / 1123));
    for (var i = 1; i < pages; i++) {
      var mark = document.createElement('div');
      mark.className = 'ed-break';
      mark.style.top = (i * 1123) + 'px';
      mark.innerHTML = '<span>第 ' + (i + 1) + ' 页</span>';
      paper.appendChild(mark);
    }
    var badge = $('edPageCount');
    if (badge) badge.textContent = pages + ' 页';
  }

  function fitPreview() {
    var paper = $('edPaper'), wrap = $('edPaperWrap'), scroll = $('edPreviewScroll');
    if (!paper || !wrap || !scroll) return;
    var avail = Math.max(240, scroll.clientWidth - 44);
    var base = Math.min(1, avail / 794);
    var s = base * zoom;
    paper.style.transform = 'scale(' + s + ')';
    paper.style.transformOrigin = 'top left';
    wrap.style.width = (794 * s) + 'px';
    wrap.style.height = (paper.offsetHeight * s) + 'px';
    var zv = $('edZoomVal');
    if (zv) zv.textContent = Math.round(s * 100) + '%';
  }

  /* ---------------- 设置栏 ---------------- */

  function renderChrome() {
    if (!doc) return;
    var title = $('edTitle');
    if (title && document.activeElement !== title) title.value = doc.title || '';
    var tsel = $('edTemplate');
    if (tsel) tsel.value = doc.template;
    var accent = $('edAccent');
    if (accent) accent.value = doc.theme.accent;
    var font = $('edFont');
    if (font) font.value = doc.theme.font;
    var density = $('edDensity');
    if (density) density.value = doc.theme.density;
    var nameSize = $('edNameSize');
    if (nameSize) nameSize.value = doc.theme.nameSize;
    syncRangeLabels();
  }

  function syncRangeLabels() {
    var d = $('edDensityVal');
    if (d) d.textContent = doc.theme.density < 34 ? '紧凑' : (doc.theme.density > 66 ? '宽松' : '标准');
    var n = $('edNameSizeVal');
    if (n) n.textContent = doc.theme.nameSize + 'pt';
  }

  /* ---------------- 操作 ---------------- */

  function renumber() {
    var list = sections();
    list.forEach(function (s, i) { s.order = i; });
    doc.model.sections = list;
  }

  function addSection(preset) {
    pushHistory();
    var same = sections().filter(function (s) { return s.type === preset.type; }).length;
    var name = preset.name + (same ? ' ' + (same + 1) : '');
    var s = window.ResumeLib.section(preset.type, name, preset.mode, sections().length);
    doc.model.sections.push(s);
    renumber();
    renderSecList();
    renderForm();
    renderPreview();
    markDirty();
    var card = document.querySelector('#edForm [data-sec="' + s.uid + '"]');
    if (card) card.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function moveSection(uid, dir) {
    pushHistory();
    var list = sections();
    var i = -1;
    for (var k = 0; k < list.length; k++) if (list[k].uid === uid) i = k;
    if (i < 0) return;
    var j = i + dir;
    if (j < 0 || j >= list.length) return;
    var tmp = list[i]; list[i] = list[j]; list[j] = tmp;
    // 注意：不能调用 renumber()——它内部会按旧的 order 重新排序，
    // 把刚交换的数组顺序还原。这里直接按新顺序重排 order。
    list.forEach(function (s, idx) { s.order = idx; });
    doc.model.sections = list;
    renderSecList();
    renderForm();
    renderPreview();
    markDirty();
  }

  function deleteSection(uid) {
    var s = sectionByUid(uid);
    if (!s) return;
    var has = s.text || (s.chips && s.chips.length) || (s.items && s.items.length);
    if (has && !window.confirm('删除「' + s.heading + '」及其内容？')) return;
    pushHistory();
    doc.model.sections = doc.model.sections.filter(function (x) { return x.uid !== uid; });
    renumber();
    renderSecList();
    renderForm();
    renderPreview();
    markDirty();
  }

  function toggleSection(uid) {
    var s = sectionByUid(uid);
    if (!s) return;
    pushHistory();
    s.visible = s.visible === false;
    renderSecList();
    renderPreview();
    markDirty();
  }

  function moveItem(sec, uid, dir) {
    var list = sec.items || [];
    var i = -1;
    for (var k = 0; k < list.length; k++) if (list[k].uid === uid) i = k;
    if (i < 0) return;
    var j = i + dir;
    if (j < 0 || j >= list.length) return;
    pushHistory();
    var tmp = list[i]; list[i] = list[j]; list[j] = tmp;
    renderForm();
    renderPreview();
    markDirty();
  }

  function deleteItem(sec, uid) {
    if (!window.confirm('删除这一条？')) return;
    pushHistory();
    sec.items = (sec.items || []).filter(function (x) { return x.uid !== uid; });
    renderSecList();
    renderForm();
    renderPreview();
    markDirty();
  }

  function addItem(sec) {
    pushHistory();
    sec.items = sec.items || [];
    sec.items.push(window.ResumeLib.blankItem());
    renderSecList();
    renderForm();
    renderPreview();
    markDirty();
    var cards = document.querySelectorAll('#edForm [data-sec="' + sec.uid + '"] .ed-item');
    if (cards.length) cards[cards.length - 1].scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function readPhoto(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () {
        var img = new Image();
        img.onload = function () {
          var max = 800;
          var k = Math.min(1, max / Math.max(img.width, img.height));
          var c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(img.width * k));
          c.height = Math.max(1, Math.round(img.height * k));
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          try { resolve(c.toDataURL('image/jpeg', 0.82)); }
          catch (e) { resolve(String(fr.result || '')); }
        };
        img.onerror = function () { reject(new Error('图片读取失败')); };
        img.src = String(fr.result || '');
      };
      fr.onerror = function () { reject(new Error('图片读取失败')); };
      fr.readAsDataURL(file);
    });
  }

  /* ---------------- 三栏拖拽 ---------------- */

  function initSplitters() {
    var body = document.querySelector('.ed-body');
    var sNav = $('edSplitNav'), sForm = $('edSplitForm');
    if (!body || !sNav || !sForm) return;
    var nav = body.querySelector('.ed-col-nav'), form = body.querySelector('.ed-col-form');
    if (!nav || !form) return;
    if (initSplitters.done) { restoreSplits(); return; }
    initSplitters.done = true;

    var KEY = 'rp.ed.cols';
    var MIN_NAV = 168, MAX_NAV = 360;
    var MIN_FORM = 300, MAX_FORM = 640;
    var MIN_PREVIEW = 260, GRIPS = 12;

    function read() {
      try {
        var o = JSON.parse(localStorage.getItem(KEY) || 'null');
        if (o && isFinite(o.nav) && isFinite(o.form)) return o;
      } catch (e) { /* 忽略 */ }
      return null;
    }
    function write(o) {
      try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) { /* 隐私模式 */ }
    }
    function clampPair(n, f) {
      n = Math.round(Math.max(MIN_NAV, Math.min(MAX_NAV, n)));
      f = Math.round(Math.max(MIN_FORM, Math.min(MAX_FORM, f)));
      var room = (body.clientWidth || 1200) - GRIPS - MIN_PREVIEW;
      if (n + f > room) {
        f = Math.max(MIN_FORM, room - n);
        if (n + f > room) n = Math.max(MIN_NAV, room - f);
      }
      return { nav: n, form: f };
    }
    function apply(n, f) {
      var p = clampPair(n, f);
      body.style.setProperty('--ed-nav-w', p.nav + 'px');
      body.style.setProperty('--ed-form-w', p.form + 'px');
      return p;
    }
    function current() {
      var n = parseFloat(body.style.getPropertyValue('--ed-nav-w'));
      var f = parseFloat(body.style.getPropertyValue('--ed-form-w'));
      if (!isFinite(n)) n = nav.getBoundingClientRect().width || 232;
      if (!isFinite(f)) f = form.getBoundingClientRect().width || 420;
      return { nav: n, form: f };
    }
    function restoreSplits() {
      var pref = read() || { nav: 232, form: 420 };
      apply(pref.nav, pref.form);
    }
    initSplitters.restore = restoreSplits;
    restoreSplits();

    function make(split, which) {
      var dragging = false, startX = 0, startNav = 0, startForm = 0, raf = 0, lastX = 0;

      function move(ev) {
        lastX = ev.clientX;
        if (raf) return;
        raf = requestAnimationFrame(function () {
          raf = 0;
          var dx = lastX - startX;
          if (which === 'nav') apply(startNav + dx, startForm);
          else apply(startNav, startForm + dx);
        });
      }
      function up() {
        if (!dragging) return;
        dragging = false;
        if (raf) {
          // 左右移动后、下一帧到来前就松手：补上最后一次位移，否则会丢掉这一下拖动
          cancelAnimationFrame(raf);
          raf = 0;
          var dx = lastX - startX;
          if (dx) {
            if (which === 'nav') apply(startNav + dx, startForm);
            else apply(startNav, startForm + dx);
          }
        }
        split.classList.remove('is-dragging');
        document.documentElement.classList.remove('is-ed-splitting');
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        var c = current();
        write({ nav: c.nav, form: c.form });
      }

      split.addEventListener('pointerdown', function (e) {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        var c = current();
        dragging = true;
        startX = e.clientX;
        lastX = e.clientX;
        startNav = c.nav;
        startForm = c.form;
        split.classList.add('is-dragging');
        document.documentElement.classList.add('is-ed-splitting');
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', up);
        try { split.focus({ preventScroll: true }); } catch (err) { split.focus(); }
        e.preventDefault();
      });

      split.addEventListener('dblclick', function () {
        apply(232, 420);
        try { localStorage.removeItem(KEY); } catch (e) { /* 忽略 */ }
      });

      split.addEventListener('keydown', function (e) {
        var c = current(), step = e.shiftKey ? 48 : 16;
        var next;
        if (e.key === 'Home') {
          apply(232, 420);
          try { localStorage.removeItem(KEY); } catch (err) { /* 忽略 */ }
          e.preventDefault();
          return;
        }
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        var d = e.key === 'ArrowRight' ? step : -step;
        if (which === 'nav') next = apply(c.nav + d, c.form);
        else next = apply(c.nav, c.form + d);
        write({ nav: next.nav, form: next.form });
        e.preventDefault();
      });
    }

    make(sNav, 'nav');
    make(sForm, 'form');

    var rt = 0;
    window.addEventListener('resize', function () {
      if (rt) clearTimeout(rt);
      rt = setTimeout(function () {
        var c = current();
        apply(c.nav, c.form);
        if (window.ResizeObserver) fitPreview();
      }, 120);
    });
  }

  function restoreSplits() {
    if (initSplitters.restore) initSplitters.restore();
  }

  /* ---------------- 事件 ---------------- */

  function bind() {
    if (bound) return;
    bound = true;

    initSplitters();

    var back = $('edBack');
    if (back) back.addEventListener('click', function () {
      if (window.App && window.App.leaveEditor) { window.App.leaveEditor(); return; }
      close();
      if (window.App && window.App.showUpload) window.App.showUpload();
    });

    var title = $('edTitle');
    if (title) title.addEventListener('input', function () {
      doc.title = title.value;
      markDirty();
    });

    var un = $('edUndo'), re = $('edRedo');
    if (un) un.addEventListener('click', undo);
    if (re) re.addEventListener('click', redo);

    var ex = $('edExport');
    if (ex) ex.addEventListener('click', openExportPanel);
    var pr = $('edPrint');
    if (pr) pr.addEventListener('click', printDoc);
    var md = $('edExportMd');
    if (md) md.addEventListener('click', exportMarkdown);
    var js = $('edExportJson');
    if (js) js.addEventListener('click', exportJson);

    var opt = $('edOptimize');
    if (opt) opt.addEventListener('click', function () {
      if (!doc) return;
      flushSave();
      var d = window.ResumeLib.get(doc.id);
      if (!d) { if (window.App && window.App.toast) window.App.toast('这份简历还没保存好'); return; }
      close();
      if (window.App && window.App.loadDoc) window.App.loadDoc(d, true);
    });

    var add = $('edAddSec');
    if (add) add.addEventListener('click', function (e) {
      e.stopPropagation();
      var pop = $('edAddPop');
      if (pop) pop.hidden = !pop.hidden;
    });
    var pop = $('edAddPop');
    if (pop) {
      pop.innerHTML = PRESETS.map(function (p) {
        return '<button type="button" data-preset="' + p.type + '">' + esc(p.name) + '</button>';
      }).join('');
    }

    var list = $('edSecList');
    if (list) list.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      var li = b.closest('.ed-sec-item');
      if (!li) return;
      var uid = li.dataset.uid;
      var act = b.dataset.act;
      if (act === 'vis') toggleSection(uid);
      else if (act === 'up') moveSection(uid, -1);
      else if (act === 'down') moveSection(uid, 1);
    });

    var form = $('edForm');
    if (!form) return;

    form.addEventListener('focusin', function (e) {
      if (e.target.matches('input, textarea, select')) pushHistory();
    });

    form.addEventListener('input', function (e) {
      var t = e.target;
      if (!doc) return;
      if (t.dataset.bf) {
        doc.model[t.dataset.bf] = t.value;
      } else if (t.dataset.bc) {
        setContact(t.dataset.bc, t.value);
      } else if (t.dataset.cf != null) {
        var ci = +t.dataset.cf;
        if (doc.model.contact[ci]) doc.model.contact[ci].label = t.value;
      } else if (t.dataset.cv != null) {
        var cv = +t.dataset.cv;
        if (doc.model.contact[cv]) doc.model.contact[cv].value = t.value;
      } else if (t.dataset.sf) {
        var secEl = t.closest('[data-sec]');
        var s = secEl && sectionByUid(secEl.dataset.sec);
        if (!s) return;
        var key = t.dataset.sf;
        if (key === 'chips') {
          s.chips = t.value.split('\n').map(function (x) { return x.trim(); }).filter(Boolean);
        } else if (key === 'text' || key === 'heading') {
          s[key] = t.value;
        }
      } else if (t.dataset.si) {
        var itemEl = t.closest('[data-item]');
        var secEl2 = t.closest('[data-sec]');
        var sec = secEl2 && sectionByUid(secEl2.dataset.sec);
        if (!sec || !itemEl) return;
        var it = itemByUid(sec, itemEl.dataset.item);
        if (!it) return;
        if (t.dataset.si === 'bullets') {
          it.bullets = t.value.split('\n').map(function (x) {
            return x.replace(/^[-–—•·▪◦※*+]\s*/, '').trim();
          }).filter(Boolean);
        } else {
          it[t.dataset.si] = t.value;
        }
      }
      if (t.dataset.sf === 'heading') {
        var li = list && list.querySelector('.ed-sec-item[data-uid="' + t.closest('[data-sec]').dataset.sec + '"] .ed-sec-name');
        if (li) li.textContent = t.value || '未命名模块';
      }
      markDirty();
      renderPreview();
    });

    form.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      var secEl = b.closest('[data-sec]');
      var uid = secEl && secEl.dataset.sec;
      var act = b.dataset.act;

      if (act === 'contact-add') {
        pushHistory();
        doc.model.contact.push({ label: '', value: '' });
        renderForm();
        markDirty();
        return;
      }
      if (act === 'contact-del') {
        pushHistory();
        doc.model.contact.splice(+b.dataset.idx, 1);
        renderForm();
        renderPreview();
        markDirty();
        return;
      }
      if (act === 'photo') {
        var input = $('edPhotoInput');
        if (input) input.click();
        return;
      }
      if (act === 'photo-del') {
        pushHistory();
        doc.model.photo = '';
        renderForm();
        renderPreview();
        markDirty();
        return;
      }
      if (!uid || uid === '__basics') return;
      var s = sectionByUid(uid);
      if (!s) return;
      if (act === 'sec-up') moveSection(uid, -1);
      else if (act === 'sec-down') moveSection(uid, 1);
      else if (act === 'sec-del') deleteSection(uid);
      else if (act === 'item-add') addItem(s);
      else if (act === 'item-del' || act === 'item-up' || act === 'item-down') {
        var itemEl = b.closest('[data-item]');
        if (!itemEl) return;
        if (act === 'item-del') deleteItem(s, itemEl.dataset.item);
        else moveItem(s, itemEl.dataset.item, act === 'item-up' ? -1 : 1);
      }
    });

    if (pop) pop.addEventListener('click', function (e) {
      var b = e.target.closest('[data-preset]');
      if (!b) return;
      var p = null;
      for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].type === b.dataset.preset) p = PRESETS[i];
      if (!p) return;
      addSection(p);
      pop.hidden = true;
    });

    document.addEventListener('click', function (e) {
      var popEl = $('edAddPop');
      if (!popEl || popEl.hidden) return;
      if (!e.target.closest('#edAddPop') && !e.target.closest('#edAddSec')) popEl.hidden = true;
    });

    var tsel = $('edTemplate');
    if (tsel) {
      var opts = (window.ResumeLib ? window.ResumeLib.TEMPLATES : []).map(function (t) {
        return '<option value="' + t.id + '">' + esc(t.name) + '</option>';
      }).join('');
      tsel.innerHTML = opts;
      tsel.addEventListener('change', function () {
      pushHistory();
      doc.template = tsel.value;
      var theme = window.ResumeLib.themeFromTemplate(doc.template);
      doc.theme = theme;
      renderChrome();
      renderPreview();
      markDirty();
      });
    }

    var accent = $('edAccent');
    if (accent) accent.addEventListener('input', function () {
      doc.theme.accent = accent.value;
      renderPreview();
      markDirty();
    });
    var font = $('edFont');
    if (font) font.addEventListener('change', function () {
      doc.theme.font = font.value;
      renderPreview();
      markDirty();
    });
    ['edDensity', 'edNameSize'].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.addEventListener('input', function () {
        if (id === 'edDensity') doc.theme.density = +el.value;
        else doc.theme.nameSize = +el.value;
        syncRangeLabels();
        renderPreview();
        markDirty();
      });
    });

    var pinput = $('edPhotoInput');
    if (pinput) pinput.addEventListener('change', function () {
      var f = this.files && this.files[0];
      var self = this;
      if (!f) return;
      readPhoto(f).then(function (data) {
        pushHistory();
        doc.model.photo = data;
        renderForm();
        renderPreview();
        markDirty();
      }).catch(function (err) {
        if (window.App && window.App.toast) window.App.toast(err.message || '头像读取失败');
      }).then(function () { self.value = ''; });
    });

    var zbox = $('edZoom');
    if (zbox) zbox.addEventListener('click', function (e) {
      var b = e.target.closest('[data-zoom]');
      if (!b) return;
      zoom = Math.max(0.4, Math.min(1.4, zoom + (b.dataset.zoom === '+' ? 0.1 : -0.1)));
      fitPreview();
    });

    // 窄屏：版式面板默认收起，按需展开
    var st = $('edStyleToggle');
    var styleBox = document.querySelector('.ed-style');
    if (st && styleBox) st.addEventListener('click', function () {
      var on = styleBox.classList.toggle('is-open');
      st.setAttribute('aria-expanded', on ? 'true' : 'false');
    });

    if (window.ResizeObserver) {
      var scroll = $('edPreviewScroll');
      if (scroll) new ResizeObserver(function () { fitPreview(); }).observe(scroll);
    }
    window.addEventListener('resize', function () { if (doc) fitPreview(); });
  }

  /* ---------------- 导出 ---------------- */

  /** 打开与「简历优化」一致的导出面板（PDF / DOCX / PNG / Markdown / TXT / JSON） */
  function openExportPanel() {
    if (!doc) return;
    flushSave();
    if (window.App && window.App.openDocExport) {
      window.App.openDocExport(doc);
      return;
    }
    printDoc();
  }

  function printDoc() {
    if (!doc) return;
    flushSave();
    var host = $('printRoot');
    if (!host) return;
    host.innerHTML = '';
    var tpl = window.ResumeLib.template(doc.template);
    var t = window.ResumeLib.renderTemplate(doc.template, doc.theme);
    var paper = document.createElement('div');
    try {
      window.ResumeRender.render(paper, window.ResumeLib.visibleModel(doc), {
        style: tpl.base, photo: !!doc.model.photo, template: t, slot: false
      });
    } catch (e) {
      if (window.App && window.App.toast) window.App.toast('生成打印版失败：' + (e.message || e));
      return;
    }
    paper.classList.add('print-paper');
    host.appendChild(paper);
    document.body.classList.add('ed-printing');
    var done = function () {
      document.body.classList.remove('ed-printing');
      host.innerHTML = '';
      window.removeEventListener('afterprint', done);
    };
    window.addEventListener('afterprint', done);
    setTimeout(function () { window.print(); }, 80);
  }

  function exportMarkdown() {
    if (!doc) return;
    flushSave();
    var m = window.ResumeLib.visibleModel(doc);
    var name = (doc.title || m.name || '简历').replace(/[\\/:*?"<>|]/g, '');
    window.ResumeRender.download(name + '.md', window.ResumeRender.toMarkdown(m), 'text/markdown;charset=utf-8');
    if (window.App && window.App.toast) window.App.toast('已导出 Markdown');
  }

  function exportJson() {
    if (!doc) return;
    flushSave();
    var name = (doc.title || '简历').replace(/[\\/:*?"<>|]/g, '');
    window.ResumeRender.download(name + '.json', JSON.stringify(doc, null, 2), 'application/json;charset=utf-8');
    if (window.App && window.App.toast) window.App.toast('已导出简历 JSON');
  }

  /* ---------------- 打开 / 关闭 ---------------- */

  function renderAll() {
    if (!doc) return;
    renderSecList();
    renderForm();
    renderChrome();
    renderPreview();
    syncUndo();
  }

  function open(id) {
    var d = window.ResumeLib.get(id) || window.ResumeLib.latest();
    if (!d) {
      if (window.App && window.App.toast) window.App.toast('没有找到这份简历');
      if (window.App && window.App.showUpload) window.App.showUpload();
      return;
    }
    bound || bind();
    restoreSplits();
    doc = d;
    undoStack = [];
    redoStack = [];
    lastSnap = snapshot();
    dirty = false;
    zoom = 1;
    renderAll();
    setStatus('已保存 · ' + timeNow());
    requestAnimationFrame(function () { restoreSplits(); fitPreview(); });
  }

  function close() {
    if (!doc) return;
    flushSave();
    doc = null;
  }

  function isOpen() { return !!doc; }

  window.ResumeEditor = {
    open: open,
    close: close,
    isOpen: isOpen,
    init: bind,
    current: function () { return doc; }
  };
})();