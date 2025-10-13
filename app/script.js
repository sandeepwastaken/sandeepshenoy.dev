document.addEventListener('DOMContentLoaded', function() {
  if (window.twemoji) {
    twemoji.parse(document.body, {folder: 'svg', ext: '.svg'});
  }
});

const regexPatterns = {
  linkedin: /^https?:\/\/(www\.)?linkedin\.com\/.*$/,
  twitter: /^https?:\/\/(www\.)?x\.com\/[A-Za-z0-9_]+$/,
  facebook: /^https?:\/\/(www\.)?facebook\.com\/[A-Za-z0-9\.]+$/
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

    if (window.twemoji) {
      twemoji.parse(statusEl, {folder: 'svg', ext: '.svg'});
    }

    const allValid = ['linkedin', 'twitter', 'facebook'].every(
      key => regexPatterns[key].test(document.getElementById(key).value)
    );
    document.getElementById('submit-btn').disabled = !allValid;
  });
});

function startProcess() {
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
  const steps = [
    "Finding mentions of user...",
    "Compiling data...",
    "Cleaning up content...",
    "Summarizing insights...",
    "Adding feedback..."
  ];
  
  let stepIndex = 0;
  const stepEl = document.getElementById('loading-step');
  const progressFill = document.getElementById('progress-fill');

  function nextStep() {
    if (stepIndex < steps.length) {
      stepEl.textContent = steps[stepIndex];
      stepEl.style.animation = "none";
      stepEl.offsetHeight;
      stepEl.style.animation = null;
      stepEl.style.animation = "fadeUp 1s ease forwards";

      progressFill.style.width = ((stepIndex + 1) / steps.length) * 100 + "%";
      stepIndex++;
      setTimeout(nextStep, 1500);
    } else {
      setTimeout(() => {
        loadingScreen.style.display = 'none';
          const resultsScreen = document.getElementById('results-screen');
          if (resultsScreen) {
            resultsScreen.style.display = 'flex';
          }
      }, 800);
    }
  }
  nextStep();
}
