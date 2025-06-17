const uploadBtn = document.getElementById('upload-btn');
const fileInput = document.getElementById('file-upload');
const trackList = document.getElementById('track-list');
const playPauseBtn = document.getElementById('play-pause');
const skipBtn = document.getElementById('skip');
const shuffleBtn = document.getElementById('shuffle');

const bgColorInput = document.getElementById('bg-color');
const primaryColorInput = document.getElementById('primary-color');
const accentColorInput = document.getElementById('accent-color');
const settingsToggle = document.getElementById('settings-toggle');
const settingsPanel = document.getElementById('settings-panel');

let currentTrackIndex = 0;
let tracks = [];
let audio = new Audio();

uploadBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', (e) => {
  const files = [...e.target.files];
  files.forEach(file => {
    const url = URL.createObjectURL(file);
    tracks.push({ name: file.name, url });
  });
  renderTrackList();
  playTrack(0);
});

function renderTrackList() {
  trackList.innerHTML = '';
  tracks.forEach((track, index) => {
    const li = document.createElement('li');
    li.textContent = track.name;
    li.addEventListener('click', () => playTrack(index));
    trackList.appendChild(li);
  });
}

function playTrack(index) {
  currentTrackIndex = index;
  audio.src = tracks[index].url;
  audio.play();
  playPauseBtn.textContent = '⏸️';
}

playPauseBtn.addEventListener('click', () => {
  if (audio.paused) {
    audio.play();
    playPauseBtn.textContent = '⏸️';
  } else {
    audio.pause();
    playPauseBtn.textContent = '▶️';
  }
});

skipBtn.addEventListener('click', () => {
  currentTrackIndex = (currentTrackIndex + 1) % tracks.length;
  playTrack(currentTrackIndex);
});

shuffleBtn.addEventListener('click', () => {
  currentTrackIndex = Math.floor(Math.random() * tracks.length);
  playTrack(currentTrackIndex);
});

audio.addEventListener('ended', () => {
  skipBtn.click(); // auto-loop by default
});

// Settings panel toggle
settingsToggle.addEventListener('click', () => {
  settingsPanel.classList.toggle('show');
});

// Theme customization
[bgColorInput, primaryColorInput, accentColorInput].forEach(input => {
  input.addEventListener('input', () => {
    document.documentElement.style.setProperty(`--${input.id}`, input.value);
  });
});
