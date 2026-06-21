# Design — user.js 性能测试与优化

已确认的设计事实与约束。这是约束不是待办;具体未完成工作见 `skills.sqlite` 的 `todos`,操作方法见 `SKILL.md`。

## 目标

为 `user.js` 建立可复现的性能测试,基于真实测量数据优化首次扫描耗时、mutation 批处理耗时、IPA 标注端到端延迟与内存占用,不引入标注质量回归。

## Harness 架构决策

- **自启 Chrome 走 CDP**:harness 用临时 `--user-data-dir` + `--remote-debugging-port` 开 CDP,加一组允许自动化的命令行标志,通过 CDP 加载样本、等渲染稳定、注入 user.js、收 metric。不引 puppeteer / playwright,直接基于 Node 内置 `WebSocket`。
- **样本 HTML 本地存放,不入 git**:落 `perf/samples/`,该目录在 `.gitignore`。
- **基线数据入 git**:`perf/baseline.json` 作为后续优化的对比锚点。
- **样本类型**:大型在线小说页(单页文字量大、DOM 深,压英文 IPA 标注 hot path)。当前两份:`pride-and-prejudice`(PG #1342,中等规模)、`war-and-peace`(PG #2600,压力样本)。
- **measurement 全部外部进行**:harness 在注入 user.js 前后打 `performance.now()` / CDP `Performance.getMetrics`。**`user.js` 内不保留 perf 埋点**;需要量函数内分块耗时时仅测试期临时改 user.js,跑完恢复,不 commit。
- **Bing 请求**:gmShim stub mock + 可选 warm cache preload,不真发请求、不用 CDP `Fetch.fulfillRequest`(拦不到 `GM_xmlhttpRequest`)。

## 指标集合

`scanMs` / `translateSyncMs` / `firstBatchMs` / `addRubyCount`(`ruby > rt.ipa-additional-rt` 计数 = addRuby 成功次数)/ `rubyFilledCount`(rt 含 `data-rt` = 异步回调已写入 IPA)/ `gmXhrCalls` / `gmGetHits` / `gmGetMisses` / `gmSetCount` / `cacheHitRate` / `jsHeap{Before,After}Bytes` / `nodes{Before,After}`。

`addRubyCount` / `gmXhrCalls` deterministic(CV=0),作正确性断言;`scanMs` / `firstBatchMs` CV 约 5–8%,用 median + IQR。

## 阶段划分

数据驱动、刻意不预设优化方向,避免凭想象做"性能优化":

1. **阶段 1(已完成)** — harness 基础设施 + 基线统计 + `perf/baseline.json`。
2. **阶段 2** — 已知热点的覆盖测试。
3. **阶段 3** — 针对性优化(看到真实数据后才拆具体子任务)。
4. **阶段 4** — 回归手测 + 优化前后对比报告 + bump `@version` → commit → push。

## 基线结论(perf/baseline.json,2026-05-24)

- P&P cold (n=5):scanMs median=22958 / CV=5.1%,firstBatchMs CV=5.1%,addRubyCount 122943 / CV=0%,gmXhrCalls 6722 / CV=0%。
- P&P warm (n=5):scanMs median=22574 / CV=4.5%,firstBatchMs CV=2.7%,translateSyncMs median=3033 / CV=17.2%(updateRuby 同步路径成本被显式量化),cacheHitRate 100%。
- W&P cold (n=1):scanMs=452240(7.5 分钟),addRubyCount=553569,作压力上限参考。

scanMs 占 firstBatchMs ~90%,`scanTextNodes` 是首要怀疑瓶颈。
