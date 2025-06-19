const modal = document.getElementById('modal');
const confirmBtn = document.getElementById('confirm-btn');
const cancelBtn = document.getElementById('cancel-btn');
const background = document.querySelector('.background');
const fileEl = document.querySelector('.file');

let droppedImageFile = null;
let fileHover = false;
let lastX = 0, lastY = 0;
let prevX = 0;
let rotation = 0;
let floatXOffset = 0;
let floatYOffset = 0;
let animating = false;

fileEl.style.cssText = `
  opacity: 0;
  filter: blur(50px);
  position: fixed;
  pointer-events: none;
  transition: left 0.2s ease-out, top 0.2s ease-out, opacity 0.4s, filter 0.4s;
`;

window.addEventListener('DOMContentLoaded', () => {
  const cookies = Object.fromEntries(document.cookie.split('; ').map(c => {
    const [k, v] = c.split('=');
    return [k, decodeURIComponent(v)];
  }));
  if (cookies.backgroundUrl) {
    background.style.backgroundImage = `url('${cookies.backgroundUrl}')`;
  }
});

window.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  fileHover = true;
  lastX = e.clientX;
  lastY = e.clientY;

  fileEl.style.opacity = '1';
  fileEl.style.filter = 'blur(0px)';

  if (!animating) {
    animating = true;
    requestAnimationFrame(updateFileEl);
  }
});

window.addEventListener('drop', (e) => {
  e.preventDefault();
  fileHover = false;
  fileEl.style.opacity = '0';
  fileEl.style.filter = 'blur(50px)';

  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) {
    droppedImageFile = file;
    modal.classList.remove('hidden');
  }
});

document.addEventListener('dragleave', () => {
  fileHover = false;
  fileEl.style.opacity = '0';
  fileEl.style.filter = 'blur(50px)';
});

cancelBtn.addEventListener('click', () => {
  droppedImageFile = null;
  modal.classList.add('hidden');
});

confirmBtn.addEventListener('click', () => {
  if (!droppedImageFile) return;

  const formData = new FormData();
  formData.append('image', droppedImageFile);

  fetch('https://api.imgur.com/3/image', {
    method: 'POST',
    headers: { Authorization: 'Client-ID 714470964a0a179' },
    body: formData
  })
    .then(res => res.json())
    .then(data => {
      const url = data.data.link;
      document.cookie = `backgroundUrl=${encodeURIComponent(url)}; path=/; max-age=31536000`;
      background.style.backgroundImage = `url('${url}')`;
      modal.classList.add('hidden');
    })
    .catch(() => {
      alert('Failed to upload image.');
      modal.classList.add('hidden');
    });
});

function updateFileEl() {
  const dx = lastX - prevX;
  const swingTarget = Math.abs(dx) > 1 ? Math.max(-30, Math.min(30, -dx * 1.2)) : 0;
  rotation += (swingTarget - rotation) * 0.12;
    const now = performance.now();
    floatXOffset = Math.sin(now / 200) * 10;
    floatYOffset = Math.cos(now / 200) * 10;

  fileEl.style.left = `${lastX}px`;
  fileEl.style.top = `${lastY}px`;
  fileEl.style.transform = `rotate(${rotation}deg) translateX(${floatXOffset}px) translateY(${floatYOffset}px)`;

  prevX = lastX;

  if (fileHover || Math.abs(rotation) > 0.1) {
    requestAnimationFrame(updateFileEl);
  } else {
    rotation = 0;
    floatXOffset = 0;
    floatYOffset = 0;
    fileEl.style.transform = 'rotate(0deg) translateY(0px)';
    animating = false;
  }
}
