const mediaContainer = document.getElementById('media-container');
const uiContainer = document.getElementById('ui-container');
const startBtn = document.getElementById('start-btn');
const playPauseBtn = document.getElementById('play-pause-btn');
const subredditInput = document.getElementById('subreddit-input');

// --- STATE MANAGEMENT ---
let posts = [];
let currentIndex = 0;
let slideTimer = null;
let isPlaying = true;
let afterToken = null;
let isFetching = false;
let currentWaitTime = 0; // Tracks remaining time if paused

const IMAGE_DURATION = 5000;

// --- 1. INITIALIZATION & UI LOGIC ---
function init() {
    // Load saved subreddits
    const saved = localStorage.getItem('reddit_slideshow_subs');
    if (saved) subredditInput.value = saved;

    // Idle Mouse/UI Hide Logic
    let idleTimeout;
    document.addEventListener('mousemove', () => {
        document.body.classList.remove('idle');
        uiContainer.classList.remove('hidden');
        clearTimeout(idleTimeout);
        
        idleTimeout = setTimeout(() => {
            if (isPlaying && posts.length > 0) {
                document.body.classList.add('idle');
                uiContainer.classList.add('hidden');
            }
        }, 3000);
    });
}

// --- 2. DATA FETCHING (WITH PAGINATION) ---
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
        afterToken = json.data.after; // Save token for next page

        const newPosts = [];
        
        json.data.children.forEach(post => {
            const data = post.data;

            // Gallery Post Logic: Extract all images and flatten them into individual slides
            if (data.is_gallery && data.media_metadata) {
                Object.values(data.media_metadata).forEach(media => {
                    if (media.s && media.s.u) {
                        // Reddit escapes gallery URLs; we must unescape them
                        const cleanUrl = media.s.u.replace(/&amp;/g, '&');
                        newPosts.push({ title: data.title, isVideo: false, url: cleanUrl });
                    }
                });
            } else {
                // Standard Post Logic
                const isExplicitImage = data.post_hint === 'image';
                const hasImageExtension = data.url && data.url.match(/\.(jpg|jpeg|png|gif)(\?.*)?$/i);
                
                if (data.url && (isExplicitImage || hasImageExtension || data.is_video)) {
                    newPosts.push({
                        title: data.title,
                        isVideo: data.is_video,
                        url: data.is_video ? data.media.reddit_video.fallback_url : data.url
                    });
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

    // Pagination: Fetch more if we are 5 slides away from the end
    if (currentIndex >= posts.length - 5 && afterToken) {
        fetchRedditData(subredditInput.value.trim(), true);
    }

    // Safety loop if pagination hasn't caught up
    if (currentIndex >= posts.length) currentIndex = 0;

    const post = posts[currentIndex];

    // Preload next image in the background
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
            currentWaitTime = Math.min(video.duration, 30) * 1000;
            if (isPlaying) slideTimer = setTimeout(nextSlide, currentWaitTime);
        });
        
        mediaContainer.appendChild(video);
    } else {
        const img = document.createElement('img');
        img.src = post.url;
        
        currentWaitTime = IMAGE_DURATION;
        if (isPlaying) slideTimer = setTimeout(nextSlide, currentWaitTime);
        
        mediaContainer.appendChild(img);
    }
}

function nextSlide() {
    currentIndex++;
    renderCurrentPost();
}

function prevSlide() {
    currentIndex = currentIndex > 0 ? currentIndex - 1 : 0;
    renderCurrentPost();
}

function togglePlayPause() {
    isPlaying = !isPlaying;
    playPauseBtn.textContent = isPlaying ? "Pause" : "Play";
    
    if (isPlaying) {
        // Resume playback immediately
        const media = mediaContainer.querySelector('video');
        if (media) media.play();
        slideTimer = setTimeout(nextSlide, currentWaitTime);
    } else {
        // Pause playback
        clearTimeout(slideTimer);
        const media = mediaContainer.querySelector('video');
        if (media) media.pause();
    }
}

// --- 4. EVENT LISTENERS ---
startBtn.addEventListener('click', () => {
    const subreddits = subredditInput.value.trim();
    if (subreddits) {
        localStorage.setItem('reddit_slideshow_subs', subreddits);
        fetchRedditData(subreddits, false);
    }
});

playPauseBtn.addEventListener('click', togglePlayPause);

// Swipe Gestures
let touchStartX = 0;
let touchEndX = 0;

document.addEventListener('touchstart', e => { touchStartX = e.changedTouches[0].screenX; });
document.addEventListener('touchend', e => {
    touchEndX = e.changedTouches[0].screenX;
    if (touchStartX - touchEndX > 50) nextSlide();
    if (touchEndX - touchStartX > 50) prevSlide();
});

// Boot
init();
