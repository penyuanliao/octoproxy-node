/**
 * Created by Benson.Liao on 2016/8/12.
 */
var net     = require('net');
const fs    = require('fs');
const path  = "../configuration/LoadBalance.json";
const maxCountPath  = "../configuration/LoadBalanceLimited.json";
const tryMsgType = false;
console.log('::::::: UnitTest Game LB Server :::::::');
var serviceList = {};
// serviceList['/slotFX'] = ['5904','5905','5901','5906'];
// serviceList['/slotFX2'] = ['5904','5054'];

function application() {
    this.setGamePath();
    this.loadMaxcount();
    this.getList();
    console.log('application');
}

application.prototype.setGamePath = function () {
    var data = fs.readFileSync(path);
    var conf = eval("("+data+")");
    serviceList = conf;
};
application.prototype.loadMaxcount = function () {
    var data = fs.readFileSync(maxCountPath);
    var conf = eval("("+data+")");
    this.balanceRole2 = conf;

    var games = Object.keys(conf);
    var threads;
    for (var g = 0; g < games.length; g++) {
        threads = conf[games[g]].threads;

        if (typeof threads != "undefined") {
            var keys = Object.keys(threads);
            var items;
            this.balanceRole2[games[g]].hallGroup = {};
            for (var i = 0; i < keys.length; i++) {
                items = threads[keys[i]];
                if (Array.isArray(items)) {
                    for (var j = 0; j < items.length; j++) {
                        this.balanceRole2[games[g]].hallGroup[items[j]] = keys[i];
                    }
                } else {
                    this.balanceRole2[games[g]].hallGroup[items] = keys[i];
                }


            }
        }
    }



    console.log("---------",JSON.stringify(this.balanceRole2));
};
application.prototype.getList = function () {
    this.gameList = {};
    var value;
    var gameType;
    var keys = Object.keys(serviceList);
    for (var i = 0 ; i < keys.length; i++) {
        var key = keys[i];
        value = serviceList[key];
        if (typeof value == "string") {
            if (typeof this.gameList[value] == "undefined") this.gameList[value] = [];
            this.gameList[value].push(key);
        } else if (value.constructor == Array) {
            for (var j=0;j < value.length;j++) {

                gameType = value[j];
                if (typeof this.gameList[gameType] == "undefined") {
                    this.gameList[gameType] = [];
                }
                this.gameList[gameType].push(key);
            }
        }

    }
}

application.prototype.getGamePath = function (gameType, h, r) {

    if (app.gameList[gameType] != null && (typeof arguments[2] == "undefined" || arguments[2] == 1 || arguments[2] > 2)) {
        console.log('++++++ Rule.1');
        return "/Hall"
    } else if (arguments[2] == 2) {
        console.log('++++++ Rule.2');
        var h = arguments[1];
        if (typeof app.serverCount != "undefined" && typeof app.serverKeys != "undefined") {
            var key, count;
            var keyIdx;
            var sub = 1;
            var index = "";
            var maximum = app.balanceRole2[gameType].maxconn;
            var mode = app.balanceRole2[gameType].mode;
            if (typeof maximum == "undefined") maximum = 2000;
            if (typeof h != "undefined") {
                index = "" + h;
            }
            //server control HallID
            console.log('maximum:', maximum, index);

            var hallGroup = app.balanceRole2[gameType].hallGroup;
            if (typeof hallGroup != "undefined") {
                var hgKeys = Object.keys(hallGroup);
                if ( typeof h != "undefined" && hgKeys.length > 0) {
                    if (typeof hallGroup[h] != "undefined") {
                        index = hallGroup[h];
                    } else if (typeof hallGroup["0"] != "undefined") {
                        index = "";
                    } else {
                        return "119";
                    }
                }
            }


            keyIdx = app.serverKeys.indexOf(mode + index);
            console.log('name:%s, mode:%s, keyIdx:%s', mode + index, mode, keyIdx,h);
            while (true)
            {
                if (keyIdx != -1) {
                    key = app.serverKeys[keyIdx];
                    count = app.serverCount[keyIdx];
                    if (count > maximum) {
                        keyIdx = app.serverKeys.indexOf(mode + index + "_" + sub);
                        sub++;
                    } else {
                        app.serverCount[keyIdx]++;
                        return "/" + key;
                    }
                } else {
                    return "119";
                }
            }

        } else {
            return "119";
        }

    }
}
application.prototype.setLBRole2 = function (o, index) {
    console.log("setLBRole2:::",arguments);
    this.balanceRole2[index] = o;
    fs.writeFileSync(maxCountPath, JSON.stringify(this.balanceRole2, null, "\t"));

    this.loadMaxcount();
    process.send({"action":"onSetLBRole2", "result":1, "index":index});
};
var app = new application();




process.on('message', function (msg) {
    console.log('message', msg);
    if (tryMsgType) {
        console.log('Process receive Message type of', typeof msg , JSON.stringify(msg));
    }
    process.parent = app;

    if (msg.action == 'getPath') {
        //todo run something
        var spath = app.getGamePath(msg.gameType, msg.h, msg.r);
        var o = {};
        if (spath == '119') {
            o.action = 'onBusy';
            o.mtime = '300';
        } else {
            o.action = "onGetPath"; // or onBusy
            o.path = spath;

        }
        o.tokencode = msg.tokencode;
        process.send(o);

        console.log('onGetPath:',"GLBS:getPath Event, ", o);

    }
    if(msg.evt == "processInfo") {
        process.send({"evt":"processInfo", "data" : {"memoryUsage":process.memoryUsage(),"connections": 0}});
    }
    else if (msg.action == "setGamePath") {
        setOneGamePath(msg["data"],msg["index"]);
    }
    else if (msg.action == "getGamePath") {
        process.send({"action":"onGetGamePath", "data":serviceList});
    }
    else if (msg.action == "getGamePath") {
        process.send({"action":"onGetGamePath", "data":serviceList});
    }
    else if (msg.action == "upServerCount") {
        app.serverCount = msg.list;
        if (typeof msg.keys != "undefined") {
            app.serverKeys = msg.keys;
        }
    }else if (msg.action == "setLBRole2") {
        process.parent.setLBRole2(msg.data["data"], msg.data["index"]);
    }else if (msg.action == "getLBRole2") {
        process.send({"action":"onGetLBRole2", "data":process.parent.balanceRole2});
    }
});

function setOneGamePath(o, index) {



    if (typeof o != "object" || typeof o == "undefined") {

        process.send({"action":"onSetGamePath", "result":0});
        return;
    }
    console.log(o.constructor,path,JSON.stringify(o));
    if (o.constructor == Array) {
        serviceList = o[0];
        fs.writeFileSync(path, JSON.stringify(serviceList, null, "\t"));
    }else if (typeof o == "object") {


        serviceList = o;
        fs.writeFileSync(path, JSON.stringify(serviceList, null, "\t"));
    } else {
        serviceList[o.name] = o.rule;
    }

    process.send({"action":"onSetGamePath", "result":1, "index":index});


};




function makeSureComplete() {
    if (process.send instanceof Function) {
        process.send({"action":"creationComplete"});
    }
}
makeSureComplete();