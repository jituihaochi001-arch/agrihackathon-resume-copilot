# 求职助手 · Career Copilot

面向大学生与转行求职者的**本地优先求职助手**：简历库、可视化编辑器、九套模板、岗位 JD 定向优化、AI 模拟面试，一个网页全打通。

> 纯前端即可运行，双击 `index.html` 离线可用；也可以启动本地 Node 代理或部署到腾讯云 CloudBase。AI 能力采用 **BYOK**（Bring Your Own Key），Key 只保存在你自己的浏览器里。

## 在线 Demo

**https://eastern-hare-d7gpz96umb56910e4-1538459523.ap-shanghai.app.tcloudbase.com/7a8d66c4dde0470a**

> 腾讯云默认域名首次访问可能出现「风险提醒」中间页，点一次「确定访问」即可。站点不内置任何 Key；不配置模型时，简历优化会自动使用规则版。

## 解决什么问题

- 简历不会写：不知道放什么模块、怎么排版、写多长。
- 投递没回音：一份简历投所有岗位，和 JD 对不上。
- 面试没底：没有真实追问环境，也不知道自己答得怎么样。

## 核心功能

### 1. 我的简历

- 多份简历库，缩略图由真实排版渲染；支持上传解析、粘贴导入、手动新建。
- 新建先选模板：**9 套预设模板**（经典、两栏、模板标题、时间轴、极简、学术、创意、作品集、瑞士风），也可从空白开始。
- 新建默认带一份完整样例，打开就能改；样例九套模板均为 1 页。
- 卡片可直接进入编辑器、优化或导出。

### 2. 可视化编辑器

- 模块增删、上移下移、隐藏/显示；教育、工作、项目、技能、简介等预设 + 自定义模块。
- 头像、主题色、字体、行高、姓名字号实时调整。
- 桌面三栏可拖拽调宽，≤1020px 自动退化为单列；预览随改随渲染。
- 空模块在编辑器中显示占位，导出/打印时自动省略。
- 导出六种格式：**PDF（自动分页）、DOCX、PNG、Markdown、TXT、JSON**；另提供「紧凑一页」。

### 3. 简历优化

- 01 步选简历（库内选择 / 上传 / 粘贴），02 步填岗位 JD，03 步出诊断。
- 给出匹配分、缺口与逐条建议；采纳后**直接回写当前简历**，可撤销，简历卡预览与分数同步。
- 有 Key 走大模型，无 Key 自动回落规则版，功能不瘫痪。

### 4. 模拟面试

- 按岗位/JD 生成问题，逐题作答、追问，结束后生成评分报告与改进建议。
- 保留最近面试历史，可回看报告。

### 5. API 设置与数据

- 10 个服务商一键切换（DeepSeek、通义千问、豆包、Kimi、智谱 GLM、硅基流动、OpenRouter、OpenAI、Gemini、自定义/中转），带品牌图标。
- 支持获取模型列表、连通性测试、温度说明；错误提示中文化。
- 访问码保护；简历数据默认只存本机 `localStorage`，可手动导出/导入 JSON，支持可选本地文件夹自动备份。

## 技术架构

```
浏览器（纯前端，无框架）
├─ index.html / styles.css       单页四视图
├─ js/library.js                 简历库、模板、样例、自动备份
├─ js/editor.js                  三栏编辑器、拖拽分栏、导出
├─ js/render.js                  纸张渲染（预览 / 缩略图 / 打印共用）
├─ js/parse.js · model.js        上传解析与数据模型
├─ js/jd.js · suggest.js         岗位匹配与规则版建议
├─ js/ai.js                      BYOK 供应商、代理调用、错误中文化
├─ js/interview.js               模拟面试流程与报告
├─ js/pdfwrite.js · docx.js      自研 PDF 分页 / DOCX 生成
└─ vendor/                       pdf.js（Apache-2.0）与中文字体子集
        │
        ├─ server/server.mjs     本地 Node 代理（同源 /api/*，可留空 Key）
        └─ deploy/cloudbase/     腾讯云 CloudBase 单云函数（静态资源 + API，同源免 CORS）
```

- 前端零构建、零框架、可离线；PDF 排版按 A4 纸面坐标分页，跨页元素自动裁切。
- 线上把 `public/` 交给云函数返回，`/api/*` 与页面同源，避免 CORS；云函数不保存站点 Key。
- 请求头 `x-llm-base` / `x-llm-key` / `x-llm-model` 透传用户配置，服务端只做转发。

## 快速开始

### 方式 A：直接打开（离线）

双击 `index.html`。除 AI 能力外，简历编辑、模板、导出全部可用。

### 方式 B：本地服务（推荐，AI 可用）

1. 安装 Node.js 18+。
2. 复制 `server/config.example.json` 为 `server/config.json`，填入自己的 Key（也可以留空，进页面后在「API 设置」里填）。
3. 双击 `start.bat`，打开 http://127.0.0.1:8765/ 。

### 方式 C：部署到腾讯云 CloudBase

```bash
cd deploy/cloudbase
# 修改 cloudbaserc.json：envId、ACCESS_CODE
node build.mjs                 # 把前端复制进 functions/rp/public
tcb fn deploy rp --force       # 部署单云函数
```

访问 `https://<env>.app.tcloudbase.com/<ACCESS_CODE>`。首次访问若出现腾讯云风险提醒，点「确定访问」。

## 目录结构

```
index.html            单页入口
styles.css            全站样式（含打印/导出样式）
js/                   28 个前端模块
vendor/               pdf.js、中文字体子集
server/               本地 Node 代理
deploy/cloudbase/     云函数与部署脚本
docs/SUBMISSION.md    比赛提交材料（项目简介 / 原创与 AI 使用说明）
```

## 验收记录

开发中使用 Edge headless + CDP 做了自动化验收，覆盖：

- 编辑器 21 项：字号、模块增删改排、六格式导出、PDF 1 页、分栏拖拽持久化、入库、无异常。
- 导出 10 项：PDF 1 页 / 多页分页、DOCX、PNG 尺寸、MD/TXT/JSON 内容。
- 窄屏 1000px 与 420px：分隔条隐藏、单列、无横向溢出。
- 线上 12 项：资源版本、BYOK 未连接态、图标、温度说明、失败提示中文红字、`/api/config` 不含 Key、无控制台异常。

## 隐私

- 简历正文与 API Key 默认只存浏览器本地，不上传站点。
- 站点不内置共享 Key；代理只转发当次请求。
- 仓库不包含任何真实 Key、Cookie 或部署凭据。

## AI 使用与原创声明

见 [docs/SUBMISSION.md](docs/SUBMISSION.md)。简要说明：

- 本项目为团队自研，延续此前的「简历优化助手」，未拷贝第三方开源项目代码。
- 第三方库仅 pdf.js（Apache-2.0，用于 PDF 渲染）等，许可与版权归原作者。
- 开发过程使用 OpenCode + 百灵平台模型辅助编码、文案和自动化测试；产品运行时不绑定模型，由用户通过 OpenAI 兼容接口自选。

## License

[MIT](LICENSE) © 2026 jituihaochi001-arch