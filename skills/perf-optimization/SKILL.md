---
name: perf-optimization
description: user.js 性能测试与优化工作流。何时使用:跑 perf harness 量基线 / 对比优化前后、改 scanTextNodes / updateRuby / monkey-patch 等热点、解读 perf/baseline.json、用 Chrome CDP 驱动样本测 IPA 标注耗时与内存。关键词:perf harness、baseline、scanMs、translateSyncMs、cold/warm cache、gmShim、measureSample、Chrome CDP、性能优化、profiling。
---

# user.js 性能测试与优化

为 `user.js`(IPA 标注 user script)建立可复现的性能测量,基于真实数据定位并优化首次扫描 / mutation 批处理 / 标注端到端延迟 / 内存,且不回归标注质量。harness 全部在 `perf/` 下,不依赖 puppeteer / playwright。

## When to Use

- 要量 `user.js` 的性能基线,或对比一处改动的优化前后。
- 改动落在已知热点:`scanTextNodes` 跳过规则链、`skipElements` 祖先扫描、`StylePropertyMapReadOnly.prototype.get` monkey-patch、`updateRuby` 的 inline style 注入、Bing 空 IPA 二次查询链路。
- 解读 `perf/baseline.json` 或新增指标。

不适用:`user.js` 功能 / 标注正确性改动(读 `CLAUDE.md` 的架构说明),与性能无关的站点适配。

## Harness 组成

每个脚本职责见源码,改动前读对应文件,不要照搬实现进本文:

- `perf/launchChrome.js` — 临时 `--user-data-dir` profile + `--remote-debugging-port=0` 自选端口(从 `DevToolsActivePort` 读真实端口)+ 一组关闭首启向导 / 默认浏览器询问 / 后台联网 / 组件更新 / 翻译条的标志。`close()` 清理临时 profile。
- `perf/cdpClient.js` — 基于 Node 内置 `WebSocket` 的 JSON-RPC,封装 `navigate` / `waitForNetworkIdle` / `evaluate`(页面异常翻译成 Node throw)/ `getMetrics`。断开时 reject 所有未完成 waiter,避免悬挂 Promise。
- `perf/gmShim.js` — user.js 注入前先注入:提供 `GM_xmlhttpRequest` / `GM_getValue` / `GM_setValue` / `GM_addStyle` 最小实现并统计到 `window.__perfStats`;把 `window.MutationObserver` 替成 no-op,以便手动驱动 `scanTextNodes` + `translateTextNodes` 测纯工作量、剥离 debounce 50ms 噪声。
- `perf/harness.js` — 导出 `measureSample(slug, { warmCache, dumpStorage })`:`file://` 载入样本 → 注入 gmShim → 用 `<script>` 标签注入 user.js 全文(顶层是 function declaration,`Runtime.evaluate` 当 expression 跑挂不到 global)→ 手动驱动两函数测时 → drain mock xhr → 采指标。
- `perf/captureSample.js` — 抓渲染后 DOM 落 `perf/samples/<slug>.html`,抓取时剥掉所有 `<script>` 防本地副本执行原页面 JS 污染测量;索引写 `perf/samples.index.json`(入 git)。
- `perf/runBaseline.js` — 跑基线:per-sample retry(N=2)+ 增量写盘(每完成一个 sample 立刻 merge 到 `baseline.json`),防偶发 `CDP ws closed before response` 拖垮整轮。
- `perf/test-*.js` / `perf/probe-bing-strategy.js` — 端到端自检与策略验证。

## Procedure

1. 样本就绪:`perf/samples/<slug>.html` 存在(不入 git)。缺样本用 `captureSample.js` 抓,**不要凭想象造样本**。
2. 量基线 / 对比:跑 `runBaseline.js`,或在脚本里调 `measureSample(slug, opts)`。重命令加 `nice -n 19`。
3. 需要量某函数内部分块耗时时:**临时**在 `user.js` 里加 `performance.now()` 打点,跑完**恢复、不 commit**(产品不保留 perf 埋点)。
4. 解读:看中位数 + IQR,不用均值;同一指标在同一 run 内的 CV 才有意义。

## 方法论与坑(代码里看不出来的)

- **优化对比必须同一次 baseline run 内配对跑(优化前 vs 优化后),不跨日子比绝对值**。跨 run 绝对值受 macOS 负载 / 温度 / 电源模式影响极大,同代码两次可差 ~2x。
- `scanMs` / `firstBatchMs` 的 CV 约 5–8%,可接受;用 **median + IQR**。
- **warm 与 cold 双模式不可少**:warm(全缓存命中)下 `translateSyncMs` 比 cold 高 ~350x,因 user.js 命中缓存时同步走 `updateRuby` 全套(`rt.dataset.rt` + 祖先 `<div>` 注入 `align-items:end` / `line-height` + 清 `-webkit-line-clamp`)。这条成本在 cold 模式被 mock xhr 的 `setTimeout` 异步隐藏,只测 cold 会完全看不到。
- `addRubyCount` / `gmXhrCalls` 完全 deterministic(CV=0),用作正确性断言:优化不能改变这两个计数。
- scanMs 占 firstBatchMs ~90%,`scanTextNodes` 是首要怀疑瓶颈;但**先量再优化,不预设优化方向**。

## Bing 请求策略

不真发 Bing 请求,也不用 CDP 拦截:

- CDP `Fetch.fulfillRequest` **拦不到** `GM_xmlhttpRequest`(Tampermonkey API 不走浏览器 HTTP 栈)。
- 真请求引入网络抖动、可能触发限流,且污染"测 user.js 内部 JS 工作量"的目标。
- 方案:**gmShim stub mock + 可选 warm cache preload**。`warmCache` 是 phrase→ipa map,注入 user.js 前预填 `window.__perfStorage` 模拟重访全命中;`dumpStorage` 让一次 cold run 把 phrase 集合提出来喂给后续 warm run。

## Validation

- 改 harness 后跑 `perf/test-launch.js` / `perf/test-cdp.js` / `perf/test-harness.js` 端到端自检。
- 改 `user.js` 性能后:同一 run 内配对量,确认目标指标改善且 `addRubyCount` / `gmXhrCalls` 不变(标注质量无回归);再按 `CLAUDE.md` 在真实页面手测金路径(纯文档 / GitHub / Teams / Bilibili)。

## Safety / Constraints

- **chrome-cdp 类操作本项目已一次性授权**,perf 测量每轮无需重复确认。
- 样本 HTML 含原站点内容,**不入 git**(`perf/samples/` 已在 `.gitignore`)。
- **`user.js` 不保留任何 perf 埋点**;测量从外部进行,函数内分块计时只在测试期临时加、跑完恢复不 commit。
- W&P(war-and-peace)样本一次 cold ~4–8 分钟,只作压力上限单点参考,不适合多跑。
