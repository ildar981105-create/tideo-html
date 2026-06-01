/* ============================================
   Tideo — 任务进度 + 底部智能输入框
   通用组件逻辑（v2 — 进度与输入框一体化）
   ============================================ */

(function() {
    'use strict';

    // ========================================
    //  任务模板定义 — 与各页面实际对话流程一一对应
    // ========================================
    var TASK_TEMPLATES = {
        // translate-v8.html 的实际流程：
        //   handleFile → buildConfigChat → showStepPreBubble('erase') → startStepScan('subtitle') → runTranslationScan → runVoiceGeneration → showResult
        translate: [
            { id: 'upload',    label: '上传视频文件' },
            { id: 'config',    label: '确认译制配置' },
            { id: 'erase',     label: '擦除原字幕' },
            { id: 'subtitle',  label: '语音识别 + 字幕翻译' },
            { id: 'voice',     label: 'AI 配音合成' },
            { id: 'render',    label: '渲染导出' }
        ],
        // livestream.html 的实际流程：
        //   startMonitor → 实时监控 → AI 自动识别 → 手动/自动剪辑
        livestream: [
            { id: 'connect',  label: '连接直播信号源' },
            { id: 'monitor',  label: '实时监控直播' },
            { id: 'detect',   label: 'AI 识别高光片段' },
            { id: 'clip',     label: '生成剪辑片段' }
        ],
        // generate.html 的实际流程：
        //   startCreation → startParsing → showTextConfirm → showStyleConfig → enterStoryboard → startSynth → enterPlayer
        generate: [
            { id: 'parse',      label: '解析文案意图' },
            { id: 'textConfirm',label: '确认文案分段' },
            { id: 'style',      label: '选择视频风格' },
            { id: 'storyboard', label: '生成分镜画面' },
            { id: 'synth',      label: '合成视频' },
            { id: 'done',       label: '生成完成' }
        ]
    };

    // ========================================
    //  意图识别关键词
    // ========================================
    var SKILL_KEYWORDS = {
        translate:  ['翻译', '译制', '多语言', '本地化', '英文', '日文', '英语', '日语', '韩语', '法语', '德语', '西班牙语', 'translate', '口型', '出海', '擦字幕', '去字幕', '加字幕', '配音', '克隆'],
        livestream: ['直播', '监控', '剪辑', '录像', '高光', '精彩片段', '抖音', '快手', 'b站', '带货', 'livestream', 'live'],
        generate:   ['生成', '创作', '脚本', '广告', '故事', 'vlog', '文案', '制作视频', '做一个视频', 'generate', 'create', '动画']
    };

    // 同技能内部子意图关键词
    var SUB_INTENT_KEYWORDS = {
        translate: {
            newLang:    ['翻译成', '翻成', '换成', '再翻', '日语', '韩语', '法语', '德语', '西班牙语', '葡萄牙语', '阿拉伯语', '俄语', '泰语', '越南语', '印尼语', '意大利语', '英语', '英文', '日文', '韩文'],
            voiceChange:['换男声', '换女声', '男声', '女声', '更换配音', '换配音', '音色', '嗓音'],
            styleAdj:   ['字幕', '字号', '字体', '颜色', '位置', '样式'],
            redo:       ['重新', '再来一次', '再做一遍', '重跑', '再擦', '重新擦']
        },
        generate: {
            newStyle:   ['换风格', '换一种风格', '赛博朋克', '水彩', '写实', '动画', '3d', '电影感'],
            lengthAdj:  ['时长', '延长', '缩短', '1分钟', '2分钟', '30秒'],
            clipEdit:   ['调整', '修改', '编辑', '第1段', '第2段', '第3段', '第4段', '片段', '精调'],
            redo:       ['重新生成', '再来一次', '重跑', '重做']
        }
    };

    var SKILL_URLS = {
        translate: 'translate-v8.html',
        livestream: 'livestream-v3.html',
        generate: 'generate.html'
    };

    var SKILL_NAMES = {
        translate: '视频译制',
        livestream: '直播剪辑',
        generate: 'AI 生成'
    };

    var SKILL_ICONS = {
        translate: '🌐',
        livestream: '🔴',
        generate: '✨'
    };

    // ========================================
    //  TaskPanel — 任务进度面板
    // ========================================
    window.TideoTaskPanel = {
        _tasks: [],
        _skill: null,
        _collapsed: false,
        _everShown: false,

        /**
         * 初始化任务进度
         * @param {string} skill — 'translate' | 'livestream' | 'generate'
         * @param {object} opts — { collapsed }
         */
        init: function(skill, opts) {
            opts = opts || {};
            this._skill = skill;
            this._collapsed = opts.collapsed !== false; // 默认折叠
            this._tasks = this._getDefaultTasks(skill);
        },

        _getDefaultTasks: function(skill) {
            var template = TASK_TEMPLATES[skill] || [];
            return template.map(function(t, idx) {
                return { id: t.id, label: t.label, index: idx + 1, status: 'pending', progress: 0, detail: '' };
            });
        },

        updateTask: function(taskId, status, progress, detail) {
            for (var i = 0; i < this._tasks.length; i++) {
                if (this._tasks[i].id === taskId) {
                    this._tasks[i].status = status;
                    this._tasks[i].progress = progress || 0;
                    if (detail !== undefined) this._tasks[i].detail = detail;
                    break;
                }
            }
            this._renderProgress();
        },

        /**
         * 简洁 API — 页面对话流关键节点调用
         * @param {string} taskId — 步骤 ID
         * @param {'active'|'done'} status — 状态
         * @param {string} [detail] — 可选描述
         */
        markStep: function(taskId, status, detail) {
            // 首次调用时展开面板 + 显示底部栏，之后尊重用户的折叠操作
            if (!this._everShown) {
                this._everShown = true;
                this._collapsed = false;
            }
            if (window.TideoPageInput && window.TideoPageInput.show) {
                window.TideoPageInput.show();
            }

            if (status === 'active') {
                this.updateTask(taskId, 'active', 0, detail || '');
            } else if (status === 'done') {
                this.updateTask(taskId, 'done', 100, detail || '');
            } else {
                this.updateTask(taskId, status, 0, detail || '');
            }

            // 更新提交按钮状态
            this._syncSubmitButton();
        },

        /**
         * 检测是否有任务正在运行
         */
        isRunning: function() {
            for (var i = 0; i < this._tasks.length; i++) {
                if (this._tasks[i].status === 'active') return true;
            }
            return false;
        },

        /**
         * 同步提交按钮外观：运行中 → 置灰禁用，空闲 → 可用发送按钮
         */
        _syncSubmitButton: function() {
            var btn = document.getElementById('pbiSubmit');
            if (!btn) return;
            var running = this.isRunning();
            if (running) {
                btn.classList.add('pbi-submit--disabled');
                btn.disabled = true;
                btn.title = '任务运行中…';
            } else {
                btn.classList.remove('pbi-submit--disabled');
                btn.disabled = false;
                btn.title = '发送';
            }
        },

        /** [Fallback] 自动推进进度模拟 — 仅在无法逐步同步时使用 */
        autoProgress: function(interval, onComplete) {
            var self = this;
            var idx = 0;
            interval = interval || 2000;

            if (window.TideoPageInput && window.TideoPageInput.show) {
                window.TideoPageInput.show();
            }

            function step() {
                if (idx >= self._tasks.length) {
                    if (onComplete) onComplete();
                    return;
                }
                self.updateTask(self._tasks[idx].id, 'active', 0);

                var prog = 0;
                var progTimer = setInterval(function() {
                    prog += Math.random() * 25 + 5;
                    if (prog >= 100) prog = 100;
                    self.updateTask(self._tasks[idx].id, 'active', Math.min(prog, 99));
                    if (prog >= 100) clearInterval(progTimer);
                }, interval / 5);

                setTimeout(function() {
                    clearInterval(progTimer);
                    self.updateTask(self._tasks[idx].id, 'done', 100);
                    idx++;
                    step();
                }, interval + Math.random() * 500);
            }

            step();
        },

        /**
         * 重置进度面板 — 用于同技能追加新任务
         * @param {object} opts — { skipUpload: true 跳过上传步骤（视频已在）}
         */
        reset: function(opts) {
            opts = opts || {};
            var skill = this._skill;
            this._tasks = this._getDefaultTasks(skill);

            // 同技能追加时，视频素材已在，跳过上传步骤直接标记完成
            if (opts.skipUpload) {
                for (var i = 0; i < this._tasks.length; i++) {
                    if (this._tasks[i].id === 'upload' || this._tasks[i].id === 'connect') {
                        this._tasks[i].status = 'done';
                        this._tasks[i].progress = 100;
                        break;
                    }
                }
            }

            this._collapsed = false;
            this._renderProgress();
            this._syncSubmitButton();
        },

        /**
         * 渲染进度区域 — 竖向步骤条
         * 始终完整展示所有步骤，用节点+连接线串联
         */
        _renderProgress: function() {
            // 进度条已禁用 — 仅保留底部智能输入框
            var el = document.getElementById('taskProgressArea');
            if (el) el.innerHTML = '';
            return;

            var total = this._tasks.length;
            var doneCount = 0;
            this._tasks.forEach(function(t) { if (t.status === 'done') doneCount++; });
            var allDone = doneCount === total && total > 0;
            var pct = total > 0 ? Math.round(doneCount / total * 100) : 0;
            var collapsed = this._collapsed;

            var html = '<div class="task-progress-bar' + (collapsed ? ' collapsed' : '') + '">';

            // 头部
            html += '<div class="task-progress-toggle" id="taskProgressToggle">';
            html += '  <div class="task-progress-left">';
            html += '    <span class="task-progress-icon">' + (allDone ? '✅' : '⚡') + '</span>';
            html += '    <span class="task-progress-label">' + (allDone ? '任务完成' : '任务进度') + '</span>';
            html += '    <span class="task-progress-count' + (allDone ? ' done' : '') + '">' + doneCount + '/' + total + '</span>';
            html += '  </div>';
            html += '  <span class="task-progress-chevron">›</span>';
            html += '</div>';

            // 折叠概览条
            html += '<div class="task-progress-overview"><div class="task-progress-overview-fill" style="width:' + pct + '%"></div></div>';

            // 步骤列表 — 始终完整展示
            html += '<div class="task-progress-list">';

            this._tasks.forEach(function(t, i) {
                var statusCls = 'task-step task-step--' + t.status;
                html += '<div class="' + statusCls + '">';

                // 左侧节点
                html += '  <div class="task-step-node">';
                html += '    <div class="task-step-dot"></div>';
                if (i < total - 1) {
                    html += '    <div class="task-step-line"></div>';
                }
                html += '  </div>';

                // 右侧内容
                html += '  <div class="task-step-content">';
                html += '    <span class="task-step-label">' + t.label + '</span>';

                if (t.status === 'active') {
                    if (t.progress > 0) {
                        html += '    <span class="task-step-badge">' + Math.round(t.progress) + '%</span>';
                    } else {
                        html += '    <span class="task-step-badge">进行中</span>';
                    }
                } else if (t.status === 'done') {
                    html += '    <span class="task-step-badge">✓</span>';
                }

                html += '  </div>';
                html += '</div>';
            });

            // 全部完成提示 + 下一步建议
            if (allDone) {
                html += '<div class="task-all-done">🎉 全部步骤已完成</div>';
                html += this._renderNextSuggestions();
            }

            html += '</div>'; // .task-progress-list
            html += '</div>'; // .task-progress-bar

            el.innerHTML = html;

            // 绑定头部折叠
            var self = this;
            var toggle = el.querySelector('#taskProgressToggle');
            if (toggle) {
                toggle.addEventListener('click', function() {
                    var bar = toggle.closest('.task-progress-bar');
                    if (bar) {
                        bar.classList.toggle('collapsed');
                        self._collapsed = bar.classList.contains('collapsed');
                    }
                });
            }

            // 绑定建议卡片点击
            el.querySelectorAll('.task-suggest-chip').forEach(function(chip) {
                chip.addEventListener('click', function() {
                    var action = this.dataset.action;
                    var targetSkill = this.dataset.skill;
                    var promptText = this.dataset.prompt || '';

                    if (action === 'new-task') {
                        // 同技能追加：填充输入框并提交
                        var textarea = document.getElementById('pbiTextarea');
                        if (textarea) {
                            textarea.value = promptText;
                            textarea.dispatchEvent(new Event('input'));
                        }
                        // 触发 pageinput 事件
                        document.dispatchEvent(new CustomEvent('tideo:pageinput', {
                            detail: { text: promptText, skill: self._skill, action: 'new-task', subType: 'newLang' }
                        }));
                    } else if (action === 'switch') {
                        // 跨技能跳转
                        if (window.TideoPageInput && window.TideoPageInput._saveContext) {
                            window.TideoPageInput._saveContext(self._skill);
                        }
                        var url = SKILL_URLS[targetSkill];
                        if (promptText) url += '?prompt=' + encodeURIComponent(promptText);
                        window.location.href = url;
                    }
                });
            });
        },

        /**
         * 渲染「下一步建议」卡片
         */
        _renderNextSuggestions: function() {
            var skill = this._skill;
            var html = '<div class="task-next-suggestions">';
            html += '<div class="task-next-title">下一步可以…</div>';
            html += '<div class="task-suggest-chips">';

            if (skill === 'translate') {
                html += '<div class="task-suggest-chip" data-action="new-task" data-skill="translate" data-prompt="翻译成日语">' +
                            '🇯🇵 翻译成日语</div>';
                html += '<div class="task-suggest-chip" data-action="new-task" data-skill="translate" data-prompt="翻译成韩语">' +
                            '🇰🇷 翻译成韩语</div>';
                html += '<div class="task-suggest-chip" data-action="new-task" data-skill="translate" data-prompt="翻译成西班牙语">' +
                            '🇪🇸 翻译成西班牙语</div>';
                html += '<div class="task-suggest-chip task-suggest-chip--cross" data-action="switch" data-skill="generate" data-prompt="用这个视频素材制作短视频">' +
                            '✨ 用素材做短视频</div>';
            } else if (skill === 'generate') {
                html += '<div class="task-suggest-chip" data-action="new-task" data-skill="generate" data-prompt="换一种视觉风格重新生成">' +
                            '🎨 换风格重新生成</div>';
                html += '<div class="task-suggest-chip" data-action="new-task" data-skill="generate" data-prompt="时长延长到2分钟">' +
                            '⏱ 延长到2分钟</div>';
                html += '<div class="task-suggest-chip task-suggest-chip--cross" data-action="switch" data-skill="translate" data-prompt="翻译成英语">' +
                            '🌐 翻译成英语</div>';
            } else if (skill === 'livestream') {
                html += '<div class="task-suggest-chip" data-action="new-task" data-skill="livestream" data-prompt="继续录制更多精彩片段">' +
                            '🎬 继续录制</div>';
                html += '<div class="task-suggest-chip task-suggest-chip--cross" data-action="switch" data-skill="translate" data-prompt="翻译这个剪辑视频">' +
                            '🌐 翻译这个视频</div>';
                html += '<div class="task-suggest-chip task-suggest-chip--cross" data-action="switch" data-skill="generate" data-prompt="用直播片段制作短视频">' +
                            '✨ 制作短视频</div>';
            }

            html += '</div></div>';
            return html;
        }
    };

    // ========================================
    //  PageInput — 底部智能输入框（含任务进度）
    // ========================================
    window.TideoPageInput = {
        _currentSkill: null,
        _container: null,

        /**
         * 初始化底部面板（进度 + 输入框）
         * @param {string} skill — 当前页面的 Skill
         */
        init: function(skill) {
            this._currentSkill = skill;
            this._injectHTML(skill);
            this._bindEvents(skill);
        },

        _injectHTML: function(skill) {
            if (document.getElementById('pbiWrapper')) return;

            var placeholders = {
                translate: '继续输入指令... 如「再翻译成日语」「换成男声配音」',
                livestream: '继续输入指令... 如「只保留带货片段」「换成竖屏比例」',
                generate: '继续输入指令... 如「换成赛博朋克风格」「时长改为1分钟」'
            };

            var div = document.createElement('div');
            div.className = 'pbi-wrapper hidden';
            div.id = 'pbiWrapper';
            div.innerHTML =
                '<!-- 输入框区域 -->' +
                '<div class="pbi-input-area">' +
                    '<div class="pbi-box">' +
                        '<textarea class="pbi-textarea" id="pbiTextarea" placeholder="' + (placeholders[skill] || '继续输入指令...') + '" rows="1"></textarea>' +
                        '<div class="pbi-toolbar">' +
                            '<div class="pbi-left">' +
                                '<button class="pbi-icon-btn" title="上传文件" id="pbiUpload">📎</button>' +
                                '<button class="pbi-icon-btn" title="粘贴链接" id="pbiLink">🔗</button>' +
                            '</div>' +
                            '<div class="pbi-skill-float" id="pbiSkillFloat"></div>' +
                            '<button class="pbi-submit" id="pbiSubmit">' +
                                '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 8H13M13 8L9 4M13 8L9 12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
                            '</button>' +
                        '</div>' +
                    '</div>' +
                '</div>';

            // 插入到右侧面板内部（底部）
            var rightPanel = document.querySelector('.tv2-right')
                          || document.querySelector('.gen-right')
                          || document.querySelector('.ls-aside');
            if (rightPanel) {
                rightPanel.appendChild(div);
            } else {
                document.body.appendChild(div);
            }
            this._container = div;

            // 初次渲染任务进度
            if (window.TideoTaskPanel) {
                window.TideoTaskPanel._renderProgress();
            }
        },

        _bindEvents: function(skill) {
            var self = this;
            var textarea = document.getElementById('pbiTextarea');
            var submitBtn = document.getElementById('pbiSubmit');
            var skillFloat = document.getElementById('pbiSkillFloat');

            if (!textarea || !submitBtn) return;

            textarea.addEventListener('input', function() {
                this.style.height = 'auto';
                this.style.height = Math.min(this.scrollHeight, 72) + 'px';

                var text = this.value.toLowerCase().trim();
                if (!text) {
                    skillFloat.innerHTML = '';
                    return;
                }
                var detected = self._detectIntent(text);
                if (detected && detected !== skill) {
                    var name = SKILL_NAMES[detected] || detected;
                    var icon = SKILL_ICONS[detected] || '✨';
                    skillFloat.innerHTML =
                        '<div class="pbi-switch-tag pbi-switch-tag--' + detected + '" data-skill="' + detected + '">' +
                            icon + ' 切换到 ' + name +
                        '</div>';
                    var tag = skillFloat.querySelector('.pbi-switch-tag');
                    if (tag) {
                        tag.addEventListener('click', function() {
                            var sk = this.dataset.skill;
                            var url = SKILL_URLS[sk];
                            var prompt = textarea.value.trim();
                            if (prompt) url += '?prompt=' + encodeURIComponent(prompt);
                            window.location.href = url;
                        });
                    }
                } else {
                    skillFloat.innerHTML = '';
                }
            });

            textarea.addEventListener('keydown', function(e) {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    self._handleSubmit(skill);
                }
            });

            submitBtn.addEventListener('click', function() {
                // 运行中 → 禁用，不响应点击
                if (window.TideoTaskPanel && window.TideoTaskPanel.isRunning()) {
                    return;
                }
                self._handleSubmit(skill);
            });

            // ——— 📎 上传文件按钮 ———
            var uploadBtn = document.getElementById('pbiUpload');
            if (uploadBtn) {
                // 创建隐藏的 file input
                var fileInput = document.createElement('input');
                fileInput.type = 'file';
                fileInput.accept = 'video/*,audio/*,.srt,.ass,.vtt';
                fileInput.style.display = 'none';
                document.body.appendChild(fileInput);

                uploadBtn.addEventListener('click', function() {
                    fileInput.click();
                });

                fileInput.addEventListener('change', function() {
                    if (!this.files || !this.files.length) return;
                    var file = this.files[0];
                    var name = file.name || '';
                    var ext = name.split('.').pop().toLowerCase();

                    // 根据文件类型分派
                    var isVideo = /^(mp4|mov|avi|mkv|webm|flv|wmv|m4v|ts)$/.test(ext) || file.type.startsWith('video/');
                    var isAudio = /^(mp3|wav|aac|flac|ogg|m4a|wma)$/.test(ext) || file.type.startsWith('audio/');
                    var isSubtitle = /^(srt|ass|vtt)$/.test(ext);

                    if (isVideo || isAudio || isSubtitle) {
                        // 在当前页面派发上传事件
                        document.dispatchEvent(new CustomEvent('tideo:file-upload', {
                            detail: { file: file, skill: skill }
                        }));

                        // 给输入框显示反馈
                        textarea.value = '';
                        textarea.placeholder = '✓ 已选择文件: ' + name;
                        setTimeout(function() {
                            textarea.placeholder = self._getPlaceholder(skill);
                        }, 2000);

                        // 如果当前是译制页，直接触发上传流程
                        if (skill === 'translate') {
                            // translate-v6 会监听 tideo:file-upload
                        } else if (skill === 'generate') {
                            // 提示可以跳转到译制
                            textarea.value = '用这个视频: ' + name;
                        }
                    } else {
                        textarea.placeholder = '⚠ 不支持的文件类型: .' + ext;
                        setTimeout(function() {
                            textarea.placeholder = self._getPlaceholder(skill);
                        }, 2000);
                    }

                    // 重置 file input，允许重复选择同一文件
                    this.value = '';
                });
            }

            // ——— 🔗 粘贴链接按钮 ———
            var linkBtn = document.getElementById('pbiLink');
            if (linkBtn) {
                linkBtn.addEventListener('click', function() {
                    // 优先尝试从剪贴板读取
                    if (navigator.clipboard && navigator.clipboard.readText) {
                        navigator.clipboard.readText().then(function(clipText) {
                            clipText = (clipText || '').trim();
                            if (clipText && /^https?:\/\//i.test(clipText)) {
                                self._handleLinkInput(clipText, skill, textarea);
                            } else {
                                // 剪贴板没有链接，弹 prompt 手动输入
                                self._promptForLink(skill, textarea);
                            }
                        }).catch(function() {
                            // 剪贴板 API 被拒绝，fallback 到 prompt
                            self._promptForLink(skill, textarea);
                        });
                    } else {
                        // 浏览器不支持 clipboard API
                        self._promptForLink(skill, textarea);
                    }
                });
            }
        },

        _getPlaceholder: function(skill) {
            var placeholders = {
                translate: '继续输入指令... 如「再翻译成日语」「换成男声配音」',
                livestream: '继续输入指令... 如「只保留带货片段」「换成竖屏比例」',
                generate: '继续输入指令... 如「换成赛博朋克风格」「时长改为1分钟」'
            };
            return placeholders[skill] || '继续输入指令...';
        },

        /**
         * 弹出 prompt 让用户手动输入链接
         */
        _promptForLink: function(skill, textarea) {
            var url = prompt('粘贴链接地址：\n\n支持直播链接、视频链接、素材链接等');
            if (url && url.trim()) {
                this._handleLinkInput(url.trim(), skill, textarea);
            }
        },

        /**
         * 处理链接输入 — 根据链接类型路由
         */
        _handleLinkInput: function(url, currentSkill, textarea) {
            // 1. 检测是否是直播链接
            var livePatterns = [
                { pattern: /live\.douyin\.com|douyin\.com\/live/i, name: '抖音直播' },
                { pattern: /live\.kuaishou\.com|kuaishou\.com\/live/i, name: '快手直播' },
                { pattern: /live\.bilibili\.com|b23\.tv/i, name: 'B站直播' },
                { pattern: /taobao\.com\/live|live\.taobao\.com/i, name: '淘宝直播' },
                { pattern: /douyu\.com/i, name: '斗鱼直播' },
                { pattern: /huya\.com/i, name: '虎牙直播' }
            ];

            for (var i = 0; i < livePatterns.length; i++) {
                if (livePatterns[i].pattern.test(url)) {
                    // 是直播链接
                    if (currentSkill === 'livestream') {
                        // 已在直播页 → 填入输入框并触发连接
                        var liveUrlInput = document.getElementById('liveUrlInput');
                        if (liveUrlInput) {
                            liveUrlInput.value = url;
                            liveUrlInput.dispatchEvent(new Event('input'));
                            // 自动触发连接
                            if (typeof window.validateAndConnect === 'function') {
                                window.validateAndConnect();
                            }
                        }
                        textarea.placeholder = '✓ 已粘贴直播链接';
                        setTimeout(function() {
                            textarea.placeholder = this._getPlaceholder ? this._getPlaceholder(currentSkill) : '继续输入指令...';
                        }.bind(this), 2000);
                    } else {
                        // 不在直播页 → 跳转
                        this._saveContext(currentSkill);
                        window.location.href = SKILL_URLS.livestream + '?liveUrl=' + encodeURIComponent(url);
                    }
                    return;
                }
            }

            // 2. 检测是否是视频平台链接（可能需要译制/生成）
            var videoPatterns = [
                /youtube\.com|youtu\.be/i,
                /bilibili\.com\/video/i,
                /douyin\.com\/video/i,
                /tiktok\.com/i,
                /vimeo\.com/i
            ];

            var isVideoLink = false;
            for (var j = 0; j < videoPatterns.length; j++) {
                if (videoPatterns[j].test(url)) {
                    isVideoLink = true;
                    break;
                }
            }

            if (isVideoLink) {
                // 视频链接 → 填入输入框，由用户决定怎么处理
                textarea.value = url;
                textarea.dispatchEvent(new Event('input'));
                textarea.focus();
                textarea.placeholder = '已粘贴视频链接，输入指令如「翻译成英语」或「生成短视频」';
                setTimeout(function() {
                    textarea.placeholder = this._getPlaceholder ? this._getPlaceholder(currentSkill) : '继续输入指令...';
                }.bind(this), 3000);
                return;
            }

            // 3. 其他链接 → 直接填入输入框
            textarea.value = url;
            textarea.dispatchEvent(new Event('input'));
            textarea.focus();
        },

        _detectIntent: function(text) {
            var scores = {};
            Object.keys(SKILL_KEYWORDS).forEach(function(key) {
                scores[key] = 0;
                SKILL_KEYWORDS[key].forEach(function(kw) {
                    if (text.indexOf(kw) !== -1) scores[key]++;
                });
            });

            var best = null;
            var bestScore = 0;
            Object.keys(scores).forEach(function(key) {
                if (scores[key] > bestScore) {
                    bestScore = scores[key];
                    best = key;
                }
            });

            return bestScore > 0 ? best : null;
        },

        _handleSubmit: function(currentSkill) {
            var textarea = document.getElementById('pbiTextarea');
            var text = textarea.value.trim();
            if (!text) return;

            var detected = this._detectIntent(text.toLowerCase());

            if (detected && detected !== currentSkill) {
                // ——— 跨技能跳转：携带当前素材上下文 ———
                this._saveContext(currentSkill);
                var url = SKILL_URLS[detected];
                url += '?prompt=' + encodeURIComponent(text);
                window.location.href = url;
            } else {
                // ——— 同技能：检测子意图 ———
                var subIntent = this._detectSubIntent(text.toLowerCase(), currentSkill);
                var event = new CustomEvent('tideo:pageinput', {
                    detail: {
                        text: text,
                        skill: currentSkill,
                        action: subIntent.action,   // 'new-task' | 'finetune' | 'redo' | 'chat'
                        subType: subIntent.subType   // 'newLang' | 'voiceChange' | 'styleAdj' | null
                    }
                });
                document.dispatchEvent(event);

                var origPlaceholder = textarea.placeholder;
                textarea.value = '';
                textarea.style.height = 'auto';
                textarea.placeholder = '✓ 指令已接收';
                setTimeout(function() {
                    textarea.placeholder = origPlaceholder;
                }, 1200);
            }
        },

        /**
         * 检测同技能内的子意图
         */
        _detectSubIntent: function(text, skill) {
            var subKeys = SUB_INTENT_KEYWORDS[skill];
            if (!subKeys) return { action: 'chat', subType: null };

            // 优先检测「新语种翻译」(translate) 或 「新风格」(generate)
            if (subKeys.newLang) {
                for (var i = 0; i < subKeys.newLang.length; i++) {
                    if (text.indexOf(subKeys.newLang[i]) !== -1) {
                        return { action: 'new-task', subType: 'newLang' };
                    }
                }
            }
            if (subKeys.newStyle) {
                for (var i = 0; i < subKeys.newStyle.length; i++) {
                    if (text.indexOf(subKeys.newStyle[i]) !== -1) {
                        return { action: 'new-task', subType: 'newStyle' };
                    }
                }
            }

            // 检测配音更换
            if (subKeys.voiceChange) {
                for (var i = 0; i < subKeys.voiceChange.length; i++) {
                    if (text.indexOf(subKeys.voiceChange[i]) !== -1) {
                        return { action: 'finetune', subType: 'voiceChange' };
                    }
                }
            }

            // 检测字幕样式调整
            if (subKeys.styleAdj) {
                for (var i = 0; i < subKeys.styleAdj.length; i++) {
                    if (text.indexOf(subKeys.styleAdj[i]) !== -1) {
                        return { action: 'finetune', subType: 'styleAdj' };
                    }
                }
            }

            // 检测片段编辑（generate）
            if (subKeys.clipEdit) {
                for (var i = 0; i < subKeys.clipEdit.length; i++) {
                    if (text.indexOf(subKeys.clipEdit[i]) !== -1) {
                        return { action: 'finetune', subType: 'clipEdit' };
                    }
                }
            }

            // 检测时长调整（generate）
            if (subKeys.lengthAdj) {
                for (var i = 0; i < subKeys.lengthAdj.length; i++) {
                    if (text.indexOf(subKeys.lengthAdj[i]) !== -1) {
                        return { action: 'finetune', subType: 'lengthAdj' };
                    }
                }
            }

            // 检测重做
            if (subKeys.redo) {
                for (var i = 0; i < subKeys.redo.length; i++) {
                    if (text.indexOf(subKeys.redo[i]) !== -1) {
                        return { action: 'redo', subType: 'redo' };
                    }
                }
            }

            return { action: 'chat', subType: null };
        },

        /**
         * 跨技能跳转前保存当前素材上下文到 sessionStorage
         */
        _saveContext: function(fromSkill) {
            var ctx = {
                fromSkill: fromSkill,
                timestamp: Date.now()
            };

            // 尝试获取当前页的视频文件名
            var filenameEl = document.getElementById('topbarFilename');
            if (filenameEl) {
                var fname = filenameEl.textContent.replace(/^—\s*/, '').trim();
                if (fname) ctx.videoName = fname;
            }

            // 获取视频 src
            var videoEl = document.getElementById('mainVideo');
            if (videoEl && videoEl.src) {
                ctx.videoSrc = videoEl.src;
            }

            // generate 页面额外信息
            if (fromSkill === 'generate') {
                ctx.fromGenerate = true;
                ctx.videoName = 'AI 生成视频';
            }

            try {
                sessionStorage.setItem('tideo_carry_context', JSON.stringify(ctx));
            } catch(e) {}
        },

        hide: function() {
            var el = document.getElementById('pbiWrapper');
            if (el) el.classList.add('hidden');
        },

        show: function() {
            var el = document.getElementById('pbiWrapper');
            if (el) el.classList.remove('hidden');
        }
    };

})();
