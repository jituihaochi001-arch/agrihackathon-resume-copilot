/* model.js — 纯文本简历 → 结构化模型 */
(function () {
  'use strict';

  var HEADINGS = [
    { type: 'summary',    en: 'PROFILE',    names: ['个人简介', '自我评价', '个人优势', '个人总结', '核心优势', '自我介绍', '关于我', '个人评价', '优势亮点', '个人概述'] },
    { type: 'education',  en: 'EDUCATION',  names: ['教育背景', '教育经历', '学习经历', '教育情况', '教育'] },
    { type: 'experience', en: 'EXPERIENCE', names: ['工作经历', '工作经验', '职业经历', '工作履历', '实习经历', '实习经验', '工作及实习经历', '工作与实习经历', '职业履历', '工作实践'] },
    { type: 'project',    en: 'PROJECTS',   names: ['项目经历', '项目经验', '主要项目', '项目实践', '项目'] },
    { type: 'campus',     en: 'CAMPUS',     names: ['校园经历', '社团经历', '在校经历', '校园实践', '学生工作'] },
    { type: 'skills',     en: 'SKILLS',     names: ['专业技能', '技能特长', '技能清单', 'IT技能', '技术栈', '专业能力', '技能'] },
    { type: 'awards',     en: 'HONORS',     names: ['荣誉奖项', '获奖情况', '荣誉证书', '所获荣誉', '资质证书', '证书', '奖项', '荣誉'] },
    { type: 'language',   en: 'LANGUAGES',  names: ['语言能力', '语言水平', '外语水平', '语言'] },
    { type: 'other',      en: 'ADDITIONAL', names: ['兴趣爱好', '其他', '附加信息', '其他信息', '个人爱好', '补充信息'] }
  ];

  var ALIAS = {};
  HEADINGS.forEach(function (h) {
    h.names.forEach(function (n) { ALIAS[n] = h; });
  });

  var DR = /((?:19|20)\d{2}\s*[.\-\/年]?\s*(?:0?[1-9]|1[0-2])?\s*月?)\s*[-—–~～至到]+\s*((?:(?:19|20)\d{2}\s*[.\-\/年]?\s*(?:0?[1-9]|1[0-2])?\s*月?)|至今|现在|今|present|Present|PRESENT)(?!\d)/;
  var ROLE_WORD = /(经理|专员|主管|总监|工程师|分析师|设计师|顾问|助理|实习生|负责人|会计|出纳|法务|开发|运营|销售|研究员|架构师|店长|实习|Leader|Manager|Intern)/i;
  var DEGREE = /(博士|硕士|研究生|本科|学士|大专|专科|高中|MBA|EMBA|Ph\.?D|Master|Bachelor)/i;
  var ORG_WORD = /(公司|集团|科技|有限|股份|银行|证券|保险|大学|学院|学校|中学|医院|事务所|研究院|研究所|中心|工作室|事业部|分公司|工作室|Inc|Ltd|Co\.|Corp)/i;
  // 城市词表：覆盖全国地级市 + 常见海外城市
  var CITIES = ('北京 上海 天津 重庆 广州 深圳 珠海 汕头 佛山 韶关 湛江 肇庆 江门 茂名 惠州 梅州 汕尾 河源 阳江 清远 ' +
    '东莞 中山 潮州 揭阳 云浮 杭州 宁波 温州 嘉兴 湖州 绍兴 金华 衢州 舟山 台州 丽水 ' +
    '南京 无锡 徐州 常州 苏州 南通 连云港 淮安 盐城 扬州 镇江 泰州 宿迁 ' +
    '合肥 芜湖 蚌埠 淮南 马鞍山 淮北 铜陵 安庆 黄山 滁州 阜阳 宿州 六安 亳州 池州 宣城 ' +
    '福州 厦门 莆田 三明 泉州 漳州 南平 龙岩 宁德 ' +
    '南昌 景德镇 萍乡 九江 新余 鹰潭 赣州 吉安 宜春 抚州 上饶 ' +
    '济南 青岛 淄博 枣庄 东营 烟台 潍坊 济宁 泰安 威海 日照 临沂 德州 聊城 滨州 菏泽 ' +
    '郑州 开封 洛阳 平顶山 安阳 鹤壁 新乡 焦作 濮阳 许昌 漯河 三门峡 南阳 商丘 信阳 周口 驻马店 ' +
    '武汉 黄石 十堰 宜昌 襄阳 鄂州 荆门 孝感 荆州 黄冈 咸宁 随州 恩施 ' +
    '长沙 株洲 湘潭 衡阳 邵阳 岳阳 常德 张家界 益阳 郴州 永州 怀化 娄底 湘西 ' +
    '南宁 柳州 桂林 梧州 北海 防城港 钦州 贵港 玉林 百色 贺州 河池 来宾 崇左 ' +
    '海口 三亚 三沙 儋州 琼海 文昌 万宁 ' +
    '成都 自贡 攀枝花 泸州 德阳 绵阳 广元 遂宁 内江 乐山 南充 眉山 宜宾 广安 达州 雅安 巴中 资阳 西昌 ' +
    '贵阳 六盘水 遵义 安顺 毕节 铜仁 凯里 都匀 ' +
    '昆明 曲靖 玉溪 保山 昭通 丽江 普洱 临沧 大理 楚雄 ' +
    '西安 铜川 宝鸡 咸阳 渭南 延安 汉中 榆林 安康 商洛 ' +
    '兰州 嘉峪关 金昌 白银 天水 武威 张掖 平凉 酒泉 庆阳 定西 陇南 敦煌 ' +
    '西宁 海东 格尔木 银川 石嘴山 吴忠 固原 中卫 ' +
    '乌鲁木齐 克拉玛依 吐鲁番 哈密 石河子 伊宁 喀什 阿克苏 库尔勒 昌吉 奎屯 ' +
    '呼和浩特 包头 乌海 赤峰 通辽 鄂尔多斯 呼伦贝尔 巴彦淖尔 乌兰察布 ' +
    '沈阳 大连 鞍山 抚顺 本溪 丹东 锦州 营口 阜新 辽阳 盘锦 铁岭 朝阳 葫芦岛 ' +
    '长春 吉林 四平 辽源 通化 白山 松原 白城 延吉 ' +
    '哈尔滨 齐齐哈尔 鸡西 鹤岗 双鸭山 大庆 伊春 佳木斯 七台河 牡丹江 黑河 绥化 ' +
    '石家庄 唐山 秦皇岛 邯郸 邢台 保定 张家口 承德 沧州 廊坊 衡水 ' +
    '太原 大同 阳泉 长治 晋城 朔州 晋中 运城 忻州 临汾 吕梁 ' +
    '香港 澳门 台北 高雄 新竹 台中 台南 基隆 桃园 ' +
    '新加坡 东京 首尔 大阪 纽约 洛杉矶 伦敦 曼彻斯特 悉尼 墨尔本 多伦多 温哥华 柏林 巴黎 阿姆斯特丹 迪拜')
    .split(/\s+/).filter(Boolean);

  // 带标签的城市写法：「所在城市：杭州」「现居地：上海」
  var CITY_LABEL = /(?:所在城市|所在地区|现居城市|现居住地|现居地|目前所在地|所在地点|所在地|常驻地|居住地|工作地点|城市|坐标)\s*[：:]\s*([^\s|｜，,；;·•\/]{2,20})/;

  // 城市名后紧跟这些词时，说明是机构名而非所在地
  var CITY_FALSE_TAIL = /^(大学|学院|中学|小学|分校|校区|分公司|分行|支行|办事处|研究院|医院|银行|体育馆)/;

  function normalizeCity(raw) {
    var s = String(raw || '').trim()
      .replace(/^[（(【\[]+/, '').replace(/[）)】\]]+$/, '')
      .replace(/[，,。.；;、\s].*$/, '');
    if (!s) return '';
    if (/^(远程|不限|面议|全国|无|待定|可协商)$/.test(s)) return '';
    s = s.split(/[·•\/]/)[0];
    if (s.indexOf('省') >= 0) s = s.slice(s.indexOf('省') + 1);
    if (s.indexOf('市') > 0) s = s.slice(0, s.indexOf('市'));
    s = s.replace(/(自治州|自治县|特区|地区|新区)$/, '');
    if (s.length < 2 || s.length > 6) return '';
    if (!/^[\u4e00-\u9fa5]+$/.test(s)) return '';
    return s;
  }

  /** 在一段文字里找最靠前的已知城市名 */
  function findCityIn(text, allowAny) {
    if (!text) return '';
    var best = '', bestIdx = Infinity;
    for (var i = 0; i < CITIES.length; i++) {
      var c = CITIES[i];
      var idx = text.indexOf(c);
      if (idx < 0 || idx >= bestIdx) continue;
      var tail = text.slice(idx + c.length, idx + c.length + 3);
      if (CITY_FALSE_TAIL.test(tail)) continue;
      best = c; bestIdx = idx;
    }
    if (best) return best;
    if (allowAny) {
      // 兜底：抬头里出现的「XX市」地址式写法
      var zm = text.match(/([\u4e00-\u9fa5]{2,6})市(?!场|值|民|政|长|面)/);
      if (zm) {
        var n = normalizeCity(zm[0]);
        if (n) return n;
      }
    }
    return '';
  }

  /**
   * 城市识别：标签优先 → 抬头区已知城市 → 全文标签 → 抬头「XX市」→ 全文前 30 行
   * 简历常把联系方式放在页眉或表格里，因此不只看第一个章节标题之前的文字。
   */
  function detectCity(headText, allText) {
    var m = String(headText || '').match(CITY_LABEL);
    if (m) { var c0 = normalizeCity(m[1]); if (c0) return c0; }

    var c1 = findCityIn(headText, true);
    if (c1) return c1;

    m = String(allText || '').match(CITY_LABEL);
    if (m) { var c2 = normalizeCity(m[1]); if (c2) return c2; }

    var lines = String(allText || '').split('\n').filter(function (l) { return l.trim(); });
    var c3 = findCityIn(lines.slice(0, 30).join('\n'), false);
    return c3 || '';
  }

  var SEQ = 0;
  function uid(p) { SEQ += 1; return p + SEQ; }

  function normLines(text) {
    return String(text || '')
      .replace(/\r\n?/g, '\n')
      .replace(/\u00a0|\u3000/g, ' ')
      .replace(/[\u200b-\u200d\ufeff]/g, '')
      .split('\n')
      .map(function (l) { return l.replace(/[ \t]+$/g, '').replace(/^\s+/, ''); });
  }

  function cleanHeading(line) {
    var s = line.trim();
    s = s.replace(/^[#>*·•\-—–\s]+/, '');
    s = s.replace(/^[（(【\[]?\s*[一二三四五六七八九十]+\s*[）)】\]]?\s*[、.．:：]?\s*/, '');
    s = s.replace(/^\d{1,2}\s*[、.．:：)）]\s*/, '');
    s = s.replace(/[【】\[\]（）()]/g, '');
    s = s.replace(/[A-Za-z][A-Za-z\s&\/]*$/, '');
    s = s.split(/[\/｜|]/)[0];
    s = s.replace(/[：:·•\s]/g, '');
    return s;
  }

  function detectHeading(line) {
    if (!line) return null;
    if (line.length > 26) return null;
    var key = cleanHeading(line);
    if (!key) return null;
    if (ALIAS[key]) return { type: ALIAS[key].type, en: ALIAS[key].en, matched: key };
    // 允许「工作经历（续）」这类后缀
    for (var i = 0; i < HEADINGS.length; i++) {
      var names = HEADINGS[i].names;
      for (var j = 0; j < names.length; j++) {
        if (key.indexOf(names[j]) === 0 && key.length - names[j].length <= 2) {
          return { type: HEADINGS[i].type, en: HEADINGS[i].en, matched: names[j] };
        }
      }
    }
    return null;
  }

  function normDate(str) {
    if (!str) return '';
    if (/至今|现在|今|present/i.test(str)) return '至今';
    var y = str.match(/((?:19|20)\d{2})/);
    if (!y) return str.trim();
    var rest = str.replace(y[1], '');
    var m = rest.match(/(\d{1,2})/);
    return y[1] + (m ? '.' + ('0' + m[1]).slice(-2) : '');
  }

  function normRange(line) {
    var m = line.match(DR);
    if (!m) return null;
    return normDate(m[1]) + ' - ' + normDate(m[2]);
  }

  function stripBullet(line) {
    return line
      .replace(/^[-–—•·▪◦※*+]\s+/, '')
      .replace(/^[-–—•·▪◦※*]\s*/, '')
      .replace(/^\d{1,2}\s*[.、)）]\s*/, '')
      .replace(/^[（(]\d{1,2}[）)]\s*/, '')
      .trim();
  }

  function isBulletLine(line) {
    return /^[-–—•·▪◦※*+]\s*/.test(line) || /^\d{1,2}\s*[.、)）]\s*/.test(line) || /^[（(]\d{1,2}[）)]\s*/.test(line);
  }

  function splitHeader(rest) {
    // 「公司 / 职位 / 时间」这类用斜杠分隔的一行，也当作字段分隔符
    var s = rest.replace(/\s*[\/／]\s*/g, '  ').replace(/[|｜]/g, '  ').replace(/\s{2,}/g, '  ').trim();
    s = s.replace(/^[·•・,，\-—–\s]+/, '').replace(/[·•・,，\-—–\s]+$/, '');
    return s.split(/\s{2,}|\t+/).map(function (x) { return x.trim(); }).filter(Boolean);
  }

  function looksHeader(raw, isFirst, sectionType) {
    if (isBulletLine(raw)) return false;
    if (normRange(raw)) return true;
    if (isFirst) return true;
    if (raw.length > 44) return false;
    if (/[。；;，,、]$/.test(raw)) return false;

    var hasSep = /[|｜]/.test(raw) || /\s{2,}/.test(raw);
    var hasOrg = ORG_WORD.test(raw);
    var hasRole = ROLE_WORD.test(raw);

    if (hasOrg && (hasSep || hasRole)) return true;
    if (hasSep && hasRole) return true;

    // 项目/校园等章节里，条目名常是纯项目名（如「交易中台重构」），
    // 不含机构或职位关键词 —— 只要短、无句末标点，就按条目标题处理。
    if (sectionType === 'project' || sectionType === 'campus') {
      if (raw.length <= 20 && !/[，,、；;：:]$/.test(raw)) return true;
    }
    return false;
  }

  function parseEntries(lines, section) {
    var item = null;
    lines.forEach(function (raw, li) {
      if (!raw.trim()) return;
      var isFirst = !item && li === lines.findIndex(function (l) { return l.trim(); });

      if (looksHeader(raw, isFirst, section.type)) {
        var range = normRange(raw);
        var rest = range ? raw.replace(DR, '') : raw;
        var parts = splitHeader(rest);

        // 纯日期行（只有时间没有机构名）应并入上一条的 meta，而不是另开一条
        if (!parts.length && item && range) {
          item.meta = item.meta ? (item.meta + ' ' + range) : range;
          return;
        }

        item = { uid: uid('i'), org: parts[0] || '', role: '', degree: '', major: '', place: '', meta: range || '', bullets: [] };

        if (section.type === 'education') {
          var idx = -1;
          for (var i = 1; i < parts.length; i++) { if (DEGREE.test(parts[i])) { idx = i; break; } }
          if (idx > 0) {
            item.degree = parts[idx];
            item.org = parts[0];
            item.major = parts.filter(function (p, k) { return k !== 0 && k !== idx; }).join(' · ');
          } else {
            item.org = parts[0] || '';
            item.major = parts.slice(1).join(' · ');
          }
        } else {
          item.org = parts[0] || '';
          item.role = parts[1] || '';
          item.place = parts[2] || '';
          if (!item.role && parts.length === 1) {
            var m = parts[0].match(/^(.*?)\s*[-—–]\s*(.+)$/);
            if (m) { item.org = m[1]; item.role = m[2]; }
          }
        }
        section.items.push(item);
      } else {
        if (!item) {
          item = { uid: uid('i'), org: '', role: '', degree: '', major: '', place: '', meta: '', bullets: [] };
          section.items.push(item);
        }
        var b = stripBullet(raw);
        if (b) item.bullets.push(b);
      }
    });
  }

  function splitChips(line) {
    return line
      .replace(/^[-–—•·▪◦※*]\s*/, '')
      .split(/[；;｜|、]/)
      .map(function (s) { return s.replace(/^[·•\s]+/, '').replace(/\s+$/, ''); })
      .filter(function (s) { return s.length > 0; });
  }

  function parse(text, opts) {
    opts = opts || {};
    SEQ = 0;
    var lines = normLines(text);

    var model = {
      name: '',
      intent: '',
      contact: [],
      sections: [],
      photo: opts.photo || '',
      sourceKind: opts.sourceKind || '',
      unstructured: false
    };

    var firstHeadingAt = lines.length;
    for (var i = 0; i < lines.length; i++) {
      if (detectHeading(lines[i])) { firstHeadingAt = i; break; }
    }

    // ---- 抬头区 ----
    var headText = lines.slice(0, firstHeadingAt).join('\n');
    var nameM = headText.match(/姓\s*名\s*[：:]\s*([^\s|｜，,]{2,16})/);
    var intentM = headText.match(/(?:求职意向|应聘(?:职位|岗位)?|目标岗位|意向岗位)\s*[：:]\s*([^\n|｜，,]{1,24})/);

    if (nameM) model.name = nameM[1];
    if (intentM) model.intent = intentM[1].trim();

    for (var k = 0; k < Math.min(firstHeadingAt, 14); k++) {
      var ln = lines[k].trim();
      if (!ln) continue;
      if (!model.name && /^[\u4e00-\u9fa5]{2,4}$/.test(ln) && !/简历|个人|求职|应聘/.test(ln)) { model.name = ln; continue; }
      if (!model.name && /^[A-Za-z][A-Za-z.\-' ]{2,28}$/.test(ln) && ln.split(/\s+/).length <= 3 && !/resume|curriculum/i.test(ln)) {
        model.name = ln.trim(); continue;
      }
    }

    var email = headText.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    var phone = headText.match(/(?:\+?86[-\s]?)?1[3-9](?:[\s-]?\d){9}/) || headText.match(/(?:\(?0\d{2,3}\)?[-\s]?)\d{3,4}[-\s]?\d{4}/);

    // 抬头区没命中时，退到全文（含页眉）里找，避免「明明写了却说没写」
    var fullText = lines.join('\n');
    var city = detectCity(headText, fullText);

    var links = headText.match(/(?:https?:\/\/|www\.)[^\s|｜，,]+/g) || [];
    var wechat = headText.match(/(?:微信|WeChat)\s*[：:]\s*([\w-]{4,24})/i);
    var birth = headText.match(/(?:19|20)\d{2}\s*[年.\-\/]\s*(?:0?[1-9]|1[0-2])?\s*月?/);

    model.city = city;
    model.contact = [];
    if (phone) model.contact.push({ label: '电话', value: phone[0].replace(/\s+/g, '') });
    if (email) model.contact.push({ label: '邮箱', value: email[0] });
    if (city) model.contact.push({ label: '城市', value: city });
    if (wechat) model.contact.push({ label: '微信', value: wechat[1] });
    if (birth && !/20\d{2}\s*[.\-\/]\s*(?:0?[1-9]|1[0-2])?\s*[-—–至]/.test(headText)) {
      var bm = birth[0].replace(/\s/g, '');
      if (bm.length >= 4) model.contact.push({ label: '出生', value: bm });
    }
    links.slice(0, 2).forEach(function (l) {
      model.contact.push({ label: '链接', value: l.replace(/^https?:\/\//, '') });
    });

    // ---- 分块 ----
    var blocks = [];
    var cur = null;
    for (var j = firstHeadingAt; j < lines.length; j++) {
      var line = lines[j];
      var h = detectHeading(line);
      if (h) {
        // 保留原文件里写的小节标题（"自我评价" 不应被改写成 "个人简介"）
        cur = { type: h.type, en: h.en, heading: h.matched || h.names[0], lines: [] };
        blocks.push(cur);
      } else if (cur) {
        cur.lines.push(line);
      } else if (line.trim()) {
        // 抬头区之后的散落文本
        cur = { type: 'other', en: 'ADDITIONAL', heading: '其他信息', lines: [line] };
        blocks.push(cur);
      }
    }

    if (!blocks.length) {
      model.unstructured = true;
      blocks.push({ type: 'other', en: 'CONTENT', heading: '简历内容', lines: lines.filter(function (l) { return l.trim(); }) });
    }

    blocks.forEach(function (b) {
      var sec = { uid: uid('s'), type: b.type, en: b.en, heading: b.heading, mode: 'entries', items: [], chips: [], text: '' };
      var body = b.lines.filter(function (l) { return l.trim(); });

      if (b.type === 'summary') {
        sec.mode = 'para';
        sec.text = body.map(function (l) { return stripBullet(l); }).join('');
      } else if (b.type === 'skills') {
        sec.mode = 'chips';
        body.forEach(function (l) { sec.chips = sec.chips.concat(splitChips(l)); });
      } else if (b.type === 'awards' || b.type === 'language') {
        sec.mode = 'chips';
        body.forEach(function (l) { sec.chips = sec.chips.concat(splitChips(l)); });
      } else if (b.type === 'other' && body.length && body.every(function (l) { return l.length < 24; })) {
        sec.mode = 'chips';
        body.forEach(function (l) { sec.chips = sec.chips.concat(splitChips(l)); });
      } else {
        sec.mode = 'entries';
        parseEntries(body, sec);
        if (!sec.items.length) {
          sec.mode = 'para';
          sec.text = body.map(function (l) { return stripBullet(l); }).join('');
        }
      }
      model.sections.push(sec);
    });

    return model;
  }

  function toText(model) {
    var out = [model.name, model.intent];
    model.contact.forEach(function (c) { out.push(c.value); });
    model.sections.forEach(function (s) {
      out.push(s.heading);
      if (s.text) out.push(s.text);
      s.chips.forEach(function (c) { out.push(c); });
      s.items.forEach(function (it) {
        out.push(it.org, it.role, it.major, it.degree, it.meta);
        it.bullets.forEach(function (b) { out.push(b); });
      });
    });
    return out.filter(Boolean).join('\n');
  }

  function charCount(model) {
    return toText(model).replace(/\s/g, '').length;
  }

  window.ResumeModel = {
    parse: parse,
    toText: toText,
    charCount: charCount,
    detectHeading: detectHeading,
    detectCity: detectCity,
    normalizeCity: normalizeCity,
    normRange: normRange,
    stripBullet: stripBullet,
    HEADINGS: HEADINGS,
    ORG_WORD: ORG_WORD,
    DEGREE: DEGREE,
    CITIES: CITIES
  };
})();
