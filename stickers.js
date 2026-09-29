(function () {
    'use strict';

    var DIRS = ['ducks', 'duks', 'dax', 'icon'];
    var EXT = 'webp';
    var NAME_RE = /:([a-z][a-z0-9_]*):/gi;
    var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, INPUT: 1, NOSCRIPT: 1, CODE: 1, PRE: 1 };

    var cs = document.currentScript;
    var BASE = cs && cs.src ? cs.src.replace(/[^\/]*$/, '') : '';
    var resolved = {};
    var style = document.createElement('style');
    style.textContent =
        '.sticker{height:1.35em;width:auto;vertical-align:-0.3em;margin:0 1px;display:inline-block;' +
        'pointer-events:none;-webkit-user-drag:none;user-select:none;}';
    document.head.appendChild(style);

    function urlFor(name, dirIdx) {
        return BASE + DIRS[dirIdx] + '/' + name + '.' + EXT;
    }

    function makeText(full) {
        var s = document.createElement('span');
        s.className = 'sticker-text';
        s.textContent = full;
        return s;
    }

    function makeImg(name, full) {
        var idx = resolved[name];
        if (idx === -1) return makeText(full);

        var img = document.createElement('img');
        img.className = 'sticker';
        img.alt = full;
        img.draggable = false;
        img.decoding = 'async';
        img.dataset.name = name;
        img.dataset.dir = String(idx === undefined ? 0 : idx);
        img.src = urlFor(name, parseInt(img.dataset.dir, 10));
        return img;
    }
    document.addEventListener('error', function (e) {
        var img = e.target;
        if (!img || img.tagName !== 'IMG' || !img.classList || !img.classList.contains('sticker')) return;

        var name = img.dataset.name;
        var next = parseInt(img.dataset.dir, 10) + 1;

        if (next < DIRS.length) {
            img.dataset.dir = String(next);
            img.src = urlFor(name, next);
            return;
        }

        resolved[name] = -1;
        var full = img.alt;
        var all = document.querySelectorAll('img.sticker[data-name="' + name + '"]');
        for (var i = 0; i < all.length; i++) all[i].replaceWith(makeText(full));
    }, true);

    document.addEventListener('load', function (e) {
        var img = e.target;
        if (!img || img.tagName !== 'IMG' || !img.classList || !img.classList.contains('sticker')) return;
        resolved[img.dataset.name] = parseInt(img.dataset.dir, 10);
    }, true);
    function shouldSkip(node) {
        for (var p = node.parentNode; p && p.nodeType === 1; p = p.parentNode) {
            if (SKIP_TAGS[p.tagName]) return true;
            if (p.classList && (p.classList.contains('sticker-text') || p.isContentEditable)) return true;
        }
        return false;
    }

    function processNode(textNode) {
        var text = textNode.nodeValue;
        if (!text || text.indexOf(':') === -1) return;
        NAME_RE.lastIndex = 0;
        if (!NAME_RE.test(text)) return;
        if (shouldSkip(textNode)) return;

        NAME_RE.lastIndex = 0;
        var frag = document.createDocumentFragment();
        var last = 0, m;
        while ((m = NAME_RE.exec(text)) !== null) {
            if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
            frag.appendChild(makeImg(m[1], m[0]));
            last = m.index + m[0].length;
        }
        if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
        textNode.parentNode.replaceChild(frag, textNode);
    }

    function processTree(root) {
        if (!root) return;
        if (root.nodeType === 3) { processNode(root); return; }
        if (root.nodeType !== 1 || SKIP_TAGS[root.tagName]) return;

        var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
        var list = [], n;
        while ((n = walker.nextNode())) list.push(n);
        for (var i = 0; i < list.length; i++) processNode(list[i]);
    }
    var pending = [], scheduled = false;
    var observer = new MutationObserver(function (mutations) {
        for (var i = 0; i < mutations.length; i++) {
            var added = mutations[i].addedNodes;
            for (var j = 0; j < added.length; j++) pending.push(added[j]);
        }
        if (pending.length && !scheduled) {
            scheduled = true;
            requestAnimationFrame(flush);
        }
    });

    function observe() {
        observer.observe(document.body, { childList: true, subtree: true });
    }

    function flush() {
        scheduled = false;
        var nodes = pending; pending = [];
        observer.disconnect();
        for (var i = 0; i < nodes.length; i++) {
            if (nodes[i].isConnected) processTree(nodes[i]);
        }
        observe();
    }

    function init() {
        processTree(document.body);
        observe();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
    window.MXStickers = { apply: processTree, dirs: DIRS, ext: EXT };
})();
