# 部署到腾讯云 CloudBase（国内直连、0 元）

目标是解决 `*.workers.dev` 在国内被 DNS 污染、必须挂代理才能打开的问题。
CloudBase 免费版的默认域名国内可以直接访问，**不需要备案**，也不用买域名。

## 线上地址（本环境已部署）

```
https://eastern-hare-d7gpz96umb56910e4-1538459523.ap-shanghai.app.tcloudbase.com/7a8d66c4dde0470a
```

- 环境 ID：`eastern-hare-d7gpz96umb56910e4`（地域 `ap-shanghai`，体验版）
- 访问码：`7a8d66c4dde0470a`，写在**路径**里（`/<访问码>`），不要用 `?code=`（原因见「默认域名的访问提示中间页」）
- 首次用某个浏览器打开时，腾讯云会插一页「页面访问提示」，点一次**确定访问**即可进入，之后同一浏览器不再提示
- 别把裸域名 `/` 发给别人，那样访问码会丢；分享链接一定要带 `/<访问码>`

## 架构（一个云函数干完所有事）

```
浏览器 ──https──> https://<环境ID>-<随机数>.<地域>.app.tcloudbase.com/
                     │
                     ├─ /api/config|chat|models  → 转发大模型（Key 只在函数环境变量里）
                     └─ 其它路径                → 直接返回 functions/rp/public/ 里的前端文件
```

同源的好处：不用配 CORS、Cookie 能正常用、前端连接口地址都不用改（`RP_API_BASE` 留空）。

## 一次性准备

1. 腾讯云账号完成**实名认证**。
2. 开通云开发：[控制台](https://tcb.cloud.tencent.com/dev) → 新建环境 → 计费方式选**免费版 / 按量计费**（个人小流量在免费额度内，基本不产生费用）。
   记下**环境 ID**，形如 `rp-1a2b3c4d`。地域记一下（如 `ap-shanghai`）。

## 部署（推荐：命令行）

```powershell
cd D:\软件\2026-11-12-02-37-29\resume-polish\deploy\cloudbase

# 1) 复制前端进函数包（每次改前端都要重跑）
node build.mjs

# 2) 登录一次（会打开浏览器，扫码/登录后凭据缓存在本机）
tcb login

# 3) 把环境 ID 填进 cloudbaserc.json，然后部署函数
tcb fn deploy rp --force
```

> `cloudbaserc.json` 里的 `envId` 必须改成你自己的环境 ID；`functions[].envVariables` 里的值会随部署一起写入。
> 部署时如果要求先选环境，也可以用 `tcb fn deploy rp --envId <环境ID> --force`。
> `npx @cloudbase/cli` 在本机会报 “could not determine executable to run”，直接用全局命令 `tcb`。

## 配置（控制台里点几下）

进入 **云开发控制台 → 环境 → 云函数 → rp → 函数配置 / 环境变量**，加上：

| 变量 | 值 | 说明 |
|---|---|---|
| `MAAS_API_KEY` | `sk-...` | **必填**，站点统一使用的大模型 Key |
| `ACCESS_CODE` | `7a8d66c4dde0470a` | 选填，填了就要求访问码；想公开访问就删掉 |
| `MAAS_BASE_URL` | `https://maas-api.antdigital.com/v1` | 选填 |
| `MAAS_MODEL` | `ling-3.1-flash` | 选填 |
| `TEMPERATURE` / `MAX_TOKENS` | `0.7` / `4096` | 选填 |
| `RP_SERVE_STATIC` | `1` | 选填，`0` = 只做 API，不返回前端 |
| `RP_GZIP` | `1` | 选填，开启 gzip 省流量（默认关，先确认能跑再开） |
| `ENABLE_THINKING` | `1` | 选填，让站点模型开启「思考」。默认**关闭**：`ling-3.1-flash` 开着思考时 token 全花在推理上，几万 token 也吐不出正文，还会把 60 秒的函数上限撑爆 |
| `UPSTREAM_TIMEOUT_MS` | `55000` | 选填，等大模型的上限 |

超时时间建议调到 **60 秒**（默认 3 秒必挂）：函数配置 → 超时时间 = 60，内存 512MB。

## 挂到 HTTP 网关（关键一步）

**云开发控制台 → HTTP 网关 / HTTP 访问服务 → 新建路由**：

- 域名：**默认域名**
- 触发路径：`/`
- 关联资源：**云函数** → `rp`

默认域名不是 `https://<环境ID>.<地域>.app.tcloudbase.com`，中间还带一段平台生成的数字后缀。
准确值用这条命令查（`DefaultDomain` 字段）：

```powershell
# 本仓库带的小脚本，避免 PowerShell 把 JSON 引号吃掉
node api.mjs tcb DescribeCloudBaseGWService body.json -
# body.json: {"ServiceId":"<环境ID>","EnableRegion":true,"EnableUnion":true}
```

得到形如 `eastern-hare-d7gpz96umb56910e4-1538459523.ap-shanghai.app.tcloudbase.com` 的域名。

注意：`tcb routes add` 会报 **“is a system internal domain, manual creation or modification is not supported”**，
默认域名的路由要走网关 API（等价于控制台里点「新建路由」）：

```powershell
node gateway.mjs create / rp
node gateway.mjs list
```

`gateway.mjs` 内部调用 `CreateCloudBaseGWAPI`：`Type=1`（云函数）、`Path=/`、`Name=rp`、`ServiceId=<环境ID>`。

保存后打开这个地址就应该看到「求职助手」首页（左侧四栏：我的简历 / 简历优化 / API 设置 / 模拟面试）：

```
https://eastern-hare-d7gpz96umb56910e4-1538459523.ap-shanghai.app.tcloudbase.com/
```

### 默认域名的访问提示中间页（重要）

腾讯云对 `*.app.tcloudbase.com` 这类默认域名有强制提示：

- 浏览器**地址栏直接访问**（`Sec-Fetch-Mode: navigate`）时，先显示「页面访问提示 / 风险提醒」，访客点**确定访问**才进入；
- 其他请求会被加上 `Content-Disposition: attachment`（子资源如 js/css 不受影响，但**不能拿默认域名当纯 HTML 导航之外的下载/内嵌用途**）；
- 中间页跳转时**只保留路径、丢掉 `?query`**，所以访问码必须放路径：`/<访问码>`。
  `js/env.js` 会把首段路径识别为访问码，存进 localStorage 后把地址栏改回 `/`。
- 官方建议默认域名只用于测试，正式分发需绑定**已备案的自定义域名**（要买域名 + 备案）。

个人自用、朋友内测没问题；如果哪天要给很多人长期用，再考虑备案域名或 CDN。

## 不想用命令行：控制台手工上传

1. `node build.mjs` 生成 `functions/rp/public/`。
2. 把 `functions/rp/` 整个目录压成 `rp.zip`（**zip 里第一层就是 index.js**，不要再套一层目录）：
   ```powershell
   Compress-Archive -Path functions\rp\* -DestinationPath rp.zip -Force
   ```
3. 控制台 → 云函数 → 新建函数 `rp` → 运行环境 Node.js 18 → 上传代码包 `rp.zip` → 入口 `index.main`。
4. 按上面两节配环境变量、超时、HTTP 网关路由。

## 更新发布（改了前端或接口代码）

```powershell
cd deploy\cloudbase
node build.mjs
tcb fn deploy rp --force
```

只有环境变量变了不用重新上传代码，控制台改完保存即可生效（或 `tcb config update fn rp`，交互里选 Override）。

## 前端与云函数分开放（可选）

如果你以后想用静态托管 + CDN（默认域名限速，不建议），可以让前端和函数不同域名：

```powershell
$env:RP_API_BASE="https://<环境ID>-<数字>.<地域>.app.tcloudbase.com"
node build.mjs
```

构建会把地址写进 `public/js/env.js`，前端就按这个地址调 `/api/*`（函数已带 CORS 头）。
静态托管那侧传 `public/` 即可，访问码会存在浏览器里、以 `x-access-code` 头发过去。

## 已知限制

- **没有流式输出**：云函数是一次性返回，`/api/config` 里返回 `stream: false`，前端会自动退回「等结果」模式，不影响功能。
- **冷启动**：实例闲置一段时间后首次访问约 1~2 秒，之后就快了。
- **每个静态文件也算一次函数调用**：一次完整访问约 15 次调用。免费额度按「调用次数 + 资源用量」算，个人/小团队试用完全够；如果给很多人用，建议再套 CDN 或买 9 块钱域名走 Cloudflare（见 `../cloudflare/README.md`）。
- 上传的包约 5.6 MB（含 2 MB 中文字体，只在导出中文 PDF 时才加载）。