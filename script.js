window.hue = parseInt(localStorage.getItem('hue-rotation')) || 0;
window.grayscale = parseInt(localStorage.getItem('grayscale')) || 0;
window.selectedFont = localStorage.getItem('selected-font') || 'Nunito';

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

function updateFont(newFont) {
  window.selectedFont = newFont;
  localStorage.setItem('selected-font', newFont);
  document.documentElement.style.setProperty('--selected-font', `'${newFont}'`);
}

function initializeControls() {
  updateHue(window.hue);
  updateGrayscale(window.grayscale);
  updateFont(window.selectedFont);
  
  if (!window.location.pathname.includes('/settings/')) {
    console.log('Not on settings page, skipping control UI creation');
    return;
  }
  
  console.log('Initializing controls on settings page...');
  
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
  container.innerHTML = `
    <div class="settings-container">
      <div class="color-control-section">
        <h3 class="section-title">color control</h3>
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
      </div>
      <img src="/images/div.svg" alt="Divider" class="divider special-case" />
      <div class="visual-settings-section">
        <h3 class="section-title">visual settings</h3>
        <div class="control-group">
          <div class="font-control control">
            <div class="font-dropdown-container">
              <select class="font-dropdown" id="fontDropdown">
                <option value="Nunito">Nunito</option>
                <option value="Inter">Inter</option>
                <option value="Roboto">Roboto</option>
                <option value="Open Sans">Open Sans</option>
                <option value="Lato">Lato</option>
                <option value="Poppins">Poppins</option>
                <option value="Source Sans Pro">Source Sans Pro</option>
                <option value="Montserrat">Montserrat</option>
                <option value="Raleway">Raleway</option>
                <option value="Ubuntu">Ubuntu</option>
                <option value="Fira Sans">Fira Sans</option>
                <option value="Work Sans">Work Sans</option>
                <option value="Playfair Display">Playfair Display</option>
                <option value="Merriweather">Merriweather</option>
                <option value="Crimson Text">Crimson Text</option>
              </select>
            </div>
            <div class="font-label" id="fontLabel">font family - ${window.selectedFont}</div>
          </div>
        </div>
      </div>
    </div>
  `;
  
  createHueSlider();
  createGrayscaleSlider();
  createFontDropdown();
  
  console.log('All controls created and events attached');
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

function createFontDropdown() {
  const dropdown = document.getElementById('fontDropdown');
  const label = document.getElementById('fontLabel');
  
  dropdown.value = window.selectedFont;
  
  dropdown.addEventListener('change', (e) => {
    const newFont = e.target.value;
    updateFont(newFont);
    label.textContent = `font family - ${newFont}`;
  });
}

window.updateHue = updateHue;
window.updateGrayscale = updateGrayscale;
window.updateFont = updateFont;
