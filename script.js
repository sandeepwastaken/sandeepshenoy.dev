window.hue = parseInt(localStorage.getItem('hue-rotation')) || 0;

function updateHue(newHue) {
  window.hue = newHue;
  localStorage.setItem('hue-rotation', newHue);
  document.documentElement.style.setProperty('--hue-rotation', `${newHue}deg`);
}

document.addEventListener('DOMContentLoaded', () => {
  updateHue(window.hue);
  
  const hueHandle = document.getElementById('hueHandle');
  const hueLabel = document.getElementById('hueLabel');
  const hueSlider = document.querySelector('.hue-slider');
  
  if (hueHandle && hueSlider) {
    const sliderWidth = 300;
    let isDragging = false;
    
    function updateHueDisplay(value) {
      const percentage = (value / 359) * 100;
      hueHandle.style.left = `${percentage}%`;
      if (hueLabel) {
        hueLabel.textContent = `hue rotation - ${value}°/359°`;
      }
      updateHue(value);
    }
    
    function getHueFromPosition(clientX) {
      const rect = hueSlider.getBoundingClientRect();
      const x = clientX - rect.left;
      const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
      return Math.round((percentage / 100) * 359);
    }
    
    updateHueDisplay(window.hue);
    
    hueSlider.addEventListener('mousedown', (e) => {
      isDragging = true;
      const newHue = getHueFromPosition(e.clientX);
      updateHueDisplay(newHue);
    });
    
    document.addEventListener('mousemove', (e) => {
      if (isDragging) {
        const newHue = getHueFromPosition(e.clientX);
        updateHueDisplay(newHue);
      }
    });
    
    document.addEventListener('mouseup', () => {
      isDragging = false;
    });
    
    hueSlider.addEventListener('touchstart', (e) => {
      isDragging = true;
      const touch = e.touches[0];
      const newHue = getHueFromPosition(touch.clientX);
      updateHueDisplay(newHue);
      e.preventDefault();
    });
    
    document.addEventListener('touchmove', (e) => {
      if (isDragging) {
        const touch = e.touches[0];
        const newHue = getHueFromPosition(touch.clientX);
        updateHueDisplay(newHue);
        e.preventDefault();
      }
    });
    
    document.addEventListener('touchend', () => {
      isDragging = false;
    });
  }
});

window.updateHue = updateHue;
