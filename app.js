const mediaContainer = document.getElementById('media-container');
const uiContainer = document.getElementById('ui-container');
const startBtn = document.getElementById('start-btn');
const playPauseBtn = document.getElementById('play-pause-btn');
const subredditInput = document.getElementById('subreddit-input');
const postTitle = document.getElementById('post-title');
const postSubreddit = document.getElementById('post-subreddit');

// The 3 Speed Inputs
const imgSpeedInput = document.getElementById('img-speed');
const galSpeedInput = document.getElementById('gal-speed');
const vidMaxInput = document.getElementById('vid-max');

// --- STATE MANAGEMENT ---
let posts = [];
let currentIndex = 0;
let slideTimer = null;
let isPlaying = true;
let afterToken = null;
let isFetching = false;
let currentWaitTime = 0;
let idleTimeout;

// --- 1. INITIALIZATION & UI LOGIC ---
function init() {
    const savedSubs = localStorage.getItem('rs_subs');
    if (savedSubs) subredditInput.value = savedSubs;
    
    const savedImg = localStorage.getItem('rs_img_speed');
    if (savedImg) imgSpeedInput.value = savedImg;
    
    const savedGal = localStorage.getItem('rs_gal_speed');
    if (savedGal) galSpeedInput.value = savedGal;
    
    const savedVid = localStorage.getItem('rs_vid_max');
    if (savedVid) vidMaxInput.value = savedVid;

    document.addEventListener('mousemove', wakeUpUI);
    document.addEventListener('touchstart', wakeUpUI);
    
    // Save settings automatically
    [imgSpeedInput, galSpeedInput, vidMaxInput, subredditInput].forEach(input => {
        input.addEventListener('change', () => {
            localStorage.setItem('rs_subs', subredditInput.value);
            localStorage.setItem('rs_img_speed', imgSpeedInput.value);
            localStorage.setItem('rs_gal_speed', galSpeedInput.value);
            localStorage.setItem('rs_vid_max', vidMaxInput.value);
        });
    });
}

function wakeUpUI() {
    document.body.classList.remove('idle');
    clearTimeout(idleTimeout);
    idleTimeout = setTimeout(() => {
        if (isPlaying && posts.length > 0) document.body.classList.add('idle');
    }, 3000);
}

// --- 2. DATA FETCHING ---
async function fetchRedditData(subreddits, append = false) {
    if (isFetching) return;
    isFetching = true;

    try {
        const baseUrl = `https://www.reddit.com/r/${subreddits}.json?limit=50`;
        const targetUrl = append && afterToken ? `${baseUrl}&after=${afterToken}` : baseUrl;
        const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`;

        const response = await fetch(proxyUrl);
        if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
        
        const json = await response.json();
        afterToken = json.data.after;

        const newPosts = [];
        
        json.data.children.forEach(post => {
            const data = post.data;

            if (data.is_gallery && data.media_metadata) {
                Object.values(data.media_metadata).forEach(media => {
                    if (media.s && media.s.u) {
                        const cleanUrl = media.s.u.replace(/&amp;/g, '&');
                        // Explicitly tag this as a gallery item
                        newPosts.push({ title: data.title, subreddit: data.subreddit, isVideo: false, isGalleryItem: true, url: cleanUrl });
                    }
                });
            } else {
                const isExplicitVideo = data.is_video && data.secure_media && data.secure_media.reddit_video;
                const hasVideoExtension = data.url && data.url.match(/\.(mp4|gifv|webm)$/i);
                const isExplicitImage = data.post_hint === 'image';
                const hasImageExtension = data.url && data.url.match(/\.(jpg|jpeg|png|gif)(\?.*)?$/i);
                
                if (data.url && (isExplicitImage || hasImageExtension || isExplicitVideo || hasVideoExtension)) {
                    let mediaUrl = data.url;
                    let isVideoFlag = false;

                    if (isExplicitVideo) {
                        mediaUrl = data.secure_media.reddit_video.fallback_url;
                        isVideoFlag = true;
                    } else if (hasVideoExtension) {
                        isVideoFlag = true;
                        if (mediaUrl.endsWith('.gifv')) mediaUrl = mediaUrl.replace('.gifv', '.mp4');
                    }

                    // Standard posts are never flagged as gallery items
                    newPosts.push({ title: data.title, subreddit: data.subreddit, isVideo: isVideoFlag, isGalleryItem: false, url: mediaUrl });
                }
            }
        });

        if (append) {
            posts = posts.concat(newPosts);
        } else {
            posts = newPosts;
            currentIndex = 0;
            if (posts.length > 0) {
                playPauseBtn.disabled = false;
                renderCurrentPost();
            } else {
                alert("No valid images or videos found.");
            }
        }
    } catch (error) {
        console.error("Network Error:", error);
    } finally {
        isFetching = false;
    }
}

// --- 3. RENDER & PLAYBACK LOGIC ---
function renderCurrentPost() {
    clearTimeout(slideTimer);
    mediaContainer.innerHTML = '';

    if (currentIndex >= posts.length - 5 && afterToken) fetchRedditData(subredditInput.value.trim(), true);
    if (currentIndex >= posts.length) currentIndex = 0;

    const post = posts[currentIndex];
    postTitle.textContent = post.title;
    postSubreddit.textContent = `r/${post.subreddit}`;

    if (posts[currentIndex + 1] && !posts[currentIndex + 1].isVideo) {
        const preloader = new Image();
        preloader.src = posts[currentIndex + 1].url;
    }

    if (post.isVideo) {
        const video = document.createElement('video');
        video.src = post.url;
        video.autoplay = true;
        video.muted = true;
        
        video.addEventListener('loadedmetadata', () => {
            const vidMax = parseInt(vidMaxInput.value, 10) || 30;
            currentWaitTime = Math.min(video.duration, vidMax) * 1000;
            if (isPlaying) slideTimer = setTimeout(nextSlide, currentWaitTime);
        });
        
        mediaContainer.appendChild(video);
    } else {
        const img = document.createElement('img');
        img.src = post.url;
        
        // Differentiate between gallery speed and single image speed
        const imgSpeed = parseInt(imgSpeedInput.value, 10) || 5;
        const galSpeed = parseInt(galSpeedInput.value, 10) || 3;
        
        currentWaitTime = (post.isGalleryItem ? galSpeed : imgSpeed) * 1000;
        
        if (isPlaying) slideTimer = setTimeout(nextSlide, currentWaitTime);
        mediaContainer.appendChild(img);
    }
}

function nextSlide() { currentIndex++; renderCurrentPost(); }
function prevSlide() { currentIndex = currentIndex > 0 ? currentIndex - 1 : 0; renderCurrentPost(); }

function togglePlayPause() {
    isPlaying = !isPlaying;
    playPauseBtn.textContent = isPlaying ? "Pause" : "Play";
    if (isPlaying) {
        const media = mediaContainer.querySelector('video');
        if (media) media.play();
        slideTimer = setTimeout(nextSlide, currentWaitTime);
    } else {
        clearTimeout(slideTimer);
        const media = mediaContainer.querySelector('video');
        if (media) media.pause();
    }
}

// --- 4. EVENT LISTENERS ---
startBtn.addEventListener('click', () => {
    const subreddits = subredditInput.value.trim();
    if (subreddits) {
        localStorage.setItem('rs_subs', subreddits);
        fetchRedditData(subreddits, false);
    }
});

playPauseBtn.addEventListener('click', togglePlayPause);

let touchStartX = 0;
let isSwiping = false;

mediaContainer.addEventListener('touchstart', e => { 
    touchStartX = e.changedTouches[0].screenX; 
    isSwiping = false; 
});

mediaContainer.addEventListener('touchend', e => {
    const touchEndX = e.changedTouches[0].screenX;
    const distance = touchStartX - touchEndX;
    if (Math.abs(distance) > 50) {
        isSwiping = true;
        if (distance > 0) nextSlide(); 
        else prevSlide(); 
    }
});

mediaContainer.addEventListener('click', e => {
    if (isSwiping) return; 
    const clickX = e.clientX;
    if (clickX > window.innerWidth / 2) nextSlide();
    else prevSlide();
});

init();
