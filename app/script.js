document.addEventListener('DOMContentLoaded', function() {
  if (window.twemoji) {
    twemoji.parse(document.body, {folder: 'svg', ext: '.svg'});
  }
});

const regexPatterns = {
  linkedin: /^https?:\/\/(www\.)?linkedin\.com\/.*$/,
  twitter: /^https?:\/\/(www\.)?x\.com\/[A-Za-z0-9_]+$/,
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

  function showStep(text, pct) {
    stepEl.textContent = text;
    stepEl.style.animation = "none";
    stepEl.offsetHeight;
    stepEl.style.animation = "fadeUp 1s ease forwards";
    progressFill.style.width = Math.round(pct * 100) + "%";
  }

  try {
    const proxyResults = [];
    for (let i = 0; i < urls.length; i++) {
      showStep(`Fetching profile ${i + 1} of ${urls.length}...`, 0.05 + 0.2 * i);
      const proxyResp = await fetch('https://sandeepshenoy.dev/api/brightdata_proxy.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: [urls[i]] })
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
      let snippet = '';
      if (typeof r.response === 'object' && r.response.body) snippet = r.response.body.slice(0,1000);
      else snippet = String(r.response).slice(0,1000);
      return `${r.url}\n${snippet}\n---`;
    }).join('\n\n');

    showStep('Sending data to AI for analysis...', 0.85);
    const aiResp = await fetch('/api/openai.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: `You are given scraped social media content for the following profiles. Provide (1) a short profile summary (2) 3 suggested follow-ups the user can post, and (3) simple consistency checks for tone/content.\n\nDATA:\n${scrapedSummary}\n\nOutput in JSON: { "profile_summary": "...", "suggestions": ["..."], "checks": ["..."] }`
      })
    });

    if (!aiResp.ok) {
      const txt = await aiResp.text();
      throw new Error(`AI endpoint error ${aiResp.status}: ${txt}`);
    }

    showStep('Formatting results...', 0.95);
    const aiText = await aiResp.text();
    let aiJson = null;
    try { aiJson = JSON.parse(aiText); } catch(e) { aiJson = { raw: aiText }; }

    showStep('Rendering suggestions...', 1);
    setTimeout(() => {
      loadingScreen.style.display = 'none';
      const resultsScreen = document.getElementById('results-screen');
      resultsScreen.style.display = 'flex';

      resultsScreen.innerHTML = `
        <h2>Profile Summary</h2>
        <pre id="profile-summary" style="white-space:pre-wrap; text-align:left; max-width:760px;"></pre>
        <h2>AI Suggestions</h2>
        <div id="ai-suggestions-list" style="text-align:left; max-width:760px;"></div>
      `;

      document.getElementById('profile-summary').textContent = aiJson.profile_summary || aiJson.raw || aiText;

      const suggestionsNode = document.getElementById('ai-suggestions-list');
      if (Array.isArray(aiJson.suggestions)) {
        aiJson.suggestions.forEach(s => {
          const d = document.createElement('div');
          d.className = 'feedback-box';
          d.textContent = '💡 ' + s;
          suggestionsNode.appendChild(d);
        });
      } else {
        const d = document.createElement('div');
        d.className = 'feedback-box';
        d.textContent = aiText;
        suggestionsNode.appendChild(d);
      }
    }, 600);

  } catch(err) {
    console.error(err);
    showStep('Error — see console for details', 0.0);
    setTimeout(() => {
      alert('An error occurred: ' + err.message);
      loadingScreen.style.display = 'none';
      document.getElementById('results-screen').style.display = 'flex';
    }, 800);
  }
}