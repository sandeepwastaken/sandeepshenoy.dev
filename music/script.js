const modal = document.getElementById('modal');
const confirmBtn = document.getElementById('confirm-btn');
const cancelBtn = document.getElementById('cancel-btn');
const background = document.querySelector('.background');

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

// Load saved background
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