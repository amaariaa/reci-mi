const CACHE='meine-stempeluhr-v1.4.1';
const FILES=['./','./index.html','./styles.css','./manifest.webmanifest','./icon-192.png','./icon-512.png'];
self.addEventListener('install',e=>{
 e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',e=>{
 e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('meine-stempeluhr-v')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',e=>{
 if(e.request.method!=='GET'||new URL(e.request.url).origin!==self.location.origin)return;
 e.respondWith(fetch(e.request).then(response=>{
   if(response.ok){const cloned=response.clone();caches.open(CACHE).then(cache=>cache.put(e.request,cloned)).catch(()=>{});}
   return response;
 }).catch(()=>caches.match(e.request).then(hit=>hit||caches.match('./index.html'))));
});
