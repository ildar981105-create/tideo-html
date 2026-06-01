// livestream-v2.js — 直播剪辑工作坊核心逻辑
(function(){
'use strict';

/* ===== State ===== */
let liveTime = 0; // seconds since monitoring started
let liveTimer = null;
let clipIdCounter = 0;
let inPoint = null, outPoint = null;
const clips = []; // {id, name, tag, type:'auto'|'manual', startSec, endSec, hue}

/* ===== Role ===== */
const EDITOR = {
    name:'剪辑师', realName:'陈默', color:'#f97316',
    avatar:'assets/characters/chenmo-postprod.png', cssClass:'role-postprod',
    greetings:[
        '……工具就位。码率稳定，信号良好。开始录制了。',
        '收到。监控引擎启动，画面和音频双轨采集中。',
        '信号锁定。帧率30fps，分辨率1080p。别打扰我，有片段我会说。'
    ],
    workingLines:[
        '……画面分析中。弹幕密度正常。',
        '声音波形平稳，等高潮段。',
        '这段比较平，先不截。',
        '……观察中。暂时没有值得标记的。',
        '码率稳定。继续盯着。'
    ],
    clipLines:[
        '……这段可以。截了。',
        '弹幕峰值+音量飙升，标记。',
        '高光段检测到。入点出点都锁好了。',
        '这段情绪张力够，截。',
        '互动峰值明显。片段已生成。'
    ]
};

/* ===== Elements ===== */
const page = document.getElementById('lsPage');
const chatFlow = document.getElementById('chatFlow');
const timerEl = document.getElementById('liveTimer');
const ftClipList = document.getElementById('ftClipList');

/* ===== Utils ===== */
function fmt(s){const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=Math.floor(s%60);return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':'+String(sec).padStart(2,'0')}
function fmtShort(s){const m=Math.floor(s/60),sec=Math.floor(s%60);return String(m).padStart(1,'0')+':'+String(sec).padStart(2,'0')}
function rnd(a){return a[Math.floor(Math.random()*a.length)]}
function scrollChat(){chatFlow.scrollTo({top:chatFlow.scrollHeight,behavior:'smooth'})}

/* ===== Chat ===== */
function appendBubble(type, html, delay){
    const el = document.createElement('div');
    if(type === 'ai'){
        const bh = '<span class="rb-name">'+EDITOR.realName+'</span><span class="rb-role">'+EDITOR.name+'</span>';
        el.className = 'chat-bubble chat-bubble--ai '+EDITOR.cssClass;
        el.style.animationDelay = (delay||0)+'s';
        el.innerHTML = '<div class="bubble-avatar"><img class="role-avatar-img" src="'+EDITOR.avatar+'" alt="'+EDITOR.realName+'"><span class="role-badge">'+bh+'</span></div><div class="bubble-body">'+html+'</div>';
    } else if(type === 'user'){
        el.className = 'chat-bubble chat-bubble--user';
        el.innerHTML = html;
    } else if(type === 'system'){
        el.className = 'chat-join-msg';
        el.innerHTML = html;
    } else if(type === 'clip'){
        el.className = 'chat-bubble chat-bubble--ai '+EDITOR.cssClass;
        const bh = '<span class="rb-name">'+EDITOR.realName+'</span><span class="rb-role">'+EDITOR.name+'</span>';
        el.innerHTML = '<div class="bubble-avatar"><img class="role-avatar-img" src="'+EDITOR.avatar+'"><span class="role-badge">'+bh+'</span></div><div class="bubble-body">'+html+'</div>';
    }
    chatFlow.appendChild(el);
    return el;
}

function appendClipCard(clip){
    const hue = clip.hue;
    const tagClass = clip.type === 'auto' ? 'clip-card-tag--auto' : 'clip-card-tag--manual';
    const tagText = clip.type === 'auto' ? '自动' : '手动';
    const dur = fmtShort(clip.endSec - clip.startSec);

    const html = rnd(EDITOR.clipLines) +
        '<div class="clip-card">' +
            '<div class="clip-card-thumb"><canvas data-hue="'+hue+'"></canvas>' +
                '<span class="clip-card-dur">'+dur+'</span>' +
                '<span class="clip-card-tag '+tagClass+'">'+tagText+'</span>' +
            '</div>' +
            '<div class="clip-card-body">' +
                '<div class="clip-card-name">'+clip.name+'</div>' +
                '<div class="clip-card-meta">'+clip.tag+' · '+fmt(clip.startSec)+' — '+fmt(clip.endSec)+'</div>' +
                '<div class="clip-card-actions">' +
                    '<button class="clip-card-btn" onclick="previewClip('+clip.id+')">▶ 预览</button>' +
                    '<button class="clip-card-btn clip-card-btn--primary">⬇ 导出</button>' +
                '</div>' +
            '</div>' +
        '</div>';

    const bubble = appendBubble('clip', html);
    scrollChat();

    // Render thumbnail canvas
    setTimeout(()=>{
        const cv = bubble.querySelector('canvas');
        if(cv) renderThumb(cv, hue);
    }, 50);
}

function renderThumb(cv, hue){
    cv.width = 320; cv.height = 180;
    const ctx = cv.getContext('2d');
    const grd = ctx.createLinearGradient(0,0,320,180);
    grd.addColorStop(0, 'hsl('+hue+',40%,14%)');
    grd.addColorStop(0.5, 'hsl('+((hue+40)%360)+',35%,18%)');
    grd.addColorStop(1, 'hsl('+((hue+80)%360)+',30%,12%)');
    ctx.fillStyle = grd; ctx.fillRect(0,0,320,180);
    ctx.globalAlpha = 0.15;
    ctx.beginPath(); ctx.arc(160,75,35,0,Math.PI*2);
    ctx.fillStyle = 'hsl('+hue+',50%,40%)'; ctx.fill();
    ctx.globalAlpha = 1;
}

/* ===== Auto Clip Generator ===== */
const AUTO_CLIPS = [
    {name:'开场秒杀倒计时', tag:'互动峰值'},
    {name:'主播试穿外套 — 弹幕刷屏', tag:'弹幕高潮'},
    {name:'"这个价格只有今天"', tag:'转化话术'},
    {name:'观众点名要看细节', tag:'互动峰值'},
    {name:'限量款抢购瞬间', tag:'成交峰值'},
    {name:'主播感谢破万人次', tag:'里程碑'},
    {name:'对比竞品讲解', tag:'高留存'},
    {name:'最后 3 件冲刺', tag:'成交峰值'},
    {name:'收尾感谢 + 预告下场', tag:'互动峰值'},
    {name:'突发搞笑花絮', tag:'弹幕高潮'}
];
let autoClipIdx = 0;
let nextAutoClipTime = 12; // first auto clip after 12 seconds

function checkAutoClip(){
    if(liveTime >= nextAutoClipTime && autoClipIdx < AUTO_CLIPS.length){
        const tpl = AUTO_CLIPS[autoClipIdx];
        const dur = 15 + Math.floor(Math.random()*30);
        const startSec = Math.max(0, liveTime - dur);
        const clip = {
            id: ++clipIdCounter,
            name: tpl.name,
            tag: tpl.tag,
            type: 'auto',
            startSec: startSec,
            endSec: liveTime,
            hue: (autoClipIdx * 37 + 200) % 360
        };
        clips.push(clip);
        appendClipCard(clip);
        autoClipIdx++;
        nextAutoClipTime = liveTime + 15 + Math.floor(Math.random()*20);
        updateFtClipList();
    }
}

/* ===== Live Timer ===== */
function startLiveTimer(){
    liveTimer = setInterval(()=>{
        liveTime++;
        timerEl.textContent = fmt(liveTime);
        checkAutoClip();
    }, 1000);
}

/* ===== Init Chat Flow ===== */
function initChat(){
    // Join message
    appendBubble('system', '<div class="join-avatars"><img src="'+EDITOR.avatar+'"></div> <span>陈默（剪辑师）加入了工作组</span>');

    // User command
    setTimeout(()=>{
        appendBubble('user', '开始监控这个直播，自动识别高光片段帮我剪辑');
        scrollChat();
    }, 600);

    // Editor greeting
    setTimeout(()=>{
        appendBubble('ai', rnd(EDITOR.greetings));
        scrollChat();
    }, 1500);

    // Working status card
    setTimeout(()=>{
        const html = '<div class="role-progress-card">' +
            '<div class="rpc-header"><span class="rpc-status-dot rpc-active"></span><span class="rpc-title"><strong>直播监控</strong></span><span class="rpc-label rpc-label--active">运行中<span class="rpc-dots">...</span></span></div>' +
            '<div class="rpc-tasks">' +
                '<div class="rpc-task rpc-task--active"><span class="rpc-task-icon">●</span>画面分析 — 实时检测</div>' +
                '<div class="rpc-task rpc-task--active"><span class="rpc-task-icon">●</span>弹幕情绪 — 实时追踪</div>' +
                '<div class="rpc-task rpc-task--active"><span class="rpc-task-icon">●</span>音量峰值 — 持续监听</div>' +
            '</div>' +
        '</div>';
        appendBubble('ai', html);
        scrollChat();
    }, 2500);

    // Manual edit button
    setTimeout(()=>{
        const btn = document.createElement('div');
        btn.style.padding = '0 16px 12px';
        btn.innerHTML = '<button class="manual-edit-btn" onclick="enterManualEdit()"><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 2L4 14M12 2L12 14M2 7H14M2 9H14" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>进入手动剪辑</button>';
        chatFlow.appendChild(btn);
        scrollChat();
    }, 3500);

    // Start live monitoring
    setTimeout(()=> startLiveTimer(), 2000);
}

/* ===== Manual Edit Mode ===== */
window.enterManualEdit = function(){
    page.classList.add('ft-mode');
    updateFtClipList();
    renderFtTimeline();
};

window.exitManualEdit = function(){
    page.classList.remove('ft-mode');
};

document.getElementById('ftBackBtn').addEventListener('click', ()=> window.exitManualEdit());

/* ===== Manual Clip Generation ===== */
document.getElementById('btnInPoint').addEventListener('click', function(){
    inPoint = liveTime;
    this.textContent = '入点 ' + fmt(inPoint);
    this.style.borderColor = 'rgba(34,197,94,0.5)';
    this.style.color = '#22c55e';
    renderFtTimeline();
});

document.getElementById('btnOutPoint').addEventListener('click', function(){
    outPoint = liveTime;
    this.textContent = '出点 ' + fmt(outPoint);
    this.style.borderColor = 'rgba(239,68,68,0.5)';
    this.style.color = '#ef4444';
    renderFtTimeline();
});

document.getElementById('btnGenClip').addEventListener('click', function(){
    if(inPoint === null || outPoint === null){return}
    if(outPoint <= inPoint){return}
    const clip = {
        id: ++clipIdCounter,
        name: '手动截取 #' + clipIdCounter,
        tag: '手动剪辑',
        type: 'manual',
        startSec: inPoint,
        endSec: outPoint,
        hue: (clipIdCounter * 53 + 100) % 360
    };
    clips.push(clip);
    appendClipCard(clip);
    updateFtClipList();
    renderFtTimeline();
    // Reset
    inPoint = null; outPoint = null;
    const inBtn = document.getElementById('btnInPoint');
    const outBtn = document.getElementById('btnOutPoint');
    inBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 2V10M5 6H10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>入点';
    inBtn.style.borderColor = ''; inBtn.style.color = '';
    outBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M10 2V10M2 6H7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>出点';
    outBtn.style.borderColor = ''; outBtn.style.color = '';
});

/* ===== Finetune Clip List ===== */
let ftFilter = 'all';

function updateFtClipList(){
    const filtered = ftFilter === 'all' ? clips : clips.filter(c => c.type === ftFilter);
    const autoCount = clips.filter(c=>c.type==='auto').length;
    const manualCount = clips.filter(c=>c.type==='manual').length;

    document.getElementById('ftCountAll').textContent = clips.length;
    document.getElementById('ftCountAuto').textContent = autoCount;
    document.getElementById('ftCountManual').textContent = manualCount;
    document.getElementById('ftClipsSub').textContent = '共 ' + clips.length + ' 个片段';

    ftClipList.innerHTML = '';
    filtered.forEach(c => {
        const tagClass = c.type === 'auto' ? 'tag-auto' : 'tag-manual';
        const tagText = c.type === 'auto' ? '自动' : '手动';
        const dur = fmtShort(c.endSec - c.startSec);
        const div = document.createElement('div');
        div.className = 'ls-ft-clip';
        div.dataset.id = c.id;
        div.innerHTML =
            '<div class="ls-ft-clip-thumb"><canvas data-hue="'+c.hue+'"></canvas><span class="ls-ft-clip-thumb-tag '+tagClass+'">'+tagText+'</span></div>' +
            '<div class="ls-ft-clip-info"><div class="ls-ft-clip-name">'+c.name+'</div><div class="ls-ft-clip-meta">'+c.tag+'</div>' +
            '<div class="ls-ft-clip-actions"><button class="ls-ft-clip-btn" onclick="previewClip('+c.id+')">▶</button><button class="ls-ft-clip-btn">⬇</button><button class="ls-ft-clip-btn" style="color:#ef4444">✕</button></div></div>' +
            '<div class="ls-ft-clip-dur">'+dur+'</div>';
        div.addEventListener('click', ()=> previewClip(c.id));
        ftClipList.appendChild(div);
    });

    // Render thumbs
    ftClipList.querySelectorAll('canvas').forEach(cv => {
        renderThumb(cv, parseInt(cv.dataset.hue)||200);
    });
}

// Tab clicks
document.querySelectorAll('.ls-ft-tab').forEach(tab => {
    tab.addEventListener('click', function(){
        document.querySelectorAll('.ls-ft-tab').forEach(t => t.classList.remove('active'));
        this.classList.add('active');
        ftFilter = this.dataset.filter;
        updateFtClipList();
    });
});

/* ===== Preview ===== */
window.previewClip = function(id){
    const clip = clips.find(c=>c.id===id);
    if(!clip) return;
    // Highlight in list
    document.querySelectorAll('.ls-ft-clip').forEach(el => {
        el.classList.toggle('active', parseInt(el.dataset.id) === id);
    });
    // Show in preview canvas
    const empty = document.getElementById('ftPreviewEmpty');
    if(empty) empty.style.display = 'none';
    const cv = document.getElementById('ftPreviewCanvas');
    if(cv){ cv.style.display = 'block'; renderThumb(cv, clip.hue); }
};

/* ===== Timeline Rendering ===== */
function renderFtTimeline(){
    const totalSec = Math.max(liveTime, 60);
    const trkRecord = document.getElementById('trkRecord');
    const trkAuto = document.getElementById('trkAuto');
    const trkManual = document.getElementById('trkManual');

    // Record track — full bar
    trkRecord.innerHTML = '<div class="ls-trk-seg ls-trk-seg--record" style="left:0;width:100%"></div>';

    // Auto segments
    trkAuto.innerHTML = '';
    clips.filter(c=>c.type==='auto').forEach(c => {
        const left = (c.startSec / totalSec) * 100;
        const width = ((c.endSec - c.startSec) / totalSec) * 100;
        trkAuto.innerHTML += '<div class="ls-trk-seg ls-trk-seg--auto" style="left:'+left+'%;width:'+Math.max(width,1)+'%" title="'+c.name+'"></div>';
    });

    // Manual segments
    trkManual.innerHTML = '';
    clips.filter(c=>c.type==='manual').forEach(c => {
        const left = (c.startSec / totalSec) * 100;
        const width = ((c.endSec - c.startSec) / totalSec) * 100;
        trkManual.innerHTML += '<div class="ls-trk-seg ls-trk-seg--manual" style="left:'+left+'%;width:'+Math.max(width,1)+'%" title="'+c.name+'"></div>';
    });

    // In/out point markers
    if(inPoint !== null){
        trkManual.innerHTML += '<div class="ls-trk-inpoint" style="left:'+(inPoint/totalSec*100)+'%"></div>';
    }
    if(outPoint !== null){
        trkManual.innerHTML += '<div class="ls-trk-outpoint" style="left:'+(outPoint/totalSec*100)+'%"></div>';
    }
    if(inPoint !== null && outPoint !== null && outPoint > inPoint){
        const sl = (inPoint/totalSec*100), sw = ((outPoint-inPoint)/totalSec*100);
        trkManual.innerHTML += '<div class="ls-trk-selection" style="left:'+sl+'%;width:'+sw+'%"></div>';
    }

    // Playhead
    document.getElementById('tlPlayhead').style.left = 'calc(68px + '+(liveTime/totalSec*100)+'% * (100% - 68px) / 100%)';
}

// Update timeline periodically
setInterval(()=>{ if(page.classList.contains('ft-mode')) renderFtTimeline(); }, 2000);

/* ===== Chat Collapse/Expand ===== */
const chatPanel = document.getElementById('chatPanel');
const chatFab = document.getElementById('chatFab');
const collapseBtn = document.getElementById('chatCollapseBtn');

collapseBtn.addEventListener('click', ()=>{
    chatPanel.classList.add('collapsed');
    chatFab.classList.add('active');
});
chatFab.addEventListener('click', ()=>{
    chatPanel.classList.remove('collapsed');
    chatFab.classList.remove('active');
    scrollChat();
});

/* ===== Init ===== */
initChat();

// Render preview canvas placeholder
const pcv = document.getElementById('ftPreviewCanvas');
if(pcv){ pcv.width=640; pcv.height=360; const ctx=pcv.getContext('2d'); ctx.fillStyle='#0a0a16'; ctx.fillRect(0,0,640,360); }

})();
