const widget = document.getElementById("widget");
    const launcher = document.getElementById("launcher");
    const panelClose = document.getElementById("panelClose");
    const clearChat = document.getElementById("clearChat");
    const messages = document.getElementById("messages");
    const form = document.getElementById("chat");
    const composerStatus = document.getElementById("composerStatus");
    const question = document.getElementById("question");
    const send = document.getElementById("send");
    const quickActions = document.getElementById("quickActions");
    const welcomeMessage = document.getElementById("welcomeMessage");
    const chatHistory = [];
    let storedMessages = [];
    let cooldownUntil = 0;
    let cooldownTimer = 0;
    let sending = false;
    let saveTimer = 0;
    let storageKeyPromise = null;
    const STORAGE_STATE_KEY = "lateetud.chat.state.v1";
    const STORAGE_CRYPTO_KEY = "lateetud.chat.cryptoKey.v1";
    const MAX_STORED_MESSAGES = 40;
    const DEFAULT_COOLDOWN_SECONDS = 60;
    const welcomeVariants = [
      "Hi. I can help you explore Lateetud's services, industry solutions, case studies, and next steps.",
      "Hello. Ask me about Lateetud's AI, automation, cloud, and operational transformation work.",
      "Welcome. I can point you toward relevant Lateetud solutions, case studies, or the best next step."
    ];
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function toBase64(bytes) {
      let binary = "";
      const chunkSize = 0x8000;
      for (let index = 0; index < bytes.length; index += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
      }
      return btoa(binary);
    }

    function fromBase64(value) {
      const binary = atob(value);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      return bytes;
    }

    function readStorage(key) {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return null;
      }
    }

    function writeStorage(key, value) {
      try {
        window.localStorage.setItem(key, value);
        return true;
      } catch {
        return false;
      }
    }

    function removeStorage(key) {
      try {
        window.localStorage.removeItem(key);
      } catch {
        return;
      }
    }

    function canUseStorageCrypto() {
      return Boolean(window.crypto && window.crypto.subtle && window.crypto.getRandomValues && window.TextEncoder && window.TextDecoder);
    }

    async function getStorageKey() {
      if (!canUseStorageCrypto()) return null;
      if (storageKeyPromise) return storageKeyPromise;
      storageKeyPromise = (async () => {
        let rawKey = readStorage(STORAGE_CRYPTO_KEY);
        if (!rawKey) {
          const bytes = new Uint8Array(32);
          window.crypto.getRandomValues(bytes);
          rawKey = toBase64(bytes);
          writeStorage(STORAGE_CRYPTO_KEY, rawKey);
        }
        return window.crypto.subtle.importKey("raw", fromBase64(rawKey), "AES-GCM", false, ["encrypt", "decrypt"]);
      })().catch(() => null);
      return storageKeyPromise;
    }

    function compactText(value, limit = 700) {
      return String(value || "")
        .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, limit);
    }

    function sanitizeSource(source) {
      if (!source || typeof source !== "object") return null;
      const clean = {
        citation_number: Number(source.citation_number) || 0,
        title: compactText(source.title, 140),
        source_type_label: compactText(source.source_type_label || source.source_type, 80),
        source_url: "",
        page: Number(source.page) || 0
      };
      if (source.source_url && /^https:\/\/([a-z0-9-]+\.)?lateetud\.com\//i.test(source.source_url)) {
        clean.source_url = source.source_url;
      }
      return clean.title ? clean : null;
    }

    function sanitizeAction(action) {
      if (!action || typeof action !== "object") return null;
      const label = compactText(action.label, 80);
      const href = safeLink(action.href || action.url || "");
      return label && href ? {label, href} : null;
    }

    function sanitizeMessageRecord(message) {
      if (!message || typeof message !== "object") return null;
      if (message.role !== "user" && message.role !== "assistant") return null;
      const text = compactText(message.text || message.content, 2200);
      if (!text) return null;
      if (message.role === "assistant" && /^request failed$/i.test(text)) return null;
      const sources = Array.isArray(message.sources)
        ? message.sources.map(sanitizeSource).filter(Boolean).slice(0, 8)
        : [];
      const actions = Array.isArray(message.actions)
        ? message.actions.map(sanitizeAction).filter(Boolean).slice(0, 4)
        : [];
      return {role: message.role, text, sources, actions};
    }

    function sanitizeHistoryRecord(item) {
      if (!item || typeof item !== "object") return null;
      if (item.role !== "user" && item.role !== "assistant") return null;
      const content = compactText(item.content || item.text);
      return content ? {role: item.role, content} : null;
    }

    async function saveStoredState(state) {
      const safeState = {
        version: 1,
        updatedAt: Date.now(),
        messages: Array.isArray(state.messages) ? state.messages.map(sanitizeMessageRecord).filter(Boolean).slice(-MAX_STORED_MESSAGES) : [],
        history: Array.isArray(state.history) ? state.history.map(sanitizeHistoryRecord).filter(Boolean).slice(-8) : [],
        draft: compactText(state.draft, 900),
        cooldownUntil: Number(state.cooldownUntil) || 0
      };

      const key = await getStorageKey();
      if (key) {
        try {
          const iv = new Uint8Array(12);
          window.crypto.getRandomValues(iv);
          const encoded = new TextEncoder().encode(JSON.stringify(safeState));
          const encrypted = await window.crypto.subtle.encrypt({name: "AES-GCM", iv}, key, encoded);
          writeStorage(STORAGE_STATE_KEY, JSON.stringify({
            version: 1,
            encrypted: true,
            iv: toBase64(iv),
            data: toBase64(new Uint8Array(encrypted))
          }));
          return;
        } catch {
          // Fall through to plain storage if Web Crypto fails.
        }
      }

      writeStorage(STORAGE_STATE_KEY, JSON.stringify({version: 1, encrypted: false, data: safeState}));
    }

    async function loadStoredState() {
      const raw = readStorage(STORAGE_STATE_KEY);
      if (!raw) return null;
      try {
        const payload = JSON.parse(raw);
        let state = null;
        if (payload.encrypted) {
          const key = await getStorageKey();
          if (!key) return null;
          const decrypted = await window.crypto.subtle.decrypt(
            {name: "AES-GCM", iv: fromBase64(payload.iv || "")},
            key,
            fromBase64(payload.data || "")
          );
          state = JSON.parse(new TextDecoder().decode(decrypted));
        } else {
          state = payload.data;
        }
        if (!state || typeof state !== "object") return null;
        return {
          messages: Array.isArray(state.messages) ? state.messages.map(sanitizeMessageRecord).filter(Boolean).slice(-MAX_STORED_MESSAGES) : [],
          history: Array.isArray(state.history) ? state.history.map(sanitizeHistoryRecord).filter(Boolean).slice(-8) : [],
          draft: compactText(state.draft, 900),
          cooldownUntil: Number(state.cooldownUntil) || 0
        };
      } catch {
        return null;
      }
    }

    function scheduleSave() {
      window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => {
        saveStoredState({
          messages: storedMessages,
          history: chatHistory,
          draft: question.value,
          cooldownUntil
        });
      }, 140);
    }

    function saveSoon() {
      scheduleSave();
    }

    function storeMessage(role, text, sources = [], actions = []) {
      const record = sanitizeMessageRecord({role, text, sources, actions});
      if (!record) return;
      storedMessages.push(record);
      storedMessages = storedMessages.slice(-MAX_STORED_MESSAGES);
      saveSoon();
    }

    function clearStoredState() {
      removeStorage(STORAGE_STATE_KEY);
      removeStorage(STORAGE_CRYPTO_KEY);
      storageKeyPromise = null;
    }

    function setOpen(open) {
      widget.dataset.open = String(open);
      launcher.setAttribute("aria-expanded", String(open));
      launcher.setAttribute("aria-label", open ? "Close Lateetud AI Assistant" : "Open Lateetud AI Assistant");
      if (open) window.setTimeout(() => question.focus(), 80);
    }

    function cooldownSecondsRemaining() {
      return Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
    }

    function formatDuration(totalSeconds) {
      const seconds = Math.max(0, Number(totalSeconds) || 0);
      if (seconds >= 3600) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.ceil((seconds % 3600) / 60);
        return `${hours}h ${minutes}m`;
      }
      if (seconds >= 60) {
        const minutes = Math.floor(seconds / 60);
        const remainder = String(seconds % 60).padStart(2, "0");
        return `${minutes}:${remainder}`;
      }
      return `${seconds}s`;
    }

    function setComposerStatus(text) {
      composerStatus.textContent = text || "";
      composerStatus.dataset.visible = text ? "true" : "false";
    }

    function updateComposerInteractivity() {
      const coolingDown = cooldownSecondsRemaining() > 0;
      form.dataset.cooldown = coolingDown ? "true" : "false";
      question.disabled = coolingDown;
      send.disabled = sending || coolingDown;
    }

    function renderCooldown(message = "Too many messages.") {
      const remaining = cooldownSecondsRemaining();
      if (!remaining) {
        window.clearInterval(cooldownTimer);
        cooldownTimer = 0;
        cooldownUntil = 0;
        setComposerStatus("");
        updateComposerInteractivity();
        saveSoon();
        if (widget.dataset.open === "true") question.focus();
        return;
      }
      setComposerStatus(`${message} You can send again in ${formatDuration(remaining)}.`);
      updateComposerInteractivity();
    }

    function startCooldown(seconds, message) {
      const duration = Math.max(1, Number(seconds) || DEFAULT_COOLDOWN_SECONDS);
      cooldownUntil = Date.now() + duration * 1000;
      window.clearInterval(cooldownTimer);
      renderCooldown(message);
      cooldownTimer = window.setInterval(() => renderCooldown(message), 1000);
      saveSoon();
    }

    function setSending(active) {
      sending = Boolean(active);
      updateComposerInteractivity();
    }

    function parseMarkdownBlocks(text) {
      const blocks = [];
      let paragraph = [];
      let activeList = null;

      function flushParagraph() {
        if (!paragraph.length) return;
        blocks.push({type: "p", text: paragraph.join(" ")});
        paragraph = [];
      }

      String(text).split(/\r?\n/).forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed) {
          flushParagraph();
          return;
        }

        const bullet = trimmed.match(/^[-*]\s+(.+)$/);
        const numbered = trimmed.match(/^\d+[.)]\s+(.+)$/);
        if (bullet || numbered) {
          flushParagraph();
          const type = bullet ? "ul" : "ol";
          if (!activeList || activeList.type !== type) {
            activeList = {type, items: []};
            blocks.push(activeList);
          }
          activeList.items.push((bullet || numbered)[1]);
          return;
        }

        activeList = null;
        paragraph.push(trimmed);
      });
      flushParagraph();
      return blocks;
    }

    function createScheduler() {
      const operations = [];
      let totalDelay = 0;
      return {
        add(callback, pauseAfter = 0) {
          operations.push({callback, delay: totalDelay});
          totalDelay += pauseAfter;
        },
        pause(duration = 0) {
          totalDelay += Math.max(0, duration);
        },
        run(done) {
          if (!operations.length) {
            if (done) done();
            return;
          }
          operations.forEach((operation) => {
            window.setTimeout(() => {
              operation.callback();
              messages.scrollTop = messages.scrollHeight;
            }, operation.delay);
          });
          window.setTimeout(() => {
            if (done) done();
            messages.scrollTop = messages.scrollHeight;
          }, totalDelay + 90);
        }
      };
    }

    function randomBetween(min, max) {
      return min + Math.random() * (max - min);
    }

    function wordDelay(part) {
      const word = String(part || "");
      let delay = randomBetween(15, 34);
      if (word.length > 10) delay += randomBetween(4, 14);
      if (/[,:;]$/.test(word)) delay += randomBetween(35, 80);
      if (/[.!?]$/.test(word)) delay += randomBetween(90, 165);
      if (/\]$/.test(word)) delay += randomBetween(20, 55);
      return Math.round(delay);
    }

    function linePause(kind = "paragraph") {
      if (kind === "list-start") return Math.round(randomBetween(95, 175));
      if (kind === "list-item") return Math.round(randomBetween(75, 145));
      return Math.round(randomBetween(115, 210));
    }

    function safeLink(url) {
      try {
        const parsed = new URL(url, window.location.href);
        if (parsed.protocol !== "https:") return "";
        if (!/(^|\.)lateetud\.com$/i.test(parsed.hostname)) return "";
        return parsed.href;
      } catch {
        return "";
      }
    }

    function appendText(parent, text, animate, scheduler) {
      String(text).split(/(\s+)/).forEach((part) => {
        if (!part) return;
        if (/^\s+$/.test(part)) {
          const addSpace = () => parent.appendChild(document.createTextNode(part));
          animate ? scheduler.add(addSpace, 0) : addSpace();
          return;
        }
        const addWord = () => {
          const span = document.createElement("span");
          span.className = "reveal-word d0";
          span.textContent = part;
          parent.appendChild(span);
        };
        animate ? scheduler.add(addWord, wordDelay(part)) : parent.appendChild(document.createTextNode(part));
      });
    }

    function appendElementInFlow(parent, child, animate, scheduler) {
      if (animate) {
        scheduler.add(() => parent.appendChild(child), 0);
      } else {
        parent.appendChild(child);
      }
    }

    function sourceForCitation(number, sources = []) {
      const citationNumber = Number(number);
      return (Array.isArray(sources) ? sources : []).find((source, index) => {
        return Number(source.citation_number || index + 1) === citationNumber;
      }) || null;
    }

    function createCitationLink(number, options = {}) {
      const source = sourceForCitation(number, options.sources);
      const href = safeLink(source && source.source_url ? source.source_url : "");
      const citation = document.createElement("a");
      citation.className = "citation-link";
      citation.textContent = `[${number}]`;
      citation.href = href || `#source-${number}`;
      citation.setAttribute("aria-label", source && source.title ? `Open source ${number}: ${source.title}` : `Show source ${number}`);
      if (href) {
        citation.target = "_blank";
        citation.rel = "noopener noreferrer";
        citation.title = source && source.title ? `Open source: ${source.title}` : `Open source ${number}`;
      } else {
        citation.title = `Show source ${number}`;
        citation.addEventListener("click", (event) => {
          event.preventDefault();
          if (typeof options.revealCitation === "function") {
            options.revealCitation(Number(number));
          }
        });
      }
      return citation;
    }

    function appendInline(parent, text, animate, scheduler, options = {}) {
      const pattern = /(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)|\[\d+\])/g;
      let cursor = 0;
      let match;
      while ((match = pattern.exec(text)) !== null) {
        if (match.index > cursor) {
          appendText(parent, text.slice(cursor, match.index), animate, scheduler);
        }

        const token = match[0];
        const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        const citation = token.match(/^\[(\d+)\]$/);
        if (token.startsWith("**") && token.endsWith("**")) {
          const strong = document.createElement("strong");
          appendElementInFlow(parent, strong, animate, scheduler);
          appendText(strong, token.slice(2, -2), animate, scheduler);
        } else if (link) {
          const href = safeLink(link[2]);
          if (href) {
            const anchor = document.createElement("a");
            anchor.href = href;
            anchor.target = "_blank";
            anchor.rel = "noopener noreferrer";
            appendElementInFlow(parent, anchor, animate, scheduler);
            appendText(anchor, link[1], animate, scheduler);
          } else {
            appendText(parent, link[1], animate, scheduler);
          }
        } else if (citation) {
          appendElementInFlow(parent, createCitationLink(citation[1], options), animate, scheduler);
          if (animate) scheduler.pause(wordDelay(token));
        }
        cursor = pattern.lastIndex;
      }

      if (cursor < text.length) {
        appendText(parent, text.slice(cursor), animate, scheduler);
      }
    }

    function renderMarkdown(container, text, animate, done, options = {}) {
      const copy = document.createElement("div");
      copy.className = "message-copy";
      container.appendChild(copy);

      const shouldAnimate = animate && !reduceMotion;
      const scheduler = createScheduler();
      let renderedBlocks = 0;
      parseMarkdownBlocks(text).forEach((block) => {
        if (block.type === "p") {
          const paragraph = document.createElement("p");
          copy.appendChild(paragraph);
          if (shouldAnimate && renderedBlocks > 0) scheduler.pause(linePause("paragraph"));
          appendInline(paragraph, block.text, shouldAnimate, scheduler, options);
          renderedBlocks += 1;
          return;
        }

        const list = document.createElement(block.type);
        copy.appendChild(list);
        if (shouldAnimate && renderedBlocks > 0) scheduler.pause(linePause("list-start"));
        block.items.forEach((item, index) => {
          const li = document.createElement("li");
          list.appendChild(li);
          if (shouldAnimate) scheduler.pause(linePause(index === 0 ? "list-start" : "list-item"));
          appendInline(li, item, shouldAnimate, scheduler, options);
        });
        renderedBlocks += 1;
      });

      if (shouldAnimate) {
        scheduler.run(done);
      } else if (done) {
        done();
      }
    }

    function addMessage(role, text, sources = [], options = {}) {
      const el = document.createElement("div");
      el.className = `message ${role}`;
      const messageId = `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      el.dataset.messageId = messageId;
      const actions = Array.isArray(options.actions) ? options.actions.map(sanitizeAction).filter(Boolean).slice(0, 4) : [];
      const revealCitationSource = (citationNumber) => {
        const sourceList = el.querySelector(".source-list");
        const toggle = el.querySelector(".source-toggle");
        if (!sourceList || !toggle) return;
        sourceList.hidden = false;
        toggle.textContent = "Hide sources";
        const item = el.querySelector(`.source[data-citation-number="${citationNumber}"]`);
        if (item) {
          item.dataset.highlight = "true";
          item.scrollIntoView({block: "nearest", behavior: reduceMotion ? "auto" : "smooth"});
          window.setTimeout(() => {
            item.dataset.highlight = "false";
          }, 1800);
        }
      };
      const renderActions = () => {
        if (!actions.length) return;
        const wrap = document.createElement("div");
        wrap.className = "message-actions";
        actions.forEach((action) => {
          const link = document.createElement("a");
          link.className = "message-action";
          link.href = action.href;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.textContent = action.label;
          wrap.appendChild(link);
        });
        el.appendChild(wrap);
      };
      const renderSources = () => {
        if (!sources.length) return;
        const list = document.createElement("div");
        list.className = "sources";
        const toggle = document.createElement("button");
        toggle.className = "source-toggle";
        toggle.type = "button";
        toggle.textContent = `${sources.length} source${sources.length === 1 ? "" : "s"}`;
        list.appendChild(toggle);
        const sourceList = document.createElement("div");
        sourceList.className = "source-list";
        sourceList.hidden = true;
        sources.forEach((source, index) => {
          const item = document.createElement("div");
          item.className = "source";
          const citationNumber = source.citation_number || index + 1;
          item.dataset.citationNumber = String(citationNumber);
          item.id = `${messageId}-source-${citationNumber}`;
          const page = source.page ? `, page ${source.page}` : "";
          const type = source.source_type_label || source.source_type || "Source";
          const titleText = `[${citationNumber}] ${source.title}${page}`;
          let titleEl;
          if (source.source_url && /^https:\/\/([a-z0-9-]+\.)?lateetud\.com\//i.test(source.source_url)) {
            titleEl = document.createElement("a");
            titleEl.href = source.source_url;
            titleEl.target = "_blank";
            titleEl.rel = "noopener noreferrer";
          } else {
            titleEl = document.createElement("strong");
          }
          titleEl.textContent = titleText;
          item.appendChild(titleEl);
          item.appendChild(document.createElement("br"));
          item.appendChild(document.createTextNode(type));
          sourceList.appendChild(item);
        });
        toggle.addEventListener("click", () => {
          sourceList.hidden = !sourceList.hidden;
          toggle.textContent = sourceList.hidden
            ? `${sources.length} source${sources.length === 1 ? "" : "s"}`
            : "Hide sources";
        });
        list.appendChild(sourceList);
        el.appendChild(list);
        messages.scrollTop = messages.scrollHeight;
      };
      const animate = options.animate === undefined ? role === "assistant" : Boolean(options.animate);
      const renderExtras = () => {
        renderActions();
        renderSources();
      };
      renderMarkdown(el, text, animate, renderExtras, {sources, revealCitation: revealCitationSource});
      messages.appendChild(el);
      messages.scrollTop = messages.scrollHeight;
      return el;
    }

    function addThinking() {
      const el = document.createElement("div");
      el.className = "message assistant";
      const typing = document.createElement("span");
      typing.className = "typing";
      typing.appendChild(document.createElement("span"));
      typing.appendChild(document.createElement("span"));
      typing.appendChild(document.createElement("span"));
      el.appendChild(typing);
      messages.appendChild(el);
      messages.scrollTop = messages.scrollHeight;
      return el;
    }

    async function postJson(url, body) {
      const response = await fetch(url, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(body || {})
      });
      let data = {};
      let parsedJson = true;
      try {
        data = await response.json();
      } catch {
        data = {};
        parsedJson = false;
      }
      if (!response.ok || !parsedJson || !data || typeof data.answer !== "string") {
        const error = new Error(data.error || (
          parsedJson
            ? "Chat backend not found. Make sure api/chat.php was uploaded and PHP is enabled."
            : "Chat backend returned a non-JSON response. Open this through Hostinger/PHP, not as a plain static file."
        ));
        error.status = response.status;
        error.retryAfter = Number(response.headers.get("Retry-After")) || DEFAULT_COOLDOWN_SECONDS;
        error.canTryFallback = response.status === 404 || response.status === 405 || response.status === 0 || !parsedJson;
        throw error;
      }
      return data;
    }

    function chatEndpointCandidates() {
      const explicit = widget.dataset.api;
      const endpoints = [];
      if (explicit) endpoints.push(explicit);
      endpoints.push("api/chat.php");
      if (/^(localhost|127\\.0\\.0\\.1|\\[::1\\])$/.test(window.location.hostname)) {
        endpoints.push("/api/chat");
      }
      return [...new Set(endpoints)];
    }

    async function requestChat(body) {
      if (window.location.protocol === "file:") {
        throw new Error("This chatbot cannot be tested by opening index.html directly. Upload it to Hostinger or run it through a PHP server so api/chat.php can execute.");
      }
      let lastError = null;
      for (const endpoint of chatEndpointCandidates()) {
        try {
          return await postJson(endpoint, body);
        } catch (error) {
          lastError = error;
          if (!error.canTryFallback) throw error;
        }
      }
      throw lastError || new Error("Chat backend not found. Make sure api/chat.php was uploaded and PHP is enabled.");
    }

    function historyTextForRole(role, content) {
      const limit = role === "assistant" ? 360 : 520;
      return compactText(content, limit)
        .replace(/\[[^\]]{1,80}\]\(https:\/\/[^)]+\)/g, "")
        .replace(/\[[0-9]+\]/g, "")
        .replace(/\b(?:View case studies|Explore solutions|Contact Lateetud|View services|Healthcare payors|Healthcare providers)\b/gi, "")
        .trim();
    }

    function historyForApi() {
      return chatHistory.slice(-4).map((item) => ({
        role: item.role,
        content: historyTextForRole(item.role, item.content)
      })).filter((item) => item.content);
    }

    function remember(role, content) {
      const compact = historyTextForRole(role, content);
      if (!compact) return;
      chatHistory.push({role, content: compact});
      while (chatHistory.length > 6) chatHistory.shift();
      saveSoon();
    }

    function renderWelcome() {
      welcomeMessage.hidden = false;
      welcomeMessage.innerHTML = "";
      renderMarkdown(
        welcomeMessage,
        welcomeVariants[Math.floor(Math.random() * welcomeVariants.length)],
        true
      );
    }

    function clearDynamicMessages() {
      messages.querySelectorAll(".message:not(#welcomeMessage)").forEach((message) => message.remove());
    }

    function resetConversationView() {
      window.clearInterval(cooldownTimer);
      cooldownTimer = 0;
      cooldownUntil = 0;
      sending = false;
      storedMessages = [];
      chatHistory.length = 0;
      question.value = "";
      clearDynamicMessages();
      quickActions.hidden = false;
      setComposerStatus("");
      updateComposerInteractivity();
      renderWelcome();
    }

    function clearConversation() {
      window.clearTimeout(saveTimer);
      resetConversationView();
      clearStoredState();
      if (widget.dataset.open === "true") question.focus();
    }

    async function restoreConversation() {
      const state = await loadStoredState();
      if (state && state.messages.length) {
        storedMessages = state.messages.slice(-MAX_STORED_MESSAGES);
        chatHistory.length = 0;
        const restoredHistory = state.history.length
          ? state.history
          : storedMessages.map((message) => ({role: message.role, content: compactText(message.text)})).slice(-8);
        restoredHistory.forEach((item) => chatHistory.push(item));
        welcomeMessage.hidden = true;
        quickActions.hidden = true;
        clearDynamicMessages();
        storedMessages.forEach((message) => {
          addMessage(message.role, message.text, message.sources || [], {animate: false, actions: message.actions || []});
        });
      } else {
        renderWelcome();
      }

      if (state && state.draft) {
        question.value = state.draft;
      }
      if (state && state.cooldownUntil && state.cooldownUntil > Date.now()) {
        cooldownUntil = state.cooldownUntil;
        window.clearInterval(cooldownTimer);
        renderCooldown("Too many messages.");
        cooldownTimer = window.setInterval(() => renderCooldown("Too many messages."), 1000);
      } else {
        cooldownUntil = 0;
        updateComposerInteractivity();
      }
    }

    launcher.addEventListener("click", () => setOpen(widget.dataset.open !== "true"));
    panelClose.addEventListener("click", () => setOpen(false));
    clearChat.addEventListener("click", clearConversation);
    question.addEventListener("input", saveSoon);

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const text = question.value.trim();
      if (!text) return;
      if (cooldownSecondsRemaining() > 0) {
        renderCooldown("Too many messages.");
        return;
      }

      const historyForRequest = historyForApi();
      question.value = "";
      saveSoon();
      quickActions.hidden = true;
      const userMessage = addMessage("user", text, [], {animate: false});
      setSending(true);
      const thinking = addThinking();
      try {
        const data = await requestChat({question: text, history: historyForRequest});
        thinking.remove();
        remember("user", text);
        storeMessage("user", text, []);
        addMessage("assistant", data.answer, data.sources || [], {actions: data.actions || []});
        remember("assistant", data.answer);
        storeMessage("assistant", data.answer, data.sources || [], data.actions || []);
      } catch (error) {
        thinking.remove();
        if (error.status === 429) {
          userMessage.remove();
          question.value = text;
          saveSoon();
          startCooldown(error.retryAfter, error.message || "Too many messages.");
        } else {
          userMessage.remove();
          question.value = text;
          saveSoon();
          addMessage("assistant", error.message || "The request could not be completed. Please try again.");
        }
      } finally {
        setSending(false);
        if (cooldownSecondsRemaining() === 0) question.focus();
      }
    });

    quickActions.querySelectorAll("button").forEach((button) => {
      button.addEventListener("click", () => {
        question.value = button.textContent;
        saveSoon();
        question.focus();
      });
    });

    restoreConversation();
