# CodexConnector · 商品表现看板

GA4 商品收入与订单、Meta 和 Google Ads 消耗的汇总看板。服务器直接调用平台 API；配置完成后，日常更新在网页点击“同步平台数据”，无需打开 Codex。

## Zeabur 部署

1. 在 Zeabur 新建 GitHub 服务，选择 `Grallyzhang/CodexConnector` 的 `main` 分支。根目录 Dockerfile 自动识别；若已有服务，部署最新提交。
2. 设置 `DASHBOARD_PASSWORD`（至少 16 位），可选 `DASHBOARD_USERNAME`（默认 `admin`）。设置下方平台授权变量。
3. 添加持久化存储，挂载路径 `/app/data`。保留单实例，避免多实例同时覆盖数据。
4. 绑定 HTTPS 域名，端口 `8080`（优先使用 Zeabur 的 `PORT`）。健康检查 `/health`。
5. 打开网站登录，页面显示授权变量是否齐全。选一天先做首次同步；成功后可扩大日期范围。也可先导入原有 `data/dashboard.json` 再更新。

源码不含业务报表或密钥。环境变量直接在 Zeabur 设置，应用不自动读取 `.env` 文件。完整清单见 [.env.example](.env.example)。

## 必填平台授权

| 环境变量 | 填写内容 |
| --- | --- |
| `GOOGLE_CLIENT_ID` | 你自己的 Google OAuth 客户端 ID |
| `GOOGLE_CLIENT_SECRET` | 同一客户端的密钥 |
| `GOOGLE_REFRESH_TOKEN` | 同一客户端获取的刷新令牌，须包含下列两个权限 |
| `META_ACCESS_TOKEN` | 可读取两个广告账户、包含 `ads_read` 权限的访问令牌 |

Google 刷新令牌必须同时授权：

- `https://www.googleapis.com/auth/analytics.readonly`
- `https://www.googleapis.com/auth/adwords`

Google 授权用户须有目标 GA4 属性和 Google Ads 账户的读取权限。Google Cloud 项目须启用 Google Analytics Data API 与 Google Ads API，并完成 Google Ads 所需的 API 访问配置。应用会在服务器上使用刷新令牌获取短期访问令牌，不向浏览器暴露密钥。现有 Codex 连接的授权不会自动转移。

获取 Google 刷新令牌：按 [Google OAuth Web Server 官方流程](https://developers.google.com/identity/protocols/oauth2/web-server#offline) 为自己的 OAuth 客户端授权上述两个 scope，使用 `access_type=offline`，将返回的 `refresh_token` 保存到 Zeabur。已有令牌若缺少其中一个 scope，需要重新授权。OAuth 应用处于 Testing 时，刷新令牌可能短期失效，应按实际使用范围完成发布或内部应用配置。本项目不提供 OAuth 回调页面；也可用配置了自己客户端的 [Google OAuth Playground](https://developers.google.com/oauthplayground/) 完成首次授权。

Meta 可使用你自己应用的、获准访问这两个广告账户的系统用户令牌，授予读取广告数据的权限。令牌失效或权限撤销后需更新变量。若应用启用了 appsecret_proof 校验，另外填写 `META_APP_SECRET`。

## 账户与可选配置

| 环境变量 | 默认值 / 用途 |
| --- | --- |
| `GA4_PROPERTY_ID` | `378788930` |
| `GOOGLE_ADS_CUSTOMER_ID` | `9347478419`，不带连字符 |
| `META_AD_ACCOUNT_IDS` | `222947167250427,844151987085048` |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | 通过经理账户访问子账户时填写经理账户 ID |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | 如你的 Google Ads API 接入配置要求开发者令牌则填写；设置后作为请求头发送 |
| `GOOGLE_ADS_API_VERSION` | `v25` |
| `META_API_VERSION` | `v26.0` |
| `META_APP_SECRET` | 可选，生成 appsecret_proof |
| `DATA_DIR` | 容器默认 `/app/data` |

当前统计口径固定：GA4 为 USD / America/Los_Angeles；Google Ads 为 CNY / Asia/Shanghai；Meta 为 USD / Asia/Shanghai；Google 消耗按 6.8 换成 USD。同步先检查账户币种和时区，不符合则停止，避免错误换算。若改为其他账户，请使用独立数据目录；不同账户的数据不会合并。

## 在线更新行为

- “同步平台数据”：按所选日期读取 GA4 商品与交易、Google 系列与商品消耗、Meta 账户/广告/商品明细。只读取平台报表，不修改广告设置。
- 单次最多 31 天，逐日读取并完整分页。结束日期不能晚于洛杉矶今天；当日与近期数据可能补报，可以重复同步。
- 重叠日期替换；其他历史日期保留。扩展日期须与已有范围相邻，不能跳过中间日期后把缺口显示成零。
- 三个平台全部成功、通过校验后，才备份并原子替换 `dashboard.json`。失败和取消保留旧报表，支持重新发起；网络暂时错误会有限重试。
- 页面显示当前进度，可取消任务。同步继续在服务器后台运行，关闭网页不会停止；服务器重启会将未完成任务标为中断，需要重新发起。
- 单任务最长 30 分钟。同步和手工导入互斥；不支持多实例共享同一目录。
- Meta 商品明细受平台返回范围约束，未拆分费用保留。商品报告请求 `product_id_limit=10000`，若单广告达到上限则停止以免误报完整。账户和广告消耗差额超过 0.10 USD 也会停止。
- GA4 返回采样、阈值或 other 行数据损失标志时停止。Google 商品消费超过对应系列消费时停止。
- 保留商品型号归并和匹配建议。新同步的 Meta 未拆分广告记录保留广告名称，本版本不额外读取创意链接和创意标题；有商品 ID 的明细不受影响。
- “刷新报表”只重新读取服务器已保存数据。
- “导入报表”上传本项目生成的完整 `dashboard.json`（最多 50 MB），整份替换而非合并；上一版保存为 `dashboard.previous.json`。
- 手动商品匹配仍保存在当前浏览器，尚未跨设备同步。本版本不包含每日定时同步。

## 验证与限制

需要 Node.js 24，无第三方运行依赖。

- `npm start`：本地启动，默认 `http://127.0.0.1:4318`，仅监听本机。
- `npm test`：接口及模拟平台测试，无需密钥或业务报表。
- `npm run test:reports`：需要本地 `data/dashboard.json` 的真实历史报表回归测试。

模拟测试覆盖分页、令牌隔离、币种和金额、订单哈希去重、重复日期更新、失败不覆盖、备份、取消和重启恢复。真实平台授权与线上部署需要在 Zeabur 配置凭据后完成验收；“参数已配置”仅表示变量齐全，不代表账户已通过连接验证。

`build-data.mjs`、`merge-update.py` 是旧版离线整理工具，账户和日期固定。`update-ui.mjs` 是旧版页面生成脚本，运行会覆盖新页面，不用于部署。线上同步逻辑在 `sync.mjs`、`sync-jobs.mjs`。

## 官方参考

- [Zeabur Dockerfile 部署](https://zeabur.com/docs/zh-CN/deploy/methods/dockerfile)
- [Google Analytics runReport](https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/runReport)
- [Google Ads Search 分页](https://developers.google.com/google-ads/api/rest/common/search)
- [Google Ads 账户访问模型](https://developers.google.com/google-ads/api/docs/oauth/access-model)
- [Meta 官方 SDK Insights 参数](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adaccount.py)
