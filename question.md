# 待用户拍板

## 2026-05-24:阶段 2 优先级 + 第一项

阶段 1 已收官,`perf/baseline.json` 入 git(P&P cold scanMs median 22958ms / CV 5.1%,W&P cold scanMs 452240ms 单点)。下面 5 个候选热点 todo.md 里只有描述,没有 actionable 子任务,需要你拍执行顺序 + 第一项的形式:

1. **`scanTextNodes` 跳过规则链** — `excludeTags` / `excludeClass` / `computedStyleMap` / `getComputedStyle` / 圆角判定 等多层过滤。基线数据印证 scanMs 占 firstBatchMs ~90%,**很可能是首要瓶颈**。
2. **`skipElements` Set 的线性祖先扫描** — `for (const skipElement of skipElements) skipElement.contains(node)`,Set 越大每个节点判定越慢。可能是 scanTextNodes 内嵌的二阶热点。
3. **`StylePropertyMapReadOnly.prototype.get` monkey-patch** — 全局生效,每次 style 读取过 `parseFloat` + 字符串处理。
4. **`updateRuby` 对 `<div>` 祖先链的 inline style 注入与 `-webkit-line-clamp` 清除** — 基线显示 warm `translateSyncMs` ~3033ms / iter,这部分大头就在 updateRuby。
5. **Bing 空 IPA → `convertPhrase` 还原 → 二次查询链路** — 数据里 cacheHitRate cold=0% warm=100%,二次查询路径基线下未触发,要单独构造测例。

**我建议的方向**(等你确认):

- 优先从 #1 入手(占主导);用"临时改 user.js 加内部计时打点,跑完恢复不 commit"的方式(已确认决策的方法),把 `scanTextNodes` 内部 5 层过滤各自时长测出来,定位最贵的那一层。
- 测出来后,#2/#3 的优先级会自动浮现(skipElements 和 style 读都是 #1 内部的子环节)。

**还有其他可拍的选项**:
- 跳过阶段 2 直接进阶段 3(凭基线印证的"scanTextNodes 是大头"直接尝试优化,优化前后对比)
- 阶段 2 的形式由"内部计时"换成"火焰图 / Chrome DevTools profile 分析"(harness 用 CDP `Tracing.start` / `Tracing.end` 抓 trace.json,本地用 chrome://tracing 看)
- 暂时不做,先做别的

等你回复后,我把决定的执行方案转成 todo.md 里的 actionable 子任务,再进入实现。
