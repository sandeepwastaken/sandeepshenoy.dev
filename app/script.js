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

  const processedUrls = urls.map((url, index) => {
    if (index === 1) { 
      const match = url.match(/https?:\/\/(www\.)?x\.com\/([A-Za-z0-9_]+)/);
      if (match) {
        const username = match[2];
        return `https://r.jina.ai/https://twitter.com/${username}`;
      }
    }
    return url;
  });

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
      const proxyResp = await fetch('https://sandeepshenoy.dev/api/brightdata_proxy.php', {
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

4. "final_comments": a plain text string with general feedback on their profiles and how they could improve them overall.

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

    showStep('Rendering suggestions...', 1);
    setTimeout(() => {
      loadingScreen.style.display = 'none';
      const resultsScreen = document.getElementById('results-screen');
      resultsScreen.style.display = 'flex';

      resultsScreen.innerHTML = `
        <h2>Profile Summary</h2>
        <pre id="profile-summary" style="white-space:pre-wrap; text-align:left; max-width:760px;"></pre>
        <h2>Areas to Improve</h2>
        <div id="ai-suggestions-list" style="text-align:left; max-width:760px;"></div>
        <h2>Consistency Checks</h2>
        <div id="ai-checks-list" style="text-align:left; max-width:760px;"></div>
        <h2>Final Comments</h2>
        <div id="final-comments" class="feedback-box" style="text-align:left; max-width:760px; white-space:pre-wrap;"></div>
      `;

      if (!aiJson.profile_summary) {
        document.getElementById('profile-summary').textContent = "Could not generate profile summary. See raw output below:\n" + aiText;
      } else {
        document.getElementById('profile-summary').textContent = aiJson.profile_summary;
      }

      const suggestionsNode = document.getElementById('ai-suggestions-list');
      if (Array.isArray(aiJson.suggestions)) {
        aiJson.suggestions.forEach(s => {
          const d = document.createElement('div');
          d.className = 'feedback-box';
          if (typeof s === 'object' && s.emoji && s.text) {
            d.textContent = s.emoji + ' ' + s.text;
          } else {
            d.textContent = String(s);
          }
          suggestionsNode.appendChild(d);
        });
      } else {
        const d = document.createElement('div');
        d.className = 'feedback-box';
        d.textContent = aiText;
        suggestionsNode.appendChild(d);
      }

      const checksNode = document.getElementById('ai-checks-list');
      checksNode.innerHTML = '';
      if (Array.isArray(aiJson.checks)) {
        aiJson.checks.forEach(c => {
          const div = document.createElement('div');
          div.className = 'feedback-box';
          if (typeof c === 'object' && c.emoji && c.text) {
            div.textContent = c.emoji + ' ' + c.text;
          } else {
            div.textContent = String(c);
          }
          checksNode.appendChild(div);
        });
      }

      const finalCommentsNode = document.getElementById('final-comments');
      if (aiJson.final_comments) {
        finalCommentsNode.textContent = aiJson.final_comments;
      } else {
        finalCommentsNode.textContent = 'No additional comments provided.';
      }

      if (window.twemoji) twemoji.parse(resultsScreen, {folder: 'svg', ext: '.svg'});
    }, 600);

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