window.hue = parseInt(localStorage.getItem('hue-rotation')) || 0;
window.grayscale = parseInt(localStorage.getItem('grayscale')) || 0;

function updateHue(newHue) {
  window.hue = newHue;
  localStorage.setItem('hue-rotation', newHue);
  document.documentElement.style.setProperty('--hue-rotation', `${newHue}deg`);
}

function updateGrayscale(newGrayscale) {
  window.grayscale = newGrayscale;
  localStorage.setItem('grayscale', newGrayscale);
  document.documentElement.style.setProperty('--grayscale', `${newGrayscale}%`);
}

function initializeControls() {
  // Always apply the effects on all pages
  updateHue(window.hue);
  updateGrayscale(window.grayscale);
  
  // Only initialize control UIs on the settings page
  if (!window.location.pathname.includes('/settings/')) {
    console.log('Not on settings page, skipping control UI creation');
    return;
  }
  
  console.log('Initializing controls on settings page...');
  
  let container = document.getElementById('hue-control-container');
  console.log('Container found:', container);
  
  // Only create container if we're specifically on the settings page
  if (!container) {
    console.log('No container found, creating one...');
    const mainContent = document.querySelector('.main-content');
    const settingsTitle = document.querySelector('.settings-title');
    
    // Double check we're on settings page by looking for settings-specific elements
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
    console.log('Creating controls...');
    createControls(container);
  } else {
    console.log('Still no container found, trying again in 100ms...');
    setTimeout(initializeControls, 100);
  }
}


document.addEventListener('DOMContentLoaded', initializeControls);
window.addEventListener('load', initializeControls);

if (document.readyState === 'loading') {
  console.log('DOM is loading, waiting...');
} else {
  console.log('DOM already ready, initializing immediately');
  initializeControls();
}

function createControls(container) {
  // Create both hue and grayscale controls
  container.innerHTML = `
    <div class="control-group">
      <div class="hue-control control">
        <div class="hue-slider" id="hueSlider">
          <div class="hue-track"></div>
          <div class="hue-handle" id="hueHandle"></div>
        </div>
        <div class="hue-label" id="hueLabel">hue rotation - ${window.hue}°/359°</div>
      </div>
      
      <div class="grayscale-control control">
        <div class="grayscale-slider" id="grayscaleSlider">
          <div class="grayscale-track"></div>
          <div class="grayscale-handle" id="grayscaleHandle"></div>
        </div>
        <div class="grayscale-label" id="grayscaleLabel">grayscale - ${window.grayscale}%/100%</div>
      </div>
    </div>
  `;
  
  // Initialize hue control
  createHueSlider();
  
  // Initialize grayscale control
  createGrayscaleSlider();
  
  console.log('Both controls created and events attached');
}

function createHueSlider() {
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
  }
  
  function onMouseMove(e) {
    if (!isDragging) return;
    const hue = getHueFromEvent(e);
    updateSlider(hue, false);
    e.preventDefault();
  }
  
  function onMouseUp(e) {
    if (isDragging) {
      isDragging = false;
      isClickOnBar = false;
    }
  }
  
  slider.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
  
  slider.addEventListener('touchstart', (e) => {
    isClickOnBar = e.target !== handle;
    isDragging = true;
    const hue = getHueFromEvent(e);
    updateSlider(hue, isClickOnBar);
    e.preventDefault();
  });
  
  document.addEventListener('touchmove', (e) => {
    if (!isDragging) return;
    const hue = getHueFromEvent(e);
    updateSlider(hue, false);
    e.preventDefault();
  });
  
  document.addEventListener('touchend', () => {
    if (isDragging) {
      isDragging = false;
      isClickOnBar = false;
    }
  });
}

function createGrayscaleSlider() {
  const slider = document.getElementById('grayscaleSlider');
  const handle = document.getElementById('grayscaleHandle');
  const label = document.getElementById('grayscaleLabel');
  
  let isDragging = false;
  let isClickOnBar = false;
  
  function updateSlider(grayscaleValue, useEasing = false) {
    const percentage = (grayscaleValue / 100) * 100;
    
    if (useEasing) {
      handle.style.transition = 'left 0.3s ease-out';
    } else {
      handle.style.transition = 'none';
    }
    
    handle.style.left = percentage + '%';
    label.textContent = `grayscale - ${grayscaleValue}%/100%`;
    updateGrayscale(grayscaleValue);
    
    if (useEasing) {
      setTimeout(() => {
        if (!isDragging) {
          handle.style.transition = 'none';
        }
      }, 300);
    }
  }
  
  function getGrayscaleFromEvent(event) {
    const rect = slider.getBoundingClientRect();
    const x = (event.clientX || event.touches[0].clientX) - rect.left;
    const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
    return Math.round(percentage);
  }
  
  updateSlider(window.grayscale);
  
  function onMouseDown(e) {
    isClickOnBar = e.target !== handle;
    isDragging = true;
    const grayscale = getGrayscaleFromEvent(e);
    updateSlider(grayscale, isClickOnBar);
    e.preventDefault();
  }
  
  function onMouseMove(e) {
    if (!isDragging) return;
    const grayscale = getGrayscaleFromEvent(e);
    updateSlider(grayscale, false);
    e.preventDefault();
  }
  
  function onMouseUp(e) {
    if (isDragging) {
      isDragging = false;
      isClickOnBar = false;
    }
  }
  
  slider.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
  
  slider.addEventListener('touchstart', (e) => {
    isClickOnBar = e.target !== handle;
    isDragging = true;
    const grayscale = getGrayscaleFromEvent(e);
    updateSlider(grayscale, isClickOnBar);
    e.preventDefault();
  });
  
  document.addEventListener('touchmove', (e) => {
    if (!isDragging) return;
    const grayscale = getGrayscaleFromEvent(e);
    updateSlider(grayscale, false);
    e.preventDefault();
  });
  
  document.addEventListener('touchend', () => {
    if (isDragging) {
      isDragging = false;
      isClickOnBar = false;
    }
  });
}

window.updateHue = updateHue;
window.updateGrayscale = updateGrayscale;
