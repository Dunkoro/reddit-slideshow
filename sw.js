self.addEventListener('install', event => {
    console.log("Service Worker Installed");
});

self.addEventListener('fetch', event => {
    // A bare-minimum fetch listener is required by Chrome to trigger the install prompt
});
