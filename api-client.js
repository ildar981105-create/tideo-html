/**
 * api-client.js — Tideo 前端 API 封装
 * 对接腾讯云 SCF 云函数（MPS 任务管理）
 * 对接腾讯云 COS JS SDK（文件上传）
 */
(function(global) {
'use strict';

const SCF_BASE = 'https://1306264703-4mtd7pg0gt.ap-guangzhou.tencentscf.com';

// ========== 基础请求 ==========
const API_DISABLED = false;

async function request(path, data) {
    if (API_DISABLED) {
        console.warn('[API 已停用] 拦截请求:', path);
        throw new Error('API 已停用');
    }
    const url = SCF_BASE + path;
    const opts = {
        method: data ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json' }
    };
    if (data) opts.body = JSON.stringify(data);

    const res = await fetch(url, opts);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || '请求失败');
    return json.data;
}

// ========== COS 上传（使用 COS JS SDK） ==========

let _cosInstance = null;

function getCOS() {
    if (_cosInstance) return _cosInstance;
    if (typeof COS === 'undefined') {
        throw new Error('请先引入 COS JS SDK: <script src="https://unpkg.com/cos-js-sdk-v5/dist/cos-js-sdk-v5.min.js"></script>');
    }
    _cosInstance = new COS({
        getAuthorization: function(options, callback) {
            request('/upload-credential').then(function(data) {
                callback({
                    TmpSecretId: data.credentials.TmpSecretId,
                    TmpSecretKey: data.credentials.TmpSecretKey,
                    SecurityToken: data.credentials.Token,
                    StartTime: data.startTime || Math.floor(Date.now() / 1000),
                    ExpiredTime: data.expiredTime
                });
            }).catch(function(err) {
                console.error('获取上传凭证失败:', err);
                callback(new Error('获取上传凭证失败: ' + err.message));
            });
        }
    });
    return _cosInstance;
}

/**
 * 上传文件到 COS
 * @param {File} file - 用户选择的文件
 * @param {Function} [onProgress] - 进度回调 (0~1)
 * @returns {Promise<{url: string, key: string, bucket: string, region: string}>}
 */
async function uploadFile(file, onProgress) {
    if (API_DISABLED) {
        console.warn('[API 已停用] 拦截 COS 上传:', file.name);
        throw new Error('API 已停用');
    }
    const cos = getCOS();
    const bucket = 'saastestdarianyi-1306264703';
    const region = 'ap-guangzhou';
    const ext = file.name.split('.').pop().toLowerCase() || 'mp4';
    const key = 'uploads/' + Date.now() + '_' + Math.random().toString(36).slice(2,8) + '.' + ext;

    return new Promise(function(resolve, reject) {
        var timeout = setTimeout(function() {
            reject(new Error('上传超时（15s 无响应），请检查网络'));
        }, 15000);

        cos.putObject({
            Bucket: bucket,
            Region: region,
            Key: key,
            Body: file,
            onProgress: function(info) {
                clearTimeout(timeout);
                if (onProgress) onProgress(info.percent);
            }
        }, function(err, data) {
            clearTimeout(timeout);
            if (err) {
                reject(new Error('上传失败: ' + (err.message || JSON.stringify(err))));
            } else {
                var url = 'https://' + bucket + '.cos.' + region + '.myqcloud.com/' + key;
                resolve({ url: url, key: key, bucket: bucket, region: region });
            }
        });
    });
}

// ========== MPS API ==========

/**
 * 发起视频译制任务
 * @param {Object} opts
 * @param {string} opts.videoUrl - COS 视频 URL
 * @param {string} opts.mode - 'full' | 'erase' | 'subtitle' | 'voice'
 * @param {string} [opts.srcLang] - 源语言
 * @param {string} [opts.dstLang] - 目标语言
 * @returns {Promise<{taskId: string}>}
 */
async function translate(opts) {
    return request('/translate', opts);
}

/**
 * 发起智能擦除任务
 * @param {Object} opts
 * @param {string} opts.videoUrl - COS 视频 URL
 * @param {number} [opts.templateId] - 模板 ID
 * @returns {Promise<{taskId: string}>}
 */
async function erase(opts) {
    return request('/erase', opts);
}

/**
 * 发起视频剪辑任务
 * @param {Object} opts
 * @param {string} opts.videoUrl - COS 视频 URL
 * @param {number} opts.startTime - 开始时间（秒）
 * @param {number} opts.endTime - 结束时间（秒）
 * @returns {Promise<{taskId: string}>}
 */
async function clip(opts) {
    return request('/clip', opts);
}

/**
 * 查询任务状态
 * @param {string} taskId
 * @returns {Promise<{status: string, taskType: string, detail: Object}>}
 */
async function getTask(taskId) {
    return request('/task/' + taskId);
}

/**
 * 轮询任务直到完成
 * @param {string} taskId
 * @param {Object} [opts]
 * @param {number} [opts.interval=5000] - 轮询间隔（ms）
 * @param {number} [opts.timeout=600000] - 超时时间（ms，默认10分钟）
 * @param {Function} [opts.onProgress] - 每次查询回调
 * @returns {Promise<Object>} 最终任务结果
 */
async function pollTask(taskId, opts) {
    opts = opts || {};
    var interval = opts.interval || 5000;
    var timeout = opts.timeout || 600000;
    var onProgress = opts.onProgress || function() {};
    var start = Date.now();

    return new Promise(function(resolve, reject) {
        function check() {
            if (Date.now() - start > timeout) {
                reject(new Error('任务超时（超过' + Math.round(timeout/60000) + '分钟）'));
                return;
            }
            getTask(taskId).then(function(task) {
                onProgress(task);
                if (task.status === 'FINISH') {
                    resolve(task);
                } else if (task.status === 'FAIL') {
                    reject(new Error('任务处理失败'));
                } else {
                    // WAITING 或 PROCESSING，继续轮询
                    setTimeout(check, interval);
                }
            }).catch(function(err) {
                console.warn('[TideoAPI] 轮询出错，5s后重试:', err.message);
                setTimeout(check, 5000);
            });
        }
        // 首次稍微延迟，给后端启动时间
        setTimeout(check, 2000);
    });
}

// ========== 健康检查 ==========
async function ping() {
    return request('/');
}

// ========== COS 文件列表 ==========

var COS_BUCKET = 'saastestdarianyi-1306264703';
var COS_REGION = 'ap-guangzhou';
var COS_BASE_URL = 'https://' + COS_BUCKET + '.cos.' + COS_REGION + '.myqcloud.com/';

/**
 * 列出 COS 桶中的文件夹和文件（支持 Delimiter 分层浏览）
 * @param {Object} [opts]
 * @param {string} [opts.prefix=''] - 前缀（文件夹路径，如 'uploads/'）
 * @param {number} [opts.maxKeys=500] - 最大返回数
 * @returns {Promise<{folders: Array<{prefix, name}>, files: Array<{key, name, size, lastModified, url}>}>}
 */
async function listBucket(opts) {
    if (API_DISABLED) {
        console.warn('[API 已停用] 拦截 COS listBucket');
        return { folders: [], files: [] };
    }
    opts = opts || {};
    var cos = getCOS();
    var prefix = opts.prefix || '';
    var maxKeys = opts.maxKeys || 500;

    return new Promise(function(resolve, reject) {
        cos.getBucket({
            Bucket: COS_BUCKET,
            Region: COS_REGION,
            Prefix: prefix,
            Delimiter: '/',
            MaxKeys: maxKeys
        }, function(err, data) {
            if (err) {
                reject(new Error('列出文件失败: ' + (err.message || err)));
                return;
            }
            // 文件夹
            var folders = (data.CommonPrefixes || []).map(function(p) {
                var pfx = p.Prefix;
                // 去掉末尾斜杠取文件夹名
                var parts = pfx.replace(/\/$/,'').split('/');
                return { prefix: pfx, name: parts[parts.length-1] };
            });
            // 文件
            var files = (data.Contents || [])
                .filter(function(item) { return item.Size > 0 && item.Key !== prefix; })
                .map(function(item) {
                    return {
                        key: item.Key,
                        name: item.Key.split('/').pop(),
                        size: parseInt(item.Size),
                        lastModified: item.LastModified,
                        url: COS_BASE_URL + item.Key
                    };
                })
                .sort(function(a, b) { return new Date(b.lastModified) - new Date(a.lastModified); });
            resolve({ folders: folders, files: files });
        });
    });
}

/**
 * 列出 COS 桶中的文件（扁平，不分文件夹）
 */
async function listFiles(opts) {
    if (API_DISABLED) {
        console.warn('[API 已停用] 拦截 COS listFiles');
        return [];
    }
    opts = opts || {};
    var cos = getCOS();
    var prefix = opts.prefix || 'uploads/';
    var maxKeys = opts.maxKeys || 200;

    return new Promise(function(resolve, reject) {
        cos.getBucket({
            Bucket: COS_BUCKET,
            Region: COS_REGION,
            Prefix: prefix,
            MaxKeys: maxKeys
        }, function(err, data) {
            if (err) {
                reject(new Error('列出文件失败: ' + (err.message || err)));
                return;
            }
            var files = (data.Contents || [])
                .filter(function(item) { return item.Size > 0; })
                .map(function(item) {
                    return {
                        key: item.Key,
                        name: item.Key.split('/').pop(),
                        size: parseInt(item.Size),
                        lastModified: item.LastModified,
                        url: COS_BASE_URL + item.Key
                    };
                })
                .sort(function(a, b) { return new Date(b.lastModified) - new Date(a.lastModified); });
            resolve(files);
        });
    });
}

// ========== VOD AIGC 视频/图片生成 ==========

var VOD_SUBAPPID = 1500028389;

/**
 * 模型能力表 — 标记各模型支持的特性
 */
var MODEL_CAPS = {
    'Kling':    { multiShot: true,  maxDuration: 15, enhancePrompt: true,  firstFrame: true  },
    'Vidu':     { multiShot: false, maxDuration: 8,  enhancePrompt: true,  firstFrame: true  },
    'Hailuo':   { multiShot: false, maxDuration: 6,  enhancePrompt: false, firstFrame: false },
    'GV':       { multiShot: false, maxDuration: 10, enhancePrompt: true,  firstFrame: false },
    'PixVerse': { multiShot: false, maxDuration: 8,  enhancePrompt: false, firstFrame: true  },
    'Jimeng':   { multiShot: true,  maxDuration: 10, enhancePrompt: true,  firstFrame: true  }
};

/**
 * 创建 AIGC 生视频任务
 * @param {Object} opts
 * @param {string} opts.model - 模型名：Kling / Vidu / Hailuo / GV / PixVerse / Jimeng
 * @param {string} opts.version - 模型版本
 * @param {string} [opts.prompt] - 提示词
 * @param {Array}  [opts.images] - 参考图片 [{url, type:'Url', usage:'FirstFrame'|'Reference'}]
 * @param {Object} [opts.output] - 输出配置 {duration, resolution, aspectRatio, audio, storage}
 * @param {Object} [opts.multiShot] - 分镜配置 {enabled, type:'intelligence'|'customize', shots:[]}
 * @param {string} [opts.enhancePrompt] - 提示词增强 'Enabled'|'Disabled' (默认 Enabled)
 * @param {string} [opts.lastFrameUrl] - 尾帧图片 URL
 * @param {Array}  [opts.subjectInfos] - 主体信息（角色一致性）
 * @returns {Promise<{taskId: string, _modelCaps: Object}>}
 */
async function aigcVideo(opts) {
    var modelName = opts.model || 'Kling';
    var caps = MODEL_CAPS[modelName] || MODEL_CAPS['Kling'];

    var params = {
        SubAppId: VOD_SUBAPPID,
        ModelName: modelName,
        ModelVersion: opts.version || '3.0',
        Prompt: opts.prompt || '',
        EnhancePrompt: caps.enhancePrompt ? (opts.enhancePrompt || 'Enabled') : undefined
    };

    // 参考图片 / 首帧
    if (opts.images && opts.images.length) {
        params.FileInfos = opts.images.filter(function(img) {
            // 如果模型不支持首帧，跳过 FirstFrame 类型
            if (img.usage === 'FirstFrame' && !caps.firstFrame) return false;
            return true;
        }).map(function(img) {
            var fi = { Type: 'Url', Url: img.url, Category: 'Image' };
            if (img.usage) fi.Usage = img.usage;
            if (img.objectId) fi.ObjectId = img.objectId;
            return fi;
        });
        if (!params.FileInfos.length) delete params.FileInfos;
    }

    // 尾帧
    if (opts.lastFrameUrl) params.LastFrameUrl = opts.lastFrameUrl;

    // 主体信息
    if (opts.subjectInfos) params.SubjectInfos = opts.subjectInfos;

    // 输出配置
    var out = opts.output || {};
    var reqDuration = out.duration || 5;
    // 限制不超过模型最大时长
    if (reqDuration > caps.maxDuration) reqDuration = caps.maxDuration;
    params.OutputConfig = {
        StorageMode: out.storage || 'Permanent',
        Duration: reqDuration,
        Resolution: out.resolution || '1080P',
        AspectRatio: out.aspectRatio || '16:9',
        AudioGeneration: out.audio === false ? 'Disabled' : 'Enabled'
    };

    // 分镜配置 — 仅支持的模型才启用
    if (opts.multiShot && opts.multiShot.enabled && caps.multiShot) {
        var additional = {};
        if (opts.multiShot.type === 'intelligence') {
            additional.multi_shot = 'intelligence';
        } else if (opts.multiShot.type === 'customize' && opts.multiShot.shots) {
            additional.multi_shot = true;
            additional.shot_type = 'customize';
            additional.multi_prompt = opts.multiShot.shots.map(function(s, i) {
                return { index: i + 1, prompt: s.prompt, duration: s.duration || 3 };
            });
        } else {
            additional.multi_shot = false;
        }
        params.ExtInfo = JSON.stringify({ AdditionalParameters: JSON.stringify(additional) });
    } else if (opts.multiShot && opts.multiShot.enabled && !caps.multiShot) {
        // 模型不支持分镜 — 日志提示，改为单镜头
        console.warn('[AIGC] 模型 ' + modelName + ' 不支持分镜，自动降级为单镜头模式');
    }

    // 清理 undefined 字段
    Object.keys(params).forEach(function(k) { if (params[k] === undefined) delete params[k]; });

    var result = await request('/aigc-video', params);
    result._modelCaps = caps;
    return result;
}

/**
 * 创建 AIGC 生图任务
 * @param {Object} opts
 * @param {string} opts.model - 模型名：GEM / SI / Kling / Vidu / Hunyuan 等
 * @param {string} opts.version - 模型版本
 * @param {string} opts.prompt - 提示词
 * @param {Array}  [opts.images] - 参考图片
 * @param {Object} [opts.output] - 输出配置 {resolution, aspectRatio, storage}
 * @returns {Promise<{taskId: string}>}
 */
async function aigcImage(opts) {
    var params = {
        SubAppId: VOD_SUBAPPID,
        ModelName: opts.model || 'GEM',
        ModelVersion: opts.version || '3.1',
        Prompt: opts.prompt || ''
    };
    if (opts.images && opts.images.length) {
        params.FileInfos = opts.images.map(function(img) {
            return { Type: 'Url', Url: img.url, Category: 'Image' };
        });
    }
    params.OutputConfig = {
        StorageMode: (opts.output && opts.output.storage) || 'Permanent',
        Resolution: (opts.output && opts.output.resolution) || '1080P',
        AspectRatio: (opts.output && opts.output.aspectRatio) || '1:1'
    };
    return request('/aigc-image', params);
}

/**
 * 查询 AIGC 任务详情（VOD DescribeTaskDetail）
 * @param {string} taskId
 * @returns {Promise<Object>}
 */
async function aigcTaskDetail(taskId) {
    return request('/aigc-task', { taskId: taskId, SubAppId: VOD_SUBAPPID });
}

/**
 * 轮询 AIGC 任务直到完成
 * @param {string} taskId
 * @param {Object} [opts]
 * @param {number} [opts.interval=8000]
 * @param {number} [opts.timeout=600000]
 * @param {Function} [opts.onProgress]
 * @returns {Promise<Object>}
 */
async function pollAigcTask(taskId, opts) {
    opts = opts || {};
    var interval = opts.interval || 8000;
    var timeout = opts.timeout || 600000;
    var onProgress = opts.onProgress || function() {};
    var start = Date.now();
    var finishRetries = 0;
    var MAX_FINISH_RETRIES = 8; // FINISH 后最多额外等 8 次（40s）拿 fileUrl

    return new Promise(function(resolve, reject) {
        function extractUrl(task) {
            if (task.aigcVideo && task.aigcVideo.fileUrl) return task.aigcVideo.fileUrl;
            if (task.aigcImage && task.aigcImage.fileUrl) return task.aigcImage.fileUrl;
            // 检查 rawOutput 中是否有 URL（后端新增的兜底字段）
            if (task.aigcVideo && task.aigcVideo.rawOutput) {
                var raw = task.aigcVideo.rawOutput;
                if (raw.FileUrl) return raw.FileUrl;
                if (raw.FileInfos && raw.FileInfos.length && raw.FileInfos[0].FileUrl) return raw.FileInfos[0].FileUrl;
            }
            return '';
        }

        function getFailMsg(task) {
            var parts = [];
            if (task.aigcVideo) {
                if (task.aigcVideo.errCode) parts.push('ErrCode:' + task.aigcVideo.errCode);
                if (task.aigcVideo.message) parts.push(task.aigcVideo.message);
            }
            if (task.aigcImage) {
                if (task.aigcImage.errCode) parts.push('ErrCode:' + task.aigcImage.errCode);
                if (task.aigcImage.message) parts.push(task.aigcImage.message);
            }
            return parts.length ? parts.join(' / ') : (task.message || task.Message || '未知错误');
        }

        function check() {
            if (Date.now() - start > timeout) {
                reject(new Error('AIGC 任务超时（超过' + Math.round(timeout/60000) + '分钟）'));
                return;
            }
            aigcTaskDetail(taskId).then(function(task) {
                onProgress(task);
                var isFinish = task.status === 'FINISH' || task.Status === 'FINISH';
                var isFail = task.status === 'FAIL' || task.Status === 'FAIL';

                if (isFail) {
                    var failMsg = getFailMsg(task);
                    console.error('[AIGC] 任务失败:', failMsg, JSON.stringify(task));
                    reject(new Error('AIGC 任务失败: ' + failMsg));
                    return;
                }

                if (isFinish) {
                    var url = extractUrl(task);
                    if (url) {
                        console.log('[AIGC] 成功获取 fileUrl:', url);
                        resolve(task);
                    } else if (finishRetries >= MAX_FINISH_RETRIES) {
                        // 超过最大重试次数仍无 URL，带警告 resolve
                        console.warn('[AIGC] 任务完成但始终未获取到 fileUrl，返回原始数据:', JSON.stringify(task));
                        task._noFileUrl = true;
                        resolve(task);
                    } else {
                        finishRetries++;
                        var waitMs = finishRetries <= 3 ? 5000 : 8000; // 前3次每5s，之后每8s
                        console.log('[AIGC] 任务已完成但 fileUrl 为空，等待媒资入库… (' + finishRetries + '/' + MAX_FINISH_RETRIES + ')，' + waitMs + 'ms 后重查');
                        setTimeout(check, waitMs);
                    }
                } else {
                    setTimeout(check, interval);
                }
            }).catch(function(err) {
                console.warn('[AIGC] 轮询出错，8s后重试:', err.message);
                setTimeout(check, 8000);
            });
        }
        setTimeout(check, 3000);
    });
}

// ========== 导出 ==========
global.TideoAPI = {
    ping: ping,
    uploadFile: uploadFile,
    listFiles: listFiles,
    listBucket: listBucket,
    translate: translate,
    erase: erase,
    clip: clip,
    getTask: getTask,
    pollTask: pollTask,
    aigcVideo: aigcVideo,
    aigcImage: aigcImage,
    aigcTaskDetail: aigcTaskDetail,
    pollAigcTask: pollAigcTask,
    MODEL_CAPS: MODEL_CAPS,
    SCF_BASE: SCF_BASE,
    COS_BUCKET: COS_BUCKET,
    COS_REGION: COS_REGION,
    COS_BASE_URL: COS_BASE_URL,
    VOD_SUBAPPID: VOD_SUBAPPID
};

})(window);
