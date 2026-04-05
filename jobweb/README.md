# jobweb

`jobweb` 是从 `FinIntern Hub` 提炼出来的静态站版本，保留了核心前端能力：

- 首页概览
- 岗位列表与筛选
- 本地收藏
- 静态智能推荐
- 系统概览
- 静态登录
- 静态用户管理
- 静态数据采集台
- 浏览器直连 AI 分析

它使用纯 `HTML + CSS + JavaScript` 实现，不依赖 FastAPI 才能运行。页面读取的是预先导出的 `data/jobs.json` 数据快照，因此非常适合：

- 本地离线预览
- GitHub Pages
- 其他纯静态托管

## 如何更新数据

在项目根目录运行：

```powershell
python export_jobweb_data.py
```

这会把最新数据库内容导出到：

```text
jobweb/data/jobs.json
```

## 如何本地预览

使用任意静态服务器即可，例如：

```powershell
python -m http.server 5500
```

然后访问：

```text
http://127.0.0.1:5500/jobweb/
```

## 部署建议

最推荐直接把 `jobweb` 目录推到 GitHub 仓库后，开启 GitHub Pages。

## 说明

- 收藏、推荐历史、登录状态、用户列表、采集日志都保存在浏览器本地 `localStorage`
- 静态推荐默认使用前端规则打分，也支持在系统概览页配置 SiliconFlow API 后直接从浏览器调用 AI
- 静态登录和用户管理是本地模拟版，不具备真正服务端安全性
- 数据采集页是静态监控台与本地任务记录演示，不会真实启动爬虫
- 由于 API Key 会保存在浏览器本地，建议只在个人环境使用，不要把带密钥的静态页公开给他人
