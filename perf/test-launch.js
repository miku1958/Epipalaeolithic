// 端到端验证 launchChrome():能启动、能拿到 CDP port、能用 /json/version,然后干净关闭。
// 用法:node perf/test-launch.js [--headless]

const { launchChrome } = require("./launchChrome");

async function main() {
    const headless = process.argv.includes("--headless");
    console.log(`launching Chrome (headless=${headless})...`);
    const t0 = Date.now();
    const chrome = await launchChrome({ headless });
    const t1 = Date.now();
    console.log(`Chrome up in ${t1 - t0}ms`);
    console.log(`  port:        ${chrome.port}`);
    console.log(`  ws endpoint: ${chrome.wsEndpoint}`);
    console.log(`  profile dir: ${chrome.profileDir}`);
    console.log(`  browser:     ${chrome.version.Browser}`);
    console.log(`  protocol:    ${chrome.version["Protocol-Version"]}`);

    // 不接 ws,本轮只验证启动 + HTTP CDP endpoint 活着。ws 客户端是下一条子任务。
    await chrome.close();
    console.log("closed cleanly");
}

main().catch((err) => {
    console.error("FAIL:", err);
    process.exit(1);
});
