const mediaContainer = document.getElementById('media-container');
const uiContainer = document.getElementById('ui-container');
const startBtn = document.getElementById('start-btn');
const playPauseBtn = document.getElementById('play-pause-btn');
const clearBtn = document.getElementById('clear-btn');
const subredditInput = document.getElementById('subreddit-input');
const postTitle = document.getElementById('post-title');
const postSubreddit = document.getElementById('post-subreddit');
const videoControls = document.getElementById('video-controls');
const videoScrub = document.getElementById('video-scrub');
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
let isScrubbing = false;

// Load seen history
let seenPosts = new Set(JSON.parse(localStorage.getItem('rs_seen_posts') || '[]'));
const MAX_HISTORY = 2000;

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

function markAsSeen(id) {
    seenPosts.add(id);
    
    let seenArray = Array.from(seenPosts);
    if (seenArray.length > MAX_HISTORY) {
        seenArray = seenArray.slice(seenArray.length - MAX_HISTORY);
        seenPosts = new Set(seenArray);
    }
    localStorage.setItem('rs_seen_posts', JSON.stringify(seenArray));
}

// --- 2. DATA FETCHING (WITH EXTERNAL LINK SUPPORT) ---
async function fetchRedditData(subreddits, append = false) {
    if (isFetching) return;
    isFetching = true;

    try {
        const baseUrl = `https://www.reddit.com/r/${subreddits}.json?limit=50&t=${Date.now()}`;
        const targetUrl = append && afterToken ? `${baseUrl}&after=${afterToken}` : baseUrl;
        const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`;

        const response = await fetch(proxyUrl);
        if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
        
        const json = await response.json();
        afterToken = json.data.after;

        const newPosts = [];
        
        json.data.children.forEach(post => {
            const data = post.data;
            if (seenPosts.has(data.id)) return;

            let mediaUrl = data.url;
            let isVideoFlag = false;
            let isIframeFlag = false; // NEW: Added to support RedGIF embed fallback

            // 1. Handle Reddit Native Galleries
            if (data.is_gallery && data.media_metadata) {
                Object.values(data.media_metadata).forEach(media => {
                    if (media.s && media.s.u) {
                        let targetImgUrl = media.s.u; 
                        if (media.p && media.p.length > 0) {
                            const optimalSize = media.p.find(img => img.x >= 1080) || media.p[media.p.length - 1];
                            targetImgUrl = optimalSize.u;
                        }
                        newPosts.push({ 
                            id: data.id, title: data.title, subreddit: data.subreddit, 
                            isVideo: false, isIframe: false, isGalleryItem: true, url: targetImgUrl.replace(/&amp;/g, '&') 
                        });
                    }
                });
                return; 
            }

            // 2. Transcoded Previews (BEST WAY FOR REDGIFS/IMGUR)
            // Reddit usually processes external gifs and provides a direct, clean mp4 fallback.
            if (data.preview?.reddit_video_preview?.fallback_url) {
                mediaUrl = data.preview.reddit_video_preview.fallback_url;
                isVideoFlag = true;
            }
            // 3. Native Reddit Video
            else if (data.is_video && data.secure_media?.reddit_video) {
                mediaUrl = data.secure_media.reddit_video.fallback_url;
                isVideoFlag = true;
            } 
            // 4. Handle Imgur Fallback
            else if (mediaUrl.includes('imgur.com')) {
                // Imgur automatically serves .mp4 equivalents for both .gif and .gifv
                if (mediaUrl.match(/\.(gifv|mp4|gif)$/i)) {
                    mediaUrl = mediaUrl.replace(/\.(gifv|gif)$/i, '.mp4');
                    isVideoFlag = true;
                } else if (!mediaUrl.match(/\.(jpg|jpeg|png)$/i)) {
                    mediaUrl += '.jpg';
                }
            }

            // 5. Native Reddit GIF Transcoding (Catches heavy GIFs not hosted on Imgur)
            if (!isVideoFlag && !isIframeFlag && data.preview?.images?.[0]?.variants?.mp4) {
                mediaUrl = data.preview.images[0].variants.mp4.source.url.replace(/&amp;/g, '&');
                isVideoFlag = true;
            }

            // 6. Compression Fallback for standard images
            if (!isVideoFlag && !isIframeFlag && data.preview?.images?.[0]?.resolutions) {
                // Prevent accidentally overwriting an actual .gif with a static thumbnail
                if (!mediaUrl.match(/\.gif$/i)) {
                    const resolutions = data.preview.images[0].resolutions;
                    const optimalSize = resolutions.find(img => img.width >= 1080) || resolutions[resolutions.length - 1];
                    mediaUrl = optimalSize.url.replace(/&amp;/g, '&');
                }
            }

            // Final Validation: Accept images, direct videos, or iframes
            const isMedia = isVideoFlag || isIframeFlag || mediaUrl.match(/\.(jpg|jpeg|png|gif)$/i);
            if (isMedia) {
                newPosts.push({ 
                    id: data.id, title: data.title, subreddit: data.subreddit, 
                    isVideo: isVideoFlag, isIframe: isIframeFlag, isGalleryItem: false, url: mediaUrl 
                });
            }
        });

        if (append) {
            const wasEmpty = posts.length === 0;
            posts = posts.concat(newPosts);
            if (posts.length - currentIndex < 5 && afterToken) {
                isFetching = false;
                fetchRedditData(subreddits, true);
                return;
            }
            if (wasEmpty && posts.length > 0) renderCurrentPost();
        } else {
            posts = newPosts;
            currentIndex = 0;
            if (posts.length > 0) {
                playPauseBtn.disabled = false;
                renderCurrentPost();
            } else if (afterToken) {
                isFetching = false;
                fetchRedditData(subreddits, true);
                return;
            }
        }
    } catch (error) {
        console.error("Fetch Error:", error);
    } finally {
        isFetching = false;
    }
}

// --- 3. RENDER & PLAYBACK LOGIC ---
function renderCurrentPost() {
    clearTimeout(slideTimer);
    mediaContainer.innerHTML = '';
    
    videoControls.classList.add('hidden');

    if (currentIndex >= posts.length - 5 && afterToken) fetchRedditData(subredditInput.value.trim(), true);
    if (currentIndex >= posts.length) currentIndex = 0;

    const post = posts[currentIndex];
    if (!post) return;

    markAsSeen(post.id);
    postTitle.textContent = post.title;
    postSubreddit.textContent = `r/${post.subreddit}`;

    if (post.isVideo) {
        const video = document.createElement('video');
        video.src = post.url;
        video.autoplay = true;
        video.muted = true;
        video.playsInline = true; 

        video.addEventListener('loadedmetadata', () => {
            videoControls.classList.remove('hidden');
            videoScrub.max = video.duration;
            videoScrub.value = 0;

            const vidMax = parseInt(vidMaxInput.value, 10) || 30;
            currentWaitTime = Math.min(video.duration, vidMax) * 1000;
            if (isPlaying) slideTimer = setTimeout(nextSlide, currentWaitTime);
        });

        video.addEventListener('timeupdate', () => {
            if (!isScrubbing) videoScrub.value = video.currentTime;
        });

        mediaContainer.appendChild(video);
    } 
    // NEW: Handle Iframe Fallbacks (RedGIFs)
    else if (post.isIframe) {
        const iframe = document.createElement('iframe');
        iframe.src = post.url;
        iframe.style.width = '100%';
        iframe.style.height = '100%';
        iframe.style.border = 'none';
        iframe.setAttribute('allow', 'autoplay; fullscreen');
        
        // Use the Max Video Duration setting since we can't read the iframe's internal video duration
        const vidMax = parseInt(vidMaxInput.value, 10) || 30;
        currentWaitTime = vidMax * 1000;
        if (isPlaying) slideTimer = setTimeout(nextSlide, currentWaitTime);
        
        mediaContainer.appendChild(iframe);
    } 
    else {
        const img = document.createElement('img');
        img.src = post.url;
        const imgSpeed = parseInt(imgSpeedInput.value, 10) || 5;
        const galSpeed = parseInt(galSpeedInput.value, 10) || 3;
        currentWaitTime = (post.isGalleryItem ? galSpeed : imgSpeed) * 1000;
        if (isPlaying) slideTimer = setTimeout(nextSlide, currentWaitTime);
        mediaContainer.appendChild(img);
    }
}

// --- 4. PLAYBACK CONTROLS ---
function nextSlide() {
    if (posts.length === 0) return;
    currentIndex++;
    renderCurrentPost();
}

function prevSlide() {
    if (posts.length === 0) return;
    currentIndex--;
    if (currentIndex < 0) currentIndex = 0;
    renderCurrentPost();
}

function togglePlayPause() {
    isPlaying = !isPlaying;
    const video = mediaContainer.querySelector('video');
    
    if (isPlaying) {
        if (video) video.play();
        const vidMax = parseInt(vidMaxInput.value, 10) || 30;
        const remaining = video ? (Math.min(video.duration, vidMax) - video.currentTime) * 1000 : currentWaitTime;
        slideTimer = setTimeout(nextSlide, remaining);
    } else {
        if (video) video.pause();
        clearTimeout(slideTimer);
    }
}

// --- 5. EVENT LISTENERS ---
startBtn.addEventListener('click', () => {
    const subreddits = subredditInput.value.trim();
    if (subreddits) {
        localStorage.setItem('rs_subs', subreddits);
        posts = [];
        afterToken = null;
        fetchRedditData(subreddits, false);
    }
});

clearBtn.addEventListener('click', () => {
    seenPosts.clear();
    localStorage.removeItem('rs_seen_posts');
    alert("History cleared. You will now see previously viewed posts.");
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

videoScrub.addEventListener('input', () => {
    isScrubbing = true;
    const video = mediaContainer.querySelector('video');
    if (video) {
        video.currentTime = videoScrub.value;
    }
});

videoScrub.addEventListener('change', () => {
    isScrubbing = false;
    const video = mediaContainer.querySelector('video');
    if (video && isPlaying) {
        clearTimeout(slideTimer);
        const vidMax = parseInt(vidMaxInput.value, 10) || 30;
        const remaining = (Math.min(video.duration, vidMax) - video.currentTime) * 1000;
        if (remaining > 0) {
            slideTimer = setTimeout(nextSlide, remaining);
        } else {
            nextSlide();
        }
    }
});

videoControls.addEventListener('click', (e) => e.stopPropagation());
videoControls.addEventListener('touchstart', (e) => e.stopPropagation());

init();
