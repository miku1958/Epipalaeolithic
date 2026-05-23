// Minimal Chrome DevTools Protocol client over the Node built-in WebSocket.
// 直接 ws + JSON-RPC,不引 puppeteer / playwright。
//
// 用法:
//   const client = connect(wsEndpoint);
//   await client.ready;
//   const page = await newPage(client, "https://example.com/");
//   await page.navigate("https://...");
//   const value = await page.evaluate("1 + 2");
//   const m = await page.getMetrics();
//   await page.close();
//   client.close();

function connect(wsEndpoint) {
    const ws = new WebSocket(wsEndpoint);
    const waiters = new Map(); // id -> { resolve, reject }
    const listeners = new Map(); // method -> Set<fn>
    let nextId = 0;
    let closed = false;

    const ready = new Promise((resolve, reject) => {
        ws.addEventListener("open", () => resolve(), { once: true });
        ws.addEventListener("error", (e) => reject(new Error("CDP ws error during open")), { once: true });
    });

    ws.addEventListener("message", (event) => {
        let msg;
        try {
            msg = JSON.parse(event.data);
        } catch (err) {
            console.error("CDP: failed to parse message", event.data);
            return;
        }
        if (msg.id != null) {
            const w = waiters.get(msg.id);
            if (w) {
                waiters.delete(msg.id);
                if (msg.error) {
                    w.reject(new Error(`CDP error ${msg.error.code}: ${msg.error.message}`));
                } else {
                    w.resolve(msg.result);
                }
            }
            return;
        }
        if (msg.method) {
            const set = listeners.get(msg.method);
            if (set) {
                for (const fn of set) {
                    try {
                        fn(msg.params, msg.sessionId);
                    } catch (err) {
                        console.error("CDP listener for", msg.method, "threw:", err);
                    }
                }
            }
        }
    });

    ws.addEventListener("close", () => {
        closed = true;
        for (const w of waiters.values()) {
            w.reject(new Error("CDP ws closed before response"));
        }
        waiters.clear();
    });

    function send(method, params = {}, sessionId) {
        if (closed) return Promise.reject(new Error("CDP client closed"));
        const id = ++nextId;
        const payload = { id, method, params };
        if (sessionId) payload.sessionId = sessionId;
        return new Promise((resolve, reject) => {
            waiters.set(id, { resolve, reject });
            ws.send(JSON.stringify(payload));
        });
    }

    function on(method, fn) {
        let set = listeners.get(method);
        if (!set) {
            set = new Set();
            listeners.set(method, set);
        }
        set.add(fn);
        return () => set.delete(fn);
    }

    function close() {
        if (closed) return;
        closed = true;
        for (const w of waiters.values()) {
            w.reject(new Error("CDP client closed"));
        }
        waiters.clear();
        try {
            ws.close();
        } catch {}
    }

    return { ready, send, on, close, get isClosed() { return closed; } };
}

async function newPage(client, initialUrl = "about:blank") {
    const { targetId } = await client.send("Target.createTarget", { url: initialUrl });
    const { sessionId } = await client.send("Target.attachToTarget", { targetId, flatten: true });

    const send = (method, params) => client.send(method, params, sessionId);

    // Page-scoped listener: dispatch only when event 来自本 session。
    function on(method, fn) {
        return client.on(method, (params, sid) => {
            if (sid === sessionId) fn(params);
        });
    }

    // 等首个匹配某 method 的 page 事件;支持超时。
    function waitFor(method, { timeoutMs = 30000 } = {}) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                off();
                reject(new Error(`Timeout waiting for ${method} after ${timeoutMs}ms`));
            }, timeoutMs);
            const off = on(method, (params) => {
                clearTimeout(timer);
                off();
                resolve(params);
            });
        });
    }

    await send("Page.enable");
    await send("Runtime.enable");
    await send("Performance.enable");
    await send("Network.enable");

    async function navigate(url, { timeoutMs = 30000 } = {}) {
        // 先挂监听器再触发导航,避免 fast-path 上事件早于 listener。
        const loaded = waitFor("Page.loadEventFired", { timeoutMs });
        const res = await send("Page.navigate", { url });
        if (res.errorText) {
            throw new Error(`Navigate to ${url} failed: ${res.errorText}`);
        }
        await loaded;
        return res;
    }

    // Network idle:连续 idleMs 毫秒没有新的 requestWillBeSent 即认为稳定。
    // 用 Page.loadEventFired 之后再 + idle 等待,作为"渲染稳定"信号。
    function waitForNetworkIdle({ idleMs = 500, timeoutMs = 30000 } = {}) {
        return new Promise((resolve, reject) => {
            const deadline = setTimeout(() => {
                offReq();
                offResp();
                reject(new Error(`Network never idled within ${timeoutMs}ms`));
            }, timeoutMs);
            let idleTimer = setTimeout(done, idleMs);

            function bump() {
                clearTimeout(idleTimer);
                idleTimer = setTimeout(done, idleMs);
            }

            function done() {
                clearTimeout(deadline);
                offReq();
                offResp();
                resolve();
            }

            const offReq = on("Network.requestWillBeSent", bump);
            const offResp = () => {}; // 不订阅响应事件,只看新请求间隔
        });
    }

    async function evaluate(expression, { awaitPromise = false, returnByValue = true } = {}) {
        const r = await send("Runtime.evaluate", { expression, awaitPromise, returnByValue });
        if (r.exceptionDetails) {
            const desc = r.exceptionDetails.exception?.description
                ?? r.exceptionDetails.text
                ?? "(no description)";
            throw new Error(`Runtime.evaluate threw: ${desc}`);
        }
        return r.result?.value;
    }

    async function getMetrics() {
        const { metrics } = await send("Performance.getMetrics");
        const out = {};
        for (const m of metrics) out[m.name] = m.value;
        return out;
    }

    async function closePage() {
        try {
            await client.send("Target.closeTarget", { targetId });
        } catch {
            // target 已经关了 / client 已经断了都没关系。
        }
    }

    return {
        targetId,
        sessionId,
        send,
        on,
        waitFor,
        navigate,
        waitForNetworkIdle,
        evaluate,
        getMetrics,
        close: closePage,
    };
}

module.exports = { connect, newPage };
