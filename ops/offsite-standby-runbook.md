# HotAPI 离家容灾：云端榜单快照（第一阶段）

## 故障域和范围

现有 hotapi.wuaishare.cn 是 Vercel 转发网关，全部请求转发家庭 bt1 的 hotapi2.wuaishare.cn。家庭断电时，两个入口均会失去实时数据。两个入口不等于两个独立后端。

本变更不改 bt1、DNS、Production 绑定。Vercel 只接管七条已验证公开且有效的榜单：douyin/hot、baidu/realtime、kuaishou/hot、weibo/hot、toutiao/hot、qq-news/hot、netease-news/hot。其余 170+ API 路径继续按原有 Vercel rewrite 直通 bt1，不宣称全站都能断电运行。

## 云端更新，不消耗 Vercel 日部署额度

GitHub 云端 runner 每两小时调度 ops/capture-standby.mjs，校验真实公开来源的 code=200、至少10条非空标题、最近3小时内原始 updateTime 后，把逐源 JSON 更新到该公开 GitHub 仓库 Release 标签 cloud-standby-v1。每条源独立更新，超时/403/空数据都保留最后一次有效资产，不用伪造排名。Release 更新只用 GitHub Actions 自带 contents:write 权限，不提交数据文件、不开 Git 分支、不新增 Vercel Token、不重新部署 Vercel。调度是尽力服务，不是严格2小时 SLA。

## 实时、云端快照和最终种子

已接管的七路在 bt1 有效时优先返回原始 JSON；遇到网络中断、超时、5xx 或损坏的200 JSON时读取 GitHub Release 最近已校验的公开快照；GitHub Release 同时不可达时读取已打入 Vercel Function bundle 的真实种子快照。三个故障域均不依赖家庭服务器在停电期间供电。

降级响应保持原 JSON 结构，增加 standby.active=true、standby.mode=offsite-snapshot、standby.capturedAt、standby.sourceUpdatedAt、standby.ageSeconds；同时返回 X-HotAPI-Data-Mode、X-HotAPI-Standby-Captured-At、X-HotAPI-Standby-Age-Seconds 和 Warning:110。这是带来源时间的历史快照，绝不能把它当成实时采集。CDN仅短缓存30秒，bt1复活后自动重试实时数据。

401/403/404/429 等明确拒绝一律不降级；小红书、私有/未知来源、不匹配的子榜单变体和 Authorization 请求一律不降级；不转发 cookie、认证头或用户指定代理源；非 GET/HEAD 不允许由本函数写入。

## 上线前必须具备的验收

1. Draft PR 与源码/负例/真实快照种子完整测试通过；7条真实种子不可是假数据。
2. 一次受保护 Vercel Preview 验证七条准确路由、原健康标记、/all、AI接口路径原样、真实 live JSON 契约。
3. 只在 Preview 模拟 bt1 HTTP502/网络超时，确认 Release快照及内置种子双层保底；401/403及未知变体仍 fail-closed。
4. GitHub云端 runner 的 Release 写权限、一次真实快照更新和公共下载均验收。不得停家庭服务做演练。
5. 最后才合并并发布 master；正式回滚基线、CPU/函数请求、CDN访问、数据过期标签和生产域名收据必须检查。本 Draft 不等于已上线。

## 不虚报的边界及成本

第一阶段保证停电期间最后有效榜单仍可读，不保证断电时继续更新。真正断电后继续产生新排名需要第二阶段把部分源迁到独立云端采集，并逐源核实可抓取性、授权及地区限制。
Vercel Serverless Function 每个被接管的 HTTP 请求会产生额外执行与配额消耗，相比原 Edge rewrite 成本上升；上游超时至多4秒，GitHub回退至多3秒。只保留七条核心公开源以控制成本，等 Vercel Hobby 的实际流量和账单验证后再扩面。
固定 Release asset 的 --clobber 更新可能有短暂缺口，内置静态种子可接手，但可能随时间陈旧。Cloudflare/GitHub/Vercel均可能独立故障，这不是100%SLA。
恢复为原单条 HTTPS rewrite 并撤销七条精准函数路由即可回滚；不需修改 bt1 服务、用户认证或DNS。
