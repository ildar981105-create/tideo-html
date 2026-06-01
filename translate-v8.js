// translate-v8.js — 沉浸式影视译制页核心逻辑（真实 API 版）
(function(){
'use strict';

/* ===== State ===== */
let phase = 'processing';
let playing = false;
let videoTime = 0;
let realVideoDuration = 90; // 会被真实视频时长覆盖
let animFrame = null;
let features = { erase:true, subtitle:true, voice:true };
let uploadedFileName = '';
let currentTaskId = null; // 任务持久化 ID

/* ===== URL Params ===== */
const P = new URLSearchParams(location.search);
const autostart = P.get('autostart')==='1';
const promptText = P.get('prompt')||'';
const workflowMode = P.get('mode')||'full';
uploadedFileName = P.get('file')||'';
const videoUrl = P.get('videoUrl') || '';
const isRestore = P.get('restore')==='1';
const restoreTaskId = P.get('apiTaskId') || '';
const srcLang = P.get('lang_src') || 'zh';
const dstLang = P.get('lang_tgt') || 'en';
const isFinetuneEntry = P.get('finetune')==='1';
const ftFeatErase = P.get('feat_erase')==='1';
const ftFeatSubtitle = P.get('feat_subtitle')==='1';
const ftFeatVoice = P.get('feat_voice')==='1';
const LANG_NAMES = {zh:'中文',en:'英语',ja:'日语',ko:'韩语',es:'西语',fr:'法语',de:'德语',auto:'自动'};

/* ===== API State ===== */
const USE_REAL_API = (typeof TideoAPI !== 'undefined') && !!(videoUrl || restoreTaskId);
let apiTaskId = restoreTaskId || null;
let apiResult = null;
let apiPolling = false;
let outputVideoUrl = '';
let mpsStartTime = isRestore ? (Date.now() - 60000) : null; // restore 模式假设已经跑了1分钟

/* ===== Roles ===== */
const ROLES = {
    director:{ name:'导演', realName:'林雨晨', color:'#e74c3c', avatar:'assets/characters/linyuchen-director.png', cssClass:'role-director',
        greetings:['收到素材了，我快速过了一遍。陈默，画面交给你。明远准备文案，苏雅候着。','这条片子节奏不慢。老规矩——陈默开路，明远跟上，苏雅收尾。','素材到了。分工表拉好了——陈默画面、明远翻译、苏雅配音。']},
    postprod:{ name:'后期', realName:'陈默', color:'#7c3aed', avatar:'assets/characters/chenmo-postprod.png', cssClass:'role-postprod',
        checkIn:['……嗯。工具摆好了，等开工。','在的。准备就绪。','收到。耳机戴了，随时能干。']},
    translator:{ name:'翻译', realName:'李明远', color:'#2563eb', avatar:'assets/characters/limingyuan-translator.png', cssClass:'role-translator',
        checkIn:['材料过了一遍，准备就绪。','术语库加载好了。等安排。','好的，准备好了。']},
    voice:{ name:'配音', realName:'苏雅', color:'#ec4899', avatar:'assets/characters/suya-voice.png', cssClass:'role-voice',
        checkIn:['来啦～ 声卡耳返都OK！🎵','到了到了！热了一下嗓～','准备就绪！等前面搞完就上 🎶']}
};

/* ===== Elements ===== */
const page = document.getElementById('v8Page');
const videoEl = document.getElementById('mainVideo');
const burntSub = document.getElementById('burntSub');
const chatFlow = document.getElementById('chatFlow');
const phaseEl = document.getElementById('phaseEl');
const phaseDot = document.getElementById('phaseDot');
const phaseLabel = document.getElementById('phaseLabel');
const subPreview = document.getElementById('subPreview');
const subOrigEl = subPreview.querySelector('.so');
const subTransEl = subPreview.querySelector('.st');
const voicePreview = document.getElementById('voicePreview');
const eraseOC = document.getElementById('eraseOC');
const tlPlayhead = document.getElementById('tlPlayhead');
const tlTracks = document.getElementById('tlTracks');

/* ===== Data (will be replaced by API results) ===== */
let subtitleItems=[];
let voiceItems=[];
let eraseRegions=[];
let eraseRegionCounter=0;

/* ===== Pipeline ===== */
let activeSteps=['erase','subtitle','voice'];
let currentStep=-1;
let scriptReady=false;
const stepRoleMap={erase:'postprod',subtitle:'translator',voice:'voice'};
const progressCards={};
let stepSubTasks={};
let stepsPaused=false;

/* ===== Finetune ===== */
let inFinetune=false, currentFtStep=null, pendingAdvance=null;
let unlockedTabs={erase:false,subtitle:false,voice:false};
let fineTunedSteps={erase:false,subtitle:false,voice:false};
let editingSub=null, editingVoice=null, activeErase='E1', editingErase=null;
let lastVisErase=null, lastSubId=null, lastVoiceId=null, lastBurntId=null;
let lightsOff=false, compareActive=false;
let needsVideoSync=false;
let ftPauseBubble=null;
let resultBubble=null;

/* ===== Utils ===== */
function fmt(s){const m=Math.floor(s/60),sec=Math.floor(s%60);return String(m).padStart(2,'0')+':'+String(sec).padStart(2,'0')}
function esc(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML}
function escA(s){return s.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;')}
function parseT(v){const p=v.trim().split(':');if(p.length===2){const m=parseInt(p[0]),s=parseInt(p[1]);if(!isNaN(m)&&!isNaN(s))return m*60+s}const n=parseFloat(v);return isNaN(n)?null:n}
function rnd(a){return a[Math.floor(Math.random()*a.length)]}
/* ===== Set real video source ===== */
if(videoUrl) {
    videoEl.src = videoUrl;
    videoEl.load();
    videoEl.addEventListener('loadedmetadata', function() {
        realVideoDuration = videoEl.duration || 90;
        console.log('[Tideo] 真实视频时长:', realVideoDuration, '秒');
        buildRuler();
    });
}

/* ===== Chat ===== */
function appendBubble(type,html,delay,role){
    const el=document.createElement('div');
    if(type==='ai'&&role&&ROLES[role]){
        const r=ROLES[role];
        el.className='chat-bubble chat-bubble--ai '+r.cssClass;
        el.style.animationDelay=(delay||0)+'s';
        el.innerHTML='<div class="bubble-avatar"><img class="role-avatar-img" src="'+r.avatar+'" alt="'+r.realName+'"></div><div class="bubble-body"><div class="role-name-line">'+r.name+'–<strong>'+r.realName+'</strong></div><div class="role-msg">'+html+'</div></div>';
    }else if(type==='user'){
        el.className='chat-bubble chat-bubble--user';el.innerHTML=html;
    }else{
        const r=ROLES.director;
        el.className='chat-bubble chat-bubble--ai '+r.cssClass;
        el.innerHTML='<div class="bubble-avatar"><img class="role-avatar-img" src="'+r.avatar+'" alt="'+r.realName+'"></div><div class="bubble-body"><div class="role-name-line">'+r.name+'–<strong>'+r.realName+'</strong></div><div class="role-msg">'+html+'</div></div>';
    }
    chatFlow.appendChild(el);return el;
}
function scrollChat(){chatFlow.scrollTo({top:chatFlow.scrollHeight,behavior:'smooth'})}

/* ===== Progress Card ===== */
function buildPC(step,status,tasks){
    const tMap={erase:'字幕和水印擦除',subtitle:'字幕翻译',voice:'配音'};
    const title=tMap[step]||step;
    const dc=status==='done'?'rpc-done':status==='active'?'rpc-active':'rpc-pending';
    let lb=status==='done'?'<span class="rpc-label rpc-label--done"></span>':status==='active'?'<span class="rpc-label rpc-label--active">处理中<span class="rpc-dots">...</span></span>':'<span class="rpc-label">排队中</span>';
    let th='';
    if(tasks&&tasks.length){
        var svgDone='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
        var svgActive='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>';
        var svgPending='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/></svg>';
        th='<div class="rpc-tasks">';tasks.forEach(t=>{const ts=t.status||status;let ic=svgPending,cl='rpc-task--pending';if(ts==='done'){ic=svgDone;cl='rpc-task--done'}else if(ts==='active'){ic=svgActive;cl='rpc-task--active'}const dl=(ts==='done'&&t.doneLabel)?t.doneLabel:t.label;th+='<div class="rpc-task '+cl+'"><span class="rpc-task-icon">'+ic+'</span>'+dl+'</div>'});th+='</div>'}
    let dl='';
    if(phase==='done' && status==='done'){
        if(inFinetune&&currentFtStep===step){
            dl='<div class="rpc-detail-link rpc-ft-active"><svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M2 4H14M2 8H10M2 12H7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg> 精调中...</div>';
        }else if(fineTunedSteps[step]){
            dl='<div class="rpc-detail-link" data-step="'+step+'"><svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M2 4H14M2 8H10M2 12H7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg> 已精调 · 再次精调 →</div>';
        }else{
            dl='<div class="rpc-detail-link" data-step="'+step+'"><svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M2 4H14M2 8H10M2 12H7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg> 去精调 →</div>';
        }
    }
    return '<div class="role-progress-card"><div class="rpc-header"><span class="rpc-status-dot '+dc+'"></span><span class="rpc-title"><strong>'+title+'</strong></span>'+lb+'</div>'+th+dl+'</div>';
}
function updatePC(step,status,tasks){
    const cb=progressCards[step];if(!cb)return;
    const body=cb.querySelector('.bubble-body');if(!body)return;
    // 保留 name-line 和 role-msg，只替换 progress card
    var existing = body.querySelector('.role-progress-card');
    var newCard = document.createElement('div');
    newCard.innerHTML = buildPC(step,status,tasks||stepSubTasks[step]||[]);
    if(existing) { existing.replaceWith(newCard.firstChild); }
    else { body.appendChild(newCard.firstChild); }
    scrollChat();
    const dl=body.querySelector('.rpc-detail-link');
    if(dl)dl.addEventListener('click',()=>enterFinetune(step));
}

/* ================================================================
   REAL API FLOW — 完全由 MPS 轮询驱动右侧对话进度
   ================================================================ */

function buildConfigChat(){
    chatFlow.innerHTML='';Object.keys(progressCards).forEach(k=>delete progressCards[k]);

    if(workflowMode==='full')activeSteps=['erase','subtitle','voice'];
    else activeSteps=[workflowMode];

    // 任务开始时立刻写入 processing 记录
    taskStarted = true;
    saveTaskRecord('processing', 0);

    // Join message
    const jm=document.createElement('div');jm.className='chat-join-msg';
    jm.innerHTML='<span class="join-avatars"><img src="assets/characters/linyuchen-director.png"><img src="assets/characters/chenmo-postprod.png"><img src="assets/characters/limingyuan-translator.png"><img src="assets/characters/suya-voice.png"></span> 林雨晨、陈默、李明远、苏雅 加入了工作坊';
    chatFlow.appendChild(jm);

    // User bubble
    setTimeout(()=>{
        const userMsg = promptText || ('帮我' + (workflowMode==='full'?'擦除字幕水印，翻译成英语，再配音':
            workflowMode==='erase'?'擦除字幕和水印':
            workflowMode==='subtitle'?'翻译字幕':
            '配音') + (uploadedFileName ? ' — ' + uploadedFileName : ''));
        appendBubble('user', userMsg, 0);
        scrollChat();
    },800);

    // Director greeting — only for simulated flow; real flow has its own
    if(USE_REAL_API && isRestore && restoreTaskId) {
        // 恢复模式：跳过角色签到，直接恢复轮询
        setTimeout(()=> startRestoreFlow(), 1000);
    } else if(USE_REAL_API) {
        setTimeout(()=> startRealFlow(), 2000);
    } else {
        setTimeout(()=>{appendBubble('ai',rnd(ROLES.director.greetings),0,'director');scrollChat()},2000);
        startSimulatedFlow();
    }
}

/* ===== 真实 API 流程（精简对话 + MPS 进度驱动卡片原地更新） ===== */
let pollCount = 0;

function buildRealSubTasks(){
    const tgt=LANG_NAMES[dstLang]||dstLang;
    stepSubTasks = {
        erase:[
            {label:'扫描画面…',doneLabel:'发现字幕和水印区域',status:'pending'},
            {label:'擦除字幕…',doneLabel:'已擦除字幕',status:'pending'},
            {label:'擦除水印…',doneLabel:'画面干净了',status:'pending'}
        ],
        subtitle:[
            {label:'识别语音…',doneLabel:'语音识别完成',status:'pending'},
            {label:'翻译成'+tgt+'…',doneLabel:'翻译完成',status:'pending'},
            {label:'排版压制…',doneLabel:'字幕生成完成',status:'pending'}
        ],
        voice:[
            {label:'分析语气情绪…',doneLabel:'情绪分析完成',status:'pending'},
            {label:'克隆音色…',doneLabel:'音色采样完成',status:'pending'},
            {label:'录制'+tgt+'配音…',doneLabel:'配音生成完成',status:'pending'}
        ]
    };
}

async function startRealFlow() {
    buildRealSubTasks();

    // 1. 导演开头
    setTimeout(()=>{
        appendBubble('ai', '好，素材收到了。' + (activeSteps.length === 3 ? '陈默先擦画面，明远跟上翻译，苏雅最后配音。' : '马上开始处理。') + '<br><span style="font-size:.72rem;color:var(--glass-text3)">⏱️ 处理时间取决于视频长度，请耐心等待</span>', 0, 'director');
        scrollChat();
    }, 0);

    // 2. 三个角色各一个气泡（含进度卡片，后续原地更新）
    let cd = 1000;
    activeSteps.forEach(step=>{
        const rk = stepRoleMap[step];
        setTimeout(()=>{
            const b = appendBubble('ai', rnd(ROLES[rk].checkIn||['']), 0, rk);
            progressCards[step] = b;
            updatePC(step, 'pending', stepSubTasks[step]);
            scrollChat();
        }, cd);
        cd += 600;
    });

    // 3. 发起 API
    setTimeout(async ()=>{
        if(typeof TideoTracker!=='undefined') TideoTracker.phaseStart('mps_submit');
        try {
            console.log('[Tideo] 发起真实 API, videoUrl:', videoUrl, 'mode:', workflowMode);
            const result = await TideoAPI.translate({
                videoUrl: videoUrl,
                mode: workflowMode,
                srcLang: srcLang,
                dstLang: dstLang
            });
            apiTaskId = result.taskId;
            mpsStartTime = Date.now();
            console.log('[Tideo] TaskId:', apiTaskId);
            if(typeof TideoTracker!=='undefined') TideoTracker.milestone('mps_task_created');

            // 第一个步骤标为 active
            if(activeSteps.length) {
                markSubTasksActive(activeSteps[0], 0);
            }

            pollMPSTask();

        } catch(err) {
            console.error('[Tideo] API 提交失败:', err);
            appendBubble('ai', '⚠️ 任务提交出了问题: ' + err.message + '<br>切换到演示模式。', 0, 'director');
            scrollChat();
            setTimeout(()=> startSimulatedFlow(), 2000);
        }
    }, cd + 400);
}

/* ===== 恢复模式：从后台回来继续轮询 ===== */
function startRestoreFlow() {
    buildRealSubTasks();

    // 导演说"欢迎回来"
    appendBubble('ai', '欢迎回来。任务还在跑，我继续盯着。', 0, 'director');
    scrollChat();

    // 创建角色气泡 + 进度卡片
    let cd = 600;
    activeSteps.forEach(step => {
        const rk = stepRoleMap[step];
        setTimeout(() => {
            const b = appendBubble('ai', '在的，继续。', 0, rk);
            progressCards[step] = b;
            updatePC(step, 'active', stepSubTasks[step]);
            scrollChat();
        }, cd);
        cd += 400;
    });

    // 立即开始轮询
    setTimeout(() => {
        console.log('[Tideo] 恢复轮询, TaskId:', apiTaskId);
        pollMPSTask();
    }, cd + 200);
}

// 根据 MPS 时间估算进度，驱动卡片原地更新（不新增气泡）
function driveCardsByProgress(progress) {
    // progress: 0~1
    // 根据步骤数量均分进度区间
    const n = activeSteps.length;
    activeSteps.forEach((step, idx) => {
        const stepStart = idx / n;
        const stepEnd = (idx + 1) / n;

        if(progress < stepStart) {
            // 还没到这一步
            // 保持 pending（不动）
        } else if(progress < stepEnd) {
            // 正在这一步
            const subProgress = (progress - stepStart) / (stepEnd - stepStart);
            driveSubTasksByProgress(step, subProgress);
        } else {
            // 这一步已完成
            if(stepSubTasks[step] && !stepSubTasks[step].every(t=>t.status==='done')) {
                markSubTasksAllDone(step);
                features[step] = true;
            }
        }
    });
}

function driveSubTasksByProgress(step, subProgress) {
    const tasks = stepSubTasks[step];
    if(!tasks || !tasks.length) return;
    const doneCount = Math.floor(subProgress * tasks.length);
    let changed = false;
    tasks.forEach((t, i) => {
        const newStatus = i < doneCount ? 'done' : (i === doneCount ? 'active' : 'pending');
        if(t.status !== newStatus) { t.status = newStatus; changed = true; }
    });
    if(changed) {
        const allDone = tasks.every(t => t.status === 'done');
        updatePC(step, allDone ? 'done' : 'active', tasks);
    }
}

function markSubTasksActive(step, fromIdx) {
    const tasks = stepSubTasks[step];
    if(!tasks) return;
    tasks.forEach((t,i) => { if(i === fromIdx) t.status = 'active'; });
    updatePC(step, 'active', tasks);
}

function markSubTasksAllDone(step) {
    const tasks = stepSubTasks[step];
    if(!tasks) return;
    tasks.forEach(t => t.status = 'done');
    updatePC(step, 'done', tasks);
}

async function pollMPSTask() {
    if(!apiTaskId) return;
    pollCount++;
    const elapsed = Math.floor((Date.now() - mpsStartTime) / 1000);

    try {
        const task = await TideoAPI.getTask(apiTaskId);
        console.log('[Tideo] 轮询 #' + pollCount + ' → ' + task.status + ' (' + elapsed + 's)');

        if(task.status === 'WAITING') {
            if(typeof TideoTracker!=='undefined' && pollCount===1) TideoTracker.mpsStatus('WAITING', elapsed);
            setTimeout(pollMPSTask, 5000);

        } else if(task.status === 'PROCESSING') {
            if(typeof TideoTracker!=='undefined' && pollCount<=2) TideoTracker.mpsStatus('PROCESSING', elapsed);
            const estTotalSec = Math.max(180, realVideoDuration * 4);
            const progress = Math.min(0.92, elapsed / estTotalSec);

            // 只更新卡片内的子任务状态，不新增气泡
            driveCardsByProgress(progress);

            setTimeout(pollMPSTask, 5000);

        } else if(task.status === 'FINISH') {
            apiResult = task;
            const detail = task.detail || {};

            if(detail.ErrCode && detail.ErrCode !== 0) {
                appendBubble('ai', '出了点问题：<strong>' + (detail.Message || '处理失败，错误码 ' + detail.ErrCode) + '</strong><br>检查一下视频格式？或者稍后再试。', 0, 'director');
                scrollChat();
            } else {
                // 成功！所有卡片推到完成
                driveCardsByProgress(1.0);
                activeSteps.forEach(step => {
                    markSubTasksAllDone(step);
                    unlockTab(step);
                    features[step] = true;
                });

                extractOutputUrl(detail);
                setTimeout(()=> showRealResult(elapsed), 1200);
            }
        }
    } catch(err) {
        console.warn('[Tideo] 轮询出错，5s后重试:', err.message);
        setTimeout(pollMPSTask, 5000);
    }
}

function extractOutputUrl(detail) {
    if(!detail.AiAnalysisResultSet) return;
    detail.AiAnalysisResultSet.forEach(r => {
        if(r.Type === 'DeLogo' && r.DeLogoTask && r.DeLogoTask.Output) {
            const out = r.DeLogoTask.Output;
            if(out.Path && out.OutputStorage && out.OutputStorage.CosOutputStorage) {
                const cos = out.OutputStorage.CosOutputStorage;
                outputVideoUrl = 'https://' + cos.Bucket + '.cos.' + cos.Region + '.myqcloud.com' + out.Path;
                console.log('[Tideo] 成片 URL:', outputVideoUrl);
            }
        }
    });
}

function showRealResult(elapsed) {
    if(typeof TideoTracker!=='undefined') {
        TideoTracker.milestone('mps_complete_' + elapsed + 's');
        TideoTracker.milestone('mps_complete');
        TideoTracker.milestone('view_result');
    }
    // 保存任务记录到 localStorage
    saveTaskRecord('done', elapsed);
    phase = 'done';
    phaseDot.className = 'v8-pd done';
    phaseLabel.textContent = '译制完成 · 可预览或导出';

    const feats=[];
    if(features.erase)feats.push('画面擦除');
    if(features.subtitle)feats.push('字幕翻译');
    if(features.voice)feats.push('AI 配音');
    const ft=feats.join('、');
    const timeStr = fmt(elapsed);

    let resultHtml = '完美，干得漂亮！让我们来看看成片 🎉🎉';

    if(outputVideoUrl) {
        resultHtml += '<div class="chat-video-preview" onclick="var v=this.querySelector(\'video\');if(v.paused){v.play();this.querySelector(\'.cvp-play\').style.display=\'none\'}else{v.pause();this.querySelector(\'.cvp-play\').style.display=\'flex\'}">' +
            '<video style="width:100%;display:block;border-radius:12px" src="' + outputVideoUrl + '" preload="metadata"></video>' +
            '<div class="cvp-play" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;border-radius:12px">' +
                '<div style="width:48px;height:48px;border-radius:50%;background:rgba(0,0,0,0.45);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center">' +
                    '<svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M5 3L12 8L5 13V3Z" fill="#fff"/></svg>' +
                '</div>' +
            '</div>' +
        '</div>';
        videoEl.src = outputVideoUrl;
        videoEl.load();
        playing = true;
        updatePlayIcons();
    }

    resultHtml += '<div class="chat-result-actions"><div class="chat-result-actions-row">' +
        '<button class="ra-btn-refine" id="chatRefBtn"><span>手动精调</span><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 12L12 4M12 4H6M12 4V10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>' +
        (outputVideoUrl ?
        '<a class="ra-btn-download" href="' + outputVideoUrl + '" target="_blank" download><span>导出视频</span><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 2V10M8 10L11 7M8 10L5 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 12V13C3 13.55 3.45 14 4 14H12C12.55 14 13 13.55 13 13V12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></a>' :
        '<button class="ra-btn-download" onclick="alert(\'导出中...\')"><span>导出视频</span><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 2V10M8 10L11 7M8 10L5 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 12V13C3 13.55 3.45 14 4 14H12C12.55 14 13 13.55 13 13V12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>') +
        '</div></div>';

    resultBubble = appendBubble('ai', resultHtml, 0, 'director');
    scrollChat();

    setTimeout(()=>{
        const rb = document.getElementById('chatRefBtn');
        if(rb){
            const fs = activeSteps.find(s=>features[s]);
            if(fs) rb.addEventListener('click', ()=>{ turnLightsOn(); enterFinetune(fs); });
        }
    }, 100);

    if(!inFinetune) scheduleLightsOff(2000);
    saveState();
}

/* ===== 模拟流程 Fallback ===== */
function startSimulatedFlow() {
    const tgt=LANG_NAMES[dstLang]||dstLang;
    stepSubTasks={
        erase:[
            {label:'扫描画面…',doneLabel:'发现字幕和水印',phase:'扫描画面…',status:'pending',duration:3500},
            {label:'擦除字幕…',doneLabel:'已擦除字幕',phase:'擦除字幕…',status:'pending',duration:4000},
            {label:'擦除水印…',doneLabel:'画面干净了',phase:'擦除水印…',status:'pending',duration:3000}
        ],
        subtitle:[
            {label:'识别语音…',doneLabel:'识别完成',phase:'识别语音…',status:'pending',duration:3500},
            {label:'翻译成'+tgt+'…',doneLabel:'翻译完成',phase:'翻译成'+tgt+'…',status:'pending',duration:4000},
            {label:'排版压制…',doneLabel:'字幕生成完成',phase:'排版压制…',status:'pending',duration:2500}
        ],
        voice:[
            {label:'分析语气情绪…',doneLabel:'情绪分析完成',phase:'分析情绪…',status:'pending',duration:3000},
            {label:'克隆音色…',doneLabel:'音色采样完成',phase:'克隆音色…',status:'pending',duration:3500},
            {label:'录制'+tgt+'配音…',doneLabel:'配音生成完成',phase:'录制配音…',status:'pending',duration:4000}
        ]
    };
    // Fill dummy data if empty
    if(!subtitleItems.length) {
        subtitleItems.push({id:'S1',orig:'示例原文',trans:'Example translation',startSec:2,endSec:5});
    }
    if(!voiceItems.length) {
        voiceItems.push({id:'V1',text:'Example voiceover',startSec:2,endSec:5});
    }

    let cd=3200;
    activeSteps.forEach(step=>{
        const rk=stepRoleMap[step];
        setTimeout(()=>{const b=appendBubble('ai',rnd(ROLES[rk].checkIn||['']),0,rk);progressCards[step]=b;scrollChat()},cd);
        cd+=1000;
    });
    setTimeout(()=>advanceStep(),cd+600);
}

/* ===== SubTask Engine (for simulated flow) ===== */
function runSubTasks(step,done){
    const tasks=stepSubTasks[step];if(!tasks||!tasks.length){if(done)done();return}
    let idx=0;
    function handleErase(i,p){
        if(step!=='erase')return;
        if(p==='start'&&i===1&&subtitleItems.length){burntSub.classList.remove('erased','erasing');burntSub.innerHTML='<span class="bs-bar"><span class="bs-text">'+subtitleItems[0].orig+'</span></span>';burntSub.classList.add('visible');setTimeout(()=>burntSub.classList.add('erasing'),300)}
        if(p==='done'&&i===1){burntSub.classList.remove('visible','erasing');burntSub.classList.add('erased')}
    }
    function next(){
        if(idx>=tasks.length){updatePC(step,'done',tasks);if(done)done();return}
        const t=tasks[idx];t.status='active';
        updatePC(step,'active',tasks);
        if(t.phase){phaseDot.className='v8-pd proc';phaseLabel.textContent=t.phase;phaseEl.classList.add('vis')}
        handleErase(idx,'start');scrollChat();
        setTimeout(()=>{t.status='done';updatePC(step,'active',tasks);handleErase(idx,'done');scrollChat();idx++;setTimeout(next,800)},t.duration);
    }
    next();
}

/* ===== Step Advance (simulated flow) ===== */
function advanceStep(){
    if(stepsPaused||inFinetune)return;
    currentStep++;
    if(currentStep>=activeSteps.length){setTimeout(showStartBtn,800);return}
    const step=activeSteps[currentStep];
    setTimeout(()=>{
        updatePC(step,'active',stepSubTasks[step]);
        setTimeout(()=>{
            runSubTasks(step,()=>{
                if(step==='subtitle')scriptReady=true;
                setTimeout(()=>confirmStep(step),800);
            });
        },1500);
    },currentStep>0?2000:400);
}

function confirmStep(step){
    features[step]=true;if(step==='subtitle')scriptReady=true;
    showFlash(step);unlockTab(step);
    pendingAdvance=step;
    saveState();
    setTimeout(()=>{if(!inFinetune&&!stepsPaused){advanceStep();pendingAdvance=null}},1200);
}

function showFlash(step){
    const fl=document.getElementById('stepFlash'),tx=document.getElementById('flashText'),dt=document.getElementById('flashDot');
    const lm={erase:'画面擦除完成',subtitle:'字幕翻译完成',voice:'配音生成完成'};
    const cm={erase:'#7c3aed',subtitle:'#2563eb',voice:'#ec4899'};
    tx.textContent=lm[step]||'完成';dt.style.background=cm[step]||'#818cf8';
    fl.classList.remove('active');void fl.offsetWidth;fl.classList.add('active');
    setTimeout(()=>fl.classList.remove('active'),1500);
}

function showStartBtn(){
    if(inFinetune){stepsPaused=true;return}
    startProcessing();
}

function startProcessing(){
    phase='processing';phaseDot.className='v8-pd proc';phaseLabel.textContent='最终渲染中…';phaseEl.classList.add('vis');
    if(typeof TideoTracker!=='undefined') TideoTracker.phaseStart('processing');

    // 导演发出带 loading 预览卡的气泡
    var loadingHtml = '期待你的精彩成片！🎉🎉' +
        '<div class="chat-video-preview chat-video-loading" id="resultPreviewCard">' +
            '<div class="cvp-loading-bg">' +
                '<svg class="cvp-loading-star" width="48" height="48" viewBox="0 0 24 24"><path d="M12 0C12.4 6.4 17.6 11.6 24 12C17.6 12.4 12.4 17.6 12 24C11.6 17.6 6.4 12.4 0 12C6.4 11.6 11.6 6.4 12 0Z" fill="#fff"/></svg>' +
                '<svg class="cvp-loading-star-sm" width="24" height="24" viewBox="0 0 24 24"><path d="M12 0C12.4 6.4 17.6 11.6 24 12C17.6 12.4 12.4 17.6 12 24C11.6 17.6 6.4 12.4 0 12C6.4 11.6 11.6 6.4 12 0Z" fill="#fff" opacity="0.6"/></svg>' +
            '</div>' +
        '</div>';

    resultBubble = appendBubble('ai', loadingHtml, 0, 'director');
    scrollChat();

    // 1.5 秒后切换到结果
    setTimeout(showSimResult, 2500);
}

function showSimResult(){
    phase='done';phaseDot.className='v8-pd done';phaseLabel.textContent='译制完成 · 可预览或导出';
    saveTaskRecord('done', 0);
    playing=true;updatePlayIcons();

    // 视频预览：直接用 video 元素
    var videoSrc = videoEl.src || '';
    var thumbHtml = '<div class="chat-video-preview" onclick="var v=this.querySelector(\'video\');if(v){if(v.paused){v.play();this.querySelector(\'.cvp-play\').style.display=\'none\'}else{v.pause();this.querySelector(\'.cvp-play\').style.display=\'flex\'}}">' +
        '<video style="width:100%;display:block;border-radius:12px" src="' + videoSrc + '" preload="metadata"></video>' +
        '<div class="cvp-play" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;border-radius:12px">' +
            '<div style="width:48px;height:48px;border-radius:50%;background:rgba(0,0,0,0.45);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center">' +
                '<svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M5 3L12 8L5 13V3Z" fill="#fff"/></svg>' +
            '</div>' +
        '</div>' +
    '</div>';

    var btnsHtml = '<div class="chat-result-actions"><div class="chat-result-actions-row">' +
        '<button class="ra-btn-refine" id="chatRefBtn"><span>手动精调</span><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 12L12 4M12 4H6M12 4V10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>' +
        '<button class="ra-btn-download" onclick="alert(\'导出中...\')"><span>导出视频</span><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 2V10M8 10L11 7M8 10L5 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 12V13C3 13.55 3.45 14 4 14H12C12.55 14 13 13.55 13 13V12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>' +
        '</div></div>';

    // 更新已有气泡：替换 msg + loading 卡为视频预览 + 按钮
    if(resultBubble) {
        var body = resultBubble.querySelector('.bubble-body');
        if(body) {
            var msgEl = body.querySelector('.role-msg');
            if(msgEl) msgEl.innerHTML = '完美，干得漂亮！让我们来看看成片 🎉🎉';
            var loadingCard = body.querySelector('.chat-video-loading');
            if(loadingCard) loadingCard.remove();
            body.insertAdjacentHTML('beforeend', thumbHtml + btnsHtml);
        }
    }
    scrollChat();

    setTimeout(()=>{const rb=document.getElementById('chatRefBtn');if(rb){const fs=activeSteps.find(s=>features[s]);if(fs)rb.addEventListener('click',()=>{turnLightsOn();enterFinetune(fs)})}},100);
    if(!inFinetune) scheduleLightsOff(2000);
    saveState();
}

/* ===== Lights ===== */
let _lightsOffTimer=null;
function turnLightsOff(){
    if(lightsOff||inFinetune||chatCollapsed)return;
    lightsOff=true;
    page.classList.add('lights-off');
    document.getElementById('dimmer').classList.add('active');
    const vid=document.getElementById('v8Vid');
    vid.style.zIndex='52';
}
function turnLightsOn(){
    if(!lightsOff)return;lightsOff=false;
    if(_lightsOffTimer){clearTimeout(_lightsOffTimer);_lightsOffTimer=null}
    page.classList.remove('lights-off');
    document.getElementById('dimmer').classList.remove('active');
    document.getElementById('v8Vid').style.zIndex='';
    if(compareActive)exitCompare();
}
function scheduleLightsOff(delay){
    if(_lightsOffTimer)clearTimeout(_lightsOffTimer);
    _lightsOffTimer=setTimeout(()=>{_lightsOffTimer=null;turnLightsOff()},delay||1500);
}

document.getElementById('dimBg').addEventListener('click',turnLightsOn);
document.getElementById('dimLightBtn').addEventListener('click',turnLightsOn);
document.getElementById('dimRefBtn').addEventListener('click',()=>{turnLightsOn();const fs=activeSteps.find(s=>features[s]);if(fs)enterFinetune(fs)});

/* ===== Compare ===== */
const cmpEl=document.getElementById('cmpOrig');
const cmpVid=document.getElementById('cmpVideo');
document.getElementById('dimCmpBtn').addEventListener('click',()=>{if(compareActive)exitCompare();else enterCompare()});

function enterCompare(){
    if(compareActive)return;compareActive=true;
    // 对比模式：原片用原始 videoUrl，成片用 outputVideoUrl 或当前视频
    if(videoUrl) cmpVid.src = videoUrl;
    page.classList.add('compare-mode');
    cmpVid.currentTime=videoEl.currentTime;if(playing)cmpVid.play().catch(()=>{});
    cmpEl.classList.add('active');
    document.getElementById('cmpResLabel').style.display='';
}
function exitCompare(){
    if(!compareActive)return;compareActive=false;
    page.classList.remove('compare-mode');
    cmpEl.classList.remove('active');cmpVid.pause();
    document.getElementById('cmpResLabel').style.display='none';
}

/* ===== Finetune ===== */
const titleMap={erase:'擦除精调',subtitle:'字幕精调',voice:'配音精调'};
const descMap={erase:'调整擦除区域和参数',subtitle:'编辑字幕内容和样式',voice:'调整配音音色和语速'};

function enterFinetune(step){
    turnLightsOn();if(_lightsOffTimer){clearTimeout(_lightsOffTimer);_lightsOffTimer=null}
    inFinetune=true;currentFtStep=step;stepsPaused=true;
    page.classList.add('ft-mode');
    const ftVC=document.getElementById('ftVideoCard');
    const vid=document.getElementById('v8Vid');
    vid.style.zIndex='';
    ftVC.appendChild(vid);
    ftPauseBubble=appendBubble('ai','🔧 <strong>精调进行中</strong> — 对话已暂停，完成精调后继续',0,'director');
    scrollChat();
    setActiveTab(step);
    document.getElementById('ftTitle').textContent=titleMap[step]||'精调';
    document.getElementById('ftDesc').textContent=descMap[step]||'';
    document.querySelectorAll('.v8-fp').forEach(p=>p.classList.remove('active'));
    const panel=document.querySelector('.v8-fp[data-fp="'+step+'"]');if(panel)panel.classList.add('active');
    if(step==='erase'){editingErase=null;renderEraseList()}
    else if(step==='subtitle'){editingSub=null;renderSubList()}
    else if(step==='voice'){editingVoice=null;renderVoiceList()}
    rebuildFtTimeline(step);
    renderEraseOverlays();updateSubPreview();updateVoicePreview();
    phaseDot.className='v8-pd';phaseLabel.textContent='精调模式';phaseEl.classList.add('vis');
    document.getElementById('scrub').classList.add('vis');
    updatePC(step,'done',stepSubTasks[step]);
    saveState();
}

function exitFinetune(){
    const wasStep=currentFtStep;inFinetune=false;currentFtStep=null;
    if(typeof TideoTracker!=='undefined') TideoTracker.milestone('finetune_edit');
    page.classList.remove('ft-mode');clearActiveTab();
    const vid=document.getElementById('v8Vid');
    document.getElementById('v8SyncInner').appendChild(vid);
    vid.style.zIndex='';
    clearFtTimeline();
    eraseOC.innerHTML='';eraseOC.classList.remove('int');
    subPreview.classList.remove('visible');voicePreview.classList.remove('visible');
    if(ftPauseBubble&&ftPauseBubble.parentNode){ftPauseBubble.parentNode.removeChild(ftPauseBubble);ftPauseBubble=null}
    phaseLabel.textContent='请在对话中继续';
    if(wasStep){fineTunedSteps[wasStep]=true;if(progressCards[wasStep])updatePC(wasStep,'done',stepSubTasks[wasStep])}
    if(phase==='done'){
        const ftLabel=titleMap[wasStep]||'精调';

        // 1. 导演新气泡：期待精调结果 + loading 预览卡
        var loadingHtml = '已收到你的' + ftLabel + '修改，正在重新渲染成片…' +
            '<div class="chat-video-preview chat-video-loading" id="ftResultPreviewCard">' +
                '<div class="cvp-loading-bg">' +
                    '<svg class="cvp-loading-star" width="48" height="48" viewBox="0 0 24 24"><path d="M12 0C12.4 6.4 17.6 11.6 24 12C17.6 12.4 12.4 17.6 12 24C11.6 17.6 6.4 12.4 0 12C6.4 11.6 11.6 6.4 12 0Z" fill="#fff"/></svg>' +
                    '<svg class="cvp-loading-star-sm" width="24" height="24" viewBox="0 0 24 24"><path d="M12 0C12.4 6.4 17.6 11.6 24 12C17.6 12.4 12.4 17.6 12 24C11.6 17.6 6.4 12.4 0 12C6.4 11.6 11.6 6.4 12 0Z" fill="#fff" opacity="0.6"/></svg>' +
                '</div>' +
            '</div>';

        resultBubble = appendBubble('ai', loadingHtml, 0, 'director');
        scrollChat();

        // 2. 延迟后切换为结果视频 + 按钮
        setTimeout(function(){
            if(!resultBubble) return;
            var body = resultBubble.querySelector('.bubble-body');
            if(!body) return;

            var videoSrc = outputVideoUrl || videoEl.src || '';
            var feats=[];if(features.erase)feats.push('画面擦除');if(features.subtitle)feats.push('字幕翻译');if(features.voice)feats.push('AI 配音');
            var ft=feats.join('、');

            // 更新消息文字
            var msgEl = body.querySelector('.role-msg');
            if(msgEl) msgEl.innerHTML = ftLabel + '已更新，' + ft + '全部到位。来看看新成片！';

            // 移除 loading 卡
            var loadingCard = body.querySelector('.chat-video-loading');
            if(loadingCard) loadingCard.remove();

            // 添加视频预览
            var thumbHtml = '<div class="chat-video-preview" onclick="var v=this.querySelector(\'video\');if(v){if(v.paused){v.play();this.querySelector(\'.cvp-play\').style.display=\'none\'}else{v.pause();this.querySelector(\'.cvp-play\').style.display=\'flex\'}}">' +
                '<video style="width:100%;display:block;border-radius:12px" src="' + videoSrc + '" preload="metadata"></video>' +
                '<div class="cvp-play" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;border-radius:12px">' +
                    '<div style="width:48px;height:48px;border-radius:50%;background:rgba(0,0,0,0.45);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center">' +
                        '<svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M5 3L12 8L5 13V3Z" fill="#fff"/></svg>' +
                    '</div>' +
                '</div>' +
            '</div>';

            // 添加按钮（使用正确的 CSS 类）
            var btnsHtml = '<div class="chat-result-actions"><div class="chat-result-actions-row">' +
                '<button class="ra-btn-refine" id="chatRefBtn"><span>再次精调</span><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 12L12 4M12 4H6M12 4V10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>' +
                (outputVideoUrl ?
                '<a class="ra-btn-download" href="' + outputVideoUrl + '" target="_blank" download><span>导出视频</span><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 2V10M8 10L11 7M8 10L5 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 12V13C3 13.55 3.45 14 4 14H12C12.55 14 13 13.55 13 13V12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></a>' :
                '<button class="ra-btn-download" onclick="alert(\'导出中...\')"><span>导出视频</span><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 2V10M8 10L11 7M8 10L5 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 12V13C3 13.55 3.45 14 4 14H12C12.55 14 13 13.55 13 13V12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>') +
                '</div></div>';

            body.insertAdjacentHTML('beforeend', thumbHtml + btnsHtml);
            scrollChat();

            // 绑定再次精调按钮
            setTimeout(function(){
                var rb=document.getElementById('chatRefBtn');
                if(rb){var fs=activeSteps.find(function(s){return features[s]});if(fs)rb.addEventListener('click',function(){turnLightsOn();enterFinetune(fs)})}
            },100);

            scheduleLightsOff(1500);
        }, 2000);
    }else{
        stepsPaused=false;
        if(pendingAdvance===wasStep){pendingAdvance=null;setTimeout(advanceStep,600)}
        else{setTimeout(advanceStep,600)}
    }
    saveState();
}

document.querySelectorAll('.v8-done-fp').forEach(btn=>{btn.addEventListener('click',()=>{if(isFinetuneEntry){location.href='create.html';return}if(inFinetune)exitFinetune()})});
document.querySelectorAll('.v8-cancel-fp').forEach(btn=>{btn.addEventListener('click',()=>{if(isFinetuneEntry){location.href='create.html';return}if(inFinetune)exitFinetune()})});

/* ===== Tabs ===== */
function unlockTab(step){unlockedTabs[step]=true;const t=document.getElementById('tab'+step.charAt(0).toUpperCase()+step.slice(1));if(t){t.classList.remove('locked');t.classList.add('unlocked')}}
function setActiveTab(step){document.querySelectorAll('.v8-tab').forEach(t=>{t.classList.remove('active');if(unlockedTabs[t.dataset.tab])t.classList.add('unlocked')});const t=document.getElementById('tab'+step.charAt(0).toUpperCase()+step.slice(1));if(t){t.classList.remove('unlocked');t.classList.add('active')}}
function clearActiveTab(){document.querySelectorAll('.v8-tab').forEach(t=>{t.classList.remove('active');if(unlockedTabs[t.dataset.tab])t.classList.add('unlocked')})}

document.querySelectorAll('.v8-tab').forEach(tab=>{
    tab.addEventListener('click',()=>{
        const k=tab.dataset.tab;if(!unlockedTabs[k])return;
        if(inFinetune&&currentFtStep===k)return;
        if(inFinetune){
            currentFtStep=k;
            document.querySelectorAll('.v8-fp').forEach(p=>p.classList.remove('active'));
            const panel=document.querySelector('.v8-fp[data-fp="'+k+'"]');if(panel)panel.classList.add('active');
            setActiveTab(k);
            document.getElementById('ftTitle').textContent=titleMap[k]||'精调';
            document.getElementById('ftDesc').textContent=descMap[k]||'';
            rebuildFtTimeline(k);
            renderEraseOverlays();updateSubPreview();updateVoicePreview();
        }else{enterFinetune(k)}
    });
});

/* ===== Render Lists ===== */
let editSnapshot=null;

function renderEraseList(){
    const el=document.getElementById('eList');document.getElementById('eCount').textContent=eraseRegions.length;
    el.innerHTML=eraseRegions.map(r=>{
        const isEd=r.id===editingErase;
        return '<div class="frc'+(r.id===activeErase?' active':'')+'" data-r="'+r.id+'">'+
            '<div class="frc-head">'+
                '<span class="fri">'+r.id+'</span>'+
                '<span class="frc-time">'+fmt(r.startSec)+' – '+fmt(r.endSec)+'</span>'+
                '<button class="fre" data-e="'+r.id+'" title="编辑"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M10 2L12 4L5 11H3V9L10 2Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg></button>'+
                '<button class="frd" data-d="'+r.id+'" title="删除"><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 5V13C4 13.55 4.45 14 5 14H11C11.55 14 12 13.55 12 13V5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 5H13" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M6 5V3.5C6 3.22 6.22 3 6.5 3H9.5C9.78 3 10 3.22 10 3.5V5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>'+
            '</div>'+
            '<div class="fie'+(isEd?' expanded':'')+'" data-ee="'+r.id+'">'+
                '<div class="fie-title">编辑擦除区域</div>'+
                '<div class="fier"><span class="fiel">单位</span><div class="fie-radio"><label><input type="radio" name="unit_'+r.id+'" value="pct" checked> 百分比</label><label><input type="radio" name="unit_'+r.id+'" value="px"> PX</label></div></div>'+
                '<div class="fier"><span class="fiel">位置</span><div class="fie-grid"><div class="fie-field"><label>X</label><input value="'+r.x+'" data-f="x" data-id="'+r.id+'"><span class="fie-field-unit">px</span></div><div class="fie-field"><label>Y</label><input value="'+r.y+'" data-f="y" data-id="'+r.id+'"><span class="fie-field-unit">px</span></div></div></div>'+
                '<div class="fier"><span class="fiel">尺寸</span><div class="fie-grid"><div class="fie-field"><label>W</label><input value="'+r.w+'" data-f="w" data-id="'+r.id+'"><span class="fie-field-unit">px</span></div><div class="fie-field"><label>H</label><input value="'+r.h+'" data-f="h" data-id="'+r.id+'"><span class="fie-field-unit">px</span></div></div></div>'+
                '<div class="fier"><span class="fiel">开始结束时间</span><div class="fie-time"><input class="fie-s" value="'+fmt(r.startSec)+'" data-f="startSec" data-id="'+r.id+'"><span class="fie-sep">–</span><input class="fie-e" value="'+fmt(r.endSec)+'" data-f="endSec" data-id="'+r.id+'"></div></div>'+
                '<div class="fie-actions"><button class="fie-cancel" data-id="'+r.id+'">取消</button><button class="fie-save" data-id="'+r.id+'">保存</button></div>'+
            '</div>'+
        '</div>';
    }).join('');
    bindEraseEvents();
    if(editingErase){const card=el.querySelector('.frc[data-r="'+editingErase+'"]');if(card)card.scrollIntoView({block:'nearest',behavior:'smooth'})}
}
function bindEraseEvents(){
    const el=document.getElementById('eList');
    el.querySelectorAll('.frc').forEach(card=>{card.addEventListener('click',e=>{
        if(e.target.closest('.frd')||e.target.closest('.fre')||e.target.closest('.fie'))return;
        const id=card.dataset.r;activeErase=id;
        el.querySelectorAll('.frc').forEach(c=>c.classList.remove('active'));card.classList.add('active');
        const r=eraseRegions.find(x=>x.id===id);if(r){videoTime=r.startSec;needsVideoSync=true}
        if(inFinetune)selectSeg(id,currentFtStep);
    })});
    el.querySelectorAll('.fre').forEach(btn=>{btn.addEventListener('click',e=>{
        e.stopPropagation();const id=btn.dataset.e;
        if(editingErase===id){editingErase=null;editSnapshot=null;renderEraseList();return}
        const r=eraseRegions.find(x=>x.id===id);if(r)editSnapshot=JSON.parse(JSON.stringify(r));
        editingErase=id;renderEraseList();
    })});
    el.querySelectorAll('.frd').forEach(btn=>{btn.addEventListener('click',e=>{e.stopPropagation();deleteErase(btn.dataset.d)})});
    el.querySelectorAll('.fie input').forEach(inp=>{inp.addEventListener('click',e=>e.stopPropagation())});
    el.querySelectorAll('.fie-save').forEach(btn=>{btn.addEventListener('click',e=>{
        e.stopPropagation();const id=btn.dataset.id;
        const panel=el.querySelector('.fie[data-ee="'+id+'"]');if(!panel)return;
        const r=eraseRegions.find(x=>x.id===id);if(!r)return;
        panel.querySelectorAll('input[data-f]').forEach(inp=>{
            const f=inp.dataset.f;
            if(f==='startSec'||f==='endSec'){const v=parseT(inp.value);if(v!==null)r[f]=v}
            else if(['x','y','w','h'].includes(f)){const v=parseFloat(inp.value);if(!isNaN(v))r[f]=v}
            else{r[f]=inp.value}
        });
        editingErase=null;editSnapshot=null;
        renderEraseList();renderEraseOverlays();if(inFinetune)rebuildFtTimeline(currentFtStep);
    })});
    el.querySelectorAll('.fie-cancel').forEach(btn=>{btn.addEventListener('click',e=>{
        e.stopPropagation();const id=btn.dataset.id;
        if(editSnapshot&&editSnapshot.id===id){const r=eraseRegions.find(x=>x.id===id);if(r)Object.assign(r,editSnapshot)}
        editingErase=null;editSnapshot=null;
        renderEraseList();renderEraseOverlays();if(inFinetune)rebuildFtTimeline(currentFtStep);
    })});
}
function deleteErase(id){if(eraseRegions.length<=1)return;const i=eraseRegions.findIndex(r=>r.id===id);if(i===-1)return;eraseRegions.splice(i,1);if(activeErase===id)activeErase=eraseRegions[Math.min(i,eraseRegions.length-1)].id;if(editingErase===id){editingErase=null;editSnapshot=null}renderEraseList();renderEraseOverlays();if(inFinetune)rebuildFtTimeline(currentFtStep)}
document.getElementById('eAddBtn').addEventListener('click',()=>{
    eraseRegionCounter++;const nid='E'+eraseRegionCounter;const t=Math.round(videoTime);
    const r={id:nid,title:'新擦除区域',x:20,y:40,w:60,h:15,startSec:t,endSec:Math.min(t+3,realVideoDuration)};
    eraseRegions.push(r);activeErase=nid;
    editSnapshot=JSON.parse(JSON.stringify(r));editingErase=nid;
    renderEraseList();renderEraseOverlays();if(inFinetune)rebuildFtTimeline(currentFtStep);
    videoTime=t;needsVideoSync=true;
});

let subCounter=0;
function renderSubList(){
    const el=document.getElementById('sList');
    el.innerHTML=subtitleItems.map(s=>{
        const isEd=s.id===editingSub;
        return '<div class="fsi'+(isEd?' active':'')+'" data-s="'+s.id+'">'+
            '<div class="fsi-header">'+
                '<span class="fsi-t">'+s.id+'</span>'+
                '<span class="fsi-time">'+fmt(s.startSec)+' – '+fmt(s.endSec)+'</span>'+
                '<button class="fsi-eb" data-s="'+s.id+'" title="编辑"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M10 2L12 4L5 11H3V9L10 2Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg></button>'+
                '<button class="fsi-del" data-s="'+s.id+'" title="删除"><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 5V13C4 13.55 4.45 14 5 14H11C11.55 14 12 13.55 12 13V5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 5H13" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M6 5V3.5C6 3.22 6.22 3 6.5 3H9.5C9.78 3 10 3.22 10 3.5V5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>'+
            '</div>'+
            '<div class="fsi-tx"><span class="fsi-o">'+esc(s.orig)+'</span><span class="fsi-tr">'+esc(s.trans)+'</span></div>'+
            '<div class="fie'+(isEd?' expanded':'')+'" data-es="'+s.id+'">'+
                '<div class="fie-title">编辑字幕</div>'+
                '<div class="fier"><span class="fiel">开始结束时间</span><div class="fie-time"><input class="fie-s" value="'+fmt(s.startSec)+'" data-f="startSec" data-id="'+s.id+'"><span class="fie-sep">–</span><input class="fie-e" value="'+fmt(s.endSec)+'" data-f="endSec" data-id="'+s.id+'"></div></div>'+
                '<div class="fier"><span class="fiel">原文</span><input class="fiei" value="'+escA(s.orig)+'" data-f="orig" data-id="'+s.id+'"></div>'+
                '<div class="fier"><span class="fiel">译文</span><input class="fiei" value="'+escA(s.trans)+'" data-f="trans" data-id="'+s.id+'"></div>'+
                '<div class="fie-actions"><button class="fie-cancel" data-id="'+s.id+'" data-type="sub">取消</button><button class="fie-save" data-id="'+s.id+'" data-type="sub">保存</button></div>'+
            '</div>'+
        '</div>';
    }).join('');
    bindSubEvents();
}
function bindSubEvents(){
    const el=document.getElementById('sList');
    el.querySelectorAll('.fsi').forEach(item=>{item.addEventListener('click',e=>{
        if(e.target.closest('.fsi-del')){deleteSub(item.dataset.s);return}
        if(e.target.closest('.fsi-eb')){const id=item.dataset.s;if(editingSub===id){editingSub=null;editSnapshot=null;renderSubList();return}const s=subtitleItems.find(x=>x.id===id);if(s)editSnapshot=JSON.parse(JSON.stringify(s));editingSub=id;renderSubList();return;}
        if(e.target.closest('.fie'))return;
        const s=subtitleItems.find(x=>x.id===item.dataset.s);if(s){videoTime=s.startSec;needsVideoSync=true;el.querySelectorAll('.fsi').forEach(i=>i.classList.remove('active'));item.classList.add('active')}
        if(inFinetune)selectSeg(item.dataset.s,currentFtStep);
    })});
    el.querySelectorAll('.fie input').forEach(inp=>{inp.addEventListener('click',e=>e.stopPropagation())});
    el.querySelectorAll('.fie-save[data-type="sub"]').forEach(btn=>{btn.addEventListener('click',e=>{e.stopPropagation();const id=btn.dataset.id;const panel=el.querySelector('.fie[data-es="'+id+'"]');if(!panel)return;const s=subtitleItems.find(x=>x.id===id);if(!s)return;panel.querySelectorAll('input[data-f]').forEach(inp=>{const f=inp.dataset.f;if(f==='startSec'||f==='endSec'){const v=parseT(inp.value);if(v!==null)s[f]=v}else{s[f]=inp.value}});editingSub=null;editSnapshot=null;renderSubList();if(inFinetune)rebuildFtTimeline(currentFtStep);})});
    el.querySelectorAll('.fie-cancel[data-type="sub"]').forEach(btn=>{btn.addEventListener('click',e=>{e.stopPropagation();const id=btn.dataset.id;if(editSnapshot&&editSnapshot.id===id){const s=subtitleItems.find(x=>x.id===id);if(s)Object.assign(s,editSnapshot)}editingSub=null;editSnapshot=null;renderSubList();if(inFinetune)rebuildFtTimeline(currentFtStep);})});
}
function deleteSub(id){if(subtitleItems.length<=1)return;const i=subtitleItems.findIndex(s=>s.id===id);if(i===-1)return;subtitleItems.splice(i,1);if(editingSub===id){editingSub=null;editSnapshot=null}renderSubList();if(inFinetune)rebuildFtTimeline(currentFtStep)}
document.getElementById('sAddBtn').addEventListener('click',()=>{
    subCounter++;const nid='S'+subCounter;const t=Math.round(videoTime);
    subtitleItems.push({id:nid,orig:'新原文',trans:'New translation',startSec:t,endSec:Math.min(t+3,realVideoDuration)});
    editingSub=nid;renderSubList();if(inFinetune)rebuildFtTimeline(currentFtStep);videoTime=t;needsVideoSync=true;
});

let voiceCounter=0;
function renderVoiceList(){
    const el=document.getElementById('vList');
    el.innerHTML=voiceItems.map(v=>{
        const isEd=v.id===editingVoice;
        return '<div class="fvi'+(isEd?' active':'')+'" data-v="'+v.id+'">'+
            '<div class="fvi-header">'+
                '<span class="fvi-t">'+v.id+'</span>'+
                '<span class="fvi-time">'+fmt(v.startSec)+' – '+fmt(v.endSec)+'</span>'+
                '<button class="fvi-p"><svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M3 1.5L10 6L3 10.5V1.5Z" fill="currentColor"/></svg></button>'+
                '<button class="fsi-eb" data-v="'+v.id+'" title="编辑"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M10 2L12 4L5 11H3V9L10 2Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg></button>'+
                '<button class="fvi-del" data-v="'+v.id+'" title="删除"><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 5V13C4 13.55 4.45 14 5 14H11C11.55 14 12 13.55 12 13V5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 5H13" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M6 5V3.5C6 3.22 6.22 3 6.5 3H9.5C9.78 3 10 3.22 10 3.5V5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>'+
            '</div>'+
            '<div class="fvi-tx">'+esc(v.text)+'</div>'+
            '<div class="fie'+(isEd?' expanded':'')+'" data-ev="'+v.id+'">'+
                '<div class="fie-title">编辑配音</div>'+
                '<div class="fier"><span class="fiel">开始结束时间</span><div class="fie-time"><input class="fie-s" value="'+fmt(v.startSec)+'" data-f="startSec" data-id="'+v.id+'"><span class="fie-sep">–</span><input class="fie-e" value="'+fmt(v.endSec)+'" data-f="endSec" data-id="'+v.id+'"></div></div>'+
                '<div class="fier"><span class="fiel">配音语速</span><select class="v8-fts-select" style="flex:1"><option selected>自动</option><option>稍快</option><option>稍慢</option></select></div>'+
                '<div class="fier"><span class="fiel">译文原文</span><input class="fiei" value="'+escA(v.text)+'" data-f="text" data-id="'+v.id+'"></div>'+
                '<div class="fie-actions"><button class="fie-cancel" data-id="'+v.id+'" data-type="voice">取消</button><button class="fie-save" data-id="'+v.id+'" data-type="voice">保存</button></div>'+
            '</div>'+
        '</div>';
    }).join('');
    bindVoiceEvents();
}
function bindVoiceEvents(){
    const el=document.getElementById('vList');
    el.querySelectorAll('.fvi').forEach(item=>{item.addEventListener('click',e=>{
        if(e.target.closest('.fvi-del')){deleteVoice(item.dataset.v);return}
        if(e.target.closest('.fsi-eb')){const id=item.dataset.v;if(editingVoice===id){editingVoice=null;editSnapshot=null;renderVoiceList();return}const v=voiceItems.find(x=>x.id===id);if(v)editSnapshot=JSON.parse(JSON.stringify(v));editingVoice=id;renderVoiceList();return;}
        if(e.target.closest('.fvi-p')||e.target.closest('.fie'))return;
        const v=voiceItems.find(x=>x.id===item.dataset.v);if(v){videoTime=v.startSec;needsVideoSync=true;el.querySelectorAll('.fvi').forEach(i=>i.classList.remove('active'));item.classList.add('active')}
        if(inFinetune)selectSeg(item.dataset.v,currentFtStep);
    })});
    el.querySelectorAll('.fie input').forEach(inp=>{inp.addEventListener('click',e=>e.stopPropagation())});
    el.querySelectorAll('.fie-save[data-type="voice"]').forEach(btn=>{btn.addEventListener('click',e=>{e.stopPropagation();const id=btn.dataset.id;const panel=el.querySelector('.fie[data-ev="'+id+'"]');if(!panel)return;const v=voiceItems.find(x=>x.id===id);if(!v)return;panel.querySelectorAll('input[data-f]').forEach(inp=>{const f=inp.dataset.f;if(f==='startSec'||f==='endSec'){const val=parseT(inp.value);if(val!==null)v[f]=val}else{v[f]=inp.value}});editingVoice=null;editSnapshot=null;renderVoiceList();if(inFinetune)rebuildFtTimeline(currentFtStep);})});
    el.querySelectorAll('.fie-cancel[data-type="voice"]').forEach(btn=>{btn.addEventListener('click',e=>{e.stopPropagation();const id=btn.dataset.id;if(editSnapshot&&editSnapshot.id===id){const v=voiceItems.find(x=>x.id===id);if(v)Object.assign(v,editSnapshot)}editingVoice=null;editSnapshot=null;renderVoiceList();if(inFinetune)rebuildFtTimeline(currentFtStep);})});
}
function deleteVoice(id){if(voiceItems.length<=1)return;const i=voiceItems.findIndex(v=>v.id===id);if(i===-1)return;voiceItems.splice(i,1);if(editingVoice===id){editingVoice=null;editSnapshot=null}renderVoiceList();if(inFinetune)rebuildFtTimeline(currentFtStep)}
document.getElementById('vAddBtn').addEventListener('click',()=>{
    voiceCounter++;const nid='V'+voiceCounter;const t=Math.round(videoTime);
    voiceItems.push({id:nid,text:'New voiceover text',startSec:t,endSec:Math.min(t+3,realVideoDuration)});
    editingVoice=nid;renderVoiceList();if(inFinetune)rebuildFtTimeline(currentFtStep);videoTime=t;needsVideoSync=true;
});

/* ===== Overlays ===== */
function renderEraseOverlays(){
    if(!inFinetune||currentFtStep!=='erase'){eraseOC.innerHTML='';eraseOC.classList.remove('int');return}
    eraseOC.classList.add('int');
    eraseOC.innerHTML=eraseRegions.map(r=>'<div class="erb'+(r.id===activeErase?' active':'')+'" data-rid="'+r.id+'" style="left:'+r.x+'%;top:'+r.y+'%;width:'+r.w+'%;height:'+r.h+'%;display:none"><span class="er-l">'+r.id+'</span><span class="erh erh-nw" data-dir="nw"></span><span class="erh erh-n" data-dir="n"></span><span class="erh erh-ne" data-dir="ne"></span><span class="erh erh-w" data-dir="w"></span><span class="erh erh-e" data-dir="e"></span><span class="erh erh-sw" data-dir="sw"></span><span class="erh erh-s" data-dir="s"></span><span class="erh erh-se" data-dir="se"></span></div>').join('');
    bindOverlayDrag();updateEraseVis();
}
function updateEraseVis(){
    if(!inFinetune||currentFtStep!=='erase')return;
    const t=videoTime;
    eraseRegions.forEach(r=>{const box=eraseOC.querySelector('.erb[data-rid="'+r.id+'"]');if(box)box.style.display=(t>=r.startSec&&t<=r.endSec)?'':'none'});
}
function bindOverlayDrag(){
    eraseOC.querySelectorAll('.erb').forEach(box=>{
        const rid=box.dataset.rid;
        box.addEventListener('mousedown',e=>{
            if(e.target.classList.contains('erh'))return;e.preventDefault();
            activeErase=rid;eraseOC.querySelectorAll('.erb').forEach(b=>b.classList.toggle('active',b.dataset.rid===rid));
            const cr=eraseOC.getBoundingClientRect();const sx=e.clientX,sy=e.clientY;
            const ol=parseFloat(box.style.left),ot=parseFloat(box.style.top);
            const bw=parseFloat(box.style.width),bh=parseFloat(box.style.height);
            function mv(ev){const dx=(ev.clientX-sx)/cr.width*100,dy=(ev.clientY-sy)/cr.height*100;let nx=Math.round(Math.max(0,Math.min(100-bw,ol+dx))),ny=Math.round(Math.max(0,Math.min(100-bh,ot+dy)));box.style.left=nx+'%';box.style.top=ny+'%';const r=eraseRegions.find(x=>x.id===rid);if(r){r.x=nx;r.y=ny}}
            function up(){document.removeEventListener('mousemove',mv);document.removeEventListener('mouseup',up);renderEraseList();rebuildFtTimeline(currentFtStep)}
            document.addEventListener('mousemove',mv);document.addEventListener('mouseup',up);
        });
        box.querySelectorAll('.erh').forEach(h=>{
            h.addEventListener('mousedown',e=>{
                e.stopPropagation();e.preventDefault();
                const dir=h.dataset.dir;const cr=eraseOC.getBoundingClientRect();
                const sx=e.clientX,sy=e.clientY;
                let ol=parseFloat(box.style.left),ot=parseFloat(box.style.top),ow=parseFloat(box.style.width),oh=parseFloat(box.style.height);
                function mv(ev){const dx=(ev.clientX-sx)/cr.width*100,dy=(ev.clientY-sy)/cr.height*100;let nl=ol,nt=ot,nw=ow,nh=oh;if(dir.includes('w')){nl=ol+dx;nw=ow-dx}if(dir.includes('e'))nw=ow+dx;if(dir.includes('n')){nt=ot+dy;nh=oh-dy}if(dir.includes('s'))nh=oh+dy;if(nw<3){nw=3;if(dir.includes('w'))nl=ol+ow-3}if(nh<3){nh=3;if(dir.includes('n'))nt=ot+oh-3}nl=Math.max(0,nl);nt=Math.max(0,nt);if(nl+nw>100)nw=100-nl;if(nt+nh>100)nh=100-nt;nl=Math.round(nl);nt=Math.round(nt);nw=Math.round(nw);nh=Math.round(nh);box.style.left=nl+'%';box.style.top=nt+'%';box.style.width=nw+'%';box.style.height=nh+'%';const r=eraseRegions.find(x=>x.id===rid);if(r){r.x=nl;r.y=nt;r.w=nw;r.h=nh}}
                function up(){document.removeEventListener('mousemove',mv);document.removeEventListener('mouseup',up);renderEraseList();rebuildFtTimeline(currentFtStep)}
                document.addEventListener('mousemove',mv);document.addEventListener('mouseup',up);
            });
        });
    });
}

function updateSubPreview(){
    if(!inFinetune||currentFtStep!=='subtitle'){subPreview.classList.remove('visible');lastSubId=null;return}
    const t=videoTime;const cur=subtitleItems.find(s=>t>=s.startSec&&t<=s.endSec);
    if(cur){if(cur.id!==lastSubId){lastSubId=cur.id;subOrigEl.textContent=cur.orig;subTransEl.textContent=cur.trans}subPreview.classList.add('visible')}
    else{subPreview.classList.remove('visible');lastSubId=null}
}
function updateVoicePreview(){
    if(!inFinetune||currentFtStep!=='voice'){voicePreview.classList.remove('visible');lastVoiceId=null;return}
    const t=videoTime;const cur=voiceItems.find(v=>t>=v.startSec&&t<=v.endSec);
    if(cur){voicePreview.classList.add('visible');lastVoiceId=cur.id}
    else{voicePreview.classList.remove('visible');lastVoiceId=null}
}

/* ===== Timeline ===== */
function assignLanes(items){if(!items.length)return[[]];const sorted=[...items].sort((a,b)=>a.s-b.s);const lanes=[];sorted.forEach(it=>{let placed=false;for(const lane of lanes){const last=lane[lane.length-1];if(it.s>=last.e){lane.push(it);placed=true;break}}if(!placed)lanes.push([it])});return lanes.length?lanes:[[]]}
let selectedSegId=null;
function getDataArr(step){if(step==='erase')return eraseRegions;if(step==='subtitle')return subtitleItems;return voiceItems}
function getItemTime(step,id){const arr=getDataArr(step);const it=arr.find(x=>x.id===id);return it?{s:it.startSec,e:it.endSec}:null}
function setItemTime(step,id,s,e){const arr=getDataArr(step);const it=arr.find(x=>x.id===id);if(!it)return;it.startSec=Math.max(0,Math.round(s*2)/2);it.endSec=Math.min(realVideoDuration,Math.round(e*2)/2);if(it.endSec<=it.startSec)it.endSec=it.startSec+0.5}
function rebuildFtTimeline(step){document.querySelectorAll('.v8-trk').forEach(t=>{t.classList.add('hidden');const c=t.querySelector('.v8-trk-c');if(c)c.innerHTML=''});let items;if(step==='erase')items=eraseRegions.map(r=>({id:r.id,s:r.startSec,e:r.endSec}));else if(step==='subtitle')items=subtitleItems.map(s=>({id:s.id,s:s.startSec,e:s.endSec}));else items=voiceItems.map(v=>({id:v.id,s:v.startSec,e:v.endSec}));const lanes=assignLanes(items);const trkEls=[document.querySelector('.v8-trk[data-track="erase"]'),document.querySelector('.v8-trk[data-track="subtitle"]'),document.querySelector('.v8-trk[data-track="voice"]')];lanes.forEach((lane,li)=>{if(li>=trkEls.length)return;const trk=trkEls[li];trk.classList.remove('hidden');const label=trk.querySelector('.v8-trk-l');if(li===0)label.textContent={erase:'擦除',subtitle:'字幕',voice:'配音'}[step]||step;else label.textContent='';const c=trk.querySelector('.v8-trk-c');c.innerHTML='<div style="position:absolute;inset:0;background:rgba(255,255,255,0.02);border-radius:4px"></div>';lane.forEach(it=>{const lp=(it.s/realVideoDuration)*100,wp=((it.e-it.s)/realVideoDuration)*100;const seg=document.createElement('div');seg.className='v8-seg v8-seg--'+step+(it.id===selectedSegId?' selected':'');seg.style.left=lp+'%';seg.style.width=Math.max(wp,0.5)+'%';seg.dataset.id=it.id;seg.dataset.step=step;seg.innerHTML='<span class="v8-seg-h v8-seg-h--l" data-handle="left"></span><span style="pointer-events:none;flex:1;text-align:center">'+it.id+'</span><span class="v8-seg-h v8-seg-h--r" data-handle="right"></span>';seg.addEventListener('mousedown',e=>{const handle=e.target.closest('.v8-seg-h');if(handle){e.stopPropagation();e.preventDefault();startSegDrag(it.id,step,handle.dataset.handle,e,c);return}selectSeg(it.id,step);videoTime=it.s;needsVideoSync=true;e.preventDefault();startSegDrag(it.id,step,'move',e,c)});c.appendChild(seg)})})}
function selectSeg(id,step){selectedSegId=id;document.querySelectorAll('.v8-seg').forEach(s=>s.classList.toggle('selected',s.dataset.id===id));if(step==='erase'){activeErase=id;document.querySelectorAll('.frc').forEach(c=>c.classList.toggle('active',c.dataset.r===id))}if(step==='subtitle'){document.querySelectorAll('.fsi').forEach(c=>c.classList.toggle('active',c.dataset.s===id))}if(step==='voice'){document.querySelectorAll('.fvi').forEach(c=>c.classList.toggle('active',c.dataset.v===id))}}
function startSegDrag(id,step,type,startEvt,container){const rect=container.getBoundingClientRect();const cw=rect.width;const startX=startEvt.clientX;const t=getItemTime(step,id);if(!t)return;const origS=t.s,origE=t.e;document.body.style.cursor=type==='move'?'grabbing':'col-resize';function onMove(ev){const dx=ev.clientX-startX;const dSec=(dx/cw)*realVideoDuration;if(type==='left')setItemTime(step,id,origS+dSec,origE);else if(type==='right')setItemTime(step,id,origS,origE+dSec);else{const dur=origE-origS;let ns=origS+dSec;if(ns<0)ns=0;if(ns+dur>realVideoDuration)ns=realVideoDuration-dur;setItemTime(step,id,ns,ns+dur)}const seg=container.querySelector('.v8-seg[data-id="'+id+'"]');if(seg){const it=getItemTime(step,id);seg.style.left=(it.s/realVideoDuration*100)+'%';seg.style.width=((it.e-it.s)/realVideoDuration*100)+'%'}videoTime=getItemTime(step,id).s;needsVideoSync=true}function onUp(){document.removeEventListener('mousemove',onMove);document.removeEventListener('mouseup',onUp);document.body.style.cursor='';if(step==='erase'){renderEraseList();renderEraseOverlays()}else if(step==='subtitle')renderSubList();else renderVoiceList();rebuildFtTimeline(step)}document.addEventListener('mousemove',onMove);document.addEventListener('mouseup',onUp)}
function clearFtTimeline(){document.querySelectorAll('.v8-trk').forEach(t=>{t.classList.add('hidden');const c=t.querySelector('.v8-trk-c');if(c)c.innerHTML=''});const labels={erase:'擦除',subtitle:'字幕',voice:'配音'};Object.keys(labels).forEach(k=>{const trk=document.querySelector('.v8-trk[data-track="'+k+'"]');if(trk){const l=trk.querySelector('.v8-trk-l');if(l)l.textContent=labels[k]}})}

function buildRuler(){
    const el=document.getElementById('tlRuler');
    el.innerHTML='<div class="v8-ruler-inner" id="tlRulerInner"></div>';
    const inner=document.getElementById('tlRulerInner');
    const step = realVideoDuration > 120 ? 30 : 15;
    for(let s=0;s<=realVideoDuration;s+=step){
        const pct=(s/realVideoDuration)*100;const mk=document.createElement('div');mk.className='v8-rm';mk.style.left=pct+'%';
        mk.innerHTML='<span class="tl">'+fmt(s)+'</span><span class="tick"></span>';inner.appendChild(mk);
    }
}
buildRuler();

/* ===== Video Loop ===== */
function updateBurntSub(t){if(burntSub.classList.contains('erased'))return;const cur=subtitleItems.find(s=>t>=s.startSec&&t<=s.endSec);if(cur){if(lastBurntId!==cur.id){burntSub.innerHTML='<span class="bs-bar"><span class="bs-text">'+cur.orig+'</span></span>';burntSub.classList.add('visible');lastBurntId=cur.id}}else{if(lastBurntId!==null){burntSub.classList.remove('visible');lastBurntId=null}}}
function syncVideoToTime(){
    if(videoEl.duration){
        const tv = videoTime % videoEl.duration;
        if(Math.abs(videoEl.currentTime - tv) > 1) videoEl.currentTime = tv;
    }
}
function updateTimeline(){
    const pct=(videoTime/realVideoDuration)*100;
    const sf=document.getElementById('scrubFill'),st=document.getElementById('scrubThumb'),stm=document.getElementById('scrubTime');
    if(sf)sf.style.width=pct+'%';if(st)st.style.left=pct+'%';
    if(stm)stm.innerHTML='<span style="color:#fff">'+fmt(videoTime)+'</span> / '+fmt(realVideoDuration);
    const tlt=document.getElementById('tlTime');if(tlt)tlt.innerHTML='<span class="cur">'+fmt(videoTime)+'</span> / '+fmt(realVideoDuration);
    const trks=document.getElementById('tlTracks');if(trks){const tw=trks.offsetWidth;const cw=tw-80-14;tlPlayhead.style.left=(80+(pct/100)*cw)+'px'}
}
function tick(){
    if(playing){videoTime+=1/60;if(videoTime>=realVideoDuration)videoTime=0;if(videoEl.paused)videoEl.play().catch(()=>{})}
    else{if(!videoEl.paused)videoEl.pause()}
    if(needsVideoSync){syncVideoToTime();needsVideoSync=false}
    updateBurntSub(videoTime);updateTimeline();updateEraseVis();updateSubPreview();updateVoicePreview();
    if(compareActive){if(playing&&cmpVid.paused)cmpVid.play().catch(()=>{});if(!playing&&!cmpVid.paused)cmpVid.pause();if(Math.abs(cmpVid.currentTime-videoEl.currentTime)>0.3)cmpVid.currentTime=videoEl.currentTime}
    animFrame=requestAnimationFrame(tick);
}

/* ===== Scrubber ===== */
let scrubDrag=false;
const scrubBar=document.getElementById('scrubBar');
scrubBar.addEventListener('mousedown',e=>{e.preventDefault();scrubDrag=true;seekScrub(e.clientX)});
document.addEventListener('mousemove',e=>{if(scrubDrag)seekScrub(e.clientX)});
document.addEventListener('mouseup',()=>{scrubDrag=false});
function seekScrub(cx){const r=scrubBar.getBoundingClientRect();const p=Math.max(0,Math.min(1,(cx-r.left)/r.width));videoTime=p*realVideoDuration;needsVideoSync=true}

function updatePlayIcons(){
    document.querySelector('.sp-play').style.display=playing?'none':'';
    document.querySelector('.sp-pause').style.display=playing?'':'none';
    const tp=document.querySelector('.tp-play'),tpp=document.querySelector('.tp-pause');
    if(tp)tp.style.display=playing?'none':'';if(tpp)tpp.style.display=playing?'':'none';
}
document.getElementById('scrubPlay').addEventListener('click',()=>{playing=!playing;updatePlayIcons()});
document.getElementById('tlPlay').addEventListener('click',()=>{playing=!playing;updatePlayIcons()});

tlTracks.addEventListener('mousedown',e=>{
    if(!inFinetune)return;e.preventDefault();
    const r=tlTracks.getBoundingClientRect();const cl=r.left+80;const cw=r.width-80-20;
    const p=Math.max(0,Math.min(1,(e.clientX-cl)/cw));videoTime=p*realVideoDuration;needsVideoSync=true;
});

/* ===== Chat Collapse/Expand ===== */
let chatCollapsed=false;
let unreadCount=0;
const chatPanel=document.getElementById('chatPanel');
const chatFab=document.getElementById('chatFab');
const fabBadge=document.getElementById('fabBadge');

function collapseChat(){chatCollapsed=true;chatPanel.classList.add('collapsed');chatFab.classList.add('active');unreadCount=0;fabBadge.textContent='';fabBadge.style.display='none'}
function expandChat(){chatCollapsed=false;chatPanel.classList.remove('collapsed');chatFab.classList.remove('active');unreadCount=0;fabBadge.textContent='';fabBadge.style.display='none';scrollChat()}
const origAppend=chatFlow.appendChild.bind(chatFlow);
chatFlow.appendChild=function(el){origAppend(el);if(chatCollapsed&&el.classList&&el.classList.contains('chat-bubble')){unreadCount++;fabBadge.textContent=unreadCount;fabBadge.style.display='flex'}};
document.getElementById('chatCollapseBtn').addEventListener('click',collapseChat);
chatFab.addEventListener('click',expandChat);

/* ===== Back Button ===== */
let taskStarted=false;
const backModal=document.getElementById('backModal');
document.getElementById('backBtn').addEventListener('click',()=>{if(isFinetuneEntry||!taskStarted||phase==='done'){location.href='create.html';return}backModal.classList.add('active')});
document.getElementById('backCancelBtn').addEventListener('click',()=>{backModal.classList.remove('active')});
backModal.addEventListener('click',e=>{if(e.target===backModal)backModal.classList.remove('active')});
document.getElementById('backBgBtn').addEventListener('click',()=>{backModal.classList.remove('active');saveState();const taskInfo={id:currentTaskId||('task_'+Date.now()),name:uploadedFileName,mode:workflowMode,apiTaskId:apiTaskId,videoUrl:videoUrl,phase:phase==='done'?'done':'processing',time:new Date().toLocaleTimeString()};let bgTasks=[];try{bgTasks=JSON.parse(sessionStorage.getItem('tideo_minimized_tasks')||'[]')}catch(e){}bgTasks.push(taskInfo);sessionStorage.setItem('tideo_minimized_tasks',JSON.stringify(bgTasks));location.href='create.html'});
document.getElementById('backStopBtn').addEventListener('click',()=>{backModal.classList.remove('active');location.href='create.html'});

/* ===== 保存任务记录到 localStorage ===== */
function saveTaskRecord(status, elapsed) {
    try {
        var records = JSON.parse(localStorage.getItem('tideo_results') || '[]');
        var id = apiTaskId || currentTaskId || ('sim_' + Date.now());
        var feats = [];
        if (features.erase) feats.push('擦除');
        if (features.subtitle) feats.push('字幕');
        if (features.voice) feats.push('配音');
        var record = {
            id: id,
            name: uploadedFileName || '未命名视频',
            type: 'translate',
            mode: workflowMode,
            features: feats,
            status: status,
            videoUrl: videoUrl || '',
            outputUrl: (typeof outputVideoUrl !== 'undefined' ? outputVideoUrl : '') || '',
            duration: realVideoDuration || 0,
            elapsed: elapsed || 0,
            date: new Date().toISOString()
        };
        // upsert: 存在就更新，不存在就新增
        var idx = -1;
        for (var i = 0; i < records.length; i++) {
            if (records[i].id === id) { idx = i; break; }
        }
        if (idx >= 0) {
            // 保留原始 date，更新其他字段
            record.date = records[idx].date;
            records[idx] = record;
        } else {
            records.unshift(record);
        }
        // 最多保留 50 条
        if (records.length > 50) records = records.slice(0, 50);
        localStorage.setItem('tideo_results', JSON.stringify(records));
    } catch(e) { console.warn('保存任务记录失败:', e); }
}

/* ===== 状态持久化 ===== */
function saveState() {
    if (!currentTaskId || typeof TaskState === 'undefined') return;
    try {
        var state = {
            id: currentTaskId,
            name: uploadedFileName || '未命名视频',
            mode: workflowMode,
            phase: phase,
            videoUrl: videoUrl,
            outputVideoUrl: outputVideoUrl,
            features: JSON.parse(JSON.stringify(features)),
            activeSteps: activeSteps.slice(),
            currentStep: currentStep,
            stepSubTasks: JSON.parse(JSON.stringify(stepSubTasks)),
            unlockedTabs: JSON.parse(JSON.stringify(unlockedTabs)),
            fineTunedSteps: JSON.parse(JSON.stringify(fineTunedSteps)),
            subtitleItems: JSON.parse(JSON.stringify(subtitleItems)),
            voiceItems: JSON.parse(JSON.stringify(voiceItems)),
            eraseRegions: JSON.parse(JSON.stringify(eraseRegions)),
            eraseRegionCounter: eraseRegionCounter,
            chatHTML: chatFlow.innerHTML,
            videoTime: videoTime,
            apiTaskId: apiTaskId,
            inFinetune: inFinetune,
            currentFtStep: currentFtStep,
            srcLang: srcLang,
            dstLang: dstLang,
            scriptReady: scriptReady,
            taskStarted: taskStarted,
            lightsOff: lightsOff
        };
        TaskState.save(state);
    } catch(e) { console.warn('[TaskState] saveState 失败:', e); }
}

function restoreState(state) {
    if (!state) return false;
    try {
        currentTaskId = state.id;
        phase = state.phase || 'processing';
        features = state.features || { erase:true, subtitle:true, voice:true };
        activeSteps = state.activeSteps || ['erase','subtitle','voice'];
        currentStep = state.currentStep != null ? state.currentStep : -1;
        stepSubTasks = state.stepSubTasks || {};
        unlockedTabs = state.unlockedTabs || { erase:false, subtitle:false, voice:false };
        fineTunedSteps = state.fineTunedSteps || { erase:false, subtitle:false, voice:false };
        subtitleItems = state.subtitleItems || [];
        voiceItems = state.voiceItems || [];
        eraseRegions = state.eraseRegions || [];
        eraseRegionCounter = state.eraseRegionCounter || 0;
        videoTime = state.videoTime || 0;
        apiTaskId = state.apiTaskId || null;
        outputVideoUrl = state.outputVideoUrl || '';
        scriptReady = state.scriptReady || false;
        taskStarted = state.taskStarted || false;

        // 恢复聊天内容
        if (state.chatHTML) chatFlow.innerHTML = state.chatHTML;

        // 恢复 Tab 解锁状态
        Object.keys(unlockedTabs).forEach(function(k) { if (unlockedTabs[k]) unlockTab(k); });

        // 恢复阶段指示
        if (phase === 'done') {
            phaseDot.className = 'v8-pd done';
            phaseLabel.textContent = '译制完成 · 可预览或导出';
        } else {
            phaseDot.className = 'v8-pd proc';
            phaseLabel.textContent = '处理中…';
        }

        // 恢复视频位置
        needsVideoSync = true;

        // 如果有成片 URL，切换视频源
        if (outputVideoUrl && phase === 'done') {
            videoEl.src = outputVideoUrl;
            videoEl.load();
        }

        // 重新绑定聊天中的精调链接
        chatFlow.querySelectorAll('.rpc-detail-link[data-step]').forEach(function(dl) {
            dl.addEventListener('click', function() { enterFinetune(dl.dataset.step); });
        });
        var refBtn = document.getElementById('chatRefBtn');
        if (refBtn) {
            var fs = activeSteps.find(function(s) { return features[s]; });
            if (fs) refBtn.addEventListener('click', function() { turnLightsOn(); enterFinetune(fs); });
        }

        // 如果恢复时在精调中，重新进入精调
        if (state.inFinetune && state.currentFtStep) {
            setTimeout(function() { enterFinetune(state.currentFtStep); }, 200);
        }
        // 如果恢复时关灯中
        else if (state.lightsOff && phase === 'done') {
            setTimeout(function() { scheduleLightsOff(500); }, 300);
        }

        console.log('[TaskState] 恢复任务:', currentTaskId, '阶段:', phase);
        return true;
    } catch(e) { console.warn('[TaskState] restoreState 失败:', e); return false; }
}

// 页面卸载前自动保存
window.addEventListener('beforeunload', function() { saveState(); });

// 定期自动保存（每 10 秒）
setInterval(saveState, 10000);

/* ===== Init ===== */
phaseEl.classList.add('vis');
document.getElementById('scrub').classList.add('vis');
animFrame=requestAnimationFrame(tick);

// 尝试恢复状态
var _restoreTaskId = P.get('tid') || null;
var _savedState = null;
if (_restoreTaskId && typeof TaskState !== 'undefined') {
    _savedState = TaskState.load(_restoreTaskId);
}
if (!_savedState && typeof TaskState !== 'undefined') {
    _savedState = TaskState.loadActive();
    // 仅在 URL 没有 autostart 参数时恢复（避免新任务被旧状态覆盖）
    if (_savedState && (autostart || isFinetuneEntry)) _savedState = null;
}

if (_savedState && !autostart && !isFinetuneEntry) {
    // 恢复已有任务
    restoreState(_savedState);
} else if(isFinetuneEntry){
    // 精调直接入口模式：跳过对话流，直接进入精调视图
    currentTaskId = (typeof TaskState !== 'undefined') ? TaskState.generateId() : null;
    phase='done'; taskStarted=false;
    // 根据 URL 参数决定哪些功能可用
    if(ftFeatErase){ features.erase=true; unlockTab('erase'); }
    if(ftFeatSubtitle){ features.subtitle=true; unlockTab('subtitle'); }
    if(ftFeatVoice){ features.voice=true; unlockTab('voice'); }
    // 如果没有指定任何 feat，默认全部解锁
    if(!ftFeatErase && !ftFeatSubtitle && !ftFeatVoice){
        features.erase=true; features.subtitle=true; features.voice=true;
        unlockTab('erase'); unlockTab('subtitle'); unlockTab('voice');
    }
    // 设置 activeSteps
    activeSteps = [];
    if(features.erase) activeSteps.push('erase');
    if(features.subtitle) activeSteps.push('subtitle');
    if(features.voice) activeSteps.push('voice');
    // 填充示例数据（如果为空）
    if(!eraseRegions.length){
        eraseRegions.push({id:'E1',title:'字幕区域',x:10,y:82,w:80,h:12,startSec:0,endSec:realVideoDuration});
        eraseRegionCounter=1;
    }
    if(!subtitleItems.length){
        subtitleItems.push({id:'S1',orig:'示例原文',trans:'Example translation',startSec:2,endSec:5});
    }
    if(!voiceItems.length){
        voiceItems.push({id:'V1',text:'Example voiceover',startSec:2,endSec:5});
    }
    // 隐藏聊天面板，直接进入精调
    setTimeout(()=>{
        playing=false;
        const requestedTab = P.get('tab');
        const firstStep = (requestedTab && activeSteps.indexOf(requestedTab) !== -1) ? requestedTab : (activeSteps[0] || 'erase');
        enterFinetune(firstStep);
    },300);
} else if(autostart||true){
    currentTaskId = (typeof TaskState !== 'undefined') ? TaskState.generateId() : null;
    setTimeout(()=>{playing=false;taskStarted=true;buildConfigChat();saveState()},500);
}

/* ===== 精调页鼠标跟随亮光 ===== */
const ftGlow=document.getElementById('ftGlow');
const ftLayout=document.getElementById('ftLayout');
if(ftLayout&&ftGlow){
    ftLayout.addEventListener('mousemove',function(e){
        ftGlow.style.left=e.clientX+'px';
        ftGlow.style.top=e.clientY+'px';
    });
}

})();
