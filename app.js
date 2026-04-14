const mediaContainer = document.getElementById('media-container');
const uiContainer = document.getElementById('ui-container');
const startBtn = document.getElementById('start-btn');
const subredditInput = document.getElementById('subreddit-input');

let posts = [];
let currentIndex = 0;
let slideTimer = null;
const IMAGE_DURATION = 5000; // 5 seconds for images

// --- 1. DATA FETCHING & PARSING ---
async function fetchRedditData(subreddits) {
    try {
        // 1. Construct the target Reddit URL
        const targetUrl = `https://www.reddit.com/r/${subreddits}.json?limit=50`;
        
        // 2. Wrap it in a CORS proxy to bypass browser restrictions
        const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`;

        const response = await fetch(proxyUrl);

        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status} - ${response.statusText}`);
        }

        const json = await response.json();
        
        // Filter out text posts and unsupported media
        posts = json.data.children.filter(post => {
            const data = post.data;
            
            // 1. Check if Reddit explicitly flags it as an image
            const isExplicitImage = data.post_hint === 'image';
            
            // 2. Regex checks for .jpg, .jpeg, .png, .gif, ignoring anything after a '?'
            const hasImageExtension = data.url && data.url.match(/\.(jpg|jpeg|png|gif)(\?.*)?$/i);
            
            return data.url && (isExplicitImage || hasImageExtension || data.is_video);
        }).map(post => {
            const data = post.data;
            return {
                title: data.title,
                isVideo: data.is_video,
                // Reddit nests video URLs deeply. Fallback to image URL if not a video.
                url: data.is_video ? data.media.reddit_video.fallback_url : data.url
            };
        });

        if (posts.length > 0) {
            currentIndex = 0;
            uiContainer.classList.add('hidden');
            renderCurrentPost();
        } else {
            alert("No valid images or videos found in those subreddits.");
        }
    } catch (error) {
        console.error("Network or Parsing Error:", error);
        alert(`Failed to fetch data. Check console (F12) for details.\nError: ${error.message}`);
    }
}

// --- 2. RENDER & TIMER LOGIC ---
function renderCurrentPost() {
    clearTimeout(slideTimer); // Reset existing timers
    mediaContainer.innerHTML = ''; // Clear current media

    if (currentIndex >= posts.length) {
        currentIndex = 0; // Loop back to start (can be modified to fetch next page)
    }

    const post = posts[currentIndex];

    if (post.isVideo) {
        const video = document.createElement('video');
        video.src = post.url;
        video.autoplay = true;
        video.muted = true; // Required for autoplay policies in browsers
        
        video.addEventListener('loadedmetadata', () => {
            // Logic: Max 30s. If video is 10s, waits 10s. If 45s, cuts at 30s.
            const waitTime = Math.min(video.duration, 30) * 1000; 
            slideTimer = setTimeout(nextSlide, waitTime);
        });
        
        mediaContainer.appendChild(video);
    } else {
        const img = document.createElement('img');
        img.src = post.url;
        
        // Static timer for images
        slideTimer = setTimeout(nextSlide, IMAGE_DURATION);
        
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

// --- 3. SWIPE GESTURE LOGIC ---
let touchStartX = 0;
let touchEndX = 0;

function handleGesture() {
    const swipeThreshold = 50; // Minimum distance to register a swipe
    if (touchStartX - touchEndX > swipeThreshold) {
        nextSlide(); // Swiped left
    }
    if (touchEndX - touchStartX > swipeThreshold) {
        prevSlide(); // Swiped right
    }
}

document.addEventListener('touchstart', e => {
    touchStartX = e.changedTouches[0].screenX;
});

document.addEventListener('touchend', e => {
    touchEndX = e.changedTouches[0].screenX;
    handleGesture();
});

// --- 4. INIT ---
startBtn.addEventListener('click', () => {
    const subreddits = subredditInput.value.trim();
    if (subreddits) fetchRedditData(subreddits);
});
