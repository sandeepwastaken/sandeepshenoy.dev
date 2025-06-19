const modal = document.getElementById('modal');
const confirmBtn = document.getElementById('confirm-btn');
const cancelBtn = document.getElementById('cancel-btn');
const background = document.querySelector('.background');
const fileEl = document.querySelector('.file');
let prevX = 0, prevY = 0;
let rotation = 0;
var fileHover = false;
fileEl.style.opacity = '0';
fileEl.style.filter = 'blur(50px)';
fileEl.style.position = 'fixed';
fileEl.style.pointerEvents = 'none';

let droppedImageFile = null;

window.addEventListener('dragover', e => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});

window.addEventListener('drop', e => {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) {
    droppedImageFile = file;
    modal.classList.remove('hidden');
  }
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
    headers: {
      Authorization: 'Client-ID 714470964a0a179'
    },
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

window.addEventListener('DOMContentLoaded', () => {
  const cookies = document.cookie.split('; ').reduce((acc, c) => {
    const [key, val] = c.split('=');
    acc[key] = decodeURIComponent(val);
    return acc;
  }, {});
  if (cookies.backgroundUrl) {
    background.style.backgroundImage = `url('${cookies.backgroundUrl}')`;
  }
});

if (fileEl) {
  let lastX = 0, lastY = 0, animating = false;

  fileEl.style.transition = 'left 0.2s ease-out, top 0.2s ease-out, opacity 0.4s, filter 0.4s';
  fileEl.style.opacity = '0';
  fileEl.style.filter = 'blur(50px)';

  document.addEventListener('dragover', (e) => {
    fileHover = true;
    lastX = e.clientX;
    lastY = e.clientY;
    fileEl.style.position = 'fixed';
    fileEl.style.pointerEvents = 'none';

    if (!animating) {
      animating = true;
      requestAnimationFrame(moveFileEl);
    }

    fileEl.style.opacity = '1';
    fileEl.style.filter = 'blur(0px)';
  });

  function moveFileEl() {
  const dx = lastX - prevX;

  let swingTarget = 0;
  if (Math.abs(dx) > 1) {
    swingTarget = Math.max(-30, Math.min(30, -dx * 1.2)); 
  } else if (fileHover) {
    swingTarget = 0;
  } else {
    swingTarget = 0;
  }

  rotation += (swingTarget - rotation) * 0.12;

  fileEl.style.left = `${lastX}px`;
  fileEl.style.top = `${lastY}px`;
  fileEl.style.transform = `rotate(${rotation}deg)`;

  prevX = lastX;

  if (fileHover || Math.abs(rotation) > 0.1) {
    requestAnimationFrame(moveFileEl);
  } else {
    rotation = 0;
    fileEl.style.transform = `rotate(0deg)`;
    animating = false;
  }
}

  document.addEventListener('dragleave', (e) => {
    fileHover = false;
    fileEl.style.opacity = '0';
    fileEl.style.filter = 'blur(50px)';
  });

  document.addEventListener('drop', (e) => {
    fileHover = false;
    fileEl.style.opacity = '0';
    fileEl.style.filter = 'blur(50px)';
  });
}
