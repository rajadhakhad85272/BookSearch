# EdgeOne 前后端路由

前端静态页面仍从 EdgeOne 提供。管理页面使用现有 Django 模板和会话认证，同域转发到 `http://88.96.42.58`，不把模板转成静态网页，也不把任何私钥或其他凭据放到前端。

## 函数路由

| URL | 来源 |
| --- | --- |
| `/api`、`/api/*` | 固定后端 |
| `/manage`、`/manage/*` | 固定后端 |
| `/static/search_manage`、`/static/search_manage/*` | 固定后端管理界面资源 |
| `/`、`/js/*`、`/css/*`、`/img/*`、`/webfonts/*` | 原有前端静态文件 |

每一组路径都有 `index.js` 和 `[[path]].js`，同时覆盖入口及其子路径。共享实现位于 `lib/backend-proxy.js`。部署必须包含函数构建，单纯上传静态文件不会安装这些路由。

本仓库使用当前 `edge-functions/` 目录。EdgeOne CLI 1.6.41 已成功构建，并验证六条路由以及共享模块打包。推送本仓库 `main` 分支后由 EdgeOne Git 集成自动构建；无需手动上传，也无需新增依赖。不要同时添加旧版 `functions/` 目录。

## 回源约定

- 固定回源地址 `http://88.96.42.58`；保留现有 HTTP 回源架构，不变更 DNS 或证书。
- 传递 `Host: book.laiye.site`、`X-Forwarded-Host: book.laiye.site`、`X-Forwarded-Proto: https`。源站 Nginx 应按此域名接收请求并正确代理给 Django。
- 保留请求方法、查询、正文、Authorization、Cookie、CSRF、Origin 和 Referer。Django 必须继续验证 CSRF；不要用代理重写 Origin 绕过验证。
- 保留状态码、响应正文、独立的 Set-Cookie。手动处理重定向，不让边缘函数自动跟随登录跳转或 Cloudreve 下载地址。指向源站自身的绝对跳转改为浏览器当前域名，外部下载链接不变。
- `/api` 和 `/manage` 请求与响应禁用缓存，不调用 Cache API。已有控制台缓存规则也必须允许响应的 `no-store` 生效。
- 只代理管理页面自己的静态目录，不接管整个 `/static/`。
- 搜索回源读取超时设为 300 秒；平台仍有独立函数限制，实际超时需部署后验证。

## 本地验证

如使用 EdgeOne CLI 进行本地构建，执行 `edgeone makers build --ENV_STR '{}'`，避免本机环境变量进入函数产物。`.edgeone/` 仅为本地输出，不提交到仓库。

```sh
node --test tests/backend-proxy.test.mjs
```

测试用模拟请求覆盖登录 POST、多个 Cookie、查询、重定向、状态码、静态资源隔离、HEAD、后端故障和禁缓存，不连接真实账号服务。

部署后需验证：首页、`/api/check`、`/manage/` 跳转、管理 CSS，以及真实浏览器登录后的会话 Cookie/CSRF 和管理员页面。预览域名未配置到 Django 的可信源时，管理表单会被 CSRF 拒绝；不要通过删除 CSRF 校验解决。

## 官方参考

- [Edge Functions：目录路由和 onRequest](https://pages.edgeone.ai/document/edge-functions)
- [旧版 Pages Functions 路由](https://edgeone.ai/document/162227908259442688)
- [Fetch：manual 重定向与超时](https://edgeone.ai/document/52687)
- [Headers：getSetCookie](https://edgeone.ai/document/52689)
