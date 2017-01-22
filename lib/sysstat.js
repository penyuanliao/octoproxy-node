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

util.inherits(sysstat, events.EventEmitter); // 繼承事件
function sysstat() {
    events.EventEmitter.call(this);
    // this.cpusInfo = [];
    this.runCPUList = [];
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

module.exports.sysstat = sysstat;
// var sysstat = require('./sysstat.js').sysstat;
// var stat = new sysstat();
// stat.fd(function (val) {
//     console.log('fd:', val);
// })
// stat.pidCPU(process.pid);
// stat.on(process.pid, function (info) {
//     console.log(info);
// });