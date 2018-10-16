/**
 * Created by Benson.Liao on 2016/9/30.
 */
/* ----------------------------------
 *        Process Status
 * ---------------------------------- */
const events     = require('events');
const util       = require('util');
const state      = require('./ProcessStats.js');
const type       = require('os').type();
const exec       = require('child_process').exec;
const fs         = require('fs');

util.inherits(sysstat, events.EventEmitter); // 繼承事件
function sysstat() {
    events.EventEmitter.call(this);
    // this.cpusInfo = [];
    this.runCPUList = [];
    this.netDevices = {};
    //network history
    this.rxRecords = {};
    this.txRecords = {};
    this.getNetDevices();

};
sysstat.prototype.pidCPU = function (pid) {
    var self = this;

    if (typeof this.runCPUList[pid] != "undefined") return this.runCPUList[pid];
    var cpu = new state.ProcessStats();
    cpu.rpid = pid;
    cpu.listenCPU(pid);
    cpu.on("cpu.upgrade", function (info) {
        var rpid = this.rpid;
        self.emit(rpid, rpid, info);
    });
    this.runCPUList[pid] = cpu;
    return cpu;
};
sysstat.prototype.fd = function (callback) {


    var command = "df -kl | awk \'{print $8}\'";
    if (type.toLowerCase() == 'linux') command = "df -kl | awk \'{print $5,$6}\'";
    exec(command,function (err, stdout, stderr) {
        var i, obj;
        if (err) return callback(err);
        var drives = stdout.split('\n');

        if (type.toLowerCase() != 'linux') {
            callback(parseFloat(drives[1]));
            return;
        }
        if (stdout.search("/home") != -1) {
            for ( i = 0; i < drives.length; i++) {
                obj = drives[i].split(" ");
                if (obj[1] == '/home') {
                    callback(parseFloat(obj[0]));
                    return;
                }
            }
        }
        else if (stdout.search("/\n") != -1) {
            console.log('search //');
            for ( i = 0; i < drives.length; i++) {
                 obj = drives[i].split(" ");
                if (obj[1] == '/') {
                    callback(parseFloat(obj[0]));
                    return;
                }
            }
        }
        else {
            callback(parseFloat(drives[0].split(" ")[0]));
            return;
        }

    });
};
sysstat.prototype.fdblocks = function (callback) {
    var command = "df -kl | awk '{print $2}'";
    if (type.toLowerCase() == 'linux') command = "df -kl | awk '{print $2,$6}'";
    exec(command,function (err, stdout, stderr) {
        var i, obj;
        if (err) return callback(err);
        var drives = stdout.split('\n');

        if (type.toLowerCase() != 'linux') {
            callback(drives[1]);
            return;
        }
        if (stdout.search("/home") != -1) {
            for ( i = 0; i < drives.length; i++) {
                obj = drives[i].split(" ");
                if (obj[1] == '/home') {
                    callback(obj[0]);
                    return;
                }
            }
        }
        else if (stdout.search("/\n") != -1) {
            console.log('search //');
            for ( i = 0; i < drives.length; i++) {
                obj = drives[i].split(" ");
                if (obj[1] == '/') {
                    callback(obj[0]);
                    return;
                }
            }
        }
        else {
            callback((drives[0].split(" ")[0]));

            return;
        }

    });
};
sysstat.prototype.netDev = function (delay, callback) {
    var self = this;
    var prev;
    var sec = delay/1000;
    var onRead = function onRead(err, data) {
        prev = data;
    };
    var onReadAfter = function onReadAfter(err, data) {
        var rows  = prev.toString().split(/\n/g);
        var rowsf = data.toString().split(/\n/g);
        var title;
        var columns;
        var columnsf;
        var info = {};
        var value;
        var name;
        var key;
        for (var i = 1; i < rows.length; i++) {

            if (i == 1) {
                title = rows[i].match(/[^\s|\|]+/g);
                continue;
            }
            var item = {"unit": "kBs/s"};
            columns = rows[i].match(/[^\s|\||:]+/g);
            columnsf = rowsf[i].match(/[^\s|\||:]+/g);
            if (!columns) continue;
            for (var j = 0; j < columns.length; j++) {
                name = title[j];
                //(x2 - x1) / t
                if (!isNaN(columns[j])) {
                    value = ((Number(columns[j]) == 0) ? 0 : (columnsf[j] - columns[j]) / sec).toFixed(0);
                    if (name == "bytes" && value != 0) {
                        name = (j == 1) ? "receive" : "transmit";
                        value = (value/1024).toFixed(2);
                        if (name == "receive") {
                            item.rxRecords = self.recordTraffic(columns[0], name, value);
                        } else {
                            item.txRecords = self.recordTraffic(columns[0], name, value);
                        }
                    }
                    item[name] = value;
                } else {
                    item[name] = columnsf[j];
                }

            }
            key = self.netDevices[columns[0]];
            // info[columns[0]] = item;
            if (typeof key == "undefined") key = columns[0];
            info[key] = item;
        }
        if (callback) callback(info);
        prev = undefined;
        rows = undefined;
        rowsf = undefined;
        self = null;
    };
    if (type.toLowerCase() == 'linux') {
        fs.readFile("/proc/net/dev", onRead);
        setTimeout(function () {
            fs.readFile("/proc/net/dev", onReadAfter);
        }, delay);
    } else {
        fs.readFile("../test/dev", onRead);
        setTimeout(function () {
            fs.readFile("../test/dev-2", onReadAfter);
        }, delay);
    }
};
sysstat.prototype.recordTraffic = function (dev, name, value) {
    if (typeof this.rxRecords[dev] == "undefined") this.rxRecords[dev] = [];
    if (typeof this.txRecords[dev] == "undefined") this.txRecords[dev] = [];

    if (name === "receive") {
        var rx = this.rxRecords[dev];
        if (rx.length > 360) rx.shift();
        rx.push(value);
        return rx;
    } else if (name === "transmit") {
        var tx = this.txRecords[dev];
        if (tx.length > 360) tx.shift();
        tx.push(value);
        return tx;
    }

};

sysstat.prototype.netSnmp = function (delay, callback) {
    var prev;
    var sec = delay/1000;
    var self = this;
    var onRead = function onRead(err, data, stderr) {
        prev = data;
    };
    var onReadAfter = function onReadAfter(err, data, stderr) {
        var rows  = prev.toString().split(/\n/g);
        var rowsf  = data.toString().split(/\n/g);
        var title;
        var columns;
        var columnsf;
        var info = {};
        for (var i = 0; i < rows.length; i++) {
            if (i == 0) {
                title = rows[i].match(/[^\s|\||:]+/g);
                continue;
            }
            var item = {};
            columns = rows[i].match(/[^\s|\||:]+/g);
            columnsf = rowsf[i].match(/[^\s|\||:]+/g);
            if (!columns) continue;
            for (var j = 1; j < columns.length; j++) {
                if (title[j] == "CurrEstab"){
                    item[title[j]] = columnsf[j];
                } else if (!isNaN(columns[j])) {

                    if (title[j] == "RtoAlgorithm" || title[j] == "RtoMax" || title[j] == "RtoMin" || title[j] == "MaxConn") {
                        item[title[j]] = columnsf[j];
                    } else {
                        item[title[j]] = ((Number(columns[j]) == 0) ? 0 : (columnsf[j] - columns[j]) / sec).toFixed(0)
                    }

                } else {
                    item[title[j]] = columnsf[j];
                }
            }
            item.retransRate =  (columnsf[12] / columnsf[11]).toFixed(4);
            info[columns[0]] = item;
        }
        if (callback) callback(info);

        prev = undefined;
        rows = undefined;
        rowsf = undefined;
        self = undefined;
    };


    var command = "cat /proc/net/snmp|grep 'Tcp:'";

    if (type.toLowerCase() == 'linux') {
        exec(command, onRead);
        setTimeout(function () {
            exec(command, onReadAfter);
        }, delay);
    } else {
        fs.readFile("../test/snmp", onRead);
        setTimeout(function () {
            fs.readFile("../test/snmp-1", onReadAfter);
        }, delay);
    }

};
sysstat.prototype.getNetDevices = function () {
    var command = "ip addr | awk '/^[0-9]+/ { currentinterface=$2 } $1 == \"inet\" { split( $2, foo, \"/\" ); print currentinterface ,foo[1] }'";
    var self = this;
    var onRead = function onRead(err, stdout, stderr) {
        var rows  = stdout.toString().split(/\n/g);
        var columns;
        var face;
        var info = {};
        var search = -1;
        for (var i = 0; i < rows.length; i++) {
            if (rows[i] == "" || typeof rows[i] == "undefined") continue;
            columns = rows[i].match(/[^\s|:]+/g);
            if (columns.length >= 2) {
                face = columns[0];
                search = face.indexOf("@");
                face = (search != -1) ? face.substr(0, search) : face;
                info[face] = columns[1];
            }
        }
        self.netDevices = info;
        rows = undefined;
    };
    if (type.toLowerCase() == 'linux') {
        exec(command, onRead);
    } else {
        fs.readFile("../test/devices", onRead);
    }
};
/*
 1.RtoAlgorithm:
 2.RtoMin:
 3.RtoMax:
 4.MaxConn:
 5.ActiveOpens: TCP Initiator count 發送者
 6.PassiveOpens: TCP Receiver count 接收者
 7.AttemptFailsEstabResets: TCP Failed count. (主動連接失敗收到syn包回包syn+ack給對方後，被對方reset收到的請求中，同時有syn+rst flag)
 8.CurrEstab: Current tcp established count.
 9.InSegs: TCP 接收的分片數
10.OutSegs: TCP 發送的分片數
11.RetransSegs: TCP 重送分片數
12.InErrs: TCP 入包錯誤(pkg/m, 通常是校驗錯誤)
13.InCsumErrors:

TCP 重傳率(retransmission) =重傳分片數 / TCP發送的分片數

*/

module.exports.sysstat = sysstat;
// var sysstat = require('./sysstat.js').sysstat;
// var stat = new sysstat();
// stat.getNetDevices()
// setTimeout(function () {
//     console.log(stat.netDevices);
// }, 2000)


// stat.fd(function (val) {
//     console.log('fd:', val);
// })
// stat.pidCPU(process.pid);
// stat.on(process.pid, function (info) {
//     console.log(info);
// });


