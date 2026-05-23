// Page-side GM_* shim and observer disabler. Injected before user.js by harness.js.
//
// 设计要点:
//   - 提供 GM_xmlhttpRequest / GM_getValue / GM_setValue / GM_addStyle 的最小可用实现
//   - 统计 xhr / get hit / get miss / set 次数到 window.__perfStats
//   - 把 MutationObserver 替成 no-op:user.js 的 main() 会装 observer,但在静态本地样本上
//     没有真实 mutation,我们改成手动驱动 scanTextNodes/translateTextNodes 测量纯工作量,
//     避免 debounce 50ms 引入的不确定性
//   - 默认 GM_xmlhttpRequest 用 placeholder stub:立即 setTimeout(0) 调 onload 返回固定 IPA。
//     真请求 / 真实样本 mock 留给后续(阶段 1 第 5 项决策)

(function () {
    var storage = new Map();
    var counters = { xhrCount: 0, getHits: 0, getMisses: 0, setCount: 0 };

    window.GM_getValue = function (key, defaultValue) {
        if (storage.has(key)) {
            counters.getHits++;
            return storage.get(key);
        }
        counters.getMisses++;
        return defaultValue;
    };

    window.GM_setValue = function (key, value) {
        counters.setCount++;
        storage.set(key, value);
    };

    window.GM_addStyle = function (css) {
        var head = document.getElementsByTagName("head")[0];
        if (!head) return null;
        var style = document.createElement("style");
        style.setAttribute("type", "text/css");
        style.textContent = css;
        head.appendChild(style);
        return style;
    };

    window.GM_xmlhttpRequest = function (opts) {
        counters.xhrCount++;
        setTimeout(function () {
            try {
                if (typeof opts.onload === "function") {
                    opts.onload({ responseText: '{"value":[{"pronunciation":"(perf-stub)"}]}' });
                }
            } catch (err) {
                console.error("gmShim xhr onload error:", err);
            }
        }, 0);
    };

    // Greasemonkey 4 object form
    window.GM = window.GM || {};
    window.GM.xmlHttpRequest = window.GM_xmlhttpRequest;

    // Disable MutationObserver so user.js's main()-installed observer is no-op.
    // Real callers can still trigger scanTextNodes manually for measurement.
    var RealMutationObserver = window.MutationObserver;
    window.MutationObserver = function () {
        return {
            observe: function () {},
            disconnect: function () {},
            takeRecords: function () { return []; },
        };
    };

    window.__perfStats = counters;
    window.__perfStorage = storage;
    window.__realMutationObserver = RealMutationObserver;
})();
