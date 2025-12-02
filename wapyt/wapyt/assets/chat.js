(function () {
    "use strict";

    globalThis.wapyt = globalThis.wapyt || {};

    const DEFAULT_DEMO_RESPONSE = `Here's a sample HTML artifact:\n\n:::artifact{identifier="sample-page" type="text/html" title="Sample HTML Page"}\n<!DOCTYPE html>\n<html>\n<head>\n    <title>Sample Page</title>\n    <style>\n        body { font-family: Arial, sans-serif; padding: 20px; background: linear-gradient(45deg, #667eea, #764ba2); color: white; }\n        .container { max-width: 600px; margin: 0 auto; text-align: center; }\n        .card { background: rgba(255,255,255,0.1); padding: 30px; border-radius: 15px; backdrop-filter: blur(10px); }\n    </style>\n</head>\n<body>\n    <div class="container">\n        <div class="card">\n            <h1>Hello from Wapyt!</h1>\n            <p>This is a sample HTML artifact that demonstrates the artifact system.</p>\n            <button onclick="alert('Hello!')">Click me!</button>\n        </div>\n    </div>\n</body>\n</html>\n:::\n\nThis demonstrates how artifacts work in the chat interface.`;

    const DEFAULT_STORAGE_PREFIX = "wapyt:chat";
    const EVENT_HANDLERS = new WeakMap();

    function createUniqueId(prefix) {
        const idPrefix = prefix || "rag";
        return `${idPrefix}-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
    }

    function formatTime(date) {
        return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }

    function clamp(value, min, max) {
        if (Number.isNaN(value)) return min;
        return Math.max(min, Math.min(max, value));
    }

    function ensureMaterialIcons() {
        if (document.getElementById("ragchat-material-icons")) {
            return;
        }
        const link = document.createElement("link");
        link.id = "ragchat-material-icons";
        link.rel = "stylesheet";
        link.href = "https://fonts.googleapis.com/icon?family=Material+Icons";
        document.head.appendChild(link);
    }

    function escapeHtml(value) {
        return (value ?? "").replace(/[&<>"']/g, (char) => {
            switch (char) {
                case "&":
                    return "&amp;";
                case "<":
                    return "&lt;";
                case ">":
                    return "&gt;";
                case '"':
                    return "&quot;";
                case "'":
                    return "&#39;";
                default:
                    return char;
            }
        });
    }

    function encodeBase64Utf8(input) {
        if (typeof window === "undefined" || typeof window.btoa !== "function") {
            return "";
        }
        try {
            if (typeof TextEncoder !== "undefined") {
                const encoder = new TextEncoder();
                const bytes = encoder.encode(input);
                let binary = "";
                bytes.forEach((b) => { binary += String.fromCharCode(b); });
                return window.btoa(binary);
            }
            return window.btoa(unescape(encodeURIComponent(input)));
        } catch (_err) {
            return "";
        }
    }

    function renderInlineMarkdown(text) {
        let html = escapeHtml(text);
        html = html.replace(/\[([^\]]+)\]\(([^\s)]+)(?:\s+"([^"]+)")?\)/g, (_match, label, href, title) => {
            const safeHref = escapeHtml(href);
            const safeLabel = escapeHtml(label);
            const safeTitle = title ? ` title=\"${escapeHtml(title)}\"` : "";
            return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer"${safeTitle}>${safeLabel}</a>`;
        });
        html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
        html = html.replace(/__([^_]+)__/g, "<strong>$1</strong>");
        html = html.replace(/(?<!_)_([^_]+)_(?!_)/g, "<em>$1</em>");
        html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>");
        html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
        return html;
    }

    function renderBlockMarkdown(text) {
        const lines = text.split(/\n/);
        const blocks = [];
        let listBuffer = [];
        let listType = null;
        let paragraph = [];

        const flushParagraph = () => {
            if (!paragraph.length) return;
            const content = paragraph.map((line) => renderInlineMarkdown(line)).join("<br>");
            blocks.push(`<p>${content}</p>`);
            paragraph = [];
        };

        const flushList = () => {
            if (!listBuffer.length) return;
            const items = listBuffer.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("");
            const tag = listType === "ol" ? "ol" : "ul";
            blocks.push(`<${tag}>${items}</${tag}>`);
            listBuffer = [];
            listType = null;
        };

        lines.forEach((rawLine) => {
            const line = rawLine;
            const trimmed = line.trim();
            if (!trimmed) {
                flushList();
                flushParagraph();
                return;
            }

            const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
            const orderedMatch = trimmed.match(/^\d+\.\s+(.*)$/);
            const unorderedMatch = trimmed.match(/^[*-]\s+(.*)$/);
            const blockquoteMatch = trimmed.match(/^>\s+(.*)$/);

            if (headingMatch) {
                flushList();
                flushParagraph();
                const level = headingMatch[1].length;
                const content = renderInlineMarkdown(headingMatch[2]);
                blocks.push(`<h${level}>${content}</h${level}>`);
                return;
            }

            if (blockquoteMatch) {
                flushList();
                flushParagraph();
                blocks.push(`<blockquote>${renderInlineMarkdown(blockquoteMatch[1])}</blockquote>`);
                return;
            }

            if (orderedMatch) {
                flushParagraph();
                if (listType && listType !== "ol") {
                    flushList();
                }
                listType = "ol";
                listBuffer.push(orderedMatch[1]);
                return;
            }

            if (unorderedMatch) {
                flushParagraph();
                if (listType && listType !== "ul") {
                    flushList();
                }
                listType = "ul";
                listBuffer.push(unorderedMatch[1]);
                return;
            }

            paragraph.push(line);
        });

        flushList();
        flushParagraph();

        return blocks.join("");
    }

    let pyodideReady = null;
    function ensurePyodide() {
        if (pyodideReady) {
            return pyodideReady;
        }
        if (window.pyodide && typeof window.pyodide.runPython === "function") {
            pyodideReady = Promise.resolve(window.pyodide);
            return pyodideReady;
        }
        if (typeof loadPyodide !== "function") {
            return Promise.reject(new Error("loadPyodide is not available on window."));
        }
        const indexURL = window.PYODIDE_BASE_URL || "https://cdn.jsdelivr.net/pyodide/v0.28.0/full/";
        pyodideReady = loadPyodide({ indexURL }).then((pyodide) => {
            window.pyodide = pyodide;
            return pyodide;
        }).catch((error) => {
            pyodideReady = null;
            throw error;
        });
        return pyodideReady;
    }

    function basicMarkdown(input) {
        if (!input) return "";
        const fenceRegex = /```([\s\S]*?)```/g;
        const segments = [];
        let lastIndex = 0;
        let match;
        while ((match = fenceRegex.exec(input)) !== null) {
            if (match.index > lastIndex) {
                segments.push({ type: "text", value: input.slice(lastIndex, match.index) });
            }
            segments.push({ type: "code", value: match[1] });
            lastIndex = match.index + match[0].length;
        }
        if (lastIndex < input.length) {
            segments.push({ type: "text", value: input.slice(lastIndex) });
        }

        return segments.map((segment) => {
            if (segment.type === "code") {
                return `<pre><code>${escapeHtml(segment.value)}</code></pre>`;
            }
            return renderBlockMarkdown(segment.value);
        }).join("");
    }

    function renderMarkdown(text) {
        if (!text) return "";
        if (typeof marked !== "undefined" && typeof marked.parse === "function") {
            try {
                return marked.parse(text);
            } catch (error) {
                console.warn("[ChatWidget] markdown parse failed", error);
            }
        }
        return basicMarkdown(text);
    }

    function injectStyles() {
        if (document.getElementById("ragchat-widget-styles")) {
            return;
        }
        const style = document.createElement("style");
        style.id = "ragchat-widget-styles";
        style.textContent = `
            .rag-container { display: flex; height: 100%; width: 100%; background: #f6f8fb; color: #1f2937; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
            .rag-container.rag-dark { background: #1e2534; color: #e2e8f0; }
            .rag-sidebar { width: 260px; min-width: 220px; max-width: 360px; border-right: 1px solid rgba(15, 23, 42, 0.08); background: rgba(255,255,255,0.82); backdrop-filter: blur(12px); display: flex; flex-direction: column; position: relative; overflow: visible; transition: width 0.2s ease; }
            .rag-dark .rag-sidebar { background: rgba(15,23,42,0.62); border-right-color: rgba(226,232,240,0.1); }
            .rag-sidebar.collapsed { width: 64px; min-width: 64px; max-width: 64px; padding-right: 6px; border-right: none; }
            .rag-sidebar.collapsed .sidebar-controls { flex-direction: column; align-items: center; gap: 8px; padding: 16px 6px 8px; }
            .rag-sidebar.collapsed .sidebar-controls .sidebar-btn { width: 44px; height: 44px; }
            .rag-sidebar.collapsed .sidebar-controls .sidebar-btn:not([data-action='toggle-sidebar']) { display: none; }
            .rag-sidebar.collapsed .sidebar-controls .tooltip { display: none; }
            .sidebar-controls { display: flex; gap: 8px; padding: 16px; align-items: center; }
            .sidebar-btn { position: relative; background: rgba(59,130,246,0.12); border: none; border-radius: 12px; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: inherit; }
            .sidebar-btn:hover { background: rgba(59,130,246,0.22); }
            .sidebar-btn .tooltip { position: absolute; background: rgba(15,23,42,0.85); color: #fff; font-size: 11px; padding: 4px 8px; border-radius: 6px; bottom: -32px; opacity: 0; pointer-events: none; transform: translateY(8px); transition: opacity 0.15s ease, transform 0.15s ease; white-space: nowrap; }
            .sidebar-btn:hover .tooltip { opacity: 1; transform: translateY(0); }
            .rag-chat-list { position: relative; flex: 1; overflow-y: auto; padding: 0 12px 16px; display: flex; flex-direction: column; gap: 6px; }
            .rag-sidebar.collapsed .rag-chat-list { padding: 8px 6px 12px; align-items: center; gap: 10px; }
            .rag-chat-list::before { content: ""; position: absolute; top: 0; left: 12px; right: 12px; height: 1px; background: rgba(15,23,42,0.08); }
            .rag-chat-item { position: relative; padding: 12px 14px; border-radius: 12px; background: transparent; cursor: pointer; display: flex; align-items: center; gap: 12px; transition: background 0.15s ease, transform 0.15s ease; border-bottom: 1px solid rgba(15,23,42,0.06); }
            .rag-chat-item:last-child { border-bottom: none; }
            .rag-chat-item .chat-title { flex: 1; font-size: 14px; font-weight: 500; }
            .rag-chat-item .chat-model { font-size: 11px; opacity: 0.6; }
            .rag-chat-item .chat-delete-btn { background: none; border: none; cursor: pointer; opacity: 0; transform: translateX(4px); transition: opacity 0.15s ease, transform 0.15s ease; color: inherit; display: flex; align-items: center; justify-content: center; border-radius: 8px; width: 28px; height: 28px; }
            .rag-chat-item:hover { background: rgba(59,130,246,0.1); }
            .rag-chat-item.active { background: rgba(59,130,246,0.2); }
            .rag-chat-item:hover .chat-delete-btn { opacity: 1; transform: translateX(0); }
            .rag-chat-item .chat-badge { min-width: 20px; height: 20px; border-radius: 999px; background: #ef4444; color: #fff; font-size: 11px; font-weight: 600; display: inline-flex; align-items: center; justify-content: center; padding: 0 6px; margin-left: 6px; }
            .rag-chat-item.active .chat-badge { background: #f97316; }
            .rag-sidebar.collapsed .chat-badge { position: absolute; top: -4px; right: -4px; margin: 0; min-width: 18px; height: 18px; font-size: 10px; }
            .rag-chat-item[data-initial]::before { content: attr(data-initial); font-weight: 600; width: 32px; height: 32px; border-radius: 10px; background: rgba(59,130,246,0.18); display: flex; align-items: center; justify-content: center; }
            .rag-sidebar.collapsed .rag-chat-item { justify-content: center; width: 44px; height: 44px; padding: 0; border-radius: 14px; position: relative; }
            .rag-sidebar.collapsed .rag-chat-item .chat-title,
            .rag-sidebar.collapsed .rag-chat-item .chat-model,
            .rag-sidebar.collapsed .rag-chat-item .chat-delete-btn { display: none; }
            .rag-sidebar.collapsed .rag-chat-item::before { margin: 0; width: 36px; height: 36px; border-radius: 12px; font-size: 15px; }
            .rag-chat-item .tooltip { position: absolute; left: 54px; top: 50%; transform: translateY(-50%) scale(0.95); background: rgba(15,23,42,0.9); color: #fff; padding: 6px 10px; border-radius: 8px; font-size: 12px; pointer-events: none; opacity: 0; transition: opacity 0.15s ease, transform 0.15s ease; white-space: nowrap; box-shadow: 0 8px 20px rgba(15,23,42,0.2); visibility: hidden; }
            .rag-dark .rag-chat-item .tooltip { background: rgba(226,232,240,0.92); color: #111827; }
            .rag-sidebar.collapsed .rag-chat-item:hover .tooltip { opacity: 1; transform: translateY(-50%) scale(1); visibility: visible; }
            .rag-sidebar:not(.collapsed) .rag-chat-item .tooltip { display: none; }
            .rag-main { flex: 1; position: relative; display: flex; flex-direction: column; min-width: 0; }
            .rag-header { padding: 18px 24px 14px; display: flex; justify-content: space-between; align-items: flex-start; }
            .rag-header-left { display: flex; flex-direction: column; gap: 4px; }
            .rag-agent-name { font-size: 20px; font-weight: 600; }
            .rag-agent-subtitle { font-size: 13px; opacity: 0.65; }
            .rag-header-right { display: flex; align-items: center; gap: 10px; }
            .rag-header-right select { padding: 8px 12px; border: 1px solid rgba(15,23,42,0.12); border-radius: 10px; background: rgba(255,255,255,0.85); font-size: 13px; min-width: 180px; }
            .rag-chat-scroll { flex: 1; overflow-y: auto; padding: 0 24px 16px; }
            .rag-chat-container { display: flex; flex-direction: column; gap: 16px; padding-bottom: 80px; }
            .rag-message { position: relative; display: flex; flex-direction: column; gap: 0; max-width: 76%; min-width: 240px; align-items: flex-start; padding: 0; background: transparent; border: none; box-shadow: none; }
            .rag-message:hover .message-bubble { transform: translateY(-1px); box-shadow: 0 22px 44px rgba(15,23,42,0.12); }
            .rag-user-message { align-self: flex-end; align-items: flex-end; }
            .rag-message .message-header { display: flex; align-items: center; gap: 10px; font-size: 11px; letter-spacing: 0.08em; padding: 0 4px 6px; color: rgba(15,23,42,0.55); width: 100%; }
            .rag-user-message .message-header { color: rgba(11,30,63,0.6); justify-content: flex-end; }
            .rag-message .message-name { font-weight: 600; text-transform: uppercase; }
            .rag-dark .rag-message .message-header { color: rgba(226,232,240,0.72); }
            .rag-dark .rag-user-message .message-header { color: rgba(191,219,254,0.82); }
            .rag-dark .rag-message .message-name { color: inherit; }
            .rag-message .message-timestamp { font-weight: 500; opacity: 0.65; font-size: 11px; text-transform: uppercase; }
            .rag-message .message-timestamp::before { content: "\u00B7"; margin: 0 0 0 0.45em; opacity: 0.6; }
            .message-timestamp.is-hidden { display: none; }
            .message-tray { width: 100%; display: flex; justify-content: flex-end; align-items: center; gap: 4px; padding: 2px 4px 0; }
            .message-copy-btn { border: none; background: rgba(148,163,184,0.2); color: inherit; width: 26px; height: 26px; border-radius: 9px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; transition: background 0.2s ease, transform 0.2s ease; }
            .message-copy-btn .material-icons { font-size: 16px; }
            .message-copy-btn:hover { background: rgba(59,130,246,0.28); transform: translateY(-1px); }
            .rag-user-message .message-copy-btn { background: rgba(15,23,42,0.1); color: #0b1e3f; }
            .rag-user-message .message-copy-btn:hover { background: rgba(15,23,42,0.18); }
            .rag-message.is-thinking .message-copy-btn { opacity: 0.4; pointer-events: none; }
            .message-bubble { width: 100%; padding: 16px 20px 18px; border-radius: 20px; background: rgba(255,255,255,0.98); color: #0f172a; border: 1px solid rgba(15,23,42,0.06); box-shadow: 0 18px 38px rgba(15,23,42,0.08); transition: transform 0.2s ease, box-shadow 0.2s ease; }
            .rag-user-message .message-bubble { background: linear-gradient(145deg, #d0e1ff 0%, #bccdfd 55%, #aebefd 100%); color: #0b1e3f; border: 1px solid rgba(59,130,246,0.2); box-shadow: 0 18px 32px rgba(79,70,229,0.18); }
            .rag-message .message-content { color: inherit; line-height: 1.65; }
            .rag-user-message .message-content { color: #0b1e3f; }
            .rag-user-message .message-content a { color: #1d4ed8; }
            .rag-dark .rag-assistant-message .message-content { color: #e2e8f0; }
            .rag-dark .rag-user-message .message-content { color: #bfdbfe; }
            .message-bubble pre { overflow-x: auto; border-radius: 14px; background: rgba(15,23,42,0.06); padding: 12px 16px; color: inherit; }
            .message-bubble code { word-break: break-word; }
            .rag-user-message .message-bubble pre { background: rgba(15,23,42,0.1); color: #0b1e3f; }
            .message-thinking { display: none; align-items: center; gap: 10px; font-size: 13px; font-weight: 500; color: rgba(15,23,42,0.48); letter-spacing: 0.012em; }
            .message-thinking .thinking-label { font-style: italic; }
            .rag-dark .message-thinking,
            .rag-dark .composer-help { color: rgba(148,163,184,0.78); }
            .rag-message.is-thinking .message-thinking { display: flex; }
            .rag-message.is-thinking .message-content { display: none; }
            .thinking-dots { display: flex; gap: 4px; }
            .thinking-dots span { width: 6px; height: 6px; border-radius: 999px; background: currentColor; opacity: 0.32; animation: rag-thinking-bounce 1.2s infinite ease-in-out; }
            .thinking-dots span:nth-child(2) { animation-delay: 0.2s; }
            .thinking-dots span:nth-child(3) { animation-delay: 0.4s; }
            .rag-input-container { padding: 16px 24px 24px; }
            .rag-input-form { display: flex; gap: 12px; align-items: flex-end; background: rgba(255,255,255,0.95); border-radius: 18px; border: 1px solid rgba(15,23,42,0.08); padding: 12px 16px; box-shadow: 0 12px 40px rgba(15,23,42,0.12); }
            .rag-input-form textarea { flex: 0 0 auto; width: 100%; border: none; resize: none; background: transparent; font-size: 15px; line-height: 1.5; min-height: 44px; overflow-y: hidden; box-sizing: border-box; color: #0f172a; caret-color: #2563eb; }
            .rag-input-form textarea::placeholder { color: rgba(15,23,42,0.45); }
            .rag-input-form textarea:focus { outline: none; }
            .rag-input-form button { border: none; padding: 12px 20px; border-radius: 12px; background: linear-gradient(135deg, #2563eb, #7c3aed); color: white; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
            .rag-input-form button:disabled { opacity: 0.5; cursor: not-allowed; }
            .composer-help { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(15,23,42,0.45); margin: 6px 4px 0; }
            .rag-dark .rag-input-form { background: rgba(15,23,42,0.82); border-color: rgba(226,232,240,0.12); box-shadow: 0 14px 48px rgba(0,0,0,0.35); }
            .rag-dark .rag-input-form textarea { color: #e2e8f0; caret-color: #93c5fd; }
            .rag-dark .rag-input-form textarea::placeholder { color: rgba(226,232,240,0.55); }
            .rag-advanced .rag-message { flex-direction: row; align-items: flex-start; max-width: 100%; min-width: 0; }
            .rag-advanced .rag-user-message { align-self: stretch; align-items: flex-start; }
            .rag-advanced .rag-message .message-header { padding: 0; margin-bottom: 4px; color: rgba(15,23,42,0.6); }
            .rag-advanced.rag-dark .rag-message .message-header { color: rgba(226,232,240,0.78); }
            .rag-advanced .message-avatar { width: 28px; height: 28px; border-radius: 50%; overflow: hidden; background: rgba(148,163,184,0.25); display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 11px; color: rgba(15,23,42,0.65); margin-right: 10px; flex-shrink: 0; text-transform: uppercase; }
            .rag-advanced.rag-dark .message-avatar { background: rgba(148,163,184,0.35); color: rgba(226,232,240,0.85); }
            .rag-advanced .message-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
            .rag-advanced .message-body { flex: 1; display: flex; flex-direction: column; gap: 6px; padding-bottom: 16px; border-bottom: 1px solid rgba(15,23,42,0.08); }
            .rag-advanced.rag-dark .message-body { border-bottom-color: rgba(148,163,184,0.22); }
            .rag-advanced .message-bubble { background: transparent; border: none; box-shadow: none; padding: 0; }
            .rag-advanced .rag-message:hover .message-bubble { transform: none; box-shadow: none; }
            .rag-advanced .message-content { color: inherit; }
            .rag-container.rag-thin { font-size: 14px; }
            .rag-thin .rag-sidebar { width: 220px; min-width: 180px; padding-top: 10px; }
            .rag-thin .rag-sidebar.collapsed { width: 56px; min-width: 56px; max-width: 56px; }
            .rag-thin .rag-chat-list { padding: 0 10px 12px; gap: 4px; }
            .rag-thin .rag-chat-item { padding: 9px 12px; gap: 8px; border-radius: 10px; }
            .rag-thin .rag-chat-item .chat-title { font-size: 13px; }
            .rag-thin .rag-chat-item .chat-model { font-size: 10px; }
            .rag-thin .rag-chat-item[data-initial]::before { width: 28px; height: 28px; border-radius: 9px; font-size: 13px; }
            .rag-thin .rag-header { padding: 12px 18px 8px; }
            .rag-thin .rag-agent-name { font-size: 18px; }
            .rag-thin .rag-agent-subtitle { font-size: 12px; }
            .rag-thin .rag-chat-scroll { padding: 0 18px 12px; }
            .rag-thin .rag-chat-container { gap: 12px; }
            .rag-thin .rag-message { max-width: 72%; min-width: 200px; }
            .rag-thin .rag-message .message-header { font-size: 10px; gap: 6px; padding: 0 2px 4px; }
            .rag-thin .message-bubble { padding: 14px 16px; border-radius: 18px; }
            .rag-thin .rag-message .message-content { font-size: 14px; line-height: 1.55; }
            .rag-thin .message-bubble pre { padding: 10px 14px; font-size: 13px; }
            .rag-thin .message-bubble code { font-size: 13px; }
            .rag-thin .message-thinking { font-size: 12px; }
            .rag-thin .message-copy-btn { width: 24px; height: 24px; }
            .rag-thin .rag-input-container { padding: 12px 18px 18px; }
            .rag-thin .rag-input-form { padding: 10px 14px; gap: 10px; border-radius: 14px; }
            .rag-thin .rag-input-form textarea { font-size: 14px; line-height: 1.45; min-height: 38px; }
            .rag-thin .rag-input-form button { padding: 10px 18px; border-radius: 10px; font-size: 14px; }
            .rag-thin .composer-help { font-size: 10px; letter-spacing: 0.06em; margin: 4px 2px 0; }
            .rag-thin .artifact-panel { width: clamp(220px, 32%, 360px); }
            .rag-thin .artifact-tabs button { padding: 6px 10px; font-size: 12px; }
            .rag-thin .artifact-actions button { padding: 8px 12px; font-size: 12px; }
            .model-selector { position: relative; display: inline-flex; flex-direction: column; min-width: 240px; }
            .model-selector__trigger { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 14px; border-radius: 12px; border: 1px solid rgba(15,23,42,0.12); background: rgba(255,255,255,0.9); color: inherit; cursor: pointer; font-size: 13px; font-weight: 500; transition: box-shadow 0.15s ease, border-color 0.15s ease; }
            .model-selector__trigger .material-icons { font-size: 18px; transition: transform 0.2s ease; }
            .model-selector[data-open="true"] .model-selector__trigger .material-icons { transform: rotate(180deg); }
            .model-selector__trigger:focus-visible { outline: 2px solid rgba(59,130,246,0.45); outline-offset: 2px; }
            .model-selector__text { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }
            .model-selector__label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.6; }
            .model-selector__value { font-size: 13px; font-weight: 600; }
            .model-selector__menu { position: absolute; top: calc(100% + 6px); right: 0; display: flex; min-width: 460px; max-height: 380px; background: rgba(255,255,255,0.98); border-radius: 14px; border: 1px solid rgba(15,23,42,0.08); box-shadow: 0 18px 40px rgba(15,23,42,0.16); overflow: hidden; z-index: 40; }
            .model-selector__columns { display: flex; align-items: stretch; min-width: 100%; max-height: inherit; overflow-x: auto; }
            .model-selector__column { flex: 0 0 220px; max-height: inherit; border-right: 1px solid rgba(15,23,42,0.08); overflow-y: auto; display: flex; flex-direction: column; gap: 6px; padding: 12px 14px; background: rgba(255,255,255,0.92); }
            .model-selector__column:last-child { border-right: none; }
            .model-selector__node { width: 100%; border: none; background: transparent; text-align: left; padding: 9px 12px; font-size: 13px; cursor: pointer; display: flex; align-items: center; gap: 10px; border-radius: 10px; transition: background 0.15s ease, transform 0.15s ease; }
            .model-selector__node:hover { background: rgba(59,130,246,0.1); transform: translateX(2px); }
            .model-selector__node.active { background: rgba(59,130,246,0.18); font-weight: 600; }
            .model-selector__group-label { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.6; margin: 4px 2px 0; }
            .model-selector__option { width: 100%; border: none; border-radius: 10px; padding: 8px 12px; text-align: left; background: rgba(59,130,246,0.1); cursor: pointer; font-size: 13px; transition: background 0.15s ease, transform 0.15s ease; }
            .model-selector__option:hover { background: rgba(59,130,246,0.18); transform: translateY(-1px); }
            .model-selector__option.active { background: rgba(59,130,246,0.28); font-weight: 600; color: #0b1e3f; }
            .model-selector__empty { padding: 14px; font-size: 12px; color: rgba(15,23,42,0.6); }
            .model-selector__menu[hidden] { display: none; }
            .rag-dark .model-selector__trigger { background: rgba(15,23,42,0.7); border-color: rgba(148,163,184,0.28); color: #e2e8f0; }
            .rag-dark .model-selector__menu { background: rgba(15,23,42,0.95); border-color: rgba(148,163,184,0.24); }
            .rag-dark .model-selector__column { border-right-color: rgba(148,163,184,0.2); background: rgba(15,23,42,0.9); }
            .rag-dark .model-selector__node { color: #e2e8f0; }
            .rag-dark .model-selector__node:hover { background: rgba(96,165,250,0.2); }
            .rag-dark .model-selector__node.active { background: rgba(96,165,250,0.28); color: #fff; }
            .rag-dark .model-selector__group-label { color: rgba(226,232,240,0.68); }
            .rag-dark .model-selector__option { background: rgba(96,165,250,0.18); color: #e2e8f0; }
            .rag-dark .model-selector__option:hover { background: rgba(96,165,250,0.26); }
            .rag-dark .model-selector__option.active { background: rgba(96,165,250,0.36); color: #fff; }
            .rag-dark .model-selector__empty { color: rgba(226,232,240,0.7); }
            .rag-thin .model-selector { min-width: 200px; }
            .rag-thin .model-selector__trigger { padding: 8px 12px; font-size: 12px; gap: 8px; }
            .rag-thin .model-selector__value { font-size: 12px; }
            .rag-thin .model-selector__menu { min-width: 380px; }
            .rag-thin .model-selector__column { flex-basis: 190px; padding: 10px 12px; }
            .rag-advanced .message-tray { justify-content: flex-start; padding: 0; margin-top: 4px; gap: 6px; }
            .rag-advanced .message-copy-btn { background: rgba(148,163,184,0.2); }
            .rag-advanced.rag-dark .message-copy-btn { background: rgba(148,163,184,0.3); }
            .rag-advanced .rag-chat-container { gap: 12px; }
            .artifact-panel { position: absolute; top: 0; right: 0; height: 100%; width: 0; background: rgba(15,23,42,0.95); color: #e2e8f0; box-shadow: -12px 0 32px rgba(15,23,42,0.45); display: flex; flex-direction: column; transition: width 0.2s ease, transform 0.2s ease; overflow: hidden; }
            .artifact-panel.visible { width: 40%; min-width: 320px; }
            .artifact-resize-handle { position: absolute; left: -4px; top: 0; bottom: 0; width: 8px; cursor: col-resize; }
            .artifact-header { padding: 18px 20px 12px; border-bottom: 1px solid rgba(148,163,184,0.22); display: flex; flex-direction: column; gap: 12px; }
            .artifact-title { font-size: 18px; font-weight: 600; }
            .artifact-tabs { display: flex; gap: 8px; }
            .artifact-tab { background: rgba(255,255,255,0.08); border: none; border-radius: 10px; padding: 8px 14px; color: inherit; cursor: pointer; font-size: 13px; }
            .artifact-tab.active { background: rgba(255,255,255,0.22); }
            .artifact-body { flex: 1; display: flex; flex-direction: column; gap: 12px; padding: 14px 20px 20px; overflow: hidden; }
            .artifact-code { flex: 1; display: none; background: rgba(15,23,42,0.85); border-radius: 12px; padding: 14px; overflow: auto; font-family: "Fira Code", monospace; font-size: 13px; }
            .artifact-code.visible { display: block; }
            .artifact-preview { flex: 1; display: none; border-radius: 12px; overflow: hidden; background: rgba(255,255,255,0.95); }
            .artifact-preview.visible { display: block; }
            .artifact-preview iframe { width: 100%; height: 100%; border: none; }
            .artifact-actions { padding: 0 20px 20px; display: flex; gap: 10px; }
            .artifact-actions button { flex: 1; border: none; border-radius: 10px; padding: 10px 12px; font-size: 13px; background: rgba(59,130,246,0.18); color: inherit; cursor: pointer; }
            .artifact-actions button:hover { background: rgba(59,130,246,0.28); }
            .artifact-icon { display: inline-flex; align-items: center; gap: 6px; background: rgba(59,130,246,0.15); padding: 6px 10px; border-radius: 999px; font-size: 13px; cursor: pointer; margin: 6px 6px 0 0; }
            .artifact-icon span.material-icons { font-size: 18px; }
            .rag-main.with-artifact { margin-right: 40%; }
            @media (max-width: 1200px) {
                .artifact-panel.visible { width: 48%; }
                .rag-main.with-artifact { margin-right: 48%; }
            }
            @media (max-width: 960px) {
                .artifact-panel { position: fixed; width: 100%; max-width: none; height: 60%; bottom: 0; top: auto; border-top: 1px solid rgba(148,163,184,0.25); }
                .artifact-panel.visible { width: 100%; }
                .rag-main.with-artifact { margin-right: 0; }
                .artifact-resize-handle { display: none; }
            }
            @keyframes rag-thinking-bounce {
                0%, 80%, 100% { transform: translateY(0); opacity: 0.25; }
                40% { transform: translateY(-3px); opacity: 1; }
            }
        `;
        document.head.appendChild(style);
    }

    class EventBus {
        constructor() {
            this._listeners = new Map();
        }

        on(event, handler) {
            if (!this._listeners.has(event)) {
                this._listeners.set(event, new Set());
            }
            this._listeners.get(event).add(handler);
        }

        off(event, handler) {
            if (!this._listeners.has(event)) return;
            this._listeners.get(event).delete(handler);
        }

        emit(event, payload) {
            const eventObj = { event, payload, handled: false, defaultPrevented: false, results: [] };
            if (!this._listeners.has(event)) {
                return eventObj;
            }
            const listeners = Array.from(this._listeners.get(event));
            listeners.forEach((listener) => {
                try {
                    const result = listener(payload);
                    eventObj.results.push(result);
                    if (result === true) {
                        eventObj.handled = true;
                    }
                } catch (error) {
                    console.error(`[ChatWidget] listener for ${event} failed`, error);
                }
            });
            if (!eventObj.handled && eventObj.results.some((value) => value === true)) {
                eventObj.handled = true;
            }
            return eventObj;
        }
    }

    class WapytChatApp {
        constructor(root, options, host) {
            this.root = root;
            this.host = host;
            this.options = Object.assign({
                agent: { name: "Assistant", subtitle: "" },
                demoResponse: DEFAULT_DEMO_RESPONSE,
                storageKey: null,
                enableArtifacts: true,
                autoAppendUserMessages: true,
                inputPlaceholder: "Ask a question…",
                sendButtonText: "Send",
            }, options || {});

            this._ui = this._normalizeUiConfig(this.options.ui);
            this._layout = this._normalizeLayout(this.options.layout);
            this._avatars = Object.assign({ user: null, assistant: null }, this._layout.avatars || {});
            if (!this._avatars.assistant && this.options.agent && this.options.agent.avatar) {
                this._avatars.assistant = this.options.agent.avatar;
            }
            this._userDisplayName = this._resolveUserName(this.options.user);

            this._storagePrefix = this.options.storageKey || `${DEFAULT_STORAGE_PREFIX}:${createUniqueId("instance")}`;
            this._storageKeys = {
                chats: `${this._storagePrefix}:chats`,
                activeChatId: `${this._storagePrefix}:active`,
                artifactPanelWidth: `${this._storagePrefix}:artifactWidth`,
                sidebarCollapsed: `${this._storagePrefix}:sidebar`,
                isDarkMode: `${this._storagePrefix}:darkMode`,
            };

            this.chats = [];
            this.activeChatId = null;
            this.availableModels = [];
            this.currentArtifact = null;
            this.streamContext = {
                target: null,
                messageId: null,
                buffer: "",
                isRedirecting: false,
                completedMessageId: null,
                messageArtifactCount: 0,
            };
            this.isArtifactResizing = false;
            this.artifactPanelWidth = localStorage.getItem(this._storageKeys.artifactPanelWidth) || (this.options.artifactPanelWidth ? `${this.options.artifactPanelWidth}px` : "40%");
            this.sidebarCollapsed = localStorage.getItem(this._storageKeys.sidebarCollapsed) === "true";
            this.isDarkMode = localStorage.getItem(this._storageKeys.isDarkMode) === "true";
            const hostTheme = this._detectHostTheme();
            if (hostTheme) {
                this.isDarkMode = hostTheme === "dark";
            }
            this._persistedDarkMode = this.isDarkMode;
            this._themeObserver = null;
            this._messageMap = new Map();
            this._artifactMap = new Map();
            this._pendingMessages = [];
            this._pendingStreams = [];
            this._boundHandlers = [];
            this.modelHierarchy = null;
            this._modelNodeIndex = null;
            this._selectedModel = null;
            this._activePath = [];
            this._isModelMenuOpen = false;

            this.ids = {
                container: createUniqueId("rag-container"),
                sidebar: createUniqueId("rag-sidebar"),
                chatList: createUniqueId("rag-chat-list"),
                chatContainer: createUniqueId("rag-chat-container"),
                chatScroll: createUniqueId("rag-chat-scroll"),
                headerRight: createUniqueId("rag-header-right"),
                headerActions: createUniqueId("rag-header-actions"),
                inputForm: createUniqueId("rag-input-form"),
                queryInput: createUniqueId("rag-query"),
                sendButton: createUniqueId("rag-send"),
                modelSelect: createUniqueId("rag-model-select"),
                modelSelectTrigger: createUniqueId("rag-model-trigger"),
                modelSelectMenu: createUniqueId("rag-model-menu"),
                modelSelectColumns: createUniqueId("rag-model-columns"),
                modelSelectValue: createUniqueId("rag-model-value"),
                mainContent: createUniqueId("rag-main"),
                artifactPanel: createUniqueId("artifact-panel"),
                artifactResize: createUniqueId("artifact-resize"),
                artifactTitle: createUniqueId("artifact-title"),
                artifactCode: createUniqueId("artifact-code"),
                artifactCodeContent: createUniqueId("artifact-code-content"),
                artifactPreview: createUniqueId("artifact-preview"),
                artifactIframe: createUniqueId("artifact-iframe"),
                artifactCopy: createUniqueId("artifact-copy"),
                artifactDownload: createUniqueId("artifact-download"),
                artifactClose: createUniqueId("artifact-close"),
                artifactTabCode: createUniqueId("artifact-tab-code"),
                artifactTabPreview: createUniqueId("artifact-tab-preview"),
                sidebarControls: createUniqueId("sidebar-controls"),
                composerHelp: createUniqueId("composer-help"),
                agentName: createUniqueId("agent-name"),
                agentSubtitle: createUniqueId("agent-subtitle"),
            };

            this._renderShell();
            this._cacheDom();
            this._applyLayoutMode();
            this._bindEvents();
            this._initializeState();
        }

        // -----------------------------------------------------------------
        // Initialization helpers
        // -----------------------------------------------------------------

        _normalizeUiConfig(config) {
            const asObject = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});

            const ensureButton = (defaults, overrides) => {
                if (overrides === false) {
                    return Object.assign({}, defaults, { show: false });
                }
                const source = asObject(overrides);
                const result = Object.assign({}, defaults, source);
                if (typeof source.show === "boolean") {
                    result.show = source.show;
                }
                return result;
            };

            const defaults = {
                sidebar: {
                    newChat: { show: true, icon: "add_comment", tooltip: "New chat" },
                    clearChats: { show: true, icon: "delete_sweep", tooltip: "Clear chats" },
                    toggleTheme: { show: true, icon: "dark_mode", tooltip: "Toggle theme" },
                    toggleSidebar: {
                        show: true,
                        icons: { expanded: "menu_open", collapsed: "menu" },
                        tooltips: { expanded: "Collapse", collapsed: "Expand" },
                    },
                },
                header: {
                    demoButton: { show: false, label: "Demo" },
                    toggleTheme: { show: false, label: "🌙", tooltip: "Toggle theme" },
                },
                modelSelect: { show: true },
            };

            const safeConfig = asObject(config);
            const sidebarSource = asObject(safeConfig.sidebar);
            const headerSource = asObject(safeConfig.header);
            const modelSource = safeConfig.modelSelect === false ? { show: false } : asObject(safeConfig.modelSelect);

            const toggleOverride = sidebarSource.toggleSidebar;
            const baseToggle = defaults.sidebar.toggleSidebar;
            let toggleSidebar;
            if (toggleOverride === false) {
                toggleSidebar = {
                    show: false,
                    icons: Object.assign({}, baseToggle.icons),
                    tooltips: Object.assign({}, baseToggle.tooltips),
                };
            } else {
                const overrideObj = asObject(toggleOverride);
                toggleSidebar = Object.assign({}, baseToggle, overrideObj);
                toggleSidebar.icons = Object.assign({}, baseToggle.icons, asObject(overrideObj.icons));
                toggleSidebar.tooltips = Object.assign({}, baseToggle.tooltips, asObject(overrideObj.tooltips));
                if (typeof overrideObj.show === "boolean") {
                    toggleSidebar.show = overrideObj.show;
                }
            }

            return {
                sidebar: {
                    newChat: ensureButton(defaults.sidebar.newChat, sidebarSource.newChat),
                    clearChats: ensureButton(defaults.sidebar.clearChats, sidebarSource.clearChats),
                    toggleTheme: ensureButton(defaults.sidebar.toggleTheme, sidebarSource.toggleTheme),
                    toggleSidebar,
                },
                header: {
                    demoButton: ensureButton(defaults.header.demoButton, headerSource.demoButton),
                    toggleTheme: ensureButton(defaults.header.toggleTheme, headerSource.toggleTheme),
                },
                modelSelect: Object.assign({}, defaults.modelSelect, modelSource),
            };
        }

        _normalizeLayout(config) {
            const asObject = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
            const defaults = {
                mode: "classic",
                density: "comfortable",
                avatars: { user: null, assistant: null },
            };
            const source = asObject(config);
            const avatars = asObject(source.avatars);
            const mode = (source.mode || defaults.mode).toString().toLowerCase();
            const normalizedMode = ["classic", "advanced"].includes(mode) ? mode : "classic";
            const densityValue = (source.density || defaults.density).toString().toLowerCase();
            const normalizedDensity = (() => {
                if (["comfortable", "relaxed"].includes(densityValue)) {
                    return "comfortable";
                }
                if (["thin", "compact", "dense", "cozy"].includes(densityValue)) {
                    return "thin";
                }
                return defaults.density;
            })();
            return {
                mode: normalizedMode,
                density: normalizedDensity,
                avatars: {
                    user: avatars.user || null,
                    assistant: avatars.assistant || null,
                },
            };
        }

        _normalizeThemeName(theme) {
            if (!theme && theme !== 0) return null;
            const value = String(theme).toLowerCase();
            if (value.includes("dark")) return "dark";
            if (value.includes("light")) return "light";
            return null;
        }

        _resolveUserName(config) {
            if (config && typeof config === "object") {
                if (config.avatar && !this._avatars.user) {
                    this._avatars.user = config.avatar;
                }
                const name = (config.name || "").toString().trim();
                if (name) {
                    return name;
                }
            }
            return "You";
        }

        _detectHostTheme() {
            try {
                const docTheme = document?.documentElement?.getAttribute?.("data-wapyt-theme");
                if (docTheme) {
                    const normalized = this._normalizeThemeName(docTheme);
                    if (normalized) return normalized;
                }
            } catch (error) {
                console.warn("[ChatWidget] Failed to detect host theme", error);
            }
            return null;
        }

        _setDarkMode(isDark, options = {}) {
            const settings = typeof options === "object" && options !== null ? options : {};
            const persist = settings.persist !== undefined ? settings.persist : true;
            const forcePersist = Boolean(settings.forcePersist);
            const next = Boolean(isDark);
            const changed = this.isDarkMode !== next;
            this.isDarkMode = next;
            if (this.els && this.els.container) {
                this.els.container.classList.toggle("rag-dark", next);
            }
            if (persist && (changed || forcePersist || this._persistedDarkMode !== next)) {
                this.saveState();
                this._persistedDarkMode = next;
            }
        }

        _applyHostTheme(themeName) {
            const normalized = this._normalizeThemeName(themeName);
            if (!normalized) return;
            this._setDarkMode(normalized === "dark", { persist: true });
        }

        _observeHostTheme() {
            if (typeof MutationObserver === "undefined" || !document?.documentElement) {
                return;
            }
            if (this._themeObserver) {
                this._themeObserver.disconnect();
            }
            const applyCurrent = () => {
                const current = this._detectHostTheme();
                if (current) {
                    this._applyHostTheme(current);
                }
            };
            this._themeObserver = new MutationObserver((mutations) => {
                for (let i = 0; i < mutations.length; i += 1) {
                    if (mutations[i].type === "attributes") {
                        applyCurrent();
                        break;
                    }
                }
            });
            try {
                this._themeObserver.observe(document.documentElement, {
                    attributes: true,
                    attributeFilter: ["data-wapyt-theme"],
                });
            } catch (error) {
                console.warn("[ChatWidget] Failed to observe host theme", error);
            }
            applyCurrent();
        }

        _applyLayoutMode() {
            if (!this.els || !this.els.container) {
                return;
            }
            this.els.container.classList.toggle("rag-advanced", this._layout.mode === "advanced");
            this.els.container.classList.toggle("rag-thin", this._layout.density === "thin");
        }

        _getAvatarForRole(role) {
            const normalized = (role || "").toLowerCase();
            if (normalized === "user") {
                return this._avatars.user || null;
            }
            if (normalized === "assistant") {
                if (this._avatars.assistant) {
                    return this._avatars.assistant;
                }
                if (this.options.agent && this.options.agent.avatar) {
                    return this.options.agent.avatar;
                }
            }
            return null;
        }

        _renderShell() {
            const agentName = (this.options.agent && this.options.agent.name) || "Assistant";
            const agentSubtitle = (this.options.agent && this.options.agent.subtitle) || "";
            const composerHelp = this.options.composerHelpText || "Shift+Enter for newline";
            const ui = this._ui;
            const containerClasses = ["rag-container"];
            if (this.isDarkMode) containerClasses.push("rag-dark");
            if (this._layout.mode === "advanced") containerClasses.push("rag-advanced");
            if (this._layout.density === "thin") containerClasses.push("rag-thin");
            const containerClassName = containerClasses.join(" ");

            const sidebarButtons = [];
            const appendSidebarButton = (action, cfg) => {
                if (!cfg || cfg.show === false) return;
                const icon = cfg.icon ? escapeHtml(cfg.icon) : "";
                const tooltip = cfg.tooltip ? escapeHtml(cfg.tooltip) : "";
                const aria = tooltip ? ` aria-label="${tooltip}"` : "";
                sidebarButtons.push(`
                    <button class="sidebar-btn" type="button" data-action="${action}"${aria}>
                        ${icon ? `<span class="material-icons">${icon}</span>` : ""}
                        ${tooltip ? `<div class="tooltip">${tooltip}</div>` : ""}
                    </button>
                `);
            };

            appendSidebarButton("new-chat", ui.sidebar.newChat);
            appendSidebarButton("clear-chats", ui.sidebar.clearChats);
            appendSidebarButton("toggle-theme", ui.sidebar.toggleTheme);

            const toggleCfg = ui.sidebar.toggleSidebar || {};
            if (toggleCfg.show !== false) {
                const icons = Object.assign({ expanded: "menu_open", collapsed: "menu" }, toggleCfg.icons || {});
                const tooltips = Object.assign({ expanded: "Collapse", collapsed: "Expand" }, toggleCfg.tooltips || {});
                const expandedIcon = escapeHtml(icons.expanded);
                const collapsedIcon = escapeHtml(icons.collapsed);
                const expandedTooltip = escapeHtml(tooltips.expanded);
                const collapsedTooltip = escapeHtml(tooltips.collapsed);
                const initialIcon = this.sidebarCollapsed ? collapsedIcon : expandedIcon;
                const initialTooltip = this.sidebarCollapsed ? collapsedTooltip : expandedTooltip;
                sidebarButtons.push(`
                    <button class="sidebar-btn" type="button" data-action="toggle-sidebar" data-icon-expanded="${expandedIcon}" data-icon-collapsed="${collapsedIcon}" data-tooltip-expanded="${expandedTooltip}" data-tooltip-collapsed="${collapsedTooltip}" aria-label="${initialTooltip}">
                        <span class="material-icons">${initialIcon}</span>
                        <div class="tooltip">${initialTooltip}</div>
                    </button>
                `);
            }

            const sidebarControlsHtml = sidebarButtons.join("");

            const headerActions = [];
            const demoCfg = ui.header.demoButton || {};
            if (demoCfg.show !== false) {
                const label = escapeHtml(demoCfg.label || "Demo");
                headerActions.push(`<button type="button" data-action="demo">${label}</button>`);
            }
            const headerToggleCfg = ui.header.toggleTheme || {};
            if (headerToggleCfg.show !== false) {
                const label = escapeHtml(headerToggleCfg.label || "🌙");
                const tooltip = escapeHtml(headerToggleCfg.tooltip || "Toggle theme");
                headerActions.push(`<button type="button" data-action="toggle-theme" title="${tooltip}">${label}</button>`);
            }
            const headerActionsHtml = headerActions.length ? `<div class="chat-header__actions" id="${this.ids.headerActions}">${headerActions.join("")}</div>` : "";

            const shouldRenderModelSelect = !(ui.modelSelect && ui.modelSelect.show === false);
            const modelSelectHtml = shouldRenderModelSelect
                ? `
                    <div class="model-selector" id="${this.ids.modelSelect}" data-open="false" role="combobox">
                        <button type="button" class="model-selector__trigger" id="${this.ids.modelSelectTrigger}" aria-haspopup="listbox" aria-expanded="false" aria-controls="${this.ids.modelSelectMenu}">
                            <span class="model-selector__text">
                                <span class="model-selector__label">Model</span>
                                <span class="model-selector__value" id="${this.ids.modelSelectValue}">Loading models...</span>
                            </span>
                            <span class="material-icons">expand_more</span>
                        </button>
                        <div class="model-selector__menu" id="${this.ids.modelSelectMenu}" hidden tabindex="-1">
                            <div class="model-selector__columns" id="${this.ids.modelSelectColumns}">
                                <div class="model-selector__empty">No models</div>
                            </div>
                        </div>
                    </div>
                `
                : "";

            this.root.innerHTML = `
                <div class="${containerClassName}" id="${this.ids.container}">
                    <div class="rag-sidebar${this.sidebarCollapsed ? " collapsed" : ""}" id="${this.ids.sidebar}">
                        <div class="sidebar-controls" id="${this.ids.sidebarControls}">
                            ${sidebarControlsHtml}
                        </div>
                        <div class="rag-chat-list" id="${this.ids.chatList}"></div>
                    </div>
                    <div class="rag-main" id="${this.ids.mainContent}">
                        <div class="rag-header">
                            <div class="rag-header-left">
                                <div class="rag-agent-name" id="${this.ids.agentName}">${agentName}</div>
                                <div class="rag-agent-subtitle" id="${this.ids.agentSubtitle}">${agentSubtitle || ""}</div>
                            </div>
                            <div class="rag-header-right" id="${this.ids.headerRight}">
                                ${headerActionsHtml}
                                ${modelSelectHtml}
                            </div>
                        </div>
                        <div class="rag-chat-scroll" id="${this.ids.chatScroll}">
                            <div class="rag-chat-container" id="${this.ids.chatContainer}"></div>
                        </div>
                        <div class="rag-input-container">
                            <form class="rag-input-form" id="${this.ids.inputForm}">
                                <div style="flex:1; display:flex; flex-direction:column;">
                                    <textarea id="${this.ids.queryInput}" placeholder="${this.options.inputPlaceholder || "Ask something..."}"></textarea>
                                    <div class="composer-help" id="${this.ids.composerHelp}">${composerHelp || ""}</div>
                                </div>
                                <button type="submit" id="${this.ids.sendButton}">
                                    <span class="material-icons">send</span>
                                    ${this.options.sendButtonText || "Send"}
                                </button>
                            </form>
                        </div>
                    </div>
                    <div class="artifact-panel" id="${this.ids.artifactPanel}">
                        <div class="artifact-resize-handle" id="${this.ids.artifactResize}"></div>
                        <div class="artifact-header">
                            <div class="artifact-title" id="${this.ids.artifactTitle}">Artifact</div>
                            <div class="artifact-tabs">
                                <button class="artifact-tab" id="${this.ids.artifactTabCode}" data-tab="code">Code</button>
                                <button class="artifact-tab" id="${this.ids.artifactTabPreview}" data-tab="preview">Preview</button>
                            </div>
                        </div>
                        <div class="artifact-body">
                            <pre class="artifact-code" id="${this.ids.artifactCode}"><code id="${this.ids.artifactCodeContent}"></code></pre>
                            <div class="artifact-preview" id="${this.ids.artifactPreview}">
                                <iframe id="${this.ids.artifactIframe}" sandbox="allow-scripts allow-same-origin"></iframe>
                            </div>
                        </div>
                        <div class="artifact-actions">
                            <button id="${this.ids.artifactCopy}" data-action="artifact-copy">Copy</button>
                            <button id="${this.ids.artifactDownload}" data-action="artifact-download">Download</button>
                            <button id="${this.ids.artifactClose}" data-action="artifact-close">Close</button>
                        </div>
                    </div>
                </div>
            `;
        }

        _cacheDom() {
            const byId = (id) => document.getElementById(id);
            this.els = {
                container: byId(this.ids.container),
                sidebar: byId(this.ids.sidebar),
                chatList: byId(this.ids.chatList),
                chatContainer: byId(this.ids.chatContainer),
                chatScroll: byId(this.ids.chatScroll),
                headerRight: byId(this.ids.headerRight),
                headerActions: byId(this.ids.headerActions),
                inputForm: byId(this.ids.inputForm),
                queryInput: byId(this.ids.queryInput),
                sendButton: byId(this.ids.sendButton),
                modelSelect: byId(this.ids.modelSelect),
                modelSelectTrigger: byId(this.ids.modelSelectTrigger),
                modelSelectMenu: byId(this.ids.modelSelectMenu),
                modelSelectColumns: byId(this.ids.modelSelectColumns),
                modelSelectValue: byId(this.ids.modelSelectValue),
                mainContent: byId(this.ids.mainContent),
                artifactPanel: byId(this.ids.artifactPanel),
                artifactResize: byId(this.ids.artifactResize),
                artifactTitle: byId(this.ids.artifactTitle),
                artifactCode: byId(this.ids.artifactCode),
                artifactCodeContent: byId(this.ids.artifactCodeContent),
                artifactPreview: byId(this.ids.artifactPreview),
                artifactIframe: byId(this.ids.artifactIframe),
                artifactCopy: byId(this.ids.artifactCopy),
                artifactDownload: byId(this.ids.artifactDownload),
                artifactClose: byId(this.ids.artifactClose),
                artifactTabCode: byId(this.ids.artifactTabCode),
                artifactTabPreview: byId(this.ids.artifactTabPreview),
                composerHelp: byId(this.ids.composerHelp),
                agentName: byId(this.ids.agentName),
                agentSubtitle: byId(this.ids.agentSubtitle),
                sidebarControls: byId(this.ids.sidebarControls),
            };
        }

        _bindEvents() {
            ensureMaterialIcons();
            const resizeHandler = (evt) => this._handleArtifactResize(evt);
            const stopResizeHandler = () => this._stopArtifactResize();

            const onInput = () => this._adjustTextareaHeight();
            const onKeydown = (event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    this.handleSubmit();
                } else if (event.key === "Enter" && event.shiftKey) {
                    window.setTimeout(() => this._adjustTextareaHeight(), 0);
                }
            };
            const onFormSubmit = (event) => {
                event.preventDefault();
                this.handleSubmit();
            };

            const onChatContainerClick = (event) => {
                const artifactBtn = event.target.closest(".artifact-icon");
                if (artifactBtn) {
                    const artifactId = artifactBtn.getAttribute("data-artifact-id");
                    this.showArtifact(artifactId);
                    return;
                }
                const copyBtn = event.target.closest(".message-copy-btn");
                if (copyBtn) {
                    const messageId = copyBtn.getAttribute("data-message-id");
                    this.copyMessage(messageId);
                }
            };

            const handleUiAction = (action) => {
                switch (action) {
                    case "new-chat":
                        this.startNewChat();
                        break;
                    case "clear-chats":
                        this.clearAllChats();
                        break;
                    case "toggle-theme":
                    case "toggle-dark":
                        this.toggleDarkMode();
                        break;
                    case "toggle-sidebar":
                        this.toggleSidebar();
                        break;
                    case "demo":
                        this.streamMockResponse();
                        break;
                    default:
                        break;
                }
            };

            const onSidebarClick = (event) => {
                const btn = event.target.closest(".sidebar-btn");
                if (!btn) return;
                const action = btn.getAttribute("data-action");
                if (action) {
                    event.preventDefault();
                    handleUiAction(action);
                }
            };

            const onHeaderActionsClick = (event) => {
                const btn = event.target.closest("[data-action]");
                if (!btn) return;
                const action = btn.getAttribute("data-action");
                if (action) {
                    event.preventDefault();
                    handleUiAction(action);
                }
            };

            const onChatListClick = (event) => {
                const deleteBtn = event.target.closest(".chat-delete-btn");
                if (deleteBtn) {
                    const chatId = deleteBtn.getAttribute("data-chat-id");
                    this.deleteChat(chatId);
                    event.stopPropagation();
                    return;
                }
                const item = event.target.closest(".rag-chat-item");
                if (!item) return;
                const chatId = item.getAttribute("data-chat-id");
                this.switchChat(chatId);
            };

            const onModelTriggerClick = (event) => {
                event.preventDefault();
                this._toggleModelMenu();
            };

            const onModelNodePointer = (event) => {
                const nodeBtn = event.target.closest(".model-selector__node");
                if (!nodeBtn) return;
                const nodeId = nodeBtn.getAttribute("data-node-id");
                const depth = Number(nodeBtn.getAttribute("data-depth"));
                if (!nodeId || Number.isNaN(depth)) return;
                this._setActivePathForDepth(depth, nodeId);
            };

            const onModelOptionClick = (event) => {
                const option = event.target.closest(".model-selector__option");
                if (!option) return;
                const modelId = option.getAttribute("data-model");
                if (!modelId) return;
                event.preventDefault();
                event.stopPropagation();
                this._setSelectedModel(modelId, { updateActiveChat: true, updateChatList: true, persist: true, closeMenu: true });
            };

            const onDocumentClick = (event) => {
                if (!this._isModelMenuOpen) return;
                const root = this.els.modelSelect;
                if (!root) return;
                if (root.contains(event.target)) return;
                this._closeModelMenu();
            };

            const onModelMenuKeydown = (event) => {
                if (event.key === "Escape") {
                    this._closeModelMenu();
                    if (this.els.modelSelectTrigger) {
                        this.els.modelSelectTrigger.focus();
                    }
                }
            };

            const onArtifactCopy = (event) => {
                event.preventDefault();
                this.copyArtifactCode(event);
            };
            const onArtifactDownload = (event) => {
                event.preventDefault();
                this.downloadArtifact(event);
            };
            const onArtifactClose = (event) => {
                event.preventDefault();
                this.closeArtifactPanel();
            };
            const onArtifactTab = (event) => {
                event.preventDefault();
                const tab = event.currentTarget.getAttribute("data-tab");
                this.switchArtifactTab(tab);
            };

            const onResizeMouseDown = (event) => {
                this.isArtifactResizing = true;
                document.addEventListener("mousemove", resizeHandler);
                document.addEventListener("mouseup", stopResizeHandler);
                event.preventDefault();
            };

            this.els.queryInput.addEventListener("input", onInput);
            this.els.queryInput.addEventListener("keydown", onKeydown);
            this.els.inputForm.addEventListener("submit", onFormSubmit);
            this.els.chatContainer.addEventListener("click", onChatContainerClick);
            if (this.els.sidebarControls) {
                this.els.sidebarControls.addEventListener("click", onSidebarClick);
            }
            if (this.els.headerActions) {
                this.els.headerActions.addEventListener("click", onHeaderActionsClick);
            }
            this.els.chatList.addEventListener("click", onChatListClick);
            if (this.els.modelSelectTrigger) {
                this.els.modelSelectTrigger.addEventListener("click", onModelTriggerClick);
            }
            if (this.els.modelSelectColumns) {
                this.els.modelSelectColumns.addEventListener("mouseover", onModelNodePointer);
                this.els.modelSelectColumns.addEventListener("focusin", onModelNodePointer);
                this.els.modelSelectColumns.addEventListener("click", onModelOptionClick);
            }
            if (this.els.modelSelectMenu) {
                this.els.modelSelectMenu.addEventListener("keydown", onModelMenuKeydown);
            }
            if (this.els.modelSelect) {
                document.addEventListener("click", onDocumentClick);
            }
            this.els.artifactCopy.addEventListener("click", onArtifactCopy);
            this.els.artifactDownload.addEventListener("click", onArtifactDownload);
            this.els.artifactClose.addEventListener("click", onArtifactClose);
            this.els.artifactTabCode.addEventListener("click", onArtifactTab);
            this.els.artifactTabPreview.addEventListener("click", onArtifactTab);
            this.els.artifactResize.addEventListener("mousedown", onResizeMouseDown);
            window.addEventListener("resize", onInput);

            EVENT_HANDLERS.set(this, {
                resizeHandler,
                stopResizeHandler,
                onInput,
                onKeydown,
                onFormSubmit,
                onChatContainerClick,
                onSidebarClick,
                onHeaderActionsClick,
                onChatListClick,
                onModelTriggerClick,
                onModelNodePointer,
                onModelOptionClick,
                onDocumentClick,
                onModelMenuKeydown,
                onArtifactCopy,
                onArtifactDownload,
                onArtifactClose,
                onArtifactTab,
                onResizeMouseDown,
            });
        }

        _initializeState() {
            this._loadState();
            this.loadModels().then(() => {
                this.initChats();
            }).catch(() => {
                this.initChats();
            });
            this._adjustTextareaHeight();
            this._observeHostTheme();
        }

        _loadState() {
            try {
                const storedChats = localStorage.getItem(this._storageKeys.chats);
                const storedActive = localStorage.getItem(this._storageKeys.activeChatId);
                if (storedChats) {
                    const parsed = JSON.parse(storedChats);
                    if (Array.isArray(parsed)) {
                        this.chats = parsed;
                    }
                }
                if (storedActive) {
                    this.activeChatId = storedActive;
                }
            } catch (error) {
                console.warn("[ChatWidget] Failed to load state", error);
            }
        }

        saveState() {
            try {
                localStorage.setItem(this._storageKeys.chats, JSON.stringify(this.chats));
                if (this.activeChatId) {
                localStorage.setItem(this._storageKeys.activeChatId, this.activeChatId);
            }
            localStorage.setItem(this._storageKeys.artifactPanelWidth, this.artifactPanelWidth);
            localStorage.setItem(this._storageKeys.sidebarCollapsed, String(this.sidebarCollapsed));
            localStorage.setItem(this._storageKeys.isDarkMode, String(this.isDarkMode));
            this._persistedDarkMode = this.isDarkMode;
        } catch (error) {
            console.warn("[ChatWidget] Failed to save state", error);
        }
    }

        destroy() {
            const handlers = EVENT_HANDLERS.get(this);
            if (handlers) {
                this.els.queryInput.removeEventListener("input", handlers.onInput);
                this.els.queryInput.removeEventListener("keydown", handlers.onKeydown);
                this.els.inputForm.removeEventListener("submit", handlers.onFormSubmit);
                this.els.chatContainer.removeEventListener("click", handlers.onChatContainerClick);
                if (this.els.sidebarControls) {
                    this.els.sidebarControls.removeEventListener("click", handlers.onSidebarClick);
                }
                if (this.els.headerActions) {
                    this.els.headerActions.removeEventListener("click", handlers.onHeaderActionsClick);
                }
                this.els.chatList.removeEventListener("click", handlers.onChatListClick);
                if (this.els.modelSelectTrigger) {
                    this.els.modelSelectTrigger.removeEventListener("click", handlers.onModelTriggerClick);
                }
                if (this.els.modelSelectColumns) {
                    this.els.modelSelectColumns.removeEventListener("mouseover", handlers.onModelNodePointer);
                    this.els.modelSelectColumns.removeEventListener("focusin", handlers.onModelNodePointer);
                    this.els.modelSelectColumns.removeEventListener("click", handlers.onModelOptionClick);
                }
                if (this.els.modelSelectMenu) {
                    this.els.modelSelectMenu.removeEventListener("keydown", handlers.onModelMenuKeydown);
                }
                this.els.artifactCopy.removeEventListener("click", handlers.onArtifactCopy);
                this.els.artifactDownload.removeEventListener("click", handlers.onArtifactDownload);
                this.els.artifactClose.removeEventListener("click", handlers.onArtifactClose);
                this.els.artifactTabCode.removeEventListener("click", handlers.onArtifactTab);
                this.els.artifactTabPreview.removeEventListener("click", handlers.onArtifactTab);
                this.els.artifactResize.removeEventListener("mousedown", handlers.onResizeMouseDown);
                document.removeEventListener("mousemove", handlers.resizeHandler);
                document.removeEventListener("mouseup", handlers.stopResizeHandler);
                document.removeEventListener("click", handlers.onDocumentClick);
                window.removeEventListener("resize", handlers.onInput);
            }
            EVENT_HANDLERS.delete(this);
            if (this._themeObserver) {
                this._themeObserver.disconnect();
                this._themeObserver = null;
            }
        }

        // -----------------------------------------------------------------
        // UI helpers
        // -----------------------------------------------------------------

        _adjustTextareaHeight() {
            const textarea = this.els.queryInput;
            const maxHeight = Math.floor(window.innerHeight * 0.33) || 260;
            const minHeight = 44;
            textarea.style.minHeight = `${minHeight}px`;
            textarea.style.maxHeight = `${maxHeight}px`;
            textarea.style.height = "auto";
            const scrollHeight = textarea.scrollHeight;
            const nextHeight = clamp(scrollHeight, minHeight, maxHeight);
            textarea.style.height = `${nextHeight}px`;
            textarea.style.overflowY = scrollHeight > maxHeight ? "auto" : "hidden";
        }

        _getModelConfigSource() {
            if (this.options && this.options.providerConfig) {
                return this.options.providerConfig;
            }
            return this.options ? this.options.models : null;
        }

        _formatModelLabel(value) {
            if (!value) return "";
            return value
                .toString()
                .replace(/[_\-]/g, " ")
                .replace(/\s+/g, " ")
                .trim()
                .replace(/\b\w/g, (char) => char.toUpperCase());
        }

        _normalizeModelData(raw) {
            if (!raw) {
                return null;
            }

            const source =
                raw && typeof raw === "object" && !Array.isArray(raw) && raw.providers && typeof raw.providers === "object"
                    ? raw.providers
                    : raw;

            const nodesById = new Map();

            const buildNode = (key, value, path) => {
                const nodePath = [...path, key].filter(Boolean);
                const id = nodePath.length ? nodePath.join("::") : "__root__";
                const label = key ? this._formatModelLabel(key) : null;

                const node = {
                    id,
                    key,
                    label,
                    children: [],
                    models: [],
                    path: nodePath,
                };

                if (Array.isArray(value)) {
                    node.models = value
                        .filter((model) => typeof model === "string" && model.trim())
                        .map((model) => model.trim());
                } else if (value && typeof value === "object") {
                    Object.entries(value).forEach(([childKey, childValue]) => {
                        const childNode = buildNode(childKey, childValue, nodePath);
                        if (childNode.children.length || childNode.models.length) {
                            node.children.push(childNode);
                        }
                    });
                } else if (value && typeof value === "string" && value.trim()) {
                    node.models = [value.trim()];
                }

                node.children = node.children.filter(Boolean);
                node.models = Array.from(new Set(node.models));

                if (key && !node.children.length && !node.models.length) {
                    return null;
                }

                nodesById.set(id, node);
                return node;
            };

            const rootNode = buildNode(null, source, []);
            if (!rootNode || (!rootNode.children.length && !rootNode.models.length)) {
                return null;
            }

            return { root: rootNode, nodesById };
        }

        _flattenModels(structure) {
            if (!structure || !structure.root) {
                return [];
            }
            const result = new Set();
            const walk = (node) => {
                (node.models || []).forEach((modelId) => {
                    result.add(modelId);
                });
                (node.children || []).forEach((child) => walk(child));
            };
            walk(structure.root);
            return Array.from(result);
        }

        _setModelSelectorEmpty(message) {
            if (this.els.modelSelectValue) {
                const display = this._selectedModel || message || "No models";
                this.els.modelSelectValue.textContent = display;
            }
            if (this.els.modelSelectColumns) {
                this.els.modelSelectColumns.innerHTML = `<div class="model-selector__empty">${message || "No models"}</div>`;
            }
            this._activePath = [];
            this.modelHierarchy = null;
            this._modelNodeIndex = null;
            this.availableModels = [];
            this._selectedModel = null;
        }

        _sanitizeActivePath() {
            if (!this._modelNodeIndex || !this.modelHierarchy || !this.modelHierarchy.root) {
                this._activePath = [];
                return;
            }
            const sanitized = [];
            let parent = this.modelHierarchy.root;
            for (let i = 0; i < this._activePath.length; i += 1) {
                const nodeId = this._activePath[i];
                const node = this._modelNodeIndex.get(nodeId);
                if (!node || !parent || !Array.isArray(parent.children) || !parent.children.some((child) => child.id === nodeId)) {
                    break;
                }
                sanitized.push(nodeId);
                parent = node;
            }
            this._activePath = sanitized;
        }

        _getActivePathNodes() {
            if (!this._modelNodeIndex || !Array.isArray(this._activePath)) {
                return [];
            }
            return this._activePath
                .map((nodeId) => this._modelNodeIndex.get(nodeId))
                .filter((node) => Boolean(node));
        }

        _renderModelColumns() {
            if (!this.els.modelSelectColumns) return;
            this._sanitizeActivePath();

            const container = this.els.modelSelectColumns;
            container.innerHTML = "";

            const root = this.modelHierarchy?.root;
            if (!root || (!root.children.length && !root.models.length)) {
                container.innerHTML = `<div class="model-selector__empty">No models</div>`;
                return;
            }

            const columns = [];
            let nextPathIndex = 0;
            if (root.children && root.children.length) {
                columns.push({ type: "nodes", nodes: root.children, pathIndex: nextPathIndex });
                nextPathIndex += 1;
            }
            if (root.models && root.models.length) {
                columns.push({ type: "models", models: root.models });
            }

            const pathNodes = this._getActivePathNodes();
            pathNodes.forEach((node) => {
                if (!node) return;
                if (node.children && node.children.length) {
                    columns.push({ type: "nodes", nodes: node.children, pathIndex: nextPathIndex });
                    nextPathIndex += 1;
                }
                if (node.models && node.models.length) {
                    columns.push({ type: "models", models: node.models });
                }
            });

            if (!columns.length) {
                container.innerHTML = `<div class="model-selector__empty">No models</div>`;
                return;
            }

            columns.forEach((column, columnIndex) => {
                const columnEl = document.createElement("div");
                columnEl.className = "model-selector__column";
                columnEl.setAttribute("data-index", String(columnIndex));

                if (column.type === "nodes") {
                    columnEl.setAttribute("role", "listbox");
                    columnEl.setAttribute("aria-label", columnIndex === 0 ? "Providers" : "Groups");
                    column.nodes.forEach((node) => {
                        const button = document.createElement("button");
                        button.type = "button";
                        button.className = "model-selector__node";
                        button.textContent = node.label || this._formatModelLabel(node.key || node.id);
                        button.setAttribute("data-node-id", node.id);
                        button.setAttribute("data-depth", String(column.pathIndex));
                        button.setAttribute("tabindex", "0");
                        if (this._activePath[column.pathIndex] === node.id) {
                            button.classList.add("active");
                        }
                        columnEl.appendChild(button);
                    });
                } else if (column.type === "models") {
                    columnEl.setAttribute("role", "listbox");
                    columnEl.setAttribute("aria-label", "Models");
                    column.models.forEach((modelId) => {
                        const button = document.createElement("button");
                        button.type = "button";
                        button.className = "model-selector__option";
                        button.setAttribute("data-model", modelId);
                        button.setAttribute("tabindex", "0");
                        button.textContent = modelId;
                        if (modelId === this._selectedModel) {
                            button.classList.add("active");
                        }
                        columnEl.appendChild(button);
                    });
                }

                if (!columnEl.children.length) {
                    columnEl.innerHTML = `<div class="model-selector__empty">No options</div>`;
                }

                container.appendChild(columnEl);
            });
        }

        _setActivePathForDepth(depth, nodeId) {
            if (!this._modelNodeIndex || !this._modelNodeIndex.has(nodeId)) {
                return;
            }
            const nextPath = this._activePath.slice(0, depth);
            nextPath[depth] = nodeId;
            this._activePath = nextPath;
            this._renderModelColumns();
        }

        _findPathForModel(modelId, node = this.modelHierarchy?.root) {
            if (!node) {
                return null;
            }
            if (node.models && node.models.includes(modelId)) {
                return [];
            }
            for (const child of node.children || []) {
                if (child.models && child.models.includes(modelId)) {
                    return [child.id];
                }
                const childPath = this._findPathForModel(modelId, child);
                if (childPath) {
                    return [child.id, ...childPath];
                }
            }
            return null;
        }

        _updateModelSelectorDisplay() {
            if (!this.els.modelSelectValue) return;
            let text = this._selectedModel || "Select model";
            if (this._selectedModel && this.modelHierarchy && this.modelHierarchy.root) {
                const providerLabel = this._getProviderLabelForModel(this._selectedModel);
                if (providerLabel) {
                    text = `${providerLabel} · ${this._selectedModel}`;
                }
            }
            this.els.modelSelectValue.textContent = text;
        }

        _getProviderLabelForModel(modelId) {
            if (!this._modelNodeIndex || !this.modelHierarchy) {
                return null;
            }
            const path = this._findPathForModel(modelId);
            if (!path || !path.length) {
                return null;
            }
            const firstNode = this._modelNodeIndex.get(path[0]);
            return firstNode ? firstNode.label || this._formatModelLabel(firstNode.key || firstNode.id) : null;
        }

        _setSelectedModel(modelId, options = {}) {
            if (!modelId) {
                return;
            }
            if (modelId === "default" && Array.isArray(this.availableModels) && this.availableModels.length) {
                modelId = this.availableModels[0];
            }
            if (Array.isArray(this.availableModels) && !this.availableModels.includes(modelId) && this.availableModels.length) {
                modelId = this.availableModels[0];
            }
            if (this.availableModels && this.availableModels.length && !this.availableModels.includes(modelId)) {
                this.availableModels.push(modelId);
            }

            this._selectedModel = modelId;
            const path = this._findPathForModel(modelId);
            this._activePath = Array.isArray(path) ? path : [];
            this._updateModelSelectorDisplay();
            this._sanitizeActivePath();
            this._renderModelColumns();

            if (options.updateActiveChat !== false) {
                const chat = this._getActiveChat();
                if (chat) {
                    chat.model = modelId;
                }
            }
            if (options.updateChatList) {
                this._renderChatList();
            }
            if (options.persist) {
                this.saveState();
            }
            if (options.closeMenu) {
                this._closeModelMenu();
            }
        }

        _toggleModelMenu(force) {
            if (!this.els.modelSelect || !this.els.modelSelectMenu || !this.els.modelSelectTrigger) return;
            const next = typeof force === "boolean" ? force : !this._isModelMenuOpen;
            if (next) {
                this._openModelMenu();
            } else {
                this._closeModelMenu();
            }
        }

        _openModelMenu() {
            if (!this.els.modelSelectMenu || !this.els.modelSelectTrigger) return;
            this._isModelMenuOpen = true;
            this.els.modelSelect.setAttribute("data-open", "true");
            this.els.modelSelect.setAttribute("aria-expanded", "true");
            this.els.modelSelectMenu.hidden = false;
            this.els.modelSelectTrigger.setAttribute("aria-expanded", "true");
            const path = this._findPathForModel(this._selectedModel);
            this._activePath = Array.isArray(path) ? path : [];
            this._sanitizeActivePath();
            this._renderModelColumns();
            if (this.els.modelSelectMenu) {
                this.els.modelSelectMenu.focus();
            }
        }

        _closeModelMenu() {
            if (!this.els.modelSelectMenu || !this.els.modelSelectTrigger) return;
            this._isModelMenuOpen = false;
            this.els.modelSelect.setAttribute("data-open", "false");
            this.els.modelSelect.setAttribute("aria-expanded", "false");
            this.els.modelSelectMenu.hidden = true;
            this.els.modelSelectTrigger.setAttribute("aria-expanded", "false");
        }

        _applyModelHierarchy(structure) {
            if (!structure || !structure.root || (!structure.root.children.length && !structure.root.models.length)) {
                this.modelHierarchy = null;
                this._modelNodeIndex = null;
                this.availableModels = [];
                this.options.models = [];
                this._selectedModel = null;
                this._activePath = [];
                this._setModelSelectorEmpty("No models");
                return;
            }

            this.modelHierarchy = structure;
            this._modelNodeIndex = structure.nodesById || new Map();
            this.availableModels = this._flattenModels(structure);
            this.options.models = this.availableModels.slice();
            if (Array.isArray(this.availableModels) && this.availableModels.length) {
                this.options.models = this.availableModels.slice();
            }

            if (!this.availableModels.length) {
                this._selectedModel = null;
                this._setModelSelectorEmpty("No models");
                return;
            }

            if (!this._selectedModel || !this.availableModels.includes(this._selectedModel)) {
                const activeChat = this._getActiveChat();
                if (activeChat && activeChat.model && this.availableModels.includes(activeChat.model)) {
                    this._selectedModel = activeChat.model;
                } else {
                    this._selectedModel = this.availableModels[0];
                }
            }

            const path = this._findPathForModel(this._selectedModel);
            this._activePath = Array.isArray(path) ? path : [];
            this.chats.forEach((chat) => {
                if (!chat.model || !this.availableModels.includes(chat.model)) {
                    chat.model = this._selectedModel;
                }
            });
            this._updateModelSelectorDisplay();
            this._renderModelColumns();
            this._renderChatList();
        }

        _getSelectedModel() {
            if (this._selectedModel) {
                return this._selectedModel;
            }
            if (Array.isArray(this.availableModels) && this.availableModels.length) {
                this._selectedModel = this.availableModels[0];
                return this._selectedModel;
            }
            const preset = Array.isArray(this.options.models) ? this.options.models : [];
            if (preset.length) {
                this._selectedModel = preset[0];
                return this._selectedModel;
            }
            const presetStructure = this._normalizeModelData(this._getModelConfigSource());
            if (presetStructure) {
                const flattened = this._flattenModels(presetStructure);
                if (flattened.length) {
                    this._selectedModel = flattened[0];
                    return this._selectedModel;
                }
            }
            return "default";
        }

        _updateSidebarToggleUi() {
            if (!this.els || !this.els.sidebarControls) {
                return;
            }
            const toggleButton = this.els.sidebarControls.querySelector("[data-action='toggle-sidebar']");
            if (!toggleButton) {
                return;
            }
            const iconEl = toggleButton.querySelector(".material-icons");
            const tooltipEl = toggleButton.querySelector(".tooltip");
            const toggleCfg = this._ui.sidebar.toggleSidebar || {};
            const icons = Object.assign({ expanded: "menu_open", collapsed: "menu" }, (toggleCfg.icons || {}));
            const tooltips = Object.assign({ expanded: "Collapse", collapsed: "Expand" }, (toggleCfg.tooltips || {}));
            const iconValue = this.sidebarCollapsed ? icons.collapsed : icons.expanded;
            const tooltipValue = this.sidebarCollapsed ? tooltips.collapsed : tooltips.expanded;
            if (iconEl) {
                iconEl.textContent = iconValue;
            }
            if (tooltipEl) {
                tooltipEl.textContent = tooltipValue;
            }
            toggleButton.setAttribute("aria-label", tooltipValue);
        }

        _handleArtifactResize(event) {
            if (!this.isArtifactResizing) return;
            const windowWidth = window.innerWidth;
            const newWidth = windowWidth - event.clientX;
            const minWidth = 300;
            const maxWidth = windowWidth * 0.7;
            if (newWidth >= minWidth && newWidth <= maxWidth) {
                const widthPercent = (newWidth / windowWidth) * 100;
                this.els.artifactPanel.style.width = `${widthPercent}%`;
                this.els.mainContent.style.marginRight = `${widthPercent}%`;
                this.artifactPanelWidth = `${widthPercent}%`;
            }
        }

        _stopArtifactResize() {
            if (!this.isArtifactResizing) return;
            this.isArtifactResizing = false;
            this.saveState();
            const handlers = EVENT_HANDLERS.get(this);
            if (handlers) {
                document.removeEventListener("mousemove", handlers.resizeHandler);
                document.removeEventListener("mouseup", handlers.stopResizeHandler);
            }
        }

        _processStreamingText(text, context = {}) {
            const artifacts = [];
            let processedText = text;
            let hasCompleteArtifacts = false;

            const fingerprint = (value) => {
                const input = value || "";
                let hash = 0;
                for (let idx = 0; idx < input.length; idx += 1) {
                    hash = (hash << 5) - hash + input.charCodeAt(idx);
                    hash |= 0;
                }
                return Math.abs(hash).toString(36);
            };

            const messageSeed = context.messageId || "";

            const ensureUniqueId = (proposedId, content, title) => {
                const base = proposedId || `artifact-${fingerprint(`${messageSeed}::${title || ""}::${content || ""}`)}`;
                let id = base;
                let counter = 1;
                while (artifacts.some((item) => item.id === id)) {
                    id = `${base}-${counter++}`;
                }
                return id;
            };

            const normalizeParams = (input) => {
                const params = {};
                if (!input) return params;
                const clean = input.replace(/\|/g, " ");
                const regex = /(\w+)=(["'])([^"']*)\2|(\w+)=([^\s]+)/g;
                let pair;
                while ((pair = regex.exec(clean)) !== null) {
                    const key = (pair[1] || pair[4] || "").toLowerCase();
                    const value = pair[3] || pair[5] || "";
                    if (key) params[key] = value;
                }
                return params;
            };

            const languageToMime = (language) => {
                switch ((language || "").toLowerCase()) {
                    case "html":
                    case "htm":
                        return "text/html";
                    case "jsx":
                    case "tsx":
                        return "application/vnd.react";
                    case "mermaid":
                        return "application/vnd.mermaid";
                    case "svg":
                        return "image/svg+xml";
                    case "python":
                    case "py":
                        return "text/x-python";
                    case "markdown":
                    case "md":
                        return "text/markdown";
                    case "json":
                        return "application/json";
                    default:
                        return null;
                }
            };

            const rendererToMime = (renderer) => {
                switch ((renderer || "").toLowerCase()) {
                    case "iframe":
                    case "html":
                        return "text/html";
                    case "mermaid":
                        return "application/vnd.mermaid";
                    default:
                        return null;
                }
            };

            const createArtifact = (params, content, fallbackTitle) => {
                const normalized = {};
                Object.keys(params || {}).forEach((key) => {
                    normalized[key.toLowerCase()] = params[key];
                });
                const languageMime = languageToMime(normalized.language);
                const rendererMime = rendererToMime(normalized.renderer);
                const artifact = {
                    id: ensureUniqueId(normalized.identifier, content, fallbackTitle),
                    type: normalized.type || languageMime || rendererMime || "text/plain",
                    title: normalized.title || fallbackTitle || "Untitled Artifact",
                    content: (content || "").trim(),
                };
                return artifact;
            };

            const injectIcon = (artifact) => {
                hasCompleteArtifacts = true;
                artifacts.push(artifact);
                return `\n\n<div class="artifact-icon" data-artifact-id="${artifact.id}"><span class="material-icons">code</span><span>${artifact.title}</span></div>\n\n`;
            };

            const newPattern = /:{3,4}artifact\{([^}]*)\}([\s\S]*?)(?:\s*:{3,4})/gi;
            processedText = processedText.replace(newPattern, (full, paramsStr, content) => {
                const params = normalizeParams(paramsStr);
                const artifact = createArtifact(params, content, params.title);
                return injectIcon(artifact);
            });

            let legacyMatched = false;
            const legacyPattern = /:::Artifact\s+([^\n|]+)([^\n]*)\n([\s\S]*?)(?:::Artifact|::::Artifact)\s*/gi;
            processedText = processedText.replace(legacyPattern, (full, titleSegment, paramSegment, content) => {
                legacyMatched = true;
                const params = normalizeParams(paramSegment);
                params.title = params.title || titleSegment.trim();
                const artifact = createArtifact(params, content, titleSegment.trim());
                return injectIcon(artifact);
            });

            const fourColonClassic = /::::Artifact\s+([^\n|]+)([^\n]*)\n([\s\S]*?)::::Artifact\s*/gi;
            processedText = processedText.replace(fourColonClassic, (full, titleSegment, paramSegment, content) => {
                legacyMatched = true;
                const params = normalizeParams(paramSegment);
                params.title = params.title || titleSegment.trim();
                const artifact = createArtifact(params, content, titleSegment.trim());
                return injectIcon(artifact);
            });

            processedText = processedText.replace(/(<div class="artifact-icon"[^>]*>[\s\S]*?<\/div>)\s*:/g, "$1");

            const hasNewStart = /:{3,4}artifact\{[^}]*\}/i.test(text);
            const hasLegacyStart = /:::Artifact\s+[^\n]+/i.test(text) || /::::Artifact\s+[^\n]+/i.test(text);
            const hasIncompleteArtifact = (hasNewStart && !hasCompleteArtifacts) || (hasLegacyStart && !legacyMatched);

            if (hasIncompleteArtifact) {
                const artifactStart = Math.max(
                    text.search(/:::artifact\{/i),
                    text.search(/:::Artifact\s+[^\n]+/i),
                );
                if (artifactStart >= 0) {
                    processedText = text.substring(0, artifactStart);
                }
            }

            return { processedText, artifacts, hasCompleteArtifacts, hasIncompleteArtifact };
        }

        _formatTimestamp(value) {
            if (!value) {
                return "";
            }
            let date;
            if (value instanceof Date) {
                date = value;
            } else if (typeof value === "number") {
                date = new Date(value);
            } else if (typeof value === "string") {
                const parsed = new Date(value);
                if (!Number.isNaN(parsed.getTime())) {
                    date = parsed;
                } else {
                    return value;
                }
            }
            if (!date || Number.isNaN(date.getTime())) {
                return "";
            }
            return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        }

        _renderMessageContent(message, element) {
            const contentEl = element.querySelector(".message-content");
            const nameEl = element.querySelector(".message-name");
            const timestampEl = element.querySelector(".message-timestamp");
            if (nameEl) {
                nameEl.textContent = message.role === "user" ? "You" : (message.name || (this.options.agent && this.options.agent.name) || "Assistant");
            }
            if (timestampEl) {
                const formatted = this._formatTimestamp(message.timestamp || (message.meta && message.meta.timestamp));
                if (formatted) {
                    timestampEl.textContent = formatted;
                    timestampEl.classList.remove("is-hidden");
                } else {
                    timestampEl.textContent = "";
                    timestampEl.classList.add("is-hidden");
                }
            }
            let displayText = message.content || "";
            let artifacts = [];
            if (message.role !== "user" && this.options.enableArtifacts && displayText) {
                if (displayText.includes("artifact-icon")) {
                    // Already processed HTML
                } else {
                    const result = this._processStreamingText(displayText, { messageId: message.id });
                    displayText = result.processedText;
                    artifacts = result.artifacts;
                    if (artifacts.length) {
                        const activeChat = this._getActiveChat();
                        if (activeChat) {
                            activeChat.artifacts = activeChat.artifacts || [];
                            artifacts.forEach((artifact) => {
                                const existing = activeChat.artifacts.find((item) => item.id === artifact.id);
                                if (!existing) {
                                    activeChat.artifacts.push(artifact);
                                    this._artifactMap.set(artifact.id, Object.assign({ chatId: activeChat.id, messageId: message.id }, artifact));
                                }
                            });
                        }
                    }
                }
            }
            if (displayText.includes("artifact-icon")) {
                const parts = displayText.split(/(<div class="artifact-icon"[^>]*>[\s\S]*?<\/div>)/);
                const renderedParts = parts.map((segment) => {
                    if (!segment) return "";
                    if (segment.includes("artifact-icon")) {
                        return segment;
                    }
                    if (!segment.trim()) {
                        return "";
                    }
                    const rendered = renderMarkdown(segment);
                    return rendered || escapeHtml(segment).replace(/\n/g, "<br>");
                });
                contentEl.innerHTML = renderedParts.join("") || displayText;
            } else if (displayText.trim()) {
                const html = renderMarkdown(displayText);
                contentEl.innerHTML = html || displayText.replace(/\n/g, "<br>");
            } else {
                contentEl.innerHTML = "";
            }

            const thinkingEl = element.querySelector(".message-thinking");
            if (thinkingEl) {
                const labelEl = thinkingEl.querySelector(".thinking-label");
                if (labelEl) {
                    const customLabel = message?.meta?.thinkingLabel;
                    labelEl.textContent = customLabel || "Thinking…";
                }
            }
            const hasRenderableContent = Boolean((displayText || "").trim());
            const showThinking = message.role !== "user" && Boolean(message.streaming) && !hasRenderableContent;
            element.classList.toggle("is-thinking", showThinking);
            if (thinkingEl) {
                thinkingEl.setAttribute("aria-hidden", showThinking ? "false" : "true");
            }
            const copyBtn = element.querySelector(".message-copy-btn");
            if (copyBtn) {
                copyBtn.setAttribute("tabindex", showThinking ? "-1" : "0");
            }
        }

        _createMessageElement(message) {
            const isAdvanced = this._layout.mode === "advanced";
            const wrapper = document.createElement("div");
            wrapper.className = `rag-message ${message.role === "user" ? "rag-user-message" : "rag-assistant-message"}`;
            wrapper.setAttribute("data-message-id", message.id);
            if (isAdvanced) {
                wrapper.classList.add("rag-advanced-message");
            }

            const header = document.createElement("div");
            header.className = "message-header";

            const nameSpan = document.createElement("span");
            nameSpan.className = "message-name";
            header.appendChild(nameSpan);

            const timestampSpan = document.createElement("span");
            timestampSpan.className = "message-timestamp is-hidden";
            header.appendChild(timestampSpan);

            const bubble = document.createElement("div");
            bubble.className = "message-bubble";
            const thinking = document.createElement("div");
            thinking.className = "message-thinking";
            thinking.setAttribute("role", "status");
            thinking.setAttribute("aria-hidden", "true");
            thinking.setAttribute("aria-live", "polite");
            thinking.innerHTML = '<span class="thinking-label">Thinking…</span><div class="thinking-dots"><span></span><span></span><span></span></div>';
            const content = document.createElement("div");
            content.className = "message-content";
            bubble.appendChild(thinking);
            bubble.appendChild(content);

            const tray = document.createElement("div");
            tray.className = "message-tray";
            const trayCopyBtn = document.createElement("button");
            trayCopyBtn.className = "message-copy-btn";
            trayCopyBtn.type = "button";
            trayCopyBtn.innerHTML = '<span class="material-icons">content_copy</span>';
            trayCopyBtn.setAttribute("data-message-id", message.id);
            trayCopyBtn.setAttribute("aria-label", "Copy message");
            trayCopyBtn.setAttribute("title", "Copy message");
            trayCopyBtn.addEventListener("click", (evt) => {
                evt.preventDefault();
                evt.stopPropagation();
                this.copyMessage(message.id);
            });
            tray.appendChild(trayCopyBtn);

            if (isAdvanced) {
                const body = document.createElement("div");
                body.className = "message-body";
                body.appendChild(header);
                body.appendChild(bubble);
                body.appendChild(tray);

                const avatarWrapper = document.createElement("div");
                avatarWrapper.className = "message-avatar";
                const avatarUrl = message.avatar || this._getAvatarForRole(message.role);
                if (avatarUrl) {
                    const img = document.createElement("img");
                    img.src = avatarUrl;
                    img.alt = (message.role === "user" ? this._userDisplayName : (this.options.agent && this.options.agent.name) || "Assistant");
                    avatarWrapper.appendChild(img);
                } else {
                    const label = (message.name || (message.role === "user" ? this._userDisplayName : (this.options.agent && this.options.agent.name) || "Assistant")) || "";
                    avatarWrapper.textContent = label.charAt(0).toUpperCase();
                }

                wrapper.appendChild(avatarWrapper);
                wrapper.appendChild(body);
            } else {
                wrapper.appendChild(header);
                wrapper.appendChild(bubble);
                wrapper.appendChild(tray);
            }
            return wrapper;
        }

        _renderMessages() {
            this.els.chatContainer.innerHTML = "";
            this._messageMap.clear();
            const activeChat = this._getActiveChat();
            if (!activeChat) return;
            activeChat.messages.forEach((message) => {
                const element = this._createMessageElement(message);
                this._renderMessageContent(message, element);
                this.els.chatContainer.appendChild(element);
                this._messageMap.set(message.id, { chatId: activeChat.id, element, message });
            });
            this._scrollToBottom();
        }

        _renderChatList() {
            this.els.chatList.innerHTML = "";
            const isCollapsed = this.sidebarCollapsed;
            this.chats.forEach((chat) => {
                const item = document.createElement("div");
                item.className = `rag-chat-item${chat.id === this.activeChatId ? " active" : ""}`;
                item.setAttribute("data-chat-id", chat.id);
                if (chat.title) {
                    item.setAttribute("title", chat.title);
                }
                const badgeValue = Number(chat.badge ?? (chat.meta && chat.meta.badge));
                const hasBadge = !Number.isNaN(badgeValue) && badgeValue > 0;
                const badgeLabel = hasBadge ? (badgeValue > 999 ? "999+" : String(badgeValue)) : null;
                if (isCollapsed) {
                    const initial = (chat.title || "Chat").charAt(0).toUpperCase();
                    item.setAttribute("data-initial", initial);
                    const tooltip = document.createElement("div");
                    tooltip.className = "tooltip";
                    tooltip.textContent = chat.title;
                    item.appendChild(tooltip);
                    if (hasBadge) {
                        const badge = document.createElement("span");
                        badge.className = "chat-badge";
                        badge.textContent = badgeLabel;
                        item.appendChild(badge);
                    }
                } else {
                    const titleSpan = document.createElement("span");
                    titleSpan.className = "chat-title";
                    titleSpan.textContent = chat.title;
                    const modelSpan = document.createElement("span");
                    modelSpan.className = "chat-model";
                    modelSpan.textContent = chat.model || "default";
                    const deleteBtn = document.createElement("button");
                    deleteBtn.className = "chat-delete-btn";
                    deleteBtn.setAttribute("data-chat-id", chat.id);
                    deleteBtn.innerHTML = '<span class="material-icons">close</span>';
                    deleteBtn.setAttribute("aria-label", "Delete chat");
                    item.appendChild(titleSpan);
                    if (hasBadge) {
                        const badge = document.createElement("span");
                        badge.className = "chat-badge";
                        badge.textContent = badgeLabel;
                        item.appendChild(badge);
                    }
                    item.appendChild(modelSpan);
                    item.appendChild(deleteBtn);
                }
                this.els.chatList.appendChild(item);
            });
        }

        _scrollToBottom() {
            window.requestAnimationFrame(() => {
                this.els.chatScroll.scrollTop = this.els.chatScroll.scrollHeight;
            });
        }

        _getActiveChat() {
            return this.chats.find((chat) => chat.id === this.activeChatId) || null;
        }

        _ensureActiveChat() {
            if (!this.activeChatId || !this._getActiveChat()) {
                if (!this.chats.length) {
                    this.startNewChat();
                } else {
                    this.activeChatId = this.chats[0].id;
                }
            }
            return this._getActiveChat();
        }

        _generateChatTitle() {
            return `Chat ${formatTime(new Date())}`;
        }

        // -----------------------------------------------------------------
        // Public-ish API consumed by ChatWidget
        // -----------------------------------------------------------------

        setMessages(messages) {
            const chat = this._ensureActiveChat();
            if (!chat) return;
            chat.messages = Array.from(messages || []).map((msg) => this._normalizeMessage(msg));
            chat.artifacts = [];
            chat.messages.forEach((msg) => {
                if (msg.content && msg.role !== "user") {
                    const parsed = this._processStreamingText(msg.content, { messageId: msg.id });
                    parsed.artifacts.forEach((artifact) => {
                        this._artifactMap.set(artifact.id, Object.assign({ chatId: chat.id, messageId: msg.id }, artifact));
                        chat.artifacts.push(artifact);
                    });
                }
            });
            this._renderMessages();
            this.saveState();
        }

        addMessage(message) {
            const chat = this._ensureActiveChat();
            if (!chat) return null;
            const normalized = this._normalizeMessage(message);
            chat.messages.push(normalized);
            const selectedModel = this._getSelectedModel();
            chat.model = selectedModel || chat.model || "default";
            const element = this._createMessageElement(normalized);
            this._renderMessageContent(normalized, element);
            this.els.chatContainer.appendChild(element);
            this._messageMap.set(normalized.id, { chatId: chat.id, element, message: normalized });
            this._scrollToBottom();
            this.saveState();
            return normalized.id;
        }

        updateMessage(messageId, updates) {
            const record = this._messageMap.get(messageId);
            if (!record) return;
            Object.assign(record.message, updates || {});
            this._renderMessageContent(record.message, record.element);
            this.saveState();
        }

        removeMessage(messageId) {
            const record = this._messageMap.get(messageId);
            if (!record) return;
            const chat = this.chats.find((item) => item.id === record.chatId);
            if (chat) {
                chat.messages = chat.messages.filter((msg) => msg.id !== messageId);
            }
            record.element.remove();
            this._messageMap.delete(messageId);
            this.saveState();
        }

        clearMessages() {
            const chat = this._getActiveChat();
            if (!chat) return;
            chat.messages = [];
            chat.artifacts = [];
            this._messageMap.clear();
            this._artifactMap.clear();
            this.els.chatContainer.innerHTML = "";
            this.closeArtifactPanel();
            this.saveState();
        }

        startStream(message) {
            const payload = this._normalizeMessage(Object.assign({}, message, { streaming: true }));
            const chat = this._ensureActiveChat();
            if (!chat) return payload.id;
            chat.messages.push(payload);
            const selectedModel = this._getSelectedModel();
            chat.model = selectedModel || chat.model || "default";
            const element = this._createMessageElement(payload);
            element.classList.add("streaming");
            this._renderMessageContent(payload, element);
            this.els.chatContainer.appendChild(element);
            this._messageMap.set(payload.id, { chatId: chat.id, element, message: payload });
            this._scrollToBottom();
            this.saveState();
            return payload.id;
        }

        appendStream(messageId, chunk) {
            const record = this._messageMap.get(messageId);
            if (!record) return;
            record.message.content = (record.message.content || "") + (chunk || "");
            record.message.streaming = true;
            this._renderMessageContent(record.message, record.element);
            this._scrollToBottom();
            this._handleArtifactStreaming(record.message);
            this.saveState();
        }

        finishStream(messageId, finalChunk) {
            const record = this._messageMap.get(messageId);
            if (!record) return;
            if (finalChunk) {
                record.message.content = (record.message.content || "") + finalChunk;
            }
            record.message.streaming = false;
            record.element.classList.remove("streaming");
            const finishedAt = new Date().toISOString();
            record.message.timestamp = finishedAt;
            record.message.meta = record.message.meta || {};
            record.message.meta.timestamp = finishedAt;
            this._renderMessageContent(record.message, record.element);
            this._handleArtifactStreaming(record.message, true);
            this.saveState();
        }

        setAgent(agent) {
            this.options.agent = Object.assign({}, this.options.agent || {}, agent || {});
            this.els.agentName.textContent = this.options.agent.name || "Assistant";
            this.els.agentSubtitle.textContent = this.options.agent.subtitle || "";
            if (this.options.agent && this.options.agent.avatar) {
                this._avatars.assistant = this.options.agent.avatar;
            }
        }

        setTheme(theme) {
            const normalized = this._normalizeThemeName(theme);
            if (!normalized) {
                const detected = this._detectHostTheme();
                if (detected) {
                    this._applyHostTheme(detected);
                }
                return;
            }
            const nextIsDark = normalized === "dark";
            const themeSetter = globalThis?.wapyt?.setTheme;
            this._setDarkMode(nextIsDark, { persist: false });
            try {
                if (typeof themeSetter === "function") {
                    themeSetter(normalized);
                } else if (document?.documentElement) {
                    document.documentElement.setAttribute("data-wapyt-theme", normalized);
                }
            } catch (error) {
                console.warn("[ChatWidget] Failed to propagate host theme", error);
            }
            this._setDarkMode(nextIsDark, { persist: true });
        }

        focusComposer() {
            this.els.queryInput.focus();
        }

        // -----------------------------------------------------------------
        // Chat operations
        // -----------------------------------------------------------------

        _normalizeMessage(message) {
            const id = message.id || createUniqueId("message");
            const meta = Object.assign({}, message.meta || {});
            const existingTimestamp = message.timestamp || meta.timestamp;
            const resolvedTimestamp = existingTimestamp || new Date().toISOString();
            if (!meta.timestamp) {
                meta.timestamp = resolvedTimestamp;
            }
            const role = (message.role || "assistant").toLowerCase();
            let resolvedName = message.name;
            if (!resolvedName) {
                if (role === "user") {
                    resolvedName = this._userDisplayName;
                } else {
                    resolvedName = (this.options.agent && this.options.agent.name) || "Assistant";
                }
            }
            const resolvedAvatar = message.avatar || this._getAvatarForRole(role);
            return {
                id,
                role,
                content: message.content || "",
                name: resolvedName,
                avatar: resolvedAvatar,
                timestamp: resolvedTimestamp,
                streaming: Boolean(message.streaming),
                meta,
            };
        }

        initChats() {
            if (!this.chats.length) {
                const chatId = createUniqueId("chat");
                const initialMessages = Array.isArray(this.options.messages) ? this.options.messages.map((msg) => this._normalizeMessage(msg)) : [];
                this.chats.push({
                    id: chatId,
                    title: this._generateChatTitle(),
                    messages: initialMessages,
                    artifacts: [],
                    model: this._getSelectedModel(),
                });
                this.activeChatId = chatId;
            } else if (!this.activeChatId || !this.chats.find((chat) => chat.id === this.activeChatId)) {
                this.activeChatId = this.chats[0].id;
            }
            this.chats.forEach((chat) => {
                chat.messages = (chat.messages || []).map((msg) => this._normalizeMessage(msg));
                chat.artifacts = chat.artifacts || [];
                if (chat.badge && Number(chat.badge) > 0) {
                    chat.badge = Math.min(999, Math.max(1, Number(chat.badge)));
                } else {
                    delete chat.badge;
                }
                chat.messages.forEach((msg) => {
                    if (msg.content && msg.role !== "user") {
                        const parsed = this._processStreamingText(msg.content, { messageId: msg.id });
                        parsed.artifacts.forEach((artifact) => {
                            this._artifactMap.set(artifact.id, Object.assign({ chatId: chat.id, messageId: msg.id }, artifact));
                            if (!chat.artifacts.some((item) => item.id === artifact.id)) {
                                chat.artifacts.push(artifact);
                            }
                        });
                    }
                });
            });
            this._renderChatList();
            this._renderMessages();
            this.switchToModelForActiveChat();
            if (this.els.sidebar) {
                this.els.sidebar.classList.toggle("collapsed", this.sidebarCollapsed);
            }
            if (this.els.container) {
                this.els.container.classList.toggle("sidebar-collapsed", this.sidebarCollapsed);
                if (this.isDarkMode) {
                    this.els.container.classList.add("rag-dark");
                }
            }
            this._updateSidebarToggleUi();
            this._applyLayoutMode();
        }

        startNewChat() {
            const newId = createUniqueId("chat");
            const newChat = {
                id: newId,
                title: this._generateChatTitle(),
                messages: [],
                artifacts: [],
                model: this._getSelectedModel(),
            };
            this.chats.push(newChat);
            this.activeChatId = newId;
            this._renderChatList();
            this._renderMessages();
            this.saveState();
        }

        switchChat(chatId) {
            if (!chatId || chatId === this.activeChatId) return;
            const exists = this.chats.some((chat) => chat.id === chatId);
            if (!exists) return;
            this.activeChatId = chatId;
            const current = this.chats.find((chat) => chat.id === chatId);
            if (current && current.badge) {
                delete current.badge;
            }
            this._closeModelMenu();
            this.closeArtifactPanel();
            this._renderChatList();
            this._renderMessages();
            this.switchToModelForActiveChat();
            this.saveState();
        }

        deleteChat(chatId) {
            const idx = this.chats.findIndex((chat) => chat.id === chatId);
            if (idx === -1) return;
            const confirmed = typeof window !== "undefined" ? window.confirm("Delete this chat?") : true;
            if (!confirmed) return;
            const removed = this.chats.splice(idx, 1);
            if (removed.length && removed[0].id === this.activeChatId) {
                this.closeArtifactPanel();
                if (this.chats.length) {
                    this.activeChatId = this.chats[0].id;
                } else {
                    this.startNewChat();
                    return;
                }
            }
            this._renderChatList();
            this._renderMessages();
            this.saveState();
        }

        clearAllChats() {
            const confirmed = typeof window !== "undefined" ? window.confirm("Delete all chats?") : true;
            if (!confirmed) return;
            this.chats = [];
            this.activeChatId = null;
            this.closeArtifactPanel();
            this.saveState();
            this.startNewChat();
        }

        toggleSidebar() {
            this.sidebarCollapsed = !this.sidebarCollapsed;
            if (this.els.sidebar) {
                this.els.sidebar.classList.toggle("collapsed", this.sidebarCollapsed);
            }
            if (this.els.container) {
                this.els.container.classList.toggle("sidebar-collapsed", this.sidebarCollapsed);
            }
            this._updateSidebarToggleUi();
            this._renderChatList();
            this.saveState();
        }

        setChatBadge(chatId, value) {
            const chat = this.chats.find((item) => item.id === chatId);
            if (!chat) return;
            const numeric = Number(value);
            if (Number.isNaN(numeric) || numeric <= 0) {
                delete chat.badge;
            } else {
                chat.badge = Math.min(999, Math.max(0, Math.floor(numeric)));
            }
            this._renderChatList();
            this.saveState();
        }

        toggleDarkMode() {
            const nextIsDark = !this.isDarkMode;
            const normalized = nextIsDark ? "dark" : "light";
            const themeSetter = globalThis?.wapyt?.setTheme;
            this._setDarkMode(nextIsDark, { persist: false });
            try {
                if (typeof themeSetter === "function") {
                    themeSetter(normalized);
                } else if (document?.documentElement) {
                    document.documentElement.setAttribute("data-wapyt-theme", normalized);
                }
            } catch (error) {
                console.warn("[ChatWidget] Failed to update host theme", error);
            }
            this._setDarkMode(nextIsDark, { persist: true });
        }

        switchToModelForActiveChat() {
            const chat = this._getActiveChat();
            if (!chat) return;
            const hasAvailable = Array.isArray(this.availableModels) && this.availableModels.includes(chat.model);
            const target = hasAvailable ? chat.model : this._getSelectedModel();
            if (target) {
                this._setSelectedModel(target, { updateActiveChat: false, updateChatList: false, persist: false });
            }
        }

        getChatSummaries() {
            return this.chats.map((chat) => ({
                id: chat.id,
                title: chat.title,
                badge: chat.badge || 0,
                model: chat.model || "default",
                isActive: chat.id === this.activeChatId,
            }));
        }

        getMessages(chatId) {
            const targetId = chatId || this.activeChatId;
            const chat = this.chats.find((item) => item.id === targetId);
            if (!chat) return [];
            return chat.messages.map((msg) => ({
                id: msg.id,
                role: msg.role,
                content: msg.content,
                name: msg.name,
                timestamp: msg.timestamp,
                meta: Object.assign({}, msg.meta || {}),
                streaming: Boolean(msg.streaming),
            }));
        }

        getActiveChatId() {
            return this.activeChatId;
        }

        updateChatTitle(query) {
            const chat = this._getActiveChat();
            if (!chat) return;
            if (chat.messages.length <= 1) {
                chat.title = query.substring(0, 30) + (query.length > 30 ? "..." : "");
                this._renderChatList();
                this.saveState();
            }
        }

        handleSubmit() {
            const query = this.els.queryInput.value.trim();
            if (!query) return;
            const activeChat = this._ensureActiveChat();
            if (!activeChat) return;

            const userMessage = {
                role: "user",
                content: query,
                name: this._userDisplayName,
                avatar: this._getAvatarForRole("user"),
            };

            if (this.options.autoAppendUserMessages) {
                this.addMessage(userMessage);
            }
            this.updateChatTitle(query);
            const selectedModel = this._getSelectedModel();
            if (selectedModel) {
                activeChat.model = selectedModel;
            }
            if (activeChat.badge) {
                delete activeChat.badge;
                this._renderChatList();
            }
            this.els.queryInput.value = "";
            this._adjustTextareaHeight();

            const sendResult = this.host.emit("send", {
                id: createUniqueId("prompt"),
                text: query,
                message: userMessage,
            });

            if (!sendResult || !sendResult.handled) {
                this.streamMockResponse();
            }
            this.saveState();
        }

        async loadModels() {
            const presetStructure = this._normalizeModelData(this._getModelConfigSource());
            if (presetStructure) {
                this._applyModelHierarchy(presetStructure);
                this.switchToModelForActiveChat();
                return;
            }

            try {
                const response = await fetch("/v1/models");
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const data = await response.json();
                const models = Array.isArray(data?.data) ? data.data : [];
                const ids = models
                    .map((model) => (typeof model === "string" ? model : model?.id))
                    .filter((id) => typeof id === "string" && id.trim());

                const structure = this._normalizeModelData(ids);
                if (structure) {
                    this._applyModelHierarchy(structure);
                } else {
                    this.availableModels = ids;
                    if (this.availableModels.length) {
                        this._selectedModel = this.availableModels[0];
                        this._updateModelSelectorDisplay();
                    } else {
                        this._setModelSelectorEmpty("No models");
                    }
                }
            } catch (error) {
                console.warn("[ChatWidget] Failed to load models", error);
                this.availableModels = [];
                this._selectedModel = null;
                this._setModelSelectorEmpty("No models");
            } finally {
                this.switchToModelForActiveChat();
            }
        }

        // -----------------------------------------------------------------
        // Artifact handling
        // -----------------------------------------------------------------

        showArtifact(artifactId) {
            const artifact = this._artifactMap.get(artifactId);
            if (!artifact) return;
            this.currentArtifact = artifact;
            this.els.artifactTitle.textContent = artifact.title;
            this.els.artifactCodeContent.textContent = artifact.content;
            const lang = this.getLanguageFromType(artifact.type);
            this.els.artifactCodeContent.className = `language-${lang}`;
            if (typeof Prism !== "undefined") {
                try {
                    Prism.highlightElement(this.els.artifactCodeContent);
                } catch (error) {
                    console.warn("[ChatWidget] Prism highlight failed", error);
                }
            }
            this.els.artifactPanel.classList.add("visible");
            this.els.mainContent.classList.add("with-artifact");
            if (this.artifactPanelWidth) {
                this.els.artifactPanel.style.width = this.artifactPanelWidth;
                this.els.mainContent.style.marginRight = this.artifactPanelWidth;
            }
            this.switchArtifactTab("preview");
            this.updateArtifactPreview();
        }

        updateArtifactPreview() {
            if (!this.currentArtifact) return;
            const iframe = this.els.artifactIframe;
            const type = (this.currentArtifact.type || "").toLowerCase();
            if (type === "text/html") {
                const blob = new Blob([this.currentArtifact.content], { type: "text/html" });
                iframe.src = URL.createObjectURL(blob);
                return;
            }
            if (type === "image/svg+xml") {
                const svgContent = `<!DOCTYPE html><html><body style=\"margin:0;padding:20px;display:flex;justify-content:center;align-items:center;min-height:100vh;\">${this.currentArtifact.content}</body></html>`;
                const blob = new Blob([svgContent], { type: "text/html" });
                iframe.src = URL.createObjectURL(blob);
                return;
            }
            if (type === "text/x-python" || type === "application/x-python" || type === "application/python" || type === "text/python") {
                this._loadPythonArtifactPreview(this.currentArtifact.content);
                return;
            }
            iframe.src = "data:text/html,<body style='padding:20px;font-family:monospace;'>Preview not available for this file type</body>";
        }

        _loadPythonArtifactPreview(source) {
            const iframe = this.els.artifactIframe;
            const baseHtmlStart = `<!DOCTYPE html><html><head><style>
                body{background:#0f172a;color:#e2e8f0;font-family:Inter, sans-serif;margin:0;padding:24px;}
                h3{margin-top:0;margin-bottom:12px;}
                pre{background:rgba(15,23,42,0.65);padding:16px;border-radius:8px;white-space:pre-wrap;word-break:break-word;font-size:14px;color:#f1f5f9;}
            </style></head><body>`;
            const baseHtmlEnd = "</body></html>";

            const showHtml = (body) => {
                const blob = new Blob([baseHtmlStart + body + baseHtmlEnd], { type: "text/html" });
                iframe.src = URL.createObjectURL(blob);
            };

            showHtml("<h3>Python Execution Output</h3><pre>Running...</pre>");

            const encodedSource = encodeBase64Utf8(source || "");

            ensurePyodide().then((pyodide) => {
                try {
                    if (!pyodide.__wapytHelperInstalled) {
                        pyodide.runPython(`
import base64, io, sys, textwrap

def _wapyt_run_py_artifact(code_b64: str) -> str:
    code = base64.b64decode(code_b64).decode("utf-8")
    buffer = io.StringIO()
    old_stdout = sys.stdout
    sys.stdout = buffer
    try:
        exec(textwrap.dedent(code), {})
    finally:
        sys.stdout = old_stdout
    return buffer.getvalue()
                        `);
                        pyodide.__wapytHelperInstalled = true;
                    }
                    const renderedResult = pyodide.runPython(`_wapyt_run_py_artifact("${encodedSource}")`);
                    const withoutAnsi = (renderedResult || "").replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");
                    const normalized = withoutAnsi.replace(/\r/g, "\n");
                    const hasVisible = /[\S]/.test(normalized);
                    const displayResult = hasVisible ? normalized : (withoutAnsi.length ? normalized : "(no output)");
                    showHtml(`<h3>Python Execution Output</h3><pre>${escapeHtml(String(displayResult))}</pre>`);
                } catch (executionError) {
                    showHtml(`<h3>Python Execution Output</h3><pre style="color:#fca5a5;">${escapeHtml(String(executionError))}</pre>`);
                }
            }).catch((error) => {
                showHtml(`<h3>Python Execution Output</h3><pre style="color:#fca5a5;">${escapeHtml(String(error))}</pre>`);
            });
        }

        switchArtifactTab(tab) {
            const codeTab = this.els.artifactTabCode;
            const previewTab = this.els.artifactTabPreview;
            const codePanel = this.els.artifactCode;
            const previewPanel = this.els.artifactPreview;
            codeTab.classList.remove("active");
            previewTab.classList.remove("active");
            codePanel.classList.remove("visible");
            previewPanel.classList.remove("visible");
            if (tab === "code") {
                codeTab.classList.add("active");
                codePanel.classList.add("visible");
            } else {
                previewTab.classList.add("active");
                previewPanel.classList.add("visible");
                this.updateArtifactPreview();
            }
        }

        copyArtifactCode(event) {
            if (!this.currentArtifact) return;
            navigator.clipboard.writeText(this.currentArtifact.content).then(() => {
                const btn = event.currentTarget;
                const original = btn.textContent;
                btn.textContent = "Copied!";
                setTimeout(() => { btn.textContent = original; }, 2000);
            });
            this.host.emit("artifact:save", { artifactId: this.currentArtifact.id, artifact: this.currentArtifact, action: "copy" });
        }

        downloadArtifact() {
            if (!this.currentArtifact) return;
            const extension = this.getFileExtension(this.currentArtifact.type);
            const filename = `${this.currentArtifact.id}.${extension}`;
            const blob = new Blob([this.currentArtifact.content], { type: this.currentArtifact.type });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = filename;
            document.body.appendChild(anchor);
            anchor.click();
            document.body.removeChild(anchor);
            URL.revokeObjectURL(url);
            this.host.emit("artifact:save", { artifactId: this.currentArtifact.id, artifact: this.currentArtifact, action: "download" });
        }

        getFileExtension(type) {
            const map = {
                "text/html": "html",
                "application/vnd.react": "jsx",
                "application/vnd.mermaid": "mmd",
                "image/svg+xml": "svg",
            };
            return map[type] || "txt";
        }

        getLanguageFromType(type) {
            const typeMap = {
                "text/html": "html",
                "application/vnd.react": "jsx",
                "application/vnd.mermaid": "mermaid",
                "image/svg+xml": "svg",
            };
            return typeMap[type] || "markup";
        }

        closeArtifactPanel() {
            this.els.artifactPanel.classList.remove("visible");
            this.els.artifactPanel.style.width = "";
            this.els.mainContent.classList.remove("with-artifact");
            this.els.mainContent.style.width = "";
            this.els.mainContent.style.marginRight = "";
            if (this.els.artifactIframe) {
                this.els.artifactIframe.src = "about:blank";
            }
            if (this.els.artifactCodeContent) {
                this.els.artifactCodeContent.textContent = "";
                this.els.artifactCodeContent.className = "";
            }
            this.currentArtifact = null;
            this.streamContext = {
                target: null,
                messageId: null,
                buffer: "",
                isRedirecting: false,
                completedMessageId: null,
                messageArtifactCount: 0,
            };
        }

        _handleArtifactStreaming(message, isFinal = false) {
            if (!this.options.enableArtifacts) return;
            if (!message || message.role === "user") return;
            const text = message.content || "";
            if (!text) return;
            if (!this.streamContext.isRedirecting && this.streamContext.completedMessageId === message.id) {
                const previousBuffer = this.streamContext.buffer || "";
                const startIndex = previousBuffer.length > text.length ? text.length : previousBuffer.length;
                const newSegment = text.substring(startIndex);
                if (!/:::artifact\{|:::Artifact\s+[^\n]+/i.test(newSegment)) {
                    return;
                }
            }
            if (!this.streamContext.isRedirecting && this.shouldRedirectToArtifact(text)) {
                this.streamContext.isRedirecting = true;
                this.streamContext.messageId = message.id;
                this.streamContext.buffer = text;
                this.streamContext.target = this.els.artifactCodeContent;
                this.streamContext.completedMessageId = null;
                this.streamContext.messageArtifactCount = 0;
                this.els.artifactPanel.classList.add("visible");
                this.els.mainContent.classList.add("with-artifact");
                if (this.artifactPanelWidth) {
                    this.els.artifactPanel.style.width = this.artifactPanelWidth;
                    this.els.mainContent.style.marginRight = this.artifactPanelWidth;
                }
                this.els.artifactTitle.textContent = "Streaming Artifact...";
                this.switchArtifactTab("code");
            }
            if (this.streamContext.isRedirecting) {
                this.streamContext.buffer = text;
                const lower = text.toLowerCase();
                const modernMatch = /:::artifact\{[^}]*\}/i.exec(text);
                const legacyMatch = /:::Artifact\s+([^\n]+)([^\n]*)\n/i.exec(text);
                if (modernMatch) {
                    const headerEnd = modernMatch.index + modernMatch[0].length;
                    const closeIndex = lower.indexOf(":::", headerEnd);
                    if (closeIndex !== -1) {
                        const artifactContent = text.substring(headerEnd, closeIndex);
                        this.streamContext.target.textContent = artifactContent;
                        this._finalizeStreamingArtifact(message, text);
                    } else {
                        const partial = text.substring(headerEnd);
                        this.streamContext.target.textContent = partial;
                    }
                } else if (legacyMatch) {
                    const headerEnd = legacyMatch.index + legacyMatch[0].length;
                    const closeIndex = lower.indexOf(":::artifact", headerEnd);
                    if (closeIndex !== -1) {
                        const artifactContent = text.substring(headerEnd, closeIndex);
                        this.streamContext.target.textContent = artifactContent;
                        this._finalizeStreamingArtifact(message, text);
                    } else {
                        const partial = text.substring(headerEnd);
                        this.streamContext.target.textContent = partial;
                    }
                }
            }
            if (isFinal) {
                this.streamContext.isRedirecting = false;
                this.streamContext.target = null;
            }
        }

        _finalizeStreamingArtifact(message, text) {
            const parsed = this._processStreamingText(text, { messageId: message.id });
            if (!parsed.artifacts.length) {
                return;
            }
            const chat = this._getActiveChat();
            parsed.artifacts.forEach((artifact) => {
                if (chat) {
                    chat.artifacts = chat.artifacts || [];
                    const exists = chat.artifacts.some((item) => item.id === artifact.id);
                    if (!exists) {
                        chat.artifacts.push(artifact);
                    }
                }
                this._artifactMap.set(artifact.id, Object.assign({ chatId: chat ? chat.id : null, messageId: message.id }, artifact));
            });

            const artifact = parsed.artifacts[parsed.artifacts.length - 1];
            this.currentArtifact = Object.assign({}, artifact, { messageId: message.id });
            this.els.artifactTitle.textContent = artifact.title;
            this.els.artifactCodeContent.textContent = artifact.content;
            const lang = this.getLanguageFromType(artifact.type);
            this.els.artifactCodeContent.className = `language-${lang}`;
            if (typeof Prism !== "undefined") {
                try {
                    Prism.highlightElement(this.els.artifactCodeContent);
                } catch (error) {
                    console.warn("[ChatWidget] Prism highlight failed", error);
                }
            }
            this.switchArtifactTab("preview");
            this.updateArtifactPreview();
            this.streamContext.completedMessageId = message.id;
            this.streamContext.buffer = text;
            this.streamContext.messageArtifactCount = parsed.artifacts.length;
            this.streamContext.messageId = message.id;
            this.streamContext.isRedirecting = false;
            this.streamContext.target = null;
        }

        shouldRedirectToArtifact(text) {
            if (this.streamContext.isRedirecting) {
                return false;
            }
            if (!text) return false;
            const hasModernMarker = /:::artifact\{/i.test(text);
            const hasLegacyMarker = /:::Artifact\s+[^\n]+/i.test(text);
            return hasModernMarker || hasLegacyMarker;
        }

        copyMessage(messageId) {
            const record = this._messageMap.get(messageId);
            if (!record) return;
            const text = record.message.content || "";
            const attemptClipboard = () => navigator.clipboard.writeText(text);
            if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
                attemptClipboard().catch(() => {
                    this._legacyCopy(text);
                });
            } else {
                this._legacyCopy(text);
            }
            this.host.emit("copy", { id: messageId, message: record.message });
        }

        _legacyCopy(text) {
            try {
                const textarea = document.createElement("textarea");
                textarea.value = text;
                textarea.setAttribute("readonly", "readonly");
                textarea.style.position = "fixed";
                textarea.style.opacity = "0";
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand("copy");
                document.body.removeChild(textarea);
            } catch (error) {
                console.warn("[ChatWidget] Fallback copy failed", error);
            }
        }

        // -----------------------------------------------------------------
        // Demo streaming helpers
        // -----------------------------------------------------------------

        streamMockResponse() {
            const assistantId = this.startStream({ role: "assistant", content: "", streaming: true });
            const response = this.options.demoResponse || DEFAULT_DEMO_RESPONSE;
            let index = 0;
            const step = () => {
                if (index >= response.length) {
                    this.finishStream(assistantId);
                    return;
                }
                const chunk = response.slice(index, index + 8);
                index += 8;
                this.appendStream(assistantId, chunk);
                window.setTimeout(step, 20);
            };
            step();
        }
    }

    class ChatWidget extends EventBus {
        constructor(target, options = {}) {
            super();
            this.options = options || {};
            injectStyles();
            this._initializeLayout(target);
            this._renderHost();

            this._pendingSetMessages = null;
            this._pendingAdds = [];
            this._pendingUpdates = [];
            this._pendingRemovals = [];
            this._pendingClear = false;
            this._pendingStartStreams = [];
            this._pendingAppendStreams = [];
            this._pendingFinishStreams = [];
            this._pendingTheme = null;
            this._pendingAgent = null;
            this._pendingFocus = false;
            this._pendingBadgeUpdates = [];

            this._readyPromise = this._ensureDomReady().then(() => {
                const mount = document.getElementById(this._mountDomId);
                if (!mount) throw new Error("ChatWidget mount element missing");
                this._app = new WapytChatApp(mount, this.options, this);
                this._flushPendingOperations();
            });
        }

        _initializeLayout(target) {
            if (target && typeof target.attachHTML === "function") {
                this._hostContainerId = createUniqueId("chat-host");
                target.attachHTML(`<div class="chat-widget-host" id="${this._hostContainerId}" style="width:100%;height:100%;"></div>`);
                this._hostElement = document.getElementById(this._hostContainerId);
            } else if (typeof target === "string") {
                this._hostElement = document.querySelector(target);
            } else if (target && target.nodeType === 1) {
                this._hostElement = target;
            } else if (target) {
                this._hostElement = target;
            }

            if (!this._hostElement) {
                throw new Error("Unable to mount ChatWidget – target not found.");
            }
            this._hostElement.classList.add("chat-widget-host");
        }

        _renderHost() {
            if (!this._hostElement) {
                throw new Error("ChatWidget host element missing");
            }
            this._mountDomId = createUniqueId("chat-root");
            this._hostElement.innerHTML = `<div id="${this._mountDomId}" style="width:100%;height:100%;"></div>`;
        }

        _ensureDomReady() {
            return new Promise((resolve) => {
                const check = () => {
                    if (document.getElementById(this._mountDomId)) {
                        resolve();
                        return;
                    }
                    requestAnimationFrame(check);
                };
                check();
            });
        }

        _flushPendingOperations() {
            if (!this._app) return;
            if (this._pendingSetMessages) {
                this._app.setMessages(this._pendingSetMessages);
                this._pendingSetMessages = null;
            }
            if (this._pendingClear) {
                this._app.clearMessages();
                this._pendingClear = false;
            }
            this._pendingAdds.forEach((message) => this._app.addMessage(message));
            this._pendingAdds.length = 0;
            this._pendingUpdates.forEach(({ id, updates }) => this._app.updateMessage(id, updates));
            this._pendingUpdates.length = 0;
            this._pendingRemovals.forEach((id) => this._app.removeMessage(id));
            this._pendingRemovals.length = 0;
            this._pendingStartStreams.forEach((message) => this._app.startStream(message));
            this._pendingStartStreams.length = 0;
            this._pendingAppendStreams.forEach(({ id, chunk }) => this._app.appendStream(id, chunk));
            this._pendingAppendStreams.length = 0;
            this._pendingFinishStreams.forEach(({ id, chunk }) => this._app.finishStream(id, chunk));
            this._pendingFinishStreams.length = 0;
            if (this._pendingAgent) {
                this._app.setAgent(this._pendingAgent);
                this._pendingAgent = null;
            }
            if (this._pendingTheme) {
                this._app.setTheme(this._pendingTheme);
                this._pendingTheme = null;
            }
            if (this._pendingFocus) {
                this._app.focusComposer();
                this._pendingFocus = false;
            }
            if (this._pendingBadgeUpdates.length) {
                this._pendingBadgeUpdates.forEach(({ id, badge }) => this._app.setChatBadge(id, badge));
                this._pendingBadgeUpdates.length = 0;
            }
        }

        setMessages(messages) {
            if (this._app) {
                this._app.setMessages(messages);
            } else {
                this._pendingSetMessages = Array.isArray(messages) ? messages.map((msg) => Object.assign({}, msg)) : [];
            }
        }

        addMessage(message) {
            if (!message) return null;
            if (this._app) {
                return this._app.addMessage(message);
            }
            const clone = Object.assign({}, message);
            if (!clone.id) {
                clone.id = createUniqueId("message");
            }
            this._pendingAdds.push(clone);
            return clone.id;
        }

        updateMessage(messageId, updates) {
            if (this._app) {
                this._app.updateMessage(messageId, updates);
            } else {
                this._pendingUpdates.push({ id: messageId, updates: Object.assign({}, updates) });
            }
        }

        removeMessage(messageId) {
            if (this._app) {
                this._app.removeMessage(messageId);
            } else {
                this._pendingRemovals.push(messageId);
            }
        }

        clearMessages() {
            if (this._app) {
                this._app.clearMessages();
            } else {
                this._pendingClear = true;
                this._pendingAdds.length = 0;
                this._pendingUpdates.length = 0;
                this._pendingRemovals.length = 0;
                this._pendingStartStreams.length = 0;
                this._pendingAppendStreams.length = 0;
                this._pendingFinishStreams.length = 0;
            }
        }

        startStream(message) {
            if (!message) return null;
            if (this._app) {
                return this._app.startStream(message);
            }
            const clone = Object.assign({}, message);
            if (!clone.id) {
                clone.id = createUniqueId("message");
            }
            if (!clone.streaming) {
                clone.streaming = true;
            }
            this._pendingStartStreams.push(clone);
            return clone.id;
        }

        appendStream(messageId, chunk) {
            if (this._app) {
                this._app.appendStream(messageId, chunk);
            } else {
                this._pendingAppendStreams.push({ id: messageId, chunk });
            }
        }

        finishStream(messageId, finalChunk) {
            if (this._app) {
                this._app.finishStream(messageId, finalChunk);
            } else {
                this._pendingFinishStreams.push({ id: messageId, chunk: finalChunk });
            }
        }

        setAgent(agent) {
            if (this._app) {
                this._app.setAgent(agent);
            } else {
                this._pendingAgent = Object.assign({}, agent);
            }
        }

        setTheme(theme) {
            if (this._app) {
                this._app.setTheme(theme);
            } else {
                this._pendingTheme = theme;
            }
        }

        focusComposer() {
            if (this._app) {
                this._app.focusComposer();
            } else {
                this._pendingFocus = true;
            }
        }

        setChatBadge(chatId, badge) {
            if (!chatId) return;
            if (this._app) {
                this._app.setChatBadge(chatId, badge);
            } else {
                this._pendingBadgeUpdates.push({ id: chatId, badge });
            }
        }

        getChats() {
            if (!this._app) {
                return [];
            }
            return this._app.getChatSummaries();
        }

        getMessages(chatId) {
            if (!this._app) {
                return [];
            }
            return this._app.getMessages(chatId);
        }

        getActiveChatId() {
            if (!this._app) {
                return null;
            }
            return this._app.getActiveChatId();
        }

        destroy() {
            if (this._app) {
                this._app.destroy();
            }
            if (this._hostElement) {
                this._hostElement.innerHTML = "";
            }
        }
    }

    //globalThis.wapyt = globalThis.wapyt || {};
    globalThis.wapyt.ChatWidget = ChatWidget;
    globalThis.wapyt.Chat = ChatWidget;
}());
