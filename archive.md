# Archive

## 2026-05-24

### P0 阶段 1:基线统计 + perf/baseline.json(阶段 1 收官)

`perf/runBaseline.js` 跑两份样本的基线:P&P 1 seed + 5 cold + 5 warm,W&P 1 cold(W&P 一次 ~4–8 分钟,不适合多跑,作压力上限单点参考)。`statsOf()` 算 min / q1 / median / q3 / max / iqr / mean / stddev / cv。runner 加了 per-sample retry(N=2)和增量写盘(每完成一个 sample 立刻 merge 到 baseline.json),防 W&P 偶发 `CDP ws closed before response`(首跑碰到一次,单独重试成功 → 判定 flaky 而非 deterministic)拖垮整体。

落盘 `perf/baseline.json`(入 git,20 KiB):
- P&P cold (n=5): scanMs median=22958 / CV=5.1%, firstBatchMs CV=5.1%, addRubyCount 122943 / CV=0%, gmXhrCalls 6722 / CV=0%
- P&P warm (n=5): scanMs median=22574 / CV=4.5%, **firstBatchMs CV=2.7%**, translateSyncMs median=3033 / CV=17.2%(updateRuby 同步路径成本被显式量化), cacheHitRate 100%
- W&P cold (n=1): scanMs=452240(7.5 分钟), addRubyCount=553569,作压力上限参考

scanMs / firstBatchMs CV < 6% 对优化对比可用。**关键方法论**:跨 run 绝对值受 macOS 负载 / 温度 / 电源模式影响很大(同代码两次跑差 ~2x),所以**优化对比必须在同一次 baseline run 里把"优化前 vs 优化后"配对跑,不要跨日子比绝对值**;CV 只在同 run 内的多次重复有意义。

至此阶段 1 收官:Chrome 启动脚本 + 最小 CDP 客户端 + 样本抓取 + 指标定义 + 采集器骨架 + Bing 请求处理(stub mock + warm/cold 双模式)+ 基线统计 全部就位。后续阶段 2/3 在同一份 harness 上展开。

## 2026-05-23

### P0 阶段 1:Chrome 启动脚本

`perf/launchChrome.js` 封装临时 `--user-data-dir` profile + `--remote-debugging-port=0` 自选端口(从 `<profileDir>/DevToolsActivePort` 第一行读真实端口),并落定一组关闭首启向导 / 默认浏览器询问 / 后台联网 / 组件更新 / 翻译条 / 各种 banner 的命令行标志。`perf/test-launch.js` 端到端验证:headless 启动 Chrome 148.0.7778.168(CDP 协议 1.3),1.2s 启动完成,`/json/version` 返回 browser ws endpoint,`close()` 后临时 profile 目录被清理。`.gitignore` 增加 `perf/chrome-profiles/` / `perf/samples/` / `perf/.tmp/` / `node_modules/`。

### P0 阶段 1:最小 CDP 客户端

`perf/cdpClient.js` 直接基于 Node 内置 `WebSocket` 实现 JSON-RPC,不引 puppeteer / playwright。顶层 `connect(wsEndpoint)` 提供 `send` / `on` / `close`,`newPage()` 通过 `Target.createTarget` + `Target.attachToTarget({flatten:true})` 拿 sessionId,封装 `navigate`(内置 `Page.loadEventFired` 等待 + `errorText` 判失败)、`waitForNetworkIdle`(连续 `idleMs` 内无 `Network.requestWillBeSent` 即视作 idle)、`evaluate`(自动把页面侧异常翻译成 Node throw,带原始 description)、`getMetrics`(扁平化 `Performance.getMetrics` 输出)、`close`。client 断开时所有未完成 waiter 被 reject,避免悬挂 Promise。`perf/test-cdp.js` 端到端验证:data: URL navigate 27ms 触发 loadEventFired、`evaluate` 双向传值 + 异常翻译、`Performance.getMetrics` 返回 JSHeapUsed/Total/Nodes/Documents 真实数据,关闭链路干净。

### P0 阶段 1:指标定义 + 采集器骨架

`perf/gmShim.js` 在 user.js 注入前先注入页面:提供 `GM_xmlhttpRequest` / `GM_getValue` / `GM_setValue` / `GM_addStyle` 的最小可用实现,统计 xhr / getHit / getMiss / set 次数到 `window.__perfStats`;同时把 `window.MutationObserver` 替成 no-op,让 user.js 的 `main()` 装的 observer 不工作,我们手动调 `scanTextNodes` + `translateTextNodes` 测纯工作量、剥离 debounce 50ms 噪声。`perf/harness.js` 导出 `measureSample(slug)`:`file://` 加载样本 → 注入 gmShim → 通过 `<script>` 标签注入 user.js 全文(因 user.js 顶层有 function declaration,`Runtime.evaluate` 当 expression 跑不会把它挂到 global)→ 手动驱动两个函数测时 → 100ms drain mock xhr 回调 → 采集指标。`perf/test-harness.js` 端到端跑两份样本。

指标集合(初版):`scanMs` / `translateSyncMs` / `firstBatchMs` / `addRubyCount`(`ruby > rt.ipa-additional-rt` 计数,等价于 addRuby 成功次数)/ `rubyFilledCount`(rt 含 `data-rt` 即异步回调已写入 IPA)/ `gmXhrCalls` / `gmGetHits` / `gmGetMisses` / `gmSetCount` / `cacheHitRate` / `jsHeap{Before,After}Bytes` / `nodes{Before,After}`。

首次跑通数据(cold start,placeholder xhr):
- Pride and Prejudice — scanMs=12243.6, addRubyCount=122943, gmXhrCalls=6722, nodes 12953→627660(+614707), JSHeap 0.69→8.92 MiB
- War and Peace — scanMs=**279621.4(4.7 分钟)**, addRubyCount=553569, gmXhrCalls=17594, nodes 43765→2811599(+2767834), JSHeap 0.69→36.81 MiB

`translateSyncMs` 都 <20ms,但只测了同步部分(GM_xhr 入队);xhr 回调里 `updateRuby` 的真实工作没单独计时,如果未来发现要量,补一个 `translateAsyncDrainMs` 即可。`cacheHitRate` 在 cold start 测里恒为 0,真实命中要靠"热"模式(预热缓存或同进程跑多次)体现,留给后续基线统计设计。

### P0 阶段 1:样本抓取脚本 + 首批样本

`perf/captureSample.js` 用 `launchChrome` + `cdpClient`:navigate(timeoutMs=60s)+ `waitForNetworkIdle(idleMs=500, timeoutMs=15s)` + `evaluate("document.querySelectorAll('script').forEach(s=>s.remove()); ... outerHTML")` 抓渲染后的 DOM,预先剥掉所有 `<script>` 让本地副本加载时不再执行原页面 JS 污染 user.js 的测量。写盘到 `perf/samples/<slug>.html`(.gitignore),`perf/samples.index.json`(入 git)记录 url / capturedAt / sizeBytes / sha256。

抓了两个 Project Gutenberg 公版英文样本作为初版基线:`pride-and-prejudice`(PG #1342,785 KiB / 14k 行,中等规模)、`war-and-peace`(PG #2600,3.6 MiB / 77k 行,压力样本)。两本都是纯英文 + 几乎无 JS 动态加载,符合"文字密集 / 首屏静态文字多 / 避免动态加载干扰首次扫描"标准。`git check-ignore` 确认 HTML 被忽略而索引文件入 git。

### P0 阶段 1:Bing 请求处理决策 + warm/cold 双模式

技术评估排除两个候选方案:CDP `Fetch.fulfillRequest` 拦截不到 `GM_xmlhttpRequest`(Tampermonkey API 不走浏览器 HTTP 栈);真请求引入网络抖动、可能触发 Bing 限流,且测的是 user.js 内部 JS 工作量,网络层污染基线。

落定方案:**gmShim stub mock + 可选 warm cache preload**。`measureSample(slug, { warmCache, dumpStorage })` 接口扩展:`warmCache` 是 phrase→ipa map,在 inject user.js 前预填 `window.__perfStorage`,模拟"用户重访页面"全缓存命中场景;`dumpStorage` 让一次 cold run 把跑出来的 phrase 集合提出来,直接喂给后续 warm run。返回值带 `mode: "cold" | "warm"` 和 `dumpedStorage`。

`perf/probe-bing-strategy.js` 跑 P&P 1 seed + 5 cold + 5 warm 验证波动:
- cold: scanMs median 16389 / CV 8.3%, translateSyncMs ~6ms, gmXhrCalls=6722 / CV=0%
- warm: scanMs median 15708 / CV 7.1%, **translateSyncMs ~2097ms / CV 1.9%**, gmXhrCalls=0 / CV=0%

关键发现:warm 模式的 translateSyncMs 比 cold 高 ~350x,因 user.js 在缓存命中时同步走 updateRuby 全套(`rt.dataset.rt` + 祖先 div `align-items:end` / `line-height` 注入 + `-webkit-line-clamp` 清除循环),这部分成本在 cold mode 被 mock xhr 的 setTimeout 异步隐藏 — 这条信号原本看不到。`addRubyCount` / `gmXhrCalls` 完全 deterministic(CV=0)适合作为正确性断言。scanMs CV 7-8% 可接受,后续基线统计应用中位数 + IQR 而非均值。
