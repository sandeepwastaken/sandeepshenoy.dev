window.hue = parseInt(localStorage.getItem('hue-rotation')) || 0;

function updateHue(newHue) {
  window.hue = newHue;
  localStorage.setItem('hue-rotation', newHue);
  document.documentElement.style.setProperty('--hue-rotation', `${newHue}deg`);
}

function initializeHueControl() {
  
  updateHue(window.hue);
  
  
  if (!window.location.pathname.includes('/settings/')) {
    console.log('Not on settings page, skipping hue control UI creation');
    return;
  }
  
  console.log('Initializing hue control on settings page...');
  
  let container = document.getElementById('hue-control-container');
  console.log('Container found:', container);
  
  
  if (!container) {
    console.log('No container found, creating one...');
    const mainContent = document.querySelector('.main-content');
    const settingsTitle = document.querySelector('.settings-title');
    
    
    if (mainContent && settingsTitle) {
      container = document.createElement('div');
      container.id = 'hue-control-container';
      settingsTitle.insertAdjacentElement('afterend', container);
      console.log('Container created:', container);
    } else {
      console.log('Not on settings page (no settings-title found)');
      return;
    }
  }
  
  if (container) {
    console.log('Creating hue control...');
    createHueControl(container);
  } else {
    console.log('Still no container found, trying again in 100ms...');
    setTimeout(initializeHueControl, 100);
  }
}


document.addEventListener('DOMContentLoaded', initializeHueControl);
window.addEventListener('load', initializeHueControl);


if (document.readyState === 'loading') {
  console.log('DOM is loading, waiting...');
} else {
  console.log('DOM already ready, initializing immediately');
  initializeHueControl();
}

function createHueControl(container) {
  
  container.innerHTML = `
    <div class="hue-control">
      <div class="hue-slider" id="hueSlider">
        <div class="hue-track"></div>
        <div class="hue-handle" id="hueHandle"></div>
      </div>
      <div class="hue-label" id="hueLabel">hue rotation - ${window.hue}°/359°</div>
    </div>
  `;
  
  const slider = document.getElementById('hueSlider');
  const handle = document.getElementById('hueHandle');
  const label = document.getElementById('hueLabel');
  
  let isDragging = false;
  let isClickOnBar = false;
  
  function updateSlider(hueValue, useEasing = false) {
    const percentage = (hueValue / 359) * 100;
    
    
    if (useEasing) {
      handle.style.transition = 'left 0.3s ease-out';
    } else {
      handle.style.transition = 'none';
    }
    
    handle.style.left = percentage + '%';
    label.textContent = `hue rotation - ${hueValue}°/359°`;
    updateHue(hueValue);
    
    
    if (useEasing) {
      setTimeout(() => {
        if (!isDragging) {
          handle.style.transition = 'none';
        }
      }, 300);
    }
  }
  
  function getHueFromEvent(event) {
    const rect = slider.getBoundingClientRect();
    const x = (event.clientX || event.touches[0].clientX) - rect.left;
    const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
    return Math.round((percentage / 100) * 359);
  }
  
  
  updateSlider(window.hue);
  
  
  function onMouseDown(e) {
    
    isClickOnBar = e.target !== handle;
    
    isDragging = true;
    const hue = getHueFromEvent(e);
    
    
    updateSlider(hue, isClickOnBar);
    
    e.preventDefault();
    console.log('Mouse down, dragging started, clicked on bar:', isClickOnBar);
  }
  
  function onMouseMove(e) {
    if (!isDragging) return;
    const hue = getHueFromEvent(e);
    
    
    updateSlider(hue, false);
    
    e.preventDefault();
    console.log('Dragging, hue:', hue);
  }
  
  function onMouseUp(e) {
    if (isDragging) {
      isDragging = false;
      isClickOnBar = false;
      console.log('Mouse up, dragging stopped');
    }
  }
  
  
  function onTouchStart(e) {
    
    isClickOnBar = e.target !== handle;
    
    isDragging = true;
    const hue = getHueFromEvent(e);
    
    
    updateSlider(hue, isClickOnBar);
    
    e.preventDefault();
    console.log('Touch start, dragging started, touched on bar:', isClickOnBar);
  }
  
  function onTouchMove(e) {
    if (!isDragging) return;
    const hue = getHueFromEvent(e);
    
    
    updateSlider(hue, false);
    
    e.preventDefault();
    console.log('Touch move, hue:', hue);
  }
  
  function onTouchEnd(e) {
    if (isDragging) {
      isDragging = false;
      isClickOnBar = false;
      console.log('Touch end, dragging stopped');
    }
  }
  
  
  slider.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
  
  slider.addEventListener('touchstart', onTouchStart);
  document.addEventListener('touchmove', onTouchMove);
  document.addEventListener('touchend', onTouchEnd);
  
  console.log('Hue control created and events attached');
}

window.updateHue = updateHue;
