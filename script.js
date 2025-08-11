window.hue = 0;

function updateHue(newHue) {
  window.hue = newHue;
  document.documentElement.style.setProperty('--hue-rotation', `${newHue}deg`);
  console.log(`Hue updated to: ${newHue}°`);
}

document.addEventListener('DOMContentLoaded', () => {
  updateHue(window.hue);
});

window.updateHue = updateHue;
