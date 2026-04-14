const mediaContainer = document.getElementById('media-container');
const uiContainer = document.getElementById('ui-container');
const startBtn = document.getElementById('start-btn');
const playPauseBtn = document.getElementById('play-pause-btn');
const subredditInput = document.getElementById('subreddit-input');
const postTitle = document.getElementById('post-title');
const postSubreddit = document.getElementById('post-subreddit');

// --- STATE MANAGEMENT ---
let posts = [];
let currentIndex = 0;
let slideTimer = null;
let isPlaying = true;
let afterToken = null;
let isFetching = false;
let currentWaitTime = 0;
let idleTimeout;

const IMAGE_DURATION = 5000;

// --- 1. INITIALIZATION & UI LOGIC ---
function init() {
    const saved = localStorage.getItem('reddit_slideshow_subs');
    if (saved) subredditInput.value = saved;

    // Wake up UI on mouse move or screen tap
    document.addEventListener('mousemove', wakeUpUI);
    document.addEventListener('touchstart', wakeUpUI);
}

function wakeUpUI() {
    document.body.classList.remove('idle');
    clearTimeout(idleTimeout);
    
    idleTimeout = setTimeout(() => {
        if (isPlaying && posts.length > 0) {
            document.body.classList.add('idle');
        }
    }, 3000);
}

// --- 2. DATA FETCHING (WITH ROBUST VIDEO PARSING) ---
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
                        newPosts.push({ title: data.title, subreddit: data.subreddit, isVideo: false, url: cleanUrl });
                    }
                });
            } else {
                // Fixed Video Logic: Check deep nested secure_media or explicit video file extensions
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
                        if (mediaUrl.endsWith('.gifv')) mediaUrl = mediaUrl.replace('.gifv', '.mp4'); // Fix imgur gifv links
                    }

                    newPosts.push({
                        title: data.title,
                        subreddit: data.subreddit,
                        isVideo: isVideoFlag,
                        url: mediaUrl
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

    if (currentIndex >= posts.length - 5 && afterToken) {
        fetchRedditData(subredditInput.value.trim(), true);
    }

    if (currentIndex >= posts.length) currentIndex = 0;

    const post = posts[currentIndex];

    // Update Info Overlay
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
        localStorage.setItem('reddit_slideshow_subs', subreddits);
        fetchRedditData(subreddits, false);
    }
});

playPauseBtn.addEventListener('click', togglePlayPause);

// Unified Gesture & Tap Handling
let touchStartX = 0;
let isSwiping = false;

mediaContainer.addEventListener('touchstart', e => { 
    touchStartX = e.changedTouches[0].screenX; 
    isSwiping = false; // Reset on new touch
});

mediaContainer.addEventListener('touchend', e => {
    const touchEndX = e.changedTouches[0].screenX;
    const distance = touchStartX - touchEndX;
    
    // Register as a swipe if finger traveled more than 50px
    if (Math.abs(distance) > 50) {
        isSwiping = true;
        if (distance > 0) nextSlide(); // Swiped left
        else prevSlide(); // Swiped right
    }
});

// Tap/Click Navigation
mediaContainer.addEventListener('click', e => {
    if (isSwiping) return; // Prevent tap action if the user just finished a swipe
    
    const clickX = e.clientX;
    const screenWidth = window.innerWidth;
    
    if (clickX > screenWidth / 2) {
        nextSlide(); // Tapped right half
    } else {
        prevSlide(); // Tapped left half
    }
});

// Boot
init();
