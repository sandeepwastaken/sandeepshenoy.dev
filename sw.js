const CACHE_NAME = 'sandeepshenoy-v' + Date.now();
const STATIC_CACHE = 'static-v1';


const CACHE_FILES = [
  '/',
  '/offline.html',
  '/styles.css',
  '/images/logo.svg',
  '/images/offline.svg',
  '/images/offline.png',
  '/images/div.svg',
  'https://fonts.googleapis.com/css2?family=Nunito:wght@400;600&display=swap'
];


self.addEventListener('install', (event) => {
  console.log('Service Worker installing...');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('Caching files...');
      return cache.addAll(CACHE_FILES);
    }).then(() => {
      return self.skipWaiting();
    })
  );
});


self.addEventListener('activate', (event) => {
  console.log('Service Worker activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME && cacheName !== STATIC_CACHE) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});


self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);
  
  // Handle navigation requests (page loads)
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).then((response) => {
        return response;
      }).catch(() => {
        // Return offline page for any failed navigation
        return caches.match('/offline.html');
      })
    );
    return;
  }
  
  // Special handling for critical files
  if (requestUrl.pathname === '/styles.css' || requestUrl.pathname === '/offline.html') {
    event.respondWith(
      fetch(event.request, {
        cache: 'no-cache',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      }).then((response) => {
        // Clone the response to cache it
        const responseClone = response.clone();
        
        // Cache the response
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseClone);
        });
        
        return response;
      }).catch(() => {
        // Return cached version if network fails
        return caches.match(event.request);
      })
    );
    return;
  }
  
  // Handle all other requests with cache-first strategy
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      
      return fetch(event.request).then((response) => {
        // Only cache successful responses
        if (response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      }).catch(() => {
        // For HTML requests, return offline page
        if (event.request.headers.get('accept') && 
            event.request.headers.get('accept').includes('text/html')) {
          return caches.match('/offline.html');
        }
        
        // For other requests, return a generic offline response
        return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
      });
    })
  );
});


self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
