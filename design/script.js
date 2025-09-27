const btn = document.querySelector('.default-button');
btn.addEventListener('mousedown', function() {
  btn.classList.add('clicked');
});
btn.addEventListener('mouseup', function() {
  btn.classList.remove('clicked');
});
btn.addEventListener('mouseleave', function() {
  btn.classList.remove('clicked');
});

const glow = document.getElementById('cursor-glow');
const dot = document.getElementById('cursor-dot');
let targetX = window.innerWidth / 2;
let targetY = window.innerHeight / 2;
let currentX = targetX;
let currentY = targetY;
const ease = 0.05;
document.addEventListener('mousemove', function(e) {
  targetX = e.clientX;
  targetY = e.clientY;
});

function animateGlow() {
  currentX += (targetX - currentX) * ease;
  currentY += (targetY - currentY) * ease;
  glow.style.left = `${currentX}px`;
  glow.style.top = `${currentY}px`;
  const dx = targetX - currentX;
  const dy = targetY - currentY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const blur = Math.max(100, dist * 1.5);
  glow.style.filter = `blur(${blur}px)`;
  requestAnimationFrame(animateGlow);
}
animateGlow();
