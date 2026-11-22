/* jd.js — JD 解析、关键词抽取与人岗匹配评分 */
(function () {
  'use strict';

  var LEX = [
    // 数据
    '数据分析', '数据挖掘', '数据建模', '数据仓库', '数据治理', '指标体系', '用户画像', '用户分层', 'AB测试', 'AB实验', '归因分析',
    '漏斗分析', '留存分析', '经营分析', '商业分析', '数据可视化', '看板', '报表', '数仓', '埋点', 'ETL', 'BI',
    'Hive', 'Spark', 'Flink', 'Kafka', 'Airflow', 'ClickHouse', 'MySQL', 'PostgreSQL', 'Oracle', 'MongoDB', 'Redis',
    'Elasticsearch', 'Excel', 'Tableau', 'Power BI', 'FineBI', 'Superset', 'SQL', 'Python', 'Pandas', 'NumPy', 'R语言',
    'SAS', 'SPSS', '统计学', '机器学习', '深度学习', 'NLP', '推荐系统', '爬虫', '因果推断',
    // 技术
    'Java', 'Golang', 'C++', 'C#', 'PHP', 'Node.js', 'JavaScript', 'TypeScript', 'React', 'Vue', 'Angular',
    'Spring Boot', 'Spring Cloud', '微服务', '分布式', '高并发', '中间件', 'Docker', 'Kubernetes', 'Linux', 'Nginx',
    'DevOps', 'CI/CD', 'Git', '云原生', 'Serverless', '小程序', 'Android', 'iOS', 'Flutter', 'React Native',
    '鸿蒙', 'HarmonyOS', '前端', '后端', '全栈', '架构设计', '性能优化', '单元测试', '自动化测试', '接口测试',
    'Selenium', 'JMeter', '网络安全', '渗透测试', '等保', '数据安全',
    // 产品 / 设计
    '产品经理', '需求分析', '需求调研', '原型设计', 'Axure', 'Figma', 'Sketch', 'PRD', '用户研究', '竞品分析',
    '产品规划', '版本迭代', '敏捷开发', 'Scrum', '项目管理', 'PMP', 'MVP', '用户体验', '交互设计', '可用性测试',
    'UI设计', '视觉设计', '平面设计', '品牌设计', '插画', '设计系统', '组件库', 'Photoshop', 'Illustrator',
    'After Effects', 'Premiere', 'C4D', 'Blender', '动效设计', '排版',
    // 运营 / 市场
    '内容运营', '用户运营', '活动运营', '社群运营', '私域', '公众号', '小红书', '抖音', '视频号', 'SEO', 'SEM',
    '信息流投放', '广告优化', '品牌', '公关', '新媒体', '文案', '策划', '直播', '电商', '跨境电商', '天猫', '京东',
    '拼多多', '选品', '渠道', '商务拓展', '客户成功', 'SOP', '商业化', '增长', '拉新', '促活', '留存',
    '转化率', 'GMV', 'DAU', 'MAU', 'ROI', 'LTV', 'CAC',
    // 财务
    '财务分析', '财务报表', '合并报表', '预算管理', '成本控制', '资金管理', '税务筹划', '纳税申报', '审计', '内控',
    '会计准则', 'IFRS', 'CPA', 'ACCA', 'CMA', '中级会计', '初级会计', '应收应付', '总账', '成本核算', 'IPO',
    '尽职调查', '估值', '财务建模', 'SAP', '用友', '金蝶',
    // 人力
    '招聘', '校园招聘', '人才盘点', '组织发展', '绩效管理', 'KPI', 'OKR', '薪酬绩效', '员工关系', '劳动法',
    '培训体系', '企业文化', 'HRBP', '人力资源', '三支柱', '雇主品牌',
    // 销售 / 商务
    '大客户', 'KA', 'ToB', 'ToC', '客户开发', '商务谈判', '招投标', '合同管理', '渠道管理', '回款', '业绩达成',
    '解决方案销售', '售前', '售后',
    // 通用能力
    '沟通协调', '跨部门协作', '团队管理', '带团队', '领导力', '方案撰写', 'PPT', '公文写作', '英语', 'CET-6',
    '雅思', '托福', '商务英语', '抗压能力', '执行力', '逻辑思维', '学习能力', '责任心'
  ];

  var MUST_NEAR = /(熟悉|精通|掌握|熟练|必须|要求|具备|至少|了解|会使用)/;
  var RES_SEC = /(岗位职责|工作职责|职责描述|工作内容|你将负责|主要职责|职位描述)/;
  var REQ_SEC = /(任职要求|岗位要求|任职资格|职位要求|我们希望|能力要求|应聘条件)/;

  function lc(s) { return String(s || '').toLowerCase(); }

  function has(hay, needle) {
    var n = lc(needle);
    if (!n) return false;
    if (/^[a-z0-9+#.\/ ]+$/.test(n) && n.replace(/[^a-z0-9]/g, '').length < 2) return false;
    return lc(hay).indexOf(n) >= 0;
  }

  function extractTitle(text) {
    var lines = text.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
    var m = text.match(/(?:岗位名称|职位名称|招聘岗位|岗位|职位)\s*[：:]\s*([^\n|｜，,（(]{2,24})/);
    if (m) return m[1].trim();
    var ROLE = /(工程师|经理|专员|主管|总监|分析师|设计师|顾问|助理|代表|负责人|Leader|Director|Manager|Specialist|Analyst|Designer|Intern|实习生|运营|销售|会计|出纳|法务|架构师|开发|研究员)/;
    for (var i = 0; i < Math.min(lines.length, 8); i++) {
      var l = lines[i].replace(/[【】]/g, '');
      if (l.length <= 24 && ROLE.test(l) && !/[。；;]/.test(l)) {
        return l.replace(/^(招聘|急聘|诚聘|岗位|职位)\s*[：:]?\s*/, '').trim();
      }
    }
    return '';
  }

  function extract(text) {
    var t = String(text || '');
    var jd = { title: '', degreeReq: '', yearReq: 0, keywords: [], responsibilities: [], hasJd: !!t.trim() };

    if (!jd.hasJd) return jd;

    jd.title = extractTitle(t);

    var dm = t.match(/(博士|硕士|研究生|本科|大专|专科)(?:学历)?(?:及)?以上/);
    jd.degreeReq = dm ? dm[1] : '';

    var ym = t.match(/(\d{1,2})\s*年(?:及)?以上/) || t.match(/(?:工作|相关)?经验\s*[：:]?\s*(\d{1,2})\s*年/);
    jd.yearReq = ym ? parseInt(ym[1], 10) : 0;

    // 职责段落
    var lines = t.split('\n');
    var inResp = false;
    lines.forEach(function (l) {
      if (RES_SEC.test(l)) { inResp = true; return; }
      if (REQ_SEC.test(l)) { inResp = false; return; }
      if (inResp && l.trim().length > 6) jd.responsibilities.push(l.trim().replace(/^[\d.、\-•·]\s*/, ''));
    });

    // 关键词
    var seen = {};
    LEX.forEach(function (k) {
      if (!has(t, k)) return;
      var idx = lc(t).indexOf(lc(k));
      var around = t.slice(Math.max(0, idx - 14), idx + k.length + 6);
      var must = MUST_NEAR.test(around);
      var key = lc(k);
      if (seen[key]) { if (must) seen[key].must = true; return; }
      seen[key] = { k: k, must: must, w: must ? 2 : 1 };
      jd.keywords.push(seen[key]);
    });

    // 频次加权（出现多次的技术词更重要）
    jd.keywords.forEach(function (kw) {
      var re = new RegExp(kw.k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      var n = (t.match(re) || []).length;
      if (n >= 3 && kw.w < 2) kw.w = 1.5;
    });

    jd.keywords.sort(function (a, b) { return (b.w - a.w) || (b.k.length - a.k.length); });
    jd.keywords = jd.keywords.slice(0, 26);

    return jd;
  }

  var STRONG_VERB = /^(主导|牵头|统筹|搭建|构建|设计|规划|推动|落地|优化|重构|提升|降低|建立|制定|管理|带领|输出|沉淀|孵化|操盘|独立完成|从0到1)/;
  var WEAK_VERB = /^(负责|参与|协助|帮助|配合|了解|接触|支持|跟进|完成)/;

  function analyzeQuality(model) {
    var bullets = [];
    model.sections.forEach(function (s) {
      s.items.forEach(function (it) { it.bullets.forEach(function (b) { bullets.push(b); }); });
      if (s.text) s.text.split(/[。；;]/).forEach(function (x) { if (x.trim().length > 6) bullets.push(x.trim()); });
    });

    var total = bullets.length || 1;
    var quantified = 0, weak = 0, strong = 0, longOnes = 0;
    bullets.forEach(function (b) {
      if (/\d/.test(b) && /(%|％|倍|万|亿|个|家|人|次|天|小时|元|条|篇|场|款|项|位)/.test(b)) quantified += 1;
      if (WEAK_VERB.test(b)) weak += 1;
      if (STRONG_VERB.test(b)) strong += 1;
      if (b.length > 90) longOnes += 1;
    });

    return {
      bullets: bullets,
      count: bullets.length,
      quantifiedRatio: bullets.length ? quantified / bullets.length : 0,
      weakRatio: bullets.length ? weak / bullets.length : 0,
      strongRatio: bullets.length ? strong / bullets.length : 0,
      longRatio: bullets.length ? longOnes / bullets.length : 0
    };
  }

  function score(model, jd) {
    var text = window.ResumeModel.toText(model);
    var q = analyzeQuality(model);

    var hasSection = function (type) {
      return model.sections.some(function (s) {
        if (s.type !== type) return false;
        if (s.items.length || s.chips.length || (s.text && s.text.length > 10)) return true;
        return false;
      });
    };

    // ---- 信息完整 ----
    var basicPts = 0, basicMax = 5;
    if (model.name) basicPts++;
    if (model.contact.some(function (c) { return c.label === '电话'; })) basicPts++;
    if (model.contact.some(function (c) { return c.label === '邮箱'; })) basicPts++;
    if (model.contact.some(function (c) { return c.label === '城市'; })) basicPts++;
    if (model.intent || hasSection('summary')) basicPts++;
    var basicScore = basicPts / basicMax * 100;

    // ---- 教育 ----
    var eduScore = 0;
    var edu = model.sections.filter(function (s) { return s.type === 'education'; })[0];
    if (edu && edu.items.length) {
      eduScore = 55;
      if (edu.items.some(function (i) { return i.org; })) eduScore += 15;
      if (edu.items.some(function (i) { return i.major; })) eduScore += 12;
      if (edu.items.some(function (i) { return i.degree || window.ResumeModel.DEGREE.test(i.major || ''); })) eduScore += 12;
      if (edu.items.some(function (i) { return i.meta; })) eduScore += 6;
    } else if (edu) { eduScore = 30; }
    eduScore = Math.min(100, eduScore);

    // ---- 经历 ----
    var expItems = [];
    model.sections.forEach(function (s) {
      if (s.type === 'experience' || s.type === 'project' || s.type === 'campus') expItems = expItems.concat(s.items);
    });
    var expScore = 0;
    if (expItems.length) {
      var goodBullets = expItems.filter(function (i) { return i.bullets.length >= 2; }).length / expItems.length;
      expScore = 28;
      if (expItems.length >= 2) expScore += 12;
      expScore += goodBullets * 30;
      if (expItems.every(function (i) { return i.meta; })) expScore += 12;
      if (expItems.some(function (i) { return i.role; })) expScore += 12;
    }
    expScore = Math.min(98, Math.round(expScore));

    // ---- 技能 ----
    var skillSec = model.sections.filter(function (s) { return s.type === 'skills'; })[0];
    var skillScore = skillSec ? Math.min(100, 45 + skillSec.chips.length * 7) : 0;

    // ---- 表述 ----
    var writingScore = Math.round(
      Math.min(100,
        (q.quantifiedRatio * 55) +
        (Math.min(q.strongRatio * 2, 0.5) * 50) +
        ((1 - Math.min(q.weakRatio * 2, 1)) * 25) +
        ((1 - Math.min(q.longRatio * 3, 1)) * 12) +
        18
      )
    );
    if (!q.count) writingScore = 20;

    // ---- 关键词 ----
    var matched = [], missing = [];
    var hitW = 0, allW = 0;
    jd.keywords.forEach(function (kw) {
      allW += kw.w;
      if (has(text, kw.k)) { matched.push(kw); hitW += kw.w; }
      else missing.push(kw);
    });

    var keywordScore;
    if (jd.hasJd && allW > 0) keywordScore = Math.round(hitW / allW * 100);
    else keywordScore = null;

    // ---- 硬性门槛 ----
    var gatePenalty = 0, gateNotes = [];
    if (jd.hasJd) {
      if (jd.degreeReq) {
        var degreeRank = { '大专': 1, '专科': 1, '本科': 2, '学士': 2, '研究生': 3, '硕士': 3, '博士': 4 };
        var need = degreeRank[jd.degreeReq] || 0;
        var got = 0;
        if (edu) {
          edu.items.forEach(function (it) {
            var d = (it.degree || '') + ' ' + (it.major || '');
            Object.keys(degreeRank).forEach(function (k) { if (d.indexOf(k) >= 0) got = Math.max(got, degreeRank[k]); });
          });
        }
        if (got && got < need) { gatePenalty += 12; gateNotes.push('学历未达 JD 要求的「' + jd.degreeReq + '」'); }
      }
      if (jd.yearReq) {
        var years = estimateYears(model);
        if (years && years < jd.yearReq) { gatePenalty += 8; gateNotes.push('工作年限约 ' + years + ' 年，低于 JD 要求的 ' + jd.yearReq + ' 年'); }
      }
    }

    var total;
    if (keywordScore === null) {
      total = Math.round(basicScore * 0.18 + eduScore * 0.12 + expScore * 0.22 + skillScore * 0.1 + writingScore * 0.38);
    } else {
      total = Math.round(
        keywordScore * 0.42 +
        writingScore * 0.2 +
        expScore * 0.16 +
        basicScore * 0.08 +
        skillScore * 0.08 +
        eduScore * 0.06
      ) - gatePenalty;
    }
    total = Math.max(8, Math.min(99, total));

    return {
      total: total,
      modules: {
        '基本信息': Math.round(basicScore),
        '教育背景': Math.round(eduScore),
        '经历质量': Math.round(expScore),
        '专业技能': Math.round(skillScore),
        '表述规范': Math.round(writingScore)
      },
      keywords: { matched: matched, missing: missing, all: jd.keywords, score: keywordScore },
      quality: q,
      gate: { penalty: gatePenalty, notes: gateNotes },
      hasJd: !!jd.hasJd
    };
  }

  function estimateYears(model) {
    var earliest = null, latest = null;
    model.sections.forEach(function (s) {
      if (s.type !== 'experience' && s.type !== 'project') return;
      s.items.forEach(function (it) {
        var m = (it.meta || '').match(/((?:19|20)\d{2})(?:\.(\d{1,2}))?/g);
        if (!m) return;
        m.forEach(function (x) {
          var y = parseInt(x.slice(0, 4), 10);
          var mo = x.length > 5 ? parseInt(x.slice(5), 10) : 1;
          var v = y + (mo - 1) / 12;
          if (earliest === null || v < earliest) earliest = v;
          if (!/至今/.test(it.meta)) { if (latest === null || v > latest) latest = v; }
          else { var now = new Date(); var nv = now.getFullYear() + now.getMonth() / 12; if (latest === null || nv > latest) latest = nv; }
        });
      });
    });
    if (earliest === null || latest === null) return 0;
    return Math.max(0, Math.round((latest - earliest) * 10) / 10);
  }

  window.JD = { extract: extract, score: score, has: has, LEX: LEX, analyzeQuality: analyzeQuality, estimateYears: estimateYears };
})();
