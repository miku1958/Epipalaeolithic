// Launch a Chrome instance with an isolated temporary profile and a remote
// debugging endpoint. Returns { port, wsEndpoint, process, profileDir, close }.
//
// 用户已对本项目一次性授权 agent 自启 Chrome,后续不需逐次确认。

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");

const CHROME_BIN = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// Profile root: per-launch directory under workspace, never under ~/.
// 与项目 "产物落在当前 workspace" 规则一致。
const PROFILE_ROOT = path.join(__dirname, "chrome-profiles");

function buildFlags({ profileDir, headless }) {
    const flags = [
        `--user-data-dir=${profileDir}`,
        // remote-debugging-port=0 让 Chrome 自选空闲端口,实际端口写入
        // <profileDir>/DevToolsActivePort 第一行,避免端口冲突。
        "--remote-debugging-port=0",
        // CDP 客户端默认从 ws://127.0.0.1 / http://127.0.0.1 连,显式允许。
        "--remote-allow-origins=*",
        // 关闭首启向导 / 默认浏览器询问 / 同步 / 翻译条 / banner 等。
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-default-apps",
        "--disable-sync",
        "--disable-translate",
        "--disable-features=Translate,InfoBars,MediaRouter,OptimizationHints,InterestFeedContentSuggestions,PrivacySandboxSettings4",
        "--disable-popup-blocking",
        // 关掉后台联网 / 组件更新 / 域可靠性 / 反钓鱼,避免性能基线被这些异步任务干扰。
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-domain-reliability",
        "--disable-client-side-phishing-detection",
        "--metrics-recording-only",
        // 保持前台速度:防止后台 throttle 影响性能测量。
        "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows",
        "--disable-background-timer-throttling",
        // 个别在线站会检测 webdriver 标记;我们不是爬虫但保险起见隐掉。
        "--disable-blink-features=AutomationControlled",
        "about:blank",
    ];
    if (headless) {
        flags.unshift("--headless=new");
    }
    return flags;
}

async function waitForDevToolsPort(profileDir, timeoutMs = 10000) {
    const file = path.join(profileDir, "DevToolsActivePort");
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const content = await fsp.readFile(file, "utf8");
            const firstLine = content.split("\n")[0]?.trim();
            const port = Number(firstLine);
            if (Number.isInteger(port) && port > 0) {
                return port;
            }
        } catch (err) {
            if (err.code !== "ENOENT") throw err;
        }
        await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`DevToolsActivePort not written within ${timeoutMs}ms`);
}

function fetchJson(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            if (res.statusCode !== 200) {
                reject(new Error(`GET ${url} → ${res.statusCode}`));
                res.resume();
                return;
            }
            let body = "";
            res.setEncoding("utf8");
            res.on("data", (c) => (body += c));
            res.on("end", () => {
                try {
                    resolve(JSON.parse(body));
                } catch (err) {
                    reject(err);
                }
            });
        }).on("error", reject);
    });
}

async function launchChrome({ headless = false } = {}) {
    await fsp.mkdir(PROFILE_ROOT, { recursive: true });
    const profileDir = await fsp.mkdtemp(path.join(PROFILE_ROOT, "p-"));

    const flags = buildFlags({ profileDir, headless });
    const proc = spawn(CHROME_BIN, flags, {
        stdio: ["ignore", "pipe", "pipe"],
        detached: false,
    });

    // 关键:proc.unref() 反而会让 node 提前退出。这里要保持引用。
    let stderrBuf = "";
    proc.stderr.on("data", (chunk) => {
        stderrBuf += chunk.toString();
        if (stderrBuf.length > 16 * 1024) {
            stderrBuf = stderrBuf.slice(-16 * 1024);
        }
    });

    const exitPromise = new Promise((resolve) => {
        proc.on("exit", (code, signal) => resolve({ code, signal }));
    });

    let port;
    try {
        port = await waitForDevToolsPort(profileDir);
    } catch (err) {
        proc.kill("SIGKILL");
        throw new Error(`Chrome failed to expose CDP port. stderr tail:\n${stderrBuf}\n— ${err.message}`);
    }

    // 拉一下 /json/version,确认 CDP HTTP endpoint 真的活着,顺便拿到 browser ws endpoint。
    const version = await fetchJson(`http://127.0.0.1:${port}/json/version`);
    const wsEndpoint = version.webSocketDebuggerUrl;

    async function close() {
        if (!proc.killed && proc.exitCode === null) {
            proc.kill("SIGTERM");
            // 给 Chrome 一点时间正常退;3 秒后强杀。
            const force = setTimeout(() => proc.kill("SIGKILL"), 3000);
            await exitPromise;
            clearTimeout(force);
        }
        // 临时 profile 用完即扔。
        await fsp.rm(profileDir, { recursive: true, force: true }).catch(() => {});
    }

    return { port, wsEndpoint, process: proc, profileDir, close, version };
}

module.exports = { launchChrome, CHROME_BIN, PROFILE_ROOT };
