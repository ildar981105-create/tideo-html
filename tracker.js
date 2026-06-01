/**
 * tracker.js — Tideo 用户测试埋点系统 v2
 * 
 * 设计目标：完整记录用户操作链路，回答"用户能否顺利用下来"
 * 
 * 记录维度：
 * 1. 操作序列 — 每一步操作按时间排列，还原用户行为路径
 * 2. 犹豫检测 — 进入页面后多久开始交互
 * 3. 困惑检测 — 同一元素重复点击、来回切换
 * 4. 停留时长 — 每个页面/阶段的停留
 * 5. 里程碑 — 关键节点是否到达（上传→处理→完成→下载）
 * 6. 鼠标热区 — 点击坐标（用于热力图）
 */
(function(global) {
'use strict';

const SCF_BASE = 'https://1306264703-4mtd7pg0gt.ap-guangzhou.tencentscf.com';
const params = new URLSearchParams(location.search);
const testRound = params.get('test') || 'default';
const inviteMode = params.get('invite') === '1' || params.get('public') === '1';
const uid = params.get('uid') || (inviteMode ? getInviteUid(testRound) : '') || 'anon_' + Math.random().toString(36).slice(2, 8);
const page = location.pathname.split('/').pop() || 'index';

function getInviteUid(test) {
    const key = 'tideo_invite_uid_' + encodeURIComponent(test || 'default');
    try {
        let saved = localStorage.getItem(key);
        if (!saved) {
            saved = 'guest_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
            localStorage.setItem(key, saved);
        }
        return saved;
    } catch(e) {
        return 'guest_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    }
}
const sessionId = uid + '_' + Date.now().toString(36);
const pageEnterTime = Date.now();

// ========== 操作序列（核心数据结构） ==========
const opLog = []; // 所有操作按时间排列
let seqId = 0;
let firstInteractionTime = null;
let maxScrollDepth = 0;
let lastClickTarget = '';
let lastClickTime = 0;
let repeatClickCount = 0;

// ========== 事件缓冲 ==========
let eventQueue = [];
const FLUSH_INTERVAL = 8000;
const MAX_QUEUE = 30;

function record(type, detail) {
    seqId++;
    const now = Date.now();
    const elapsed = Math.round((now - pageEnterTime) / 1000);
    const entry = {
        seq: seqId,
        uid: uid,
        test: testRound,
        session: sessionId,
        page: page,
        type: type,
        ts: new Date().toISOString(),
        elapsed: elapsed,
        d: detail || {}
    };
    opLog.push(entry);
    eventQueue.push(entry);
    if (eventQueue.length >= MAX_QUEUE) flush();
    return entry;
}

// ⚠️ 埋点上报已紧急停用
const TRACKER_DISABLED = false;

function flush() {
    if (TRACKER_DISABLED) { eventQueue.length = 0; return; }
    if (eventQueue.length === 0) return;
    const batch = eventQueue.splice(0);
    const payload = JSON.stringify({ events: batch });
    if (navigator.sendBeacon) {
        navigator.sendBeacon(SCF_BASE + '/track', payload);
    } else {
        fetch(SCF_BASE + '/track', { method:'POST', headers:{'Content-Type':'application/json'}, body:payload, keepalive:true }).catch(function(){});
    }
}

setInterval(flush, FLUSH_INTERVAL);

// ========== 1. 页面访问 ==========
record('enter', {
    url: location.href,
    referrer: document.referrer,
    screen: screen.width + 'x' + screen.height,
    viewport: window.innerWidth + 'x' + window.innerHeight
});

// ========== 2. 犹豫检测：首次交互 ==========
function markFirstInteraction(how) {
    if (firstInteractionTime) return;
    firstInteractionTime = Date.now();
    const hesitation = Math.round((firstInteractionTime - pageEnterTime) / 1000);
    record('first_interact', { how: how, hesitation: hesitation });
}

// ========== 3. 点击（带坐标 + 重复检测） ==========
document.addEventListener('click', function(e) {
    markFirstInteraction('click');

    // 识别点击目标
    const el = e.target.closest('button, a, [data-track], input[type=file], select, .skill-card, .min-task-card, .nav-item, .v8-tab, .ra-btn-export, .ra-btn-re, .ra-btn-ft, .rpc-detail-link, .v8-back, .v8-done-btn, .v8-cancel-fp, .v8-dbtn, .frc, .fsi, .fvi, .v8-seg') || e.target;

    const target = describeElement(el);
    const now = Date.now();

    // 重复点击检测
    if (target === lastClickTarget && (now - lastClickTime) < 3000) {
        repeatClickCount++;
        if (repeatClickCount >= 3) {
            record('frustration', { target: target, repeats: repeatClickCount, hint: '反复点击同一元素，可能困惑' });
        }
    } else {
        repeatClickCount = 1;
    }
    lastClickTarget = target;
    lastClickTime = now;

    record('click', {
        target: target,
        text: (el.textContent || '').trim().slice(0, 50),
        x: Math.round(e.clientX / window.innerWidth * 100),
        y: Math.round(e.clientY / window.innerHeight * 100),
        action: identifyAction(el)
    });
}, true);

function describeElement(el) {
    if (el.id) return '#' + el.id;
    if (el.dataset && el.dataset.track) return '[track=' + el.dataset.track + ']';
    var cls = (el.className || '').toString().split(' ').filter(function(c){ return c && c.length < 30 && !c.startsWith('chat-bubble'); }).slice(0,2).join('.');
    var tag = el.tagName ? el.tagName.toLowerCase() : '?';
    return cls ? tag + '.' + cls : tag;
}

function identifyAction(el) {
    if (el.closest('.skill-card')) return 'select_skill';
    if (el.closest('#submitBtn') || el.id === 'submitBtn') return 'submit';
    if (el.closest('.ra-btn-export') || (el.textContent||'').includes('导出') || (el.textContent||'').includes('下载')) return 'export';
    if (el.closest('.ra-btn-re') || (el.textContent||'').includes('精调')) return 'finetune';
    if (el.closest('.v8-back') || el.id === 'backBtn') return 'back';
    if (el.closest('.v8-done-btn')) return 'finetune_done';
    if (el.closest('.v8-cancel-fp')) return 'finetune_cancel';
    if (el.closest('.v8-tab')) return 'tab_switch';
    if (el.closest('.v8-dbtn')) return 'dimmer_action';
    if (el.closest('.min-task-card')) return 'restore_task';
    if (el.closest('.nav-item')) return 'nav_' + (el.textContent||'').trim().slice(0,4);
    if (el.closest('#scrubPlay') || el.closest('#tlPlay')) return 'play_toggle';
    if (el.type === 'file' || el.closest('[onclick*="triggerUpload"]')) return 'upload_trigger';
    return '';
}

// ========== 4. 文件上传 ==========
document.addEventListener('change', function(e) {
    if (e.target.type === 'file' && e.target.files && e.target.files.length) {
        var f = e.target.files[0];
        record('file_select', { name: f.name, sizeMB: (f.size/1048576).toFixed(1), type: f.type });
    }
}, true);

// ========== 5. 输入 ==========
document.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
        markFirstInteraction('enter_key');
        var val = e.target.value || e.target.textContent || '';
        record('input_enter', { inputId: e.target.id || describeElement(e.target), length: val.length });
    }
});
document.addEventListener('focus', function(e) {
    if (e.target.matches && e.target.matches('input, textarea, [contenteditable]')) {
        markFirstInteraction('focus_input');
        record('focus', { target: describeElement(e.target) });
    }
}, true);

// ========== 6. 滚动深度 ==========
var scrollThrottled = false;
window.addEventListener('scroll', function() {
    if (scrollThrottled) return;
    scrollThrottled = true;
    setTimeout(function() { scrollThrottled = false; }, 2000);
    markFirstInteraction('scroll');
    var h = document.documentElement;
    var depth = Math.round(((h.scrollTop + h.clientHeight) / Math.max(h.scrollHeight, 1)) * 100);
    if (depth > maxScrollDepth + 10) {
        maxScrollDepth = depth;
        record('scroll', { depth: depth });
    }
}, true);

// ========== 7. 页面可见性（切走/切回） ==========
document.addEventListener('visibilitychange', function() {
    record(document.hidden ? 'tab_away' : 'tab_back', { elapsed: Math.round((Date.now() - pageEnterTime) / 1000) });
});

// ========== 8. 页面离开 ==========
function onLeave() {
    record('leave', {
        duration: Math.round((Date.now() - pageEnterTime) / 1000),
        scrollDepth: maxScrollDepth,
        interactions: seqId,
        hesitation: firstInteractionTime ? Math.round((firstInteractionTime - pageEnterTime) / 1000) : -1
    });
    flush();
}
window.addEventListener('beforeunload', onLeave);
window.addEventListener('pagehide', onLeave);

// ========== 9. JS 错误 ==========
window.addEventListener('error', function(e) {
    record('error', { msg: (e.message||'').slice(0,150), file: (e.filename||'').split('/').pop(), line: e.lineno });
});
window.addEventListener('unhandledrejection', function(e) {
    record('error', { msg: 'Promise: ' + String(e.reason).slice(0,150) });
});

// ========== 10. 链接跳转时携带 uid/test + survey 参数 ==========
document.addEventListener('click', function(e) {
    var a = e.target.closest('a[href]');
    if (!a || !a.href) return;
    try {
        var url = new URL(a.href, location.origin);
        if (url.origin === location.origin && !url.searchParams.has('uid')) {
            url.searchParams.set('uid', uid);
            url.searchParams.set('test', testRound);
            // 透传 survey 参数
            var sp = new URLSearchParams(location.search);
            ['smode','stype','stasks','ssurveys','sexit','swelcome','scp'].forEach(function(k){
                var v = sp.get(k); if(v && !url.searchParams.has(k)) url.searchParams.set(k, v);
            });
            // 兼容旧 mode=test
            if(sp.get('mode')==='test' && !url.searchParams.has('smode')) url.searchParams.set('smode','test');
            a.href = url.toString();
        }
    } catch(ex) {}
}, true);

// ========== 手动埋点 API ==========
global.TideoTracker = {
    record: record,
    flush: flush,
    uid: uid,
    testRound: testRound,
    sessionId: sessionId,

    // 里程碑（关键节点）
    milestone: function(name, extra) {
        record('milestone', Object.assign({ name: name }, extra || {}));
    },
    // 阶段开始/结束
    phaseStart: function(name) { record('phase_start', { phase: name }); },
    phaseEnd: function(name) { record('phase_end', { phase: name }); },
    // 上传进度
    uploadProgress: function(pct) { record('upload_progress', { pct: pct }); },
    uploadDone: function(url, sizeMB) { record('upload_done', { url: (url||'').slice(-60), sizeMB: sizeMB }); },
    uploadFail: function(err) { record('upload_fail', { error: err }); },
    // MPS 进度
    mpsStatus: function(status, elapsed) { record('mps_status', { status: status, elapsed: elapsed }); },

    // ========== 问卷/任务 相关（survey.js 联动） ==========
    // 问卷展示
    surveyShow: function(checkpointId, type) { record('survey_show', { checkpoint: checkpointId, type: type }); },
    // 问卷回答
    surveyAnswer: function(data) { record('survey_answer', data); },
    // 问卷跳过
    surveySkip: function(checkpointId) { record('survey_skip', { checkpoint: checkpointId }); },
    // 总结问卷提交
    surveyExitSubmit: function(data) { record('survey_exit_submit', data); },
    // 任务完成
    taskComplete: function(taskId, label) { record('task_complete', { taskId: taskId, label: label, elapsed: Math.round((Date.now() - pageEnterTime) / 1000) }); }
};

})(window);
