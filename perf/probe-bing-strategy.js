// Probe: 跑 P&P 多次 cold + 多次 warm,比较两种"Bing 请求处理策略"的稳定性。
// 用法:node perf/probe-bing-strategy.js
//
// 决策上下文:GM_xmlhttpRequest 是 Tampermonkey API,不走浏览器 HTTP 栈,
// CDP Fetch.fulfillRequest 拦截不到 → 排除。真请求引入网络抖动 → 排除。
// 余下方案是 gmShim 内 stub + 可选 warm cache 预填。本探针验证两模式 CV 可接受。

const { measureSample } = require("./harness");

const SLUG = "pride-and-prejudice";
const N = 5;

function stats(values) {
    const sorted = values.slice().sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
    const stddev = Math.sqrt(variance);
    const cv = mean === 0 ? 0 : stddev / mean;
    return {
        n: values.length,
        min: sorted[0],
        median,
        max: sorted[sorted.length - 1],
        mean,
        stddev,
        cv,
    };
}

function fmt(s) {
    return `n=${s.n} min=${s.min.toFixed(1)} median=${s.median.toFixed(1)} max=${s.max.toFixed(1)} mean=${s.mean.toFixed(1)} sd=${s.stddev.toFixed(1)} cv=${(s.cv * 100).toFixed(1)}%`;
}

async function main() {
    console.log(`probing on slug=${SLUG}, N=${N} per mode`);

    // 第 1 步:跑一次 cold + dump storage,作为后续 warm runs 的预填数据。
    console.log("\n[seed] cold run with dumpStorage=true ...");
    const seed = await measureSample(SLUG, { dumpStorage: true });
    const warmCache = seed.dumpedStorage;
    const warmCacheSize = Object.keys(warmCache).length;
    console.log(`  seed scanMs=${seed.scanMs.toFixed(1)}, dumped ${warmCacheSize} phrase->ipa entries`);

    // 第 2 步:N 次 cold(空 storage)
    console.log(`\n[cold] running ${N} times with empty storage ...`);
    const colds = [];
    for (let i = 0; i < N; i++) {
        const r = await measureSample(SLUG);
        colds.push(r);
        console.log(`  cold #${i + 1}: scanMs=${r.scanMs.toFixed(1)} translateSyncMs=${r.translateSyncMs.toFixed(1)} xhr=${r.gmXhrCalls} hitRate=${(r.cacheHitRate * 100).toFixed(1)}%`);
    }

    // 第 3 步:N 次 warm(预填 storage)
    console.log(`\n[warm] running ${N} times with prefilled storage (${warmCacheSize} entries) ...`);
    const warms = [];
    for (let i = 0; i < N; i++) {
        const r = await measureSample(SLUG, { warmCache });
        warms.push(r);
        console.log(`  warm #${i + 1}: scanMs=${r.scanMs.toFixed(1)} translateSyncMs=${r.translateSyncMs.toFixed(1)} xhr=${r.gmXhrCalls} hitRate=${(r.cacheHitRate * 100).toFixed(1)}%`);
    }

    console.log("\n=== summary ===");
    for (const [label, runs] of [["cold", colds], ["warm", warms]]) {
        console.log(`\n${label} (n=${runs.length}):`);
        console.log(`  scanMs          : ${fmt(stats(runs.map((r) => r.scanMs)))}`);
        console.log(`  translateSyncMs : ${fmt(stats(runs.map((r) => r.translateSyncMs)))}`);
        console.log(`  firstBatchMs    : ${fmt(stats(runs.map((r) => r.firstBatchMs)))}`);
        console.log(`  addRubyCount    : ${fmt(stats(runs.map((r) => r.addRubyCount)))}`);
        console.log(`  gmXhrCalls      : ${fmt(stats(runs.map((r) => r.gmXhrCalls)))}`);
    }
}

main().catch((err) => { console.error("FAIL:", err); process.exit(1); });
