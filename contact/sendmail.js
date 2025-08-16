document.addEventListener('DOMContentLoaded', function() {
  const sendBtn = document.querySelector('.contact-button');
  if (!sendBtn) return;

  sendBtn.addEventListener('click', function(e) {
    e.preventDefault();
    const name = document.querySelector('.name').value.trim();
    const email = document.querySelector('.email').value.trim();
    const subject = document.querySelector('.subject').value.trim();
    const message = document.querySelector('.message').value.trim();

    if (!name || !email || !subject || !message) {
      alert('Please fill in all fields.');
      return;
    }

    const formData = new FormData();
    formData.append('name', name);
    formData.append('email', email);
    formData.append('subject', subject);
    formData.append('message', message);

    fetch('sendmail.php', {
      method: 'POST',
      body: formData
    })
    .then(response => response.text())
    .then(data => {
      if (!data.trim()) {
        alert('No response from server. Please check your PHP script or server logs.');
      } else {
        alert(data);
      }
    })
    .catch(error => {
      alert('Error sending message.');
    });
  });
});
