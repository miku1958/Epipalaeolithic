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
// @version     2024.09.24
// @downloadURL https://raw.githubusercontent.com/miku1958/Epipalaeolithic/master/user.js
// @updateURL   https://raw.githubusercontent.com/miku1958/Epipalaeolithic/master/user.js
// ==/UserScript==

// define some shorthands
/** @type { {[id: string]: Node[]} } */
const queue = {}; // {"community": [rtNodeA, rtNodeB]}

/** @type { Element[] } */
const skipElements = [];

// Recursively traverse the given node and its descendants (Depth-first search)
/** @param { Node } node */
function scanTextNodes(node) {
    // The node could have been detached from the DOM tree
    if (!node.parentNode || !document.body.contains(node)) {
        return;
    }

    // Ignore text boxes and echoes
    const excludeTags = {
        RUBY: true,
        SCRIPT: true,
        SELECT: true,
        TEXTAREA: true,
        STYLE: true,
        CODE: true,
        BUTTON: true,
        A: true,
        LINK: true,
        TABLE: true,
    };
    const excludeRole = { table: true };
    const excludeAriaLabel = { chats: true };
    const excludeClass = [
        "ui-card__body", // Teams calendar card
        "fui-ChatMessage__timestamp", // Teams chat message timestamp
        "code-container", // greasyfork.org code
        "diff-table", // github.com code diff
        "ms-List-cell", // ADO list is dynamicly loaded
    ];
    const excludeDataTrackActionScenario = { messageQuotedReplyDeeplink: true };

    // if node is subnode element of skipElements, return
    for (const skipElement of skipElements) {
        if (skipElement.contains(node)) {
            return;
        }
    }
    switch (node.nodeType) {
        case Node.ELEMENT_NODE: {

            /** @type { Element } */
            const element = node;

            if (element instanceof HTMLElement) {
                /** @type { HTMLElement } */
                const htmlElement = element;
                if (element.hidden) {
                    return;
                }
            }

            if (
                element.tagName in excludeTags ||
                element.isContentEditable ||
                element.role?.toLowerCase() in excludeRole ||
                element.ariaLabel?.toLowerCase() in excludeAriaLabel ||
                element.dataset?.trackActionScenario in excludeDataTrackActionScenario
            ) {
                skipElements.push(element);
                return;
            }
            
            for (const class_ of excludeClass) {
                if (element.classList.contains(class_)) {
                    skipElements.push(element);
                    return;
                }
            }

            const computedStyle = element.computedStyleMap();
            const elementHeight = computedStyle.get("height");
            if (
                elementHeight != null &&
                elementHeight.unit != "percent" && elementHeight != "auto"
            ) {
                skipElements.push(element);
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
                skipElements.push(element);
                return;
            }

            for (let i = element.childNodes.length - 1; i >= 0; i--) {
                scanTextNodes(element.childNodes[i]);
            }
        }
        case Node.TEXT_NODE: {
            const paragraph = node.parentElement;
            const computedStyle = paragraph.computedStyleMap();
            if (
                computedStyle.get("display") == "flex"
            ) {
                return;
            }
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
    const word = /[a-zA-Z']{2,}/;
    let match;
    if (!node.nodeValue || !(match = word.exec(node.nodeValue))) {
        return false;
    }
    const trimLowerMatch = match[0].trim().toLowerCase();

    if (new Set(trimLowerMatch.split('')).size < 2) {
        return;
    }
    const ruby = document.createElement("ruby");
    ruby.appendChild(document.createTextNode(match[0]));

    const rt = document.createElement("rt");
    rt.classList.add("ipa-additional-rt");
    ruby.appendChild(rt);

    // Append the ruby title node to the pending-query queue
    queue[trimLowerMatch] = queue[trimLowerMatch] || [];
    queue[trimLowerMatch].push(rt);

    // <span>[startカナmiddleテストend]</span> =>
    // <span>start<ruby>カナ<rt data-rt="Kana"></rt></ruby>[middleテストend]</span>
    const after = node.splitText(match.index);
    node.parentNode.insertBefore(ruby, after);
    after.nodeValue = after.nodeValue.substring(match[0].length);
    return after;
}

/**
 * Update ruby and clear the pending-query queue
 *
 * @param { string } phrase
 * @param { string } ipa
 */
function updateRuby(phrase, ipa) {
    if (ipa !== "") {
        /** @type { Set<HTMLElement> } */
        let paragraphs = new Set();
        (queue[phrase] || []).forEach(function (node) {
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
            if (currentLineHeight?.unit == "number") {
                paragraph.style.lineHeight = `max(${currentLineHeight.value * 100}%, min(300%, 30pt))`;
            } else {
                paragraph.style.lineHeight = "min(300%, 30pt)";
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
    }
    delete queue[phrase];
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
            let pronunciation = "";
            if (resp.value[0] != null && resp.value[0]?.pronunciation != null) {
                pronunciation = resp.value[0].pronunciation.replace(/[()]/g, "");
            }
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

    const observer = new MutationObserver((records) => {
        records.forEach(function (record) {
            record.addedNodes.forEach(function (node) {
                scanTextNodes(node);
            });
        });

        translateTextNodes();
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
main();
