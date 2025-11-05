const CACHE_NAME = 'sandeepshenoy-v' + Date.now();
const STATIC_CACHE = 'static-v1';


const CACHE_FILES = [
  '/',
  '/offline.html',
  '/styles.css',
  '/images/logo.svg',
  '/images/offline.svg',
  '/images/offline.png',
  '/images/div.svg'
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
  const isSameOrigin = requestUrl.origin === self.location.origin;
  
  
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => response)
        .catch(() => {
          return caches.match('/offline.html').then((r) => r || new Response('Offline', { status: 503, statusText: 'Service Unavailable' }));
        })
    );
    return;
  }
  
  
  if (!isSameOrigin) {
    
    return; 
  }
  
  if (requestUrl.pathname.endsWith('.css') || requestUrl.pathname.endsWith('.js')) {
    event.respondWith(
      fetch(event.request, { cache: 'no-cache' })
      .then((response) => {
        const responseClone = response.clone();
        
        if (event.request.method === 'GET') {
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((r) => r || new Response('', { status: 200, statusText: 'OK' })))
    );
    return;
  }
  
  
  if (requestUrl.pathname === '/styles.css' || requestUrl.pathname === '/offline.html') {
    event.respondWith(
      fetch(event.request, { cache: 'no-cache' }).then((response) => {
        
        const responseClone = response.clone();
        
        if (event.request.method === 'GET') {
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        
        return response;
      }).catch(() => {
        
        return caches.match(event.request).then((r) => r || (requestUrl.pathname.endsWith('.html') ? caches.match('/offline.html') : new Response('', { status: 200 })));
      })
    );
    return;
  }
  
  
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      
      return fetch(event.request).then((response) => {
        
        
        if (event.request.method === 'GET' && response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      }).catch(() => {
        
        if (event.request.headers.get('accept') && 
            event.request.headers.get('accept').includes('text/html')) {
          return caches.match('/offline.html');
        }
        
        
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
