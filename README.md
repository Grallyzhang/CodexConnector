# CodexConnector · 商品表现看板

GA4 商品收入与订单、Meta 和 Google Ads 消耗的汇总看板。

## Zeabur 部署

1. 在 Zeabur 新建 GitHub 服务，选择 `Grallyzhang/CodexConnector` 的 `main` 分支。根目录 Dockerfile 会自动识别。
2. 添加环境变量 `DASHBOARD_PASSWORD`（自行设置至少 16 位密码）；`DASHBOARD_USERNAME` 可选，默认 `admin`。其他默认值已写入 Dockerfile，完整列表见 `.env.example`。程序不会自动读取本地 `.env` 文件。
3. 添加持久化存储，挂载路径 `/app/data`。保留单实例，避免多实例同时覆盖文件。不要使用临时容器目录保存正式报表。
4. 绑定 HTTPS 域名，端口为 `8080`（程序优先读取 Zeabur 的 `PORT`）。健康检查路径 `/health`。
5. 打开网站，使用上述用户名和密码登录；点击“导入报表”，上传本地 `data/dashboard.json`。

源码仓库不含业务报表或密钥。首次部署显示无数据是正常状态，导入后即可使用。密码保护覆盖网页及报表接口；健康检查仅返回服务标识。

## 当前更新能力

- “刷新报表”：读取服务器上已有的报表。
- “导入报表”：上传本项目生成的完整 `dashboard.json`（最多 50 MB），验证后替换，上一版保存为 `dashboard.previous.json`。
- 导入为整份替换，不合并日期。跨日期更新时请上传完整的目标日期范围。
- 手动商品匹配仍保存在当前浏览器，暂未跨设备同步。
- **本版本尚未连接平台 API / MCP，不能直接拉取广告平台最新数据。** 后续需配置独立于 Codex 的平台授权，并实现同步任务；仅添加平台密钥环境变量不会启用自动同步。

## 本地运行与验证

需要 Node.js 24。运行 `npm start`，访问 `http://127.0.0.1:4318`。本地默认仅监听本机；生产环境必须配置密码。

- `npm test`：独立的服务器接口验证，无需业务数据。
- `npm run test:reports`：需要本地 `data/dashboard.json` 的真实报表回归验证。

`build-data.mjs`、`family-rules.mjs` 保留现有数据整理与商品归并逻辑；现有构建脚本的账户和日期是固定配置，尚不是通用在线同步器。`update-ui.mjs` 是旧版页面生成脚本，运行会覆盖新版页面，不用于部署。

Zeabur 文档：[Dockerfile 部署](https://zeabur.com/docs/zh-CN/deploy/methods/dockerfile)、[环境变量](https://zeabur.com/docs/en-US/deploy/config/environment-variables)。
