// End-to-end smoke for harness.js: 跑一次两份样本,打印每个指标。
// 用法:node perf/test-harness.js

const { measureSample } = require("./harness");

async function main() {
    for (const slug of ["pride-and-prejudice", "war-and-peace"]) {
        console.log(`measuring ${slug}...`);
        const m = await measureSample(slug);
        console.log(`  scanMs           : ${m.scanMs.toFixed(2)}`);
        console.log(`  translateSyncMs  : ${m.translateSyncMs.toFixed(2)}`);
        console.log(`  firstBatchMs     : ${m.firstBatchMs.toFixed(2)}`);
        console.log(`  addRubyCount     : ${m.addRubyCount}`);
        console.log(`  rubyFilledCount  : ${m.rubyFilledCount}`);
        console.log(`  gmXhrCalls       : ${m.gmXhrCalls}`);
        console.log(`  gmGetHits        : ${m.gmGetHits}`);
        console.log(`  gmGetMisses      : ${m.gmGetMisses}`);
        console.log(`  gmSetCount       : ${m.gmSetCount}`);
        console.log(`  cacheHitRate     : ${m.cacheHitRate.toFixed(4)}`);
        console.log(`  nodes            : ${m.nodesBefore} -> ${m.nodesAfter} (+${m.nodesAfter - m.nodesBefore})`);
        console.log(`  jsHeapUsed (MiB) : ${(m.jsHeapBeforeBytes / 1048576).toFixed(2)} -> ${(m.jsHeapAfterBytes / 1048576).toFixed(2)}`);
        console.log();
    }
}

main().catch((err) => {
    console.error("FAIL:", err);
    process.exit(1);
});
