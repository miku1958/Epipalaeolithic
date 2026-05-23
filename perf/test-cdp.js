// 端到端验证 cdpClient.js:连接、新 page target、navigate + loadEventFired、
// Runtime.evaluate 来回传值、Performance.getMetrics 拿堆/节点数。
//
// 用法:node perf/test-cdp.js

const { launchChrome } = require("./launchChrome");
const { connect, newPage } = require("./cdpClient");

async function main() {
    const chrome = await launchChrome({ headless: true });
    console.log(`Chrome up, port=${chrome.port}`);

    const client = connect(chrome.wsEndpoint);
    await client.ready;
    console.log("CDP connected");

    const page = await newPage(client);
    console.log(`Page session: ${page.sessionId} (targetId=${page.targetId})`);

    // 构造一个文字密集的小页面用 data: URL,无外网依赖。
    const text = "foo bar baz quux ".repeat(200);
    const html = `<!doctype html>
<html><head><title>cdp test</title></head><body>
<h1>CDP smoke test</h1>
<p>${text}</p>
<script>
  window.__loadedAt = performance.now();
  window.__paragraphs = document.querySelectorAll("p").length;
</script>
</body></html>`;
    const dataUrl = "data:text/html;base64," + Buffer.from(html).toString("base64");

    const t0 = Date.now();
    await page.navigate(dataUrl);
    const t1 = Date.now();
    console.log(`navigate + loadEventFired: ${t1 - t0}ms`);

    // 验证 evaluate 双向传值。
    const loadedAt = await page.evaluate("window.__loadedAt");
    const paraCount = await page.evaluate("window.__paragraphs");
    console.log(`evaluate(): performance.now() at load = ${loadedAt.toFixed(2)}, <p> count = ${paraCount}`);

    // 验证 evaluate 异常会被翻译成 Node 端的 throw。
    let caught = null;
    try {
        await page.evaluate("throw new Error('intentional')");
    } catch (err) {
        caught = err.message;
    }
    console.log(`evaluate(throw): caught = ${caught ?? "(no error — FAIL)"}`);
    if (!caught || !caught.includes("intentional")) {
        throw new Error("Expected evaluate() to translate page-side exception into a Node throw");
    }

    // Performance.getMetrics 拿堆 + 节点数。
    const metrics = await page.getMetrics();
    console.log("Performance.getMetrics():");
    console.log(`  JSHeapUsedSize : ${(metrics.JSHeapUsedSize / 1024 / 1024).toFixed(2)} MiB`);
    console.log(`  JSHeapTotalSize: ${(metrics.JSHeapTotalSize / 1024 / 1024).toFixed(2)} MiB`);
    console.log(`  Nodes          : ${metrics.Nodes}`);
    console.log(`  Documents      : ${metrics.Documents}`);
    if (!Number.isFinite(metrics.JSHeapUsedSize) || metrics.JSHeapUsedSize <= 0) {
        throw new Error("JSHeapUsedSize looks bogus");
    }

    await page.close();
    client.close();
    await chrome.close();
    console.log("closed cleanly");
}

main().catch((err) => {
    console.error("FAIL:", err);
    process.exit(1);
});
