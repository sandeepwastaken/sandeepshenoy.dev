// Cache Test Script
// This script helps test the caching behavior

function testCacheImplementation() {
  console.log('Testing cache implementation...');
  
  // Check if service worker is registered
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(registrations => {
      console.log('Service Worker registrations:', registrations.length);
      registrations.forEach((registration, index) => {
        console.log(`Registration ${index}:`, registration.scope);
      });
    });
  } else {
    console.log('Service Worker not supported');
  }
  
  // Check cache storage
  if ('caches' in window) {
    caches.keys().then(cacheNames => {
      console.log('Available caches:', cacheNames);
      cacheNames.forEach(cacheName => {
        caches.open(cacheName).then(cache => {
          cache.keys().then(requests => {
            console.log(`Cache ${cacheName} contains:`, requests.map(req => req.url));
          });
        });
      });
    });
  } else {
    console.log('Cache API not supported');
  }
}

// Test network/offline detection
function testOfflineHandling() {
  console.log('Network status:', navigator.onLine ? 'Online' : 'Offline');
  
  window.addEventListener('online', () => {
    console.log('Back online');
  });
  
  window.addEventListener('offline', () => {
    console.log('Gone offline');
  });
}

// Run tests
testCacheImplementation();
testOfflineHandling();

console.log('Cache test script loaded. Check console for results.');
