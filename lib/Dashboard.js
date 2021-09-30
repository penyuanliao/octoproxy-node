const fs            = require("fs");
const util          = require("util");
const EventEmitter  = require("events");
const fxNetSocket   = require('fxNetSocket');
const NSLog         = fxNetSocket.logger.getInstance();
util.inherits(Dashboard, EventEmitter);

const MAX_IP_COUNT = 100000;
const MAX_IP_COUNT_HALF = MAX_IP_COUNT/2;

function Dashboard(data) {
    EventEmitter.call(this);
    this.enabled = true;
    this.octolog = {};
    this.octolog.income = {};

    this.octolog.incomeCount = {};

    this.minCount = 500;

    if (typeof data != "undefined") this.setup(data);
    var self = this;
    setInterval(function () {
        NSLog.log("trace", "Save Dashboard.json");
        Dashboard.writeFile("./historyLog/Dashboard.json", self.octolog);
    }, 60 * 1000 );

}
Dashboard.prototype.setup = function (data) {
    var now = new Date();
    this.octolog = data;

    this.octolog.visitors = {
        success:0,
        failure:0
    };
    this.octolog.income = {};
    this.octolog.incomeAmount = Object.keys(this.octolog.income).length;
    this.octolog.incomeCount[now.getDay()] = {};

    var day = new Date();

    Object.defineProperties(this, {
        count:{
            value: 0,
            configurable: false, enumerable: false, writable:true
        },
        hour:{
            value: day.getHours(),
            configurable: false, enumerable: false, writable:true
        },
        week:{
            value: day.getDay(),
            configurable: false, enumerable: false, writable:true
        }

    })

};
Dashboard.prototype.recordAddress = function (host) {

    if (this.octolog.incomeAmount > MAX_IP_COUNT) {
        NSLog.log("warning", "IPAddress income init with maximum count exceeded.");
        var t = new Date().getTime();
        this.IPAddressSort();
        NSLog.log("warning", "Running sort income: %s ms", new Date().getTime() - t);
    }
    if (Array.isArray(this.octolog.income[host])) {
        this.octolog.income[host][0] += 1;
        this.octolog.income[host][1] = new Date().toJSON();
    } else {
        this.octolog.incomeAmount++;
        this.octolog.income[host] = [1, new Date().toJSON()];
    }

};
Dashboard.prototype.recordStatus = function (success) {
    if (success) {
        this.octolog.visitors.success++;
        this.count++;
    }
    else this.octolog.visitors.failure++;
    var now  = new Date();
    var hour = Number(now.getHours());
    var week = now.getDay();

    if (typeof this.octolog.incomeCount[week] == "undefined") this.octolog.incomeCount[week] = {};

    this.octolog.incomeCount[week][hour] = this.count;
    if (this.hour != hour) this.count = 0;
    // console.log('recordStatus',week, hour , this.count);
    // Dashboard.writeFile("./lib/Dashboard.json", this.octolog);
};
Dashboard.prototype.record = function (info) {
    if (this.enabled == false) return;
    if (typeof info.address != "undefined") {
        this.recordAddress(info.address);
    }
    if (info.exception) {
        this.recordStatus(info.exception.code == 0x200);
    }
};
Dashboard.prototype.IPAddressSort = function () {
    var income = this.octolog.income;
    // var keys = Object.keys(income);
    var keysSorted = Object.keys(income);
    // var keysSorted = keys.sort(function (a, b) {
    //     return income[b] - income[a];
    // });
    var sorted = {};
    var lastCount = keysSorted.length;
    for (var i = 0; i < keysSorted.length; i++) {
        if (income[keysSorted[i]][0] > this.minCount) {
            // sorted[keysSorted[i]] = income[keysSorted[i]];
        } else {
            this.octolog.incomeAmount--;
            delete income[keysSorted[i]];
            lastCount--;
        }
    }
    if (lastCount > MAX_IP_COUNT_HALF) {
        this.minCount += 100;
    }
    // this.octolog.income = sorted;
};
Dashboard.loadFile = function (path) {
    var data;
    try {
        data = fs.readFileSync(path);
        return eval("("+data+")");
    } catch (e) {
        NSLog.log("error", "Loading conf path '%s' not found.", path);
        data = {
            "visitors": {"success": 0, "failure": 0},
            "incomeCount": {},
            "income": {},
            "connections": [],
            "incomeAmount": 0
        };
        Dashboard.writeFile(path, data);
        return data;
    }
};
Dashboard.writeFile = function (path, data) {
    return fs.writeFile(path, JSON.stringify(data, null, "\t"), function (err, data) {
        if (err) NSLog.log("error", "writeFile:%s", err);
    });
};
module.exports = exports = Dashboard;

/*
var dash = new Dashboard(Dashboard.loadFile("./Dashboard.json"));
setInterval(function () {
    var key = "127." + Math.floor(Math.random() * 255) + "." + Math.floor(Math.random() * 255) + "." + Math.floor(Math.random() * 255);
    dash.record({
        address:key,
        exception:{code: 0x200}
    })
}, 1);
*/

