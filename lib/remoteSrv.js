/**
 * Created by Benson.Liao on 2016/9/12.
 */

const net        = require('net');
const events    = require('events');
const util      = require('util');
const fxNet     = require('fxNetSocket').NetCoonection;
const NSLog     = require('fxNetSocket').logger.getInstance();
const sys       = require('./sysstat.js');
const exec       = require('child_process').exec;
const fs        = require('fs');
const AssPath   = "../../configuration/Assign.json";
NSLog.configure({
    logFileEnabled:true,
    consoleEnabled:true,
    level:'trace',
    dateFormat:'[yyyy-MM-dd hh:mm:ss]',
    filePath:__dirname+"/../historyLog",
    id:"admin",
    remoteEnabled: false,
    /*console:console,*/
    trackBehaviorEnabled: false, // toDB server [not implement]
    maximumFileSize: 1024 * 1024 * 100});

const WPC_Logging_Port  = 10080;
const WPC_HTTP_Port     = 10082;
const Admin_Ctrl_Port   = 8100;

var SERVER_INFO_TICK =  5 * 1000;

var createRemoteSrv = function () {
    var s = new remoteContrl();
    s.insideLogPipe();
    var wssrv = s.outside();
    s.connectAdminCtrl(Admin_Ctrl_Port);
    s.setupSysstat();
    // s.runPID([process.pid]);
    s.getDiskUse();
    var proxy = s.setupHTTPServer();
    s.BindingProcEvent(proxy,wssrv);
    s.unittest();

};

util.inherits(remoteContrl, events.EventEmitter); // 繼承事件
function remoteContrl() {
    events.EventEmitter.call(this);
    events.EventEmitter.prototype._maxListeners = 0
    this.insideSrv  = undefined;
    this.outsideSrv = undefined;

    this.LoggerSockets = [];
    this.clients = [];
    this._connections = 0;

    this.cpusStat = [];
    this.clusterInfos = undefined; // SERVER INFO
    this.assignConfig = undefined;

    this.manage = undefined; // SERVER CONTROL

    this.historyConns = [];

    this.sysInfo = {memory:0, hdd:0};

    this.cpusUsagePid = [];


}
remoteContrl.prototype.unittest = function () {
    setTimeout(function () {

    }, 5000);
};

/** 外部管理者連線 **/
remoteContrl.prototype.outside = function () {
    var self = this;
    var srv = new fxNet(WPC_HTTP_Port, { runListen:true, glListener:false });
    this.outsideSrv = srv;
    srv.on('connection', function (client) {
        client.cpuListen = []; //監聽
        self._connections++;

        /*
         var namespace = client.namespace.substr(1, client.namespace.length);
         console.log("liveLog ",namespace);
         self.setClients(client, namespace);
         */
        client.manage = new OctoManage();
        client.manage.run(Admin_Ctrl_Port);
        client.manage.on("data", function (chunk) {

            var arr = chunk.toString().match(/(\{.+?\})(?={|$)/g);
            for (var i = 0 ; i < arr.length; i++) {
                try {
                    var data = arr[i];
                    client.write(data);
                    var json = JSON.parse(data);
                    if (json["action"] == "clusterLockEnabled") {
                        self.manage.getClusterInfos();
                    }
                    else if (json["event"] == "getClusterInfos") {
                        self.clusterInfos = json["data"];
                        client.write(JSON.stringify({"event":"getClusterInfos", "data": self.clusterInfos}));
                    }else {
                        self.manage.getClusterInfos();
                    }
                }
                catch (e) {
                    console.error(e);
                }
            }
        });

        client.heartbeatEnabled = false;

        client.refresh_func = function () {
            client.write(JSON.stringify({"event":"getClusterInfos", "data": self.clusterInfos}));
            client.refresh_time = setTimeout(client.refresh_func,SERVER_INFO_TICK);
        };
        if (client.wsProtocol != 'log')
            client.refresh_time = setTimeout(client.refresh_func,SERVER_INFO_TICK);


        client.on('message', onMessage);
        client.on('disconnect', function () {
            var namespace = client.namespace.substr(1, client.namespace.length);
            var group = self.getClients(namespace);
            if (typeof group != "undefined") {
                group[client.name] = undefined;
                delete group[client.name];
            }

            clearTimeout(client.refresh_time);
            client.refresh_func = {};

            client.manage.close();

            self._connections--;
        });

    });

    srv.on('httpUpgrade', function (req, client, head) {
        console.log(head);
    });

    function onMessage(data) {
        if (data.substr(0,1) != '{' && data.substr(data.length-1,1) != "}") {

            // client.write(JSON.stringify({"error":"Error: Invalid argument."}));
            // return;
        }else {
            var args = data.split(" ");

        }

        var json = JSON.parse(data);

        self.action(this, json);
    }

    return srv;
};

remoteContrl.prototype.action = function (client, action) {
    var self = this;
    console.log('action:', action["event"]);
    switch (action["event"])
    {
        case "getAssignConf2": {
            client.write(JSON.stringify({"event":"getAssignConf", "data": this.assignConfig}));
            break;
        }
        case "getClusterInfos": {
            client.manage.getClusterInfos();
            break;
        }
        case "getAssign": {

            client.manage.getAssign();

            break;
        }
        case "getCPUUsage": {
            var pid = action["data"][0].toString();
            // console.log('CPU Listen usage:', pid);
            if (typeof client.cpuListen[pid] != "undefined") return;
            client.cpuListen[pid] = function (info) {
                client.write(JSON.stringify({"event":"getCPUUsage", "data": {"pid":pid, cpu:info}}));
            };
            self.on(pid, client.cpuListen[pid]);
            self.getPID();
            break;
        }
        case "rmCPUUsage": {
            var pid = action["data"][0].toString();
            var func = client.cpuListen[pid];
            if (typeof func != "undefined") {
                self.removeListener(pid, func);
                client.cpuListen[pid] = undefined;
                delete client.cpuListen[pid];
            }

            break;
        }
        case "getSysInfo": {
            this.getDiskUse();
            client.write(JSON.stringify({"event":"getSysInfo", "data": this.sysInfo}));
            break;
        }
        case "assignInfo": {
            break;
        }
        case "addCluster": {
            if (action["data"][0].substr(action["data"][0].length-3, action["data"][0].length) == '.js') {
                client.manage.addCluster(action["data"][0],action["data"][1],action["data"][2]);
            }else
            {

            }

            break;
        }
        case "editCluster": {
            client.manage.editCluster(action["data"][0],action["data"][1], action["data"][2]);
            break;
        }
        case "killCluster": {
            client.manage.killCluster(action["data"][0]);
            break;
        }
        case "killClusterToPID": {
            client.manage.killClusterToPID(action["data"][0]);
            break;
        }
        case "restartCluster": {
            client.manage.restartCluster(action["data"][0]);
            break;
        }
        case "refuseUser": {
            client.manage.refuseUser(action["data"][0],action["data"][1]);
            break;
        }
        case "addAssign": {
            client.manage.updateAssign(action["data"][0],action["data"][1], action["data"][2]);
            break;
        }
        case "editAssign": {
            client.manage.editAssign(action["data"][0],action["data"][1], action["data"][2], action["data"][3]);
            break;
        }
        case "deleteAssign": {
            client.manage.deleteAssign(action["data"][0]);
            break;
        }
        case "liveLog": {
            var namespace = action["data"][0].toLowerCase();

            self.setClients(client, namespace);
            break;
        }
        case "getLoggerList": {
            self.getLoggerList(client);
            break;
        }
        case "setLockConnection": {

            if (typeof action["data"][0] == "boolean") {
                client.manage.setLockConnection(action["data"][0]);
                var path = AssPath;
                var data = fs.readFileSync(path);
                var conf = eval("("+data+")");
                conf["lockState"] = action["data"][0];
                fs.writeFileSync(path, JSON.stringify(conf));
                self.clusterInfos[0]['lock'] = action["data"][0];
            }

            break;
        }
        case "octoRestart": {
            client.manage.octoproxyRestart();
            break;
        }
        /** -- admin setter -- **/
        case "setUpdateTimes": {
            SERVER_INFO_TICK = action["data"][0];
            break;
        }
    }

};

/** 內部Logger連線通道 **/
remoteContrl.prototype.insideLogPipe = function () {
    var self = this;
    var srv = this.insideSrv = net.createServer(function (socket) {
        // console.log('connected');
        socket.once('data', function (chunk) {
            var name = chunk.toString().toLowerCase();
            socket.name = name;
            self.LoggerSockets[name] = socket;
            socket.on("data", onDataHandler);
            // console.log('Connect Logger Name:', name);
        });

        function onDataHandler(chunk) {

            var group = self.getClients(socket.name);
            if (typeof group == "undefined") {
                return;
            }

            var g_key = Object.keys(group);
            var g;
            for (g = 0; g < g_key.length; g++) {
                var client = group[g_key[g]];
                client.write(JSON.stringify({'event': 'liveLog', 'name': socket.name, 'log': chunk.toString()}));

            }

        }


        socket.on("close", function () {
            self.LoggerSockets[socket.name] = undefined;
            delete self.LoggerSockets[socket.name];
        })
    });
    srv.listen(WPC_Logging_Port);
};

remoteContrl.prototype.setClients = function (client, namespace) {

    if (typeof this.clients[namespace] == "undefined") {
        this.clients[namespace] = {};
    }

    this.clients[namespace][client.name] = client;

};
remoteContrl.prototype.getLoggerList = function (client) {

    var list = Object.keys(this.LoggerSockets);
    console.log('list ',list);

    client.write(JSON.stringify({"event":"getLoggerList", "data":list}));
};

remoteContrl.prototype.removeClient = function (name, namespace) {

    if (typeof this.clients[namespace] == "undefined") {
        return;
    }
    delete this.clients[namespace][name];
};

remoteContrl.prototype.getClients = function (namespace) {

    var group = this.clients[namespace];

    return group;
};

/** OctoProxy-node command-line interface **/
remoteContrl.prototype.connectAdminCtrl = function (port) {
    var self   = this;
    var manage = new OctoManage();
    manage.run(port);

    function latest_sys_update() {
        // manage.socket.destroy();
        manage.getClusterInfos();
        // manage.getAssign();
        setTimeout(latest_sys_update,SERVER_INFO_TICK);
    }
    setTimeout(latest_sys_update,SERVER_INFO_TICK);

    manage.on("data", function (chunk) {
        // console.log("manage data:",chunk.toString());

        var arr = chunk.toString().match(/(\{.+?\})(?={|$)/g);
        for (var i = 0 ; i < arr.length; i++) {
            try {
                var json = JSON.parse(arr[i]);
                if (json["event"] == "getClusterInfos") {
                    self.clusterInfos = json["data"];
                    // self.setHistoryUse();
                }else if (json["event"] == "getAssign") {
                    self.assignConfig = json["data"];
                }
            }
            catch (e) {
                console.error(e, chunk.toString());
            }
        }

    });

    this.manage = manage;
};
remoteContrl.prototype.setHistoryUse = function () {

    var list  = this.clusterInfos;
    var time  = new Date();
    var year  = time.getFullYear();
    var month = (time.getMonth() + 1);
    var day   = time.getDate();
    var hours = time.getHours();

    for (var i = 0; i < list.length; i++) {
        var obj = list[i];
        var count = obj["count"];
        var memoryUsage = obj["memoryUsage"];
        if (typeof this.historyConns[obj["name"]] == "undefined") {
            this.historyConns[obj["name"]] = [];
        }
        var key = year + '/' + month + '/' + day + ':' + hours;

        if (typeof this.historyConns[obj["name"]][key] == "undefined") {
            this.historyConns[obj["name"]][key] = {count:0,memory:0}
        }

        this.historyConns[obj["name"]][key]["count"] = Math.max(this.historyConns[obj["name"]][key]["count"], count);
        this.historyConns[obj["name"]][key]["memory"] = Math.max(this.historyConns[obj["name"]][key]["memory"], memoryUsage);

    }
    // console.log(this.historyConns);
};

util.inherits(OctoManage, events.EventEmitter); // 繼承事件

function OctoManage() {
    events.EventEmitter.call(this);
    this.socket = undefined;
}
OctoManage.prototype.run = function (port) {
    this._init();
    this._connect(port);
};
OctoManage.prototype._init = function () {
    var self = this;
    var sock = this.socket = new net.Socket();
    sock.on('data', function (chunk) {
        // console.log('OctoManage func receive:',chunk.toString());
        self.emit("data", chunk);
    });
    sock.on('error', function (e) {
        // self.emit("error", e);
        try {sock.destroy();}
        catch (e) {}
    });
    sock.on('close', function () {
        NSLog.log("info","Retry OctoManage Connect.");
        setTimeout(function () {
            sock.connect(sock.port, '127.0.0.1');
        }, 5000);
    });

};
OctoManage.prototype.close = function () {
    this.socket.removeAllListeners();
    this.socket.destroy();
};
OctoManage.prototype._connect = function (port) {
    var sock = this.socket;
    sock.port = port;

    sock.on('connect',function () {
        NSLog.log('info', 'connected to the ocotoproxy admin control cli.');
        sock.write("\0"); // ** Need Send One data. ** //
    });

    sock.connect(port, '127.0.0.1');
};
/** 列出子程序 **/
OctoManage.prototype.getAssign = function () {
    var sock = this.socket;
    sock.write(JSON.stringify({"event":"getAssign"}));
};
/** 顯示子程序資訊 **/
OctoManage.prototype.getClusterInfos = function () {
    var sock = this.socket;
    if (sock.writable)
    sock.write(JSON.stringify({"event":"getClusterInfos"}));
};
/** 動態重啟指定程序名稱 - 伺服器重啟就無效 **/
OctoManage.prototype.restartCluster = function (assign) {
    var sock = this.socket;
    sock.write(JSON.stringify({"event":"restartCluster","data":[assign]}));
};
/** 動態新增指定程序 - 伺服器重啟就無效 **/
OctoManage.prototype.addCluster = function (filePath, assign, mxoss) {
    var sock = this.socket;
    console.log(arguments);

    sock.write(JSON.stringify({"event":"addCluster","data":[filePath, assign, mxoss]}));
};
/** 編輯指定名單規則 **/
OctoManage.prototype.editCluster = function (oAssign, nAssign, mxoss) {
    var sock = this.socket;
    console.log(arguments);
    sock.write(JSON.stringify({"event":"editCluster","data":[oAssign, nAssign, mxoss]}));
};
/** 動態刪除指定程序 - 伺服器重啟還會有 **/
OctoManage.prototype.killCluster = function (pid) {
    var sock = this.socket;
    sock.write(JSON.stringify({"event":"killCluster","data":[pid]}));
};
OctoManage.prototype.killClusterToPID = function (pid) {
    var sock = this.socket;
    sock.write(JSON.stringify({"event":"killClusterToPID","data":[pid]}));
};
/** 拒絕使用者 **/
OctoManage.prototype.refuseUser = function (assign, bool) {
    var sock = this.socket;
    console.log(arguments);
    sock.write(JSON.stringify({"event":"clusterLockEnabled","data":[assign,bool]}));
};
/** 新增啟動名單規則 **/
OctoManage.prototype.updateAssign = function (file, assign, mxoss) {
    var sock = this.socket;
    sock.write(JSON.stringify({"event":"updateAssign","data":[ {"file":file, "assign":assign, "mxoss":mxoss}]}));
};
/** 編輯啟動名單規則 **/
OctoManage.prototype.editAssign = function (oAssign, file, nAssign, mxoss) {
    var sock = this.socket;
    sock.write(JSON.stringify({"event":"editAssign","data":[oAssign, {"file":file, "assign":nAssign, "mxoss":mxoss}]}));
};
/** 刪除指定名稱啟動名單 **/
OctoManage.prototype.deleteAssign = function (assign) {
    var sock = this.socket;
    sock.write(JSON.stringify({"event":"deleteAssign","data":[assign]}));
};
/** income connect reject or allow **/
OctoManage.prototype.setLockConnection = function (bool) {
    console.log('set mutexServiceLock');
    var sock = this.socket;
    if (sock.writable)
    sock.write(JSON.stringify({"event":"mutexServiceLock","data":[bool]}));
};
OctoManage.prototype.octoproxyRestart = function () {
    NSLog.log('debug','octoproxy restart');

    exec("netstat -an | grep LISTEN | grep ':80 ' | wc -l", function (error, stdout, stderr) {
        if (error) {
            console.error(error);
            return;
        }
        var state = parseInt(stdout.replace(/\s/g, ""));
        if (state == 0) {
            NSLog.log('debug', 'run ../startup.sh');
            exec("pushd /www/octoproxy-node; node --max-old-space-size=8192 --nouse-idle-notification --always-compact --expose-gc octoproxy.js -p 80 > '/dev/null' 2>&1 &",function (error, stdout, stderr) {
                if (error) {
                    console.error(error);
                    return;
                    console.log(stdout);
                    console.log(stderr);
                }
            });

        }
        console.log(stderr);
    });

};
/* ----------------------------------
 *        Process Status
 * ---------------------------------- */
remoteContrl.prototype.setupSysstat = function () {
    this.sysstat = new sys.sysstat();
    this.cpusUsage = [];
};
remoteContrl.prototype.getPID = function () {
    var clusters = this.clusterInfos;
    var arr_pid = [];
    for (var i = 0; i < clusters.length; i++) {
        var cluster = clusters[i];

        if (typeof this.cpusUsagePid[cluster["pid"]] != 'undefined') {
            this.cpusUsagePid[cluster["pid"]] = cluster["pid"];
            arr_pid.push(parseInt(cluster["pid"]));
        }

    }


    this.runPID(arr_pid);
};
remoteContrl.prototype.runPID = function (arr) {
    var self = this;

    for (var i = 0; i < arr.length; i++) {
        var pid = arr[i];
        this.sysstat.pidCPU(pid);
        this.sysstat.on(pid, function (info) {
            // self.cpusUsage[process.pid.toString()] = info;
            self.emit(pid.toString(), info);
        });
        
    }
    
};
remoteContrl.prototype.getDiskUse = function () {
    var self = this;
    this.sysstat.fd(function (data) {
        if (typeof data == 'number') {
            self.sysInfo["hdd"] = data;
        }else {
            console.error('getDiskUse:', data);
        }
    });
};
remoteContrl.prototype.BindingProcEvent = function (proxy,wssrv) {
    /** process state **/
    process.on('uncaughtException', function (err) {
        console.error(err.stack);
        NSLog.log('error', 'uncaughtException:', err.stack);
    });
    process.on("exit", function () {
        NSLog.log('info',"Main Thread exit.");
        process.exit(0);
    });
    process.on("SIGQUIT", function () {
        NSLog.log('info',"user quit node process");
        process.exit(-1);
    });
    process.on('message', function (data, handle) {
        var json = data;
        if (typeof json === 'string') {

        }else if(typeof json === 'object'){

            if(data.evt == "processInfo") {
                process.send({"evt":"processInfo", "data" : {"memoryUsage":process.memoryUsage(),"connections": 0}})
            }else if (data.evt == "c_init") {

                NSLog.log('debug', "Conversion Socket.Hanlde from Child Process.");
                var socket = new net.Socket({
                    handle:handle,
                    allowHalfOpen:proxy.allowHalfOpen
                });
                socket.readable = socket.writable = true;
                socket.server = proxy;
                proxy.emit("connection", socket);
                socket.emit("connect");
                socket.emit('data',new Buffer(data.data));
                socket.resume();
            }else if (data.evt == "c_init2") {

                NSLog.log('debug', "Conversion Socket.Hanlde from Child Process.");
                var socket = new net.Socket({
                    handle:handle,
                    allowHalfOpen:wssrv.app.allowHalfOpen
                });
                socket.readable = socket.writable = true;
                socket.server = wssrv.app;
                wssrv.app.emit("connection", socket);
                socket.emit("connect");
                socket.emit('data',new Buffer(data.data));
                socket.resume();
            }else{
                NSLog.log('debug', 'out of hand. dismiss message');
            }

        }
    });
};
var server = require('http');
var url = require("url");
var path = require('path');

remoteContrl.prototype.setupHTTPServer = function () {

    var handleRequest = function(request, response){
        var pathname = url.parse(request.url).pathname;

        var filePath = '../admin-node/views' + request.url;
        var extname = path.extname(filePath);
        console.log(extname,filePath);
        var contentType = 'text/html';
        switch (extname) {
            case '.js':
                contentType = 'text/javascript';
                break;
            case '.css':
                contentType = 'text/css';
                break;
            case '.json':
                contentType = 'application/json';
                break;
            case '.png':
                contentType = 'image/png';
                break;
            case '.jpg':
                contentType = 'image/jpg';
                break;
            case '.wav':
                contentType = 'audio/wav';
                break;
        }

        fs.readFile(filePath, function(error, content) {
            console.log(error);
            if (error) {
                if(error.code == 'ENOENT'){
                    fs.readFile('./404.html', function(error, content) {
                        response.writeHead(200, { 'Content-Type': contentType });
                        response.end(content, 'utf-8');
                    });
                }
                else {
                    response.writeHead(500);
                    response.end('Sorry, check with the site admin for error: '+error.code+' ..\n');
                    response.end();
                }
            }
            else {
                response.writeHead(200, { 'Content-Type': contentType });
                response.end(content, 'utf-8');
            }
        });

    };

    var proxy = server.createServer(handleRequest);

    proxy.on('connect', function (req, socket, head) {

    });
    this.proxy = proxy;
    return proxy;
    // proxy.listen(8000);
};


module.exports = exports = createRemoteSrv;


createRemoteSrv();