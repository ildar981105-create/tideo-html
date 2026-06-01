(function(global) {
'use strict';

var INTRANET_ORIGIN = '';
var APP_BASE_PATH = '/app';

global.TIDEO_DEPLOYMENT = {
    mode: 'intranet',
    label: '内网部署版',
    origin: INTRANET_ORIGIN,
    appBase: INTRANET_ORIGIN + APP_BASE_PATH,
    createUrl: INTRANET_ORIGIN + APP_BASE_PATH + '/create.html',
    hubUrl: INTRANET_ORIGIN + APP_BASE_PATH + '/hub.html',
    reviewUrl: INTRANET_ORIGIN + APP_BASE_PATH + '/review.html',
    apiBase: 'https://1306264703-4mtd7pg0gt.ap-guangzhou.tencentscf.com'
};

})(window);
