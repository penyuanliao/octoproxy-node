/**
 * Created by Benson.Liao on 2016/6/15.
 */
const fs     = require('fs');
const events = require('events');
const util   = require('util');
const os     = require('os');
const NSLog  = require('fxNetSocket').logger.getInstance();
util.inherits(ProcessStats, events.EventEmitter); // 繼承事件

function ProcessStats() {

    events.EventEmitter.call(this);

    this.cpuUsageTick = undefined;
    this.cpuPrecentage = 0.00;
    this.cpuTickTime = 1000;

};

ProcessStats.prototype.cpuUsage = function (pid, cb) {
    var self = this;
    // if (typeof pid == 'undefined') pid = process.pid;

    var getUsage = function(cb){
        if (os.platform() != 'linux' || process.pid == 'undefined') {
            var utime = 0,stime = 0;
            var cpus = os.cpus();
            for(var i = 0, len = cpus.length; i < len; i++) {
                // console.log("CPU %s:", i);
                var cpu = cpus[i], total = 0;

                for(var type in cpu.times) {
                    total += cpu.times[type];
                    if (type == "user") utime += cpu.times[type];
                    if (type == "sys") stime += cpu.times[type];
                }

                // for(type in cpu.times) {
                //
                //     console.log("\t ??", type, Math.round(100 * cpu.times[type] / total));
                // }
            }
            cb(utime + stime);
        }else if (pid == "")
        {

        }else {
            fs.readFile("/proc/" + pid + "/stat", function(err, data){
                if (typeof data == "undefined") data = "";
                var elems = data.toString().split(' ');
                var utime = parseInt(elems[13]);
                var stime = parseInt(elems[14]);

                cb(utime + stime);
            });
        }

    };

    function startRun(){
        getUsage(function(startTime){
            setTimeout(function(){
                getUsage(function(endTime){
                    var delta = endTime - startTime;
                    if (os.platform() == 'linux') {
                        self.cpuPrecentage = delta;
                    }else
                    {
                        self.cpuPrecentage = (100 * (delta / 10000));
                    }
                    if (cb) cb([new Date().getTime(),self.cpuPrecentage]);
                    self.emit('cpu.upgrade',[new Date().getTime(),self.cpuPrecentage]);
                });
            }, 1000);
        });
        self.cpuUsageTick = setTimeout(startRun, self.cpuTickTime);
    }
    this.cpuUsageTick = setTimeout(startRun, this.cpuTickTime);
};
ProcessStats.prototype.listenCPU = function (pid, cb) {
    if (typeof this.cpuUsageTick == 'undefined') {
        if (typeof arguments[0] == "number")
            this.cpuUsage(pid, cb);
        else
            this.cpuUsage(undefined, cb);
    }
};
ProcessStats.prototype.stopCPU = function () {
    if (typeof this.cpuUsageTick != 'undefined') {
        clearTimeout(this.cpuUsageTick);
        this.cpuUsageTick = undefined;
    }
};
util.inherits(sysCPUUsage, events.EventEmitter); // 繼承事件
function sysCPUUsage() {
    events.EventEmitter.call(this);

    var self = this;
    //http://stackoverflow.com/questions/23367857/accurate-calculation-of-cpu-usage-given-in-percentage-in-linux
    this.cpuUsageTick;
    this.cpuTickTime = 10000;
    self.cpuPrecentage = {};
    // this.prevInfo = {};
    // this.info = {};
    // this.getUsage(function (obj) {
    //     self.prevInfo[obj.name] = self.info[obj.name];
    //     self.info[obj.name] = obj;
    // })


}
sysCPUUsage.prototype.getUsage = function (cb) {
    fs.readFile("/proc/stat", function(err, data){
        var list = data.toString().split('\n');
        var cpuUsage = [];
        for (var i = 0; i < list.length; i++) {
            var elems = list[i].toString().split(' ');

            if (elems[0].indexOf("cpu") == -1) break;

            var obj = {}; //cpu(0) user(1) nice(2) system(3) idle(4) iowait(5) irq(6)   softirq(7)  steal  guest  guest_nice
            obj.name = elems[0];
            if (elems[0] == "cpu" && elems[1] == "") {
                elems.shift();
            }
            obj.idle = parseInt(elems[4]) + parseInt(elems[5]);
            var nonIdle = parseInt(elems[1]) + parseInt(elems[2]) + parseInt(elems[3]) + parseInt(elems[6]) + parseInt(elems[7]) + parseInt(elems[8]);
            obj.total = obj.idle + nonIdle;
            cpuUsage.push(obj);
        }

        cb(cpuUsage)
    });
};
sysCPUUsage.prototype.startRun = function () {
    var self = this;
    this.getUsage(function (preCPUs) {
        setTimeout(function(){
            self.getUsage(function(currCPUs){

                for (var i = 0; i < currCPUs.length; i++) {
                    var cObj = currCPUs[i];
                    var pObj = preCPUs[i];
                    var totald = cObj["total"] - pObj["total"];
                    var idled  = cObj["idle"] - pObj["idle"];
                    var percentage = (100 * ((totald - idled)/totald)).toFixed(2);
                    if (Number.isNaN(percentage))
                        self.cpuPrecentage[cObj.name] = 0;
                    else
                        self.cpuPrecentage[cObj.name] = percentage;
                }
                self.emit('sysCPU', self.cpuPrecentage);
            });
        }, 1000);
        self.start(); // Next
    });
};
sysCPUUsage.prototype.start = function () {
    this.cpuUsageTick = setTimeout(this.startRun.bind(this), this.cpuTickTime);
};
sysCPUUsage.prototype.stop = function () {
    clearTimeout(this.cpuUsageTick);
    this.cpuUsageTick = undefined;
};


module.exports.ProcessStats = ProcessStats;
module.exports.sysCPUUsage = sysCPUUsage;
/*
console.log(process.pid);
var proc = new ProcessStats();
proc.listenCPU(12308, function (percentage) {
    console.log(' time:%s percentage:%s ', percentage[0], percentage[1]);
});
*/
/*
var proc = new sysCPUUsage();
proc.start();
proc.on('sysCPU', function (cpus_usage) {
    console.log(cpus_usage);
});
*/
