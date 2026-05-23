# Todo

## P0:user.js 性能优化与性能测试基础设施

目标:为 user.js 建立可复现的性能测试,基于真实测量数据优化首次扫描耗时、mutation 批处理耗时、IPA 标注端到端延迟与内存占用,不引入标注质量回归。

### 已确认的方向

- **测试 harness**:agent 自启 Chrome — 临时 `--user-data-dir`、`--remote-debugging-port` 开 CDP,加上一组允许自动化操作的命令行标志(`--no-first-run` / `--no-default-browser-check` / 关闭各种首启 banner 等,具体组合 agent 调研并落到启动脚本里),通过 CDP 加载样本、等渲染稳定、注入 user.js、收 metric。**用户已对本项目一次性授权 chrome-cdp 类操作**,后续每轮不需重复确认。
- **样本 HTML**:本地存放,**不入 git**;落在 workspace 内 `perf/samples/`,该目录加进 `.gitignore`。
- **基线数据**:JSON 入 git,作为后续优化的对比锚点。
- **样本类型**:大型在线小说页(单页文字量大、DOM 深,适合压英文 IPA 标注的 hot path)。
- **不在 user.js 内保留 perf 埋点**;测量从外部进行(harness 在注入 user.js 前后打 `performance.now()`、CDP `Performance.getMetrics` 等)。需要量函数内分块耗时时仅在测试期临时改 user.js,跑完恢复,不 commit。

### 阶段 1:建立性能测试基础设施

- [ ] 定义指标集合(初版):harness 注入 user.js 起到首次 `scanTextNodes` 返回的耗时、首批 mutation 处理耗时、`addRuby` 调用次数、Bing 请求次数 + `GM_getValue` 缓存命中率、JS 堆内存峰值
- [ ] 决定如何处理 Bing 请求(真请求 + 预热缓存 / CDP `Fetch.fulfillRequest` mock 一个本地响应),让指标可复现 — 看哪种方案在波动测试中更稳
- [ ] 跑基线 N 次取统计(中位数 + IQR),确认波动可接受,基线落到 `perf/baseline.json`

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
