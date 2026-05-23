// Performance harness for user.js. Loads a local sample, injects GM shim + user.js,
// drives scanTextNodes/translateTextNodes manually, and reports a metrics bundle.
//
// 指标定义(初版):
//   - scanMs               scanTextNodes(document.body) 同步耗时(ms)
//   - translateSyncMs      translateTextNodes() 同步部分耗时;不含异步 xhr 回调里 updateRuby 的时间
//   - firstBatchMs         scanMs + translateSyncMs(端到端"首批"工作量)
//   - addRubyCount         scanTextNodes 跑完后 `ruby > rt.ipa-additional-rt` 元素数
//                          每次 addRuby 成功创建一个 ruby,这是从外部观察到的等价计数
//   - rubyFilledCount      `rt.ipa-additional-rt[data-rt]` 数(异步回调后被填上 IPA 的数量)
//   - gmXhrCalls           shim 中 GM_xmlhttpRequest 被调用次数(= 实际发起的字典请求数)
//   - gmGetHits/Misses     GM_getValue 命中 / 未命中次数
//   - gmSetCount           GM_setValue 调用次数(等于异步回调里写回的 phrase 数)
//   - cacheHitRate         gmGetHits / (gmGetHits + gmGetMisses)
//   - jsHeapBeforeBytes    Performance.getMetrics 在注入 user.js 前的 JSHeapUsedSize
//   - jsHeapAfterBytes     同上,在指标采集时
//   - nodesBefore/After    Performance.getMetrics 的 Nodes 计数(DOM 总节点数)

const fsp = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { launchChrome } = require("./launchChrome");
const { connect, newPage } = require("./cdpClient");

const SAMPLES_DIR = path.join(__dirname, "samples");
const GM_SHIM_PATH = path.join(__dirname, "gmShim.js");
const USER_JS_PATH = path.join(__dirname, "..", "user.js");

const POST_XHR_DRAIN_MS = 100;

async function measureSample(slug, { headless = true, warmCache = null, dumpStorage = false } = {}) {
    const samplePath = path.join(SAMPLES_DIR, `${slug}.html`);
    await fsp.access(samplePath);
    const fileUrl = pathToFileURL(samplePath).href;

    const gmShimCode = await fsp.readFile(GM_SHIM_PATH, "utf8");
    const userJsCode = await fsp.readFile(USER_JS_PATH, "utf8");

    const chrome = await launchChrome({ headless });
    const client = connect(chrome.wsEndpoint);
    await client.ready;
    const page = await newPage(client);
    try {
        await page.navigate(fileUrl, { timeoutMs: 60_000 });

        await page.evaluate(gmShimCode);

        if (warmCache && typeof warmCache === "object") {
            // 在 inject user.js 前预填 __perfStorage:user.js 内的 GM_getValue 将命中缓存,
            // 同步 updateRuby 路径生效,反映"用户重访页面"的真实场景。
            const entries = Object.entries(warmCache);
            await page.evaluate(`
                (function () {
                    var entries = ${JSON.stringify(entries)};
                    for (var i = 0; i < entries.length; i++) {
                        window.__perfStorage.set(entries[i][0], entries[i][1]);
                    }
                })()
            `);
        }

        const preMetrics = await page.getMetrics();

        // user.js 顶层有 function declarations,要靠 <script> 标签注入才能把
        // scanTextNodes / translateTextNodes 暴露到 window;Runtime.evaluate 接收的
        // expression 不会把顶层函数挂到 global object。
        await page.evaluate(`
            (function () {
                var code = ${JSON.stringify(userJsCode)};
                var s = document.createElement("script");
                s.textContent = code;
                document.documentElement.appendChild(s);
            })()
        `);

        const measurement = await page.evaluate(`
            (function () {
                if (typeof window.scanTextNodes !== "function") {
                    throw new Error("scanTextNodes not on window after user.js inject");
                }
                var t0 = performance.now();
                window.scanTextNodes(document.body, false);
                var t1 = performance.now();
                window.translateTextNodes();
                var t2 = performance.now();
                return { scanMs: t1 - t0, translateSyncMs: t2 - t1 };
            })()
        `);

        // 等 mock xhr setTimeout(0) 回调链 + microtask 跑完。
        await new Promise((r) => setTimeout(r, POST_XHR_DRAIN_MS));

        const post = await page.evaluate(`
            (function () {
                var dump = null;
                if (${JSON.stringify(Boolean(dumpStorage))}) {
                    dump = {};
                    window.__perfStorage.forEach(function (value, key) { dump[key] = value; });
                }
                return {
                    rubyCount: document.querySelectorAll("ruby > rt.ipa-additional-rt").length,
                    rubyFilledCount: document.querySelectorAll("ruby > rt.ipa-additional-rt[data-rt]").length,
                    stats: window.__perfStats,
                    dumpedStorage: dump,
                };
            })()
        `);
        const postMetrics = await page.getMetrics();

        const stats = post.stats || {};
        const totalGets = (stats.getHits || 0) + (stats.getMisses || 0);
        const cacheHitRate = totalGets > 0 ? stats.getHits / totalGets : 0;

        return {
            slug,
            mode: warmCache ? "warm" : "cold",
            scanMs: measurement.scanMs,
            translateSyncMs: measurement.translateSyncMs,
            firstBatchMs: measurement.scanMs + measurement.translateSyncMs,
            addRubyCount: post.rubyCount,
            rubyFilledCount: post.rubyFilledCount,
            gmXhrCalls: stats.xhrCount || 0,
            gmGetHits: stats.getHits || 0,
            gmGetMisses: stats.getMisses || 0,
            gmSetCount: stats.setCount || 0,
            cacheHitRate,
            jsHeapBeforeBytes: preMetrics.JSHeapUsedSize,
            jsHeapAfterBytes: postMetrics.JSHeapUsedSize,
            nodesBefore: preMetrics.Nodes,
            nodesAfter: postMetrics.Nodes,
            dumpedStorage: post.dumpedStorage,
        };
    } finally {
        await page.close();
        client.close();
        await chrome.close();
    }
}

module.exports = { measureSample };
