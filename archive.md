# Archive

## 2026-05-23

### P0 阶段 1:Chrome 启动脚本

`perf/launchChrome.js` 封装临时 `--user-data-dir` profile + `--remote-debugging-port=0` 自选端口(从 `<profileDir>/DevToolsActivePort` 第一行读真实端口),并落定一组关闭首启向导 / 默认浏览器询问 / 后台联网 / 组件更新 / 翻译条 / 各种 banner 的命令行标志。`perf/test-launch.js` 端到端验证:headless 启动 Chrome 148.0.7778.168(CDP 协议 1.3),1.2s 启动完成,`/json/version` 返回 browser ws endpoint,`close()` 后临时 profile 目录被清理。`.gitignore` 增加 `perf/chrome-profiles/` / `perf/samples/` / `perf/.tmp/` / `node_modules/`。
