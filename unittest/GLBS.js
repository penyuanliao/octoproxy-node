/**
 * Created by Benson.Liao on 2016/8/12.
 */
var net     = require('net');
const fs    = require('fs');
const path  = "../configuration/LoadBalance.json";
const tryMsgType = false;
console.log('::::::: UnitTest Game LB Server :::::::');
var serviceList = {};
// serviceList['/slotFX'] = ['5904','5905','5901','5906'];
// serviceList['/slotFX2'] = ['5904','5054'];

function application() {
    this.setGamePath();
}

application.prototype.setGamePath = function () {
    var data = fs.readFileSync(path);
    var conf = eval("("+data+")");
    serviceList = conf;
};
new application();
getList();

process.on('message', function (msg) {

    if (tryMsgType) {
        console.log('Process receive Message type of', typeof msg , JSON.stringify(msg));
    }


    if (msg.action == 'getPath') {
        //todo run something
        var o = {};
        o.action = "onGetPath"; // or onBusy
        o.tokencode = msg.tokencode;
        o.path = "/Hall/service.h1";
        process.send(o);

        console.log('message',"GLBS:getPath Event");

    }
    if(msg.evt == "processInfo") {
        process.send({"evt":"processInfo", "data" : {"memoryUsage":process.memoryUsage(),"connections": 0}});
    }
    else if (msg.action == "setGamePath") {
        setOneGamePath(msg["data"],msg["index"]);
    }else if (msg.action == "getGamePath") {
        process.send({"action":"onGetGamePath", "data":serviceList});
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

function getList() {
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
                if (typeof gameList[gameType] == "undefined") {
                    this.gameList[gameType] = [];
                }
                this.gameList[gameType].push(key);
            }
        }

    }
}