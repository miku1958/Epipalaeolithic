// ==UserScript==
// @name        Epipalaeolithic
// @description A browser extension to add ipa to English word
// @author      Mi
// @license     MIT
// @namespace   https://github.com/miku1958
// @homepageURL https://github.com/miku1958/Epipalaeolithic
// @icon        https://upload.wikimedia.org/wikipedia/commons/2/28/Ja-Ruby.png
// @exclude     *.icloud.com/*
// @exclude     *.llvm.org/*
// @match       *://*/*
// @grant       GM.xmlHttpRequest
// @grant       GM_xmlhttpRequest
// @grant       GM_addStyle
// @grant       GM_getValue
// @grant       GM_setValue
// @connect     cn.bing.com
// @version     2024.10.4
// @downloadURL https://raw.githubusercontent.com/miku1958/Epipalaeolithic/master/user.js
// @updateURL   https://raw.githubusercontent.com/miku1958/Epipalaeolithic/master/user.js
// ==/UserScript==

// define some shorthands
/** @type { {[id: string]: Node[]} } */
const queue = {}; // {"community": [rtNodeA, rtNodeB]}

/** @type { Set<Element> } */
const skipElements = new Set();

// Ignore text boxes and echoes
const excludeTags = [
    "RUBY",
    "SCRIPT",
    "SELECT",
    "TEXTAREA",
    "STYLE",
    "CODE",
    "BUTTON",
    "A",
    "LINK",
    "TABLE",
    "QUERY-BUILDER", // github serach box, https://github.com/search?q=bookmarkDataWithOptions+language%3A+Swift&type=code
];
const excludeRole = { table: true, heading: true };
const excludeAriaLabel = { chats: true };
const excludeClass = [
    "ui-card__body", // Teams calendar card
    "fui-ChatMessage__timestamp", // Teams chat message timestamp
    "code-container", // greasyfork.org code
    "diff-table", // github.com code diff
    "notranslate", // github ``` code
    "QueryBuilder-StyledInputContent", // github search bar
    "ms-List-cell", // ADO list is dynamicly loaded
    "repos-summary-code-diff", // ADO code diff
];
const excludeDataTrackActionScenario = { messageQuotedReplyDeeplink: true };

// Recursively traverse the given node and its descendants (Depth-first search)
/** 
 * @param { Node } node 
 * @param { Boolean } parentHasValified 
*/
function scanTextNodes(node, parentHasValified = false) {
    // The node could have been detached from the DOM tree
    if (!document.body.contains(node)) {
        return;
    }

    /** @type { Element } */
    const isNode = node.nodeType === Node.TEXT_NODE;
    let element;
    if (node.nodeType === Node.ELEMENT_NODE) {
        element = node;
    }
    if (node.nodeType === Node.TEXT_NODE) {
        if ((node.nodeValue?.trim().length ?? 0) < 2) {
            return;
        }
        element = node.parentElement;
    }
    if (element == null) {
        return;
    }

    // if node is subnode element of skipElements, return
    for (const skipElement of skipElements) {
        if (skipElement === node || skipElement.contains(node)) {
            return;
        }
    }

    if (excludeTags.includes(element.tagName)) {
        skipElements.add(element);
        return;
    }

    if (!isNode || !parentHasValified) {
        if (element instanceof HTMLElement) {
            /** @type { HTMLElement } */
            const htmlElement = element;
            if (element.hidden) {
                return;
            }
        }

        if (
            element.isContentEditable ||
            element.role?.toLowerCase() in excludeRole ||
            element.ariaLabel?.toLowerCase() in excludeAriaLabel ||
            element.dataset?.trackActionScenario in excludeDataTrackActionScenario
        ) {
            skipElements.add(element);
            return;
        }

        for (const class_ of excludeClass) {
            if (element.classList.contains(class_)) {
                skipElements.add(element);
                return;
            }
        }

        const computedStyle = element.computedStyleMap();
        const elementHeight = computedStyle.get("height");
        if (
            elementHeight != null &&
            (
                elementHeight.unit != "percent" && elementHeight != "auto"
                ||
                elementHeight.unit == "px" && element.value === 0
            )
        ) {
            skipElements.add(element);
            return;
        }

        if (
            computedStyle.get("display") == "flex" && elementHeight != "auto"
        ) {
            skipElements.add(element);
            return;
        }

        const windowComputedStyle = window.getComputedStyle(element);
        const minEdge = Math.min(parseFloat(windowComputedStyle.height), parseFloat(windowComputedStyle.width));
        if (
            parseFloat(windowComputedStyle.borderRadius) > minEdge ||
            parseFloat(windowComputedStyle.borderBottomLeftRadius) > minEdge ||
            parseFloat(windowComputedStyle.borderBottomRightRadius) > minEdge ||
            parseFloat(windowComputedStyle.borderTopLeftRadius) > minEdge ||
            parseFloat(windowComputedStyle.borderTopRightRadius) > minEdge
        ) {
            skipElements.add(element);
            return;
        }
    }

    switch (node.nodeType) {
        case Node.ELEMENT_NODE: {
            for (let i = element.childNodes.length - 1; i >= 0; i--) {
                scanTextNodes(element.childNodes[i], true);
            }
        }
        case Node.TEXT_NODE: {
            while ((node = addRuby(node)));
        }
    }
}

// Recursively add ruby tags to text nodes
// Inspired by http://www.the-art-of-web.com/javascript/search-highlight/
/**
 * @param { Text } node
 * @return { Node | false }
 */
function addRuby(node) {
    let text = node.nodeValue ?? "";
    const word = /[a-zA-Z']{2,}/;
    /** @type { RegExpExecArray } */
    let match;
    let matchString = "";
    let testSet = new Set();

    while (testSet.size < 2) {
        if (!(match = word.exec(text))) {
            return false;
        }

        text = text.substring(match.index + match[0].length);
        matchString = match[0].trim().toLowerCase();

        testSet = new Set(matchString.split(''));
    }
    const ruby = document.createElement("ruby");
    ruby.appendChild(document.createTextNode(match[0]));

    const rt = document.createElement("rt");
    skipElements.add(rt);
    rt.classList.add("ipa-additional-rt");
    ruby.appendChild(rt);

    // Append the ruby title node to the pending-query queue
    queue[matchString] = queue[matchString] || [];
    queue[matchString].push(rt);

    // <span>[startカナmiddleテストend]</span> =>
    // <span>start<ruby>カナ<rt data-rt="Kana"></rt></ruby>[middleテストend]</span>
    const after = node.splitText(node.nodeValue.length - text.length - match[0].length);
    node.parentNode.insertBefore(ruby, after);
    after.nodeValue = text;
    return after;
}

/**
 * convert phrase to original form
 *
 * @param { string } phrase
 * @return { string | null }
 */
function convertPhrase(phrase) {
    if (phrase.endsWith("es")) {
        return phrase.slice(0, -2);
    }
    if (phrase.endsWith("s")) {
        return phrase.slice(0, -1);
    }
    if (phrase.endsWith("ied")) {
        return phrase.slice(0, -3) + "y";
    }
    if (phrase.endsWith("ed")) {
        return phrase.slice(0, -2);
    }
    if (phrase.endsWith("ing")) {
        return phrase.slice(0, -3);
    }
    return null;
}

/**
 * Update ruby and clear the pending-query queue
 *
 * @param { string } phrase
 * @param { string } ipa
 */
function updateRuby(phrase, ipa) {
    if (queue[phrase] == null) {
        return;
    }
    if (ipa === "") {
        const originalPhrase = convertPhrase(phrase)?.trim().toLowerCase();
        if (originalPhrase != null) {
            if (queue[originalPhrase] != null) {
                queue[originalPhrase].push(...queue[phrase]);
            } else {
                queue[originalPhrase] = queue[phrase];
            }
            queue[phrase] = null;
            debounce(() => {
                translateTextNodes();
            });
        }
    } else {
        /** @type { Set<HTMLElement> } */
        let paragraphs = new Set();
        queue[phrase].forEach(function (node) {
            node.dataset.rt = ipa;
            // <div><ruby><rt></></ruby></div>
            const element = node.parentElement.parentElement;
            if (element instanceof HTMLElement) {
                paragraphs.add(node.parentElement.parentElement);
            }
        });
        for (let paragraph of paragraphs) {
            paragraph.style.alignItems = "end";

            let computedStyle = paragraph.computedStyleMap();

            const currentLineHeight = computedStyle.get("line-height");
            if (currentLineHeight != null || currentLineHeight != "normal") {
                if (currentLineHeight?.unit == "number") {
                    paragraph.style.lineHeight = `max(${currentLineHeight.value * 100}%, min(300%, 30pt))`;
                } else {
                    paragraph.style.lineHeight = "min(300%, 30pt)";
                }
            }

            while (true) {
                if (paragraph == null) {
                    break;
                }
                if (!["", "none"].includes(computedStyle.get("-webkit-line-clamp"))) {
                    // Fix Safari bug
                    paragraph.style.webkitLineClamp = "unset"; // we can only use unset instead of none
                }
                if (paragraph.tagName === "DIV") {
                    break;
                }
                paragraph = paragraph.parentElement;
                computedStyle = paragraph?.computedStyleMap();
            }
        }
        delete queue[phrase];
    }
}

// Split word list into chunks to limit the length of API requests
function translateTextNodes() {
    let apiRequestCount = 0;
    let phraseCount = 0;

    for (const phrase in queue) {
        phraseCount++;
        const cache = GM_getValue(phrase, null);
        if (cache !== null) {
            updateRuby(phrase, cache);
            continue;
        }

        apiRequestCount++;
        bingIPAForPhrase(phrase);
    }

    if (phraseCount) {
        console.debug(
            "IPA Additional:",
            phraseCount,
            "phrases translated in",
            apiRequestCount,
            "requests, frame",
            window.location.href
        );
    }
}

/**
 * {"keyA": 1, "keyB": 2} => "?keyA=1&keyB=2"
 *
 * @param { string } params
 * @return {*}
 */
function buildQueryString(params) {
    return (
        "?" +
        Object.keys(params)
            .map(function (k) {
                return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]);
            })
            .join("&")
    );
}
/**
 *
 *
 * @param { string } phrase
 */
function bingIPAForPhrase(phrase) {
    // https://cn.bing.com/api/v7/dictionarywords/search?q=community&appid=371E7B2AF0F9B84EC491D731DF90A55719C7D209&mkt=zh-cn
    const api = "https://cn.bing.com/api/v7/dictionarywords/search",
        params = {
            q: phrase,
            appid: "371E7B2AF0F9B84EC491D731DF90A55719C7D209",
            mkt: "zh-cn",
        };

    GM_xmlhttpRequest({
        method: "GET",
        url: api + buildQueryString(params),
        onload: function (dom) {
            try {
                var resp = JSON.parse(dom.responseText.replace("'", "\u2019"));
            } catch (err) {
                console.error("IPA Additional: invalid response", dom.responseText);
                return;
            }
            const pronunciation = resp?.value?.[0]?.pronunciation?.replace(/[()]/g, "") ?? "";
            GM_setValue(phrase, pronunciation);
            updateRuby(phrase, pronunciation);
        },
        onerror: function (dom) {
            console.error("IPA Additional: request error", dom.statusText);
        },
    });
}

function main() {
    GM_addStyle(
        "rt.ipa-additional-rt::before { content: attr(data-rt); font-size: clamp(10pt, 5vw, 70%); opacity: 0.6; }"
    );
    /** @type { Node } */
    const newNodes = [document.body];

    const observer = new MutationObserver((records) => {
        records.forEach(function (record) {
            record.addedNodes.forEach(function (node) {
                newNodes.push(node);
            });
        });

        if (!newNodes.length) {
            return;
        }

        debounce(() => {
            console.debug(
                "IPA Additional:",
                newNodes.length,
                "new nodes were added, frame",
                window.location.href
            );

            newNodes.forEach(scanTextNodes);
            newNodes.length = 0;

            translateTextNodes();
        }, 50)();
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

// Polyfill for Greasemonkey 4
if (
    typeof GM_xmlhttpRequest === "undefined" &&
    typeof GM === "object" &&
    typeof GM.xmlHttpRequest === "function"
) {
    GM_xmlhttpRequest = GM.xmlHttpRequest;
}

if (typeof GM_addStyle === "undefined") {
    GM_addStyle = function (css) {
        const head = document.getElementsByTagName("head")[0];
        if (!head) {
            return null;
        }

        const style = document.createElement("style");
        style.setAttribute("type", "text/css");
        style.textContent = css;
        head.appendChild(style);
        return style;
    };
}

// Polyfill for ES5
if (typeof NodeList.prototype.forEach === "undefined") {
    NodeList.prototype.forEach = function (callback, thisArg) {
        thisArg = thisArg || window;
        for (let i = 0; i < this.length; i++) {
            callback.call(thisArg, this[i], i, this);
        }
    };
}

const originalStylePropertyMapReadOnlyGet = StylePropertyMapReadOnly.prototype.get;
StylePropertyMapReadOnly.prototype.get = function (property) {
    const style = originalStylePropertyMapReadOnlyGet.call(this, property);

    if (style == null || style instanceof CSSUnitValue) {
        return style;
    }
    const styleString = style.toString();
    const value = parseFloat(styleString);
    let unit = styleString.replace(value, "").trim();
    if (unit.includes(" ")) {
        return style;
    }
    if (isNaN(value)) {
        return style
    }
    if (unit === "") {
        unit = "number";
    }
    if (unit === "%") {
        unit = "percent";
    }
    return new CSSUnitValue(value, unit);
};

const debounce = (callback, wait) => {
    let timeoutId = null;
    return (...args) => {
        window.clearTimeout(timeoutId);
        timeoutId = window.setTimeout(() => callback(...args), wait);
    };
}
main();
