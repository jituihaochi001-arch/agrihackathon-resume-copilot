/* library.js — 简历库：多份简历存档、模板画廊、导入与备份 */
(function () {
  'use strict';

  var INDEX_KEY = 'rp:lib:index';
  var DOC_KEY = 'rp:lib:doc:';
  var OLD_KEY = 'resume-polisher-v1';
  var $ = function (id) { return document.getElementById(id); };

  /* 九套模板：版式骨架与命名对齐 Magic Resume 的公开模板集
     （classic / modern / left-right / timeline / minimalist / elegant / creative / editorial / swiss）
     只描述版式参数，不复制任何受限字体或素材 */
  var TEMPLATES = [
    { id: 'lib-classic',  name: '经典模板',     base: 'classic',  sec: 'line',   accent: '#000000', font: 'serif', density: 50, nameSize: 22, desc: '传统简约的简历布局，适合大多数求职场景', tag: '经典' },
    { id: 'lib-twocol',   name: '两栏布局',     base: 'twocol',   sec: 'plain',  accent: '#000000', font: 'sans',  density: 48, nameSize: 24, desc: '经典两栏，突出个人特色', tag: '两栏' },
    { id: 'lib-band',     name: '模块标题背景色', base: 'band',   sec: 'fill',   accent: '#000000', font: 'sans',  density: 50, nameSize: 26, desc: '模块标题背景鲜明，突出美观特色', tag: '模块' },
    { id: 'lib-timeline', name: '时间轴布局',   base: 'timeline', sec: 'plain',  accent: '#18181B', font: 'sans',  density: 52, nameSize: 26, desc: '时间轴风格，突出经历的时间顺序', tag: '时间轴' },
    { id: 'lib-minimal',  name: '极简模板',     base: 'minimal',  sec: 'plain',  accent: '#171717', font: 'sans',  density: 72, nameSize: 28, desc: '大面积留白，干净纯粹的排版风格', tag: '极简' },
    { id: 'lib-elegant',  name: '优雅模板',     base: 'academic', sec: 'double', accent: '#18181B', font: 'serif', density: 56, nameSize: 24, desc: '居中标题单列设计，具有高级感的分隔线', tag: '优雅' },
    { id: 'lib-creative', name: '创意模板',     base: 'creative', sec: 'line',   accent: '#18181B', font: 'sans',  density: 48, nameSize: 28, desc: '视觉错落设计，灵动活泼展现个性', tag: '创意' },
    { id: 'lib-poster',   name: '画报风模板',   base: 'poster',   sec: 'line',   accent: '#000000', font: 'serif', density: 54, nameSize: 36, desc: '大号精美衬线体与窄体无衬线的完美结合，极具奢华感', tag: '画报' },
    { id: 'lib-swiss',    name: '瑞士美学',     base: 'swiss',    sec: 'thick',  accent: '#0F172A', font: 'sans',  density: 44, nameSize: 27, desc: '极具艺术感的包豪斯国际排版，超粗字重对比与几何色块点缀', tag: '瑞士' }
  ];

  var DEFAULT_TPL = 'lib-classic';

  /* ---------------- 基础工具 ---------------- */

  function now() { return Date.now(); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function uid(prefix) {
    return (prefix || 'r') + '_' + now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  }
  function readJson(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      var v = JSON.parse(raw);
      return v == null ? fallback : v;
    } catch (e) { return fallback; }
  }
  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { return false; }
  }

  /* ---------------- 本地文件夹备份（File System Access API） ---------------- */

  var dirHandle = null;
  var backupTimer = 0;
  var backupBusy = false;
  var IDB_NAME = 'rp-backup';
  var IDB_STORE = 'handles';

  function idb() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) { reject(new Error('no idb')); return; }
      var req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('idb')); };
    });
  }

  function idbGet(key) {
    return idb().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction(IDB_STORE, 'readonly');
        var g = tx.objectStore(IDB_STORE).get(key);
        g.onsuccess = function () { resolve(g.result || null); };
        g.onerror = function () { resolve(null); };
      });
    }).catch(function () { return null; });
  }

  function idbSet(key, value) {
    return idb().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(value, key);
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { resolve(false); };
      });
    }).catch(function () { return false; });
  }

  function backupPayload() {
    var docs = list().map(function (e) { return get(e.id); }).filter(Boolean);
    return {
      app: 'career-copilot',
      kind: 'resume-library',
      version: 1,
      exportedAt: new Date().toISOString(),
      docs: docs
    };
  }

  function stamp(dayOnly) {
    var d = new Date();
    var p = function (x) { return ('0' + x).slice(-2); };
    var s = d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate());
    return dayOnly ? s : s + '-' + p(d.getHours()) + p(d.getMinutes());
  }

  function hasDir() { return !!dirHandle; }

  function pickDir() {
    if (!window.showDirectoryPicker) {
      if (window.App && window.App.toast) window.App.toast('当前浏览器不支持指定备份文件夹，已改为导出 JSON 备份');
      exportAll();
      return;
    }
    window.showDirectoryPicker({ id: 'rp-backup', mode: 'readwrite' }).then(function (handle) {
      dirHandle = handle;
      idbSet('dir', handle);
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
      syncBackupUI();
      return writeBackup(true);
    }).then(function () {
      if (window.App && window.App.toast) window.App.toast('已设置备份文件夹，之后会自动写入');
    }).catch(function (err) {
      if (err && err.name === 'AbortError') return;
      if (window.App && window.App.toast) window.App.toast('无法使用该文件夹，已改为导出 JSON');
      exportAll();
    });
  }

  function writeBackup(force) {
    if (!dirHandle || backupBusy) return Promise.resolve(false);
    backupBusy = true;
    var text = JSON.stringify(backupPayload(), null, 2);
    var names = ['简历库-备份.json', '简历库-备份-' + stamp(true) + '.json'];
    var chain = Promise.resolve();
    names.forEach(function (name) {
      chain = chain.then(function () {
        return dirHandle.getFileHandle(name, { create: true }).then(function (fh) {
          return fh.createWritable();
        }).then(function (w) {
          return w.write(text).then(function () { return w.close(); });
        });
      });
    });
    return chain.then(function () {
      backupBusy = false;
      var note = $('libBackupText');
      if (note) note.textContent = '已备份到「' + dirHandle.name + '」· ' + timeLabel(Date.now());
      if (force && window.App && window.App.toast) window.App.toast('已写入备份文件夹');
      return true;
    }).catch(function (err) {
      backupBusy = false;
      if (err && err.name === 'NotAllowedError') {
        dirHandle = null;
        syncBackupUI();
        if (window.App && window.App.toast) window.App.toast('备份文件夹权限已失效，请重新选择');
      }
      return false;
    });
  }

  function queueBackup() {
    if (!dirHandle) return;
    clearTimeout(backupTimer);
    backupTimer = setTimeout(function () { writeBackup(false); }, 2400);
  }

  function syncBackupUI() {
    var btn = $('btnLibBackup');
    if (btn) btn.textContent = dirHandle ? '备份文件夹：' + dirHandle.name : '自动备份文件夹';
    var note = $('libBackupText');
    if (note && !dirHandle) {
      note.textContent = '每次保存都会写入本地；选一个文件夹后，还会定时写一份 JSON，换电脑也能带走。';
    }
  }

  /* ---------------- 模板 ---------------- */

  function getTemplate(id) {
    for (var i = 0; i < TEMPLATES.length; i++) if (TEMPLATES[i].id === id) return TEMPLATES[i];
    return null;
  }
  function template(id) {
    return getTemplate(id) || getTemplate(DEFAULT_TPL);
  }
  function themeFromTemplate(id) {
    var t = template(id);
    return { accent: t.accent, font: t.font, density: t.density, nameSize: t.nameSize, photoSize: t.photoSize || 100 };
  }
  function renderTemplate(id, theme) {
    var t = template(id);
    return {
      id: t.id, name: t.name, base: t.base, sec: t.sec,
      accent: (theme && theme.accent) || t.accent,
      font: (theme && theme.font) || t.font,
      density: theme && theme.density != null ? theme.density : t.density,
      nameSize: (theme && theme.nameSize) || t.nameSize,
      photoSize: (theme && theme.photoSize) || t.photoSize || 100
    };
  }

  /* ---------------- 模型 ---------------- */

  function section(type, heading, mode, order) {
    return {
      uid: uid('s'), type: type, en: enOf(type), heading: heading,
      mode: mode || 'entries', text: '', chips: [], items: [],
      visible: true, order: order || 0
    };
  }

  function enOf(type) {
    var map = {
      summary: 'PROFILE', education: 'EDUCATION', experience: 'EXPERIENCE',
      project: 'PROJECTS', campus: 'CAMPUS', skills: 'SKILLS', awards: 'HONORS',
      language: 'LANGUAGES', portfolio: 'PORTFOLIO', other: 'ADDITIONAL'
    };
    return map[type] || 'SECTION';
  }

  function blankItem() {
    return { uid: uid('i'), org: '', role: '', degree: '', major: '', place: '', meta: '', bullets: [] };
  }

  function blankModel() {
    return {
      name: '', intent: '', photo: '', contact: [],
      sourceKind: '', unstructured: false,
      sections: [
        section('summary', '自我评价', 'para', 0),
        section('experience', '工作经历', 'entries', 1),
        section('project', '项目经历', 'entries', 2),
        section('education', '教育经历', 'entries', 3),
        section('skills', '专业技能', 'chips', 4)
      ]
    };
  }

  function normalizeModel(model) {
    var m = model || blankModel();
    if (!Array.isArray(m.contact)) m.contact = [];
    if (!Array.isArray(m.sections)) m.sections = [];
    m.name = String(m.name || '');
    m.intent = String(m.intent || '');
    m.photo = String(m.photo || '');
    m.contact = m.contact.filter(function (c) { return c && (c.label || c.value); });
    m.sections.forEach(function (s, i) {
      if (!s.uid) s.uid = uid('s');
      s.type = s.type || 'other';
      s.en = s.en || enOf(s.type);
      s.heading = String(s.heading || '未命名模块');
      s.mode = s.mode || 'entries';
      s.text = String(s.text || '');
      if (!Array.isArray(s.chips)) s.chips = [];
      if (!Array.isArray(s.items)) s.items = [];
      if (s.visible == null) s.visible = true;
      if (s.order == null) s.order = i;
      s.items.forEach(function (it) {
        if (!it.uid) it.uid = uid('i');
        it.org = String(it.org || '');
        it.role = String(it.role || '');
        it.degree = String(it.degree || '');
        it.major = String(it.major || '');
        it.place = String(it.place || '');
        it.meta = String(it.meta || '');
        if (!Array.isArray(it.bullets)) it.bullets = [];
      });
    });
    return m;
  }

  function normalizeDoc(doc) {
    if (!doc || !doc.id) return null;
    doc.title = String(doc.title || '');
    doc.template = getTemplate(doc.template) ? doc.template : DEFAULT_TPL;
    var t = template(doc.template);
    doc.theme = doc.theme || {};
    doc.theme.accent = doc.theme.accent || t.accent;
    doc.theme.font = doc.theme.font || t.font;
    doc.theme.density = doc.theme.density == null ? t.density : +doc.theme.density;
    doc.theme.nameSize = doc.theme.nameSize == null ? t.nameSize : +doc.theme.nameSize;
    doc.theme.photoSize = doc.theme.photoSize == null ? (t.photoSize || 100) : +doc.theme.photoSize;
    doc.model = normalizeModel(doc.model);
    doc.createdAt = doc.createdAt || now();
    doc.updatedAt = doc.updatedAt || doc.createdAt;
    doc.jd = String(doc.jd || '');
    return doc;
  }

  function visibleModel(doc) {
    var m = clone(doc.model);
    m.sections = (m.sections || []).filter(function (s) { return s.visible !== false; });
    m.sections.sort(function (a, b) {
      var ao = a.order == null ? 9999 : a.order;
      var bo = b.order == null ? 9999 : b.order;
      return ao - bo;
    });
    return m;
  }

  /** 解析结果 → 库文档 */
  function fromParsed(parsed, opts) {
    opts = opts || {};
    var model = normalizeModel(parsed);
    var tpl = opts.template && getTemplate(opts.template) ? opts.template : DEFAULT_TPL;
    var doc = {
      id: uid('doc'),
      title: opts.title || (model.name ? model.name + '的简历' : '我的简历'),
      template: tpl,
      theme: themeFromTemplate(tpl),
      model: model,
      jd: opts.jd || '',
      createdAt: now(),
      updatedAt: now()
    };
    // 导入的简历默认按内容量给一个更合适的密度
    if (opts.keepDensity !== true) {
      var n = textOf(model).replace(/\s/g, '').length;
      if (n > 2400) doc.theme.density = 34;
      else if (n > 1600) doc.theme.density = 42;
    }
    return normalizeDoc(doc);
  }

  function blankDoc(templateId) {
    var tpl = getTemplate(templateId) ? templateId : DEFAULT_TPL;
    return normalizeDoc({
      id: uid('doc'),
      title: '',
      template: tpl,
      theme: themeFromTemplate(tpl),
      model: blankModel(),
      jd: '',
      createdAt: now(),
      updatedAt: now()
    });
  }

  function textOf(model) {
    if (window.ResumeModel && window.ResumeModel.toText) return window.ResumeModel.toText(model);
    var out = [model.name, model.intent];
    (model.contact || []).forEach(function (c) { out.push(c.value); });
    (model.sections || []).forEach(function (s) {
      out.push(s.heading, s.text);
      (s.chips || []).forEach(function (c) { out.push(c); });
      (s.items || []).forEach(function (it) {
        out.push(it.org, it.role, it.major, it.degree, it.meta);
        (it.bullets || []).forEach(function (b) { out.push(b); });
      });
    });
    return out.filter(Boolean).join('\n');
  }

  /* ---------------- 存储 ---------------- */

  function readIndex() {
    var v = readJson(INDEX_KEY, []);
    if (!Array.isArray(v)) return [];
    return v.filter(function (x) { return x && x.id; });
  }

  function writeIndex(list) {
    try { localStorage.setItem(INDEX_KEY, JSON.stringify(list)); return true; }
    catch (e) { return false; }
  }

  function entryOf(doc) {
    return {
      id: doc.id,
      title: doc.title || (doc.model && doc.model.name ? doc.model.name + '的简历' : '未命名简历'),
      name: (doc.model && doc.model.name) || '',
      template: doc.template,
      updatedAt: doc.updatedAt || now(),
      createdAt: doc.createdAt || now(),
      chars: textOf(doc.model).replace(/\s/g, '').length
    };
  }

  function save(doc) {
    if (!doc || !doc.id) throw new Error('简历数据无效');
    doc.updatedAt = now();
    normalizeDoc(doc);
    var json = JSON.stringify(doc);
    try {
      localStorage.setItem(DOC_KEY + doc.id, json);
    } catch (e) {
      throw new Error('浏览器存储空间不足，请先导出备份并删除部分旧简历');
    }
    var list = readIndex().filter(function (x) { return x.id !== doc.id; });
    list.push(entryOf(doc));
    list.sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
    if (!writeIndex(list)) {
      // 索引写不进去时，至少让列表能从文档键恢复
      throw new Error('浏览器存储空间不足，无法更新简历列表');
    }
    queueBackup();
    return doc;
  }

  function get(id) {
    if (!id) return null;
    var doc = readJson(DOC_KEY + id, null);
    return doc ? normalizeDoc(doc) : null;
  }

  function list() {
    return readIndex().slice().sort(function (a, b) {
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
  }

  function latest() {
    var l = list();
    return l.length ? get(l[0].id) : null;
  }

  function remove(id) {
    try { localStorage.removeItem(DOC_KEY + id); } catch (e) {}
    writeIndex(readIndex().filter(function (x) { return x.id !== id; }));
  }

  function duplicate(id) {
    var src = get(id);
    if (!src) return null;
    var copy = clone(src);
    copy.id = uid('doc');
    copy.title = (src.title || '未命名简历') + ' 副本';
    copy.createdAt = now();
    copy.updatedAt = now();
    copy.model.sections.forEach(function (s) {
      s.uid = uid('s');
      (s.items || []).forEach(function (it) { it.uid = uid('i'); });
    });
    return save(copy);
  }

  function exportAll() {
    var payload = backupPayload();
    var docs = payload.docs;
    var name = '简历库备份-' + stamp() + '.json';
    if (window.ResumeRender) {
      window.ResumeRender.download(name, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
    } else {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
      a.download = name;
      a.click();
    }
    if (window.App && window.App.toast) window.App.toast('已导出 ' + docs.length + ' 份简历');
  }

  function importAll(text) {
    var payload;
    try { payload = JSON.parse(text); } catch (e) { throw new Error('这不是有效的 JSON 备份文件'); }
    var docs = payload && (payload.docs || (payload.app === 'career-copilot' ? [] : null));
    if (!Array.isArray(docs)) throw new Error('备份里没有找到简历数据');
    var ids = {};
    var n = 0;
    docs.forEach(function (raw) {
      var doc = normalizeDoc(raw);
      if (!doc) return;
      if (ids[doc.id] || get(doc.id)) doc.id = uid('doc');
      ids[doc.id] = true;
      doc.model.sections.forEach(function (s) {
        s.uid = uid('s');
        (s.items || []).forEach(function (it) { it.uid = uid('i'); });
      });
      save(doc);
      n += 1;
    });
    render();
    return n;
  }

  /* ---------------- 旧版迁移 ---------------- */

  function migrateOld() {
    if (readIndex().length) return;
    var old = readJson(OLD_KEY, null);
    if (!old || !old.r) return;
    try {
      var model = window.ResumeModel.parse(old.r, { photo: old.photo || '', sourceKind: '' });
      var title = model.name ? model.name + '的简历' : fileNameTitle(old.n) || '我的简历';
      var tpl = mapOldTemplate(old.tpl || old.style);
      var doc = fromParsed(model, { title: title, template: tpl, keepDensity: true });
      save(doc);
    } catch (e) { /* 迁移失败不影响新库使用 */ }
  }

  function mapOldTemplate(id) {
    var map = {
      swiss: 'lib-swiss', classic: 'lib-classic', academic: 'lib-elegant',
      navy: 'lib-band', forest: 'lib-timeline', wine: 'lib-elegant',
      warm: 'lib-poster', compact: 'lib-swiss', airy: 'lib-minimal',
      mono: 'lib-swiss'
    };
    return map[id] || DEFAULT_TPL;
  }

  function fileNameTitle(name) {
    return String(name || '').replace(/\.[^.]+$/, '').trim();
  }

  /* ---------------- 缩略图 ---------------- */

  function renderThumb(host, doc, opts) {
    opts = opts || {};
    host.innerHTML = '';
    // 空白简历不画一张空纸，直接标明模板，避免像加载失败
    if (!textOf(doc.model).replace(/\s/g, '')) {
      host.classList.add('is-empty');
      host.innerHTML = '<div class="lib-thumb-empty"><b>' + esc(template(doc.template).name) + '</b><span>空白简历 · 点开填写</span></div>';
      return;
    }
    host.classList.remove('is-empty');
    var paper = document.createElement('div');
    host.appendChild(paper);
    try {
      window.ResumeRender.render(paper, visibleModel(doc), {
        style: template(doc.template).base,
        photo: false,
        template: renderTemplate(doc.template, doc.theme)
      });
      paper.classList.add('lib-paper');
    } catch (e) {
      host.innerHTML = '<div class="lib-thumb-fail">预览失败</div>';
    }
  }

  function fitShots(root) {
    var shots = (root || document).querySelectorAll('.lib-shot, .lib-tpl-shot');
    Array.prototype.forEach.call(shots, function (shot) {
      var paper = shot.querySelector('.paper');
      if (!paper) return;
      var w = shot.clientWidth || 220;
      var s = w / 794;
      paper.style.transform = 'scale(' + s + ')';
      paper.style.transformOrigin = 'top left';
    });
  }

  function scheduleFit() {
    requestAnimationFrame(function () { fitShots(document); });
  }

  /* ---------------- 简历库页面 ---------------- */

  function card(doc) {
    var el = document.createElement('article');
    el.className = 'lib-card';
    el.dataset.id = doc.id;

    var thumb = document.createElement('button');
    thumb.type = 'button';
    thumb.className = 'lib-thumb';
    thumb.dataset.act = 'edit';
    thumb.title = '编辑这份简历';

    var shot = document.createElement('div');
    shot.className = 'lib-shot';
    thumb.appendChild(shot);

    var acts = document.createElement('div');
    acts.className = 'lib-card-acts';
    acts.innerHTML =
      '<button type="button" data-act="edit">编辑</button>' +
      '<button type="button" data-act="duplicate">复制</button>' +
      '<button type="button" data-act="optimize">优化</button>' +
      '<button type="button" data-act="delete" class="is-danger">删除</button>';

    var meta = document.createElement('div');
    meta.className = 'lib-card-meta';
    var title = doc.title || (doc.model.name ? doc.model.name + '的简历' : '未命名简历');
    meta.innerHTML =
      '<b class="lib-name">' + esc(title) + '</b>' +
      '<span class="lib-sub">' + esc(template(doc.template).name) + ' · ' + esc(timeLabel(doc.updatedAt)) + '</span>';

    el.appendChild(thumb);
    el.appendChild(meta);
    el.appendChild(acts);
    renderThumb(shot, doc);
    return el;
  }

  function newCard() {
    var el = document.createElement('article');
    el.className = 'lib-card lib-new';
    el.dataset.act = 'new';
    el.innerHTML =
      '<button type="button" class="lib-new-thumb" data-act="new">' +
        '<span class="lib-plus">＋</span>' +
        '<b>新建简历</b>' +
        '<span>选模板，套用示例</span>' +
      '</button>' +
      '<div class="lib-new-foot">9 套模板 · 随时可换</div>';
    return el;
  }

  function render() {
    var grid = $('libGrid');
    if (!grid) return;
    var items = list();
    grid.innerHTML = '';
    grid.appendChild(newCard());
    items.forEach(function (e) {
      var doc = get(e.id);
      if (doc) grid.appendChild(card(doc));
    });
    var empty = $('libEmpty');
    if (empty) empty.hidden = items.length > 0;
    var count = $('libCount');
    if (count) count.textContent = items.length + ' 份';
    scheduleFit();
  }

  function timeLabel(ts) {
    if (!ts) return '刚刚';
    var d = new Date(ts);
    var n = new Date();
    var p = function (x) { return ('0' + x).slice(-2); };
    var sameDay = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
    if (sameDay) return '今天 ' + p(d.getHours()) + ':' + p(d.getMinutes());
    var y = new Date(n.getTime() - 86400000);
    if (d.getFullYear() === y.getFullYear() && d.getMonth() === y.getMonth() && d.getDate() === y.getDate()) {
      return '昨天 ' + p(d.getHours()) + ':' + p(d.getMinutes());
    }
    if (d.getFullYear() === n.getFullYear()) return (d.getMonth() + 1) + '月' + d.getDate() + '日';
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  /* ---------------- 模板画廊 ---------------- */

  /** 新建简历的示例内容：沿用「张明」的数据分析师示例，
   *  模板画廊的缩略图与新简历正文共用这一份，保证「看到什么就得到什么」。 */
  function sampleModel() {
    if (sampleModel._cache) return sampleModel._cache;
    var summary = section('summary', '个人简介', 'para', 0);
    summary.text = '3 年数据分析经验，负责用户增长与经营分析；擅长用 SQL / Python 完成取数与建模，' +
      '独立负责过会员分层与 AB 实验，能把分析结论落成可执行的运营策略。';

    var exp = section('experience', '工作经历', 'entries', 1);
    exp.items = [
      {
        uid: uid('i'), org: '联和数字科技有限公司', role: '数据分析师', degree: '', major: '', place: '',
        meta: '2020.07 — 至今',
        bullets: [
          '负责用户行为数据的日常提取与看板维护，支撑运营与产品团队的指标查询',
          '参与增长活动的效果评估，输出活动复盘报告，沉淀可复用的分析模板',
          '协助业务部门做月度经营分析，统一并维护核心指标的统计口径',
          '输出用户分层名单，支持精细化运营，分层人群的复购率提升 12%'
        ]
      },
      {
        uid: uid('i'), org: '星图市场咨询', role: '数据分析实习生', degree: '', major: '', place: '',
        meta: '2019.07 — 2019.12',
        bullets: [
          '参与问卷数据清洗与编码，整理样本结构与回收质量报告',
          '协助撰写行业研究报告的部分章节，负责图表与数据核对'
        ]
      }
    ];

    var proj = section('project', '项目经历', 'entries', 2);
    proj.items = [{
      uid: uid('i'), org: '会员复购提升项目', role: '分析负责人', degree: '', major: '', place: '',
      meta: '2021.03 — 2021.09',
      bullets: [
        '搭建会员分层的标签体系，输出高价值、成长、沉睡三层人群定义',
        '设计复购策略的 AB 实验并负责结果回收，验证优惠力度与触达时机的组合效果',
        '输出项目复盘报告，将分层方法固化为标准分析流程，复购率提升 9%'
      ]
    }];

    var edu = section('education', '教育经历', 'entries', 3);
    edu.items = [{
      uid: uid('i'), org: '华东理工大学', role: '', degree: '本科', major: '统计学', place: '',
      meta: '2016.09 — 2020.06',
      bullets: [
        '主修概率论与数理统计、多元统计分析、数据库原理、抽样调查',
        '校级一等奖学金（2018）；CET-6'
      ]
    }];

    var skills = section('skills', '专业技能', 'chips', 4);
    skills.chips = ['SQL', 'Python', 'Excel', 'Tableau', 'Hive', '统计学', 'AB 实验', '数据可视化'];

    sampleModel._cache = normalizeModel({
      name: '张明',
      intent: '数据分析师',
      photo: '',
      contact: [
        { label: '电话', value: '13800001111' },
        { label: '邮箱', value: 'zhangming.ds@mail.com' },
        { label: '城市', value: '上海' }
      ],
      sourceKind: '', unstructured: false,
      sections: [summary, exp, proj, edu, skills]
    });
    return sampleModel._cache;
  }

  function sampleDoc(templateId) {
    var tpl = getTemplate(templateId) ? templateId : DEFAULT_TPL;
    return normalizeDoc({
      id: uid('doc'),
      title: '张明的简历',
      template: tpl,
      theme: themeFromTemplate(tpl),
      model: clone(sampleModel()),
      jd: '',
      createdAt: now(), updatedAt: now()
    });
  }

  function galleryDoc(tplId) {
    var tpl = template(tplId);
    return normalizeDoc({
      id: 'preview',
      title: tpl.name,
      template: tpl.id,
      theme: themeFromTemplate(tpl.id),
      model: clone(sampleModel()),
      createdAt: now(), updatedAt: now()
    });
  }

  function ensureGallery() {
    if ($('libTplOverlay')) return;
    var html =
      '<div class="overlay" id="libTplOverlay" hidden>' +
        '<div class="paste-panel lib-tpl-panel">' +
          '<div class="panel-head">' +
            '<div><span class="block-label">从模板开始</span>' +
            '<p class="panel-sub">模板只决定版式，内容随时可改，也可以之后在编辑器里换。</p></div>' +
            '<button class="icon-btn" type="button" data-close="libTplOverlay">×</button>' +
          '</div>' +
          '<div class="lib-tpl-body"><div class="lib-tpl-grid" id="libTplGrid"></div></div>' +
          '<div class="panel-foot">' +
            '<span class="hint-inline">选模板会带一份示例简历，直接改成自己的即可</span>' +
            '<div class="iv-report-actions">' +
              '<button class="line-btn" type="button" id="libTplBlank">从空白开始</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.insertAdjacentHTML('beforeend', html);
    $('libTplBlank').addEventListener('click', function () { createFromTemplate(DEFAULT_TPL, true); });
  }

  function renderGallery() {
    var grid = $('libTplGrid');
    if (!grid) return;
    grid.innerHTML = '';
    TEMPLATES.forEach(function (t) {
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'lib-tpl-card';
      card.dataset.tpl = t.id;
      card.innerHTML =
        '<span class="lib-tpl-shot"></span>' +
        '<span class="lib-tpl-meta"><b>' + esc(t.name) + '</b><em>' + esc(t.desc) + '</em></span>' +
        '<span class="lib-tpl-tag">' + esc(t.tag) + '</span>';
      grid.appendChild(card);
      renderThumb(card.querySelector('.lib-tpl-shot'), galleryDoc(t.id));
    });
    scheduleFit();
  }

  function openGallery() {
    ensureGallery();
    renderGallery();
    $('libTplOverlay').hidden = false;
  }

  function createFromTemplate(tplId, blank) {
    var doc = blank ? blankDoc(tplId) : sampleDoc(tplId);
    try { save(doc); } catch (e) {
      if (window.App && window.App.toast) window.App.toast(e.message);
      return;
    }
    if ($('libTplOverlay')) $('libTplOverlay').hidden = true;
    render();
    if (window.App && window.App.openEditor) window.App.openEditor(doc.id);
  }

  /* ---------------- 选简历 ---------------- */

  function ensurePicker() {
    if ($('libPickOverlay')) return;
    var html =
      '<div class="overlay" id="libPickOverlay" hidden>' +
        '<div class="paste-panel lib-pick-panel">' +
          '<div class="panel-head">' +
            '<div><span class="block-label">从简历库选择</span>' +
            '<p class="panel-sub">选中的简历会载入优化台，原文件不会被改动。</p></div>' +
            '<button class="icon-btn" type="button" data-close="libPickOverlay">×</button>' +
          '</div>' +
          '<div class="lib-pick-body"><div class="lib-pick-grid" id="libPickGrid"></div></div>' +
        '</div>' +
      '</div>';
    document.body.insertAdjacentHTML('beforeend', html);
  }

  var pickCallback = null;

  function pickDoc(cb) {
    ensurePicker();
    pickCallback = cb || null;
    var grid = $('libPickGrid');
    grid.innerHTML = '';
    var items = list();
    if (!items.length) {
      grid.innerHTML = '<div class="lib-empty-inline">简历库还是空的，先在「我的简历」里新建或导入一份。</div>';
    }
    items.forEach(function (e) {
      var doc = get(e.id);
      if (!doc) return;
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'lib-pick-card';
      b.dataset.id = doc.id;
      b.innerHTML =
        '<span class="lib-shot"></span>' +
        '<span class="lib-pick-meta"><b>' + esc(doc.title || '未命名简历') + '</b>' +
        '<em>' + esc(template(doc.template).name) + ' · ' + esc(timeLabel(doc.updatedAt)) + '</em></span>';
      grid.appendChild(b);
      renderThumb(b.querySelector('.lib-shot'), doc);
    });
    $('libPickOverlay').hidden = false;
    scheduleFit();
  }

  /* ---------------- 导入 ---------------- */

  function importFile(file) {
    if (!file) return;
    if (window.App && window.App.toast) window.App.toast('正在解析简历…');
    window.ResumeParse.readFile(file).then(function (res) {
      if (!res || !res.text || !res.text.replace(/\s/g, '')) throw new Error('没有读到简历文字');
      var model = window.ResumeModel.parse(res.text, { photo: res.photo || '', sourceKind: res.kind || '' });
      var doc = fromParsed(model, {
        title: model.name ? model.name + '的简历' : (fileNameTitle(file.name) || '我的简历')
      });
      save(doc);
      render();
      if (window.App && window.App.openEditor) window.App.openEditor(doc.id);
      if (window.App && window.App.toast) window.App.toast('已解析并存入简历库');
    }).catch(function (err) {
      if (window.App && window.App.toast) window.App.toast(err && err.message ? err.message : '导入失败');
    });
  }

  /* ---------------- 初始化 ---------------- */

  function bind() {
    var grid = $('libGrid');
    if (grid) {
      grid.addEventListener('click', function (e) {
        var hit = e.target.closest('[data-act]');
        if (!hit) return;
        var cardEl = hit.closest('.lib-card');
        var id = cardEl && cardEl.dataset.id;
        var act = hit.dataset.act;
        if (act === 'new') { openGallery(); return; }
        if (!id) return;
        if (act === 'edit') {
          if (window.App && window.App.openEditor) window.App.openEditor(id);
        } else if (act === 'duplicate') {
          var copy = duplicate(id);
          render();
          if (copy && window.App && window.App.toast) window.App.toast('已复制为「' + copy.title + '」');
        } else if (act === 'optimize') {
          var doc = get(id);
          if (doc && window.App && window.App.loadDoc) {
            window.App.loadDoc(doc, true);
          }
        } else if (act === 'delete') {
          var d = get(id);
          if (!d) return;
          if (!window.confirm('删除「' + (d.title || '未命名简历') + '」？此操作不可撤销。')) return;
          remove(id);
          render();
          if (window.App && window.App.toast) window.App.toast('已删除');
        }
      });
    }

    var bn = $('btnLibNew');
    if (bn) bn.addEventListener('click', openGallery);
    var bi = $('btnLibImport');
    if (bi) bi.addEventListener('click', function () { if ($('fileLibImport')) $('fileLibImport').click(); });
    var fi = $('fileLibImport');
    if (fi) fi.addEventListener('change', function () {
      importFile(this.files && this.files[0]);
      this.value = '';
    });

    var be = $('btnLibExport');
    if (be) be.addEventListener('click', exportAll);
    var bb = $('btnLibBackup');
    if (bb) bb.addEventListener('click', pickDir);
    var bn2 = $('btnLibBackupNow');
    if (bn2) bn2.addEventListener('click', function () {
      if (dirHandle) writeBackup(true);
      else exportAll();
    });
    var br = $('btnLibRestore');
    if (br) br.addEventListener('click', function () { if ($('fileLibBackup')) $('fileLibBackup').click(); });
    var fb = $('fileLibBackup');
    if (fb) fb.addEventListener('change', function () {
      var f = this.files && this.files[0];
      var self = this;
      if (!f) return;
      f.text().then(function (txt) {
        var n = importAll(txt);
        if (window.App && window.App.toast) window.App.toast('已导入 ' + n + ' 份简历');
      }).catch(function (err) {
        if (window.App && window.App.toast) window.App.toast(err && err.message ? err.message : '导入失败');
      }).then(function () { self.value = ''; });
    });

    // 模板画廊 / 选简历：动态生成，事件委托到 body
    document.addEventListener('click', function (e) {
      var tpl = e.target.closest('#libTplGrid [data-tpl]');
      if (tpl) { createFromTemplate(tpl.dataset.tpl); return; }
      var pick = e.target.closest('#libPickGrid [data-id]');
      if (pick) {
        var doc = get(pick.dataset.id);
        if (doc && pickCallback) pickCallback(doc);
        if ($('libPickOverlay')) $('libPickOverlay').hidden = true;
      }
    });

    var rt = 0;
    window.addEventListener('resize', function () {
      clearTimeout(rt);
      rt = setTimeout(function () { fitShots(document); }, 120);
    });
  }

  function init() {
    migrateOld();
    bind();
    ensureGallery();
    ensurePicker();
    render();
    // 恢复上次选择的备份文件夹；浏览器要求用户手势才能重新授权，失败时保持未设置
    idbGet('dir').then(function (handle) {
      if (!handle) return;
      dirHandle = handle;
      syncBackupUI();
      // 每 5 分钟自动写一次，页面关闭前再补一次
      setInterval(function () { writeBackup(false); }, 5 * 60 * 1000);
    });
    window.addEventListener('beforeunload', function () {
      if (dirHandle) writeBackup(false);
    });
  }

  window.ResumeLib = {
    TEMPLATES: TEMPLATES,
    DEFAULT_TPL: DEFAULT_TPL,
    template: template,
    renderTemplate: renderTemplate,
    themeFromTemplate: themeFromTemplate,
    blankModel: blankModel,
    blankDoc: blankDoc,
    sampleDoc: sampleDoc,
    sampleModel: sampleModel,
    blankItem: blankItem,
    section: section,
    normalizeModel: normalizeModel,
    normalizeDoc: normalizeDoc,
    visibleModel: visibleModel,
    fromParsed: fromParsed,
    textOf: textOf,
    save: save,
    get: get,
    list: list,
    latest: latest,
    remove: remove,
    duplicate: duplicate,
    exportAll: exportAll,
    importAll: importAll,
    importFile: importFile,
    openGallery: openGallery,
    pickDoc: pickDoc,
    render: render,
    timeLabel: timeLabel,
    getTemplate: getTemplate,
    writeBackup: writeBackup,
    hasBackupDir: hasDir,
    init: init
  };
})();