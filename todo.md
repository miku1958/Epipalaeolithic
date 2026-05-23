# Todo

## P0:user.js 性能优化与性能测试基础设施

目标:为 user.js 建立可复现的性能测试,基于真实测量数据优化首次扫描耗时、mutation 批处理耗时、IPA 标注端到端延迟与内存占用,不引入标注质量回归。

### 待拍板(动手前需要用户确认)

- [ ] 测试 harness 选型:Playwright headless / Puppeteer / 直接 Tampermonkey + 真实浏览器手测?影响 CI 可行性、样本可复现性、仓库依赖体积。
- [ ] 测试样本来源:本地保存的 HTML 快照 / 在线真实 URL 抓取 / 手写 fixture?样本是否提交进仓库、还是只本地 + `.gitignore`?
- [ ] 性能基线数据存放:`perf/baseline.json` 入 git 作为对比锚点 / 仅本机不入 git / 其他位置?
- [ ] 是否允许在 user.js 内长期保留**可关闭的** perf 埋点(默认关、靠 `GM_setValue` 开关打开):优点是自测随时能开,缺点是有少量未执行分支代码长期留在生产脚本里。

### 阶段 1:建立性能测试基础设施

(待上面 4 条决策落定后展开)

- [ ] 按决策搭 `perf/` 目录骨架:harness、样本、runner、报告输出位置
- [ ] 定义初版指标集合:首次 `scanTextNodes` 总耗时、每批 mutation 平均处理耗时、`addRuby` 调用次数、Bing 请求数 + `GM_getValue` 缓存命中率、堆内存峰值
- [ ] 准备至少 3 个代表性样本:纯英文文档站、GitHub PR 页、SPA(Teams chat 或 Bilibili 视频页任选)
- [ ] 跑基线,确认同一样本多次跑数据波动在可接受阈值内,把基线数据落到选定位置

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
