# Todo

## P0:user.js 性能优化与性能测试基础设施

目标:为 user.js 建立可复现的性能测试,基于真实测量数据优化首次扫描耗时、mutation 批处理耗时、IPA 标注端到端延迟与内存占用,不引入标注质量回归。

### 已确认的方向

- **测试 harness**:真实 Chrome 加载样本页面,**等页面加载完成后**再注入 user.js 实测;不走 Playwright / Puppeteer 抽象层。
- **样本类型**:大型在线小说页(单页文字量大、DOM 深,适合压英文 IPA 标注的 hot path)。
- **基线数据**:入 git 作为后续优化的对比锚点。
- **不在 user.js 内保留 perf 埋点**;测量从外部进行(harness 在注入 user.js 前后打 `performance.now()`、DevTools Performance Tab 录制等)。需要量函数内分块耗时时,仅在测试期临时改 user.js,跑完恢复,不 commit。

### 待拍板(动手前还需要用户确认)

- [ ] **样本 HTML 快照是否入 git**:在线小说 URL 内容会随时间漂移,仅存 URL → 不可复现。倾向把某次完整 HTML 快照存到 `perf/samples/` 入 git;但小说全文 + 外链资源可能让仓库膨胀。可接受的折中:存只含 `<body>` HTML + 必要内联 CSS 的"准静态"快照,丢弃图片 / 字体外链。是否同意?
- [ ] **harness 是 agent 自动控制 Chrome 还是 user 手动跑**:前者用 chrome-cdp 让 agent 自己加载页面 / 等渲染稳定 / 注入脚本 / 收 metric,自动化高但每次都需要你授权 chrome-cdp;后者你手动跑测把数字回灌给我,无依赖但每轮要人工。

### 阶段 1:建立性能测试基础设施

(待上面 2 条决策落定后展开)

- [ ] 按决策搭 `perf/` 目录骨架:样本目录、runner、基线 JSON 写入路径
- [ ] 定义初版指标集合:user.js 注入到首次 `scanTextNodes` 返回的耗时、首批 mutation 处理总耗时、`addRuby` 调用次数、Bing 请求数 + `GM_getValue` 缓存命中率、堆内存峰值
- [ ] 选定 1–2 个具体在线小说页作为样本(挑文字密集、DOM 结构典型的,避免太多动态加载导致 mutation 风暴干扰首次扫描指标)
- [ ] 跑基线,确认同一样本多次跑数据波动在可接受阈值内,基线落到 `perf/baseline.json`(或等价位置)

### 阶段 2:已知热点的覆盖测试

阶段 1 跑通后展开。当前怀疑的热点(等基线数据印证后再敲定具体测项,不预先承诺):

- `scanTextNodes` 跳过规则链 — 每个节点都过多层 `excludeTags` / `excludeClass` / `computedStyleMap` / `getComputedStyle` 判定
- `skipElements` Set 的线性祖先扫描 — `for (const skipElement of skipElements) skipElement.contains(node)`,Set 越大越慢
- `StylePropertyMapReadOnly.prototype.get` monkey-patch — 全局生效,每次 style 读取都过 `parseFloat` + 字符串处理
- `updateRuby` 对 `<div>` 祖先链的 inline style 注入与 `-webkit-line-clamp` 清除
- Bing 空 IPA → `convertPhrase` 还原 → 二次查询链路:`phrase 入队 → 首次请求 → 空响应 → 搬运到 originalPhrase → 二次请求 → 写入 rt`,每条相邻边都要有测试

### 阶段 3:针对性优化

阶段 1 + 2 完成、看到真实数据后再拆具体子任务。**此阶段刻意不预设优化方向**,避免凭想象做"性能优化"。

### 阶段 4:回归 + 发布

- [ ] 真实页面手测金路径(纯文档 / GitHub / Teams / Bilibili)
- [ ] 优化前后指标对比写入 `perf/` 下的报告文件
- [ ] bump `user.js` 顶部 `@version` 到当天日期 → commit → push
