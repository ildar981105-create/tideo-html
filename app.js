/* ==========================================
   FrameX App — JavaScript
   ========================================== */

// --- Smart Input: 意图识别 ---
(function initSmartInput() {
    const input = document.getElementById('smartInput');
    const sendBtn = document.getElementById('sendBtn');
    const uploadTrigger = document.getElementById('uploadTrigger');
    const fileInput = document.getElementById('fileInput');

    if (!input) return;

    function detectIntent(text) {
        text = text.trim().toLowerCase();
        // 直播链接检测
        if (text.match(/https?:\/\/.*(live|stream|直播|douyin|bilibili|taobao|kuaishou)/i) || text.includes('直播')) {
            return 'livestream';
        }
        // 生成视频意图
        if (text.match(/(生成|创建|制作|画|做一个|文生|图生)/)) {
            return 'generate';
        }
        // 默认视频译制
        return 'translate';
    }

    function handleSend() {
        const text = input.value.trim();
        if (!text) return;
        const intent = detectIntent(text);
        const routes = {
            translate: 'translate-v8.html',
            livestream: 'livestream.html',
            generate: 'generate.html'
        };
        // 将用户输入带到目标页面
        const url = new URL(routes[intent], window.location.href);
        url.searchParams.set('input', text);
        window.location.href = url.toString();
    }

    sendBtn.addEventListener('click', handleSend);
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') handleSend();
    });

    // 上传按钮
    if (uploadTrigger && fileInput) {
        uploadTrigger.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', () => {
            if (fileInput.files.length > 0) {
                window.location.href = 'translate-v8.html?file=selected';
            }
        });
    }
})();

// --- Drag & Drop ---
(function initDragDrop() {
    const overlay = document.getElementById('dropOverlay');
    const entry = document.querySelector('.agent-entry') || document.querySelector('.upload-zone');
    if (!overlay || !entry) return;

    let dragCounter = 0;
    document.addEventListener('dragenter', e => {
        e.preventDefault();
        dragCounter++;
        overlay.classList.add('active');
    });
    document.addEventListener('dragleave', e => {
        e.preventDefault();
        dragCounter--;
        if (dragCounter <= 0) { overlay.classList.remove('active'); dragCounter = 0; }
    });
    document.addEventListener('dragover', e => e.preventDefault());
    document.addEventListener('drop', e => {
        e.preventDefault();
        overlay.classList.remove('active');
        dragCounter = 0;
        if (e.dataTransfer.files.length > 0) {
            window.location.href = 'translate-v8.html?file=dropped';
        }
    });
})();

// --- Upload Zone specific ---
(function initUploadZone() {
    const zone = document.querySelector('.upload-zone');
    if (!zone) return;
    const fileInput = zone.querySelector('input[type="file"]') || document.getElementById('videoFileInput');
    
    zone.addEventListener('click', () => {
        if (fileInput) fileInput.click();
    });
    zone.addEventListener('dragover', e => {
        e.preventDefault();
        zone.classList.add('drag-over');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => {
        e.preventDefault();
        zone.classList.remove('drag-over');
        showProcessing();
    });
    if (fileInput) {
        fileInput.addEventListener('change', () => {
            if (fileInput.files.length > 0) showProcessing();
        });
    }
})();

// --- Fullscreen Work Mode ---
function enterFullscreenMode() {
    document.body.classList.add('fullscreen-mode');
    // 隐藏生成页的模式切换和 prompt 区域
    const genTabs = document.querySelector('.gen-mode-tabs');
    const promptArea = document.querySelector('.prompt-area');
    const imgGrid = document.querySelector('.img-upload-grid');
    if (genTabs) genTabs.style.display = 'none';
    if (promptArea) promptArea.style.display = 'none';
    if (imgGrid) imgGrid.style.display = 'none';
}

function exitFullscreenMode() {
    document.body.classList.remove('fullscreen-mode');
}

// --- Back Button ---
(function initBackButton() {
    const btn = document.querySelector('.back-to-nav');
    if (!btn) return;
    btn.addEventListener('click', () => {
        exitFullscreenMode();
        // 返回 Dashboard
        window.location.href = 'create.html';
    });
})();

// --- Processing Simulation ---
function showProcessing() {
    const uploadZone = document.querySelector('.upload-zone');
    const configPanel = document.querySelector('.config-panel');
    const stepCards = document.querySelector('.step-cards');
    const startBtn = document.querySelector('.start-btn-wrap');
    const videoSection = document.querySelector('.video-preview-section');
    const liveSection = document.querySelector('.live-input-section');

    if (uploadZone) uploadZone.style.display = 'none';
    if (configPanel) configPanel.style.display = 'none';
    if (stepCards) stepCards.style.display = 'none';
    if (startBtn) startBtn.style.display = 'none';
    if (liveSection) liveSection.style.display = 'none';

    // 进入全屏工作模式
    enterFullscreenMode();

    if (videoSection) {
        videoSection.style.display = '';
        videoSection.style.removeProperty('display');
        animatePipeline();
    }
}

function animatePipeline() {
    const steps = document.querySelectorAll('.pipe-step');
    if (!steps.length) return;
    let current = 0;
    function nextStep() {
        if (current >= steps.length) return;
        steps.forEach(s => s.classList.remove('active'));
        if (current > 0) steps[current - 1].classList.add('completed');
        steps[current].classList.add('active');
        current++;
        if (current < steps.length) {
            setTimeout(nextStep, 3000);
        } else {
            setTimeout(() => {
                steps[current - 1].classList.remove('active');
                steps[current - 1].classList.add('completed');
                // Hide loading, show mock player
                const loading = document.querySelector('.video-loading');
                const mockPlayer = document.querySelector('.mock-player');
                if (loading) loading.style.display = 'none';
                if (mockPlayer) {
                    mockPlayer.style.display = 'block';
                    initMockCanvas();
                    startMockPlayback();
                }
                // Show toolbar actions
                const toolbarActions = document.querySelector('.toolbar-actions');
                if (toolbarActions) toolbarActions.style.display = 'flex';
            }, 2000);
        }
    }
    nextStep();
}

// --- Mock Canvas Video Renderer ---
let mockAnimFrame = null;
let mockPlaying = true;
let mockTime = 0;
const mockDuration = 154; // 2:34

function initMockCanvas() {
    const canvas = document.getElementById('mockCanvas');
    if (!canvas) return;
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width * (window.devicePixelRatio || 1);
    canvas.height = rect.height * (window.devicePixelRatio || 1);
    const ctx = canvas.getContext('2d');
    ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
}

function drawMockFrame(t) {
    const canvas = document.getElementById('mockCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width / (window.devicePixelRatio || 1);
    const h = canvas.height / (window.devicePixelRatio || 1);
    ctx.clearRect(0, 0, w, h);

    // Animated gradient background simulating a video scene
    const hue1 = (t * 8) % 360;
    const hue2 = (hue1 + 60) % 360;
    const grd = ctx.createLinearGradient(0, 0, w, h);
    grd.addColorStop(0, `hsl(${hue1}, 35%, 12%)`);
    grd.addColorStop(0.5, `hsl(${hue2}, 30%, 16%)`);
    grd.addColorStop(1, `hsl(${hue1 + 120}, 25%, 10%)`);
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, w, h);

    // Simulated person silhouette (centered)
    const cx = w * 0.5;
    const cy = h * 0.42;
    ctx.save();
    ctx.globalAlpha = 0.25;
    // Head
    ctx.beginPath();
    ctx.arc(cx, cy - 30, 28, 0, Math.PI * 2);
    ctx.fillStyle = `hsl(${hue1 + 180}, 20%, 30%)`;
    ctx.fill();
    // Body
    ctx.beginPath();
    ctx.ellipse(cx, cy + 30, 36, 50, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();

    // Subtle floating particles
    ctx.globalAlpha = 0.15;
    for (let i = 0; i < 12; i++) {
        const px = (Math.sin(t * 0.3 + i * 1.7) * 0.4 + 0.5) * w;
        const py = (Math.cos(t * 0.2 + i * 2.3) * 0.4 + 0.5) * h;
        const r = 1.5 + Math.sin(t + i) * 1;
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fillStyle = '#a78bfa';
        ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Timecode overlay (top-right)
    const mins = Math.floor(t) / 60 | 0;
    const secs = Math.floor(t) % 60;
    ctx.font = '500 11px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.textAlign = 'right';
    ctx.fillText(`REC ${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`, w - 16, 24);
    ctx.textAlign = 'left';
}

function startMockPlayback() {
    mockTime = 0;
    mockPlaying = true;
    const playBtn = document.getElementById('ctrlPlay');
    if (playBtn) playBtn.classList.add('playing');

    function tick() {
        if (mockPlaying) {
            mockTime += 1 / 60;
            if (mockTime >= mockDuration) mockTime = 0;
        }
        drawMockFrame(mockTime);
        updatePlayerUI();
        mockAnimFrame = requestAnimationFrame(tick);
    }
    tick();
}

function updatePlayerUI() {
    const pct = (mockTime / mockDuration) * 100;
    const fill = document.getElementById('ctrlProgressFill');
    const handle = document.getElementById('ctrlProgressHandle');
    const timeEl = document.getElementById('ctrlTime');
    if (fill) fill.style.width = pct + '%';
    if (handle) handle.style.left = pct + '%';
    if (timeEl) {
        const m = Math.floor(mockTime / 60);
        const s = Math.floor(mockTime % 60);
        timeEl.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    }
    // Sync erase playhead
    const erasePh = document.getElementById('eraseTlPlayhead');
    if (erasePh) erasePh.style.left = pct + '%';
}

// Play/Pause toggle
(function initPlayToggle() {
    document.addEventListener('click', e => {
        const btn = e.target.closest('#ctrlPlay');
        if (!btn) return;
        mockPlaying = !mockPlaying;
        btn.classList.toggle('playing', mockPlaying);
    });
})();

// Click on progress bar to seek
(function initProgressSeek() {
    document.addEventListener('click', e => {
        const track = e.target.closest('.ctrl-progress');
        if (!track) return;
        const rect = track.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        mockTime = pct * mockDuration;
        updatePlayerUI();
    });
})();

// Erase panel: show overlay on video when panel opens
(function initEraseOverlay() {
    const observer = new MutationObserver(() => {
        const panel = document.getElementById('panelErase');
        const overlay = document.querySelector('.mock-erase-overlay');
        if (!panel || !overlay) return;
        overlay.style.display = panel.classList.contains('visible') ? 'block' : 'none';
    });
    // Observe after DOM ready
    setTimeout(() => {
        const panel = document.getElementById('panelErase');
        if (panel) observer.observe(panel, { attributes: true, attributeFilter: ['class'] });
    }, 100);
})();

// --- Start Button ---
(function initStartBtn() {
    const btn = document.querySelector('.btn-start');
    if (!btn) return;
    btn.addEventListener('click', showProcessing);
})();

// --- Float Panel Toggle ---
(function initFloatPanels() {
    document.querySelectorAll('.toolbar-btn[data-panel]').forEach(btn => {
        btn.addEventListener('click', () => {
            const panelId = btn.getAttribute('data-panel');
            const panel = document.getElementById(panelId);
            if (!panel) return;
            document.querySelectorAll('.float-panel').forEach(p => {
                if (p.id !== panelId) p.classList.remove('visible');
            });
            panel.classList.toggle('visible');
        });
    });
    document.querySelectorAll('.panel-close').forEach(btn => {
        btn.addEventListener('click', () => {
            btn.closest('.float-panel').classList.remove('visible');
        });
    });
})();

// --- Gen Mode Tabs ---
(function initGenTabs() {
    const tabs = document.querySelectorAll('.gen-tab');
    const textArea = document.querySelector('.prompt-area');
    const imgArea = document.querySelector('.img-upload-grid');
    
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const mode = tab.getAttribute('data-mode');
            if (mode === 'text') {
                if (textArea) textArea.style.display = 'block';
                if (imgArea) imgArea.style.display = 'none';
            } else {
                if (textArea) textArea.style.display = 'block';
                if (imgArea) imgArea.style.display = 'flex';
            }
        });
    });
})();

// --- Sidebar active state ---
(function initSidebarActive() {
    const currentPage = window.location.pathname.split('/').pop() || 'create.html';
    const subPages = ['translate-v8.html', 'livestream-v3.html', 'generate.html'];
    const isSubPage = subPages.some(p => currentPage === p);

    // 只处理主导航区域的导航项（创作/素材/作品，排除底部 API/主题切换等）
    const navItems = document.querySelectorAll('.icon-nav > .icon-nav-item');
    if (!navItems.length) return;

    // 先找出应该 active 的项
    let matched = null;
    navItems.forEach(item => {
        const href = item.getAttribute('href');
        if (!href) return;
        const hrefPage = href.split('?')[0];

        if (isSubPage && hrefPage === 'create.html') {
            matched = item;
        }
        if (hrefPage === currentPage || (currentPage === '' && hrefPage === 'create.html')) {
            matched = item;
        }
    });

    // 只在有匹配时才更新，避免误清 HTML 中的默认 active
    if (matched) {
        navItems.forEach(item => item.classList.remove('active'));
        matched.classList.add('active');
    }
})();

// --- Read URL params ---
(function initUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const inputVal = params.get('input');
    if (inputVal) {
        // Pre-fill relevant input
        const smartInput = document.getElementById('smartInput');
        const liveInput = document.querySelector('.live-input input');
        const promptInput = document.querySelector('.prompt-input');
        if (smartInput) smartInput.value = inputVal;
        if (liveInput) liveInput.value = inputVal;
        if (promptInput) promptInput.value = inputVal;
    }
})();

// --- Step Card Toggles ---
(function initStepToggles() {
    const toggles = document.querySelectorAll('[data-step-toggle]');
    toggles.forEach(toggle => {
        toggle.addEventListener('change', () => {
            const stepName = toggle.getAttribute('data-step-toggle');
            const card = toggle.closest('.step-card');
            if (!card) return;
            if (toggle.checked) {
                card.classList.add('step-card--active');
                card.classList.remove('step-card--disabled');
            } else {
                card.classList.remove('step-card--active');
                card.classList.add('step-card--disabled');
            }
            updatePipelineSteps();
        });
    });

    function updatePipelineSteps() {
        const stepMap = { erase: 0, subtitle: 1, voice: 2 };
        const pipeSteps = document.querySelectorAll('.pipe-step');
        toggles.forEach(toggle => {
            const name = toggle.getAttribute('data-step-toggle');
            const idx = stepMap[name];
            if (idx !== undefined && pipeSteps[idx]) {
                pipeSteps[idx].style.display = toggle.checked ? 'flex' : 'none';
            }
        });
    }
})();

// --- Erase Region Editor ---
(function initEraseRegionEditor() {
    const modeSelect = document.getElementById('eraseModeSelect');
    const editor = document.getElementById('eraseRegionEditor');
    const regionList = document.getElementById('eraseRegionList');
    const addBtn = document.getElementById('addEraseRegion');
    if (!modeSelect || !editor) return;

    let regionCount = 1;

    modeSelect.addEventListener('change', () => {
        editor.style.display = modeSelect.value === 'manual' ? 'block' : 'none';
    });

    function createRegionRow(idx) {
        const row = document.createElement('div');
        row.className = 'erase-region-row';
        row.dataset.region = idx;
        row.innerHTML = `
            <span class="erase-region-row__label">${idx + 1}</span>
            <div class="config-field"><label>X</label><input type="text" value="8%"></div>
            <div class="config-field"><label>Y</label><input type="text" value="82%"></div>
            <div class="config-field"><label>宽</label><input type="text" value="84%"></div>
            <div class="config-field"><label>高</label><input type="text" value="12%"></div>
            <button class="erase-region-row__delete" title="删除">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 3L9 9M9 3L3 9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
            </button>
        `;
        row.querySelector('.erase-region-row__delete').addEventListener('click', () => {
            row.remove();
            renumberRegions();
        });
        return row;
    }

    function renumberRegions() {
        const rows = regionList.querySelectorAll('.erase-region-row');
        rows.forEach((row, i) => {
            row.dataset.region = i;
            row.querySelector('.erase-region-row__label').textContent = i + 1;
        });
        regionCount = rows.length;
    }

    // Wire up initial delete button
    regionList.querySelectorAll('.erase-region-row__delete').forEach(btn => {
        btn.addEventListener('click', () => {
            btn.closest('.erase-region-row').remove();
            renumberRegions();
        });
    });

    if (addBtn) {
        addBtn.addEventListener('click', () => {
            const row = createRegionRow(regionCount);
            regionList.appendChild(row);
            regionCount++;
        });
    }
})();
