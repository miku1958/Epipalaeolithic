# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 额外遵循的外部规则

本项目遵循以下规则文件,等同于把其正文内容并入本项目 CLAUDE.md:

@~/.aiGlobal/rules-optional/commit-after-task.md

## 项目性质

单文件 Tampermonkey / Greasemonkey **user script**:`user.js`。没有构建步骤、没有打包、没有 npm 依赖、没有测试套件。"开发"=直接编辑 `user.js`,用户脚本管理器从 GitHub raw URL 自动更新。

`README.md` 是上游 fork(Katakana Terminator 片假名标注)留下的,**与本项目实际行为不符** — 实际行为见下文。改 README 时不要照搬旧描述。

## 实际功能

在任意网页的英文单词上方用 `<ruby><rt>` 注音标 IPA。脚本名 / metadata `@name` 是 `Epipalaeolithic`(内部 console 自称 "IPA Additional"),走 `cn.bing.com/api/v7/dictionarywords/search` 拿 IPA,`GM_setValue` / `GM_getValue` 做持久缓存。

## 发布流程

1. 改 `user.js`,同时把顶部 metadata 的 `@version` 字段(YYYY.MM.DD 格式,见现有值)bump 到今天。
2. commit 改动 + 单独一个 `bump version` commit(参照 git log 里既有节奏:功能提交 + 紧随 `bump version`)。
3. push 到 `master`。用户脚本管理器靠 `@downloadURL` 直接从 master 分支 raw URL 拉取,**push 即发布,没有 release / tag / store 提交步骤**。

`@updateURL` 和 `@downloadURL` 都硬编码指向 `miku1958/Epipalaeolithic` 的 master raw 文件,改 URL 前先确认 fork / 仓库归属。

## Commit 风格

中文 + 偶见英文混用,前缀宽松:`fix:` 出现过、也大量裸标题(`bump version` / `format` / `skip preview` / `Adaptation of bilibili`)。匹配既有节奏即可,不要硬塞 conventional commits 前缀。

## 架构关键路径

进入点是文件底部的 `main()`,装一个 `MutationObserver` 监听 `document.body` 全树 `childList + subtree` 变更;每批新增节点 debounce 50ms 后统一处理。一轮处理分两阶段:

1. **`scanTextNodes(node, parentHasValified)`** — DFS 走 DOM,把"应该标 IPA 的英文文本节点"找出来。**绝大部分代码量都在过滤掉不该标的元素**,过滤是 hot path,改这里前读懂下面的"跳过规则"。命中文本节点时调 `addRuby` 把匹配到的英文单词包成 `<ruby>word<rt class="ipa-additional-rt"></rt></ruby>`,把空 `rt` 推进全局 `queue[matchString]`(matchString 是 lowercase 后的 phrase)。
2. **`translateTextNodes()`** — 遍历 `queue`,命中 `GM_getValue` 缓存直接 `updateRuby`;否则 `bingIPAForPhrase` 发请求,回调里 `GM_setValue` 写缓存 + `updateRuby` 把 IPA 填到 `rt.dataset.rt`。CSS `rt.ipa-additional-rt::before { content: attr(data-rt) }`(在 `main()` 里 `GM_addStyle` 注入)负责真正显示 IPA。

### 跳过规则(`scanTextNodes` 顶部那一大段)

按优先级:`skipElements` Set(已判定跳过的祖先,子孙短路)→ `excludeTags`(`RUBY` / `SCRIPT` / `CODE` / `A` / `PRE` / `QUERY-BUILDER` 等)→ `hidden` → `isContentEditable` / `role` / `ariaLabel` / `dataset.trackActionScenario` → `excludeClass`(命中 Teams / GitHub / ADO / greasyfork 等站点的特定 class)→ `cursor: text`(文本输入光标)→ height 不是百分比 / auto / 0px → `display: flex` 且 height 不是 auto / 100% → 圆角半径 ≥ 短边(判圆形头像 / 徽标)。

加新站点适配时**首选**在 `excludeClass` / `excludeRole` / `excludeAriaLabel` / `excludeDataTrackActionScenario` 里加字段,而不是新写一个独立 branch — 现有路径已经足够表达大部分情况(git log 里 `fix github search bar issue` / `fix teams issue` / `Adaptation of bilibili` 都是按这套加字段实现的)。

### `addRuby` 的双字符检查

正则 `/[a-zA-ZÀ-ÿZĀ-ɏ']{2,}/` 匹配长度 ≥ 2 的拉丁字母 token(含西欧扩展)。匹配后还要求 `new Set(matchString.split("")).size >= 2` — 即至少含 2 个不同字符,挡掉 `aaa` / `www` 这类不值得查 IPA 的 token(`fix addRuby will stop after www` 这条 commit 的来历)。改这条判断前先理解为什么 `www` / `aaa` 不该标。

### IPA 为空时的回退

Bing 对 `running` / `tries` / `boxes` 等屈折形会返回空 IPA。`updateRuby(phrase, "")` 走 `convertPhrase` 把 phrase 还原成估计的原形(去 `s` / `es` / `ed` / `ied→y` / `ing`),把原 `queue[phrase]` 的 rt 节点搬到 `queue[originalPhrase]` 下,再 debounce 触发 `translateTextNodes()` 重查一次。**这意味着 `queue` 在请求往返中会被改写**;新增"还要再处理一遍"类逻辑时务必走同样的搬运 + delete 模式,不要直接 mutate 原条目。

### `StylePropertyMapReadOnly.prototype.get` monkey-patch

文件末尾把这个原型方法换掉,把字符串返回值统一包成 `CSSUnitValue`。`scanTextNodes` 里大量逻辑依赖 `computedStyle.get("...")` 返回 `CSSUnitValue` 风格的 `{ unit, value }` 对象 — 跳过这段 patch 跑 `scanTextNodes` 的判定会全错。改 patch 时同步检查所有 `computedStyle.get(...)` 调用点。

### 行高 / 对齐副作用

`updateRuby` 命中 IPA 时,会向上找到最近的 `DIV` 祖先,把 `align-items: end` 和较高的 `line-height` 注入到 `paragraph.style`,并对途中所有元素清掉 `-webkit-line-clamp`(Safari bug workaround)。这会"污染"页面 inline style — 这是有意的,删 `paragraph.style.*` 赋值前要先在真实页面(Teams / GitHub / Bilibili 等)上回归验证标注不会和上下行重叠(对应 `fix overlap` commit)。

## 调试

- 没有自动化测试。**改动必须在真实页面上手测**:至少跑一个英文为主的网页(任何 docs 站) + 一个混合内容的复杂 SPA(GitHub / Teams web / Bilibili 任选)。
- console 里搜 `IPA Additional:` 看每批 phrase / request 计数和 debug log;`console.error` 路径包含 Bing API JSON 解析失败和 xhr error。
- 缓存查 / 清:Tampermonkey 管理面板 → 脚本 → 存储,key = phrase(lowercase),value = IPA 字符串(可能为空字符串,表示 Bing 返回空,见上面回退逻辑)。本地反复测同一 phrase 时记得清缓存,否则 `GM_getValue` 直接命中、根本不会发请求。
