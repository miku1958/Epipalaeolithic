// Capture an HTML snapshot of an online page via Chrome + CDP.
// 用法:
//   node perf/captureSample.js <url> <slug>
//
// 行为:
//   1. 启动临时 Chrome
//   2. navigate(url) + 等 loadEventFired + 短 networkIdle
//   3. 拉 document.documentElement.outerHTML;预先把页面里所有 <script> 删掉,
//      让加载本地副本时不会再触发原网站的 JS(避免污染 user.js 的性能测量)。
//   4. 写盘:perf/samples/<slug>.html (不入 git)
//   5. 更新 perf/samples.index.json (入 git):记录 url / capturedAt / sizeBytes / sha256

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { launchChrome } = require("./launchChrome");
const { connect, newPage } = require("./cdpClient");

const SAMPLES_DIR = path.join(__dirname, "samples");
const INDEX_PATH = path.join(__dirname, "samples.index.json");

async function readIndex() {
    try {
        const text = await fsp.readFile(INDEX_PATH, "utf8");
        return JSON.parse(text);
    } catch (err) {
        if (err.code === "ENOENT") return {};
        throw err;
    }
}

async function writeIndex(index) {
    const sorted = Object.fromEntries(Object.entries(index).sort(([a], [b]) => a.localeCompare(b)));
    await fsp.writeFile(INDEX_PATH, JSON.stringify(sorted, null, 2) + "\n", "utf8");
}

async function captureSample(url, slug) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
        throw new Error(`slug "${slug}" must be lowercase letters / digits / hyphens`);
    }

    await fsp.mkdir(SAMPLES_DIR, { recursive: true });

    const chrome = await launchChrome({ headless: true });
    console.log(`Chrome up, port=${chrome.port}`);

    const client = connect(chrome.wsEndpoint);
    await client.ready;
    const page = await newPage(client);

    try {
        console.log(`navigating ${url} ...`);
        const t0 = Date.now();
        await page.navigate(url, { timeoutMs: 60_000 });
        // Gutenberg 没有 JS 动态加载,短 idle 即可;给次级资源一点时间。
        try {
            await page.waitForNetworkIdle({ idleMs: 500, timeoutMs: 15_000 });
        } catch (err) {
            console.warn(`networkIdle timed out (${err.message}); proceeding with whatever DOM we have`);
        }
        const t1 = Date.now();
        console.log(`loaded in ${t1 - t0}ms`);

        // 拿渲染后的 outerHTML,预先去掉所有 <script>。
        const html = await page.evaluate(`
            (function() {
                document.querySelectorAll("script").forEach(function (s) { s.remove(); });
                return "<!doctype html>\\n" + document.documentElement.outerHTML;
            })()
        `);

        if (typeof html !== "string" || html.length < 1024) {
            throw new Error(`Snapshot looks too small (${html?.length ?? "<no-string>"} bytes); abort`);
        }

        const filePath = path.join(SAMPLES_DIR, `${slug}.html`);
        await fsp.writeFile(filePath, html, "utf8");
        const sizeBytes = Buffer.byteLength(html, "utf8");
        const sha256 = crypto.createHash("sha256").update(html, "utf8").digest("hex");
        console.log(`wrote ${filePath} (${(sizeBytes / 1024).toFixed(1)} KiB, sha256=${sha256.slice(0, 12)}...)`);

        const index = await readIndex();
        index[slug] = {
            url,
            capturedAt: new Date().toISOString(),
            sizeBytes,
            sha256,
        };
        await writeIndex(index);
        console.log(`updated ${INDEX_PATH}`);
    } finally {
        await page.close();
        client.close();
        await chrome.close();
    }
}

async function main() {
    const [, , url, slug] = process.argv;
    if (!url || !slug) {
        console.error("Usage: node perf/captureSample.js <url> <slug>");
        process.exit(1);
    }
    await captureSample(url, slug);
    console.log("done");
}

main().catch((err) => {
    console.error("FAIL:", err);
    process.exit(1);
});
