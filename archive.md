# Archive

## 2026-05-23

### P0 阶段 1:Chrome 启动脚本

`perf/launchChrome.js` 封装临时 `--user-data-dir` profile + `--remote-debugging-port=0` 自选端口(从 `<profileDir>/DevToolsActivePort` 第一行读真实端口),并落定一组关闭首启向导 / 默认浏览器询问 / 后台联网 / 组件更新 / 翻译条 / 各种 banner 的命令行标志。`perf/test-launch.js` 端到端验证:headless 启动 Chrome 148.0.7778.168(CDP 协议 1.3),1.2s 启动完成,`/json/version` 返回 browser ws endpoint,`close()` 后临时 profile 目录被清理。`.gitignore` 增加 `perf/chrome-profiles/` / `perf/samples/` / `perf/.tmp/` / `node_modules/`。

### P0 阶段 1:最小 CDP 客户端

`perf/cdpClient.js` 直接基于 Node 内置 `WebSocket` 实现 JSON-RPC,不引 puppeteer / playwright。顶层 `connect(wsEndpoint)` 提供 `send` / `on` / `close`,`newPage()` 通过 `Target.createTarget` + `Target.attachToTarget({flatten:true})` 拿 sessionId,封装 `navigate`(内置 `Page.loadEventFired` 等待 + `errorText` 判失败)、`waitForNetworkIdle`(连续 `idleMs` 内无 `Network.requestWillBeSent` 即视作 idle)、`evaluate`(自动把页面侧异常翻译成 Node throw,带原始 description)、`getMetrics`(扁平化 `Performance.getMetrics` 输出)、`close`。client 断开时所有未完成 waiter 被 reject,避免悬挂 Promise。`perf/test-cdp.js` 端到端验证:data: URL navigate 27ms 触发 loadEventFired、`evaluate` 双向传值 + 异常翻译、`Performance.getMetrics` 返回 JSHeapUsed/Total/Nodes/Documents 真实数据,关闭链路干净。
