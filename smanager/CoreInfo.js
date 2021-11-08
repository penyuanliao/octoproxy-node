"use strict";
const EventEmitter  = require("events");
const os            = require("os");
const psys          = require('systeminformation');
const sys           = require('../lib/sysstat.js');

/**
 *
 * @constructor
 */
class CoreInfo extends EventEmitter {
    constructor() {
        super();
        this.setupSysstat();
    }
}
CoreInfo.prototype.start = function () {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
        this.getDiskUse();
        this.getLoadAvg();
        this.counting++;
        if (this.counting >= 2) {
            this.counting = 0;
            this.getNetInfo(1000);
        }
    }, 5000);
};
CoreInfo.prototype.setupSysstat = function () {
    this.sysstat      = new sys.sysstat();
    this.cpusUsage    = {};
    this.cpusUsagePids = new Set();
    this.sysInfo      = {memory:0, hdd:0, cpuCount: os.cpus().length};
    this.monitoingCPU    = new Map();
    this.getDiskUse();
    this.getLoadAvg();
    this.getNetInfo(1000);
    this.counting = 0;
};
CoreInfo.prototype.checkServices = function (pidsSet) {
    let pids = new Set(pidsSet);
    for (let pid of pids.values()) {
        if (this.monitoingCPU.has(pid) == false) return true;
    }
    return false;
}
CoreInfo.prototype.getPID = function (info) {

    const modify = this.checkServices()

    if (typeof info == "undefined") return false;
    let pids = [];
    let prePids = new Set(this.cpusUsagePids);

    for (let i = 0; i < info.length; i++) {
        let {pid} = info[i];
        if (!this.cpusUsagePids.has(pid)) {
            //找尋增加的
            this.cpusUsagePids.add(pid);
            pids.push(pid);
        } else {
            //找尋已經移除的
            prePids.delete(pid);
        }
    }
    if (pids.length > 0) {
        this.runPID(pids);
    }
    if (prePids.size != 0) {
        this.stopPID(prePids);
    }
};
CoreInfo.prototype.runPID = function (arr) {

    for (let i = 0; i < arr.length; i++) {
        let pid = arr[i];
        if (this.monitoingCPU.has(pid)) continue;
        let cpu = this.sysstat.pidCPU(pid);
        this.sysstat.on(String(pid), (cpid, info) => {
            this.cpusUsage[cpid.toString()] = info;
            this.emit(cpid, info);
        });
        this.monitoingCPU.set(pid, cpu);
    }

};
/**
 *
 * @param {Set} pidSet
 */
CoreInfo.prototype.stopPID = function (pidSet) {
    let cpu;
    for (let pid of pidSet.values()) {

        if (this.monitoingCPU.has(pid)) {
            cpu = this.monitoingCPU.get(pid);
            cpu.stopCPU();
            this.monitoingCPU.delete(pid);
            this.cpusUsagePids.delete(pid);
            delete this.cpusUsage[pid.toString()];
            this.removeAllListeners(String(pid));
        }
    }
}
CoreInfo.prototype.cpu = function (pid) {
    let info = this.cpusUsage[pid.toString()];
    if (Array.isArray(info)) {
        return info[1];
    } else {
        return 0;
    }
}
CoreInfo.prototype.getDiskUse = function () {
    this.sysstat.fd((data) => {
        if (typeof data == 'number') {
            this.sysInfo["hdd"] = data;
        } else {
            console.error('getDiskUse:', data);
        }
    });
    if (typeof this.sysInfo["hddBlocks"] == "undefined") {
        this.sysstat.fdblocks((data) => {
            this.sysInfo["hddBlocks"] = data;
        });
    }
};
CoreInfo.prototype.getLoadAvg = function () {
    this.sysInfo["loadavg"] = os.loadavg();
    this.sysInfo["freemem"] = os.freemem();
};
CoreInfo.prototype.getNetInfo = function (delay) {
    if (typeof this.sysstat != "undefined") {
        this.sysstat.netDev(delay, (info) => {
            this.sysInfo["devices"] = info;
        });
        this.sysstat.netSnmp(delay, (info) => {
            this.sysInfo["snmp"] = info;
        });
    }
};
CoreInfo.prototype.refresh = function () {
    const data = {
        cpusUsage: this.cpusUsage,
        sysInfo: this.sysInfo
    };
    delete this.sysstat.devices;
    delete this.sysstat.snmp;
    return data;
}
CoreInfo.prototype.clean = function () {

};
CoreInfo.prototype.release = function () {

};
module.exports = exports = CoreInfo;