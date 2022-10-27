"use strict";
const fs            = require("fs");
const util          = require("util");
const events        = require("events");
const fxNetSocket   = require('fxNetSocket');
const NSLog         = fxNetSocket.logger.getInstance();
const MAX_IP_COUNT = 100000;
const MAX_IP_COUNT_HALF = MAX_IP_COUNT/2;
/**
 * 連線人次分析
 * @constructor
 */
class Dashboard extends events.EventEmitter {
    constructor(data) {
        super();
        this.weeks = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Tri', 'Sat'];
        this.enabled = true;
        this.count = 0;
        this.hour = 0;
        this.week = 0;
        this.octolog = {
            income: {},
            incomeCount: new Map()
        };
        this.pathname = "./historyLog/Dashboard.json";
        this.minCount = 500;
        if (typeof data != "undefined") this.setup(data);
        setInterval(() => this.save(), 60 * 1000 );
    }
    setup(data) {
        let date = new Date();
        this.octolog = data;
        this.octolog.visitors = {
            success: 0,
            failure: 0
        };
        this.octolog.income = {};
        this.octolog.incomeAmount = 0;
        if (Array.isArray(this.octolog.incomeCount)) {
            this.octolog.incomeCount = new Map(this.octolog.incomeCount)
        } else {
            this.octolog.incomeCount = new Map([])
            this.octolog.incomeCount.set(this.weeks[date.getDay()], new Array(24).fill(0))
        }

        this.count = 0;
        this.hour = date.getHours();
        this.week = this.week[date.getDay()];
    };
    recordAddress(host) {
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
    recordStatus(success) {
        let {visitors, incomeCount} = this.octolog;
        if (success) {
            visitors.success++;
            this.count++;
        }
        else visitors.failure++;
        let now  = new Date();
        let hour = Number(now.getHours());
        let week = this.weeks[now.getDay()];
        if (!incomeCount.has(week)) incomeCount.set(week, new Array(24).fill(0));
        incomeCount.get(week)[hour] = this.count;
        if (this.hour != hour) {
            this.count = 0;
            this.hour = hour;
        }
        if (this.week != week) {
            this.count = 0;
            this.hour = hour;
            this.week = week;
        }
    };
    record(info) {
        if (this.enabled == false) return;
        let xff = info.xff || "";
        let address = xff || info.address;
        if (address) this.recordAddress(address);
        if (info.exception) {
            this.recordStatus(info.exception.code == 0x200);
        }
    };
    IPAddressSort() {
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
    save() {
        // NSLog.log("info", `Save ${this.pathname}`);
        let {income, visitors, connections, incomeAmount} = this.octolog;
        let data = {
            income,
            visitors,
            incomeCount: [...this.octolog.incomeCount],
            connections,
            incomeAmount
        }
        Dashboard.writeFile(this.pathname, data);
    }
    static parseForwarded(forwarded) {
        let xff = forwarded || "";
        let address = xff.split(",")[0];
        return (address) ? address : null;
    }
    static loadFile(path) {
        var data;
        try {
            data = fs.readFileSync(path);
            return eval("("+data+")");
        } catch (e) {
            NSLog.log("error", "Loading conf path '%s' not found.", path);
            data = {
                "visitors": {"success": 0, "failure": 0},
                "incomeCount": new Map(),
                "income": {},
                "connections": [],
                "incomeAmount": 0
            };
            Dashboard.writeFile(path, data);
            return data;
        }
    };
    static writeFile(path, data) {
        return fs.writeFile(path, JSON.stringify(data, null, "\t"), function (err, data) {
            if (err) NSLog.log("error", "writeFile:%s", err);
        });
    };
    clean() {
        this.octolog.incomeCount.clear();
        this.octolog.visitors.success = 0;
        this.octolog.visitors.failure = 0;
    }
    release() {
    }
}
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

