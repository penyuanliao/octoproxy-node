const net          = require("net");
const fs           = require("fs");
const util         = require("util");
const readline     = require("readline");
const EventEmitter = require("events");

util.inherits(FxNetworkMonitor, EventEmitter);

function FxNetworkMonitor() {
    EventEmitter.call(this);
    this.entires = {}; //記錄所有使用者流量
    this.scBytes = 0; //整體送流量(sec)
    this.csBytes = 0; //整體收流量(sec)
    this.clalculated_scBytes = 0; //整體送流量
    this.clalculated_csBytes = 0; //整體收流量
    setInterval(function (self) {
        // console.log('outgoing:%s, incoming:%s', self.scBytes, self.csBytes);
        self.clearning();
    }, 5000, this);
}
/** 伺服器傳送的位元組數 **/
FxNetworkMonitor.prototype.outgoing = function (len) {
    this.scBytes += len;
    this.clalculated_scBytes += len;
};
/** 伺服器接收的位元組數 **/
FxNetworkMonitor.prototype.incoming = function (len) {
    this.csBytes += len;
    this.clalculated_csBytes += len;
};
FxNetworkMonitor.prototype.clearning = function () {
    this.scBytes = 0;
    this.csBytes = 0;
}
/** append to user list **/
FxNetworkMonitor.prototype.join = function (key, log) {
    this.entires[key] = log;
}
/** remove to user list **/
FxNetworkMonitor.prototype.eject = function (key) {
    this.entires[key] = undefined;
    delete this.entires[key];
}

/* ************************************************************************
                    SINGLETON CLASS DEFINITION
 ************************************************************************ */

FxNetworkMonitor.instance = null;

/**
 * Singleton getInstance definition
 * @return singleton class
 */
FxNetworkMonitor.getInstance = function () {
    if(this.instance === null) {
        this.instance = new FxNetworkMonitor();
    }
    return this.instance;
};
module.exports = exports = FxNetworkMonitor;
