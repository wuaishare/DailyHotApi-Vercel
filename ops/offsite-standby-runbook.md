# HotAPI 离家容灾：云端榜单快照（第一阶段）

## 故障域和范围

现有 hotapi.wuaishare.cn 是 Vercel 转发网关，全部请求转发家庭 bt1 的 hotapi2.wuaishare.cn。家庭断电时，两个入口均会失去实时数据。两个入口不等于两个独立后端。

本变更不改 bt1、DNS、Production 绑定。Vercel 只接管七条已验证公开且有效的榜单：douyin/hot、baidu/realtime、kuaishou/hot、weibo/hot、toutiao/hot、qq-news/hot、netease-news/hot。其余 170+ API 路径继续按原有 Vercel rewrite 直通 bt1，不宣称全站都能断电运行。

## 云端更新，不消耗 Vercel 日部署额度

GitHub 云端 runner 每两小时调度 ops/capture-standby.mjs，校验真实公开来源的 code=200、至少10条非空标题、最近3小时内原始 updateTime 后，把逐源 JSON 更新到该公开 GitHub 仓库 Release 标签 cloud-standby-v1。每条源独立更新，超时/403/空数据都保留最后一次有效资产，不用伪造排名。Release 更新只用 GitHub Actions 自带 contents:write 权限，不提交数据文件、不开 Git 分支、不新增 Vercel Token、不重新部署 Vercel。每次上传成功后必须从 Release 重新下载同名资产，最多进行三次有限只读重取，并与本次上传 JSON 做逐字节比对；未核实一致则该次 Job 失败，标记结果不确定，不能冒称已发布或自动重复上传。调度是尽力服务，不是严格2小时 SLA。

## 实时、云端快照和最终种子

已接管的七路在 bt1 有效时优先返回原始 JSON；遇到网络中断、超时、5xx 或损坏的200 JSON时读取 GitHub Release 最近已校验的公开快照；GitHub Release 同时不可达时读取已打入 Vercel Function bundle 的真实种子快照。三个故障域均不依赖家庭服务器在停电期间供电。

降级响应保持原 JSON 结构，增加 standby.active=true、standby.mode=offsite-snapshot、standby.capturedAt、standby.sourceUpdatedAt、standby.ageSeconds；同时返回 X-HotAPI-Data-Mode、X-HotAPI-Standby-Captured-At、X-HotAPI-Standby-Age-Seconds 和 Warning:110。这是带来源时间的历史快照，绝不能把它当成实时采集。CDN仅短缓存30秒，bt1复活后自动重试实时数据。

401/403/404/429 等明确拒绝一律不降级；小红书、私有/未知来源、不匹配的子榜单变体和 Authorization 请求一律不降级；不转发 cookie、认证头或用户指定代理源；非 GET/HEAD 不允许由本函数写入。HEAD 为避免部分上游不支持 HEAD 或仅返回假健康 200，通过同一条受控 GET 路径执行完整的有界公开 JSON 验证与相同故障回退，只回传状态/响应头而不返回正文；OPTIONS 只本地应答、不访问上游。

## 上线前必须具备的验收

1. Draft PR 与源码/负例/真实快照种子完整测试通过；7条真实种子不可是假数据。
2. 一次受保护 Vercel Preview 验证七条准确路由、原健康标记、/all、AI接口路径原样、真实 live JSON 契约。
3. 只在受保护 Preview 模拟 bt1 HTTP502/网络超时：测试查询参数 __standby_fault=upstream-502 / all-remote-502 / upstream-403 只有在 VERCEL_ENV=preview 且 HOTAPI_STANDBY_PREVIEW_FAULT=1 时生效；此环境变量只绑定当前 PR Preview 分支，Production 不存在，参数会从转发查询中剔除。依次确认真实 Release、部署内置种子和403不回退三条路径。
4. GitHub云端 runner 的 Release 写权限、一次真实快照更新和公共下载均验收。不得停家庭服务做演练。
5. 最后才合并并发布 master；正式回滚基线、CPU/函数请求、CDN访问、数据过期标签和生产域名收据必须检查。本 Draft 不等于已上线。

## 受控发布与精确回滚（2026-11-11 只读基线）

以下是本日证据快照，**执行前必须重新读取并确认**，不能把历史部署ID当永久可用版本：

- Vercel `hotapi` 当前 Production：`dpl_hFMdwDFxr31GEFYMNV3A9wNqsWuy`，Git `master@c0858c9eb29de39c986942795f09d1258675b775`，状态 `READY`。此部署当前同时绑定 `hotapi.wuaishare.cn` 与 `dailyhotapi.wuaishare.cn` 等别名；回滚核验必须覆盖两个真实域名，不能仅测 Vercel 随机域。
- 此版本只是一层家庭 bt1 的纯代理；**回滚至此将恢复既有业务，但同时失去七源离家回退**。不要把回滚后家庭断网时的502误判为新补丁未修复。
- 用户最终验收前，PR 保持 Draft；确认 GitHub 正式 Quality、PR Hosted Runner 七源7/7、受保护 Preview 七源正常与双远端故障、401/403/429不降级、未知来源拒绝，且 `HOTAPI_STANDBY_PREVIEW_FAULT` **不在生产环境**。当前还需核实账号实际流量/计划与Hobby非商业使用约束。
- **精确生产构建准入**：Preview READY 只证明 Preview 环境，不等于 Production 构建已验证；如果使用 Vercel Git-native merge 自动上线，须先确认有效的 Deployment Checks/人工发布门禁，不得借 `Force Promote` 绕过失败检查。若无法在别名切换前验收生产构建，保持 Draft 不合并。不要临时新增长期 `VERCEL_TOKEN`。
- 合并后的默认 `master` 才有 schedule/dispatch 定时刷新。第一次真正运行后核对 GitHub Hosted Runner 具体 run 的 `PUBLISHED` 列表和 Release 七资产的更新时间、独立公共 GET/JSON/schema，允许单源缺席时保留上一版资产；**PR只读Dry Run不是Release写入证明**。无需停家庭生产来测试。
- 上线后从生产两个别名逐一复核七源正常JSON/有效标题、旧 `/all` 和 `/_hotapi-gateway/health.json`，区分 `X-HotAPI-Data-Mode: upstream` 与 `offsite-snapshot`；后者必须有原始 `capturedAt`、age和 `Warning:110`。再检查 Functions错误、调用量、CPU/Memory预算与CDN缓存。未进行任何生产故障注入，不在Production设置预览模拟开关。
- **回滚触发**：上线后任一未经授权来源被当成云端快照、403被遮蔽、榜单不附旧数据时间、原路径丢失、函数持续5xx或配额异常时，停止继续推广。经现有授权的 Vercel 回滚管理面**明确回滚到上方已核实的旧 Production Deployment**，由管理面回读域名和部署ID后再验证；不通过DNS切向其他未经验收主机，不重启旧6692，不运行任何PG写入。回滚可能暂停自动生产别名分配，下一次受控发布前必须再次确认状态。
- 回滚/发布都必须记录**精确 SHA、部署 ID、Production alias、授权人、CI run 和观测时间**；项目级授权缺失或身份不一致一律 NO-GO。

## 不虚报的边界及成本

第一阶段保证停电期间最后有效榜单仍可读，不保证断电时继续更新。真正断电后继续产生新排名需要第二阶段把部分源迁到独立云端采集，并逐源核实可抓取性、授权及地区限制。
Vercel Serverless Function 每个被接管的 HTTP 请求会产生额外执行与配额消耗，相比原 Edge rewrite 成本上升；上游超时至多4秒，GitHub回退至多3秒。只保留七条核心公开源以控制成本，等 Vercel Hobby 的实际流量和账单验证后再扩面。
固定 Release asset 的 --clobber 更新可能有短暂缺口，内置静态种子可接手，但可能随时间陈旧。Cloudflare/GitHub/Vercel均可能独立故障，这不是100%SLA。
恢复为原单条 HTTPS rewrite 并撤销七条精准函数路由即可回滚；不需修改 bt1 服务、用户认证或DNS。
