/**
 * Created by Benson.Liao on 16/1/20.
 */
function FxEnum() {
};
/**
 * 連線狀態
 * @namespace fxStatus
 * @typedef {"http"} fxStatus.http
 * @typedef {"websocket"} fxStatus.websocket
 * @typedef {"flashSocket"} fxStatus.flashSocket
 * @typedef {"socket"} fxStatus.socket
 */
const fxStatus = Object.freeze({
    "http":         "http",
    "websocket":    "ws",
    "flashSocket":  "flashsocket",
    "socket":       "socket"
});
// 子程序分流規則 //
const balanceOpt = {
    "roundrobin": 0,
    "url_param" : 1,
    "leastconn" : 2
};
/**
 * @typedef {Object} Versions
 * @property {String} v1
 * @property {String} v2
 * @enum {String} Versions
 * @readonly
 */
const Versions = Object.freeze({
    v1: "v1",
    v2: "v2"
})
module.exports = {
    fxStatus:fxStatus,
    balanceOption:balanceOpt,
    Versions:Versions
};

