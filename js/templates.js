/* templates.js — 模板中心：预设画廊、自定义模板、实时预览 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var STORE = 'rp.templates.v1';

  var INK = '#15171A';

  /** 预设模板：base 决定骨架，其余参数是变量覆盖 */
  var BUILTIN = [
    { id: 'swiss', name: '瑞士极简', base: 'swiss', sec: '', accent: INK, font: 'sans', density: 50, nameSize: 26, tag: '默认' },
    { id: 'classic', name: '经典商务', base: 'classic', sec: '', accent: INK, font: 'serif', density: 50, nameSize: 22, tag: '稳重' },
    { id: 'academic', name: '学术清爽', base: 'academic', sec: '', accent: INK, font: 'serif', density: 56, nameSize: 24, tag: '学术' },
    { id: 'mono', name: '墨线', base: 'swiss', sec: 'thick', accent: '#101216', font: 'sans', density: 44, nameSize: 28, tag: '利落' },
    { id: 'navy', name: '商务蓝', base: 'swiss', sec: 'bar', accent: '#1F3A5F', font: 'sans', density: 48, nameSize: 27, tag: '专业' },
    { id: 'forest', name: '松绿', base: 'swiss', sec: 'fill', accent: '#2B5644', font: 'sans', density: 50, nameSize: 26, tag: '清新' },
    { id: 'wine', name: '酒红双线', base: 'classic', sec: 'double', accent: '#7A2E3A', font: 'serif', density: 52, nameSize: 23, tag: '质感' },
    { id: 'warm', name: '暖褐学术', base: 'academic', sec: 'thick', accent: '#8A5A3B', font: 'serif', density: 58, nameSize: 24, tag: '温和' },
    { id: 'compact', name: '紧凑一页', base: 'swiss', sec: 'line', accent: INK, font: 'sans', density: 18, nameSize: 24, tag: '省空间' },
    { id: 'airy', name: '舒展留白', base: 'swiss', sec: 'plain', accent: INK, font: 'sans', density: 86, nameSize: 28, tag: '透气' },
  ];

  var ACCENTS = ['#15171A', '#1F3A5F', '#2B5644', '#7A2E3A', '#8A5A3B', '#3A3F4A'];

  var custom = [];
  var tab = 'all';
  var editing = null;   // 正在编辑的模板（null = 新建）

  /* ---------------- 存取 ---------------- */

  function load() {
    try {
      var v = JSON.parse(localStorage.getItem(STORE) || '[]');
      custom = Array.isArray(v) ? v.filter(function (t) { return t && t.id && t.name; }) : [];
    } catch (e) { custom = []; }
  }

  function saveStore() {
    try { localStorage.setItem(STORE, JSON.stringify(custom)); } catch (e) { /* 配额满了就算了 */ }
  }

  function all() { return BUILTIN.concat(custom); }

  function get(id) {
    var list = all();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function isCustom(id) {
    for (var i = 0; i < custom.length; i++) if (custom[i].id === id) return true;
    return false;
  }

  function cloneTpl(t) {
    return {
      id: t.id, name: t.name, base: t.base || 'swiss', sec: t.sec || '',
      accent: t.accent || INK, font: t.font || 'sans',
      density: t.density == null ? 50 : t.density,
      nameSize: t.nameSize || 26,
      photoSize: t.photoSize || 100,
    };
  }

  /* ---------------- 变量与套用 ---------------- */

  var FONTS = {
    sans: 'var(--f-display)',
    serif: 'var(--f-serif)',
    mono: 'var(--f-mono)',
  };

  /** 把模板参数写进 .paper 的 CSS 变量；base 决定 .style- 骨架 */
  function paint(paper, tpl) {
    if (!paper) return;
    var t = tpl || active() || BUILTIN[0];
    var base = t.base || 'swiss';
    paper.className = 'paper style-' + base;
    paper.removeAttribute('style');
    paper.removeAttribute('data-sec');

    var d = t.density == null ? 50 : Number(t.density);
    paper.style.setProperty('--t-accent', t.accent || INK);
    paper.style.setProperty('--t-sec-gap', (11 + d * 0.16).toFixed(1) + 'px');
    paper.style.setProperty('--t-item-gap', (7 + d * 0.14).toFixed(1) + 'px');
    paper.style.setProperty('--t-line', (1.46 + d * 0.0038).toFixed(3));
    paper.style.setProperty('--t-name-font', FONTS[t.font] || FONTS.sans);
    paper.style.setProperty('--t-name-size', (t.nameSize || 26) + 'pt');
    paper.style.setProperty('--t-photo-scale', (Number(t.photoSize) || 100) / 100);
    if (t.sec) paper.setAttribute('data-sec', t.sec);
  }

  /** 当前生效的模板（以 App 状态里的 tpl 为准） */
  function active() {
    var S = window.App && window.App.state;
    var id = (S && S.tpl) || 'swiss';
    return get(id) || get(S && S.style) || BUILTIN[0];
  }

  /* ---------------- 预览用的示意内容 ---------------- */

  function sampleModel() {
    return {
      name: '林亦安', intent: '前端工程师', photo: '',
      contact: [
        { label: '电话', value: '138 0000 0000' },
        { label: '邮箱', value: 'lin.yian@example.com' },
        { label: '城市', value: '上海' },
      ],
      sections: [
        { type: 'summary', heading: '个人简介', mode: 'para', chips: [], items: [],
          text: '5 年前端开发经验，主导过 3 个中后台系统从 0 到 1，擅长组件库建设与性能优化。' },
        { type: 'experience', heading: '工作经历', mode: 'list', chips: [], text: '', items: [
          { org: '××科技有限公司', role: '前端工程师', meta: '2021.03 — 至今', bullets: [
            '主导中后台组件库建设，覆盖 40+ 页面，交付效率提升 35%',
            '搭建前端监控与埋点体系，线上问题平均定位时间从 2 小时降到 15 分钟',
          ] },
          { org: '××网络科技', role: '前端开发', meta: '2019.07 — 2021.02', bullets: [
            '负责活动页与小程序开发，支撑大促峰值 12 万 QPS',
          ] },
        ] },
        { type: 'education', heading: '教育经历', mode: 'list', chips: [], text: '', items: [
          { org: '××大学', major: '计算机科学与技术', degree: '本科', meta: '2015.09 — 2019.06', bullets: [] },
        ] },
        { type: 'skills', heading: '专业技能', mode: 'chips', text: '', items: [],
          chips: ['TypeScript', 'React', 'Vue', 'Node.js', '性能优化', '工程化'] },
      ],
    };
  }

  /** 预览内容：优先用当前简历，避免用户看不到自己的名字 */
  function previewModel() {
    var S = window.App && window.App.state;
    var m = S && S.model;
    if (!m || !m.sections || !m.sections.length) return sampleModel();
    return m;
  }

  /** 在容器里渲染一张缩略图 */
  function renderShot(host, tpl) {
    host.innerHTML = '';
    var paper = document.createElement('div');
    host.appendChild(paper);
    try {
      window.ResumeRender.render(paper, previewModel(), { style: tpl.base || 'swiss', photo: false, template: tpl });
    } catch (e) {
      host.innerHTML = '<div class="tpl-empty">预览失败</div>';
    }
  }

  /* ---------------- 画廊 ---------------- */

  function renderGallery() {
    var box = $('tplGrid');
    if (!box) return;
    var cur = active();
    var list = tab === 'mine' ? custom : all();

    box.innerHTML = '';

    if (!list.length) {
      var em = document.createElement('div');
      em.className = 'tpl-empty';
      em.innerHTML = '还没有自己的模板。<br/>点右下角「新建模板」，调好颜色和标题样式后保存。';
      box.appendChild(em);
    }

    list.forEach(function (t) {
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'tpl-card' + (cur && cur.id === t.id ? ' is-on' : '');
      card.title = '点击应用「' + t.name + '」';

      var shot = document.createElement('div');
      shot.className = 'tpl-shot';

      var meta = document.createElement('div');
      meta.className = 'tpl-meta';

      var nm = document.createElement('span');
      nm.className = 'tpl-name';
      nm.textContent = t.name;

      var tag = document.createElement('span');
      tag.className = 'tpl-tag' + (isCustom(t.id) ? ' mine' : '');
      tag.textContent = isCustom(t.id) ? '我的' : (t.tag || '预设');

      meta.appendChild(nm);
      meta.appendChild(tag);

      var more = document.createElement('span');
      more.className = 'tpl-more';
      more.textContent = isCustom(t.id) ? '编辑' : '另存为';
      more.setAttribute('role', 'button');
      more.title = isCustom(t.id) ? '编辑这套模板' : '复制成我自己的模板';
      more.addEventListener('click', function (ev) {
        ev.stopPropagation();
        openEditor(isCustom(t.id) ? t : null, isCustom(t.id) ? null : t);
      });
      meta.appendChild(more);

      if (isCustom(t.id)) {
        var del = document.createElement('span');
        del.className = 'tpl-more';
        del.textContent = '删除';
        del.setAttribute('role', 'button');
        del.title = '删除这套模板';
        del.addEventListener('click', function (ev) {
          ev.stopPropagation();
          removeTpl(t);
        });
        meta.appendChild(del);
      }

      card.appendChild(shot);
      card.appendChild(meta);
      card.addEventListener('click', function () { use(t); });
      box.appendChild(card);

      renderShot(shot, t);
    });

    var cnt = $('tplCount');
    if (cnt) cnt.textContent = (tab === 'mine' ? custom.length : all().length) + ' 套';
  }

  function removeTpl(t) {
    if (!window.confirm('删除模板「' + t.name + '」？')) return;
    custom = custom.filter(function (x) { return x.id !== t.id; });
    saveStore();
    var S = window.App && window.App.state;
    if (S && S.tpl === t.id) {
      S.tpl = 'swiss';
      S.style = 'swiss';
      if (window.App.applyTemplate) window.App.applyTemplate(get('swiss'));
    }
    renderGallery();
    if ($('tplHint')) $('tplHint').textContent = '已删除「' + t.name + '」';
  }

  function use(t) {
    if (window.App && window.App.applyTemplate) window.App.applyTemplate(t);
    renderGallery();
    syncLabel();
    if ($('tplHint')) $('tplHint').textContent = '已应用「' + t.name + '」，可直接关闭';
  }

  /* ---------------- 编辑器 ---------------- */

  function openEditor(tpl, copyFrom) {
    editing = tpl || null;
    var src = tpl || copyFrom || { base: 'swiss', sec: 'line', accent: INK, font: 'sans', density: 50, nameSize: 26 };
    var t = cloneTpl(src);

    $('tplName').value = tpl ? tpl.name : (copyFrom ? copyFrom.name + ' 副本' : '我的模板');
    $('tplBase').value = t.base;
    $('tplSec').value = t.sec || 'line';
    $('tplFont').value = t.font;
    $('tplDensity').value = t.density;
    $('tplNameSize').value = t.nameSize;

    drawSwatches(t.accent);
    syncRangeLabels();

    $('tplGallery').hidden = true;
    $('tplTools').hidden = true;
    $('tplEditor').hidden = false;
    $('tplNew').hidden = true;
    $('tplSaveTpl').hidden = false;
    $('tplEditorBack').hidden = false;
    if ($('tplSub')) $('tplSub').textContent = tpl ? '修改这套模板，保存后立即套用到预览。' : '调一套自己的版式，保存后会出现在「我的模板」。';
    if ($('tplHint')) $('tplHint').textContent = '改动会实时预览';

    renderEditorPreview();
  }

  function closeEditor() {
    editing = null;
    $('tplEditor').hidden = true;
    $('tplGallery').hidden = false;
    $('tplTools').hidden = false;
    $('tplNew').hidden = false;
    $('tplSaveTpl').hidden = true;
    $('tplEditorBack').hidden = true;
    if ($('tplSub')) $('tplSub').textContent = '选一套现成的版式，或调一套自己的存下来。';
    if ($('tplHint')) $('tplHint').textContent = '点卡片即可应用';
  }

  function formTpl() {
    return {
      id: editing ? editing.id : 'my_' + Date.now().toString(36),
      name: ($('tplName').value || '').trim() || '未命名模板',
      base: $('tplBase').value,
      sec: $('tplSec').value === 'line' ? 'line' : $('tplSec').value,
      accent: $('tplAccent') ? $('tplAccent').value : INK,
      font: $('tplFont').value,
      density: Number($('tplDensity').value),
      nameSize: Number($('tplNameSize').value),
      photoSize: (editing && editing.photoSize) || 100,
    };
  }

  function renderEditorPreview() {
    var host = $('tplPreview');
    if (!host) return;
    var t = formTpl();
    host.innerHTML = '';
    var paper = document.createElement('div');
    host.appendChild(paper);
    try {
      window.ResumeRender.render(paper, previewModel(), { style: t.base, photo: false, template: t });
    } catch (e) {
      host.innerHTML = '<div class="tpl-empty">预览失败</div>';
    }
  }

  function drawSwatches(cur) {
    var box = $('tplSwatches');
    if (!box) return;
    box.innerHTML = '';
    var list = ACCENTS.slice();
    if (cur && list.indexOf(String(cur).toUpperCase()) < 0 && list.indexOf(cur) < 0) list.push(cur);

    list.forEach(function (c) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'tpl-sw' + (String(cur).toLowerCase() === c.toLowerCase() ? ' is-on' : '');
      b.style.background = c;
      b.title = c;
      b.addEventListener('click', function () {
        setAccent(c);
        drawSwatches(c);
      });
      box.appendChild(b);
    });

    var wrap = document.createElement('label');
    wrap.className = 'tpl-sw-custom';
    wrap.title = '自定义颜色';
    var input = document.createElement('input');
    input.type = 'color';
    input.id = 'tplAccent';
    input.value = /^#[0-9a-f]{6}$/i.test(cur) ? cur : INK;
    input.addEventListener('input', function () { setAccent(input.value); });
    wrap.appendChild(input);
    box.appendChild(wrap);
  }

  function setAccent(c) {
    var i = $('tplAccent');
    if (i) i.value = c;
    renderEditorPreview();
  }

  function syncRangeLabels() {
    var d = Number($('tplDensity').value);
    var dv = $('tplDensityVal');
    if (dv) dv.textContent = d < 32 ? '紧凑' : (d > 68 ? '宽松' : '标准');
    var nv = $('tplNameSizeVal');
    if (nv) nv.textContent = Number($('tplNameSize').value) + 'pt';
  }

  function saveTpl() {
    var t = formTpl();
    if (!t.name || t.name === '未命名模板') {
      if ($('tplHint')) $('tplHint').textContent = '先给模板起个名字';
      $('tplName').focus();
      return;
    }
    var i = -1;
    for (var k = 0; k < custom.length; k++) if (custom[k].id === t.id) i = k;
    if (i >= 0) custom[i] = t; else custom.push(t);
    saveStore();
    editing = null;

    if (window.App && window.App.applyTemplate) window.App.applyTemplate(t);
    closeEditor();
    renderGallery();
    syncLabel();
    if (window.App && window.App.toast) window.App.toast('模板「' + t.name + '」已保存并应用');
  }

  /* ---------------- 打开 / 关闭 ---------------- */

  function syncLabel() {
    var el = $('tplCurrentName');
    if (!el) return;
    var t = active();
    el.textContent = t ? t.name : '瑞士极简';
  }

  function open() {
    load();
    tab = 'all';
    document.querySelectorAll('#tplTools .tpl-tab').forEach(function (b) {
      b.classList.toggle('is-on', b.dataset.tab === 'all');
    });
    closeEditor();
    renderGallery();
    syncLabel();
    var ov = $('tplOverlay');
    if (ov) ov.hidden = false;
  }

  function bind() {
    var btn = $('btnTemplates');
    if (btn) btn.addEventListener('click', open);

    document.querySelectorAll('#tplTools .tpl-tab').forEach(function (b) {
      b.addEventListener('click', function () {
        tab = b.dataset.tab;
        document.querySelectorAll('#tplTools .tpl-tab').forEach(function (x) {
          x.classList.toggle('is-on', x === b);
        });
        renderGallery();
      });
    });

    var nw = $('tplNew');
    if (nw) nw.addEventListener('click', function () { openEditor(null, null); });

    var back = $('tplEditorBack');
    if (back) back.addEventListener('click', closeEditor);

    var sv = $('tplSaveTpl');
    if (sv) sv.addEventListener('click', saveTpl);

    var done = $('tplDone');
    if (done) done.addEventListener('click', function () {
      var ov = $('tplOverlay');
      if (ov) ov.hidden = true;
    });

    ['tplBase', 'tplSec', 'tplFont'].forEach(function (id) {
      var el = $(id);
      if (el) el.addEventListener('change', renderEditorPreview);
    });
    ['tplDensity', 'tplNameSize'].forEach(function (id) {
      var el = $(id);
      if (el) el.addEventListener('input', function () { syncRangeLabels(); renderEditorPreview(); });
    });
  }

  load();

  window.Templates = {
    BUILTIN: BUILTIN,
    list: all,
    get: get,
    active: active,
    paint: paint,
    open: open,
    syncLabel: syncLabel,
    /** 供 render.js 调用：把模板套到刚渲染好的 .paper 上 */
    apply: function (paper, tpl) { paint(paper, tpl || active()); },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();