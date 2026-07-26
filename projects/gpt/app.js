(function () {
  "use strict";

  const STORAGE_KEY = "gpt_console_chats_v1";
  const ACTIVE_KEY = "gpt_console_active_v1";
  const TOKEN_KEY = "gpt_console_token_v1";
  const MODEL_KEY = "gpt_console_model_v1";
  const SIDEBAR_KEY = "gpt_console_sidebar_collapsed_v1";
  const ASSET_VERSION = "20260619-code1";
  const MAX_CHARS = 1000;
  const MAX_IMAGES = 4;
  const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

  const $ = (id) => document.getElementById(id);
  const els = {
    loginScreen: $("loginScreen"),
    loginForm: $("loginForm"),
    loginError: $("loginError"),
    tokenInput: $("tokenInput"),
    requestsLeft: $("requestsLeft"),
    logoutBtn: $("logoutBtn"),
    newChatBtn: $("newChatBtn"),
    chatSearch: $("chatSearch"),
    chatList: $("chatList"),
    chatTitle: $("chatTitle"),
    chatTitleBtn: $("chatTitleBtn"),
    deleteChatBtn: $("deleteChatBtn"),
    sidebarCollapseBtn: $("sidebarCollapseBtn"),
    modelSelect: $("modelSelect"),
    connectionStatus: $("connectionStatus"),
    messages: $("messages"),
    promptInput: $("promptInput"),
    charCount: $("charCount"),
    sendBtn: $("sendBtn"),
    attachBtn: $("attachBtn"),
    fileInput: $("fileInput"),
    attachments: $("attachments"),
    dropZone: $("dropZone"),
    toast: $("toast"),
    sidebar: $("sidebar"),
    sidebarToggle: $("sidebarToggle")
  };

  const state = {
    token: localStorage.getItem(TOKEN_KEY) || "",
    chats: loadChats(),
    activeId: localStorage.getItem(ACTIVE_KEY) || "",
    selectedModel: localStorage.getItem(MODEL_KEY) || "gpt-4o",
    sidebarCollapsed: localStorage.getItem(SIDEBAR_KEY) === "1",
    pendingImages: [],
    busy: false,
    quota: null,
    reveals: {},
    revealTimers: {}
  };

  function loadChats() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(parsed) ? parsed.map(normalizeChat) : [];
    } catch (_) {
      return [];
    }
  }

  function normalizeChat(chat) {
    return {
      id: chat.id || uid(),
      title: chat.title || "New chat",
      createdAt: chat.createdAt || new Date().toISOString(),
      updatedAt: chat.updatedAt || chat.createdAt || new Date().toISOString(),
      messages: Array.isArray(chat.messages) ? chat.messages.map((message) => ({
        id: message.id || uid(),
        role: message.role === "assistant" ? "assistant" : "user",
        content: message.content || "",
        images: Array.isArray(message.images) ? message.images : [],
        model: message.model || "",
        createdAt: message.createdAt || chat.updatedAt || new Date().toISOString()
      })) : []
    };
  }

  function saveChats() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.chats));
    localStorage.setItem(ACTIVE_KEY, state.activeId);
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
  }

  function activeChat() {
    let chat = state.chats.find((item) => item.id === state.activeId);
    if (!chat) {
      chat = createChat(false);
    }
    return chat;
  }

  function createChat(renderNow = true) {
    const chat = {
      id: uid(),
      title: "New chat",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: []
    };
    state.chats.unshift(chat);
    state.activeId = chat.id;
    saveChats();
    if (renderNow) render();
    return chat;
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => els.toast.classList.remove("show"), 3200);
  }

  function setConnection(online) {
    els.connectionStatus.classList.toggle("online", online);
    els.connectionStatus.lastChild.nodeValue = online ? "Connected" : "Disconnected";
  }

  function applySidebarState() {
    document.body.classList.toggle("sidebar-collapsed", state.sidebarCollapsed);
    els.sidebarCollapseBtn.title = state.sidebarCollapsed ? "Expand menu" : "Collapse menu";
    els.sidebarCollapseBtn.setAttribute("aria-label", state.sidebarCollapsed ? "Expand menu" : "Collapse menu");
  }

  function toggleSidebar() {
    if (window.matchMedia("(max-width: 860px)").matches) {
      els.sidebar.classList.toggle("open");
      return;
    }
    state.sidebarCollapsed = !state.sidebarCollapsed;
    localStorage.setItem(SIDEBAR_KEY, state.sidebarCollapsed ? "1" : "0");
    applySidebarState();
  }

  async function apiPost(url, payload) {
    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    } catch (_) {
      throw new Error("Lost connection!");
    }

    let data = null;
    try {
      data = await response.json();
    } catch (_) {
      throw new Error("Unexpected server response.");
    }

    if (!response.ok || !data.ok) {
      throw new Error(data.error || "Request failed.");
    }
    return data;
  }

  async function refreshQuota(silent = false) {
    if (!state.token) return false;
    try {
      const data = await apiPost("quota.php", { token: state.token });
      state.quota = data.requests_left;
      els.requestsLeft.textContent = String(data.requests_left);
      setConnection(true);
      return true;
    } catch (error) {
      state.quota = null;
      els.requestsLeft.textContent = "--";
      setConnection(false);
      if (!silent) showToast(error.message);
      return false;
    }
  }

  function formatDate(value) {
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(value));
  }

  function formatTime(value) {
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(value || Date.now()));
  }

  function chatBucket(value) {
    const now = new Date();
    const date = new Date(value);
    const startNow = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const ageDays = Math.floor((startNow - startDate) / 86400000);
    if (ageDays <= 0) return "Today";
    if (ageDays === 1) return "Yesterday";
    if (ageDays < 7) return "Previous 7 days";
    return "Older";
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function safeImageSrc(value) {
    const src = String(value || "");
    return /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(src) ? src : "";
  }

  function asset(name) {
    return `${name}.svg?v=${ASSET_VERSION}`;
  }

  function normalizeLanguage(language) {
    const value = String(language || "").trim().toLowerCase();
    const aliases = {
      js: "javascript",
      jsx: "javascript",
      ts: "typescript",
      tsx: "typescript",
      py: "python",
      sh: "bash",
      shell: "bash",
      zsh: "bash",
      html: "html",
      xml: "html",
      php: "php",
      css: "css",
      scss: "css",
      json: "json",
      sql: "sql"
    };
    return aliases[value] || value || "text";
  }

  function syntaxClass(token) {
    return `<span class="tok-${token.type}">${token.value}</span>`;
  }

  function highlightCode(code, language) {
    const lang = normalizeLanguage(language);
    const source = String(code || "");
    const keywordSets = {
      javascript: /\b(async|await|break|case|catch|class|const|continue|default|else|export|extends|finally|for|from|function|if|import|in|let|new|null|return|switch|this|throw|try|typeof|undefined|var|void|while|yield|true|false)\b/g,
      typescript: /\b(abstract|any|as|async|await|boolean|break|case|catch|class|const|continue|default|else|enum|export|extends|finally|for|from|function|if|implements|import|in|interface|let|namespace|new|null|number|private|protected|public|readonly|return|string|switch|this|throw|try|type|typeof|undefined|var|void|while|yield|true|false)\b/g,
      python: /\b(and|as|assert|break|class|continue|def|del|elif|else|except|False|finally|for|from|global|if|import|in|is|lambda|None|nonlocal|not|or|pass|raise|return|True|try|while|with|yield)\b/g,
      php: /\b(abstract|and|array|as|break|case|catch|class|const|continue|declare|default|echo|else|elseif|extends|false|final|finally|for|foreach|function|global|if|implements|interface|namespace|new|null|or|private|protected|public|return|static|string|switch|throw|trait|true|try|use|var|while)\b/g,
      css: /\b(display|position|absolute|relative|fixed|sticky|flex|grid|block|inline|none|border|background|color|font|padding|margin|width|height|min|max|transform|transition|animation|content|var)\b/g,
      sql: /\b(SELECT|FROM|WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|INSERT|INTO|UPDATE|DELETE|CREATE|ALTER|DROP|TABLE|INDEX|VIEW|VALUES|SET|GROUP|ORDER|BY|HAVING|LIMIT|OFFSET|AND|OR|NOT|NULL|IS|AS|ON|DISTINCT|COUNT|SUM|AVG|MIN|MAX)\b/gi,
      bash: /\b(if|then|else|elif|fi|for|in|do|done|case|esac|while|function|export|local|return|echo|cd|mkdir|touch|cat|grep|rg|sed|awk|curl|ssh|git|npm|node|php|python|python3)\b/g
    };

    if (lang === "json") {
      return escapeHtml(source)
        .replace(/(&quot;[^&]*?&quot;)(\s*:)?/g, (_, key, colon) => colon ? `<span class="tok-key">${key}</span>${colon}` : `<span class="tok-string">${key}</span>`)
        .replace(/\b(true|false|null)\b/g, '<span class="tok-keyword">$1</span>')
        .replace(/\b(-?\d+(?:\.\d+)?)\b/g, '<span class="tok-number">$1</span>');
    }

    const patterns = [
      { type: "comment", regex: lang === "html" ? /<!--[\s\S]*?-->/g : lang === "css" ? /\/\*[\s\S]*?\*\//g : lang === "python" || lang === "bash" ? /#.*/g : /\/\*[\s\S]*?\*\/|\/\/.*/g },
      { type: "string", regex: /&quot;(?:\\[\s\S]|(?!&quot;)[\s\S])*?&quot;|&#039;(?:\\[\s\S]|(?!&#039;)[\s\S])*?&#039;|`(?:\\[\s\S]|[^\\`])*`/g },
      { type: "number", regex: /\b-?\d+(?:\.\d+)?\b/g },
      { type: "keyword", regex: keywordSets[lang] || null }
    ].filter((item) => item.regex);

    if (lang === "html") {
      patterns.push({ type: "tag", regex: /&lt;\/?[A-Za-z][\s\S]*?&gt;/g });
    }

    const escaped = escapeHtml(source);
    const tokens = [];
    patterns.forEach((pattern) => {
      let match;
      pattern.regex.lastIndex = 0;
      while ((match = pattern.regex.exec(escaped)) !== null) {
        tokens.push({ start: match.index, end: match.index + match[0].length, type: pattern.type, value: match[0] });
      }
    });

    tokens.sort((a, b) => a.start - b.start || b.end - a.end);
    const accepted = [];
    let lastEnd = -1;
    tokens.forEach((token) => {
      if (token.start >= lastEnd) {
        accepted.push(token);
        lastEnd = token.end;
      }
    });

    let output = "";
    let cursor = 0;
    accepted.forEach((token) => {
      output += escaped.slice(cursor, token.start);
      output += syntaxClass(token);
      cursor = token.end;
    });
    output += escaped.slice(cursor);
    return output;
  }

  function renderCodeBlock(rawBlock) {
    const block = String(rawBlock || "").replace(/^\n+|\n+$/g, "");
    const firstLine = block.split("\n")[0] || "";
    const hasLanguage = /^[A-Za-z0-9_+#.-]{1,32}$/.test(firstLine.trim()) && block.includes("\n");
    const language = hasLanguage ? normalizeLanguage(firstLine.trim()) : "text";
    const code = hasLanguage ? block.slice(firstLine.length + 1) : block;
    return `
      <div class="code-block" data-language="${escapeHtml(language)}">
        <div class="code-toolbar">
          <span>${escapeHtml(language)}</span>
          <button class="code-copy-btn" type="button" title="Copy code" aria-label="Copy code"><img src="${asset("copy")}" alt=""></button>
        </div>
        <pre><code class="language-${escapeHtml(language)}">${highlightCode(code, language)}</code></pre>
      </div>`;
  }

  function renderMarkdown(text) {
    const chunks = String(text || "").split(/```/);
    return chunks.map((chunk, index) => {
      if (index % 2 === 1) {
        return renderCodeBlock(chunk);
      }
      return renderRichText(chunk);
    }).join("");
  }

  function renderRichText(text) {
    const lines = String(text || "").split(/\n/);
    const html = [];
    let listOpen = false;
    let table = [];

    function closeList() {
      if (listOpen) {
        html.push("</ul>");
        listOpen = false;
      }
    }

    function flushTable() {
      if (table.length < 2) {
        table.forEach((line) => html.push(`<p>${inlineFormat(line)}</p>`));
      } else {
        const rows = table.filter((line) => !/^\s*\|?\s*:?-{3,}:?\s*\|/.test(line));
        html.push("<table>");
        rows.forEach((row, rowIndex) => {
          const cells = row.replace(/^\||\|$/g, "").split("|").map((cell) => inlineFormat(cell.trim()));
          html.push(rowIndex === 0 ? "<thead><tr>" : "<tbody><tr>");
          cells.forEach((cell) => html.push(rowIndex === 0 ? `<th>${cell}</th>` : `<td>${cell}</td>`));
          html.push(rowIndex === 0 ? "</tr></thead>" : "</tr></tbody>");
        });
        html.push("</table>");
      }
      table = [];
    }

    lines.forEach((line) => {
      if (line.includes("|") && line.trim().startsWith("|")) {
        closeList();
        table.push(line);
        return;
      }
      if (table.length) flushTable();
      const trimmed = line.trim();
      if (!trimmed) {
        closeList();
        return;
      }
      if (/^#{1,3}\s+/.test(trimmed)) {
        closeList();
        const level = Math.min(3, trimmed.match(/^#+/)[0].length);
        html.push(`<h${level}>${inlineFormat(trimmed.replace(/^#{1,3}\s+/, ""))}</h${level}>`);
        return;
      }
      if (/^[-*]\s+/.test(trimmed)) {
        if (!listOpen) {
          html.push("<ul>");
          listOpen = true;
        }
        html.push(`<li>${inlineFormat(trimmed.replace(/^[-*]\s+/, ""))}</li>`);
        return;
      }
      closeList();
      html.push(`<p>${inlineFormat(trimmed)}</p>`);
    });
    closeList();
    if (table.length) flushTable();
    return html.join("");
  }

  function inlineFormat(text) {
    return escapeHtml(text)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");
  }

  function renderChats() {
    const q = els.chatSearch.value.trim().toLowerCase();
    els.chatList.innerHTML = "";
    let lastBucket = "";
    state.chats
      .slice()
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
      .filter((chat) => chat.title.toLowerCase().includes(q))
      .forEach((chat) => {
        const bucket = chatBucket(chat.updatedAt);
        if (bucket !== lastBucket) {
          const label = document.createElement("div");
          label.className = "chat-group-label";
          label.textContent = bucket;
          els.chatList.appendChild(label);
          lastBucket = bucket;
        }
        const item = document.createElement("div");
        item.className = "chat-item" + (chat.id === state.activeId ? " active" : "");
        item.innerHTML = `
          <button class="chat-select" type="button">
            <span class="chat-name">${escapeHtml(chat.title)}</span>
            <span class="chat-date">${formatDate(chat.updatedAt)}</span>
          </button>
          <span class="chat-actions">
            <button class="icon-btn rename-chat" type="button" title="Rename chat" aria-label="Rename chat">
              <img src="${asset("edit")}" alt="">
            </button>
            <button class="icon-btn delete-chat" type="button" title="Delete chat" aria-label="Delete chat">
              <img src="${asset("trash")}" alt="">
            </button>
          </span>
        `;
        item.querySelector(".chat-select").addEventListener("click", () => {
          state.activeId = chat.id;
          saveChats();
          els.sidebar.classList.remove("open");
          render();
        });
        item.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          renameChat(chat.id);
        });
        item.querySelector(".rename-chat").addEventListener("click", () => renameChat(chat.id));
        item.querySelector(".delete-chat").addEventListener("click", () => deleteChat(chat.id));
        els.chatList.appendChild(item);
      });
  }

  function renderMessages() {
    const chat = activeChat();
    els.chatTitle.textContent = chat.title;
    els.messages.innerHTML = "";
    if (!chat.messages.length) {
      els.messages.innerHTML = `
        <div class="empty-state">
          <div>
            <h2>How can I help?</h2>
            <p>Start a clean, private browser-stored chat.</p>
          </div>
        </div>`;
      return;
    }

    chat.messages.forEach((message) => {
      if (!message.id) message.id = uid();
      const row = document.createElement("article");
      row.className = `message-row ${message.role}`;
      row.dataset.messageId = message.id;
      const isRevealing = Object.prototype.hasOwnProperty.call(state.reveals, message.id);
      const displayContent = isRevealing ? state.reveals[message.id] : message.content;
      const who = message.role === "user" ? "You" : "GPT Console";
      const images = message.images && message.images.length
        ? `<div class="image-grid">${message.images.map((image) => {
          const src = safeImageSrc(image.dataUrl);
          return src ? `<div class="image-chip"><img src="${escapeHtml(src)}" alt="${escapeHtml(image.name)}"></div>` : "";
        }).join("")}</div>`
        : "";
      row.innerHTML = `
        ${message.role === "assistant" ? `<div class="avatar"><img src="${asset("logo")}" alt=""></div>` : ""}
        <div class="bubble">
          <div class="message-meta">
            <span>${who} · ${formatTime(message.createdAt)}</span>
          </div>
          <div class="message-content${isRevealing ? " typing-caret" : ""}">${renderMarkdown(displayContent)}</div>
          ${images}
          <div class="message-actions">
            <button class="copy-btn" type="button" title="Copy text" aria-label="Copy message text"><img src="${asset("copy")}" alt=""></button>
          </div>
        </div>
      `;
      row.querySelector(".copy-btn").addEventListener("click", async () => {
        await navigator.clipboard.writeText(message.content || "");
        showToast("Copied.");
      });
      bindCodeCopyButtons(row);
      els.messages.appendChild(row);
    });
    els.messages.scrollTop = els.messages.scrollHeight;
  }

  function bindCodeCopyButtons(scope) {
    scope.querySelectorAll(".code-copy-btn").forEach((button) => {
      if (button.dataset.bound === "1") return;
      button.dataset.bound = "1";
      button.addEventListener("click", async () => {
        const code = button.closest(".code-block")?.querySelector("code")?.innerText || "";
        await navigator.clipboard.writeText(code);
        showToast("Code copied.");
      });
    });
  }

  function scrollToBottom() {
    els.messages.scrollTop = els.messages.scrollHeight;
  }

  function updateRevealedMessage(messageId) {
    const row = els.messages.querySelector(`[data-message-id="${messageId}"]`);
    if (!row) return;
    const content = row.querySelector(".message-content");
    if (!content) return;
    const isRevealing = Object.prototype.hasOwnProperty.call(state.reveals, messageId);
    content.classList.toggle("typing-caret", isRevealing);
    content.innerHTML = renderMarkdown(state.reveals[messageId] || "");
    bindCodeCopyButtons(row);
    scrollToBottom();
  }

  function animateAssistantMessage(messageId, fullText) {
    clearTimeout(state.revealTimers[messageId]);
    const chunks = String(fullText || "").match(/\S+\s*/g) || [String(fullText || "")];
    let index = 0;
    state.reveals[messageId] = "";

    function tick() {
      const step = Math.min(chunks.length - index, chunks[index] && chunks[index].length < 5 ? 3 : 2);
      state.reveals[messageId] += chunks.slice(index, index + step).join("");
      index += step;
      updateRevealedMessage(messageId);

      if (index < chunks.length) {
        state.revealTimers[messageId] = setTimeout(tick, 28 + Math.random() * 42);
        return;
      }

      delete state.reveals[messageId];
      delete state.revealTimers[messageId];
      renderMessages();
    }

    tick();
  }

  function renderAttachments() {
    els.attachments.innerHTML = "";
    state.pendingImages.forEach((image, index) => {
      const src = safeImageSrc(image.dataUrl);
      if (!src) return;
      const chip = document.createElement("div");
      chip.className = "image-chip";
      chip.innerHTML = `<img src="${escapeHtml(src)}" alt="${escapeHtml(image.name)}"><button type="button" aria-label="Remove image">×</button>`;
      chip.querySelector("button").addEventListener("click", () => {
        state.pendingImages.splice(index, 1);
        renderAttachments();
      });
      els.attachments.appendChild(chip);
    });
  }

  function render() {
    renderChats();
    renderMessages();
    renderAttachments();
    els.modelSelect.value = state.selectedModel;
    els.charCount.textContent = `${els.promptInput.value.length} / ${MAX_CHARS}`;
  }

  function renameChat(id) {
    const chat = state.chats.find((item) => item.id === id);
    if (!chat) return;
    const next = prompt("Rename chat", chat.title);
    if (!next) return;
    chat.title = next.trim().slice(0, 80) || chat.title;
    chat.updatedAt = new Date().toISOString();
    saveChats();
    render();
  }

  function deleteChat(id) {
    if (!confirm("Delete this chat?")) return;
    state.chats = state.chats.filter((chat) => chat.id !== id);
    if (state.activeId === id) {
      state.activeId = state.chats[0]?.id || "";
    }
    if (!state.chats.length) createChat(false);
    saveChats();
    render();
  }

  async function imageToDataUrl(file) {
    if (!file.type.startsWith("image/")) throw new Error("Only images can be uploaded.");
    if (file.size > MAX_IMAGE_BYTES) throw new Error("Image is too large. Please use an image under 5 MB.");

    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Could not read image."));
      reader.readAsDataURL(file);
    });

    if (file.type === "image/gif") {
      return { name: file.name, type: file.type, dataUrl };
    }

    return new Promise((resolve) => {
      const image = new Image();
      image.onload = () => {
        const maxSide = 1400;
        const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const ctx = canvas.getContext("2d");
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve({ name: file.name, type: "image/jpeg", dataUrl: canvas.toDataURL("image/jpeg", .86) });
      };
      image.onerror = () => resolve({ name: file.name, type: file.type, dataUrl });
      image.src = dataUrl;
    });
  }

  async function addFiles(files) {
    for (const file of Array.from(files)) {
      if (state.pendingImages.length >= MAX_IMAGES) {
        showToast(`Maximum ${MAX_IMAGES} images per message.`);
        break;
      }
      try {
        state.pendingImages.push(await imageToDataUrl(file));
      } catch (error) {
        showToast(error.message);
      }
    }
    renderAttachments();
  }

  function buildApiMessages(chat, nextUserMessage) {
    const history = chat.messages.slice(0, -1).slice(-12).map((message) => ({
      role: message.role,
      content: message.content,
      images: message.images || []
    }));
    history.push(nextUserMessage);
    return history;
  }

  async function sendMessage() {
    const text = els.promptInput.value.trim();
    if (state.busy) return;
    if (!state.token) {
      showToast("Please log in first.");
      return;
    }
    if (!text && !state.pendingImages.length) return;
    if (text.length > MAX_CHARS) {
      showToast("Messages are limited to 1,000 characters.");
      return;
    }

    const chat = activeChat();
    const userMessage = {
      role: "user",
      content: text,
      images: state.pendingImages.slice(),
      createdAt: new Date().toISOString()
    };
    chat.messages.push(userMessage);
    chat.updatedAt = new Date().toISOString();
    els.promptInput.value = "";
    state.pendingImages = [];
    state.busy = true;
    els.sendBtn.disabled = true;
    saveChats();
    render();

    try {
      const data = await apiPost("api.php", {
        action: "chat",
        token: state.token,
        model: state.selectedModel,
        messages: buildApiMessages(chat, userMessage)
      });
      const assistantMessage = {
        id: uid(),
        role: "assistant",
        content: data.message,
        model: data.model || state.selectedModel,
        createdAt: new Date().toISOString()
      };
      state.reveals[assistantMessage.id] = "";
      chat.messages.push(assistantMessage);
      if (typeof data.requests_left === "number") {
        state.quota = data.requests_left;
        els.requestsLeft.textContent = String(data.requests_left);
      }
      chat.updatedAt = new Date().toISOString();
      saveChats();
      render();
      animateAssistantMessage(assistantMessage.id, assistantMessage.content);
      if (chat.title === "New chat") generateTitle(chat);
    } catch (error) {
      chat.messages.push({
        role: "assistant",
        content: error.message || "Lost connection!",
        createdAt: new Date().toISOString()
      });
      saveChats();
      render();
      showToast(error.message || "Lost connection!");
      await refreshQuota(true);
    } finally {
      state.busy = false;
      els.sendBtn.disabled = false;
    }
  }

  async function generateTitle(chat) {
    try {
      const data = await apiPost("api.php", {
        action: "title",
        token: state.token,
        messages: chat.messages.slice(0, 2).map((message) => ({ role: message.role, content: message.content }))
      });
      if (data.title && chat.title === "New chat") {
        chat.title = data.title.slice(0, 60);
        chat.updatedAt = new Date().toISOString();
        if (typeof data.requests_left === "number") {
          state.quota = data.requests_left;
          els.requestsLeft.textContent = String(data.requests_left);
        }
        saveChats();
        render();
      }
    } catch (_) {
      const first = chat.messages.find((message) => message.role === "user")?.content || "Image chat";
      chat.title = first.split(/\s+/).slice(0, 6).join(" ").slice(0, 60) || "Image chat";
      saveChats();
      render();
    }
  }

  els.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const token = els.tokenInput.value.trim();
    if (!token) return;
    els.loginError.textContent = "";
    try {
      const data = await apiPost("quota.php", { token });
      state.token = token;
      state.quota = data.requests_left;
      localStorage.setItem(TOKEN_KEY, token);
      els.requestsLeft.textContent = String(data.requests_left);
      els.loginScreen.classList.add("hidden");
      setConnection(true);
      if (!state.chats.length) createChat(false);
      render();
    } catch (error) {
      els.loginError.textContent = error.message;
      setConnection(false);
    }
  });

  els.logoutBtn.addEventListener("click", () => {
    state.token = "";
    localStorage.removeItem(TOKEN_KEY);
    els.loginScreen.classList.remove("hidden");
    els.tokenInput.value = "";
    els.requestsLeft.textContent = "--";
    setConnection(false);
  });

  els.newChatBtn.addEventListener("click", () => createChat());
  els.chatSearch.addEventListener("input", renderChats);
  els.sidebarToggle.addEventListener("click", toggleSidebar);
  els.sidebarCollapseBtn.addEventListener("click", toggleSidebar);
  els.chatTitleBtn.addEventListener("click", () => renameChat(state.activeId));
  els.deleteChatBtn.addEventListener("click", () => deleteChat(state.activeId));
  els.chatTitleBtn.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    deleteChat(state.activeId);
  });
  els.modelSelect.addEventListener("change", () => {
    state.selectedModel = els.modelSelect.value;
    localStorage.setItem(MODEL_KEY, state.selectedModel);
  });
  els.promptInput.addEventListener("input", () => {
    els.charCount.textContent = `${els.promptInput.value.length} / ${MAX_CHARS}`;
    els.promptInput.style.height = "auto";
    els.promptInput.style.height = `${Math.min(220, els.promptInput.scrollHeight)}px`;
  });
  els.promptInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  });
  els.sendBtn.addEventListener("click", sendMessage);
  els.attachBtn.addEventListener("click", () => els.fileInput.click());
  els.fileInput.addEventListener("change", () => addFiles(els.fileInput.files));
  ["dragenter", "dragover"].forEach((name) => {
    els.dropZone.addEventListener(name, (event) => {
      event.preventDefault();
      els.dropZone.classList.add("dragging");
    });
  });
  ["dragleave", "drop"].forEach((name) => {
    els.dropZone.addEventListener(name, (event) => {
      event.preventDefault();
      els.dropZone.classList.remove("dragging");
    });
  });
  els.dropZone.addEventListener("drop", (event) => addFiles(event.dataTransfer.files));

  if (!state.chats.length) createChat(false);
  if (!state.chats.some((chat) => chat.id === state.activeId)) state.activeId = state.chats[0].id;
  saveChats();
  els.modelSelect.value = state.selectedModel;
  applySidebarState();
  render();
  if (state.token) {
    refreshQuota(true).then((ok) => {
      els.loginScreen.classList.toggle("hidden", ok);
    });
  }
})();
