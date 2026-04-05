# Love Clock 迁移说明

本项目已将 `clock.html` 的翻页时钟视觉与核心交互迁移到 `love.html`。

## 已迁移能力

- Pqina Flip 翻页时钟（时 / 分 / 秒）
- 时钟日期行显示（中文本地化）
- 双击时钟区域进入/退出网页全屏展示模式
- 与页面主题联动的时钟色彩变量
- 新增“相爱天数”模块（与时钟区域同风格）

## 关键文件

- `love.html`
  - 替换原有时钟 DOM 为 Tick 结构
  - 新增天数模块
  - 引入并优化资源加载（`preconnect` + `defer`）
- `js/script.js`
  - 新增 `handleLoveTickInit`、`updateClockTick`、`updateClockDateDisplay`、`toggleClockFullscreen`
  - 复用原有恋爱起始时间与纪念日逻辑
- `css/style.css`
  - 新增 clock-theme / Tick / 全屏 / 天数模块样式

## 验证结果

- `love.html`：语法检查通过
- `js/script.js`：`node --check` 通过
- `css/style.css`：语法检查通过

## 说明

项目为静态网页，无 `package.json` 等依赖清单；第三方库通过 CDN 引入：

- `@pqina/flip`
- `qrcodejs`
- `font-awesome`
