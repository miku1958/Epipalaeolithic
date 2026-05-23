// Run the baseline measurements and write perf/baseline.json.
// 用法:node perf/runBaseline.js
//
// 计划:
//   - pride-and-prejudice : 1 seed + 5 cold + 5 warm  (~3 分钟,主要统计基线)
//   - war-and-peace       : 1 cold                    (~5 分钟,压力上限单点参考)
//
// 输出 perf/baseline.json(入 git),后续优化迭代用它作为对比锚点。

const fsp = require("node:fs/promises");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { measureSample } = require("./harness");

const OUT_PATH = path.join(__dirname, "baseline.json");
const CHROME_BIN = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const RUN_PLAN = [
    { slug: "pride-and-prejudice", seed: true, coldRuns: 5, warmRuns: 5 },
    { slug: "war-and-peace", seed: false, coldRuns: 1, warmRuns: 0 },
];

const METRIC_KEYS = [
    "scanMs", "translateSyncMs", "firstBatchMs",
    "addRubyCount", "rubyFilledCount",
    "gmXhrCalls", "gmGetHits", "gmGetMisses", "gmSetCount", "cacheHitRate",
    "jsHeapBeforeBytes", "jsHeapAfterBytes",
    "nodesBefore", "nodesAfter",
];

function statsOf(values) {
    if (values.length === 0) return null;
    const sorted = values.slice().sort((a, b) => a - b);
    const n = sorted.length;
    const pick = (q) => sorted[Math.min(n - 1, Math.floor(q * n))];
    const median = n % 2 === 1 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
    const q1 = pick(0.25);
    const q3 = pick(0.75);
    const mean = sorted.reduce((a, b) => a + b, 0) / n;
    const variance = sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
    const stddev = Math.sqrt(variance);
    return {
        n,
        min: sorted[0],
        q1,
        median,
        q3,
        max: sorted[n - 1],
        iqr: q3 - q1,
        mean,
        stddev,
        cv: mean === 0 ? 0 : stddev / mean,
    };
}

function statsForRuns(runs) {
    if (runs.length === 0) return null;
    const out = {};
    for (const key of METRIC_KEYS) {
        const values = runs.map((r) => r[key]).filter((v) => Number.isFinite(v));
        out[key] = statsOf(values);
    }
    return out;
}

function stripDumpedStorage(run) {
    const copy = { ...run };
    delete copy.dumpedStorage;
    return copy;
}

async function runSample(plan) {
    const { slug, seed, coldRuns, warmRuns } = plan;
    console.log(`\n=== ${slug} (seed=${seed} cold=${coldRuns} warm=${warmRuns}) ===`);

    let warmCache = null;
    if (seed) {
        console.log(`  [seed] cold run with dumpStorage=true ...`);
        const r = await measureSample(slug, { dumpStorage: true });
        warmCache = r.dumpedStorage;
        console.log(`  [seed] scanMs=${r.scanMs.toFixed(1)} translate=${r.translateSyncMs.toFixed(1)} dumped=${Object.keys(warmCache).length}`);
    }

    const cold = [];
    for (let i = 0; i < coldRuns; i++) {
        const r = await measureSample(slug);
        cold.push(stripDumpedStorage(r));
        console.log(`  cold #${i + 1}: scanMs=${r.scanMs.toFixed(1)} translate=${r.translateSyncMs.toFixed(1)} ruby=${r.addRubyCount}`);
    }

    const warm = [];
    if (warmRuns > 0 && warmCache) {
        for (let i = 0; i < warmRuns; i++) {
            const r = await measureSample(slug, { warmCache });
            warm.push(stripDumpedStorage(r));
            console.log(`  warm #${i + 1}: scanMs=${r.scanMs.toFixed(1)} translate=${r.translateSyncMs.toFixed(1)} ruby=${r.addRubyCount}`);
        }
    }

    return {
        runs: { cold, warm },
        stats: {
            cold: statsForRuns(cold),
            warm: statsForRuns(warm),
        },
    };
}

function chromeVersion() {
    return execFileSync(CHROME_BIN, ["--version"], { encoding: "utf8" }).trim();
}

async function runSampleWithRetry(plan, attempts = 2) {
    let lastErr;
    for (let i = 1; i <= attempts; i++) {
        try {
            return await runSample(plan);
        } catch (err) {
            lastErr = err;
            console.error(`  ! attempt ${i}/${attempts} for ${plan.slug} failed: ${err.message}`);
        }
    }
    throw lastErr;
}

async function writeBaseline(samples, t0) {
    const baseline = {
        createdAt: new Date().toISOString(),
        durationMs: Date.now() - t0,
        envInfo: {
            chrome: chromeVersion(),
            platform: process.platform,
            arch: process.arch,
            nodeVersion: process.version,
        },
        plan: RUN_PLAN,
        samples,
    };
    await fsp.writeFile(OUT_PATH, JSON.stringify(baseline, null, 2) + "\n", "utf8");
}

async function main() {
    const t0 = Date.now();
    const samples = {};
    let anyFailed = false;
    for (const plan of RUN_PLAN) {
        try {
            samples[plan.slug] = await runSampleWithRetry(plan);
        } catch (err) {
            console.error(`  X ${plan.slug} gave up after retries: ${err.message}`);
            samples[plan.slug] = { error: err.message, plan };
            anyFailed = true;
        }
        // 增量写盘:每完成一个 sample 立即落盘,后续任何失败都不会丢已完成数据。
        await writeBaseline(samples, t0);
        console.log(`  -> wrote partial ${OUT_PATH} after ${plan.slug}`);
    }
    console.log(`\nbaseline ${anyFailed ? "(WITH ERRORS) " : ""}written in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    if (anyFailed) process.exit(2);
}

main().catch((err) => {
    console.error("FAIL:", err);
    process.exit(1);
});
