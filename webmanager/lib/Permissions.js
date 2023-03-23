"use strict";
/**
 * websocket-api
 * @type {Readonly<{}>}
 */
const WSPermissions = ((values) => {
    values[values['login'] = 0] = 'login';
    values[values['logout'] = 1] = 'logout';
    values[values['getServiceInfo'] = 2] = 'getServiceInfo';
    values[values['getSysInfo'] = 3] = 'getSysInfo';
    values[values['getDashboardInfo'] = 4] = 'getDashboardInfo';
    values[values['lockdownMode'] = 5] = 'lockdownMode';
    values[values['addCluster'] = 6] = 'addCluster';
    values[values['editCluster'] = 7] = 'editCluster';
    values[values['killCluster'] = 8] = 'killCluster';
    values[values['restartCluster'] = 9] = 'restartCluster';
    values[values['restartMultiCluster'] = 10] = 'restartMultiCluster';
    values[values['reloadToPID'] = 11] = 'reloadToPID';
    values[values['startWarp'] = 12] = 'startWarp';
    values[values['kickoutToPID'] = 13] = 'kickoutToPID';
    values[values['refuseUser'] = 14] = 'refuseUser';
    values[values['ipcMessage'] = 15] = 'ipcMessage';
    values[values['getMetadata'] = 16] = 'getMetadata';
    values[values['blockAll'] = 17] = 'blockAll';
    values[values['warpTunnel'] = 18] = 'warpTunnel';
    values[values['createUDPManager'] = 19] = 'createUDPManager';
    values[values['handoffMediaData'] = 20] = 'handoffMediaData';
    values[values['getWorkServices'] = 21] = 'getWorkServices';
    values[values['mediaSaveFile'] = 22] = 'mediaSaveFile';
    values[values['udpEstablish'] = 23] = 'udpEstablish';
    values[values['getLBGamePath'] = 24] = 'getLBGamePath';
    values[values['setLBGamePath'] = 25] = 'setLBGamePath';
    values[values['getIPFilter'] = 26] = 'getIPFilter';
    values[values['setIPFilter'] = 27] = 'setIPFilter';
    values[values['setLogLevel'] = 28] = 'setLogLevel';
    values[values['getAMFConfig'] = 29] = 'getAMFConfig';
    values[values['setAMFConfig'] = 30] = 'setAMFConfig';
    values[values['getSchedule'] = 31] = 'getSchedule';
    values[values['addSchedule'] = 32] = 'addSchedule';
    values[values['cancelSchedule'] = 33] = 'cancelSchedule';
    values[values['appSettings'] = 34] = 'appSettings';
    values[values['appSettingsSave'] = 35] = 'appSettingsSave';
    values[values['liveLog'] = 36] = 'liveLog';
    values[values['leaveLog'] = 37] = 'leaveLog';
    return Object.freeze(values);
})({});
/**
 * rest-api
 * @type {Readonly<{}>}
 */
const HTTPPermissions = ((values) => {
    let api = [
        ["/version",                0],
        ["/user/login",             1],
        ["/user/logout",            2],
        ["/user/password",          3],
        ["/user/2fa",               4],
        ["/amf/config",             5],
        ["/balancing/rule",         6],
        ["/process/sys/info",       7],
        ["/process/sys/metadata",   8],
        ["/process/user/kickout",   9],
        ["/process/info",           10],
        ["/process/batch/reboot",   11],
        ["/process/warp/tunnel",    12],
        ["/service/dashboard/info", 13],
        ["/service/lockdown/mode",  14],
        ["/service/blocklist",      15],
        ["/user/otp/qrcode",        16],
        ["/user/login/gen/otp",     17],
        ["/dir/",                   18],
        ["/message/apply",          19]
    ];
    api.forEach(([key, index]) => {
        values[values[key] = index] = key;
    });
    return Object.freeze(values);
})({});

/**
 * 角色權限
 * @type {Readonly<{Guest, Viewer, Manager, Boss}>}
 */
const Roles = ((values) => {
    values[values['Guest'] = 0] = 'Guest';
    values[values['Viewer'] = 1] = 'Viewer';
    values[values['Manager'] = 5] = 'Manager';
    values[values['Boss'] = 777] = 'Boss';
    return Object.freeze(values);
})({});



module.exports = exports = {
    WSPermissions,
    HTTPPermissions,
    Roles
};