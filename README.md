<div align="center">
<img alt="logo" height="120" src="./public/favicon.png" width="120"/>
<h2>今日热榜</h2>
<p>一个聚合热门数据的 API 接口</p>
</div>

## 🚩 特性

- 极快响应，便于开发
- 支持 RSS 模式和 JSON 模式
- 支持多种部署方式
- 简明的路由目录，便于新增

## 👀 主仓库

本仓库仅用于 `Vercel` 部署，更多信息请请前往 [DailyHotApi](https://github.com/imsyy/DailyHotApi)

## ⚙️ 部署

通过点击下方按钮进行一键部署，或者手动进行部署

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/imsyys-projects/clone?repository-url=https%3A%2F%2Fgithub.com%2Fimsyy%2FDailyHotApi-Vercel)

## ⚙️ 当前部署与自动更新核查（2026-10-28）

本仓库是早期 `dailyhot-api` 的轻量 Vercel 包装服务，当前仍依赖 `dailyhot-api@^2.0.6`。**不要误认为本仓库等于当前在 bt1 运行的 `wuaishare/DailyHotApi`；也不要将其直接指向生产的 `hotapi2.wuaishare.cn`。**

在目前获授权检查的 Vercel 团队 `jack's projects` 中：

- Vercel 项目：`dailyhotapi123`。
- 已验证的项目域名：`dailyhotapi.wuaishare.cn`（**不是** `hotapi.wuaishare.cn`）。
- 当前 GitHub 连接显示为 `wuaishare/DailyHotApi-Vercel`。此连接仅证明配置存在，**不证明今天的 Git push 能成功触发 Preview 或 Production**。
- 历史最近的 Vercel 构建在 2025 年 2 月，其提交元数据仍是早期 `pinion13/dailyhotapi123`；该元数据不代表当前连接的仓库。
- 本仓库截至本次核查只有 `.github/dependabot.yml`，**没有 GitHub Actions 工作流**。之前 README 中“每天 0:00 自动更新”来自上游模板，并非本仓库当前已验证的运行事实。

本地可运行只读源码契约检查：

```bash
node ops/audit-vercel-source.mjs
```

该检查只验证入口、依赖与 Vercel 路由配置；不能验证 Vercel 的 Git 集成触发、Cloudflare DNS Origin、HTTPS SNI、线上 API 数据。要确认自动部署，需在**非生产分支**创建真实 Preview 构建，签收 Vercel 对应 Git SHA 以及隔离环境的健康响应；更新 Production 必须另行授权、审查依赖兼容性和域名归属，不能只因为提交一个 README 就重启或重部署旧 API。

独立旧域名 `hotapi.wuaishare.cn` 当前并未绑定在该团队的 Vercel 项目中；其 Cloudflare 回源与实际项目归属需要单独签收，不允许自动别名到本项目或现代 `hotapi2`。