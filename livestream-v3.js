// livestream-v3.js — 直播剪辑（精调直入版）
(function(){
'use strict';

/* ===== State ===== */
let clips = [];
let clipIdCounter = 0;
let inPoint = null, outPoint = null;
let hlsInstance = null;
let videoUrl = '';
let recStartTime = 0;
let liveElapsed = 0;    // 直播已进行秒数（从进入页面起持续递增）
let liveTickTimer = null;
let selectedClipId = -1;

/* ===== Elements ===== */
const liveVideo = document.getElementById('liveVideo');
const previewVideo = document.getElementById('previewVideo');
const recTimerEl = document.getElementById('recTimer');
const tlTimeEl = document.getElementById('tlTime');
const playBtn = document.getElementById('playBtn');
const btnIn = document.getElementById('btnIn');
const btnOut = document.getElementById('btnOut');
const btnGen = document.getElementById('btnGen');
const clipList = document.getElementById('clipList');
const clipEmpty = document.getElementById('clipEmpty');
const clipsSub = document.getElementById('clipsSub');
const exportBtn = document.getElementById('exportBtn');
const volSlider = document.getElementById('volSlider');

/* ===== Utils ===== */
function fmt(s){
    if(!s||!isFinite(s)) s=0;
    s=Math.max(0,Math.floor(s));
    var h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=s%60;
    return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':'+String(sec).padStart(2,'0');
}
function fmtShort(s){
    if(!s||!isFinite(s)) s=0;
    s=Math.max(0,Math.floor(s));
    var m=Math.floor(s/60),sec=s%60;
    return m+':'+String(sec).padStart(2,'0');
}

/* ===== Video Loading ===== */
var flvPlayer = null;

function loadVideo(url){
    videoUrl = url;
    // 清理旧实例
    if(hlsInstance){ hlsInstance.destroy(); hlsInstance = null; }
    if(flvPlayer){ flvPlayer.destroy(); flvPlayer = null; }

    var isHLS = /\.m3u8/i.test(url);
    var isFLV = /\.flv/i.test(url);

    if(isHLS && typeof Hls !== 'undefined' && Hls.isSupported()){
        // === HLS 直播流（m3u8）===
        hlsInstance = new Hls({ enableWorker:true, liveSyncDurationCount:3 });
        hlsInstance.loadSource(url);
        hlsInstance.attachMedia(liveVideo);
        hlsInstance.on(Hls.Events.MANIFEST_PARSED, function(){
            liveVideo.play().catch(function(){});
        });
        hlsInstance.on(Hls.Events.ERROR, function(e, data){
            if(data.fatal) console.error('HLS 错误:', data.details);
        });
    } else if(isFLV && typeof flvjs !== 'undefined' && flvjs.isSupported()){
        // === FLV 直播流 ===
        flvPlayer = flvjs.createPlayer({
            type: 'flv',
            url: url,
            isLive: true,
            hasAudio: true,
            hasVideo: true
        }, {
            enableWorker: true,
            enableStashBuffer: false,
            stashInitialSize: 128
        });
        flvPlayer.attachMediaElement(liveVideo);
        flvPlayer.load();
        flvPlayer.play();
    } else {
        // === 普通视频/流地址 ===
        liveVideo.src = url;
        liveVideo.load();
        liveVideo.onloadeddata = function(){
            liveVideo.play().catch(function(){});
        };
        liveVideo.onerror = function(){
            console.error('视频加载失败，请确认是可直接访问的流地址 (m3u8/flv/mp4)');
        };
    }

    // 视频开始播放 → 启动直播计时
    liveVideo.addEventListener('playing', function onFirstPlay(){
        recStartTime = liveVideo.currentTime;
        startLiveTick();
        liveVideo.removeEventListener('playing', onFirstPlay);
    });
}

/* ===== Time Helpers ===== */
function getCurTime(){ return liveVideo ? (liveVideo.currentTime || 0) : 0; }
function getLiveLength(){ return liveElapsed; }
// 可 seek 的最大秒数（取 liveElapsed 和视频实际可用时长的较小值）
function getMaxSeekSec(){
    var dur = liveVideo ? liveVideo.duration : 0;
    if(dur && isFinite(dur)){
        return Math.min(liveElapsed, dur - recStartTime);
    }
    return liveElapsed;
}

/* ===== Live Elapsed Timer（独立计时，不受 seek 影响） ===== */
function startLiveTick(){
    if(liveTickTimer) return;
    liveTickTimer = setInterval(function(){ liveElapsed++; }, 1000);
}
// getRecElapsed 已被 liveElapsed 替代

/* ===== Volume ===== */
liveVideo.volume = 0;
volSlider.addEventListener('input', function(){ liveVideo.volume = +this.value; liveVideo.muted = (+this.value === 0); });

/* ===== Preview Controls ===== */
var pvPlayBtn = document.getElementById('pvPlayBtn');
var pvVolSlider = document.getElementById('pvVolSlider');
var pvTimeEl = document.getElementById('pvTime');
var pvCtrl = document.getElementById('pvCtrl');

pvPlayBtn.addEventListener('click', function(){
    if(previewVideo.paused) previewVideo.play().catch(function(){});
    else previewVideo.pause();
});
previewVideo.addEventListener('play', function(){ pvPlayBtn.classList.add('playing'); });
previewVideo.addEventListener('pause', function(){ pvPlayBtn.classList.remove('playing'); });

pvVolSlider.addEventListener('input', function(){ previewVideo.volume = +this.value; });
previewVideo.volume = 0.5;

// 预览时间更新
previewVideo.addEventListener('timeupdate', function(){
    if(pvTimeEl) pvTimeEl.textContent = fmtShort(previewVideo.currentTime);
});

/* ===== Play/Pause ===== */
playBtn.addEventListener('click', togglePlay);
function togglePlay(){
    if(liveVideo.paused) liveVideo.play();
    else liveVideo.pause();
}
liveVideo.addEventListener('play', function(){ playBtn.classList.add('playing'); });
liveVideo.addEventListener('pause', function(){ playBtn.classList.remove('playing'); });

/* ===== Timer Update ===== */
setInterval(function(){
    recTimerEl.textContent = fmt(liveElapsed);
    tlTimeEl.textContent = fmtShort(getCurTime()) + ' / ' + fmtShort(liveElapsed);
    renderPlayhead();
    renderRuler();
}, 250);

/* ===== In/Out Points ===== */
btnIn.addEventListener('click', setInPoint);
btnOut.addEventListener('click', setOutPoint);
btnGen.addEventListener('click', generateClip);

function setInPoint(){
    inPoint = getCurTime();
    outPoint = null;
    btnIn.textContent = '入点 ' + fmtShort(inPoint);
    btnIn.classList.add('active');
    btnOut.textContent = '出点 [O]';
    btnOut.classList.remove('active');
    btnGen.disabled = true;
    renderClipTrack();
}

function setOutPoint(){
    if(inPoint === null) return;
    var t = getCurTime();
    if(t <= inPoint) return;
    outPoint = t;
    btnOut.textContent = '出点 ' + fmtShort(outPoint);
    btnOut.classList.add('active');
    btnGen.disabled = false;
    renderClipTrack();
}

function generateClip(){
    if(inPoint === null || outPoint === null || outPoint <= inPoint) return;
    clipIdCounter++;
    var clip = {
        id: clipIdCounter,
        startSec: inPoint,
        endSec: outPoint,
        name: '片段 ' + clipIdCounter,
        dur: outPoint - inPoint
    };
    clips.push(clip);

    // Reset
    inPoint = null; outPoint = null;
    btnIn.textContent = '入点 [I]'; btnIn.classList.remove('active');
    btnOut.textContent = '出点 [O]'; btnOut.classList.remove('active');
    btnGen.disabled = true;

    renderClipList();
    renderClipTrack();
    exportBtn.disabled = false;
}

/* ===== Timeline Constants ===== */
var PX_PER_SEC = 8;
var MIN_CONTENT_WIDTH = 800;

/* ===== Render Playhead & Live Track ===== */
function getContentWidth(){
    // 直播模式：时间轴宽度 = 已直播时长 + 30s 前瞻缓冲
    return Math.max(MIN_CONTENT_WIDTH, Math.ceil((liveElapsed + 30) * PX_PER_SEC));
}

var _isDragging = false; // 全局拖拽状态，renderPlayhead 检查用

function renderPlayhead(){
    var content = document.getElementById('trkContent');
    var scroll = document.getElementById('trkScroll');
    if(!content || !scroll) return;

    var contentW = getContentWidth();
    content.style.width = contentW + 'px';

    // 色块 = 直播已经过的时长
    var livePx = liveElapsed * PX_PER_SEC;
    var played = document.getElementById('trkPlayed');
    if(played) played.style.width = livePx + 'px';

    // 播放头竖线 — 拖拽中不更新（由拖拽逻辑控制）
    if(!_isDragging){
        var curPx = getCurTime() * PX_PER_SEC;
        var ph = document.getElementById('tlPlayhead');
        if(ph) ph.style.left = curPx + 'px';
    }

    // 自动滚动
    if(isAtLive && livePx > scroll.scrollLeft + scroll.clientWidth - 60){
        scroll.scrollLeft = livePx - scroll.clientWidth + 100;
    }
}

/* ===== Render Time Ruler ===== */
function renderRuler(){
    var ruler = document.getElementById('trkRuler');
    if(!ruler) return;
    var contentW = getContentWidth();
    var totalSec = contentW / PX_PER_SEC;
    var interval = 10;
    if(totalSec > 300) interval = 30;
    if(totalSec > 600) interval = 60;

    var html = '';
    for(var s = 0; s <= totalSec; s += interval){
        var left = s * PX_PER_SEC;
        var m = Math.floor(s/60), sec = s%60;
        var label = m + ':' + String(sec).padStart(2,'0');
        html += '<div class="ls-trk-tick" style="left:'+left+'px"><span>'+label+'</span></div>';
    }
    ruler.innerHTML = html;
}

/* ===== Render Clip Track ===== */
function renderClipTrack(){
    var bar = document.getElementById('trkClipRow');
    if(!bar) return;
    var html = '';

    // Existing clips
    clips.forEach(function(c){
        var l = c.startSec * PX_PER_SEC;
        var w = (c.endSec - c.startSec) * PX_PER_SEC;
        var isActive = c.id === selectedClipId;
        html += '<div class="ls-trk-seg ls-trk-seg--clip'+(isActive?' active':'')+'" data-cid="'+c.id+'" style="left:'+l+'px;width:'+Math.max(w,4)+'px" title="'+c.name+'">'+c.name+'</div>';
    });

    // In/out markers
    if(inPoint !== null){
        html += '<div class="ls-trk-inpoint" style="left:'+(inPoint*PX_PER_SEC)+'px"></div>';
    }
    if(outPoint !== null){
        html += '<div class="ls-trk-outpoint" style="left:'+(outPoint*PX_PER_SEC)+'px"></div>';
    }
    if(inPoint !== null && outPoint !== null && outPoint > inPoint){
        var sl = inPoint*PX_PER_SEC, sw = (outPoint-inPoint)*PX_PER_SEC;
        html += '<div class="ls-trk-selection" style="left:'+sl+'px;width:'+sw+'px"></div>';
    }

    bar.innerHTML = html;

    // Click handlers for segments
    bar.querySelectorAll('[data-cid]').forEach(function(seg){
        seg.addEventListener('click', function(e){
            e.stopPropagation();
            previewClip(parseInt(seg.dataset.cid));
        });
    });
}

/* (点击 seek 已移到 tracksArea 统一处理) */

/* ===== Render Clip List ===== */
function renderClipList(){
    clipsSub.textContent = clips.length > 0 ? ('共 ' + clips.length + ' 个片段') : '标记入点和出点生成剪辑片段';

    if(clips.length === 0){
        clipEmpty.style.display = '';
        clipList.querySelectorAll('.ls-clip').forEach(function(el){ el.remove(); });
        return;
    }
    clipEmpty.style.display = 'none';

    // Rebuild list
    var existing = clipList.querySelectorAll('.ls-clip');
    existing.forEach(function(el){ el.remove(); });

    clips.forEach(function(c){
        var div = document.createElement('div');
        div.className = 'ls-clip' + (c.id === selectedClipId ? ' active' : '');
        div.dataset.cid = c.id;
        div.innerHTML =
            '<span class="ls-clip-num">' + c.id + '</span>' +
            '<div class="ls-clip-info">' +
                '<div class="ls-clip-name">' + c.name + '</div>' +
                '<div class="ls-clip-meta">' + fmtShort(c.startSec) + ' → ' + fmtShort(c.endSec) + '</div>' +
            '</div>' +
            '<span class="ls-clip-dur">' + fmtShort(c.dur) + '</span>' +
            '<div class="ls-clip-acts">' +
                '<button class="ls-clip-btn" data-play="'+c.id+'" title="预览"><svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M3 1.5L10 6L3 10.5V1.5Z" fill="currentColor"/></svg></button>' +
                '<button class="ls-clip-btn ls-clip-btn--del" data-del="'+c.id+'" title="删除"><svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M3 3L9 9M9 3L3 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>' +
            '</div>';

        div.addEventListener('click', function(e){
            if(e.target.closest('[data-del]')) return;
            previewClip(c.id);
        });
        clipList.appendChild(div);
    });

    // Play handlers
    clipList.querySelectorAll('[data-play]').forEach(function(btn){
        btn.addEventListener('click', function(e){
            e.stopPropagation();
            previewClip(parseInt(btn.dataset.play));
        });
    });

    // Delete handlers
    clipList.querySelectorAll('[data-del]').forEach(function(btn){
        btn.addEventListener('click', function(e){
            e.stopPropagation();
            var id = parseInt(btn.dataset.del);
            clips = clips.filter(function(c){ return c.id !== id; });
            if(selectedClipId === id) selectedClipId = -1;
            renderClipList();
            renderClipTrack();
            if(clips.length === 0) exportBtn.disabled = true;
        });
    });
}

/* ===== Preview Clip ===== */
var _previewReady = false;
var _previewHls = null;
var _previewFlv = null;

function previewClip(id){
    var clip = clips.find(function(c){ return c.id === id; });
    if(!clip) return;
    selectedClipId = id;

    clipList.querySelectorAll('.ls-clip').forEach(function(el){
        el.classList.toggle('active', parseInt(el.dataset.cid) === id);
    });
    renderClipTrack();

    document.getElementById('previewLabel').style.display = '';
    document.getElementById('previewEmpty').style.display = 'none';
    pvCtrl.style.display = '';

    var pv = previewVideo;
    var pvCanvas = document.getElementById('previewCanvas');
    var liveDur = liveVideo.duration;
    var isLiveStream = !liveDur || !isFinite(liveDur);

    if(isLiveStream){
        // 真实直播流无法 seek 回放 → 从主视频截帧到 canvas
        pv.style.display = 'none';
        pvCanvas.style.display = 'block';
        pvCanvas.width = 640; pvCanvas.height = 360;
        var ctx = pvCanvas.getContext('2d');
        // seek 主视频到入点截帧（会影响直播观看，所以只截当前帧）
        try{ ctx.drawImage(liveVideo, 0, 0, 640, 360); }catch(e){}
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(0, 0, 640, 360);
        ctx.fillStyle = '#fff'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(clip.name, 320, 170);
        ctx.font = '12px monospace'; ctx.fillStyle = '#94a3b8';
        ctx.fillText(fmtShort(clip.startSec) + ' → ' + fmtShort(clip.endSec), 320, 195);
    } else {
        // 有固定时长（回放视频） → 可 seek 播放
        pv.style.display = 'block';
        pvCanvas.style.display = 'none';

        function seekAndPlay(){
            pv.currentTime = clip.startSec;
            pv.play().catch(function(){});
            var stopFn = function(){
                if(pv.currentTime >= clip.endSec){
                    pv.pause();
                    pv.removeEventListener('timeupdate', stopFn);
                }
            };
            pv.addEventListener('timeupdate', stopFn);
        }

        if(_previewReady){
            seekAndPlay();
        } else {
            var isHLS = /\.m3u8/i.test(videoUrl);
            var isFLV = /\.flv/i.test(videoUrl);
            if(isHLS && typeof Hls !== 'undefined' && Hls.isSupported()){
                if(_previewHls){ _previewHls.destroy(); }
                _previewHls = new Hls({enableWorker:true});
                _previewHls.loadSource(videoUrl);
                _previewHls.attachMedia(pv);
                _previewHls.on(Hls.Events.MANIFEST_PARSED, function(){
                    _previewReady = true;
                    seekAndPlay();
                });
            } else if(isFLV && typeof flvjs !== 'undefined' && flvjs.isSupported()){
                if(_previewFlv){ _previewFlv.destroy(); }
                _previewFlv = flvjs.createPlayer({ type:'flv', url:videoUrl, isLive:false });
                _previewFlv.attachMediaElement(pv);
                _previewFlv.load();
                pv.onloadeddata = function(){ _previewReady = true; seekAndPlay(); };
            } else {
                pv.src = videoUrl;
                pv.load();
                pv.onloadeddata = function(){ _previewReady = true; seekAndPlay(); };
            }
        }
    }
}

/* ===== Keyboard Shortcuts ===== */
document.addEventListener('keydown', function(e){
    if(e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if(e.key === ' ' || e.code === 'Space'){ e.preventDefault(); togglePlay(); }
    if(e.key === 'i' || e.key === 'I'){ e.preventDefault(); setInPoint(); }
    if(e.key === 'o' || e.key === 'O'){ e.preventDefault(); if(inPoint !== null) setOutPoint(); }
    if(e.key === 'Enter'){ e.preventDefault(); if(!btnGen.disabled) generateClip(); }
    if(e.key === 'ArrowLeft'){ e.preventDefault(); liveVideo.currentTime = Math.max(0, liveVideo.currentTime - 5); }
    if(e.key === 'ArrowRight'){ e.preventDefault(); liveVideo.currentTime = Math.min(liveVideo.duration || liveElapsed, liveVideo.currentTime + 5); }
    if(e.key === 'j' || e.key === 'J'){ e.preventDefault(); liveVideo.currentTime = Math.max(0, liveVideo.currentTime - 1); }
    if(e.key === 'l' || e.key === 'L'){ e.preventDefault(); liveVideo.currentTime = Math.min(liveVideo.duration || liveElapsed, liveVideo.currentTime + 1); }
});

/* ===== Export ===== */
exportBtn.addEventListener('click', function(){
    if(clips.length === 0) return;
    // 保存作品记录
    saveLiveTaskRecord('done');
    var lines = ['Tideo 直播剪辑导出','视频: '+videoUrl,'时间: '+new Date().toLocaleString(),'---',''];
    clips.forEach(function(c,i){
        lines.push('片段 '+(i+1)+': '+fmt(c.startSec)+' → '+fmt(c.endSec)+' (时长 '+fmtShort(c.dur)+') '+c.name);
    });
    lines.push('','共 '+clips.length+' 个片段');
    var blob = new Blob([lines.join('\n')],{type:'text/plain'});
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'tideo-clips-'+Date.now()+'.txt';
    a.click(); URL.revokeObjectURL(a.href);
    var self = this;
    self.textContent = '已导出 ✓';
    setTimeout(function(){
        self.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 2V9M8 9L11 6M8 9L5 6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 11V13C3 13.55 3.45 14 4 14H12C12.55 14 13 13.55 13 13V11" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>导出全部片段';
    }, 2000);
});

/* ===== "回到直播" 按钮 ===== */
var btnLiveNow = document.getElementById('btnLiveNow');
var isAtLive = true;

btnLiveNow.addEventListener('click', function(){
    // 跳到视频最新可用位置
    var dur = liveVideo.duration;
    if(dur && isFinite(dur)){
        // 回放视频：跳到接近末尾（留0.5s避免结束）
        liveVideo.currentTime = Math.max(0, dur - 0.5);
    } else if(liveVideo.seekable.length){
        // 真实直播流：跳到 seekable 最末端
        liveVideo.currentTime = liveVideo.seekable.end(liveVideo.seekable.length - 1);
    }
    isAtLive = true;
    btnLiveNow.style.display = 'none';
    liveVideo.play().catch(function(){});
    // 滚动到时间轴最右
    var scroll = document.getElementById('trkScroll');
    if(scroll) scroll.scrollLeft = scroll.scrollWidth;
});

function markNotLive(){
    if(isAtLive){
        isAtLive = false;
        btnLiveNow.style.display = '';
    }
}
function checkIfAtLive(){
    // 如果当前播放位置距离直播前端不到 3 秒，认为在看直播
    var livePos = recStartTime + liveElapsed;
    var cur = getCurTime();
    if(livePos - cur < 3){
        isAtLive = true;
        btnLiveNow.style.display = 'none';
    } else {
        markNotLive();
    }
}

/* ===== 轨道区域点击 seek ===== */
(function(){
    var tracksArea = document.getElementById('tracksArea');
    var scroll = document.getElementById('trkScroll');
    if(!tracksArea || !scroll) return;

    tracksArea.addEventListener('click', function(e){
        if(e.target.closest('.ls-trk-playhead')) return;
        if(e.target.closest('.ls-trk-seg')) return;
        if(_isDragging) return;

        var scrollRect = scroll.getBoundingClientRect();
        var x = e.clientX - scrollRect.left + scroll.scrollLeft;
        var sec = Math.max(0, x / PX_PER_SEC);
        sec = Math.min(sec, getMaxSeekSec());
        liveVideo.currentTime = recStartTime + sec;
        checkIfAtLive();
    });
})();

/* ===== 播放头拖拽 ===== */
(function(){
    var ph = document.getElementById('tlPlayhead');
    var scroll = document.getElementById('trkScroll');
    var dragSec = 0;

    if(!ph || !scroll) return;

    ph.addEventListener('mousedown', function(e){
        e.preventDefault();
        e.stopPropagation();
        _isDragging = true;
        ph.classList.add('dragging');
        document.addEventListener('mousemove', onDrag);
        document.addEventListener('mouseup', onDragEnd);
    });

    function onDrag(e){
        if(!_isDragging) return;
        var scrollRect = scroll.getBoundingClientRect();
        var x = e.clientX - scrollRect.left + scroll.scrollLeft;
        dragSec = Math.max(0, x / PX_PER_SEC);
        dragSec = Math.min(dragSec, getMaxSeekSec());
        // 只移视觉
        ph.style.left = (dragSec * PX_PER_SEC) + 'px';
        tlTimeEl.textContent = fmtShort(dragSec) + ' / ' + fmtShort(liveElapsed);
    }

    function onDragEnd(){
        if(!_isDragging) return;
        _isDragging = false;
        ph.classList.remove('dragging');
        document.removeEventListener('mousemove', onDrag);
        document.removeEventListener('mouseup', onDragEnd);
        // seek
        liveVideo.currentTime = recStartTime + dragSec;
        liveVideo.play().catch(function(){});
        checkIfAtLive();
    }
})();

/* ===== 保存任务记录到作品页 ===== */
function saveLiveTaskRecord(status) {
    try {
        var records = JSON.parse(localStorage.getItem('tideo_results') || '[]');
        var id = 'live_' + Date.now();
        var totalDur = 0;
        clips.forEach(function(c){ totalDur += c.dur || 0; });
        records.unshift({
            id: id,
            name: '直播剪辑 ' + clips.length + '个片段',
            type: 'live',
            mode: 'live',
            features: ['直播剪辑', clips.length + '个片段'],
            status: status,
            videoUrl: videoUrl || '',
            outputUrl: '',
            duration: totalDur,
            elapsed: 0,
            date: new Date().toISOString()
        });
        if (records.length > 50) records = records.slice(0, 50);
        localStorage.setItem('tideo_results', JSON.stringify(records));
    } catch(e) {}
}

/* ===== URL Params ===== */
var params = new URLSearchParams(location.search);
var urlParam = params.get('liveUrl') || params.get('url') || '';
var isRestore = params.get('restore') === '1';

// 尝试恢复后台任务状态
var _liveSaved = null;
if (isRestore) {
    try { _liveSaved = JSON.parse(sessionStorage.getItem('tideo_live_state')); } catch(e) {}
}

if (_liveSaved && isRestore) {
    // 恢复已有任务
    if (_liveSaved.videoUrl) loadVideo(_liveSaved.videoUrl);
    else if (urlParam) loadVideo(urlParam);
    else loadVideo('https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.webm');
    // 恢复 clips
    if (_liveSaved.clips && _liveSaved.clips.length) {
        clips = _liveSaved.clips;
        clipIdCounter = clips.length;
        renderClipList();
    }
    // 恢复聊天
    var chatEl = document.getElementById('chatFlow');
    if (chatEl && _liveSaved.chatHTML) chatEl.innerHTML = _liveSaved.chatHTML;
    sessionStorage.removeItem('tideo_live_state');
    console.log('[Livestream] 恢复任务:', _liveSaved.id, '片段:', clips.length);
} else if(urlParam){
    loadVideo(urlParam);
} else {
    loadVideo('https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.webm');
}

})();
