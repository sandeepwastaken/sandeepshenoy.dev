document.addEventListener('DOMContentLoaded', function() {
  if (window.twemoji) {
    try {
      window.twemoji.base = 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/';
    } catch (e) { /* noop */ }
    twemoji.parse(document.body, {folder: 'svg', ext: '.svg'});
  }

  (function ensureMarkdownLibs() {
    function loadScript(src) {
      return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('Failed to load ' + src));
        document.head.appendChild(s);
      });
    }
    const loaders = [];
    if (!(window.marked && typeof window.marked.parse === 'function')) {
      loaders.push(
        loadScript('https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js')
          .catch(() => loadScript('https://unpkg.com/marked@12.0.2/marked.min.js'))
          .catch(() => {/* swallow */})
      );
    }
    if (!(window.DOMPurify && typeof window.DOMPurify.sanitize === 'function')) {
      loaders.push(
        loadScript('https://cdn.jsdelivr.net/npm/dompurify@3.1.7/dist/purify.min.js')
          .catch(() => loadScript('https://unpkg.com/dompurify@3.1.7/dist/purify.min.js'))
          .catch(() => {/* swallow */})
      );
    }
    if (loaders.length) {
      Promise.allSettled(loaders).then(() => {
      });
    }
  })();

  document.body.classList.add('intro-active');
  const overlay = document.getElementById('introOverlay');
  const startBtn = document.getElementById('introStart');
  if (overlay && startBtn) {
    const leaveIntro = () => {
      document.body.classList.remove('intro-active');
      overlay.classList.add('is-leaving');
      const cleanup = () => {
        overlay.removeEventListener('transitionend', cleanup);
        if (overlay && overlay.parentNode) {
          overlay.parentNode.removeChild(overlay);
        }
      };
      overlay.addEventListener('transitionend', cleanup);
    };
    startBtn.addEventListener('click', leaveIntro);
  }

function renderMarkdown(markdown) {
  const escape = (s) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
  try {
    if (window.marked) {
      const html = window.marked.parse(markdown || '');
      if (window.DOMPurify) return window.DOMPurify.sanitize(html);
      return html;
    }
  } catch(e) {
    console.warn('Markdown render failed, falling back to escape-only', e);
  }
  return escape(String(markdown || '')).replace(/\n/g, '<br>');
}

function setMarkdown(node, markdown) {
  if (!node) return;
  node.innerHTML = renderMarkdown(markdown);
}

let analysisContext = { scrapedSummary: '', aiJson: null, aiRaw: '' };
let clarifyState = { remaining: 5 };

const regexPatterns = {
  linkedin: /^https?:\/\/(www\.)?linkedin\.com\/.*$/,
  twitter: /^https?:\/\/(www\.)?(x\.com|twitter\.com)\/[A-Za-z0-9_]+\/?$/,
  facebook: /^https?:\/\/(www\.)?facebook\.com\/[A-Za-z0-9\._\-]+\/?$/
};

document.querySelectorAll('.input-group input').forEach(input => {
  input.addEventListener('input', () => {
    const id = input.id;
    const statusEl = document.getElementById(id + '-status');
    if (regexPatterns[id].test(input.value)) {
      statusEl.textContent = "✅";
      statusEl.style.color = "var(--success)";
    } else {
      statusEl.textContent = "❌";
      statusEl.style.color = "var(--error)";
    }
    if (window.twemoji) twemoji.parse(statusEl, {folder: 'svg', ext: '.svg'});
    const allValid = ['linkedin','twitter','facebook'].every(
      key => regexPatterns[key].test(document.getElementById(key).value)
    );
    document.getElementById('submit-btn').disabled = !allValid;
  });
});


async function startProcess() {
  const allValid = ['linkedin', 'twitter', 'facebook'].every(
    key => regexPatterns[key].test(document.getElementById(key).value)
  );
  if (!allValid) {
    alert('Please enter valid URLs for all three profiles before continuing.');
    return;
  }

  document.getElementById('form-screen').style.display = 'none';
  const loadingScreen = document.getElementById('loading-screen');
  loadingScreen.style.display = 'flex';
  const stepEl = document.getElementById('loading-step');
  const progressFill = document.getElementById('progress-fill');

  const urls = [
    document.getElementById('linkedin').value.trim(),
    document.getElementById('twitter').value.trim(),
    document.getElementById('facebook').value.trim()
  ];

  const processedUrls = urls;

  function showStep(text, pct) {
    stepEl.textContent = text;
    stepEl.style.animation = "none";
    stepEl.offsetHeight;
    stepEl.style.animation = "fadeUp 1s ease forwards";
    progressFill.style.width = Math.round(pct * 100) + "%";
  }

  try {
    const proxyResults = [];
    for (let i = 0; i < processedUrls.length; i++) {
      showStep(`Fetching profile ${i + 1} of ${processedUrls.length}...`, 0.05 + 0.2 * i);
      const proxyResp = await fetch('/api/scrapfly_proxy.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: [processedUrls[i]] })
      });

      if (!proxyResp.ok) {
        const txt = await proxyResp.text();
        throw new Error(`Proxy error ${proxyResp.status}: ${txt}`);
      }

      const proxyJson = await proxyResp.json();
      if (!proxyJson.results || !Array.isArray(proxyJson.results)) {
        throw new Error('Invalid response from scraper proxy.');
      }

      proxyResults.push(proxyJson.results[0]);
    }

    showStep('Preparing AI prompt...', 0.65);
    const scrapedSummary = proxyResults.map(r => {
      if (!r.ok) return `${r.url} → ERROR: ${r.error || JSON.stringify(r.response).slice(0,200)}`;
      let raw = '';
      if (typeof r.response === 'object' && r.response.body) raw = String(r.response.body);
      else raw = String(r.response || '');
      let textOnly = raw
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;/g, ' ');
      textOnly = textOnly.replace(/\s+/g, ' ').trim();
      const snippet = textOnly.slice(0,500);
      return `${r.url}\n${snippet}\n---`;
    }).join('\n\n');

    showStep('Sending data to AI for analysis...', 0.85);
    const aiResp = await fetch('/api/openai.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: `You are an assistant analyzing social media profiles for consistency, professionalism, and areas of improvement. Given the following scraped content, provide ONLY JSON with the following fields:

1. "profile_summary": a concise summary of the person's profile and interests.

2. "suggestions": an array of 6-9 objects, each with:
   - "emoji": a single emoji that best represents the suggestion
   - "text": the suggestion text focused on profile consistency, areas to improve, gaps in presence, branding opportunities, etc.

3. "checks": an array of 6-9 objects, each with:
   - "emoji": a single emoji that best fits the constructive criticism
   - "text": the consistency or tone check for professional and appropriate content

4. "final_comments": a plain text string with general feedback on their profiles and how they could improve them overall. If data is given that is insufficient for analysis, state that clearly. Along with that, if data is given that is inconsistent or contradictory, point that out as well, especially if the user provides profile that seem to be from differing people.

Make sure to focus on areas such as professionalism, consistency across profiles, completeness of information, and opportunities for better personal branding. Avoid generic advice; tailor your suggestions and checks to the specific content found in the profiles.

DATA:
${scrapedSummary}

IMPORTANT: Output strictly valid JSON only. Do not include any explanations or extra text outside the JSON object. Each suggestion and check must have both an emoji and text field.`
      })
    });

    if (!aiResp.ok) {
      const txt = await aiResp.text();
      throw new Error(`AI endpoint error ${aiResp.status}: ${txt}`);
    }

    showStep('Formatting results...', 0.95);
    let aiText = await aiResp.text();
    aiText = aiText.trim().replace(/^```json|```$/g, '');

    let aiJson;
    try {
      aiJson = JSON.parse(aiText);
    } catch(e) {
      console.error('Failed to parse AI JSON:', e);
      aiJson = { profile_summary: aiText, suggestions: [], checks: [], final_comments: '' };
    }

    analysisContext.scrapedSummary = scrapedSummary;
    analysisContext.aiJson = aiJson;
    analysisContext.aiRaw = aiText;

    showStep('Rendering suggestions...', 1);
    const finishRender = () => {
      loadingScreen.style.display = 'none';
      const resultsScreen = document.getElementById('results-screen');
      resultsScreen.style.display = 'flex';

      resultsScreen.innerHTML = `
        <h2>Profile Summary</h2>
        <div id="profile-summary" class="md-content" style="text-align:left; max-width:760px;"></div>
        <h2>Areas to Improve</h2>
        <div id="ai-suggestions-list" style="text-align:left; max-width:760px;"></div>
        <h2>Consistency Checks</h2>
        <div id="ai-checks-list" style="text-align:left; max-width:760px;"></div>
        <h2>Final Comments</h2>
        <div id="final-comments" class="feedback-box md-content" style="text-align:left; max-width:760px;"></div>

        <div id="clarify-container" class="clarify-container">
          <div class="clarify-meta">You can ask up to <span id="clarify-remaining">5</span> clarification questions.</div>
          <div id="clarify-messages" class="clarify-messages"></div>
          <div class="clarify-input-row">
            <input id="clarify-input" class="clarify-input" type="text" placeholder="Ask how to implement a suggestion, or what something means…" maxlength="500" />
            <button id="clarify-btn" class="btn clarify-button">Ask</button>
          </div>
        </div>
      `;

      if (!aiJson.profile_summary) {
        setMarkdown(document.getElementById('profile-summary'), "Could not generate profile summary. See raw output below:\n\n" + (analysisContext.aiRaw || ''));
      } else {
        setMarkdown(document.getElementById('profile-summary'), aiJson.profile_summary);
      }

      const suggestionsNode = document.getElementById('ai-suggestions-list');
      if (Array.isArray(aiJson.suggestions)) {
        aiJson.suggestions.forEach(s => {
          const d = document.createElement('div');
          d.className = 'feedback-box md-content';
          if (typeof s === 'object' && s.emoji && s.text) {
            setMarkdown(d, `${s.emoji} ${s.text}`);
          } else {
            setMarkdown(d, String(s));
          }
          suggestionsNode.appendChild(d);
        });
      } else {
        const d = document.createElement('div');
        d.className = 'feedback-box md-content';
        setMarkdown(d, analysisContext.aiRaw || '');
        suggestionsNode.appendChild(d);
      }

      const checksNode = document.getElementById('ai-checks-list');
      checksNode.innerHTML = '';
      if (Array.isArray(aiJson.checks)) {
        aiJson.checks.forEach(c => {
          const div = document.createElement('div');
          div.className = 'feedback-box md-content';
          if (typeof c === 'object' && c.emoji && c.text) {
            setMarkdown(div, `${c.emoji} ${c.text}`);
          } else {
            setMarkdown(div, String(c));
          }
          checksNode.appendChild(div);
        });
      }

      const finalCommentsNode = document.getElementById('final-comments');
      if (aiJson.final_comments) {
        setMarkdown(finalCommentsNode, aiJson.final_comments);
      } else {
        setMarkdown(finalCommentsNode, 'No additional comments provided.');
      }

      const clarifyInput = document.getElementById('clarify-input');
      const clarifyBtn = document.getElementById('clarify-btn');
      const clarifyMsg = document.getElementById('clarify-messages');
      const clarifyRemaining = document.getElementById('clarify-remaining');

      function setClarifyDisabled(disabled) {
        clarifyInput.disabled = disabled;
        clarifyBtn.disabled = disabled;
      }

      function appendQA(role, content) {
        const wrapper = document.createElement('div');
        wrapper.className = `clarify-item ${role}`;
        const box = document.createElement('div');
        box.className = `feedback-box md-content`;
        setMarkdown(box, content);
        wrapper.appendChild(box);
        clarifyMsg.appendChild(wrapper);
        clarifyMsg.scrollTop = clarifyMsg.scrollHeight;
        if (window.twemoji) twemoji.parse(wrapper, {folder: 'svg', ext: '.svg'});
      }

      async function askClarification() {
        const q = (clarifyInput.value || '').trim();
        if (!q) return;
        if (clarifyState.remaining <= 0) return;
        appendQA('user', q);
        clarifyInput.value = '';
        setClarifyDisabled(true);
        try {
          const prompt = `You are answering a clarification question about a previous analysis of a person's social profiles. Use the provided analysis JSON and source context to answer the user's question clearly and practically. If the user asks how to implement something, provide a short step-by-step and concrete tips. You may use Markdown for structure (headings, lists, code blocks) when helpful. Keep it focused; do not restate the entire JSON.\n\nANALYSIS_JSON:\n${JSON.stringify(analysisContext.aiJson, null, 2)}\n\nSOURCE_CONTEXT_SNIPPETS:\n${analysisContext.scrapedSummary}\n\nUSER_QUESTION:\n${q}`;

          const resp = await fetch('/api/openai.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt })
          });
          if (!resp.ok) {
            const t = await resp.text();
            throw new Error(`AI endpoint error ${resp.status}: ${t}`);
          }
          const answer = (await resp.text()).trim();
          appendQA('assistant', answer);
          clarifyState.remaining -= 1;
          clarifyRemaining.textContent = String(clarifyState.remaining);
          if (clarifyState.remaining <= 0) {
            setClarifyDisabled(true);
            clarifyInput.placeholder = 'Limit reached (5/5)';
          } else {
            setClarifyDisabled(false);
          }
        } catch (e) {
          console.error(e);
          appendQA('assistant', 'Sorry, I could not answer that right now. Please try again.');
          setClarifyDisabled(false);
        }
      }

      clarifyBtn.addEventListener('click', askClarification);
      clarifyInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          askClarification();
        }
      });

      const clarifyContainer = document.getElementById('clarify-container');
      const clarifyOuter = document.getElementById('clarify-container')?.parentElement;
      if (clarifyOuter && !document.getElementById('clarify-slot')) {
        const slot = document.createElement('div');
        slot.id = 'clarify-slot';
        clarifyOuter.insertBefore(slot, clarifyContainer);
        slot.appendChild(clarifyContainer);
      }

      const header = document.createElement('div');
      header.className = 'clarify-header';
      header.innerHTML = `
        <div class="clarify-title">Questions about the feedback</div>
        <div class="clarify-actions">
          <button id="clarify-popup-btn" class="btn btn-secondary" type="button" aria-haspopup="dialog">Open chat popup</button>
        </div>`;
      const clarWrap = document.getElementById('clarify-container');
      if (clarWrap && !clarWrap.querySelector('.clarify-header')) {
        clarWrap.insertBefore(header, clarWrap.firstChild);
      }

      let modal = document.getElementById('clarify-modal');
      if (!modal) {
        modal = document.createElement('div');
        modal.id = 'clarify-modal';
        modal.className = 'clarify-modal-overlay';
        modal.innerHTML = `
          <div class="clarify-modal" role="dialog" aria-modal="true" aria-labelledby="clarify-modal-title">
            <button class="clarify-modal-close" aria-label="Close">&times;</button>
            <div class="clarify-modal-title" id="clarify-modal-title">Clarification Chat</div>
            <div class="clarify-modal-body"></div>
          </div>`;
        document.body.appendChild(modal);
      }

      const popupBtn = document.getElementById('clarify-popup-btn');
      const slot = document.getElementById('clarify-slot');
      const modalBody = modal.querySelector('.clarify-modal-body');
      const closeBtn = modal.querySelector('.clarify-modal-close');

      function openClarifyModal() {
        if (!clarWrap || !modalBody) return;
        modalBody.appendChild(clarWrap);
        modal.classList.add('show');
        document.body.style.overflow = 'hidden';
      }
      function closeClarifyModal() {
        if (!slot || !clarWrap) return;
        slot.appendChild(clarWrap);
        modal.classList.remove('show');
        document.body.style.overflow = '';
      }
      popupBtn?.addEventListener('click', openClarifyModal);
      closeBtn?.addEventListener('click', closeClarifyModal);
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeClarifyModal();
      });

      if (window.twemoji) twemoji.parse(resultsScreen, {folder: 'svg', ext: '.svg'});
    };

    const onTransitionEnd = () => {
      clearTimeout(fallbackTimer);
      progressFill.removeEventListener('transitionend', onTransitionEnd);
      finishRender();
    };

    const fallbackTimer = setTimeout(finishRender, 2000);
    progressFill.addEventListener('transitionend', onTransitionEnd);

  } catch(err) {
    console.error(err);
    showStep('Error — see console for details', 0.0);
    setTimeout(() => {
      alert('An error occurred: ' + err.message);
      loadingScreen.style.display = 'none';
      const resultsScreen = document.getElementById('results-screen');
      resultsScreen.style.display = 'flex';
      resultsScreen.innerHTML = `
        <h2>Processing Error</h2>
        <div class="feedback-box">${String(err.message)}</div>
      `;
    }, 800);
  }
}

  document.getElementById('submit-btn').addEventListener('click', startProcess);
});