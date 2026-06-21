/* ==========================================
   Aura Music - Core Application Logic
   ========================================== */

function initApp() {
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
    (id, name = '', artist = '') => getApiUrl(`/api/url?platform=netease&id=${id}&name=${encodeURIComponent(name)}&artist=${encodeURIComponent(artist)}`),
    (id) => `https://v.iarc.top/?server=netease&type=url&id=${id}`,
    (id) => `https://api.injahow.cn/meting/?type=url&id=${id}`,
    (id) => `https://music.163.com/song/media/outer/url?id=${id}.mp3`
  ];
  let currentPlaylistId = localStorage.getItem('aura-current-playlist-id') || '8529369110'; // Default lofi favorites
  
  // Web Audio & Equalizer & Visualizer State
  let audioCtx = null;
  let audioSource = null;
  let analyserNode = null;
  let eqFilters = [];
  let currentCoverColors = ['#fa243c', '#5e5e5e', '#1c1c1e']; // Store dominant colors for visualizer
  let audioBeatFactor = 1.0; // Audio volume beat factor for fluid canvas
  let isEqEnabled = localStorage.getItem('aura-eq-enabled') === 'true';
  let eqPreset = localStorage.getItem('aura-eq-preset') || 'flat';
  let eqGains = [0, 0, 0, 0, 0];
  try {
    const parsedGains = JSON.parse(localStorage.getItem('aura-eq-gains'));
    if (Array.isArray(parsedGains) && parsedGains.length === 5) eqGains = parsedGains;
  } catch (e) {
    console.warn("Failed to parse eqGains:", e);
  }
  let fadeInterval = null; // For volume crossfading
  
  const EQ_PRESETS = {
    flat: [0, 0, 0, 0, 0],
    bass: [6, 4, 0, -2, -4],        // Boost bass, cut treble
    treble: [-4, -2, 0, 4, 6],      // Cut bass, boost treble
    vocal: [-3, -1, 4, 2, -2],       // Boost mids where human vocals live
    classical: [4, 2, 0, 2, 4],     // Boost low and high slightly
    pop: [-2, 2, 4, 1, -2],          // Boost mid-bass and mids
    rock: [5, 3, -1, 2, 4],          // Classic V shape
    jazz: [3, 2, 1, 3, 2]            // Mellow highs, warm bass
  };
  
  let fsVisualizerCanvas = null;
  let isVisualizerDrawing = false;
  let isFluidBgEnabled = localStorage.getItem('aura-fluid-bg-enabled') !== 'false';
  let isVisualizerEnabled = localStorage.getItem('aura-visualizer-enabled') !== 'false';
  let searchPriority = localStorage.getItem('aura-search-priority') || 'tencent-first';
  
  // Helper to construct absolute API URLs when running on other origins (like file:///)
  function getApiUrl(apiPath) {
    if (window.location.protocol === 'file:') {
      return 'http://localhost:3000' + apiPath;
    }
    return apiPath;
  }

  // Helper to upgrade NetEase cover images to high resolution (500x500) and proxy to bypass referrer blocks (403)
  function getHdCoverUrl(url) {
    if (!url) return 'assets/default.svg';
    
    // 如果已经是代理路径或者是本地SVG或blob资源，则直接返回
    if (url.startsWith('assets/default.svg') || url.includes('/api/proxy-img') || url.startsWith('blob:')) {
      return url;
    }
    
    let targetUrl = url;
    // 统一将 http:// 升级为 https:// 防止混合内容阻挡
    if (targetUrl.startsWith('http://')) {
      targetUrl = targetUrl.replace('http://', 'https://');
    }

    // 网易云图床不防盗链，直接返回其官方 CDN 链接，不仅加载速度极快，还能避免本地 Node 代理高并发堵塞
    if (targetUrl.includes('music.126.net') || targetUrl.includes('126.net') || targetUrl.includes('music.163.com')) {
      const cleanUrl = targetUrl.split('?')[0];
      return cleanUrl + '?param=300y300';
    }

    // 本地开发地址不代理
    if (targetUrl.includes('localhost') || targetUrl.includes('127.0.0.1')) {
      return targetUrl;
    }

    // 只有 QQ 音乐、酷我等其他第三方防盗链图片才需要强制走本地 Node 代理抓取
    if (targetUrl.startsWith('http://') || targetUrl.startsWith('https://')) {
      return getApiUrl(`/api/proxy-img?url=${encodeURIComponent(targetUrl)}`);
    }
    return targetUrl;
  }

  // Robust track comparison helper to avoid duplicate entries in queue or list due to type mismatches
  function isSameTrack(tA, tB) {
    if (!tA || !tB) return false;
    if (tA.platform === 'radio' || tB.platform === 'radio') {
      return tA.url === tB.url;
    }
    if (tA.file || tB.file) {
      return tA.name === tB.name && tA.artist === tB.artist;
    }
    const idA = tA.id !== undefined && tA.id !== null ? String(tA.id) : '';
    const idB = tB.id !== undefined && tB.id !== null ? String(tB.id) : '';
    const platA = tA.platform || 'netease';
    const platB = tB.platform || 'netease';
    if (idA && idB) {
      return idA === idB && platA === platB;
    }
    return tA.url === tB.url;
  }
  
  // Saved NetEase playlists
  let savedPlaylists = [{ id: '8529369110', name: '我的网易云收藏歌单' }];
  try {
    const parsedSaved = JSON.parse(localStorage.getItem('aura-saved-playlists'));
    if (Array.isArray(parsedSaved)) savedPlaylists = parsedSaved;
  } catch (e) {
    console.warn("Failed to parse saved playlists:", e);
  }

  // User self-created playlists
  let localPlaylists = [];
  try {
    const parsedLocal = JSON.parse(localStorage.getItem('aura-local-playlists'));
    if (Array.isArray(parsedLocal)) localPlaylists = parsedLocal;
  } catch (e) {
    console.warn("Failed to parse local playlists:", e);
  }
  let trackToAdd = null; // Temporary storage for adding track to playlist
  
  // 浏览器本地已播放/临时歌单缓存
  let temporaryPlaylist = [];
  try {
    const parsedTemp = JSON.parse(localStorage.getItem('aura-temporary-playlist'));
    if (Array.isArray(parsedTemp)) temporaryPlaylist = parsedTemp;
  } catch (e) {
    console.warn("Failed to parse temporary playlist:", e);
  }

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

  // Equalizer & Visualizer DOM Elements
  const playerEqToggle = document.getElementById('player-eq-toggle');
  const eqModal = document.getElementById('eq-modal');
  const eqCloseBtn = document.getElementById('eq-close-btn');
  const eqEnableCheckbox = document.getElementById('eq-enable-checkbox');
  const eqPresetSelect = document.getElementById('eq-preset-select');
  const eqSliders = [
    document.getElementById('eq-band-0'),
    document.getElementById('eq-band-1'),
    document.getElementById('eq-band-2'),
    document.getElementById('eq-band-3'),
    document.getElementById('eq-band-4')
  ];
  const eqDbLabels = [
    document.getElementById('eq-db-0'),
    document.getElementById('eq-db-1'),
    document.getElementById('eq-db-2'),
    document.getElementById('eq-db-3'),
    document.getElementById('eq-db-4')
  ];
  
  fsVisualizerCanvas = document.getElementById('fs-audio-visualizer');
  const fsOptionsMenu = document.getElementById('fs-options-menu');
  const fsPlayerThemeBtn = document.getElementById('fs-player-theme-btn');

  // Settings DOM Elements
  const settingsToggleBtn = document.getElementById('settings-toggle-btn');
  const settingsModal = document.getElementById('settings-modal');
  const settingsCloseBtn = document.getElementById('settings-close-btn');
  const settingsDarkModeCheckbox = document.getElementById('settings-dark-mode-checkbox');
  const settingsEqCheckbox = document.getElementById('settings-eq-checkbox');
  const settingsEqPresetSelect = document.getElementById('settings-eq-preset-select');
  const settingsOpenEqBtn = document.getElementById('settings-open-eq-btn');
  const settingsFluidBgCheckbox = document.getElementById('settings-fluid-bg-checkbox');
  const settingsVisualizerCheckbox = document.getElementById('settings-visualizer-checkbox');
  const settingsFsThemeSelect = document.getElementById('settings-fs-theme-select');
  const settingsSearchPrioritySelect = document.getElementById('settings-search-priority-select');


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

  // Helper to sync custom dropdown with native select state (value & disabled status)
  function syncCustomDropdown(selectEl) {
    if (!selectEl) return;
    const wrapper = selectEl.nextSibling;
    if (!wrapper || !wrapper.classList || !wrapper.classList.contains('custom-select-container')) return;
    
    const trigger = wrapper.querySelector('.custom-select-trigger');
    const label = trigger ? trigger.querySelector('.custom-select-label') : null;
    const optionsContainer = wrapper.querySelector('.custom-select-options');
    if (!trigger || !label || !optionsContainer) return;
    
    const val = selectEl.value;
    let matched = false;
    optionsContainer.querySelectorAll('.custom-select-option').forEach(opt => {
      if (opt.getAttribute('data-value') === String(val)) {
        opt.classList.add('selected');
        label.innerText = opt.innerText;
        matched = true;
      } else {
        opt.classList.remove('selected');
      }
    });
    if (!matched && selectEl.options && selectEl.options[selectEl.selectedIndex]) {
      label.innerText = selectEl.options[selectEl.selectedIndex].text;
    }
    
    // Sync disabled state
    trigger.disabled = selectEl.disabled;
    if (selectEl.disabled) {
      wrapper.classList.add('disabled');
    } else {
      wrapper.classList.remove('disabled');
    }
  }

  // Helper to convert native select to web-native styled custom dropdown
  function setupCustomDropdown(selectEl) {
    if (!selectEl) return;
    
    // Check if custom dropdown is already created to avoid duplication
    if (selectEl.nextSibling && selectEl.nextSibling.classList && selectEl.nextSibling.classList.contains('custom-select-container')) {
      return;
    }
    
    // Hide native select
    selectEl.style.display = 'none';
    
    // Create custom elements wrapper
    const wrapper = document.createElement('div');
    wrapper.className = 'custom-select-container';
    if (selectEl.className) {
      selectEl.className.split(' ').forEach(cls => {
        wrapper.classList.add(cls + '-custom-wrapper');
      });
    }
    
    // Create trigger
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'custom-select-trigger';
    trigger.disabled = selectEl.disabled;
    
    const label = document.createElement('span');
    label.className = 'custom-select-label';
    
    const arrow = document.createElement('span');
    arrow.className = 'custom-select-arrow';
    arrow.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
    
    trigger.appendChild(label);
    trigger.appendChild(arrow);
    
    // Create options list
    const optionsContainer = document.createElement('div');
    optionsContainer.className = 'custom-select-options';
    
    wrapper.appendChild(trigger);
    wrapper.appendChild(optionsContainer);
    
    // Insert wrapper in DOM next to native select
    selectEl.parentNode.insertBefore(wrapper, selectEl.nextSibling);
    
    function rebuildOptions() {
      optionsContainer.innerHTML = '';
      const options = Array.from(selectEl.options || []);
      
      let selectedText = '';
      
      options.forEach(opt => {
        const item = document.createElement('div');
        item.className = 'custom-select-option';
        item.innerText = opt.text;
        item.setAttribute('data-value', opt.value);
        
        if (opt.value === selectEl.value) {
          item.classList.add('selected');
          selectedText = opt.text;
        }
        
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          if (selectEl.disabled) return;
          
          optionsContainer.querySelectorAll('.custom-select-option').forEach(c => {
            c.classList.remove('selected');
          });
          item.classList.add('selected');
          
          label.innerText = opt.text;
          
          const changed = selectEl.value !== opt.value;
          if (changed) {
            selectEl.value = opt.value;
            selectEl.dispatchEvent(new Event('change', { bubbles: true }));
          }
          
          wrapper.classList.remove('open');
        });
        
        optionsContainer.appendChild(item);
      });
      
      label.innerText = selectedText || (options[0] ? options[0].text : '');
    }
    
    rebuildOptions();
    
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      if (selectEl.disabled) return;
      
      document.querySelectorAll('.custom-select-container').forEach(c => {
        if (c !== wrapper) c.classList.remove('open');
      });
      
      wrapper.classList.toggle('open');
    });
    
    document.addEventListener('click', () => {
      wrapper.classList.remove('open');
    });
    
    // Watch for dynamic changes in select options
    const observer = new MutationObserver(() => {
      rebuildOptions();
    });
    observer.observe(selectEl, { childList: true, subtree: true, characterData: true });
    
    // Listen for native select change event to keep custom select synced
    selectEl.addEventListener('change', () => {
      syncCustomDropdown(selectEl);
    });
  }

  // Initialize custom dropdowns
  setupCustomDropdown(playlistSelect);
  setupCustomDropdown(eqPresetSelect);
  setupCustomDropdown(settingsEqPresetSelect);
  setupCustomDropdown(settingsFsThemeSelect);
  setupCustomDropdown(settingsSearchPrioritySelect);

  // Home Folder card click listener
  const homeImportFolderCard = document.getElementById('home-import-folder-card');
  if (homeImportFolderCard) {
    homeImportFolderCard.addEventListener('click', () => {
      localFolderFile.click();
    });
  }

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

    // Inject play overlays into all static music card covers (recommended playlists/charts/songs)
    document.querySelectorAll('.music-card .card-cover').forEach(cover => {
      if (!cover.querySelector('.card-play-overlay')) {
        const overlay = document.createElement('div');
        overlay.className = 'card-play-overlay';
        overlay.innerHTML = `
          <svg viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5 3 19 12 5 21 5 3"></polygon>
          </svg>
        `;
        cover.appendChild(overlay);
      }
    });

    // Bind click event listeners to dynamic music recommendation cards
    const recommendationCards = document.querySelectorAll('.music-card[data-playlist-id], .music-card[data-song-id]');
    recommendationCards.forEach(card => {
      card.addEventListener('click', () => {
        const playlistId = card.getAttribute('data-playlist-id');
        const songId = card.getAttribute('data-song-id');
        if (playlistId) {
          const playlistName = card.querySelector('.card-title').textContent;
          showToast(`正在载入歌单: ${playlistName}...`);
          window.lastClickedPlaylistName = playlistName;
          fetchOnlinePlaylist(playlistId);
        } else if (songId) {
          const songName = card.querySelector('.card-title').textContent;
          const songArtist = card.querySelector('.card-subtitle').textContent;
          const songPic = card.getAttribute('data-song-pic');
          playSongById(songId, songName, songArtist, songPic);
        }
      });
    });

    // Bind click event listeners to live radio stations
    const radioCards = document.querySelectorAll('.music-card[data-radio-url], .featured-banner-item[data-radio-url]');
    radioCards.forEach(card => {
      card.addEventListener('click', () => {
        const radioUrl = card.getAttribute('data-radio-url');
        const radioName = card.getAttribute('data-radio-name') || card.querySelector('.card-title')?.textContent || card.querySelector('.banner-title')?.textContent || '网络广播';
        const radioArtist = card.getAttribute('data-radio-artist') || card.querySelector('.card-subtitle')?.textContent || card.querySelector('.banner-subtitle')?.textContent || '直播中';
        const radioPic = card.getAttribute('data-radio-pic') || 'assets/default.svg';
        
        const radioTrack = {
          id: 'radio_' + Date.now(),
          name: radioName,
          artist: radioArtist,
          url: radioUrl,
          pic: radioPic,
          platform: 'radio'
        };

        playRadioTrack(radioTrack);
      });
    });

    // Bind click event listeners to featured banners
    const featuredBanners = document.querySelectorAll('.featured-banner-item[data-playlist-id]');
    featuredBanners.forEach(banner => {
      banner.addEventListener('click', () => {
        const playlistId = banner.getAttribute('data-playlist-id');
        if (playlistId) {
          const bannerTitle = banner.querySelector('.banner-title').textContent;
          showToast(`正在载入歌单: ${bannerTitle}...`);
          window.lastClickedPlaylistName = bannerTitle;
          fetchOnlinePlaylist(playlistId);
        }
      });
    });

    // Bind click event listeners to new songs
    const newSongItems = document.querySelectorAll('.new-song-item[data-song-id]');
    newSongItems.forEach(item => {
      item.addEventListener('click', () => {
        const songId = item.getAttribute('data-song-id');
        const songName = item.getAttribute('data-song-name');
        const songArtist = item.getAttribute('data-song-artist');
        const songPic = item.getAttribute('data-song-pic');
        if (songId) {
          playSongById(songId, songName, songArtist, songPic);
        }
      });
    });

    // Countdown dots are controlled by playback time updates and do not require click handlers

    const navItems = document.querySelectorAll('.sidebar .nav-item[data-tab], .sidebar .sidebar-search-bar[data-tab], #settings-toggle-btn[data-tab]');
    const pageViews = document.querySelectorAll('.page-view');
    navItems.forEach(item => {
      item.addEventListener('click', () => {
        const tabName = item.getAttribute('data-tab');
        document.querySelectorAll('.sidebar .nav-item, .sidebar .sidebar-search-bar, #settings-toggle-btn').forEach(nav => nav.classList.remove('active'));
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
        } else if (tabName === 'settings') {
          // Sync settings state
          const theme = document.documentElement.getAttribute('data-theme') || 'apple-dark';
          settingsDarkModeCheckbox.checked = theme === 'apple-dark';
          settingsEqCheckbox.checked = isEqEnabled;
          settingsEqPresetSelect.value = eqPreset;
          settingsEqPresetSelect.disabled = !isEqEnabled;
          syncCustomDropdown(settingsEqPresetSelect);
          if (settingsFsThemeSelect) {
            settingsFsThemeSelect.value = localStorage.getItem('aura-fs-player-theme') || 'vertical';
            syncCustomDropdown(settingsFsThemeSelect);
          }
          if (settingsSearchPrioritySelect) {
            settingsSearchPrioritySelect.value = searchPriority;
            syncCustomDropdown(settingsSearchPrioritySelect);
          }
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

    const sidebarImportFileBtn = document.getElementById('sidebar-import-file-btn');
    if (sidebarImportFileBtn) {
      sidebarImportFileBtn.addEventListener('click', () => {
        localAudioFile.click();
      });
    }

    // Bind sidebar create local playlist button
    const sidebarCreatePlaylistBtn = document.getElementById('sidebar-create-playlist-btn');
    if (sidebarCreatePlaylistBtn) {
      sidebarCreatePlaylistBtn.addEventListener('click', () => {
        showCreatePlaylistModal();
      });
    }

    const sidebarImportFolderBtn = document.getElementById('sidebar-import-folder-btn');
    if (sidebarImportFolderBtn) {
      sidebarImportFolderBtn.addEventListener('click', () => {
        localFolderFile.click();
      });
    }

    // Bind sidebar create local playlist button
    if (sidebarCreatePlaylistBtn) {
      sidebarCreatePlaylistBtn.addEventListener('click', () => {
        showCreatePlaylistModal();
      });
    }

    // Bind modal create local playlist button inside Add-to-Playlist modal
    const modalCreatePlaylistBtn = document.getElementById('modal-create-playlist-btn');
    if (modalCreatePlaylistBtn) {
      modalCreatePlaylistBtn.addEventListener('click', () => {
        showCreatePlaylistModal(() => {
          renderModalPlaylists();
        });
      });
    }

    // Bind Add-to-Playlist modal close events
    const addToPlaylistModal = document.getElementById('add-to-playlist-modal');
    const addPlaylistCloseBtn = document.getElementById('add-playlist-close-btn');
    if (addPlaylistCloseBtn) {
      addPlaylistCloseBtn.addEventListener('click', closeAddToPlaylistModal);
    }
    if (addToPlaylistModal) {
      addToPlaylistModal.addEventListener('click', (e) => {
        if (e.target === addToPlaylistModal) {
          closeAddToPlaylistModal();
        }
      });
    }

    // Restore fullscreen player theme
    const savedFsTheme = localStorage.getItem('aura-fs-player-theme') || 'vertical';
    applyFsPlayerTheme(savedFsTheme);

    // Bind fullscreen player theme switcher button
    if (fsPlayerThemeBtn) {
      fsPlayerThemeBtn.addEventListener('click', () => {
        const currentTheme = localStorage.getItem('aura-fs-player-theme') || 'vertical';
        const nextTheme = currentTheme === 'vertical' ? 'horizontal-bar' : 'vertical';
        localStorage.setItem('aura-fs-player-theme', nextTheme);
        applyFsPlayerTheme(nextTheme);
        if (settingsFsThemeSelect) {
          settingsFsThemeSelect.value = nextTheme;
          syncCustomDropdown(settingsFsThemeSelect);
        }
        showToast(`播放界面主题已切换为 ${nextTheme === 'vertical' ? '极简原生' : '底栏控制条'} 模式`);
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
    const fsBarLyricsBtn = document.getElementById('fs-bar-lyrics-btn');
    const fsBarQueueBtn = document.getElementById('fs-bar-queue-btn');
    
    if (isLyrics) {
      if (fsLyricsToggle) fsLyricsToggle.classList.add('active');
      if (playerLyricsToggle) playerLyricsToggle.classList.add('active');
      if (fsBarLyricsBtn) fsBarLyricsBtn.classList.add('active');
      if (fsLyricsPanel) fsLyricsPanel.classList.remove('hidden');
    } else {
      if (fsLyricsToggle) fsLyricsToggle.classList.remove('active');
      if (playerLyricsToggle) playerLyricsToggle.classList.remove('active');
      if (fsBarLyricsBtn) fsBarLyricsBtn.classList.remove('active');
      if (fsLyricsPanel) fsLyricsPanel.classList.add('hidden');
    }
    
    if (isQueue) {
      if (fsQueueToggle) fsQueueToggle.classList.add('active');
      if (playlistToggleBtn) playlistToggleBtn.classList.add('active');
      if (fsBarQueueBtn) fsBarQueueBtn.classList.add('active');
      if (fsQueuePanel) fsQueuePanel.classList.remove('hidden');
    } else {
      if (fsQueueToggle) fsQueueToggle.classList.remove('active');
      if (playlistToggleBtn) playlistToggleBtn.classList.remove('active');
      if (fsBarQueueBtn) fsBarQueueBtn.classList.remove('active');
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
      item.setAttribute('data-index', index);
      
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
      const fsBarLoopBtn = document.getElementById('fs-bar-loop-btn');
      if (loopMode === 'shuffle') {
        fsShuffleBtn.classList.add('active');
        fsLoopBtn.classList.remove('active');
        if (fsBarLoopBtn) {
          fsBarLoopBtn.classList.add('active');
          fsBarLoopBtn.title = '当前模式：随机播放';
          fsBarLoopBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="16 3 21 3 21 8" />
              <line x1="4" y1="20" x2="21" y2="3" />
              <polyline points="21 16 21 21 16 21" />
              <line x1="15" y1="15" x2="21" y2="21" />
              <line x1="4" y1="4" x2="9" y2="9" />
            </svg>
          `;
        }
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
        if (fsBarLoopBtn) {
          fsBarLoopBtn.classList.add('active');
          fsBarLoopBtn.title = '当前模式：单曲循环';
          fsBarLoopBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M17 2.1l4 4-4 4" />
              <path d="M3 10.2V8a4 4 0 0 1 4-4h14" />
              <path d="M7 21.9l-4-4 4-4" />
              <path d="M21 13.8v2a4 4 0 0 1-4 4H3" />
              <text x="10" y="15" font-size="8" font-weight="900" fill="currentColor">1</text>
            </svg>
          `;
        }
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
        if (fsBarLoopBtn) {
          fsBarLoopBtn.classList.remove('active');
          fsBarLoopBtn.title = '当前模式：列表循环';
          fsBarLoopBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M17 2.1l4 4-4 4" />
              <path d="M3 12.2v-2a4 4 0 0 1 4-4h14" />
              <path d="M7 21.9l-4-4 4-4" />
              <path d="M21 11.8v2a4 4 0 0 1-4 4H3" />
            </svg>
          `;
        }
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
        
        // Avoid shifting hue to prevent mismatched "neon" colors (e.g. red turning to green).
        // Instead, we vary the saturation and lightness for a harmonious mono/analogous palette.
        if (hsl[1] > 20) {
          newS = Math.max(15, Math.min(95, hsl[1] + (i * 4 - 8)));
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

    if (!coverUrl || coverUrl === 'assets/default.svg' || coverUrl.includes('assets/default.svg')) {
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
    if (colors) {
      currentCoverColors = colors;
    } else {
      colors = currentCoverColors || getFallbackColors(null);
    }
    
    if (canvasAnimationId) {
      cancelAnimationFrame(canvasAnimationId);
      canvasAnimationId = null;
    }
    
    bgCanvas.width = 120;
    bgCanvas.height = 120;
    
    const fCtx = bgCanvas.getContext('2d');
    
    if (!isFluidBgEnabled) {
      fCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
      const theme = document.documentElement.getAttribute('data-theme') || 'apple-dark';
      fCtx.fillStyle = theme === 'apple-light' ? 'rgba(245, 245, 247, 1)' : 'rgba(12, 13, 20, 1)';
      fCtx.fillRect(0, 0, bgCanvas.width, bgCanvas.height);
      
      const grad = fCtx.createLinearGradient(0, 0, bgCanvas.width, bgCanvas.height);
      if (colors && colors.length > 0) {
        colors.forEach((color, idx) => {
          grad.addColorStop(idx / (colors.length - 1), color);
        });
      }
      fCtx.globalAlpha = 0.4;
      fCtx.fillStyle = grad;
      fCtx.fillRect(0, 0, bgCanvas.width, bgCanvas.height);
      fCtx.globalAlpha = 1.0;
      return;
    }
    
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
    const targetPlaylistId = currentPlaylistId || '8529369110';

    if (targetPlaylistId === 'temporary') {
      currentPlaylist = temporaryPlaylist;
      updatePlaylistSelect();
      bootstrapPlayer();
      return;
    }

    const cachedPlaylist = localStorage.getItem('aura-custom-playlist');
    if (cachedPlaylist) {
      try {
        const parsed = JSON.parse(cachedPlaylist);
        if (Array.isArray(parsed) && parsed.length > 0) {
          currentPlaylist = parsed;
          console.log(`Loaded ${currentPlaylist.length} tracks from local cache for instant start.`);
          updatePlaylistSelect();
          bootstrapPlayer();
          
          const playlistInfo = savedPlaylists.find(p => p.id === targetPlaylistId);
          const plat = playlistInfo ? (playlistInfo.platform || 'netease') : 'netease';
          fetchOnlinePlaylist(targetPlaylistId, true, false, plat);
          return;
        }
      } catch (e) {
        console.warn("Failed to parse cached playlist on startup:", e);
      }
    }
      
    const playlistInfo = savedPlaylists.find(p => p.id === targetPlaylistId);
    const plat = playlistInfo ? (playlistInfo.platform || 'netease') : 'netease';
    fetchOnlinePlaylist(targetPlaylistId, false, false, plat);
  }

  async function fetchOnlinePlaylist(playlistId, isSilentBackground = false, saveToSidebar = false, platform = 'netease') {
    try {
      console.log(`Fetching online ${platform} playlist ${playlistId}...`);
      let data = null;

      // Try local proxy first
      try {
        const response = await fetch(getApiUrl(`/api/playlist?id=${playlistId}&platform=${platform}`));
        if (response.ok) {
          data = await response.json();
        }
      } catch (err) {
        console.warn("Local proxy playlist fetch failed, trying public API fallback...", err);
      }

      // Fallback to direct Meting API
      if (!data) {
        console.log(`Fetching ${platform} playlist ${playlistId} directly from Meting API fallback...`);
        const response = await fetch(`https://v.iarc.top/?server=${platform}&type=playlist&id=${playlistId}`);
        if (!response.ok) throw new Error(`Meting API fallback failed: ${response.status}`);
        data = await response.json();
      }

      if (Array.isArray(data) && data.length > 0) {
        const currentPlayingTrack = currentPlaylist[currentTrackIndex];

        currentPlaylist = data.map(item => {
          let songId = null;
          const match = item.url ? item.url.match(/id=([a-zA-Z0-9_\-]+)/) : null;
          if (match) {
            const rawId = match[1];
            songId = /^\d+$/.test(rawId) ? parseInt(rawId, 10) : rawId;
          }
          const finalId = songId || item.id;
          return {
            id: finalId,
            name: item.name,
            artist: item.artist,
            url: getApiUrl(`/api/url?platform=${platform}&id=${finalId}&name=${encodeURIComponent(item.name)}&artist=${encodeURIComponent(item.artist)}`),
            pic: item.pic || 'assets/default.svg',
            lrc: item.lrc,
            platform: platform
          };
        });

        // Sync currently playing track index in the newly fetched list
        if (currentPlayingTrack) {
          const newIndex = currentPlaylist.findIndex(t => isSameTrack(t, currentPlayingTrack));
          if (newIndex !== -1) {
            currentTrackIndex = newIndex;
            console.log(`Synchronized currently playing track to index ${newIndex} after background update.`);
          }
        }
        
        // Add to saved playlists if not present
        const playlistName = window.lastClickedPlaylistName || `网易云歌单 (${playlistId})`;
        const existingIdx = savedPlaylists.findIndex(p => p.id === playlistId);
        if (playlistId !== 'temporary') {
          if (existingIdx === -1) {
            if (saveToSidebar) {
              savedPlaylists.push({
                id: playlistId,
                name: playlistName,
                cover: (data[0] && data[0].pic) || 'assets/default.svg'
              });
              localStorage.setItem('aura-saved-playlists', JSON.stringify(savedPlaylists));
            }
          } else {
            let updated = false;
            if (!savedPlaylists[existingIdx].cover || savedPlaylists[existingIdx].cover === 'assets/default.svg') {
              savedPlaylists[existingIdx].cover = (data[0] && data[0].pic) || 'assets/default.svg';
              updated = true;
            }
            if (window.lastClickedPlaylistName && savedPlaylists[existingIdx].name !== window.lastClickedPlaylistName) {
              savedPlaylists[existingIdx].name = window.lastClickedPlaylistName;
              updated = true;
            }
            if (updated) {
              localStorage.setItem('aura-saved-playlists', JSON.stringify(savedPlaylists));
            }
          }
        }
        window.lastClickedPlaylistName = null;

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
          pic: 'assets/default.svg',
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
      
      if (window.autoPlayOnNextLoad) {
        window.autoPlayOnNextLoad = false;
        setTimeout(() => {
          playAudio();
        }, 100);
      }
    } else {
      document.body.classList.add('no-files');
      trackNameEl.textContent = "点击导入歌单";
      trackArtistEl.textContent = "无可用音频";
      const fsTrackNameEl = document.getElementById('fs-track-name');
      const fsTrackArtistEl = document.getElementById('fs-track-artist');
      if (fsTrackNameEl) fsTrackNameEl.textContent = "点击导入歌单";
      if (fsTrackArtistEl) fsTrackArtistEl.textContent = "无可用音频";
      
      const fsBarTitleEl = document.getElementById('fs-bar-title');
      const fsBarArtistEl = document.getElementById('fs-bar-artist');
      const fsBarCoverEl = document.getElementById('fs-bar-cover');
      if (fsBarTitleEl) fsBarTitleEl.textContent = "点击导入歌单";
      if (fsBarArtistEl) fsBarArtistEl.textContent = "无可用音频";
      if (fsBarCoverEl) fsBarCoverEl.style.backgroundImage = "url('./assets/default.svg')";
      clearLyrics();
    }
  }

  // ==========================================
  // Media Session & SMTC Integration
  // ==========================================

  function updateMediaSessionMetadata(track) {
    if (!('mediaSession' in navigator) || !track) return;
    
    const coverUrl = getHdCoverUrl(track.pic || 'assets/default.svg');
    let absoluteCoverUrl = coverUrl;
    if (coverUrl && !coverUrl.startsWith('http') && !coverUrl.startsWith('blob:') && !coverUrl.startsWith('data:')) {
      absoluteCoverUrl = new URL(coverUrl, window.location.href).href;
    }
    
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.name || '未知歌曲',
      artist: track.artist || '未知歌手',
      album: 'ForliMusic',
      artwork: [
        { src: absoluteCoverUrl, sizes: '96x96', type: 'image/png' },
        { src: absoluteCoverUrl, sizes: '128x128', type: 'image/png' },
        { src: absoluteCoverUrl, sizes: '192x192', type: 'image/png' },
        { src: absoluteCoverUrl, sizes: '256x256', type: 'image/png' },
        { src: absoluteCoverUrl, sizes: '384x384', type: 'image/png' },
        { src: absoluteCoverUrl, sizes: '512x512', type: 'image/png' }
      ]
    });
  }

  function updateMediaSessionPlaybackState(isPlaying) {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
  }

  function updateMediaSessionPositionState() {
    if (!('mediaSession' in navigator) || !audio.duration || isNaN(audio.duration)) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: audio.duration,
        playbackRate: audio.playbackRate || 1,
        position: audio.currentTime
      });
    } catch (e) {
      console.warn('Error setting Media Session position state:', e);
    }
  }

  function initMediaSessionHandlers() {
    if (!('mediaSession' in navigator)) return;
    
    navigator.mediaSession.setActionHandler('play', () => {
      playAudio();
    });
    navigator.mediaSession.setActionHandler('pause', () => {
      pauseAudio();
    });
    navigator.mediaSession.setActionHandler('previoustrack', () => {
      playPrev();
    });
    navigator.mediaSession.setActionHandler('nexttrack', () => {
      playNext();
    });
    
    try {
      navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (details.fastSeek && 'fastSeek' in audio) {
          audio.fastSeek(details.seekTime);
        } else {
          audio.currentTime = details.seekTime;
        }
        updateMediaSessionPositionState();
      });
    } catch (e) {
      console.warn('Media Session seekto handler error:', e);
    }
    
    try {
      navigator.mediaSession.setActionHandler('seekbackward', (details) => {
        const offset = details.seekOffset || 10;
        audio.currentTime = Math.max(audio.currentTime - offset, 0);
        updateMediaSessionPositionState();
      });
      navigator.mediaSession.setActionHandler('seekforward', (details) => {
        const offset = details.seekOffset || 10;
        audio.currentTime = Math.min(audio.currentTime + offset, audio.duration || 0);
        updateMediaSessionPositionState();
      });
    } catch (e) {
      console.warn('Media Session seekforward/backward handler error:', e);
    }
  }

  function loadTrack(index) {
    if (fadeInterval) {
      clearInterval(fadeInterval);
      fadeInterval = null;
    }
    if (index < 0 || index >= currentPlaylist.length) return;
    currentTrackIndex = index;
    const track = currentPlaylist[index];
    consecutiveErrors = 0;

    // Load source
    loadTrackSource(track);

    // Update Metadata
    trackNameEl.textContent = track.name;
    trackArtistEl.textContent = track.artist;
    updateMediaSessionMetadata(track);
    
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

    const fsBarTitleEl = document.getElementById('fs-bar-title');
    const fsBarArtistEl = document.getElementById('fs-bar-artist');
    const fsBarCoverEl = document.getElementById('fs-bar-cover');
    if (fsBarTitleEl) fsBarTitleEl.textContent = track.name;
    if (fsBarArtistEl) fsBarArtistEl.textContent = track.artist;
    if (fsBarCoverEl) fsBarCoverEl.style.backgroundImage = `url('${coverUrl}')`;
    
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
      audio.removeAttribute('crossorigin');
      audio.src = track.url;
      currentSourceIndex = -1; // Local files don't use sources list
    } else if (track.platform === 'radio') {
      // Enable crossorigin="anonymous" and proxy live radio streams so they play cleanly in AudioContext without CORS blocks
      audio.setAttribute('crossorigin', 'anonymous');
      audio.src = getApiUrl('/api/proxy-audio?url=' + encodeURIComponent(track.url));
      currentSourceIndex = -1; // Radio doesn't use sources list
    } else {
      // Enable crossorigin="anonymous" since we proxy online streams to avoid CORS blocks
      audio.setAttribute('crossorigin', 'anonymous');
      
      let rawUrl = '';
      if (track.platform && track.platform !== 'netease') {
        rawUrl = track.url;
        currentSourceIndex = -1; // Non-NetEase platforms use their own redirect URLs directly
        console.log(`Loading redirect url for ${track.platform}: ${track.url}`);
      } else if (track.id) {
        if (sourceIndex >= 0 && sourceIndex < AUDIO_SOURCES.length) {
          rawUrl = AUDIO_SOURCES[sourceIndex](track.id, track.name, track.artist);
          console.log(`Loading song source index ${sourceIndex} for ID ${track.id}`);
        } else {
          rawUrl = '';
        }
      } else if (track.url) {
        rawUrl = track.url;
        currentSourceIndex = -1;
      }
      
      if (rawUrl) {
        // Wrap the online track url in our local server proxy-audio API
        audio.src = getApiUrl('/api/proxy-audio?url=' + encodeURIComponent(rawUrl));
      } else {
        audio.src = '';
      }
    }
    audio.load();
  }

  function playAudio(shouldFade = false) {
    initWebAudio();
    audio.play()
      .then(() => {
        consecutiveErrors = 0;
        syncUIState(true);
        if (shouldFade) {
          fadeAudioIn(400);
        } else {
          const savedVol = localStorage.getItem('aura-volume') || '70';
          audio.volume = audio.muted ? 0 : parseInt(savedVol, 10) / 100;
        }
      })
      .catch(err => {
        console.warn('Playback block / error:', err);
        syncUIState(false);
      });
  }

  function pauseAudio(shouldFade = false) {
    if (shouldFade) {
      fadeAudioOut(() => {
        audio.pause();
        syncUIState(false);
      }, 250);
    } else {
      audio.pause();
      syncUIState(false);
    }
  }

  function togglePlay() {
    if (audio.paused) {
      playAudio(true);
    } else {
      pauseAudio(true);
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
    
    fadeAudioOut(() => {
      loadTrack(nextIndex);
      playAudio(true);
    }, 200);
  }

  function playPrev() {
    if (currentPlaylist.length === 0) return;
    let prevIndex = currentTrackIndex;
    
    if (loopMode === 'shuffle') {
      prevIndex = Math.floor(Math.random() * currentPlaylist.length);
    } else {
      prevIndex = (currentTrackIndex - 1 + currentPlaylist.length) % currentPlaylist.length;
    }
    
    fadeAudioOut(() => {
      loadTrack(prevIndex);
      playAudio(true);
    }, 200);
  }

  // ==========================================
  // Web Audio Equalizer (EQ) & Visualizer Logic
  // ==========================================

  function initWebAudio() {
    if (audioCtx) return;
    
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      audioSource = audioCtx.createMediaElementSource(audio);
      
      // Analyser Node
      analyserNode = audioCtx.createAnalyser();
      analyserNode.fftSize = 256; // 128 bins
      
      // EQ Filter Nodes (60Hz, 230Hz, 910Hz, 4000Hz, 14000Hz)
      const bands = [60, 230, 910, 4000, 14000];
      eqFilters = bands.map((freq, i) => {
        const filter = audioCtx.createBiquadFilter();
        filter.frequency.value = freq;
        if (i === 0) {
          filter.type = 'lowshelf';
        } else if (i === bands.length - 1) {
          filter.type = 'highshelf';
        } else {
          filter.type = 'peaking';
          filter.Q.value = 1.0;
        }
        filter.gain.value = isEqEnabled ? eqGains[i] : 0;
        return filter;
      });
      
      // Connect nodes: audioSource -> filter0 -> filter1 -> ... -> analyser -> destination
      let lastNode = audioSource;
      eqFilters.forEach(filter => {
        lastNode.connect(filter);
        lastNode = filter;
      });
      lastNode.connect(analyserNode);
      analyserNode.connect(audioCtx.destination);
      
      console.log('Web Audio API and EQ filters initialized.');
      startVisualizerDrawing();
    } catch (e) {
      console.warn('Web Audio API initialization failed:', e);
    }
  }

  function fadeAudioIn(duration = 400) {
    if (fadeInterval) clearInterval(fadeInterval);
    const steps = 20;
    const stepTime = duration / steps;
    const finalVolume = audio.muted ? 0 : (localStorage.getItem('aura-volume') || 70) / 100;
    audio.volume = 0;
    let currentStep = 0;
    fadeInterval = setInterval(() => {
      currentStep++;
      audio.volume = (currentStep / steps) * finalVolume;
      if (currentStep >= steps) {
        audio.volume = finalVolume;
        clearInterval(fadeInterval);
        fadeInterval = null;
      }
    }, stepTime);
  }

  function fadeAudioOut(onComplete, duration = 300) {
    if (fadeInterval) clearInterval(fadeInterval);
    const steps = 15;
    const stepTime = duration / steps;
    const initialVolume = audio.volume;
    let currentStep = 0;
    fadeInterval = setInterval(() => {
      currentStep++;
      audio.volume = Math.max(initialVolume * (1 - (currentStep / steps)), 0);
      if (currentStep >= steps) {
        audio.volume = 0;
        clearInterval(fadeInterval);
        fadeInterval = null;
        if (onComplete) onComplete();
      }
    }, stepTime);
  }

  function startVisualizerDrawing() {
    if (isVisualizerDrawing) return;
    isVisualizerDrawing = true;
    
    function resizeCanvas() {
      if (fsVisualizerCanvas) {
        fsVisualizerCanvas.width = fsVisualizerCanvas.clientWidth * window.devicePixelRatio;
        fsVisualizerCanvas.height = fsVisualizerCanvas.clientHeight * window.devicePixelRatio;
      }
    }
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();
    
    function drawVisualizer() {
      if (!isVisualizerDrawing) return;
      requestAnimationFrame(drawVisualizer);
      if (!analyserNode || !fsVisualizerCanvas) return;
      
      const canvas = fsVisualizerCanvas;
      const ctx = canvas.getContext('2d');
      const w = canvas.width;
      const h = canvas.height;
      
      if (!isVisualizerEnabled) {
        ctx.clearRect(0, 0, w, h);
        audioBeatFactor = 1.0;
        return;
      }
      
      const bufferLength = analyserNode.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      analyserNode.getByteFrequencyData(dataArray);
      
      if (!audio.paused) {
        let sum = 0;
        const bassCount = Math.min(10, bufferLength);
        for (let i = 0; i < bassCount; i++) {
          sum += dataArray[i];
        }
        const avgBass = sum / bassCount;
        audioBeatFactor = 1.0 + (avgBass / 255) * 0.45;
      } else {
        audioBeatFactor = 1.0;
      }
      
      const isFullscreenOpen = fullscreenLyricsOverlay && fullscreenLyricsOverlay.classList.contains('open');
      if (!isFullscreenOpen) {
        ctx.clearRect(0, 0, w, h);
        return;
      }
      
      ctx.clearRect(0, 0, w, h);
      ctx.beginPath();
      ctx.moveTo(0, h);
      
      for (let i = 0; i < bufferLength; i++) {
        const val = dataArray[i] / 255;
        const y = h - val * h * 0.75;
        const xCoord = (i / (bufferLength - 1)) * w;
        
        if (i === 0) {
          ctx.lineTo(xCoord, y);
        } else {
          const prevX = ((i - 1) / (bufferLength - 1)) * w;
          const prevVal = dataArray[i - 1] / 255;
          const prevY = h - prevVal * h * 0.75;
          const xc = (prevX + xCoord) / 2;
          const yc = (prevY + y) / 2;
          ctx.quadraticCurveTo(prevX, prevY, xc, yc);
        }
      }
      
      ctx.lineTo(w, h);
      ctx.closePath();
      
      const grad = ctx.createLinearGradient(0, h, w, 0);
      if (currentCoverColors && currentCoverColors.length > 0) {
        currentCoverColors.forEach((color, idx) => {
          grad.addColorStop(idx / (currentCoverColors.length - 1), color);
        });
      } else {
        grad.addColorStop(0, '#fa243c');
        grad.addColorStop(1, '#5e5e5e');
      }
      ctx.fillStyle = grad;
      ctx.fill();
    }
    drawVisualizer();
  }

  function initEqualizerUI() {
    if (!eqModal) return;
    
    eqEnableCheckbox.checked = isEqEnabled;
    eqPresetSelect.value = eqPreset;
    syncCustomDropdown(eqPresetSelect);
    toggleEqUiState(isEqEnabled);
    
    for (let i = 0; i < 5; i++) {
      if (eqSliders[i]) {
        eqSliders[i].value = eqGains[i];
        if (eqDbLabels[i]) {
          eqDbLabels[i].textContent = (eqGains[i] >= 0 ? '+' : '') + eqGains[i] + 'dB';
        }
      }
    }
    
     eqEnableCheckbox.addEventListener('change', (e) => {
      isEqEnabled = e.target.checked;
      localStorage.setItem('aura-eq-enabled', isEqEnabled);
      toggleEqUiState(isEqEnabled);
      applyEqGains();
      if (typeof settingsEqCheckbox !== 'undefined' && settingsEqCheckbox) {
        settingsEqCheckbox.checked = isEqEnabled;
        settingsEqPresetSelect.disabled = !isEqEnabled;
        syncCustomDropdown(settingsEqPresetSelect);
      }
    });
    
    eqPresetSelect.addEventListener('change', (e) => {
      const preset = e.target.value;
      if (preset === 'custom') return;
      
      eqPreset = preset;
      localStorage.setItem('aura-eq-preset', preset);
      
      const presetGains = EQ_PRESETS[preset] || [0, 0, 0, 0, 0];
      eqGains = [...presetGains];
      localStorage.setItem('aura-eq-gains', JSON.stringify(eqGains));
      
      for (let i = 0; i < 5; i++) {
        if (eqSliders[i]) {
          eqSliders[i].value = eqGains[i];
          if (eqDbLabels[i]) {
            eqDbLabels[i].textContent = (eqGains[i] >= 0 ? '+' : '') + eqGains[i] + 'dB';
          }
        }
      }
      applyEqGains();
      if (typeof settingsEqPresetSelect !== 'undefined' && settingsEqPresetSelect) {
        settingsEqPresetSelect.value = preset;
        syncCustomDropdown(settingsEqPresetSelect);
      }
    });
    
    for (let i = 0; i < 5; i++) {
      if (eqSliders[i]) {
        eqSliders[i].addEventListener('input', (e) => {
          const val = parseInt(e.target.value, 10);
          eqGains[i] = val;
          localStorage.setItem('aura-eq-gains', JSON.stringify(eqGains));
          
          if (eqDbLabels[i]) {
            eqDbLabels[i].textContent = (val >= 0 ? '+' : '') + val + 'dB';
          }
          
          eqPreset = 'custom';
          eqPresetSelect.value = 'custom';
          syncCustomDropdown(eqPresetSelect);
          localStorage.setItem('aura-eq-preset', 'custom');
          applyEqGains();
          if (typeof settingsEqPresetSelect !== 'undefined' && settingsEqPresetSelect) {
            settingsEqPresetSelect.value = 'custom';
            syncCustomDropdown(settingsEqPresetSelect);
          }
        });
      }
    }
    
    if (playerEqToggle) {
      playerEqToggle.addEventListener('click', () => {
        eqModal.classList.add('show');
      });
    }
    if (eqCloseBtn) {
      eqCloseBtn.addEventListener('click', () => {
        eqModal.classList.remove('show');
      });
    }
    eqModal.addEventListener('click', (e) => {
      if (e.target === eqModal) {
        eqModal.classList.remove('show');
      }
    });
  }

  function initSettingsUI() {
    // Look for the dark mode checkbox to check if settings elements are in DOM
    if (!settingsDarkModeCheckbox) return;

    // 1. Initial states sync
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'apple-dark';
    settingsDarkModeCheckbox.checked = currentTheme === 'apple-dark';
    settingsEqCheckbox.checked = isEqEnabled;
    settingsEqPresetSelect.value = eqPreset;
    syncCustomDropdown(settingsEqPresetSelect);
    settingsFluidBgCheckbox.checked = isFluidBgEnabled;
    settingsVisualizerCheckbox.checked = isVisualizerEnabled;
    if (settingsFsThemeSelect) {
      settingsFsThemeSelect.value = localStorage.getItem('aura-fs-player-theme') || 'vertical';
      syncCustomDropdown(settingsFsThemeSelect);
    }
    if (settingsSearchPrioritySelect) {
      settingsSearchPrioritySelect.value = searchPriority;
      syncCustomDropdown(settingsSearchPrioritySelect);
    }

    // Update settings EQ controls disabled status
    settingsEqPresetSelect.disabled = !isEqEnabled;
    syncCustomDropdown(settingsEqPresetSelect);

    // Dedicated settings page is handled via navItems tab switching

    // 3. Dark mode change handler
    settingsDarkModeCheckbox.addEventListener('change', (e) => {
      const nextTheme = e.target.checked ? 'apple-dark' : 'apple-light';
      document.documentElement.setAttribute('data-theme', nextTheme);
      localStorage.setItem('aura-theme', nextTheme);
      updateThemeToggleIcon(nextTheme);
      updateFluidColors(null);
    });

    // 4. EQ Checkbox change handler (Synchronizes with original EQ UI)
    settingsEqCheckbox.addEventListener('change', (e) => {
      isEqEnabled = e.target.checked;
      localStorage.setItem('aura-eq-enabled', isEqEnabled);
      eqEnableCheckbox.checked = isEqEnabled;
      
      settingsEqPresetSelect.disabled = !isEqEnabled;
      syncCustomDropdown(settingsEqPresetSelect);
      toggleEqUiState(isEqEnabled);
      applyEqGains();
    });

    // 5. EQ Presets change handler (Synchronizes with original EQ UI)
    settingsEqPresetSelect.addEventListener('change', (e) => {
      const preset = e.target.value;
      if (preset === 'custom') return;
      
      eqPreset = preset;
      localStorage.setItem('aura-eq-preset', preset);
      eqPresetSelect.value = preset;
      syncCustomDropdown(eqPresetSelect);
      
      const presetGains = EQ_PRESETS[preset] || [0, 0, 0, 0, 0];
      eqGains = [...presetGains];
      localStorage.setItem('aura-eq-gains', JSON.stringify(eqGains));
      
      for (let i = 0; i < 5; i++) {
        if (eqSliders[i]) {
          eqSliders[i].value = eqGains[i];
          if (eqDbLabels[i]) {
            eqDbLabels[i].textContent = (eqGains[i] >= 0 ? '+' : '') + eqGains[i] + 'dB';
          }
        }
      }
      applyEqGains();
    });

    // 6. Open detailed EQ panel button
    if (settingsOpenEqBtn) {
      settingsOpenEqBtn.addEventListener('click', () => {
        eqModal.classList.add('show');
      });
    }

    // 7. Fluid Background checkbox change handler
    settingsFluidBgCheckbox.addEventListener('change', (e) => {
      isFluidBgEnabled = e.target.checked;
      localStorage.setItem('aura-fluid-bg-enabled', isFluidBgEnabled);
      setupCanvasAnimation(null); // Will triggerSetupCanvasAnimation or halt it appropriately
    });

    // 8. Visualizer checkbox change handler
    settingsVisualizerCheckbox.addEventListener('change', (e) => {
      isVisualizerEnabled = e.target.checked;
      localStorage.setItem('aura-visualizer-enabled', isVisualizerEnabled);
      if (!isVisualizerEnabled && fsVisualizerCanvas) {
        const ctx = fsVisualizerCanvas.getContext('2d');
        ctx.clearRect(0, 0, fsVisualizerCanvas.width, fsVisualizerCanvas.height);
      }
    });

    // 9. Fullscreen Theme select change handler
    if (settingsFsThemeSelect) {
      settingsFsThemeSelect.addEventListener('change', (e) => {
        const nextFsTheme = e.target.value;
        localStorage.setItem('aura-fs-player-theme', nextFsTheme);
        applyFsPlayerTheme(nextFsTheme);
        showToast(`播放界面布局已应用: ${nextFsTheme === 'vertical' ? '极简分栏' : '底栏控制条'}`);
      });
    }

    // 10. Search Priority select change handler
    if (settingsSearchPrioritySelect) {
      settingsSearchPrioritySelect.addEventListener('change', (e) => {
        searchPriority = e.target.value;
        localStorage.setItem('aura-search-priority', searchPriority);
        showToast(`搜索默认来源已设置为: ${searchPriority === 'tencent-first' ? 'QQ音乐优先' : '网易云优先'}`);
      });
    }
  }
  
  function toggleEqUiState(enabled) {
    eqPresetSelect.disabled = !enabled;
    syncCustomDropdown(eqPresetSelect);
    for (let i = 0; i < 5; i++) {
      if (eqSliders[i]) {
        eqSliders[i].disabled = !enabled;
      }
    }
  }
  
  function applyEqGains() {
    if (!eqFilters || eqFilters.length === 0) return;
    for (let i = 0; i < 5; i++) {
      if (eqFilters[i]) {
        eqFilters[i].gain.value = isEqEnabled ? eqGains[i] : 0;
      }
    }
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

        // 过滤常见的歌词作者/歌手信息行，避免它们被错误地合并到实际第一句歌词中
        const isMetadata = /^(作词|作曲|编曲|歌手|演唱|专辑|制作|监制|出品|发行|和声|混音|录音|吉他|贝斯|键盘|鼓|弦乐|词|曲|OP|SP|Lyrics|Composer|Lyricist|Arranger|Artist|Album|Producer|作词\/作曲)\s*[:：\-\s]/i;
        if (isMetadata.test(text)) return [];
        
        const inlineRegex = /([作编]?[词曲]|歌手|演唱|专辑|制作人?|录音|混音)\s*[:：]/i;
        if (inlineRegex.test(text)) return [];

        if (text.includes('歌词贡献者') || text.includes('歌词提供') || text.includes('歌词匹配')) return [];
        
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
        if (gap > 12.0) {
          // 间隙大（间奏）：保留足够的高亮时长后，淡出高亮
          const charCount = current.text.length;
          const duration = Math.max(8.0, charCount * 0.2 + 3.0);
          current.endTime = Math.min(next.time - 0.5, current.time + duration);
        } else {
          // 正常间隙：高亮一直保持到下一句歌词开始前
          current.endTime = next.time - 0.1;
        }
      } else {
        // 最后一句歌词
        const charCount = current.text.length;
        const duration = Math.max(10.0, charCount * 0.2 + 4.0);
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
    const platform = track.platform || 'netease';

    // Try local proxy first (supporting file:// protocol using localhost mapping)
    if (true) {
      try {
        const lyricUrl = getApiUrl(`/api/lyric?id=${track.id}&platform=${platform}&name=${encodeURIComponent(track.name)}&artist=${encodeURIComponent(track.artist)}`);
        const response = await fetch(lyricUrl);
        if (response.ok) {
          const data = await response.json();
          const rawLrc = data.lrc?.lyric || '';
          
          if (platform === 'netease') {
            const rawTLrc = data.tlyric?.lyric || '';
            const parsedLrc = parseLyrics(rawLrc);
            const parsedTLrc = parseLyrics(rawTLrc);
            loadedLyrics = mergeLyrics(parsedLrc, parsedTLrc);
          } else {
            loadedLyrics = parseLyrics(rawLrc);
          }
        }
      } catch (err) {
        console.warn(`Failed to load ${platform} lyrics via proxy, trying fallback:`, err);
      }
    }

    // Try public Meting API fallback directly (only for NetEase and Tencent)
    if (!loadedLyrics && platform !== 'kuwo') {
      try {
        console.log(`Fetching lyrics for song ${track.id} directly from Meting API fallback...`);
        const fallbackUrl = `https://v.iarc.top/?server=${platform}&type=lrc&id=${track.id}`;
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
    if (!playlistSelect) return;
    playlistSelect.innerHTML = '';
    
    // 始终加上“已播放歌曲 / 临时队列”作为常驻首选项
    const tempOpt = document.createElement('option');
    tempOpt.value = 'temporary';
    tempOpt.textContent = '已播放歌曲 / 临时队列';
    if (currentPlaylistId === 'temporary') {
      tempOpt.selected = true;
    }
    playlistSelect.appendChild(tempOpt);
    
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

    // Add local playlists
    localPlaylists.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      if (p.id === currentPlaylistId) {
        opt.selected = true;
      }
      playlistSelect.appendChild(opt);
    });

    // Update sidebar playlists lists
    renderSidebarPlaylists();
    renderSidebarLocalPlaylists();
  }

  // Render playlists in the left sidebar (Imported from NetEase)
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
      
      let coverHtml = '';
      if (p.cover && p.cover !== 'assets/default.svg') {
        coverHtml = `<img src="${getHdCoverUrl(p.cover)}" class="sidebar-playlist-cover" alt="" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">`;
      }
      const fallbackHtml = `
        <div class="sidebar-playlist-default-cover" style="${p.cover && p.cover !== 'assets/default.svg' ? 'display:none;' : ''}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 18V5l12-2v13"></path>
            <circle cx="6" cy="18" r="3"></circle>
            <circle cx="18" cy="16" r="3"></circle>
          </svg>
        </div>
      `;
      
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'sidebar-playlist-delete-btn';
      deleteBtn.title = '删除导入的歌单';
      deleteBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          <line x1="10" y1="11" x2="10" y2="17"></line>
          <line x1="14" y1="11" x2="14" y2="17"></line>
        </svg>
      `;
      deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (await showCustomConfirm(`确定要删除已导入的歌单 "${p.name}" 吗？`)) {
          deleteImportedPlaylist(p.id);
        }
      });
      
      btn.innerHTML = `
        ${coverHtml}
        ${fallbackHtml}
        <span>${p.name}</span>
      `;
      if (p.id !== '8529369110') {
        btn.appendChild(deleteBtn);
      }
      
      btn.addEventListener('click', () => {
        const queueNavItem = document.querySelector('.sidebar .nav-item[data-tab="queue"]');
        if (queueNavItem) {
          queueNavItem.click();
        }
        
        currentPlaylistId = p.id;
        playlistSelect.value = p.id;
        syncCustomDropdown(playlistSelect);
        fetchOnlinePlaylist(p.id);
        
        document.querySelectorAll('.sidebar-playlist-item').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
      
      listContainer.appendChild(btn);
    });
  }

  // Render local playlists in the left sidebar (Self-created)
  function renderSidebarLocalPlaylists() {
    const listContainer = document.getElementById('sidebar-local-playlists-list');
    if (!listContainer) return;
    listContainer.innerHTML = '';
    
    localPlaylists.forEach(pl => {
      const btn = document.createElement('button');
      btn.className = 'nav-item sidebar-playlist-item';
      if (pl.id === currentPlaylistId) {
        btn.classList.add('active');
      }
      
      let coverHtml = '';
      if (pl.cover && pl.cover !== 'assets/default.svg') {
        coverHtml = `<img src="${getHdCoverUrl(pl.cover)}" class="sidebar-playlist-cover" alt="" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">`;
      }
      const fallbackHtml = `
        <div class="sidebar-playlist-default-cover" style="${pl.cover && pl.cover !== 'assets/default.svg' ? 'display:none;' : ''}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 18V5l12-2v13"></path>
            <circle cx="6" cy="18" r="3"></circle>
            <circle cx="18" cy="16" r="3"></circle>
          </svg>
        </div>
      `;
      
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'sidebar-playlist-delete-btn';
      deleteBtn.title = '删除歌单';
      deleteBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          <line x1="10" y1="11" x2="10" y2="17"></line>
          <line x1="14" y1="11" x2="14" y2="17"></line>
        </svg>
      `;
      deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (await showCustomConfirm(`确定要删除自建歌单 "${pl.name}" 吗？`)) {
          deleteLocalPlaylist(pl.id);
        }
      });
      
      btn.innerHTML = `
        ${coverHtml}
        ${fallbackHtml}
        <span>${pl.name}</span>
      `;
      btn.appendChild(deleteBtn);
      
      btn.addEventListener('click', () => {
        const queueNavItem = document.querySelector('.sidebar .nav-item[data-tab="queue"]');
        if (queueNavItem) {
          queueNavItem.click();
        }
        
        currentPlaylistId = pl.id;
        playlistSelect.value = pl.id;
        syncCustomDropdown(playlistSelect);
        currentPlaylist = pl.tracks;
        
        document.querySelectorAll('.sidebar-playlist-item').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        if (currentPlaylist.length > 0) {
          localStorage.setItem('aura-custom-playlist', JSON.stringify(currentPlaylist));
          localStorage.setItem('aura-current-playlist-id', pl.id);
          bootstrapPlayer();
        } else {
          localStorage.setItem('aura-custom-playlist', JSON.stringify([]));
          localStorage.setItem('aura-current-playlist-id', pl.id);
          currentTrackIndex = 0;
          renderPlaylistSongs();
          showToast('歌单为空，请添加歌曲');
        }
      });
      
      listContainer.appendChild(btn);
    });
  }

  // Delete a self-created local playlist
  function deleteLocalPlaylist(id) {
    localPlaylists = localPlaylists.filter(p => p.id !== id);
    localStorage.setItem('aura-local-playlists', JSON.stringify(localPlaylists));
    showToast('自建歌单已删除');
    if (currentPlaylistId === id) {
      currentPlaylistId = 'temporary';
      playlistSelect.value = 'temporary';
      syncCustomDropdown(playlistSelect);
      localStorage.setItem('aura-current-playlist-id', 'temporary');
      bootstrapPlayer();
    } else {
      updatePlaylistSelect();
    }
  }

  // Delete an imported NetEase playlist
  function deleteImportedPlaylist(id) {
    if (id === '8529369110') {
      showToast('默认歌单无法删除');
      return;
    }
    savedPlaylists = savedPlaylists.filter(p => p.id !== id);
    localStorage.setItem('aura-saved-playlists', JSON.stringify(savedPlaylists));
    showToast('导入的歌单已删除');
    if (currentPlaylistId === id) {
      currentPlaylistId = 'temporary';
      playlistSelect.value = 'temporary';
      syncCustomDropdown(playlistSelect);
      localStorage.setItem('aura-current-playlist-id', 'temporary');
      bootstrapPlayer();
    } else {
      updatePlaylistSelect();
    }
  }

  // Handle switching playlists in select dropdown
  playlistSelect.addEventListener('change', (e) => {
    const val = e.target.value;
    if (val === 'temporary') {
      currentPlaylistId = 'temporary';
      currentPlaylist = temporaryPlaylist;
      localStorage.setItem('aura-current-playlist-id', 'temporary');
      bootstrapPlayer();
    } else if (val && val.startsWith('local_')) {
      currentPlaylistId = val;
      const pl = localPlaylists.find(p => p.id === val);
      if (pl) {
        currentPlaylist = pl.tracks;
        localStorage.setItem('aura-custom-playlist', JSON.stringify(currentPlaylist));
        localStorage.setItem('aura-current-playlist-id', val);
        if (currentPlaylist.length > 0) {
          bootstrapPlayer();
        } else {
          currentTrackIndex = 0;
          renderPlaylistSongs();
          showToast('歌单为空，请添加歌曲');
        }
      }
      renderSidebarLocalPlaylists();
      renderSidebarPlaylists();
    } else if (val) {
      currentPlaylistId = val;
      fetchOnlinePlaylist(val);
    }
  });

  // Local Action Buttons
  if (importFileBtn) {
    importFileBtn.addEventListener('click', () => {
      localAudioFile.click();
    });
  }

  if (importFolderBtn) {
    importFolderBtn.addEventListener('click', () => {
      localFolderFile.click();
    });
  }

  clearQueueBtn.addEventListener('click', async () => {
    const confirmClear = await showCustomConfirm("确定要清空播放队列吗？");
    if (confirmClear) {
      currentPlaylist = [];
      temporaryPlaylist = [];
      localStorage.setItem('aura-temporary-playlist', JSON.stringify([]));
      currentPlaylistId = 'temporary';
      currentTrackIndex = 0;
      audio.pause();
      audio.src = '';
      syncUIState(false);
      bootstrapPlayer();
      showToast("播放队列已清空");
    }
  });

  window.triggerSearch = function(query) {
    if (onlineSearchInput) {
      onlineSearchInput.value = query;
      onlineSearchInput.dispatchEvent(new Event('input'));
    }
  };

  // 搜索平台切换逻辑
  let currentPlatform = 'all';
  const platformTabs = document.querySelectorAll('.platform-tab');
  platformTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      platformTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentPlatform = tab.getAttribute('data-platform') || 'all';
      
      // 切换平台后自动重新触发搜索
      const query = onlineSearchInput.value.trim();
      if (query) {
        performOnlineSearch(query);
      } else {
        const platformNames = { all: '聚合搜索', netease: '网易云音乐', tencent: 'QQ音乐' };
        const name = platformNames[currentPlatform] || '音乐';
        onlineSearchResults.innerHTML = `<div class="playlist-empty">${MUSIC_NOTE_SVG}<span>输入关键词搜索${name}</span></div>`;
      }
    });
  });

  // 自定义音源设置及面板展示
  const customSourceSettingsBtn = document.getElementById('custom-source-settings-btn');
  const customSourcePanel = document.getElementById('custom-source-panel');
  const customSourceUrlInput = document.getElementById('custom-source-url-input');
  const saveCustomSourceBtn = document.getElementById('save-custom-source-btn');

  if (customSourceUrlInput) {
    customSourceUrlInput.value = localStorage.getItem('custom_lx_source') || '';
  }

  if (customSourceSettingsBtn && customSourcePanel) {
    customSourceSettingsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isHidden = customSourcePanel.style.display === 'none';
      customSourcePanel.style.display = isHidden ? 'block' : 'none';
    });
  }

  if (saveCustomSourceBtn && customSourceUrlInput) {
    saveCustomSourceBtn.addEventListener('click', () => {
      const val = customSourceUrlInput.value.trim();
      localStorage.setItem('custom_lx_source', val);
      showToast(val ? '自定义洛雪音源保存成功' : '已清除自定义音源，将仅使用本地与兜底 Fallback');
      if (customSourcePanel) customSourcePanel.style.display = 'none';
    });
  }

  // 搜索联想下拉框逻辑
  const suggestionsDropdown = document.getElementById('search-suggestions-dropdown');
  let suggestDebounceTimeout = null;

  onlineSearchInput.addEventListener('input', (e) => {
    const val = e.target.value.trim();
    clearTimeout(suggestDebounceTimeout);
    
    if (!val) {
      if (suggestionsDropdown) {
        suggestionsDropdown.style.display = 'none';
        suggestionsDropdown.innerHTML = '';
      }
      return;
    }

    suggestDebounceTimeout = setTimeout(async () => {
      try {
        const res = await fetch(getApiUrl(`/api/suggest?s=${encodeURIComponent(val)}`));
        if (!res.ok) return;
        const data = await res.json();
        const result = data.result || {};
        const order = result.order || [];
        
        if (order.length === 0) {
          if (suggestionsDropdown) suggestionsDropdown.style.display = 'none';
          return;
        }

        let html = '';
        let count = 0;
        
        // 优先展示歌曲联想
        if (result.songs && result.songs.length > 0) {
          result.songs.forEach(song => {
            if (count >= 8) return;
            const name = song.name;
            const artist = (song.artists || []).map(a => a.name).join('/');
            html += `
              <div class="suggestion-item" data-query="${name} ${artist}">
                <svg class="suggestion-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>
                <span class="suggestion-text"><strong>${name}</strong> - ${artist}</span>
                <span class="suggestion-type">单曲</span>
              </div>
            `;
            count++;
          });
        }

        // 展示歌手
        if (result.artists && result.artists.length > 0) {
          result.artists.forEach(art => {
            if (count >= 8) return;
            html += `
              <div class="suggestion-item" data-query="${art.name}">
                <svg class="suggestion-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                <span class="suggestion-text">${art.name}</span>
                <span class="suggestion-type">歌手</span>
              </div>
            `;
            count++;
          });
        }

        if (html && suggestionsDropdown) {
          suggestionsDropdown.innerHTML = html;
          suggestionsDropdown.style.display = 'block';
          
          suggestionsDropdown.querySelectorAll('.suggestion-item').forEach(item => {
            item.addEventListener('click', (ev) => {
              ev.stopPropagation();
              const q = item.getAttribute('data-query');
              onlineSearchInput.value = q;
              suggestionsDropdown.style.display = 'none';
              performOnlineSearch(q);
            });
          });
        } else if (suggestionsDropdown) {
          suggestionsDropdown.style.display = 'none';
        }
      } catch (err) {
        console.error('Fetch suggestions error:', err);
      }
    }, 300);
  });

  // 点击空白处关闭联想框
  document.addEventListener('click', (e) => {
    if (suggestionsDropdown && !e.target.closest('.search-input-wrapper')) {
      suggestionsDropdown.style.display = 'none';
    }
    if (customSourcePanel && !e.target.closest('#custom-source-panel') && !e.target.closest('#custom-source-settings-btn')) {
      customSourcePanel.style.display = 'none';
    }
  });

  // 异步获取推荐歌单和排行榜
  async function initRecommendAndRanks() {
    const recommendContainer = document.getElementById('recommend-playlists-container');
    const ranksContainer = document.getElementById('ranks-container');

    try {
      if (recommendContainer) {
        const res = await fetch(getApiUrl('/api/recommend-playlists'));
        if (res.ok) {
          const data = await res.json();
          const playlists = data.playlists || [];
          if (playlists.length > 0) {
            recommendContainer.innerHTML = playlists.map(pl => {
              const coverUrl = pl.coverImgUrl ? getHdCoverUrl(pl.coverImgUrl) : 'assets/default.svg';
              return `
                <div class="playlist-card" data-id="${pl.id}" data-platform="netease">
                  <div class="playlist-card-cover-wrap">
                    <img class="playlist-card-cover" src="${coverUrl}" onerror="this.onerror=null; this.src='assets/default.svg';" alt="" loading="lazy">
                    <div class="playlist-card-play-btn">
                      <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                    </div>
                  </div>
                  <div class="playlist-card-title">${pl.name}</div>
                </div>
              `;
            }).join('');

            recommendContainer.querySelectorAll('.playlist-card').forEach(card => {
              // 1. 点击卡片主体：仅展示打开，不自动播放
              card.addEventListener('click', (e) => {
                if (e.target.closest('.playlist-card-play-btn')) return;

                const id = card.getAttribute('data-id');
                const plat = card.getAttribute('data-platform');
                const title = card.querySelector('.playlist-card-title').innerText;
                showToast(`正在载入歌单: ${title}`);
                
                window.lastClickedPlaylistName = title;
                window.autoPlayOnNextLoad = false; // 仅打开展示，不播放
                const queueNavItem = document.querySelector('.sidebar .nav-item[data-tab="queue"]');
                if (queueNavItem) queueNavItem.click();
                
                fetchOnlinePlaylist(id, false, false, plat);
              });

              // 2. 点击悬浮播放按钮：打开并一键自动播放该歌单
              const playBtn = card.querySelector('.playlist-card-play-btn');
              if (playBtn) {
                playBtn.addEventListener('click', (e) => {
                  e.stopPropagation();
                  const id = card.getAttribute('data-id');
                  const plat = card.getAttribute('data-platform');
                  const title = card.querySelector('.playlist-card-title').innerText;
                  showToast(`正在播放歌单: ${title}`);
                  
                  window.lastClickedPlaylistName = title;
                  window.autoPlayOnNextLoad = true; // 自动播放
                  const queueNavItem = document.querySelector('.sidebar .nav-item[data-tab="queue"]');
                  if (queueNavItem) queueNavItem.click();
                  
                  fetchOnlinePlaylist(id, false, false, plat);
                });
              }
            });
          } else {
            recommendContainer.innerHTML = '<div class="playlist-empty">暂无推荐歌单</div>';
          }
        }
      }
    } catch (e) {
      console.error('Load recommended playlists failed:', e);
      if (recommendContainer) recommendContainer.innerHTML = '<div class="playlist-empty">加载失败，请重试</div>';
    }

    try {
      if (ranksContainer) {
        const res = await fetch(getApiUrl('/api/ranks'));
        if (res.ok) {
          const data = await res.json();
          const ranks = data.result || [];
          if (ranks.length > 0) {
            ranksContainer.innerHTML = ranks.map(rank => {
              const coverUrl = rank.cover ? getHdCoverUrl(rank.cover) : 'assets/default.svg';
              return `
                <div class="rank-card" data-id="${rank.id}" data-platform="${rank.platform}">
                  <div class="rank-card-cover-wrap">
                    <img class="rank-card-cover" src="${coverUrl}" onerror="this.onerror=null; this.src='assets/default.svg';" alt="" loading="lazy">
                    <div class="rank-card-play-btn">
                      <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                    </div>
                  </div>
                  <div class="rank-card-title">${rank.name}</div>
                </div>
              `;
            }).join('');

            ranksContainer.querySelectorAll('.rank-card').forEach(card => {
              // 1. 点击排行榜主体：仅展示打开，不自动播放
              card.addEventListener('click', (e) => {
                if (e.target.closest('.rank-card-play-btn')) return;

                const id = card.getAttribute('data-id');
                const plat = card.getAttribute('data-platform');
                const name = card.querySelector('.rank-card-title').innerText;
                showToast(`正在载入排行榜: ${name}`);
                
                window.lastClickedPlaylistName = name;
                window.autoPlayOnNextLoad = false; // 仅打开展示，不播放
                const queueNavItem = document.querySelector('.sidebar .nav-item[data-tab="queue"]');
                if (queueNavItem) queueNavItem.click();

                fetchOnlinePlaylist(id, false, false, plat);
              });

              // 2. 点击悬浮播放按钮：打开并一键自动播放该排行榜
              const playBtn = card.querySelector('.rank-card-play-btn');
              if (playBtn) {
                playBtn.addEventListener('click', (e) => {
                  e.stopPropagation();
                  const id = card.getAttribute('data-id');
                  const plat = card.getAttribute('data-platform');
                  const name = card.querySelector('.rank-card-title').innerText;
                  showToast(`正在播放排行榜: ${name}`);
                  
                  window.lastClickedPlaylistName = name;
                  window.autoPlayOnNextLoad = true; // 自动播放
                  const queueNavItem = document.querySelector('.sidebar .nav-item[data-tab="queue"]');
                  if (queueNavItem) queueNavItem.click();

                  fetchOnlinePlaylist(id, false, false, plat);
                });
              }
            });
          } else {
            ranksContainer.innerHTML = '<div class="playlist-empty">暂无排行榜</div>';
          }
        }
      }
    } catch (e) {
      console.error('Load ranks failed:', e);
      if (ranksContainer) ranksContainer.innerHTML = '<div class="playlist-empty">加载失败，请重试</div>';
    }
  }

  initRecommendAndRanks();

  // Online Search Logic
  let searchDebounceTimeout = null;
  onlineSearchInput.addEventListener('input', (e) => {
    clearTimeout(searchDebounceTimeout);
    const query = e.target.value.trim();
    if (!query) {
      const platformNames = { all: '聚合搜索', netease: '网易云音乐', tencent: 'QQ音乐' };
      const name = platformNames[currentPlatform] || '音乐';
      onlineSearchResults.innerHTML = `<div class="playlist-empty">${MUSIC_NOTE_SVG}<span>输入关键词搜索${name}</span></div>`;
      const categoriesPanel = document.getElementById('search-categories-panel');
      const resultsPanel = document.getElementById('search-results-panel');
      if (categoriesPanel) categoriesPanel.classList.remove('hidden');
      if (resultsPanel) resultsPanel.classList.add('hidden');
      return;
    }
    
    searchDebounceTimeout = setTimeout(() => {
      performOnlineSearch(query);
    }, 600);
  });

  async function performOnlineSearch(query) {
    onlineSearchResults.innerHTML = '<div class="playlist-empty">搜索中...</div>';
    if (suggestionsDropdown) suggestionsDropdown.style.display = 'none';
    
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
      let songs = [];
      if (currentPlatform === 'all') {
        const platforms = ['tencent', 'netease'];
        const promises = platforms.map(async (p) => {
          try {
            const res = await fetch(getApiUrl(`/api/search?s=${encodeURIComponent(query)}&platform=${p}`));
            if (!res.ok) return [];
            const d = await res.json();
            const list = d.result?.songs || [];
            list.forEach(s => s.platform = p);
            return list;
          } catch (e) {
            console.error(`Search failed for platform ${p}:`, e);
            return [];
          }
        });
        
        const results = await Promise.all(promises);
        const tencentSongs = results[0];
        const neteaseSongs = results[1];
        
        // 交叉交错合并，根据设置的 searchPriority 决定优先顺序
        const maxLen = Math.max(tencentSongs.length, neteaseSongs.length);
        for (let i = 0; i < maxLen; i++) {
          if (searchPriority === 'netease-first') {
            if (neteaseSongs[i]) songs.push(neteaseSongs[i]);
            if (tencentSongs[i]) songs.push(tencentSongs[i]);
          } else {
            if (tencentSongs[i]) songs.push(tencentSongs[i]);
            if (neteaseSongs[i]) songs.push(neteaseSongs[i]);
          }
        }
      } else {
        const response = await fetch(getApiUrl(`/api/search?s=${encodeURIComponent(query)}&platform=${currentPlatform}`));
        if (!response.ok) throw new Error("Search request failed");
        const data = await response.json();
        songs = data.result?.songs || [];
        songs.forEach(s => s.platform = currentPlatform);
      }
      
      // 网易云歌曲单独或者合并包里批量预取封面图
      const neteaseSongsToPrefetch = songs.filter(s => s.platform === 'netease' && (!s.album?.picUrl || s.album.picUrl === 'assets/default.svg'));
      if (neteaseSongsToPrefetch.length > 0) {
        const ids = neteaseSongsToPrefetch.map(s => s.id).join(',');
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
              if (s.platform === 'netease') {
                s.album = s.album || {};
                const picUrl = picMap.get(s.id);
                if (picUrl) {
                  s.album.picUrl = picUrl;
                }
              }
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
      item.songData = song;
      const coverUrl = song.album?.picUrl ? getHdCoverUrl(song.album.picUrl) : 'assets/default.svg';
      
      const platformMap = { netease: '网易云', tencent: 'QQ音乐', kuwo: '酷我' };
      const platformText = platformMap[song.platform] || '网易云';
      const badgeHtml = `<span class="platform-badge badge-${song.platform}">${platformText}</span>`;

      item.innerHTML = `
        <div class="item-left">
          <img class="item-cover" src="${coverUrl}" onerror="this.onerror=null; this.src='assets/default.svg'; window.fetchSingleCover && window.fetchSingleCover(this, ${song.id});" alt="" loading="lazy">
          <div class="item-info">
            <span class="item-title">${song.name}${badgeHtml}</span>
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
    const artistName = song.artists.map(a => a.name).join('/');
    const customSource = localStorage.getItem('custom_lx_source') || '';
    
    const track = {
      id: song.id,
      name: song.name,
      artist: artistName,
      url: getApiUrl(`/api/url?platform=${song.platform || 'netease'}&id=${song.id}&name=${encodeURIComponent(song.name)}&artist=${encodeURIComponent(artistName)}&custom_source=${encodeURIComponent(customSource)}`),
      pic: song.album?.picUrl ? getHdCoverUrl(song.album.picUrl) : 'assets/default.svg',
      lrc: null,
      platform: song.platform || 'netease'
    };

    // 切换至临时播放队列，防止污染用户当前选中的确定歌单
    currentPlaylistId = 'temporary';
    currentPlaylist = temporaryPlaylist;

    let targetIndex = currentPlaylist.findIndex(t => isSameTrack(t, track));
    if (targetIndex === -1) {
      if (currentPlaylist.length === 0) {
        currentPlaylist.push(track);
        targetIndex = 0;
      } else {
        let insertIdx = (currentTrackIndex >= 0 && currentTrackIndex < currentPlaylist.length) ? currentTrackIndex + 1 : currentPlaylist.length;
        currentPlaylist.splice(insertIdx, 0, track);
        targetIndex = insertIdx;
      }
      temporaryPlaylist = currentPlaylist;
      localStorage.setItem('aura-temporary-playlist', JSON.stringify(temporaryPlaylist));
    }

    localStorage.setItem('aura-current-playlist-id', 'temporary');
    updatePlaylistSelect();
    renderPlaylistSongs();
    document.body.classList.remove('no-files');
    loadTrack(targetIndex);
    playAudio();
    
    showToast(`正在播放《${song.name}》`);
  }

  function playSongById(id, name, artist, pic, platform = 'netease') {
    const customSource = localStorage.getItem('custom_lx_source') || '';
    
    const track = {
      id: platform === 'netease' ? parseInt(id, 10) : id,
      name: name,
      artist: artist,
      url: getApiUrl(`/api/url?platform=${platform}&id=${id}&name=${encodeURIComponent(name)}&artist=${encodeURIComponent(artist)}&custom_source=${encodeURIComponent(customSource)}`),
      pic: pic || 'assets/default.svg',
      lrc: null,
      platform: platform
    };

    // 切换至临时播放队列，防止污染用户当前选中的确定歌单
    currentPlaylistId = 'temporary';
    currentPlaylist = temporaryPlaylist;

    let targetIndex = currentPlaylist.findIndex(t => isSameTrack(t, track));
    if (targetIndex === -1) {
      if (currentPlaylist.length === 0) {
        currentPlaylist.push(track);
        targetIndex = 0;
      } else {
        let insertIdx = (currentTrackIndex >= 0 && currentTrackIndex < currentPlaylist.length) ? currentTrackIndex + 1 : currentPlaylist.length;
        currentPlaylist.splice(insertIdx, 0, track);
        targetIndex = insertIdx;
      }
      temporaryPlaylist = currentPlaylist;
      localStorage.setItem('aura-temporary-playlist', JSON.stringify(temporaryPlaylist));
    }

    localStorage.setItem('aura-current-playlist-id', 'temporary');
    updatePlaylistSelect();
    renderPlaylistSongs();
    document.body.classList.remove('no-files');
    loadTrack(targetIndex);
    playAudio();
    
    showToast(`正在播放《${name}》`);
  }

  function playRadioTrack(track) {
    currentPlaylistId = 'temporary';
    currentPlaylist = temporaryPlaylist;

    let targetIndex = currentPlaylist.findIndex(t => isSameTrack(t, track));
    if (targetIndex === -1) {
      if (currentPlaylist.length === 0) {
        currentPlaylist.push(track);
        targetIndex = 0;
      } else {
        let insertIdx = (currentTrackIndex >= 0 && currentTrackIndex < currentPlaylist.length) ? currentTrackIndex + 1 : currentPlaylist.length;
        currentPlaylist.splice(insertIdx, 0, track);
        targetIndex = insertIdx;
      }
      temporaryPlaylist = currentPlaylist;
      localStorage.setItem('aura-temporary-playlist', JSON.stringify(temporaryPlaylist));
    }

    localStorage.setItem('aura-current-playlist-id', 'temporary');
    updatePlaylistSelect();
    renderPlaylistSongs();
    document.body.classList.remove('no-files');
    loadTrack(targetIndex);
    playAudio();
    
    showToast(`正在播放电台《${track.name}》`);
  }

  // 修复添加到待播清单末尾时直接将原本外链赋值的问题
  function addSongToQueueEnd(song) {
    const artistName = song.artists.map(a => a.name).join('/');
    const customSource = localStorage.getItem('custom_lx_source') || '';
    
    const track = {
      id: song.id,
      name: song.name,
      artist: artistName,
      url: getApiUrl(`/api/url?platform=${song.platform || 'netease'}&id=${song.id}&name=${encodeURIComponent(song.name)}&artist=${encodeURIComponent(artistName)}&custom_source=${encodeURIComponent(customSource)}`),
      pic: song.album?.picUrl ? getHdCoverUrl(song.album.picUrl) : 'assets/default.svg',
      lrc: null,
      platform: song.platform || 'netease'
    };

    // 切换至临时播放队列，防止污染用户当前选中的确定歌单
    currentPlaylistId = 'temporary';
    currentPlaylist = temporaryPlaylist;

    const exists = currentPlaylist.some(t => isSameTrack(t, track));
    if (!exists) {
      currentPlaylist.push(track);
      temporaryPlaylist = currentPlaylist;
      localStorage.setItem('aura-temporary-playlist', JSON.stringify(temporaryPlaylist));
    }

    localStorage.setItem('aura-current-playlist-id', 'temporary');
    updatePlaylistSelect();
    renderPlaylistSongs();
    document.body.classList.remove('no-files');

    if (currentPlaylist.length === 1) {
      loadTrack(0);
    }
    
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
    if (track.platform && track.platform !== 'netease') return; // QQ and Kuwo already have HD covers
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
          updateMediaSessionMetadata(track);
        }
      }
    } catch (e) {
      console.warn("Failed to fetch HD cover art:", e);
    }
  }

  // Prefetch cover arts for all NetEase tracks in the loaded playlist in batches of 100
  async function preFetchPlaylistCovers(playlistToFetch) {
    const tracksNeedCover = playlistToFetch.filter(t => t.id && (!t.pic || t.pic === 'assets/default.svg' || t.pic.includes('assets/default.svg') || t.pic.includes('iarc.top')) && (!t.platform || t.platform === 'netease'));
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
    if (activeTrack && activeTrack.pic && activeTrack.pic !== 'assets/default.svg' && !activeTrack.pic.includes('iarc.top')) {
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
      item.setAttribute('data-index', index); // store index for context menu
      item.innerHTML = `
        <span class="item-index">${(index + 1).toString().padStart(2, '0')}</span>
        <img class="item-cover" src="${getHdCoverUrl(track.pic)}" onerror="this.onerror=null; this.src='assets/default.svg'; window.fetchSingleCover && window.fetchSingleCover(this, ${track.id});" alt="" loading="lazy">
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

      // Create action buttons container
      const actionsContainer = document.createElement('div');
      actionsContainer.className = 'playlist-item-actions';

      // '+' button to add to local playlist
      const addBtn = document.createElement('button');
      addBtn.className = 'item-action-btn';
      addBtn.title = '添加到歌单';
      addBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
      `;
      addBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        trackToAdd = track;
        openAddToPlaylistModal();
      });
      actionsContainer.appendChild(addBtn);

      // '-' button to remove from playlist if self-created or temporary queue
      if (currentPlaylistId === 'temporary' || (typeof currentPlaylistId === 'string' && currentPlaylistId.startsWith('local_'))) {
        const removeBtn = document.createElement('button');
        removeBtn.className = 'item-action-btn';
        removeBtn.title = '从歌单中移除';
        removeBtn.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
        `;
        removeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          removeFromPlaylist(index);
        });
        actionsContainer.appendChild(removeBtn);
      }

      item.appendChild(actionsContainer);
      
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
        drawerItem.setAttribute('data-index', index); // store index for context menu
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

    fetchOnlinePlaylist(playlistId, false, false)
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
    const track = currentPlaylist[currentTrackIndex];
    if (track && track.platform === 'radio') {
      totalTimeEl.textContent = '直播中';
      if (fsTotalTime) fsTotalTime.textContent = '直播中';
    } else {
      const formatted = `-${formatTime(audio.duration)}`;
      totalTimeEl.textContent = formatted;
      if (fsTotalTime) fsTotalTime.textContent = formatted;
    }
    updateMediaSessionPositionState();
  });

  audio.addEventListener('play', () => {
    updateMediaSessionPlaybackState(true);
    updateMediaSessionPositionState();
  });

  audio.addEventListener('pause', () => {
    updateMediaSessionPlaybackState(false);
    updateMediaSessionPositionState();
  });

  audio.addEventListener('seeked', () => {
    updateMediaSessionPositionState();
  });

  audio.addEventListener('timeupdate', () => {
    const track = currentPlaylist[currentTrackIndex];
    if (track && track.platform === 'radio') {
      progressSlider.value = 0;
      sliderFill.style.width = '0%';
      sliderFill.parentElement.style.setProperty('--slider-percent', '0%');
      currentTimeEl.textContent = 'LIVE';
      totalTimeEl.textContent = '直播中';
      if (fsProgressSlider) {
        fsProgressSlider.value = 0;
        fsSliderFill.style.width = '0%';
        fsSliderFill.parentElement.style.setProperty('--slider-percent', '0%');
        fsCurrentTime.textContent = 'LIVE';
        fsTotalTime.textContent = '直播中';
      }
      syncLyrics(audio.currentTime);
      return;
    }

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
    
    // CORS Fallback: If loading failed with crossorigin, try again without it
    if (audio.hasAttribute('crossorigin')) {
      console.warn('[CORS Fallback] Audio load failed with crossorigin. Retrying without crossorigin...');
      audio.removeAttribute('crossorigin');
      const currentSrc = audio.src;
      audio.src = currentSrc;
      audio.load();
      playAudio();
      return;
    }
    
    const track = currentPlaylist[currentTrackIndex];
    
    // If it is an online track and we haven't attempted a platform fallback for it yet
    if (track && !track.file && !track.fallbackAttempted) {
      track.fallbackAttempted = true;
      const originalPlatform = track.platform || 'netease';
      const fallbackPlatform = originalPlatform === 'tencent' ? 'netease' : 'tencent';
      
      console.log(`[Frontend Fallback] Play failed on ${originalPlatform}. Retrying with platform ${fallbackPlatform} for ${track.name}...`);
      
      const customSource = localStorage.getItem('custom_lx_source') || '';
      track.platform = fallbackPlatform;
      track.url = getApiUrl(`/api/url?platform=${fallbackPlatform}&id=${track.id}&name=${encodeURIComponent(track.name)}&artist=${encodeURIComponent(track.artist)}&custom_source=${encodeURIComponent(customSource)}`);
      
      loadTrackSource(track);
      playAudio();
      return;
    }
    
    // Auto-fallback quietly when the current source fails (NetEase default sources list)
    if (track && track.id && currentSourceIndex !== -1 && (currentSourceIndex + 1) < AUDIO_SOURCES.length) {
      const nextSourceIndex = currentSourceIndex + 1;
      console.log(`Audio source index ${currentSourceIndex} failed. Retrying silently with source index ${nextSourceIndex}...`);
      loadTrackSource(track, nextSourceIndex);
      playAudio();
      return;
    }
    
    consecutiveErrors++;
    
    if (consecutiveErrors >= currentPlaylist.length) {
      trackNameEl.textContent = '所有歌曲播放失败';
      trackArtistEl.textContent = '请检查网络';
      stopEqualizerAnimation();
      return;
    }

    trackArtistEl.textContent = '无法加载曲目，正在跳过...';
    setTimeout(playNext, 1800);
  });

  // Timeline dragging
  progressSlider.addEventListener('mousedown', () => { 
    if (currentPlaylist[currentTrackIndex]?.platform === 'radio') return;
    isDraggingProgress = true; 
  });
  progressSlider.addEventListener('touchstart', () => { 
    if (currentPlaylist[currentTrackIndex]?.platform === 'radio') return;
    isDraggingProgress = true; 
  });
  
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
    if (currentPlaylist[currentTrackIndex]?.platform === 'radio') return;
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
    fsProgressSlider.addEventListener('mousedown', () => { 
      if (currentPlaylist[currentTrackIndex]?.platform === 'radio') return;
      isDraggingProgress = true; 
    });
    fsProgressSlider.addEventListener('touchstart', () => { 
      if (currentPlaylist[currentTrackIndex]?.platform === 'radio') return;
      isDraggingProgress = true; 
    });
    
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
    if (fadeInterval) {
      clearInterval(fadeInterval);
      fadeInterval = null;
    }
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

    // Bar action buttons (horizontal theme)
    const fsBarLoopBtn = document.getElementById('fs-bar-loop-btn');
    if (fsBarLoopBtn) {
      fsBarLoopBtn.addEventListener('click', () => {
        // Delegate to loopBtn (main page) to cycle through all 3 modes: list -> single -> shuffle
        if (loopBtn) loopBtn.click();
      });
    }
    const fsBarThemeBtn = document.getElementById('fs-bar-theme-btn');
    if (fsBarThemeBtn) {
      fsBarThemeBtn.addEventListener('click', () => {
        if (fsPlayerThemeBtn) fsPlayerThemeBtn.click();
      });
    }
    const fsBarLyricsBtn = document.getElementById('fs-bar-lyrics-btn');
    if (fsBarLyricsBtn) {
      fsBarLyricsBtn.addEventListener('click', () => {
        if (fsLyricsToggle) fsLyricsToggle.click();
      });
    }
    const fsBarQueueBtn = document.getElementById('fs-bar-queue-btn');
    if (fsBarQueueBtn) {
      fsBarQueueBtn.addEventListener('click', () => {
        if (fsQueueToggle) fsQueueToggle.click();
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
        if (track.platform && track.platform !== 'netease') {
          url = track.url;
        } else {
          url = `https://music.163.com/song/media/outer/url?id=${track.id}.mp3`;
        }
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

  // Single File Import
  localAudioFile.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    showToast("正在读取音频元数据...");
    e.target.value = '';

    extractMetadata(file, async (metadata) => {
      const localTrack = {
        id: null,
        name: metadata.title,
        artist: metadata.artist,
        url: metadata.url,
        pic: metadata.pic || 'assets/default.svg',
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

      const selectLrc = await showCustomConfirm("要为该音频导入本地歌词 (.lrc 文件) 吗？");
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
        pic: 'assets/default.svg',
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
      pic: 'assets/default.svg'
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
          pic: coverUrl || 'assets/default.svg'
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

          const fsBarTitleEl = document.getElementById('fs-bar-title');
          const fsBarArtistEl = document.getElementById('fs-bar-artist');
          const fsBarCoverEl = document.getElementById('fs-bar-cover');
          if (fsBarTitleEl) fsBarTitleEl.textContent = track.name;
          if (fsBarArtistEl) fsBarArtistEl.textContent = track.artist;
          if (fsBarCoverEl) fsBarCoverEl.style.backgroundImage = `url('${track.pic}')`;
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
  // Helper Functions for Playlists and Themes
  // ==========================================

  // Beautiful Playlist Creation Modal Handler
  function showCreatePlaylistModal(onSuccessCallback) {
    const modal = document.getElementById('create-playlist-modal');
    const nameInput = document.getElementById('playlist-create-name-input');
    const descInput = document.getElementById('playlist-create-desc-input');
    const closeBtn = document.getElementById('playlist-create-close-btn');
    const cancelBtn = document.getElementById('playlist-create-cancel-btn');
    const submitBtn = document.getElementById('playlist-create-submit-btn');

    if (!modal) return;

    // Reset inputs
    if (nameInput) nameInput.value = '';
    if (descInput) descInput.value = '';

    modal.classList.add('show');
    if (nameInput) nameInput.focus();

    // Clean up previous event listeners (to prevent duplicate binds)
    const cleanup = () => {
      modal.classList.remove('show');
      submitBtn.removeEventListener('click', handleSubmit);
      cancelBtn.removeEventListener('click', handleCancel);
      closeBtn.removeEventListener('click', handleCancel);
      nameInput.removeEventListener('keydown', handleKeydown);
    };

    const handleCancel = () => {
      cleanup();
    };

    const handleSubmit = () => {
      const name = nameInput ? nameInput.value.trim() : '';
      if (!name) {
        showToast('歌单名称不能为空');
        return;
      }
      const desc = descInput ? descInput.value.trim() : '';
      
      const newPl = {
        id: 'local_' + Date.now(),
        name: name,
        description: desc,
        cover: 'assets/default.svg',
        tracks: []
      };
      
      localPlaylists.push(newPl);
      localStorage.setItem('aura-local-playlists', JSON.stringify(localPlaylists));
      showToast(`自建歌单 "${newPl.name}" 创建成功`);
      
      updatePlaylistSelect();
      if (typeof onSuccessCallback === 'function') {
        onSuccessCallback(newPl);
      }
      cleanup();
    };

    const handleKeydown = (e) => {
      if (e.key === 'Enter') {
        handleSubmit();
      } else if (e.key === 'Escape') {
        handleCancel();
      }
    };

    // Bind event listeners
    submitBtn.addEventListener('click', handleSubmit);
    cancelBtn.addEventListener('click', handleCancel);
    closeBtn.addEventListener('click', handleCancel);
    nameInput.addEventListener('keydown', handleKeydown);
  }

  // Fullscreen player theme helper
  function applyFsPlayerTheme(theme) {
    const fsOverlay = document.getElementById('fullscreen-lyrics-overlay');
    if (!fsOverlay) return;
    if (theme === 'horizontal-bar') {
      fsOverlay.classList.add('fs-theme-bar-active');
    } else {
      fsOverlay.classList.remove('fs-theme-bar-active');
    }
    
    // Toggle active state class on the switcher button to highlight it
    const fsPlayerThemeBtn = document.getElementById('fs-player-theme-btn');
    if (fsPlayerThemeBtn) {
      if (theme === 'horizontal-bar') {
        fsPlayerThemeBtn.classList.add('active');
      } else {
        fsPlayerThemeBtn.classList.remove('active');
      }
    }
    const fsBarThemeBtn = document.getElementById('fs-bar-theme-btn');
    if (fsBarThemeBtn) {
      if (theme === 'horizontal-bar') {
        fsBarThemeBtn.classList.add('active');
      } else {
        fsBarThemeBtn.classList.remove('active');
      }
    }
  }

  // Add-to-playlist modal handlers
  function openAddToPlaylistModal() {
    const modal = document.getElementById('add-to-playlist-modal');
    if (modal) {
      modal.classList.add('show');
      renderModalPlaylists();
    }
  }

  function closeAddToPlaylistModal() {
    const modal = document.getElementById('add-to-playlist-modal');
    if (modal) {
      modal.classList.remove('show');
    }
    trackToAdd = null;
  }

  function renderModalPlaylists() {
    const modalPlaylistsList = document.getElementById('modal-playlists-list');
    if (!modalPlaylistsList) return;
    modalPlaylistsList.innerHTML = '';
    
    if (localPlaylists.length === 0) {
      modalPlaylistsList.innerHTML = `
        <div style="padding: 24px 0; text-align: center; font-size: 0.88rem; color: var(--text-tertiary);">
          暂无自建歌单，请新建
        </div>
      `;
      return;
    }
    
    localPlaylists.forEach(pl => {
      const item = document.createElement('button');
      item.className = 'modal-playlist-selection-item';
      
      let coverHtml = '';
      if (pl.cover && pl.cover !== 'assets/default.svg') {
        coverHtml = `<img src="${getHdCoverUrl(pl.cover)}" class="sidebar-playlist-cover" alt="" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">`;
      }
      const fallbackHtml = `
        <div class="sidebar-playlist-default-cover" style="${pl.cover && pl.cover !== 'assets/default.svg' ? 'display:none;' : ''}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 18V5l12-2v13"></path>
            <circle cx="6" cy="18" r="3"></circle>
            <circle cx="18" cy="16" r="3"></circle>
          </svg>
        </div>
      `;
      
      item.innerHTML = `
        ${coverHtml}
        ${fallbackHtml}
        <div style="text-align: left; flex: 1; min-width: 0;">
          <div style="font-weight: 600; color: var(--text-primary); font-size: 0.88rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${pl.name}</div>
          <div style="font-size: 0.75rem; color: var(--text-tertiary); margin-top: 2px;">${pl.tracks.length} 首歌曲</div>
        </div>
      `;
      
      item.addEventListener('click', () => {
        if (trackToAdd) {
          if (pl.tracks.some(t => isSameTrack(t, trackToAdd))) {
            showToast('歌单中已存在该歌曲');
          } else {
            pl.tracks.push(trackToAdd);
            if (!pl.cover || pl.cover === 'assets/default.svg') {
              pl.cover = trackToAdd.pic;
            }
            localStorage.setItem('aura-local-playlists', JSON.stringify(localPlaylists));
            showToast(`已添加到歌单: ${pl.name}`);
            
            if (currentPlaylistId === pl.id) {
              currentPlaylist = pl.tracks;
              localStorage.setItem('aura-custom-playlist', JSON.stringify(currentPlaylist));
              renderPlaylistSongs();
            }
            renderSidebarLocalPlaylists();
          }
          closeAddToPlaylistModal();
        }
      });
      
      modalPlaylistsList.appendChild(item);
    });
  }

  // Remove track from playlist
  function removeFromPlaylist(index) {
    if (index < 0 || index >= currentPlaylist.length) return;
    const removedTrack = currentPlaylist[index];
    
    currentPlaylist.splice(index, 1);
    
    if (typeof currentPlaylistId === 'string' && currentPlaylistId.startsWith('local_')) {
      const pl = localPlaylists.find(p => p.id === currentPlaylistId);
      if (pl) {
        pl.tracks = pl.tracks.filter((t, idx) => idx !== index);
        if (pl.cover === removedTrack.pic) {
          pl.cover = pl.tracks[0]?.pic || 'assets/default.svg';
        }
        localStorage.setItem('aura-local-playlists', JSON.stringify(localPlaylists));
        renderSidebarLocalPlaylists();
      }
    }
    
    localStorage.setItem('aura-custom-playlist', JSON.stringify(currentPlaylist));
    showToast('已从歌单中移除');
    
    if (currentPlaylist.length === 0) {
      audio.pause();
      audio.src = '';
      currentTrackIndex = 0;
      syncUIState(false);
    } else {
      if (index === currentTrackIndex) {
        currentTrackIndex = currentTrackIndex % currentPlaylist.length;
        loadTrack(currentTrackIndex);
        if (!audio.paused) playAudio();
      } else if (index < currentTrackIndex) {
        currentTrackIndex--;
      }
    }
    
    renderPlaylistSongs();
  }

  // ==========================================
  // 8. Custom Premium Dialog, Tooltip, and Context Menu Systems
  // ==========================================

  // Custom Alert / Confirm / Prompt Dialog implementation
  function showCustomConfirm(message) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'custom-dialog-overlay';
      
      const box = document.createElement('div');
      box.className = 'custom-dialog-box';
      
      const msgEl = document.createElement('div');
      msgEl.className = 'custom-dialog-message';
      msgEl.innerText = message;
      
      const actions = document.createElement('div');
      actions.className = 'custom-dialog-actions';
      
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'custom-dialog-btn custom-dialog-btn-cancel';
      cancelBtn.innerText = '取消';
      
      const confirmBtn = document.createElement('button');
      confirmBtn.className = 'custom-dialog-btn custom-dialog-btn-confirm';
      confirmBtn.innerText = '确定';
      
      actions.appendChild(cancelBtn);
      actions.appendChild(confirmBtn);
      
      box.appendChild(msgEl);
      box.appendChild(actions);
      overlay.appendChild(box);
      document.body.appendChild(overlay);
      
      setTimeout(() => overlay.classList.add('show'), 10);
      
      cancelBtn.addEventListener('click', () => {
        overlay.classList.remove('show');
        setTimeout(() => {
          overlay.remove();
          resolve(false);
        }, 200);
      });
      
      confirmBtn.addEventListener('click', () => {
        overlay.classList.remove('show');
        setTimeout(() => {
          overlay.remove();
          resolve(true);
        }, 200);
      });
    });
  }

  function showCustomPrompt(message, defaultValue = '') {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'custom-dialog-overlay';
      
      const box = document.createElement('div');
      box.className = 'custom-dialog-box';
      
      const msgEl = document.createElement('div');
      msgEl.className = 'custom-dialog-message';
      msgEl.innerText = message;
      
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'custom-dialog-input';
      input.value = defaultValue;
      
      const actions = document.createElement('div');
      actions.className = 'custom-dialog-actions';
      
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'custom-dialog-btn custom-dialog-btn-cancel';
      cancelBtn.innerText = '取消';
      
      const confirmBtn = document.createElement('button');
      confirmBtn.className = 'custom-dialog-btn custom-dialog-btn-confirm';
      confirmBtn.innerText = '确定';
      
      actions.appendChild(cancelBtn);
      actions.appendChild(confirmBtn);
      
      box.appendChild(msgEl);
      box.appendChild(input);
      box.appendChild(actions);
      overlay.appendChild(box);
      document.body.appendChild(overlay);
      
      setTimeout(() => {
        overlay.classList.add('show');
        input.focus();
        input.select();
      }, 10);
      
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          confirmBtn.click();
        } else if (e.key === 'Escape') {
          cancelBtn.click();
        }
      });
      
      cancelBtn.addEventListener('click', () => {
        overlay.classList.remove('show');
        setTimeout(() => {
          overlay.remove();
          resolve(null);
        }, 200);
      });
      
      confirmBtn.addEventListener('click', () => {
        const val = input.value;
        overlay.classList.remove('show');
        setTimeout(() => {
          overlay.remove();
          resolve(val);
        }, 200);
      });
    });
  }

  // Custom Tooltip System
  const tooltipEl = document.createElement('div');
  tooltipEl.className = 'custom-tooltip';
  document.body.appendChild(tooltipEl);

  let tooltipTimeout = null;
  let activeTooltipTarget = null;

  document.addEventListener('mouseover', (e) => {
    const target = e.target.closest('[title], [data-tooltip]');
    if (!target) return;
    
    if (target.hasAttribute('title')) {
      const titleVal = target.getAttribute('title');
      if (titleVal && titleVal.trim()) {
        target.setAttribute('data-tooltip', titleVal);
        target.removeAttribute('title');
      } else {
        return;
      }
    }
    
    const text = target.getAttribute('data-tooltip');
    if (!text || !text.trim()) return;

    if (tooltipTimeout) clearTimeout(tooltipTimeout);
    
    activeTooltipTarget = target;

    tooltipTimeout = setTimeout(() => {
      if (activeTooltipTarget !== target) return;
      
      tooltipEl.innerText = text;
      
      const rect = target.getBoundingClientRect();
      
      tooltipEl.style.opacity = '0';
      tooltipEl.style.display = 'block';
      tooltipEl.classList.add('show');
      
      const tooltipWidth = tooltipEl.offsetWidth;
      const tooltipHeight = tooltipEl.offsetHeight;
      
      let top = rect.top - tooltipHeight - 8 + window.scrollY;
      let left = rect.left + (rect.width - tooltipWidth) / 2 + window.scrollX;
      
      if (top < window.scrollY + 5) {
        top = rect.bottom + 8 + window.scrollY;
      }
      if (left < 5) left = 5;
      if (left + tooltipWidth > window.innerWidth - 5) {
        left = window.innerWidth - tooltipWidth - 5;
      }
      
      tooltipEl.style.top = `${top}px`;
      tooltipEl.style.left = `${left}px`;
      tooltipEl.style.opacity = '1';
    }, 3000);
  });

  document.addEventListener('mouseout', (e) => {
    const target = e.target.closest('[data-tooltip]');
    if (target) {
      activeTooltipTarget = null;
      if (tooltipTimeout) clearTimeout(tooltipTimeout);
      tooltipEl.classList.remove('show');
      tooltipTimeout = setTimeout(() => {
        tooltipEl.style.display = 'none';
      }, 120);
    }
  });

  // Custom Context Menu System
  const contextMenuEl = document.createElement('div');
  contextMenuEl.className = 'custom-context-menu';
  document.body.appendChild(contextMenuEl);

  document.addEventListener('contextmenu', (e) => {
    if (e.target.closest('input, textarea')) {
      return;
    }
    
    e.preventDefault();
    hideContextMenu();
    
    const songItem = e.target.closest('.playlist-item, .drawer-playlist-item, .fs-queue-item');
    const cardItem = e.target.closest('.music-card');
    
    let menuHtml = '';
    
    if (songItem) {
      const idxStr = songItem.getAttribute('data-index');
      const index = idxStr !== null ? parseInt(idxStr, 10) : null;
      
      let track = null;
      if (index !== null && index >= 0 && index < currentPlaylist.length) {
        track = currentPlaylist[index];
      } else if (songItem.songData) {
        track = songItem.songData;
      }
      
      if (track) {
        menuHtml = `
          <div class="context-menu-item" id="ctx-play-song">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
            <span>立即播放</span>
          </div>
          <div class="context-menu-item" id="ctx-play-next">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M5 4l10 8-10 8V4zM19 5v14"></path></svg>
            <span>下一首播放</span>
          </div>
          <div class="context-menu-item" id="ctx-add-queue">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            <span>添加到队列末尾</span>
          </div>
          <div class="context-menu-divider"></div>
          <div class="context-menu-item" id="ctx-add-to-playlist">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 5v14M5 12h14"></path></svg>
            <span>添加到自建歌单...</span>
          </div>
        `;
        
        if (currentPlaylistId === 'temporary' || (typeof currentPlaylistId === 'string' && currentPlaylistId.startsWith('local_'))) {
          menuHtml += `
            <div class="context-menu-divider"></div>
            <div class="context-menu-item" id="ctx-remove-song" style="color: #ff2d55;">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              <span>从当前歌单中移除</span>
            </div>
          `;
        }
        
        setTimeout(() => {
          document.getElementById('ctx-play-song')?.addEventListener('click', () => {
            if (index !== null) {
              loadTrack(index);
              playAudio();
            } else {
              playSongNow(track);
            }
          });
          document.getElementById('ctx-play-next')?.addEventListener('click', () => {
            let songToInsert = track;
            if (index !== null) {
              songToInsert = currentPlaylist[index];
            } else {
              songToInsert = {
                id: track.id,
                name: track.name,
                artist: track.artists ? track.artists.map(a => a.name).join('/') : track.artist,
                url: track.url || `https://music.163.com/song/media/outer/url?id=${track.id}.mp3`,
                pic: track.album?.picUrl || track.pic || 'assets/default.svg',
                lrc: track.lrc || null
              };
            }
            currentPlaylist.splice(currentTrackIndex + 1, 0, songToInsert);
            localStorage.setItem('aura-custom-playlist', JSON.stringify(currentPlaylist));
            renderPlaylistSongs();
            showToast(`已将《${songToInsert.name}》设为下一首播放`);
          });
          document.getElementById('ctx-add-queue')?.addEventListener('click', () => {
            let songToAdd = track;
            if (index !== null) {
              songToAdd = currentPlaylist[index];
            } else {
              songToAdd = {
                id: track.id,
                name: track.name,
                artist: track.artists ? track.artists.map(a => a.name).join('/') : track.artist,
                url: track.url || `https://music.163.com/song/media/outer/url?id=${track.id}.mp3`,
                pic: track.album?.picUrl || track.pic || 'assets/default.svg',
                lrc: track.lrc || null
              };
            }
            currentPlaylist.push(songToAdd);
            localStorage.setItem('aura-custom-playlist', JSON.stringify(currentPlaylist));
            renderPlaylistSongs();
            showToast(`已将《${songToAdd.name}》添加到播放队列末尾`);
          });
          document.getElementById('ctx-add-to-playlist')?.addEventListener('click', () => {
            trackToAdd = track;
            openAddToPlaylistModal();
          });
          document.getElementById('ctx-remove-song')?.addEventListener('click', () => {
            if (index !== null) {
              removeFromPlaylist(index);
            }
          });
        }, 10);
      }
    } else if (cardItem) {
      const playlistId = cardItem.getAttribute('data-playlist-id');
      const songId = cardItem.getAttribute('data-song-id');
      
      if (playlistId) {
        menuHtml = `
          <div class="context-menu-item" id="ctx-play-playlist">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
            <span>立即播放该歌单</span>
          </div>
        `;
        setTimeout(() => {
          document.getElementById('ctx-play-playlist')?.addEventListener('click', () => {
            cardItem.click();
          });
        }, 10);
      } else if (songId) {
        menuHtml = `
          <div class="context-menu-item" id="ctx-play-song-card">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
            <span>立即播放该歌曲</span>
          </div>
        `;
        setTimeout(() => {
          document.getElementById('ctx-play-song-card')?.addEventListener('click', () => {
            cardItem.click();
          });
        }, 10);
      }
    }
    
    if (!menuHtml) {
      menuHtml = `
        <div class="context-menu-item" id="ctx-nav-now-playing">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
          <span>新发现</span>
        </div>
        <div class="context-menu-item" id="ctx-toggle-theme">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line></svg>
          <span>切换界面主题</span>
        </div>
        <div class="context-menu-divider"></div>
        <div class="context-menu-item" id="ctx-reload">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path></svg>
          <span>重新加载页面</span>
        </div>
      `;
      setTimeout(() => {
        document.getElementById('ctx-nav-now-playing')?.addEventListener('click', () => {
          document.querySelector('.sidebar .nav-item[data-tab="browse"]')?.click();
        });
        document.getElementById('ctx-toggle-theme')?.addEventListener('click', () => {
          themeToggleBtn?.click();
        });
        document.getElementById('ctx-reload')?.addEventListener('click', () => {
          window.location.reload();
        });
      }, 10);
    }
    
    contextMenuEl.innerHTML = menuHtml;
    contextMenuEl.style.display = 'block';
    
    const menuWidth = contextMenuEl.offsetWidth;
    const menuHeight = contextMenuEl.offsetHeight;
    
    let x = e.clientX + window.scrollX;
    let y = e.clientY + window.scrollY;
    
    if (e.clientX + menuWidth > window.innerWidth) {
      x = e.clientX - menuWidth + window.scrollX;
    }
    if (e.clientY + menuHeight > window.innerHeight) {
      y = e.clientY - menuHeight + window.scrollY;
    }
    
    contextMenuEl.style.left = `${x}px`;
    contextMenuEl.style.top = `${y}px`;
    
    setTimeout(() => {
      contextMenuEl.classList.add('show');
    }, 10);
  });

  function hideContextMenu() {
    contextMenuEl.classList.remove('show');
    setTimeout(() => {
      contextMenuEl.style.display = 'none';
    }, 150);
  }

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.custom-context-menu')) {
      hideContextMenu();
    }
  });

  // ==========================================
  // 9. Bootstrap App
  // ==========================================
  
  // Initialize Media Session SMTC Handlers
  initMediaSessionHandlers();

  // Keyboard Shortcuts Listener
  document.addEventListener('keydown', (e) => {
    // Skip if user is focusing an input, textarea, or contenteditable element
    const activeEl = document.activeElement;
    if (activeEl && (
      activeEl.tagName === 'INPUT' || 
      activeEl.tagName === 'TEXTAREA' || 
      activeEl.isContentEditable
    )) {
      return;
    }
    
    switch (e.code) {
      case 'Space':
        e.preventDefault();
        togglePlay();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        audio.currentTime = Math.max(audio.currentTime - 5, 0);
        updateMediaSessionPositionState();
        break;
      case 'ArrowRight':
        e.preventDefault();
        audio.currentTime = Math.min(audio.currentTime + 5, audio.duration || 0);
        updateMediaSessionPositionState();
        break;
      case 'ArrowUp':
        e.preventDefault();
        const currentVolUp = Math.round(audio.volume * 100);
        updateVolume(Math.min(currentVolUp + 5, 100), true);
        break;
      case 'ArrowDown':
        e.preventDefault();
        const currentVolDown = Math.round(audio.volume * 100);
        updateVolume(Math.max(currentVolDown - 5, 0), true);
        break;
      case 'KeyM':
        e.preventDefault();
        toggleMute();
        break;
      case 'KeyL':
        e.preventDefault();
        const lyricsToggleBtn = document.getElementById('player-lyrics-toggle');
        if (lyricsToggleBtn) lyricsToggleBtn.click();
        break;
      default:
        break;
    }
  });

  // Initialize Equalizer UI
  initEqualizerUI();

  // Initialize Settings Modal UI
  initSettingsUI();

  async function loadFeaturedSongs() {
    try {
      const response = await fetch(getApiUrl('/api/playlist?id=3778678&platform=netease'));
      if (!response.ok) throw new Error('Failed to fetch featured songs');
      const data = await response.json();
      if (Array.isArray(data) && data.length > 0) {
        const top7 = data.slice(0, 7);
        const grid = document.querySelector('.new-songs-grid');
        if (grid) {
          grid.innerHTML = '';
          for (let colIdx = 0; colIdx < 4; colIdx++) {
            const column = document.createElement('div');
            column.className = 'new-songs-column';
            
            for (let rowIdx = 0; rowIdx < 2; rowIdx++) {
              const songIdx = rowIdx * 4 + colIdx;
              if (songIdx === 7) {
                // Render "打开本地音乐文件" card
                const item = document.createElement('div');
                item.className = 'new-song-item local-file-trigger-card';
                item.innerHTML = `
                  <div class="new-song-cover-wrap" style="display: flex; align-items: center; justify-content: center; background: rgba(255, 255, 255, 0.05); border: 1px dashed rgba(255, 255, 255, 0.15); position: relative;">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 20px; height: 20px; color: var(--color-accent);">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                      <polyline points="14 2 14 8 20 8"></polyline>
                      <line x1="12" y1="18" x2="12" y2="12"></line>
                      <line x1="9" y1="15" x2="15" y2="15"></line>
                    </svg>
                    <div class="new-song-play-overlay">
                      <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                    </div>
                  </div>
                  <div class="new-song-info">
                    <span class="new-song-title">打开本地音乐文件</span>
                    <span class="new-song-artist">导入本地单曲进行播放</span>
                  </div>
                `;
                item.addEventListener('click', () => {
                  localAudioFile.click();
                });
                column.appendChild(item);
              } else if (songIdx < top7.length) {
                const track = top7[songIdx];
                const item = document.createElement('div');
                item.className = 'new-song-item';
                item.setAttribute('data-song-id', track.id);
                item.setAttribute('data-song-name', track.name);
                item.setAttribute('data-song-artist', track.artist);
                item.setAttribute('data-song-pic', track.pic);
                
                item.innerHTML = `
                  <div class="new-song-cover-wrap">
                    <img class="new-song-cover" src="${getHdCoverUrl(track.pic)}" onerror="this.onerror=null; this.src='assets/default.svg';" alt="" loading="lazy">
                    <div class="new-song-play-overlay">
                      <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                    </div>
                  </div>
                  <div class="new-song-info">
                    <span class="new-song-title">${track.name}</span>
                    <span class="new-song-artist">${track.artist}</span>
                  </div>
                `;
                
                item.addEventListener('click', () => {
                  playSongById(track.id, track.name, track.artist, track.pic, 'netease');
                });
                column.appendChild(item);
              }
            }
            grid.appendChild(column);
          }
        }
      }
    } catch (err) {
      console.error('Error loading featured songs from NetEase Hot List:', err);
    }
  }

  initPreferences();
  loadFeaturedSongs();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
