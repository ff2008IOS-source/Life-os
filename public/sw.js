/* Push only. Private pages and API responses are never cached. */
self.addEventListener('push', event => {
 let data={};try{data=event.data?.json()??{}}catch{}
 event.waitUntil(self.registration.showNotification('Life OS', {body:'You have an update in your private workspace.',tag:String(data.tag??'lifeos'),data:{url:'/notifications'},icon:'/icon-192.png'}));
});
self.addEventListener('notificationclick',event=>{event.notification.close();event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(async windows=>{const current=windows.find(w=>new URL(w.url).origin===self.location.origin);if(current){await current.navigate('/notifications');return current.focus();}return clients.openWindow('/notifications');}));});
