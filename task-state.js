// task-state.js — 多任务状态持久化管理器（sessionStorage）
// 支持：保存/恢复/切换/列表 多个任务状态
(function(){
'use strict';

const TASKS_KEY = 'tideo_tasks_index';   // 任务列表索引
const STATE_PREFIX = 'tideo_task_';       // 每个任务的状态前缀
const ACTIVE_KEY = 'tideo_active_task';   // 当前活跃任务 ID

window.TaskState = {

    // ===== 生成唯一任务 ID =====
    generateId: function() {
        return 'task_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    },

    // ===== 获取任务列表 =====
    list: function() {
        try {
            return JSON.parse(sessionStorage.getItem(TASKS_KEY) || '[]');
        } catch(e) { return []; }
    },

    // ===== 获取当前活跃任务 ID =====
    getActiveId: function() {
        return sessionStorage.getItem(ACTIVE_KEY) || null;
    },

    // ===== 设置当前活跃任务 =====
    setActiveId: function(taskId) {
        if (taskId) sessionStorage.setItem(ACTIVE_KEY, taskId);
        else sessionStorage.removeItem(ACTIVE_KEY);
    },

    // ===== 保存任务状态 =====
    // state: { id, name, mode, phase, videoUrl, outputVideoUrl, features, activeSteps,
    //          currentStep, stepSubTasks, unlockedTabs, fineTunedSteps,
    //          subtitleItems, voiceItems, eraseRegions, eraseRegionCounter,
    //          chatHTML, videoTime, apiTaskId, inFinetune, currentFtStep,
    //          srcLang, dstLang, timestamp }
    save: function(state) {
        if (!state || !state.id) return;
        try {
            state.timestamp = Date.now();
            sessionStorage.setItem(STATE_PREFIX + state.id, JSON.stringify(state));
            // 更新索引
            var list = this.list();
            var idx = list.findIndex(function(t) { return t.id === state.id; });
            var summary = {
                id: state.id,
                name: state.name || '未命名',
                mode: state.mode || 'full',
                phase: state.phase || 'processing',
                features: state.features || {},
                timestamp: state.timestamp
            };
            if (idx >= 0) list[idx] = summary;
            else list.unshift(summary);
            // 最多 10 个任务
            if (list.length > 10) {
                var removed = list.splice(10);
                removed.forEach(function(t) { sessionStorage.removeItem(STATE_PREFIX + t.id); });
            }
            sessionStorage.setItem(TASKS_KEY, JSON.stringify(list));
            this.setActiveId(state.id);
        } catch(e) { console.warn('[TaskState] 保存失败:', e); }
    },

    // ===== 加载任务状态 =====
    load: function(taskId) {
        try {
            var raw = sessionStorage.getItem(STATE_PREFIX + taskId);
            return raw ? JSON.parse(raw) : null;
        } catch(e) { return null; }
    },

    // ===== 加载当前活跃任务 =====
    loadActive: function() {
        var id = this.getActiveId();
        return id ? this.load(id) : null;
    },

    // ===== 删除任务 =====
    remove: function(taskId) {
        sessionStorage.removeItem(STATE_PREFIX + taskId);
        var list = this.list().filter(function(t) { return t.id !== taskId; });
        sessionStorage.setItem(TASKS_KEY, JSON.stringify(list));
        if (this.getActiveId() === taskId) this.setActiveId(null);
    },

    // ===== 清空所有任务 =====
    clear: function() {
        var list = this.list();
        list.forEach(function(t) { sessionStorage.removeItem(STATE_PREFIX + t.id); });
        sessionStorage.removeItem(TASKS_KEY);
        sessionStorage.removeItem(ACTIVE_KEY);
    }
};

})();
