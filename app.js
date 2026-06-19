/* ==========================================
   Aura Music - Core Application Logic
   ========================================== */

document.addEventListener('DOMContentLoaded', () => {
  // Ensure the default playlist is loaded
  if (typeof playlist === 'undefined' || !Array.isArray(playlist)) {
    console.error('Default playlist data not found! Please check playlist.js');
    return;
  }

  // App State variables
  let currentPlaylist = [];
  let currentTrackIndex = 0;
  let isDraggingProgress = false;
  let loopMode = localStorage.getItem('aura-loop-mode') || 'list'; // 'list' | 'single' | 'shuffle'
  let audioSourceMode = 'official'; // Always start with official and fallback silently
  let currentSourceIndex = 0; // Index of the audio source currently being loaded/played
  const AUDIO_SOURCES = [
    (id) => `https://v.iarc.top/?server=netease&type=url&id=${id}`,
    (id) => `https://api.injahow.cn/meting/?type=url&id=${id}`,
    (id) => `https://music.163.com/song/media/outer/url?id=${id}.mp3`
  ];
  let currentPlaylistId = localStorage.getItem('aura-current-playlist-id') || '8529369110'; // Default lofi favorites
  
  // Helper to construct absolute API URLs when running on other origins (like file:///)
  function getApiUrl(apiPath) {
    if (window.location.protocol === 'file:') {
      return 'http://localhost:3000' + apiPath;
    }
    return apiPath;
  }

  // Helper to upgrade NetEase cover images to high resolution (500x500)
  function getHdCoverUrl(url) {
    if (!url) return 'default.svg';
    if (url.includes('music.126.net') || url.includes('126.net')) {
      const cleanUrl = url.split('?')[0];
      return cleanUrl + '?param=500y500';
    }
    return url;
  }
  
  // Saved NetEase playlists
  let savedPlaylists = JSON.parse(localStorage.getItem('aura-saved-playlists')) || [
    { id: '8529369110', name: '我的网易云收藏歌单' }
  ];

  let lyricsCache = new Map();
  let currentLyrics = [];
  const MUSIC_NOTE_SVG = `
    <svg class="placeholder-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 24px; height: 24px; opacity: 0.5; display: block; margin: 12px auto;">
      <path d="M9 18V5l12-2v13"></path>
      <circle cx="6" cy="18" r="3"></circle>
      <circle cx="18" cy="16" r="3"></circle>
    </svg>
  `;
  let currentLyricIndex = -1;
  let currentHighlightIndex = -1;
  let lyricsRequestToken = 0;
  let consecutiveErrors = 0;

  // Lyrics scroll wheel state variables
  let userScrollOffset = 0;
  let userScrollTimeout = null;
  let isUserScrolling = false;

  // DOM Elements Cache
  const audio = document.getElementById('audio-player');
  const albumCoverImg = document.getElementById('album-cover-img');
  const bgCanvas = document.getElementById('bg-fluid-canvas');
  const trackNameEl = document.getElementById('track-name');
  const trackArtistEl = document.getElementById('track-artist');
  const currentTimeEl = document.getElementById('current-time');
  const totalTimeEl = document.getElementById('total-time');
  const progressSlider = document.getElementById('progress-slider');
  const sliderFill = document.getElementById('slider-fill');
  
  const playTriggerBtn = document.getElementById('play-trigger-btn');
  const playSvg = playTriggerBtn.querySelector('.play-svg');
  const pauseSvg = playTriggerBtn.querySelector('.pause-svg');
  const prevBtn = document.getElementById('prev-btn');
  const nextBtn = document.getElementById('next-btn');
  const loopBtn = document.getElementById('loop-mode-btn');
  const playlistToggleBtn = document.getElementById('playlist-toggle-btn');
  const playlistCloseBtn = document.getElementById('playlist-close-btn');
  const playlistDrawer = document.getElementById('playlist-drawer');
  
  const muteBtn = document.getElementById('mute-btn');
  const volHighIcon = muteBtn.querySelector('.vol-high-svg');
  const volMutedIcon = muteBtn.querySelector('.vol-muted-svg');
  const volumeSlider = document.getElementById('volume-slider');
  const volumeFill = document.getElementById('volume-fill');
  
  const themeToggleBtn = document.getElementById('theme-toggle-btn');
  const themeMenuBtn = document.getElementById('theme-menu-btn') || document.createElement('button');
  const themeDropdown = document.getElementById('theme-dropdown') || document.createElement('div');
  const eqVisualizer = document.getElementById('eq-visualizer');
  
  const lyricsWrapper = document.getElementById('lyrics-wrapper');
  const lyricsScroller = document.getElementById('lyrics-scroller');
  const lyricsStatus = document.getElementById('lyrics-status') || { style: {} };
  const playlistSongsList = document.getElementById('playlist-songs-list');
  const playlistCountEl = document.getElementById('playlist-count');
  const playlistSearch = document.getElementById('playlist-search');

  // Source Selector
  const sourceToggleBtn = document.getElementById('source-toggle-btn');

  // Import Playlist Modal
  const importPlaylistBtn = document.getElementById('import-playlist-btn');
  const importModal = document.getElementById('import-modal');
  const modalCloseBtn = document.getElementById('modal-close-btn');
  const modalCancelBtn = document.getElementById('modal-cancel-btn');
  const modalSubmitBtn = document.getElementById('modal-submit-btn');
  const playlistInput = document.getElementById('playlist-input');

  // Local file loading triggers
  const coverTrigger = document.getElementById('cover-trigger');
  const localAudioFile = document.getElementById('local-audio-file');
  const localLrcFile = document.getElementById('local-lrc-file');
  const localFolderFile = document.getElementById('local-folder-file');

  // Fullscreen Playback Page DOM elements
  const fsProgressSlider = document.getElementById('fs-progress-slider');
  const fsSliderFill = document.getElementById('fs-slider-fill');
  const fsCurrentTime = document.getElementById('fs-current-time');
  const fsTotalTime = document.getElementById('fs-total-time');
  const fsVolumeSlider = document.getElementById('fs-volume-slider');
  const fsVolumeFill = document.getElementById('fs-volume-fill');
  const fsMuteBtn = document.getElementById('fs-mute-btn');
  const fsMuteLow = fsMuteBtn ? fsMuteBtn.querySelector('.vol-low-svg') : null;
  const fsMuteMuted = fsMuteBtn ? fsMuteBtn.querySelector('.vol-muted-svg') : null;
  const fsLoopBtn = document.getElementById('fs-loop-btn');
  const fsShuffleBtn = document.getElementById('fs-shuffle-btn');
  const fsVolLowIcon = document.getElementById('fs-vol-low-icon');
  const fsVolHighIcon = document.getElementById('fs-vol-high-icon');
  const fsLyricsToggle = document.getElementById('fs-lyrics-toggle-btn');
  const fsQueueToggle = document.getElementById('fs-queue-toggle-btn');
  const fsCoverGlow = document.getElementById('fs-cover-glow');
  const fsQueuePanel = document.getElementById('fs-queue-panel');
  const fsQueueList = document.getElementById('fs-queue-list');
  const fsClearQueueBtn = document.getElementById('fs-clear-queue-btn');
  const playerLcdCenter = document.querySelector('.player-lcd-center');
  const fullscreenLyricsOverlay = document.getElementById('fullscreen-lyrics-overlay');
  const playerLyricsToggle = document.getElementById('player-lyrics-toggle');
  const fsCloseOverlayBtn = document.getElementById('fs-close-overlay-btn');
  const fsLyricsPanel = document.getElementById('fs-lyrics-panel');
  const fsInstrumentalDots = document.getElementById('fs-instrumental-dots');
  const fsTrackOptionsBtn = document.getElementById('fs-track-options-btn');
  const fsOptionsMenu = document.getElementById('fs-options-menu');

  // Drawer Tabs & Content
  const tabQueue = document.getElementById('tab-queue');
  const tabSearch = document.getElementById('tab-search');
  const queueTabContent = document.getElementById('queue-tab-content');
  const searchTabContent = document.getElementById('search-tab-content');

  // Playlist Select dropdown
  const playlistSelect = document.getElementById('playlist-select');

  // Local Action Buttons
  const importFileBtn = document.getElementById('import-file-btn');
  const importFolderBtn = document.getElementById('import-folder-btn');
  const clearQueueBtn = document.getElementById('clear-queue-btn');

  // Online Search Elements
  const onlineSearchInput = document.getElementById('online-search-input');
  const onlineSearchResults = document.getElementById('online-search-results');

  // ==========================================
  // 1. Theme, Preferences and Setup
  // ==========================================
  
  function initPreferences() {
    let savedTheme = localStorage.getItem('aura-theme') || 'apple-dark';
    if (savedTheme !== 'apple-light' && savedTheme !== 'apple-dark') {
      savedTheme = 'apple-dark';
    }
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeToggleIcon(savedTheme);
    
    // 2. Restore Volume
    const savedVolume = localStorage.getItem('aura-volume') || '70';
    audio.volume = parseInt(savedVolume, 10) / 100;
    volumeSlider.value = savedVolume;
    volumeFill.style.width = savedVolume + '%';
    updateVolumeIcon(parseInt(savedVolume, 10));

    // 3. Restore Loop Mode
    updateLoopModeUI();

    // 4. Restore Audio Source Mode
    updateSourceUI();

    // 5. Initialize Playlist dropdown UI
    updatePlaylistSelect();

    // 6. Load Playlist (Custom from cache or default NetEase online)
    loadActivePlaylist();

    // Countdown dots are controlled by playback time updates and do not require click handlers

    // 7. Initialize Sidebar Nav tab switching
    const navItems = document.querySelectorAll('.sidebar .nav-item[data-tab], .sidebar .sidebar-search-bar[data-tab]');
    const pageViews = document.querySelectorAll('.page-view');
    navItems.forEach(item => {
      item.addEventListener('click', () => {
        const tabName = item.getAttribute('data-tab');
        document.querySelectorAll('.sidebar .nav-item, .sidebar .sidebar-search-bar').forEach(nav => nav.classList.remove('active'));
        item.classList.add('active');
        
        pageViews.forEach(view => {
          if (view.id === `view-${tabName}`) {
            view.classList.add('active');
          } else {
            view.classList.remove('active');
          }
        });
        
        if (tabName === 'queue') {
          renderPlaylistSongs();
        } else if (tabName === 'search') {
          onlineSearchInput.focus();
        }
      });
    });

    // 8. Bind sidebar buttons
    const sidebarImportBtn = document.getElementById('sidebar-import-btn');
    if (sidebarImportBtn) {
      sidebarImportBtn.addEventListener('click', () => {
        importModal.classList.add('show');
        playlistInput.value = '';
        playlistInput.focus();
      });
    }

    // 9. Bind Fullscreen Lyrics Overlay toggle (Now Playing Page)
    if (playerLcdCenter) {
      playerLcdCenter.addEventListener('click', () => {
        fullscreenLyricsOverlay.classList.add('open');
        if (!fullscreenLyricsOverlay.classList.contains('lyrics-active') && !fullscreenLyricsOverlay.classList.contains('queue-active')) {
          fullscreenLyricsOverlay.classList.add('lyrics-active');
        }
        syncUIState(!audio.paused);
        syncFullscreenToggles();
        
        // Render panels depending on what is active
        if (fullscreenLyricsOverlay.classList.contains('lyrics-active')) {
          scheduleLyricsLayoutUpdate();
        } else if (fullscreenLyricsOverlay.classList.contains('queue-active')) {
          renderFsQueue();
        }
      });
    }

    if (albumCoverImg) {
      albumCoverImg.addEventListener('click', (e) => {
        e.stopPropagation(); // Avoid double trigger on parent click
        if (playerLcdCenter) playerLcdCenter.click();
      });
    }

    if (playerLyricsToggle && fullscreenLyricsOverlay) {
      playerLyricsToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        fullscreenLyricsOverlay.classList.add('open');
        fullscreenLyricsOverlay.classList.add('lyrics-active');
        fullscreenLyricsOverlay.classList.remove('queue-active');
        syncFullscreenToggles();
        scheduleLyricsLayoutUpdate();
      });
    }

    if (fsCloseOverlayBtn && fullscreenLyricsOverlay) {
      fsCloseOverlayBtn.addEventListener('click', () => {
        fullscreenLyricsOverlay.classList.remove('open');
      });
    }

    // Fullscreen Overlay Inner Panel Toggles
    if (fsLyricsToggle) {
      fsLyricsToggle.addEventListener('click', () => {
        const wasLyrics = fullscreenLyricsOverlay.classList.contains('lyrics-active');
        fullscreenLyricsOverlay.classList.remove('queue-active');
        if (wasLyrics) {
          fullscreenLyricsOverlay.classList.remove('lyrics-active');
        } else {
          fullscreenLyricsOverlay.classList.add('lyrics-active');
          scheduleLyricsLayoutUpdate();
        }
        syncFullscreenToggles();
      });
    }

    if (fsQueueToggle) {
      fsQueueToggle.addEventListener('click', () => {
        const wasQueue = fullscreenLyricsOverlay.classList.contains('queue-active');
        fullscreenLyricsOverlay.classList.remove('lyrics-active');
        if (wasQueue) {
          fullscreenLyricsOverlay.classList.remove('queue-active');
        } else {
          fullscreenLyricsOverlay.classList.add('queue-active');
          renderFsQueue();
        }
        syncFullscreenToggles();
      });
    }

    // Bind Mobile Bottom Tab Bar clicks to click corresponding sidebar nav items
    const mobileTabButtons = document.querySelectorAll('.mobile-tab-bar .tab-btn');
    mobileTabButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetTab = btn.getAttribute('data-target');
        let sidebarBtn = document.querySelector(`.sidebar-nav [data-tab="${targetTab}"]`);
        if (targetTab === 'search') {
          sidebarBtn = document.getElementById('sidebar-search-btn');
        }
        if (sidebarBtn) {
          sidebarBtn.click();
        }
        mobileTabButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    const sidebarNavBtns = document.querySelectorAll('.sidebar-nav .nav-item, .sidebar-search-bar');
    sidebarNavBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab');
        const correspondingMobileBtn = document.querySelector(`.mobile-tab-bar [data-target="${tab}"]`);
        if (correspondingMobileBtn) {
          mobileTabButtons.forEach(b => b.classList.remove('active'));
          correspondingMobileBtn.classList.add('active');
        }
      });
    });
  }

  // Sync button states and panels visibility helper
  function syncFullscreenToggles() {
    if (!fullscreenLyricsOverlay) return;
    const isLyrics = fullscreenLyricsOverlay.classList.contains('lyrics-active');
    const isQueue = fullscreenLyricsOverlay.classList.contains('queue-active');
    
    if (isLyrics) {
      if (fsLyricsToggle) fsLyricsToggle.classList.add('active');
      if (playerLyricsToggle) playerLyricsToggle.classList.add('active');
      if (fsLyricsPanel) fsLyricsPanel.classList.remove('hidden');
    } else {
      if (fsLyricsToggle) fsLyricsToggle.classList.remove('active');
      if (playerLyricsToggle) playerLyricsToggle.classList.remove('active');
      if (fsLyricsPanel) fsLyricsPanel.classList.add('hidden');
    }
    
    if (isQueue) {
      if (fsQueueToggle) fsQueueToggle.classList.add('active');
      if (playlistToggleBtn) playlistToggleBtn.classList.add('active');
      if (fsQueuePanel) fsQueuePanel.classList.remove('hidden');
    } else {
      if (fsQueueToggle) fsQueueToggle.classList.remove('active');
      if (playlistToggleBtn) playlistToggleBtn.classList.remove('active');
      if (fsQueuePanel) fsQueuePanel.classList.add('hidden');
    }
  }

  // Sync queue view inside Now Playing page
  function renderFsQueue() {
    if (!fsQueueList) return;
    fsQueueList.innerHTML = '';
    
    if (currentPlaylist.length === 0) {
      fsQueueList.innerHTML = `<div class="playlist-empty">${MUSIC_NOTE_SVG}<span>待播清单为空</span></div>`;
      return;
    }
    
    currentPlaylist.forEach((track, index) => {
      const isActive = index === currentTrackIndex;
      const item = document.createElement('div');
      item.className = `fs-queue-item ${isActive ? 'active' : ''}`;
      
      item.innerHTML = `
        <span class="fs-queue-item-index">${(index + 1).toString().padStart(2, '0')}</span>
        <div class="fs-queue-item-meta">
          <span class="fs-queue-item-title">${track.name}</span>
          <span class="fs-queue-item-artist">${track.artist}</span>
        </div>
      `;
      
      item.addEventListener('click', () => {
        if (index === currentTrackIndex) {
          togglePlay();
        } else {
          loadTrack(index);
          playAudio();
        }
      });
      
      fsQueueList.appendChild(item);
    });
  }

  // Theme Switcher Toggle (Light/Dark Toggle)
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', () => {
      const currentTheme = document.documentElement.getAttribute('data-theme') || 'apple-dark';
      const nextTheme = currentTheme === 'apple-light' ? 'apple-dark' : 'apple-light';
      
      document.documentElement.setAttribute('data-theme', nextTheme);
      localStorage.setItem('aura-theme', nextTheme);
      updateThemeToggleIcon(nextTheme);
      
      // Update background gradient colors immediately
      updateFluidColors(null);
    });
  }

  function updateThemeToggleIcon(theme) {
    if (!themeToggleBtn) return;
    const sunIcon = themeToggleBtn.querySelector('.sun-icon');
    const moonIcon = themeToggleBtn.querySelector('.moon-icon');
    const spanText = themeToggleBtn.querySelector('span');
    
    if (theme === 'apple-light') {
      if (sunIcon) sunIcon.style.display = 'none';
      if (moonIcon) moonIcon.style.display = 'block';
    } else {
      if (sunIcon) sunIcon.style.display = 'block';
      if (moonIcon) moonIcon.style.display = 'none';
    }
  }

  // Loop Mode Switch
  loopBtn.addEventListener('click', () => {
    if (loopMode === 'list') {
      loopMode = 'single';
    } else if (loopMode === 'single') {
      loopMode = 'shuffle';
    } else {
      loopMode = 'list';
    }
    localStorage.setItem('aura-loop-mode', loopMode);
    updateLoopModeUI();
  });

  function updateLoopModeUI() {
    if (loopMode === 'single') {
      loopBtn.classList.add('active');
      loopBtn.title = '当前模式：单曲循环';
      loopBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M17 2.1l4 4-4 4" />
          <path d="M3 10.2V8a4 4 0 0 1 4-4h14" />
          <path d="M7 21.9l-4-4 4-4" />
          <path d="M21 13.8v2a4 4 0 0 1-4 4H3" />
          <text x="10" y="15" font-size="8" font-weight="900" fill="currentColor">1</text>
        </svg>
      `;
    } else if (loopMode === 'shuffle') {
      loopBtn.classList.add('active');
      loopBtn.title = '当前模式：随机播放';
      loopBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="16 3 21 3 21 8" />
          <line x1="4" y1="20" x2="21" y2="3" />
          <polyline points="21 16 21 21 16 21" />
          <line x1="15" y1="15" x2="21" y2="21" />
          <line x1="4" y1="4" x2="9" y2="9" />
        </svg>
      `;
    } else {
      loopBtn.classList.remove('active');
      loopBtn.title = '当前模式：列表循环';
      loopBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M17 2.1l4 4-4 4" />
          <path d="M3 12.2v-2a4 4 0 0 1 4-4h14" />
          <path d="M7 21.9l-4-4 4-4" />
          <path d="M21 11.8v2a4 4 0 0 1-4 4H3" />
        </svg>
      `;
    }

    // Sync fullscreen shuffle and repeat buttons
    if (typeof fsShuffleBtn !== 'undefined' && fsShuffleBtn && fsLoopBtn) {
      if (loopMode === 'shuffle') {
        fsShuffleBtn.classList.add('active');
        fsLoopBtn.classList.remove('active');
      } else if (loopMode === 'single') {
        fsShuffleBtn.classList.remove('active');
        fsLoopBtn.classList.add('active');
        fsLoopBtn.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="17 2.1 21 6.1 17 10.1"></polyline>
              <path d="M3 12.2v-2a4 4 0 0 1 4-4h14"></path>
              <polyline points="7 21.9 3 17.9 7 13.9"></polyline>
              <path d="M21 11.8v2a4 4 0 0 1-4 4H3"></path>
              <text x="10" y="15" font-size="8" font-weight="900" fill="currentColor">1</text>
          </svg>
        `;
      } else {
        // list
        fsShuffleBtn.classList.remove('active');
        fsLoopBtn.classList.add('active');
        fsLoopBtn.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="17 2.1 21 6.1 17 10.1"></polyline>
              <path d="M3 12.2v-2a4 4 0 0 1 4-4h14"></path>
              <polyline points="7 21.9 3 17.9 7 13.9"></polyline>
              <path d="M21 11.8v2a4 4 0 0 1-4 4H3"></path>
          </svg>
        `;
      }
    }
  }

  // Audio Source Toggling
  sourceToggleBtn.addEventListener('click', () => {
    const nextSource = audioSourceMode === 'official' ? 'thirdparty' : 'official';
    audioSourceMode = nextSource;
    localStorage.setItem('aura-audio-source', audioSourceMode);
    updateSourceUI();

    // Hot swap URL preserving current position
    if (currentPlaylist.length > 0) {
      const curTime = audio.currentTime;
      const wasPlaying = !audio.paused;
      loadTrackSource(currentPlaylist[currentTrackIndex]);
      audio.currentTime = curTime;
      if (wasPlaying) {
        playAudio();
      }
    }
  });

  function updateSourceUI() {
    sourceToggleBtn.setAttribute('data-source', audioSourceMode);
  }

  // ==========================================
  // 2. Dynamic Fluid Canvas Backdrop
  // ==========================================
  
  let canvasAnimationId = null;
  let fluidBlobs = [];
  
  class FluidBlob {
    constructor(color, canvas) {
      this.canvas = canvas;
      this.color = color;
      
      // Starting positions (normalized coordinates 0 to 1)
      this.x = Math.random();
      this.y = Math.random();
      
      // Independent wave speeds
      this.angleX = Math.random() * Math.PI * 2;
      this.angleY = Math.random() * Math.PI * 2;
      this.speedX = 0.001 + Math.random() * 0.002;
      this.speedY = 0.001 + Math.random() * 0.002;
      
      // Size: 55% to 90% of canvas dimension
      this.baseRadius = 0.55 + Math.random() * 0.35;
      this.radiusAngle = Math.random() * Math.PI * 2;
      this.radiusSpeed = 0.003 + Math.random() * 0.004;
    }

    update() {
      this.angleX += this.speedX;
      this.angleY += this.speedY;
      this.radiusAngle += this.radiusSpeed;
      
      // Smooth floating motion center boundaries
      this.x = 0.5 + Math.sin(this.angleX) * 0.35;
      this.y = 0.5 + Math.cos(this.angleY) * 0.35;
    }

    draw(ctx) {
      const w = this.canvas.width;
      const h = this.canvas.height;
      const cx = this.x * w;
      const cy = this.y * h;
      
      // Soft radius modulation
      const r = (this.baseRadius + Math.sin(this.radiusAngle) * 0.15) * Math.max(w, h);
      
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      grad.addColorStop(0, this.color);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function getFallbackColors(inputString) {
    const theme = document.documentElement.getAttribute('data-theme') || 'apple-dark';
    
    // Premium Apple Music neutral palettes (no thunderous purple)
    const darkPalette = ['rgba(40, 40, 45, 0.8)', 'rgba(30, 30, 35, 0.8)', 'rgba(250, 36, 60, 0.35)', 'rgba(20, 20, 25, 0.8)'];
    const lightPalette = ['rgba(245, 245, 247, 0.8)', 'rgba(230, 230, 235, 0.8)', 'rgba(250, 36, 60, 0.15)', 'rgba(240, 240, 245, 0.8)'];
    
    return theme === 'apple-light' ? lightPalette : darkPalette;
  }

  function getDominantColorsFromData(imageData) {
    function rgbToHsl(r, g, b) {
      r /= 255; g /= 255; b /= 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      let h, s, l = (max + min) / 2;

      if (max === min) {
        h = s = 0; // achromatic
      } else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
          case r: h = (g - b) / d + (g < b ? 6 : 0); break;
          case g: h = (b - r) / d + 2; break;
          case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
      }
      return [h * 360, s * 100, l * 100];
    }

    function hslToRgb(h, s, l) {
      h /= 360; s /= 100; l /= 100;
      let r, g, b;

      if (s === 0) {
        r = g = b = l; // achromatic
      } else {
        const hue2rgb = (p, q, t) => {
          if (t < 0) t += 1;
          if (t > 1) t -= 1;
          if (t < 1/6) return p + (q - p) * 6 * t;
          if (t < 1/2) return q;
          if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
          return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1/3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1/3);
      }
      return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
    }

    const pixels = imageData.data;
    const len = pixels.length;
    const colors = [];
    
    // Sample pixels and extract saturation-based data
    for (let i = 0; i < len; i += 24) { // sample to keep performance high
      const r = pixels[i];
      const g = pixels[i+1];
      const b = pixels[i+2];
      const a = pixels[i+3];
      if (a < 220) continue; // skip transparent pixels
      
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const saturation = max - min;
      const brightness = (r * 299 + g * 587 + b * 114) / 1000;
      
      // Filter out pure black, white, and low-saturation grays
      if (brightness > 35 && brightness < 220 && saturation > 35) {
        colors.push({ r, g, b, saturation });
      }
    }
    
    // Fallback if not enough saturated colors found
    if (colors.length < 4) {
      for (let i = 0; i < len; i += 12) {
        const r = pixels[i];
        const g = pixels[i+1];
        const b = pixels[i+2];
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const saturation = max - min;
        if (saturation > 15) {
          colors.push({ r, g, b, saturation });
        }
      }
    }

    // Third pass: if still not enough colors, allow any pixel that is not completely dark/bright/transparent
    if (colors.length < 4) {
      for (let i = 0; i < len; i += 12) {
        const r = pixels[i];
        const g = pixels[i+1];
        const b = pixels[i+2];
        const a = pixels[i+3];
        if (a < 120) continue;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const saturation = max - min;
        colors.push({ r, g, b, saturation });
      }
    }
    
    // Sort by saturation descending to prefer vibrant colors
    colors.sort((a, b) => b.saturation - a.saturation);
    
    const result = [];
    // Select 4 distinct vibrant colors
    for (let i = 0; i < colors.length && result.length < 4; i++) {
      const c = colors[i];
      const isSimilar = result.some(existing => {
        const dr = existing[0] - c.r;
        const dg = existing[1] - c.g;
        const db = existing[2] - c.b;
        return Math.sqrt(dr*dr + dg*dg + db*db) < 65; // color distance threshold
      });
      if (!isSimilar) {
        result.push([c.r, c.g, c.b]);
      }
    }
    
    // Fallback palettes if we couldn't extract 4 distinct colors
    // Instead of using rigid neon gradients, programmatically generate variants from existing colors
    if (result.length > 0) {
      const baseLength = result.length;
      for (let i = result.length; i < 4; i++) {
        const baseColor = result[i % baseLength];
        const hsl = rgbToHsl(baseColor[0], baseColor[1], baseColor[2]);
        
        let newH = hsl[0];
        let newS = hsl[1];
        let newL = hsl[2];
        
        // Only shift hue if the color has some saturation to avoid adding rainbow shades to grays
        if (hsl[1] > 10) {
          newH = (hsl[0] + (i * 35)) % 360;
          newS = Math.max(15, Math.min(95, hsl[1] + (i * 5 - 10)));
        }
        
        // Generate light/dark gradient steps
        if (i === 1) {
          newL = Math.max(15, hsl[2] - 15);
        } else if (i === 2) {
          newL = Math.min(85, hsl[2] + 15);
        } else {
          newL = Math.max(10, hsl[2] - 25);
        }
        
        const rgb = hslToRgb(newH, newS, newL);
        result.push(rgb);
      }
    } else {
      // Clean fallback neutrals if image reading completely fails
      const theme = document.documentElement.getAttribute('data-theme') || 'apple-dark';
      if (theme === 'apple-light') {
        result.push([245, 245, 247], [230, 230, 235], [220, 220, 225], [240, 240, 245]);
      } else {
        result.push([30, 30, 35], [20, 20, 25], [40, 40, 45], [15, 15, 20]);
      }
    }
    
    return result.map(([r, g, b]) => `rgba(${r},${g},${b},0.85)`);
  }

  function updateFluidColors(coverUrl) {
    const applyColorsToCSS = (colors) => {
      colors.forEach((col, i) => {
        document.body.style.setProperty(`--color${i + 1}`, col);
        document.body.style.setProperty(`--color${i + 1}-rgba`, col.replace("0.8", "0.3"));
      });
      
      setupCanvasAnimation(colors);
    };

    if (!coverUrl || coverUrl === 'default.svg' || coverUrl.includes('default.svg')) {
      applyColorsToCSS(getFallbackColors(null));
      return;
    }

    // Proxy remote images to bypass CORS
    let targetUrl = coverUrl;
    if (coverUrl.startsWith('http://') || coverUrl.startsWith('https://')) {
      targetUrl = `/api/proxy-img?url=${encodeURIComponent(coverUrl)}`;
    }

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = 50;
        canvas.height = 50;
        ctx.drawImage(img, 0, 0, 50, 50);
        const data = ctx.getImageData(0, 0, 50, 50);
        const colors = getDominantColorsFromData(data);
        applyColorsToCSS(colors);
      } catch (e) {
        console.warn("CORS blocked canvas reading, falling back to helper palette.", e);
        applyColorsToCSS(getFallbackColors(coverUrl));
      }
    };
    img.onerror = () => {
      applyColorsToCSS(getFallbackColors(coverUrl));
    };
    img.src = targetUrl;
  }

  function setupCanvasAnimation(colors) {
    if (canvasAnimationId) {
      cancelAnimationFrame(canvasAnimationId);
    }
    
    bgCanvas.width = 120;
    bgCanvas.height = 120;
    
    const fCtx = bgCanvas.getContext('2d');
    fluidBlobs = colors.map(color => new FluidBlob(color, bgCanvas));
    
    function animate() {
      fCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
      
      // Base dark/light wash matching theme
      const theme = document.documentElement.getAttribute('data-theme') || 'apple-dark';
      fCtx.fillStyle = theme === 'apple-light' ? 'rgba(245, 245, 247, 1)' : 'rgba(12, 13, 20, 1)';
      fCtx.fillRect(0, 0, bgCanvas.width, bgCanvas.height);
      
      fCtx.globalCompositeOperation = 'source-over';
      fluidBlobs.forEach(blob => {
        blob.update();
        blob.draw(fCtx);
      });
      canvasAnimationId = requestAnimationFrame(animate);
    }
    animate();
  }

  // ==========================================
  // 3. Audio & Playlist Queue Management
  // ==========================================

  function loadActivePlaylist() {
    // Try to load from local storage cache first for instant startup
    const cachedPlaylist = localStorage.getItem('aura-custom-playlist');
    const targetPlaylistId = (currentPlaylistId && currentPlaylistId !== 'temporary' && !isNaN(currentPlaylistId)) 
      ? currentPlaylistId 
      : '8529369110';

    if (cachedPlaylist) {
      try {
        const parsed = JSON.parse(cachedPlaylist);
        if (Array.isArray(parsed) && parsed.length > 0) {
          currentPlaylist = parsed;
          console.log(`Loaded ${currentPlaylist.length} tracks from local cache for instant start.`);
          updatePlaylistSelect();
          // Initialize UI with cached data immediately
          bootstrapPlayer();
          
          // Fetch fresh online data silently in the background to update the cache
          fetchOnlinePlaylist(targetPlaylistId, true);
          return;
        }
      } catch (e) {
        console.warn("Failed to parse cached playlist on startup:", e);
      }
    }
      
    // If no cache exists, do a regular online fetch which will run bootstrapPlayer() on finish
    fetchOnlinePlaylist(targetPlaylistId, false);
  }

  async function fetchOnlinePlaylist(playlistId, isSilentBackground = false) {
    try {
      console.log(`Fetching online NetEase playlist ${playlistId}...`);
      let data = null;

      // Try local proxy first if not running on file:// protocol
      if (window.location.protocol !== 'file:') {
        try {
          const response = await fetch(getApiUrl(`/api/playlist?id=${playlistId}`));
          if (response.ok) {
            data = await response.json();
          }
        } catch (err) {
          console.warn("Local proxy playlist fetch failed, trying public API fallback...", err);
        }
      }

      // Fallback to direct Meting API
      if (!data) {
        console.log(`Fetching NetEase playlist ${playlistId} directly from Meting API fallback...`);
        const response = await fetch(`https://v.iarc.top/?server=netease&type=playlist&id=${playlistId}`);
        if (!response.ok) throw new Error(`Meting API fallback failed: ${response.status}`);
        data = await response.json();
      }

      if (Array.isArray(data) && data.length > 0) {
        const currentPlayingTrack = currentPlaylist[currentTrackIndex];

        currentPlaylist = data.map(item => {
          let songId = null;
          const match = item.url.match(/id=(\d+)/);
          if (match) {
            songId = parseInt(match[1], 10);
          }
          return {
            id: songId || item.id,
            name: item.name,
            artist: item.artist,
            url: item.url,
            pic: item.pic || 'default.svg',
            lrc: item.lrc
          };
        });

        // Sync currently playing track index in the newly fetched list
        if (currentPlayingTrack) {
          const newIndex = currentPlaylist.findIndex(t => t.id === currentPlayingTrack.id || (t.file && t.url === currentPlayingTrack.url));
          if (newIndex !== -1) {
            currentTrackIndex = newIndex;
            console.log(`Synchronized currently playing track to index ${newIndex} after background update.`);
          }
        }
        
        // Add to saved playlists if not present
        if (playlistId !== 'temporary' && !savedPlaylists.some(p => p.id === playlistId)) {
          savedPlaylists.push({
            id: playlistId,
            name: `网易云歌单 (${playlistId})`
          });
          localStorage.setItem('aura-saved-playlists', JSON.stringify(savedPlaylists));
        }

        // Cache custom playlist (filtering out local blob URLs)
        localStorage.setItem('aura-custom-playlist', JSON.stringify(currentPlaylist.filter(t => !t.url.startsWith('blob:'))));
        localStorage.setItem('aura-current-playlist-id', playlistId);
        console.log(`Successfully imported playlist ${playlistId} with ${currentPlaylist.length} songs.`);
        
        updatePlaylistSelect();

        if (isSilentBackground) {
          // Update list in UI quietly without resetting active track
          renderPlaylistSongs();
          preFetchPlaylistCovers(currentPlaylist);
        } else {
          bootstrapPlayer();
        }
      } else {
        throw new Error("Empty or invalid playlist returned.");
      }
    } catch (err) {
      console.warn("All NetEase playlist fetches failed.", err);
      if (!isSilentBackground) {
        // If not silent background, fall back to local backup static list
        currentPlaylist = playlist.map(item => ({
          id: item.id,
          name: item.name,
          artist: item.artist,
          url: item.url,
          pic: 'default.svg',
          lrc: null
        }));
        bootstrapPlayer();
      }
    }
  }

  function bootstrapPlayer() {
    renderPlaylistSongs();
    
    // Set initial cover state to paused
    coverTrigger.classList.add('paused');
    coverTrigger.classList.remove('playing');

    if (currentPlaylist.length > 0) {
      document.body.classList.remove('no-files');
      loadTrack(0);
      preFetchPlaylistCovers(currentPlaylist);
    } else {
      document.body.classList.add('no-files');
      trackNameEl.textContent = "点击导入歌单";
      trackArtistEl.textContent = "无可用音频";
      const fsTrackNameEl = document.getElementById('fs-track-name');
      const fsTrackArtistEl = document.getElementById('fs-track-artist');
      if (fsTrackNameEl) fsTrackNameEl.textContent = "点击导入歌单";
      if (fsTrackArtistEl) fsTrackArtistEl.textContent = "无可用音频";
      clearLyrics();
    }
  }

  function loadTrack(index) {
    if (index < 0 || index >= currentPlaylist.length) return;
    currentTrackIndex = index;
    const track = currentPlaylist[index];
    consecutiveErrors = 0;

    // Load source
    loadTrackSource(track);

    // Update Metadata
    trackNameEl.textContent = track.name;
    trackArtistEl.textContent = track.artist;
    
    // Update Cover
    const coverUrl = getHdCoverUrl(track.pic);
    albumCoverImg.style.backgroundImage = `url('${coverUrl}')`;
    
    // Update Fullscreen overlay meta
    const fsTrackNameEl = document.getElementById('fs-track-name');
    const fsTrackArtistEl = document.getElementById('fs-track-artist');
    const fsAlbumCoverImg = document.getElementById('fs-cover-art');
    if (fsTrackNameEl) fsTrackNameEl.textContent = track.name;
    if (fsTrackArtistEl) fsTrackArtistEl.textContent = track.artist;
    if (fsAlbumCoverImg) fsAlbumCoverImg.style.backgroundImage = `url('${coverUrl}')`;
    if (fsCoverGlow) fsCoverGlow.style.backgroundImage = `url('${coverUrl}')`;
    
    // Trigger fluid background update
    updateFluidColors(coverUrl);

    // Reset timelines
    currentTimeEl.textContent = '0:00';
    totalTimeEl.textContent = '-0:00';
    progressSlider.value = 0;
    sliderFill.style.width = '0%';
    sliderFill.parentElement.style.setProperty('--slider-percent', '0%');

    if (fsProgressSlider) {
      fsProgressSlider.value = 0;
      fsSliderFill.style.width = '0%';
      fsSliderFill.parentElement.style.setProperty('--slider-percent', '0%');
      fsCurrentTime.textContent = '0:00';
      fsTotalTime.textContent = '-0:00';
    }

    if (fullscreenLyricsOverlay && fullscreenLyricsOverlay.classList.contains('queue-active')) {
      renderFsQueue();
    }

    // For local tracks: check if tag parsing is needed
    if (track.file && !track.tagsLoaded) {
      loadLocalTrackTags(track, index);
    }

    // Load Sync lyrics (local or online)
    if (track.lrcFile) {
      readLocalLrcFile(track.lrcFile);
    } else {
      loadLyrics(track);
    }

    // For online NetEase tracks: fetch detailed HD info (cover art) in background
    if (track.id && !track.file) {
      fetchHDInfo(track);
    }

    // Sync active in playlist drawer
    syncPlaylistDrawerActive();
  }

  function loadTrackSource(track, sourceIndex = 0) {
    currentSourceIndex = sourceIndex;
    if (track.file) {
      audio.src = track.url;
      currentSourceIndex = -1; // Local files don't use sources list
    } else if (track.id) {
      if (sourceIndex >= 0 && sourceIndex < AUDIO_SOURCES.length) {
        audio.src = AUDIO_SOURCES[sourceIndex](track.id);
        console.log(`Loading song source index ${sourceIndex} for ID ${track.id}`);
      } else {
        audio.src = '';
      }
    } else if (track.url) {
      audio.src = track.url;
      currentSourceIndex = -1;
    }
    audio.load();
  }

  function playAudio() {
    audio.play()
      .then(() => {
        consecutiveErrors = 0;
        syncUIState(true);
      })
      .catch(err => {
        console.warn('Playback block / error:', err);
        syncUIState(false);
      });
  }

  function pauseAudio() {
    audio.pause();
    syncUIState(false);
  }

  function togglePlay() {
    if (audio.paused) {
      playAudio();
    } else {
      pauseAudio();
    }
  }

  function playNext() {
    if (currentPlaylist.length === 0) return;
    let nextIndex = currentTrackIndex;
    
    if (loopMode === 'shuffle') {
      nextIndex = Math.floor(Math.random() * currentPlaylist.length);
    } else {
      nextIndex = (currentTrackIndex + 1) % currentPlaylist.length;
    }
    
    loadTrack(nextIndex);
    playAudio();
  }

  function playPrev() {
    if (currentPlaylist.length === 0) return;
    let prevIndex = currentTrackIndex;
    
    if (loopMode === 'shuffle') {
      prevIndex = Math.floor(Math.random() * currentPlaylist.length);
    } else {
      prevIndex = (currentTrackIndex - 1 + currentPlaylist.length) % currentPlaylist.length;
    }
    
    loadTrack(prevIndex);
    playAudio();
  }

  function syncUIState(isPlaying) {
    if (isPlaying) {
      albumCoverImg.style.transform = 'scale(1.02)';
      playSvg.style.display = 'none';
      pauseSvg.style.display = 'block';
      coverTrigger.classList.add('playing');
      coverTrigger.classList.remove('paused');
      startEqualizerAnimation();
    } else {
      albumCoverImg.style.transform = 'scale(1.0)';
      playSvg.style.display = 'block';
      pauseSvg.style.display = 'none';
      coverTrigger.classList.add('paused');
      coverTrigger.classList.remove('playing');
      stopEqualizerAnimation();
    }

    // Sync fullscreen controls
    const fsPlayBtn = document.getElementById('fs-play-btn');
    if (fsPlayBtn) {
      const fsPlaySvg = fsPlayBtn.querySelector('.play-svg');
      const fsPauseSvg = fsPlayBtn.querySelector('.pause-svg');
      if (isPlaying) {
        if (fsPlaySvg) fsPlaySvg.style.display = 'none';
        if (fsPauseSvg) fsPauseSvg.style.display = 'block';
      } else {
        if (fsPlaySvg) fsPlaySvg.style.display = 'block';
        if (fsPauseSvg) fsPauseSvg.style.display = 'none';
      }
    }

    const items = document.querySelectorAll('.playlist-item, .drawer-playlist-item, .fs-queue-item');
    items.forEach((item) => {
      const indexElement = item.querySelector('.item-index, .drawer-item-index, .fs-queue-item-index');
      if (!indexElement) return;
      const index = parseInt(indexElement.textContent, 10) - 1;
      if (index === currentTrackIndex) {
        item.classList.add('active');
        if (isPlaying) {
          item.classList.add('playing');
        } else {
          item.classList.remove('playing');
        }
      } else {
        item.classList.remove('active', 'playing');
      }
    });
  }

  // Equalizer Animations
  function startEqualizerAnimation() {
    eqVisualizer.innerHTML = '';
    const barCount = 18;
    for (let i = 0; i < barCount; i++) {
      const bar = document.createElement('div');
      bar.className = 'eq-bar';
      
      const duration = 0.45 + Math.random() * 0.7;
      const delay = Math.random() * 0.4;
      const animId = (i % 5) + 1;
      
      bar.style.animation = `bounce-bar-${animId} ${duration}s infinite alternate ease-in-out`;
      bar.style.animationDelay = `-${delay}s`;
      eqVisualizer.appendChild(bar);
    }
  }

  function stopEqualizerAnimation() {
    const bars = eqVisualizer.querySelectorAll('.eq-bar');
    bars.forEach(bar => {
      bar.style.animation = 'none';
      bar.style.height = '3px';
    });
  }

  // ==========================================
  // 4. Apple Music Non-linear Lyrics System
  // ==========================================

  function parseLyrics(rawText) {
    if (!rawText) return [];
    
    const parsed = rawText
      .split(/\r?\n/)
      .flatMap(line => {
        if (line.startsWith('[by:') || line.startsWith('[al:') || line.startsWith('[ar:') || line.startsWith('[ti:')) {
          return [];
        }
        
        const text = line.replace(/\[[^\]]+\]/g, '').trim();
        if (!text) return [];

        const matches = [...line.matchAll(/\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g)];
        return matches.map(match => {
          const minutes = parseInt(match[1], 10);
          const seconds = parseInt(match[2], 10);
          const fraction = match[3] ? parseInt(match[3].padEnd(3, '0').slice(0, 3), 10) / 1000 : 0;
          return {
            time: minutes * 60 + seconds + fraction,
            text: text
          };
        });
      })
      .sort((a, b) => a.time - b.time);

    // Merge duplicate/inline timestamps before calculating end times
    const merged = [];
    const timeMap = new Map();
    parsed.forEach(line => {
      const key = Math.round(line.time * 10) / 10;
      if (timeMap.has(key)) {
        const existing = timeMap.get(key);
        if (!existing.translation) {
          existing.translation = line.text;
        } else {
          existing.translation += " / " + line.text;
        }
      } else {
        const newLine = {
          time: line.time,
          text: line.text,
          translation: null
        };
        merged.push(newLine);
        timeMap.set(key, newLine);
      }
    });

    // Calculate end times for each line in the merged array
    for (let i = 0; i < merged.length; i++) {
      const current = merged[i];
      const next = merged[i + 1];
      
      if (next) {
        const gap = next.time - current.time;
        if (gap > 6.0) {
          // Large gap (instrumental break): fade out after natural duration
          const charCount = current.text.length;
          const duration = Math.max(4.0, charCount * 0.15 + 2.0);
          current.endTime = Math.min(next.time - 0.5, current.time + duration);
        } else {
          // Normal gap: stay highlighted until the next line starts
          current.endTime = next.time - 0.1;
        }
      } else {
        // Last line
        const charCount = current.text.length;
        const duration = Math.max(5.0, charCount * 0.15 + 2.0);
        current.endTime = current.time + duration;
      }
    }
    
    return merged;
  }

  function clearLyrics() {
    currentLyrics = [];
    currentLyricIndex = -1;
    currentHighlightIndex = -1;
    lyricsWrapper.classList.add('has-placeholder');
    lyricsWrapper.innerHTML = `
      <div class="no-lyrics-placeholder">
        <svg class="no-lyrics-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 18V5l12-2v13"></path>
          <circle cx="6" cy="18" r="3"></circle>
          <circle cx="18" cy="16" r="3"></circle>
        </svg>
        <p class="no-lyrics-text">无歌词</p>
      </div>
    `;
    lyricsStatus.textContent = '无歌词';
    lyricsStatus.style.borderColor = 'rgba(255, 255, 255, 0.08)';
    lyricsStatus.style.color = 'rgba(255, 255, 255, 0.5)';
    lyricsStatus.style.background = 'transparent';
    lyricsWrapper.style.transform = 'translateY(0px)';
    
    if (fsInstrumentalDots) {
      fsInstrumentalDots.classList.add('hidden');
      fsInstrumentalDots.classList.remove('count-3', 'count-2', 'count-1');
    }
    
    // Reset user scroll state
    userScrollOffset = 0;
    isUserScrolling = false;
    if (userScrollTimeout) {
      clearTimeout(userScrollTimeout);
      userScrollTimeout = null;
    }
  }

  async function loadLyrics(track) {
    const token = ++lyricsRequestToken;
    clearLyrics();
    
    if (!track.id && !track.lrc) {
      lyricsStatus.textContent = '本地音频';
      return;
    }

    lyricsStatus.textContent = '载入中';

    // Check cache
    if (lyricsCache.has(track.id)) {
      if (token !== lyricsRequestToken) return;
      currentLyrics = lyricsCache.get(track.id);
      finalizeLyricsLoading();
      return;
    }

    let loadedLyrics = null;

    // Try local proxy first if not running on file:// protocol
    if (window.location.protocol !== 'file:') {
      try {
        const lyricUrl = getApiUrl(`/api/lyric?id=${track.id}`);
        const response = await fetch(lyricUrl);
        if (response.ok) {
          const data = await response.json();
          const rawLrc = data.lrc?.lyric || '';
          const rawTLrc = data.tlyric?.lyric || '';
          
          const parsedLrc = parseLyrics(rawLrc);
          const parsedTLrc = parseLyrics(rawTLrc);
          
          loadedLyrics = mergeLyrics(parsedLrc, parsedTLrc);
        }
      } catch (err) {
        console.warn("Failed to load NetEase lyrics via proxy, trying fallback:", err);
      }
    }

    // Try public Meting API fallback directly
    if (!loadedLyrics) {
      try {
        console.log(`Fetching lyrics for song ${track.id} directly from Meting API fallback...`);
        const fallbackUrl = `https://v.iarc.top/?server=netease&type=lrc&id=${track.id}`;
        const resp = await fetch(fallbackUrl);
        if (resp.ok) {
          const lyricText = await resp.text(); // Meting type=lrc returns plain text
          loadedLyrics = parseLyrics(lyricText);
        }
      } catch (err2) {
        console.warn("Failed to fetch lyrics from Meting API fallback:", err2);
      }
    }

    if (token !== lyricsRequestToken) return;

    if (loadedLyrics !== null) {
      currentLyrics = loadedLyrics;
      lyricsCache.set(track.id, loadedLyrics);
      finalizeLyricsLoading();
    } else {
      lyricsWrapper.classList.add('has-placeholder');
      lyricsWrapper.innerHTML = `
        <div class="no-lyrics-placeholder">
          <svg class="no-lyrics-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 18V5l12-2v13"></path>
            <circle cx="6" cy="18" r="3"></circle>
            <circle cx="18" cy="16" r="3"></circle>
          </svg>
          <p class="no-lyrics-text">无歌词</p>
        </div>
      `;
      lyricsStatus.textContent = '无歌词';
    }
  }

  function mergeLyrics(original, translation) {
    if (original.length === 0) return [];
    if (translation.length === 0) return original;
    
    const tMap = new Map();
    translation.forEach(line => {
      const key = Math.round(line.time * 10) / 10;
      tMap.set(key, line.text);
    });

    return original.map(line => {
      const key = Math.round(line.time * 10) / 10;
      return {
        time: line.time,
        endTime: line.endTime,
        text: line.text,
        translation: line.translation || tMap.get(key) || null
      };
    });
  }

  function finalizeLyricsLoading() {
    if (currentLyrics.length === 0) {
      lyricsWrapper.classList.add('has-placeholder');
      lyricsWrapper.innerHTML = `
        <div class="no-lyrics-placeholder">
          <svg class="no-lyrics-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 18V5l12-2v13"></path>
            <circle cx="6" cy="18" r="3"></circle>
            <circle cx="18" cy="16" r="3"></circle>
          </svg>
          <p class="no-lyrics-text">无歌词</p>
        </div>
      `;
      lyricsStatus.textContent = '纯音乐';
    } else {
      lyricsWrapper.classList.remove('has-placeholder');
      renderLyrics();
      lyricsStatus.textContent = '同步中';
      lyricsStatus.style.borderColor = 'rgba(var(--color-accent-rgb), 0.3)';
      lyricsStatus.style.color = 'var(--color-accent)';
      lyricsStatus.style.background = 'var(--color-accent-bg)';
      currentLyricIndex = 0;
      currentHighlightIndex = 0;
      updateLyricsLayout(0, false);
    }
  }

  function renderLyrics() {
    lyricsWrapper.innerHTML = '';
    lyricsWrapper.classList.remove('has-placeholder');
    
    const singerRegex = /^([\u4e00-\u9fa5a-zA-Z0-9_\s]{1,10})[:：]\s*(.*)$/;
    const detectedSingers = [];

    currentLyrics.forEach((line, index) => {
      const el = document.createElement('div');
      el.className = 'item';
      
      let singerName = null;
      let textToShow = line.text;
      
      const matchText = line.text.match(singerRegex);
      if (matchText) {
        singerName = matchText[1];
        textToShow = matchText[2];
      }
      
      let translationToShow = line.translation;
      if (translationToShow && singerName) {
        const matchTrans = translationToShow.match(singerRegex);
        if (matchTrans) {
          translationToShow = matchTrans[2];
        }
      }
      
      let singerClass = 'singer-default';
      if (singerName) {
        const isDuet = singerName.includes('合') || singerName.includes('＆') || singerName.includes('&') || singerName.includes('和');
        if (!isDuet) {
          if (!detectedSingers.includes(singerName)) {
            detectedSingers.push(singerName);
          }
          const singerIndex = detectedSingers.indexOf(singerName);
          if (singerIndex === 0) {
            singerClass = 'singer-left';
          } else if (singerIndex === 1) {
            singerClass = 'singer-right';
          }
        }
        el.classList.add(singerClass);
      } else {
        el.classList.add('singer-default');
      }
      
      let html = '';
      if (singerName) {
        html += `<div class="lyric-singer-tag">${singerName}</div>`;
      }
      html += `<p>${textToShow}</p>`;
      if (translationToShow) {
        html += `<div class="lyric-translation">${translationToShow}</div>`;
      }
      el.innerHTML = html;
      
      el.setAttribute('data-index', index);
      el.setAttribute('data-time', line.time);
      
      el.addEventListener('click', () => {
        audio.currentTime = line.time;
        syncLyrics(line.time);
      });

      lyricsWrapper.appendChild(el);
    });
  }

  function updateLyricsLayout(scrollIndex, animate = true) {
    const items = lyricsWrapper.querySelectorAll('.item');
    if (!items.length || !currentLyrics.length) return;

    const activeIdx = scrollIndex < 0 ? 0 : scrollIndex;

    items.forEach((item, i) => {
      const isActive = i === currentHighlightIndex;
      if (isActive) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
      
      const distance = Math.abs(i - activeIdx);
      const opacityVal = isActive ? '1' : Math.max(0.38 - (distance * 0.05), 0.1);
      
      // Dynamic blur based on distance from active index
      const blurVal = isActive ? 0 : Math.min(2.5, distance * 0.8);
      item.style.filter = blurVal > 0 ? `blur(${blurVal}px)` : 'none';
      item.style.opacity = opacityVal;

      if (!animate) {
        item.style.transition = 'none';
      } else {
        item.style.transition = '';
      }
    });

    const containerHeight = lyricsScroller.clientHeight || window.innerHeight / 2.5;
    const gap = 24;
    const positions = new Array(items.length);

    // Compute static positions relative to the top of the wrapper
    let currentY = 0;
    for (let i = 0; i < items.length; i++) {
      positions[i] = currentY;
      currentY += (items[i].offsetHeight || 36) + gap;
    }

    // Position items statically inside the wrapper
    items.forEach((item, i) => {
      const yVal = positions[i];
      item.style.transform = `translateY(${yVal}px)`;
    });

    // Translate the wrapper to center the active item (unless the user is scrolling)
    if (!isUserScrolling && positions[activeIdx] !== undefined) {
      const activeHeight = items[activeIdx].offsetHeight || 36;
      const targetTranslation = containerHeight / 2 - (positions[activeIdx] + activeHeight / 2);
      if (animate) {
        // Spring physics overshoot transition curves
        lyricsWrapper.style.transition = 'transform 0.85s cubic-bezier(0.15, 0.85, 0.2, 1.08)';
      } else {
        lyricsWrapper.style.transition = 'none';
      }
      lyricsWrapper.style.transform = `translateY(${targetTranslation}px)`;
    }
  }

  function syncLyrics(currentTime) {
    if (currentLyrics.length === 0) return;

    if (currentTime < 0.5) {
      currentLyricIndex = -1;
      currentHighlightIndex = -1;
    }

    // Find the scroll index (the line that started most recently)
    let scrollIndex = -1;
    for (let i = 0; i < currentLyrics.length; i++) {
      if (currentLyrics[i].time <= currentTime + 0.2) {
        scrollIndex = i;
      } else {
        break;
      }
    }
    if (scrollIndex === -1) scrollIndex = 0;

    // Find the highlight index based on start/end times
    let highlightIndex = -1;
    const currentLine = currentLyrics[scrollIndex];
    if (currentLine && currentTime >= currentLine.time && currentTime <= currentLine.endTime) {
      highlightIndex = scrollIndex;
    }

    if (scrollIndex !== currentLyricIndex || highlightIndex !== currentHighlightIndex) {
      currentLyricIndex = scrollIndex;
      currentHighlightIndex = highlightIndex;
      updateLyricsLayout(scrollIndex, true);
    }

    // Update instrumental countdown dots
    updateInstrumentalCountdown(currentTime);
  }

  function updateInstrumentalCountdown(currentTime) {
    if (fsInstrumentalDots) {
      fsInstrumentalDots.classList.add('hidden');
      fsInstrumentalDots.classList.remove('count-3', 'count-2', 'count-1');
    }
  }

  function scheduleLyricsLayoutUpdate() {
    updateLyricsLayout(currentLyricIndex, false);
    setTimeout(() => updateLyricsLayout(currentLyricIndex, false), 50);
    setTimeout(() => updateLyricsLayout(currentLyricIndex, false), 150);
    setTimeout(() => updateLyricsLayout(currentLyricIndex, false), 300);
    setTimeout(() => updateLyricsLayout(currentLyricIndex, false), 450);
    setTimeout(() => updateLyricsLayout(currentLyricIndex, false), 650);
  }

  // Resize listener for layout calculation
  window.addEventListener('resize', () => {
    lyricsWrapper.classList.add('noTransition');
    updateLyricsLayout(currentLyricIndex, false);
    void lyricsWrapper.offsetHeight;
    lyricsWrapper.classList.remove('noTransition');
  });

  // ==========================================
  // 5. Playlist Drawer Interface & Search
  // ==========================================

  // Tab switching
  tabQueue.addEventListener('click', () => {
    tabQueue.classList.add('active');
    tabSearch.classList.remove('active');
    queueTabContent.classList.add('active');
    searchTabContent.classList.remove('active');
  });

  tabSearch.addEventListener('click', () => {
    tabSearch.classList.add('active');
    tabQueue.classList.remove('active');
    searchTabContent.classList.add('active');
    queueTabContent.classList.remove('active');
    onlineSearchInput.focus();
  });

  // Populate/update the playlist select dropdown
  function updatePlaylistSelect() {
    playlistSelect.innerHTML = '';
    
    // Add saved playlists
    savedPlaylists.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      if (p.id === currentPlaylistId) {
        opt.selected = true;
      }
      playlistSelect.appendChild(opt);
    });

    // Add temporary queue option if current queue contains local/unsaved songs
    const hasLocalOrUnsaved = currentPlaylist.some(t => t.url.startsWith('blob:') || !t.id);
    if (hasLocalOrUnsaved || currentPlaylistId === 'temporary') {
      const opt = document.createElement('option');
      opt.value = 'temporary';
      opt.textContent = '⚡ 临时播放队列 / 本地音乐';
      if (currentPlaylistId === 'temporary') {
        opt.selected = true;
      }
      playlistSelect.appendChild(opt);
    }

    // Update sidebar playlists list
    renderSidebarPlaylists();
  }

  // Render playlists in the left sidebar
  function renderSidebarPlaylists() {
    const listContainer = document.getElementById('sidebar-playlists-list');
    if (!listContainer) return;
    listContainer.innerHTML = '';
    
    savedPlaylists.forEach(p => {
      const btn = document.createElement('button');
      btn.className = 'nav-item sidebar-playlist-item';
      if (p.id === currentPlaylistId) {
        btn.classList.add('active');
      }
      
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 18V5l12-2v13"></path>
          <circle cx="6" cy="18" r="3"></circle>
          <circle cx="18" cy="16" r="3"></circle>
        </svg>
        <span>${p.name}</span>
      `;
      
      btn.addEventListener('click', () => {
        // Switch to the queue page
        const queueNavItem = document.querySelector('.sidebar .nav-item[data-tab="queue"]');
        if (queueNavItem) {
          queueNavItem.click();
        }
        
        // Select this playlist
        currentPlaylistId = p.id;
        playlistSelect.value = p.id;
        fetchOnlinePlaylist(p.id);
        
        // Update active class in sidebar playlists list
        document.querySelectorAll('.sidebar-playlist-item').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
      
      listContainer.appendChild(btn);
    });
  }

  // Handle switching playlists in select dropdown
  playlistSelect.addEventListener('change', (e) => {
    const val = e.target.value;
    if (val === 'temporary') {
      currentPlaylistId = 'temporary';
      bootstrapPlayer();
    } else if (val) {
      currentPlaylistId = val;
      fetchOnlinePlaylist(val);
    }
  });

  // Local Action Buttons
  importFileBtn.addEventListener('click', () => {
    localAudioFile.click();
  });

  importFolderBtn.addEventListener('click', () => {
    localFolderFile.click();
  });

  clearQueueBtn.addEventListener('click', () => {
    const confirmClear = confirm("确定要清空播放队列吗？");
    if (confirmClear) {
      currentPlaylist = [];
      currentPlaylistId = 'temporary';
      currentTrackIndex = 0;
      audio.pause();
      audio.src = '';
      syncUIState(false);
      bootstrapPlayer();
      showToast("播放队列已清空");
    }
  });

  // Online Search Logic
  let searchDebounceTimeout = null;
  onlineSearchInput.addEventListener('input', (e) => {
    clearTimeout(searchDebounceTimeout);
    const query = e.target.value.trim();
    if (!query) {
      onlineSearchResults.innerHTML = `<div class="playlist-empty">${MUSIC_NOTE_SVG}<span>输入关键词搜索网易云音乐</span></div>`;
      const categoriesPanel = document.getElementById('search-categories-panel');
      const resultsPanel = document.getElementById('search-results-panel');
      if (categoriesPanel) categoriesPanel.classList.remove('hidden');
      if (resultsPanel) resultsPanel.classList.add('hidden');
      return;
    }
    
    searchDebounceTimeout = setTimeout(() => {
      performOnlineSearch(query);
    }, 500);
  });

  async function performOnlineSearch(query) {
    onlineSearchResults.innerHTML = '<div class="playlist-empty">搜索中... 🔍</div>';
    
    // Toggle result panels visibility
    const categoriesPanel = document.getElementById('search-categories-panel');
    const resultsPanel = document.getElementById('search-results-panel');
    if (query.trim() !== '') {
      if (categoriesPanel) categoriesPanel.classList.add('hidden');
      if (resultsPanel) resultsPanel.classList.remove('hidden');
    } else {
      if (categoriesPanel) categoriesPanel.classList.remove('hidden');
      if (resultsPanel) resultsPanel.classList.add('hidden');
    }

    try {
      const response = await fetch(getApiUrl(`/api/search?s=${encodeURIComponent(query)}`));
      if (!response.ok) throw new Error("Search request failed");
      const data = await response.json();
      const songs = data.result?.songs || [];
      
      // Prefetch cover art images in one batch detail API request
      if (songs.length > 0) {
        const ids = songs.map(s => s.id).join(',');
        try {
          const detailRes = await fetch(getApiUrl(`/api/detail?id=${ids}`));
          if (detailRes.ok) {
            const detailData = await detailRes.json();
            const picMap = new Map();
            detailData.songs?.forEach(s => {
              if (s.album?.picUrl) {
                picMap.set(s.id, s.album.picUrl);
              }
            });
            songs.forEach(s => {
              s.album = s.album || {};
              s.album.picUrl = picMap.get(s.id);
            });
          }
        } catch (detailErr) {
          console.warn("Failed to prefetch search covers:", detailErr);
        }
      }
      
      renderOnlineSearchResults(songs);
    } catch (err) {
      console.error("Online search error:", err);
      onlineSearchResults.innerHTML = `
        <div class="playlist-empty">
          <svg class="placeholder-svg warning-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 24px; height: 24px; opacity: 0.6; display: block; margin: 12px auto; color: #ff9500;">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
            <line x1="12" y1="9" x2="12" y2="13"></line>
            <line x1="12" y1="17" x2="12.01" y2="17"></line>
          </svg>
          <span>搜索失败，请检查网络</span>
        </div>
      `;
    }
  }

  function renderOnlineSearchResults(songs) {
    onlineSearchResults.innerHTML = '';
    if (songs.length === 0) {
      onlineSearchResults.innerHTML = `<div class="playlist-empty">${MUSIC_NOTE_SVG}<span>未找到相关歌曲</span></div>`;
      return;
    }

    songs.forEach((song) => {
      const artistName = song.artists.map(a => a.name).join('/');
      const item = document.createElement('div');
      item.className = 'playlist-item';
      const coverUrl = song.album?.picUrl ? getHdCoverUrl(song.album.picUrl) : 'default.svg';
      
      item.innerHTML = `
        <div class="item-left">
          <img class="item-cover" src="${coverUrl}" onerror="this.onerror=null; this.src='default.svg'; window.fetchSingleCover && window.fetchSingleCover(this, ${song.id});" alt="" loading="lazy">
          <div class="item-info">
            <span class="item-title">${song.name}</span>
            <span class="item-artist">${artistName} - ${song.album.name}</span>
          </div>
        </div>
        <div class="item-right-actions">
          <button class="item-action-btn add-to-queue-btn" title="添加到队列末尾">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          </button>
        </div>
      `;

      item.addEventListener('click', (e) => {
        if (e.target.closest('.add-to-queue-btn')) return;
        playSongNow(song);
      });

      item.querySelector('.add-to-queue-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        addSongToQueueEnd(song);
      });

      onlineSearchResults.appendChild(item);
    });
  }

  async function playSongNow(song) {
    const track = {
      id: song.id,
      name: song.name,
      artist: song.artists.map(a => a.name).join('/'),
      url: `https://music.163.com/song/media/outer/url?id=${song.id}.mp3`,
      pic: song.album?.picUrl ? getHdCoverUrl(song.album.picUrl) : 'default.svg',
      lrc: null
    };

    let targetIndex = 0;
    if (currentPlaylist.length === 0) {
      currentPlaylist.push(track);
      targetIndex = 0;
    } else {
      currentPlaylist.splice(currentTrackIndex + 1, 0, track);
      targetIndex = currentTrackIndex + 1;
    }

    currentPlaylistId = 'temporary';
    updatePlaylistSelect();
    renderPlaylistSongs();
    document.body.classList.remove('no-files');
    loadTrack(targetIndex);
    playAudio();
    
    showToast(`正在播放《${song.name}》`);
    const queueNavItem = document.querySelector('.sidebar .nav-item[data-tab="queue"]');
    if (queueNavItem) queueNavItem.click();
  }

  function addSongToQueueEnd(song) {
    const track = {
      id: song.id,
      name: song.name,
      artist: song.artists.map(a => a.name).join('/'),
      url: `https://music.163.com/song/media/outer/url?id=${song.id}.mp3`,
      pic: song.album?.picUrl ? getHdCoverUrl(song.album.picUrl) : 'default.svg',
      lrc: null
    };

    currentPlaylist.push(track);
    currentPlaylistId = 'temporary';
    updatePlaylistSelect();
    renderPlaylistSongs();
    
    showToast(`已将《${song.name}》添加到队列末尾`);
  }

  // Toast notification helper
  function showToast(message) {
    const toast = document.createElement('div');
    toast.style.position = 'fixed';
    toast.style.bottom = '30px';
    toast.style.left = '50%';
    toast.style.transform = 'translateX(-50%)';
    toast.style.background = 'rgba(18, 19, 26, 0.9)';
    toast.style.backdropFilter = 'blur(10px)';
    toast.style.webkitBackdropFilter = 'blur(10px)';
    toast.style.border = '1px solid rgba(255, 255, 255, 0.15)';
    toast.style.color = '#ffffff';
    toast.style.padding = '10px 20px';
    toast.style.borderRadius = '99px';
    toast.style.fontSize = '0.82rem';
    toast.style.fontWeight = '600';
    toast.style.boxShadow = '0 10px 30px rgba(0, 0, 0, 0.5)';
    toast.style.zIndex = '9999';
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    toast.style.transform = 'translate(-50%, 10px)';
    toast.textContent = message;
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translate(-50%, 0)';
    }, 10);
    
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translate(-50%, 10px)';
      setTimeout(() => {
        toast.remove();
      }, 300);
    }, 2500);
  }

  // Fetch song details (like picUrl) in the background to get HD cover
  async function fetchHDInfo(track) {
    if (!track.id) return;
    try {
      let hdCover = null;

      // Try local proxy first if not running on file:// protocol
      if (window.location.protocol !== 'file:') {
        try {
          const response = await fetch(getApiUrl(`/api/detail?id=${track.id}`));
          if (response.ok) {
            const data = await response.json();
            const songDetail = data.songs?.[0];
            if (songDetail?.album?.picUrl) {
              hdCover = getHdCoverUrl(songDetail.album.picUrl);
            }
          }
        } catch (err) {
          console.warn("Local proxy HD info fetch failed, trying public API fallback...", err);
        }
      }

      // If local proxy failed or was skipped due to file://, try direct Meting API
      if (!hdCover) {
        console.log(`Fetching HD cover for song ${track.id} directly from Meting API fallback...`);
        const response = await fetch(`https://v.iarc.top/?server=netease&type=song&id=${track.id}`);
        if (response.ok) {
          const songList = await response.json();
          const songDetail = songList?.[0];
          if (songDetail?.pic) {
            hdCover = getHdCoverUrl(songDetail.pic);
          }
        }
      }

      if (hdCover) {
        track.pic = hdCover;
        
        // If the track is still active, update UI!
        if (currentPlaylist[currentTrackIndex] === track) {
          albumCoverImg.style.backgroundImage = `url('${hdCover}')`;
          const fsAlbumCoverImg = document.getElementById('fs-cover-art');
          if (fsAlbumCoverImg) fsAlbumCoverImg.style.backgroundImage = `url('${hdCover}')`;
          if (fsCoverGlow) fsCoverGlow.style.backgroundImage = `url('${hdCover}')`;
          updateFluidColors(hdCover);
        }
      }
    } catch (e) {
      console.warn("Failed to fetch HD cover art:", e);
    }
  }

  // Prefetch cover arts for all NetEase tracks in the loaded playlist in batches of 100
  async function preFetchPlaylistCovers(playlistToFetch) {
    const tracksNeedCover = playlistToFetch.filter(t => t.id && (!t.pic || t.pic === 'default.svg' || t.pic.includes('default.svg') || t.pic.includes('iarc.top')));
    if (tracksNeedCover.length === 0) return;
    
    console.log(`Pre-fetching covers for ${tracksNeedCover.length} tracks in batches...`);
    const chunkSize = 100;
    
    for (let i = 0; i < tracksNeedCover.length; i += chunkSize) {
      const chunk = tracksNeedCover.slice(i, i + chunkSize);
      const ids = chunk.map(t => t.id).join(',');
      try {
        const response = await fetch(getApiUrl(`/api/detail?id=${ids}`));
        if (response.ok) {
          const data = await response.json();
          const picMap = new Map();
          data.songs?.forEach(s => {
            if (s.album?.picUrl) {
              picMap.set(s.id, getHdCoverUrl(s.album.picUrl));
            }
          });
          
          chunk.forEach(t => {
            const pic = picMap.get(t.id);
            if (pic) {
              t.pic = pic;
            }
          });
          
          // Re-render playlist songs to show loaded thumbnails for this batch
          renderPlaylistSongs(playlistSearch?.value.trim() || '');
        }
      } catch (e) {
        console.warn(`Failed to prefetch playlist covers batch starting at index ${i}:`, e);
      }
    }
    
    // If current active track's cover got updated, sync it immediately
    const activeTrack = currentPlaylist[currentTrackIndex];
    if (activeTrack && activeTrack.pic && activeTrack.pic !== 'default.svg' && !activeTrack.pic.includes('iarc.top')) {
      const coverUrl = getHdCoverUrl(activeTrack.pic);
      albumCoverImg.style.backgroundImage = `url('${coverUrl}')`;
      const fsAlbumCoverImg = document.getElementById('fs-cover-art');
      if (fsAlbumCoverImg) fsAlbumCoverImg.style.backgroundImage = `url('${coverUrl}')`;
      if (fsCoverGlow) fsCoverGlow.style.backgroundImage = `url('${coverUrl}')`;
      updateFluidColors(coverUrl);
    }
    
    // Save back updated playlist cache
    if (currentPlaylistId !== 'temporary') {
      localStorage.setItem('aura-custom-playlist', JSON.stringify(currentPlaylist.filter(t => !t.url.startsWith('blob:'))));
    }
  }

  // Globally accessible helper to fetch a single song's cover art if it fails to load in the list
  window.fetchSingleCover = async function(imgEl, songId) {
    if (!songId) return;
    try {
      const response = await fetch(getApiUrl(`/api/detail?id=${songId}`));
      if (response.ok) {
        const data = await response.json();
        const songDetail = data.songs?.[0];
        if (songDetail?.album?.picUrl) {
          const hdCover = getHdCoverUrl(songDetail.album.picUrl);
          imgEl.src = hdCover;
          
          // Also update the track object in currentPlaylist if possible
          const track = currentPlaylist.find(t => t.id === songId);
          if (track) {
            track.pic = hdCover;
            // Save back updated playlist cache
            if (currentPlaylistId !== 'temporary') {
              localStorage.setItem('aura-custom-playlist', JSON.stringify(currentPlaylist.filter(t => !t.url.startsWith('blob:'))));
            }
          }
        }
      }
    } catch (e) {
      console.warn("Failed to fetch single cover on error:", e);
    }
  };

  function renderPlaylistSongs(query = '') {
    playlistSongsList.innerHTML = '';
    const drawerCopy = document.getElementById('drawer-songs-list-copy');
    if (drawerCopy) drawerCopy.innerHTML = '';

    const filtered = [];
    
    currentPlaylist.forEach((track, index) => {
      const matchName = track.name.toLowerCase().includes(query.toLowerCase());
      const matchArtist = track.artist.toLowerCase().includes(query.toLowerCase());
      if (query && !matchName && !matchArtist) return;
      
      filtered.push({ track, index });
    });
    
    playlistCountEl.textContent = currentPlaylist.length;
    
    if (filtered.length === 0) {
      playlistSongsList.innerHTML = `<div class="playlist-empty">${MUSIC_NOTE_SVG}<span>暂无匹配歌曲</span></div>`;
      if (drawerCopy) drawerCopy.innerHTML = `<div class="playlist-empty">${MUSIC_NOTE_SVG}<span>暂无匹配歌曲</span></div>`;
      return;
    }

    filtered.forEach(({ track, index }) => {
      const isActive = index === currentTrackIndex;
      const isPlaying = isActive && !audio.paused;
      
      // Main playlist item (4-column grid: index, cover, info, artist)
      const item = document.createElement('div');
      item.className = `playlist-item ${isActive ? 'active' : ''} ${isPlaying ? 'playing' : ''}`;
      item.innerHTML = `
        <span class="item-index">${(index + 1).toString().padStart(2, '0')}</span>
        <img class="item-cover" src="${getHdCoverUrl(track.pic)}" onerror="this.onerror=null; this.src='default.svg'; window.fetchSingleCover && window.fetchSingleCover(this, ${track.id});" alt="" loading="lazy">
        <div class="item-info">
          <span class="item-title">${track.name}</span>
          <div class="item-eq-indicator">
            <span class="eq-dot"></span>
            <span class="eq-dot"></span>
            <span class="eq-dot"></span>
          </div>
        </div>
        <span class="col-artist">${track.artist}</span>
      `;
      
      item.addEventListener('click', () => {
        if (index === currentTrackIndex) {
          togglePlay();
        } else {
          loadTrack(index);
          playAudio();
        }
      });
      
      playlistSongsList.appendChild(item);

      // Drawer playlist item (stacked list)
      if (drawerCopy) {
        const drawerItem = document.createElement('div');
        drawerItem.className = `drawer-playlist-item ${isActive ? 'active' : ''} ${isPlaying ? 'playing' : ''}`;
        drawerItem.innerHTML = `
          <span class="drawer-item-index">${(index + 1).toString().padStart(2, '0')}</span>
          <div class="drawer-item-info">
            <span class="drawer-item-title">${track.name}</span>
            <span class="drawer-item-artist">${track.artist}</span>
          </div>
          <div class="item-eq-indicator">
            <span class="eq-dot"></span>
            <span class="eq-dot"></span>
            <span class="eq-dot"></span>
          </div>
        `;
        
        drawerItem.addEventListener('click', () => {
          if (index === currentTrackIndex) {
            togglePlay();
          } else {
            loadTrack(index);
            playAudio();
          }
        });
        drawerCopy.appendChild(drawerItem);
      }
    });
  }

  function syncPlaylistDrawerActive() {
    const items = document.querySelectorAll('.playlist-item, .drawer-playlist-item, .fs-queue-item');
    items.forEach((item) => {
      const indexElement = item.querySelector('.item-index, .drawer-item-index, .fs-queue-item-index');
      if (!indexElement) return;
      const index = parseInt(indexElement.textContent, 10) - 1;
      if (index === currentTrackIndex) {
        item.classList.add('active');
        if (!audio.paused) {
          item.classList.add('playing');
        } else {
          item.classList.remove('playing');
        }
        
        // Only scroll drawer copy items to avoid main page jumpiness
        if (item.classList.contains('drawer-playlist-item')) {
          const rect = item.getBoundingClientRect();
          const parent = item.parentElement;
          if (parent) {
            const parentRect = parent.getBoundingClientRect();
            if (rect.top < parentRect.top || rect.bottom > parentRect.bottom) {
              item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
          }
        }
      } else {
        item.classList.remove('active', 'playing');
      }
    });
  }

  playlistToggleBtn.addEventListener('click', () => {
    playlistDrawer.classList.toggle('open');
    if (playlistDrawer.classList.contains('open')) {
      setTimeout(syncPlaylistDrawerActive, 50);
    }
  });

  playlistCloseBtn.addEventListener('click', () => {
    playlistDrawer.classList.remove('open');
  });

  playlistSearch.addEventListener('input', (e) => {
    renderPlaylistSongs(e.target.value.trim());
  });

  // ==========================================
  // 6. NetEase Playlist Custom Importer Modal
  // ==========================================
  
  importPlaylistBtn.addEventListener('click', () => {
    importModal.classList.add('show');
    playlistInput.value = '';
    playlistInput.focus();
  });

  modalCloseBtn.addEventListener('click', () => {
    importModal.classList.remove('show');
  });

  modalCancelBtn.addEventListener('click', () => {
    importModal.classList.remove('show');
  });

  modalSubmitBtn.addEventListener('click', () => {
    const inputVal = playlistInput.value.trim();
    if (!inputVal) {
      showToast("请输入歌单 ID 或链接！");
      return;
    }

    const idMatch = inputVal.match(/id=(\d+)/) || inputVal.match(/^(\d+)$/);
    if (!idMatch) {
      showToast("无法识别歌单 ID，请确保链接中包含 id=数字，或直接输入数字 ID。");
      return;
    }

    const playlistId = idMatch[1];
    modalSubmitBtn.textContent = '载入中...';
    modalSubmitBtn.disabled = true;

    fetchOnlinePlaylist(playlistId)
      .then(() => {
        importModal.classList.remove('show');
        showToast("歌单导入成功！");
      })
      .catch(() => {
        showToast("导入歌单失败，请确认该歌单为公开歌单！");
      })
      .finally(() => {
        modalSubmitBtn.textContent = '导入并播放';
        modalSubmitBtn.disabled = false;
      });
  });

  playlistInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      modalSubmitBtn.click();
    }
  });

  importModal.addEventListener('click', (e) => {
    if (e.target === importModal) {
      importModal.classList.remove('show');
    }
  });

  // ==========================================
  // 7. Interactive Slider Timeline
  // ==========================================

  function formatTime(secs) {
    if (isNaN(secs) || !isFinite(secs)) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  audio.addEventListener('loadedmetadata', () => {
    const formatted = `-${formatTime(audio.duration)}`;
    totalTimeEl.textContent = formatted;
    if (fsTotalTime) fsTotalTime.textContent = formatted;
  });

  audio.addEventListener('timeupdate', () => {
    if (isDraggingProgress || !audio.duration) return;
    
    const pct = (audio.currentTime / audio.duration) * 100;
    
    // Mini bar progress
    progressSlider.value = pct;
    sliderFill.style.width = pct + '%';
    sliderFill.parentElement.style.setProperty('--slider-percent', pct + '%');
    currentTimeEl.textContent = formatTime(audio.currentTime);
    totalTimeEl.textContent = `-${formatTime(audio.duration - audio.currentTime)}`;
    
    // Fullscreen bar progress
    if (fsProgressSlider) {
      fsProgressSlider.value = pct;
      fsSliderFill.style.width = pct + '%';
      fsSliderFill.parentElement.style.setProperty('--slider-percent', pct + '%');
      fsCurrentTime.textContent = formatTime(audio.currentTime);
      fsTotalTime.textContent = `-${formatTime(audio.duration - audio.currentTime)}`;
    }
    
    syncLyrics(audio.currentTime);
  });

  audio.addEventListener('ended', () => {
    if (loopMode === 'single') {
      audio.currentTime = 0;
      playAudio();
    } else {
      playNext();
    }
  });

  audio.addEventListener('error', (e) => {
    console.error('Audio load error:', e);
    
    // Auto-fallback quietly when the current source fails
    const track = currentPlaylist[currentTrackIndex];
    if (track && track.id && currentSourceIndex !== -1 && (currentSourceIndex + 1) < AUDIO_SOURCES.length) {
      const nextSourceIndex = currentSourceIndex + 1;
      console.log(`Audio source index ${currentSourceIndex} failed. Retrying silently with source index ${nextSourceIndex}...`);
      loadTrackSource(track, nextSourceIndex);
      playAudio();
      return;
    }
    
    consecutiveErrors++;
    
    if (consecutiveErrors >= currentPlaylist.length) {
      trackNameEl.textContent = '❌ 所有歌曲播放失败';
      trackArtistEl.textContent = '请检查网络';
      stopEqualizerAnimation();
      return;
    }

    trackArtistEl.textContent = '⚠️ 无法加载曲目，正在跳过...';
    setTimeout(playNext, 1800);
  });

  // Timeline dragging
  progressSlider.addEventListener('mousedown', () => { isDraggingProgress = true; });
  progressSlider.addEventListener('touchstart', () => { isDraggingProgress = true; });
  
  progressSlider.addEventListener('input', () => {
    if (!audio.duration) return;
    const pct = progressSlider.value;
    sliderFill.style.width = pct + '%';
    sliderFill.parentElement.style.setProperty('--slider-percent', pct + '%');
    const virtualTime = audio.duration * (pct / 100);
    currentTimeEl.textContent = formatTime(virtualTime);
    totalTimeEl.textContent = `-${formatTime(audio.duration - virtualTime)}`;
  });

  const releaseProgressSlider = (e) => {
    if (isDraggingProgress) {
      isDraggingProgress = false;
      if (audio.duration) {
        const val = e && e.target ? e.target.value : progressSlider.value;
        audio.currentTime = audio.duration * (val / 100);
      }
    }
  };

  progressSlider.addEventListener('mouseup', releaseProgressSlider);
  progressSlider.addEventListener('touchend', releaseProgressSlider);
  progressSlider.addEventListener('change', releaseProgressSlider);

  // Fullscreen timeline dragging
  if (fsProgressSlider) {
    fsProgressSlider.addEventListener('mousedown', () => { isDraggingProgress = true; });
    fsProgressSlider.addEventListener('touchstart', () => { isDraggingProgress = true; });
    
    fsProgressSlider.addEventListener('input', () => {
      if (!audio.duration) return;
      const pct = fsProgressSlider.value;
      fsSliderFill.style.width = pct + '%';
      fsSliderFill.parentElement.style.setProperty('--slider-percent', pct + '%');
      const virtualTime = audio.duration * (pct / 100);
      fsCurrentTime.textContent = formatTime(virtualTime);
      fsTotalTime.textContent = `-${formatTime(audio.duration - virtualTime)}`;
      
      // Keep small timeline in visual sync during drag
      sliderFill.style.width = pct + '%';
      sliderFill.parentElement.style.setProperty('--slider-percent', pct + '%');
      currentTimeEl.textContent = formatTime(virtualTime);
      totalTimeEl.textContent = `-${formatTime(audio.duration - virtualTime)}`;
    });

    fsProgressSlider.addEventListener('mouseup', releaseProgressSlider);
    fsProgressSlider.addEventListener('touchend', releaseProgressSlider);
    fsProgressSlider.addEventListener('change', releaseProgressSlider);
  }

  // Volume Slider control
  function updateVolume(val, updateInputElements = true) {
    audio.volume = val / 100;
    audio.muted = (val === 0);
    localStorage.setItem('aura-volume', val);
    
    volumeFill.style.width = val + '%';
    volumeFill.parentElement.style.setProperty('--volume-percent', val + '%');
    
    if (fsVolumeFill) {
      fsVolumeFill.style.width = val + '%';
      fsVolumeFill.parentElement.style.setProperty('--volume-percent', val + '%');
    }
    
    if (updateInputElements) {
      volumeSlider.value = val;
      if (fsVolumeSlider) fsVolumeSlider.value = val;
    }
    
    updateVolumeIcon(val);
  }

  volumeSlider.addEventListener('input', () => {
    updateVolume(parseInt(volumeSlider.value, 10), true);
  });

  if (fsVolumeSlider) {
    fsVolumeSlider.addEventListener('input', () => {
      updateVolume(parseInt(fsVolumeSlider.value, 10), true);
    });
  }

  function updateVolumeIcon(volVal) {
    const isMuted = volVal === 0 || audio.muted;
    if (isMuted) {
      volHighIcon.style.display = 'none';
      volMutedIcon.style.display = 'block';
      if (fsMuteLow) fsMuteLow.style.display = 'none';
      if (fsMuteMuted) fsMuteMuted.style.display = 'block';
    } else {
      volHighIcon.style.display = 'block';
      volMutedIcon.style.display = 'none';
      if (fsMuteLow) fsMuteLow.style.display = 'block';
      if (fsMuteMuted) fsMuteMuted.style.display = 'none';
    }
  }

  function toggleMute() {
    audio.muted = !audio.muted;
    if (audio.muted) {
      updateVolumeIcon(0);
      volumeFill.style.width = '0%';
      volumeFill.parentElement.style.setProperty('--volume-percent', '0%');
      if (fsVolumeFill) {
        fsVolumeFill.style.width = '0%';
        fsVolumeFill.parentElement.style.setProperty('--volume-percent', '0%');
      }
    } else {
      const vol = parseInt(volumeSlider.value, 10);
      const targetVol = vol === 0 ? 30 : vol;
      updateVolume(targetVol, true);
    }
  }

  muteBtn.addEventListener('click', toggleMute);
  if (fsMuteBtn) fsMuteBtn.addEventListener('click', toggleMute);

  // Playback control trigger clicks
  playTriggerBtn.addEventListener('click', togglePlay);
  prevBtn.addEventListener('click', playPrev);
  nextBtn.addEventListener('click', playNext);

  // Fullscreen controls clicks
  const fsPlayBtn = document.getElementById('fs-play-btn');
  const fsPrevBtn = document.getElementById('fs-prev-btn');
  const fsNextBtn = document.getElementById('fs-next-btn');

  if (fsPlayBtn) fsPlayBtn.addEventListener('click', togglePlay);
  if (fsPrevBtn) fsPrevBtn.addEventListener('click', playPrev);
  if (fsNextBtn) fsNextBtn.addEventListener('click', playNext);

  if (fsShuffleBtn) {
    fsShuffleBtn.addEventListener('click', () => {
      loopMode = loopMode === 'shuffle' ? 'list' : 'shuffle';
      localStorage.setItem('aura-loop-mode', loopMode);
      updateLoopModeUI();
    });
  }

  if (fsLoopBtn) {
    fsLoopBtn.addEventListener('click', () => {
      // Toggle repeat single / repeat list, bypassing shuffle
      loopMode = loopMode === 'single' ? 'list' : 'single';
      localStorage.setItem('aura-loop-mode', loopMode);
      updateLoopModeUI();
    });
  }

  if (fsVolLowIcon) {
    fsVolLowIcon.addEventListener('click', () => {
      updateVolume(0, true);
    });
  }

  if (fsVolHighIcon) {
    fsVolHighIcon.addEventListener('click', () => {
      updateVolume(100, true);
    });
  }
  if (fsClearQueueBtn) {
    fsClearQueueBtn.addEventListener('click', () => {
      clearQueueBtn.click();
    });
  }

  // Fullscreen Track Options Popover Menu toggles and options
  if (fsTrackOptionsBtn && fsOptionsMenu) {
    fsTrackOptionsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const rect = fsTrackOptionsBtn.getBoundingClientRect();
      const menuWidth = 220;
      const menuHeight = 130;
      
      let left = rect.left + rect.width / 2 - menuWidth / 2;
      let top = rect.bottom + 8;
      
      if (left + menuWidth > window.innerWidth) {
        left = window.innerWidth - menuWidth - 16;
      }
      if (left < 16) left = 16;
      
      if (top + menuHeight > window.innerHeight) {
        top = rect.top - menuHeight - 8;
      }
      
      fsOptionsMenu.style.left = `${left}px`;
      fsOptionsMenu.style.top = `${top}px`;
      fsOptionsMenu.classList.toggle('show');
    });

    document.addEventListener('click', (e) => {
      if (!fsOptionsMenu.contains(e.target) && e.target !== fsTrackOptionsBtn) {
        fsOptionsMenu.classList.remove('show');
      }
    });

    const copyInfoBtn = document.getElementById('fs-menu-copy-info');
    const copyLinkBtn = document.getElementById('fs-menu-copy-link');
    const downloadBtn = document.getElementById('fs-menu-download');

    function copyToClipboard(text, successMessage) {
      navigator.clipboard.writeText(text).then(() => {
        showToast(successMessage || '已复制到剪贴板');
      }).catch(err => {
        console.error('复制失败:', err);
        const input = document.createElement('textarea');
        input.value = text;
        document.body.appendChild(input);
        input.select();
        try {
          document.execCommand('copy');
          showToast(successMessage || '已复制到剪贴板');
        } catch (e) {
          showToast('复制失败，请手动复制');
        }
        document.body.removeChild(input);
      });
    }

    async function downloadTrack(track) {
      if (!track) return;
      const filename = `${track.name} - ${track.artist}.mp3`;
      let url = track.url;
      if (track.id && !track.file) {
        url = `https://music.163.com/song/media/outer/url?id=${track.id}.mp3`;
      }
      
      showToast('开始下载...');
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error("CORS or network error");
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
        showToast('下载完成');
      } catch (err) {
        console.warn("Failed to download via fetch, opening in new tab:", err);
        window.open(url, '_blank');
        showToast('已在新窗口打开播放，请手动保存');
      }
    }

    if (copyInfoBtn) {
      copyInfoBtn.addEventListener('click', () => {
        const track = currentPlaylist[currentTrackIndex];
        if (track) {
          copyToClipboard(`${track.name} - ${track.artist}`, '已复制歌曲信息');
        }
        fsOptionsMenu.classList.remove('show');
      });
    }

    if (copyLinkBtn) {
      copyLinkBtn.addEventListener('click', () => {
        const track = currentPlaylist[currentTrackIndex];
        if (track) {
          if (track.id && !track.file) {
            copyToClipboard(`https://music.163.com/#/song?id=${track.id}`, '已复制网易云链接');
          } else {
            showToast('本地歌曲无网易云链接');
          }
        }
        fsOptionsMenu.classList.remove('show');
      });
    }

    if (downloadBtn) {
      downloadBtn.addEventListener('click', () => {
        const track = currentPlaylist[currentTrackIndex];
        if (track) {
          downloadTrack(track);
        }
        fsOptionsMenu.classList.remove('show');
      });
    }
  }
  
  coverTrigger.addEventListener('dblclick', togglePlay);

  coverTrigger.addEventListener('click', (e) => {
    if (e.detail === 1) {
      setTimeout(() => {
        if (!isDoubleClick) {
          const selectLocal = confirm("你想从本地选择音频文件播放吗？\n(确定：选择音频 | 取消：仅双击封面播放/暂停)");
          if (selectLocal) {
            localAudioFile.click();
          }
        }
        isDoubleClick = false;
      }, 200);
    } else {
      isDoubleClick = true;
    }
  });

  let isDoubleClick = false;

  // Single File Import
  localAudioFile.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    showToast("正在读取音频元数据...");
    e.target.value = '';

    extractMetadata(file, (metadata) => {
      const localTrack = {
        id: null,
        name: metadata.title,
        artist: metadata.artist,
        url: metadata.url,
        pic: metadata.pic || 'default.svg',
        lrc: null,
        file: file,
        tagsLoaded: true
      };

      currentPlaylist.unshift(localTrack);
      currentPlaylistId = 'temporary';
      updatePlaylistSelect();
      bootstrapPlayer();
      loadTrack(0);
      playAudio();

      const selectLrc = confirm("要为该音频导入本地歌词 (.lrc 文件) 吗？");
      if (selectLrc) {
        localLrcFile.click();
      }
    });
  });

  // Local LRC file import for active track
  localLrcFile.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target.result;
      const parsed = parseLyrics(text);
      
      const currentTrack = currentPlaylist[currentTrackIndex];
      if (currentTrack) {
        currentTrack.lrc = 'local';
        currentTrack.lrcFile = file;
      }
      
      currentLyrics = parsed;
      currentLyricIndex = -1;

      if (currentLyrics.length === 0) {
        lyricsWrapper.classList.add('has-placeholder');
        lyricsWrapper.innerHTML = `
          <div class="no-lyrics-placeholder">
            <svg class="no-lyrics-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 18V5l12-2v13"></path>
              <circle cx="6" cy="18" r="3"></circle>
              <circle cx="18" cy="16" r="3"></circle>
            </svg>
            <p class="no-lyrics-text">无歌词</p>
          </div>
        `;
        lyricsStatus.textContent = '解析失败';
      } else {
        renderLyrics();
        lyricsStatus.textContent = '本地歌词';
        lyricsStatus.style.borderColor = 'rgba(var(--color-accent-rgb), 0.3)';
        lyricsStatus.style.color = 'var(--color-accent)';
        lyricsStatus.style.background = 'var(--color-accent-bg)';
        updateLyricsLayout(0, false);
      }
    };
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  });

  // Folder Import
  localFolderFile.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    showToast(`正在扫描文件夹，共 ${files.length} 个文件...`);

    const audioExtensions = ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'mp4'];
    const audioFiles = [];
    const lrcFiles = new Map();

    files.forEach(file => {
      const ext = file.name.substring(file.name.lastIndexOf('.') + 1).toLowerCase();
      const baseName = file.name.replace(/\.[^/.]+$/, "").trim().toLowerCase();
      
      if (audioExtensions.includes(ext)) {
        audioFiles.push(file);
      } else if (ext === 'lrc') {
        lrcFiles.set(baseName, file);
      }
    });

    if (audioFiles.length === 0) {
      showToast("未在选择的文件夹中找到音频文件！");
      e.target.value = '';
      return;
    }

    const importedTracks = [];
    audioFiles.forEach(file => {
      let baseName = file.name.replace(/\.[^/.]+$/, "");
      let artist = '本地音频';
      
      if (baseName.includes(' - ')) {
        const parts = baseName.split(' - ');
        artist = parts[0].trim();
        baseName = parts[1].trim();
      }

      const lookupName = file.name.replace(/\.[^/.]+$/, "").trim().toLowerCase();
      const matchedLrcFile = lrcFiles.get(lookupName);

      importedTracks.push({
        id: null,
        name: baseName,
        artist: artist,
        url: URL.createObjectURL(file),
        pic: 'default.svg',
        lrc: matchedLrcFile ? 'local' : null,
        file: file,
        lrcFile: matchedLrcFile || null,
        tagsLoaded: false
      });
    });

    currentPlaylist = currentPlaylist.concat(importedTracks);
    currentPlaylistId = 'temporary';
    updatePlaylistSelect();
    bootstrapPlayer();
    
    showToast(`成功导入 ${importedTracks.length} 首本地歌曲！`);
    e.target.value = '';
  });

  // Metadata extract helper using jsmediatags
  function extractMetadata(file, callback) {
    const defaultMeta = {
      title: file.name.replace(/\.[^/.]+$/, ""),
      artist: '本地音频',
      url: URL.createObjectURL(file),
      pic: 'default.svg'
    };

    if (!window.jsmediatags) {
      console.warn("jsmediatags library not loaded, using filename defaults.");
      callback(defaultMeta);
      return;
    }

    window.jsmediatags.read(file, {
      onSuccess: function(tag) {
        const tags = tag.tags;
        let coverUrl = null;
        
        if (tags.picture) {
          try {
            const { data, format } = tags.picture;
            let base64String = "";
            for (let i = 0; i < data.length; i++) {
              base64String += String.fromCharCode(data[i]);
            }
            coverUrl = `data:${format};base64,${window.btoa(base64String)}`;
          } catch (picErr) {
            console.warn("Failed to extract embedded cover art:", picErr);
          }
        }

        callback({
          title: tags.title || defaultMeta.title,
          artist: tags.artist || defaultMeta.artist,
          url: defaultMeta.url,
          pic: coverUrl || 'default.svg'
        });
      },
      onError: function(error) {
        console.warn("jsmediatags reading error:", error);
        callback(defaultMeta);
      }
    });
  }

  // Load local track metadata on demand when played
  function loadLocalTrackTags(track, index) {
    if (!window.jsmediatags) return;
    
    window.jsmediatags.read(track.file, {
      onSuccess: function(tag) {
        const tags = tag.tags;
        let coverUrl = null;
        
        if (tags.picture) {
          try {
            const { data, format } = tags.picture;
            let base64String = "";
            for (let i = 0; i < data.length; i++) {
              base64String += String.fromCharCode(data[i]);
            }
            coverUrl = `data:${format};base64,${window.btoa(base64String)}`;
          } catch (e) {
            console.warn("Failed parsing picture inside loadLocalTrackTags", e);
          }
        }

        track.name = tags.title || track.name;
        track.artist = tags.artist || track.artist;
        if (coverUrl) {
          track.pic = coverUrl;
        }
        track.tagsLoaded = true;

        if (currentPlaylist[currentTrackIndex] === track) {
          trackNameEl.textContent = track.name;
          trackArtistEl.textContent = track.artist;
          albumCoverImg.style.backgroundImage = `url('${track.pic}')`;
          const fsTrackNameEl = document.getElementById('fs-track-name');
          const fsTrackArtistEl = document.getElementById('fs-track-artist');
          const fsAlbumCoverImg = document.getElementById('fs-cover-art');
          if (fsTrackNameEl) fsTrackNameEl.textContent = track.name;
          if (fsTrackArtistEl) fsTrackArtistEl.textContent = track.artist;
          if (fsAlbumCoverImg) fsAlbumCoverImg.style.backgroundImage = `url('${track.pic}')`;
          if (fsCoverGlow) fsCoverGlow.style.backgroundImage = `url('${track.pic}')`;
          updateFluidColors(track.pic);
          syncPlaylistDrawerActive();
        }
        
        renderPlaylistSongs();
      },
      onError: function(err) {
        console.warn("Failed to read tags inside loadLocalTrackTags", err);
        track.tagsLoaded = true;
      }
    });
  }

  // Read local lyric file text on demand when played
  function readLocalLrcFile(file) {
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target.result;
      const parsed = parseLyrics(text);
      
      currentLyrics = parsed;
      currentLyricIndex = -1;

      if (currentLyrics.length === 0) {
        lyricsWrapper.classList.add('has-placeholder');
        lyricsWrapper.innerHTML = `
          <div class="no-lyrics-placeholder">
            <svg class="no-lyrics-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 18V5l12-2v13"></path>
              <circle cx="6" cy="18" r="3"></circle>
              <circle cx="18" cy="16" r="3"></circle>
            </svg>
            <p class="no-lyrics-text">无歌词</p>
          </div>
        `;
        lyricsStatus.textContent = '解析失败';
      } else {
        renderLyrics();
        lyricsStatus.textContent = '本地歌词';
        lyricsStatus.style.borderColor = 'rgba(var(--color-accent-rgb), 0.3)';
        lyricsStatus.style.color = 'var(--color-accent)';
        lyricsStatus.style.background = 'var(--color-accent-bg)';
        updateLyricsLayout(0, false);
      }
    };
    reader.readAsText(file, 'utf-8');
  }

  // Keyboard controls
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return; 

    if (e.code === 'Space') {
      e.preventDefault();
      togglePlay();
    } else if (e.code === 'ArrowRight') {
      audio.currentTime = Math.min(audio.duration, audio.currentTime + 5);
    } else if (e.code === 'ArrowLeft') {
      audio.currentTime = Math.max(0, audio.currentTime - 5);
    }
  });

  // Click outside to close drawer
  document.addEventListener('click', (e) => {
    if (playlistDrawer.classList.contains('open') && 
        !playlistDrawer.contains(e.target) && 
        e.target !== playlistToggleBtn && 
        !playlistToggleBtn.contains(e.target) &&
        !importModal.contains(e.target)) {
      playlistDrawer.classList.remove('open');
    }
  });

  // 9. Lyrics Scroll Wheel Event Listener
  if (lyricsScroller) {
    lyricsScroller.addEventListener('wheel', (e) => {
      if (currentLyrics.length === 0) return;
      e.preventDefault();
      
      isUserScrolling = true;
      userScrollOffset += e.deltaY * 0.85; // Adjust scrolling speed/feel
      
      const items = lyricsWrapper.querySelectorAll('.item');
      if (items.length > 0) {
        const activeIdx = currentLyricIndex < 0 ? 0 : currentLyricIndex;
        
        // Compute static positions dynamically to calculate bounds
        const positions = [];
        let currentY = 0;
        const gap = 24;
        for (let i = 0; i < items.length; i++) {
          positions[i] = currentY;
          currentY += (items[i].offsetHeight || 36) + gap;
        }
        
        const containerHeight = lyricsScroller.clientHeight || window.innerHeight / 2.5;
        const activeHeight = items[activeIdx].offsetHeight || 36;
        const targetTranslation = containerHeight / 2 - (positions[activeIdx] + activeHeight / 2);
        const totalHeight = positions[positions.length - 1] + (items[items.length - 1].offsetHeight || 36);
        
        // Limits bounds
        const minTranslation = containerHeight / 2 - totalHeight - 120;
        const maxTranslation = containerHeight / 2 + 120;
        
        const currentTranslation = targetTranslation - userScrollOffset;
        const constrainedTranslation = Math.max(minTranslation, Math.min(maxTranslation, currentTranslation));
        
        userScrollOffset = targetTranslation - constrainedTranslation;
        
        lyricsWrapper.style.transition = 'none';
        lyricsWrapper.style.transform = `translateY(${constrainedTranslation}px)`;
      } else {
        userScrollOffset = Math.max(-1200, Math.min(1200, userScrollOffset));
        lyricsWrapper.style.transition = 'none';
        lyricsWrapper.style.transform = `translateY(${-userScrollOffset}px)`;
      }
      
      if (userScrollTimeout) clearTimeout(userScrollTimeout);
      userScrollTimeout = setTimeout(() => {
        snapBackLyrics();
      }, 4000);
    }, { passive: false });
  }

  function snapBackLyrics() {
    isUserScrolling = false;
    lyricsWrapper.style.transition = 'transform 0.8s cubic-bezier(0.15, 0.85, 0.2, 1)';
    
    // Recalculate and reset to target centered position
    const items = lyricsWrapper.querySelectorAll('.item');
    const activeIdx = currentLyricIndex < 0 ? 0 : currentLyricIndex;
    if (items.length > 0 && items[activeIdx]) {
      const positions = [];
      let currentY = 0;
      const gap = 24;
      for (let i = 0; i < items.length; i++) {
        positions[i] = currentY;
        currentY += (items[i].offsetHeight || 36) + gap;
      }
      const containerHeight = lyricsScroller.clientHeight || window.innerHeight / 2.5;
      const activeHeight = items[activeIdx].offsetHeight || 36;
      const targetTranslation = containerHeight / 2 - (positions[activeIdx] + activeHeight / 2);
      lyricsWrapper.style.transform = `translateY(${targetTranslation}px)`;
    } else {
      lyricsWrapper.style.transform = 'translateY(0px)';
    }
    userScrollOffset = 0;
  }

  // ==========================================
  // 8. Bootstrap App
  // ==========================================
  
  initPreferences();
});
