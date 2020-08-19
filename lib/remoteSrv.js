/**
 * Created by Benson.Liao on 2016/9/12.
 */

process.env.NODE_DEV = "development";

const net       = require('net');
const Path      = require('path');
const events    = require('events');
const util      = require('util');
const fxNet     = require('fxNetSocket').NetCoonection;
const NSLog     = require('fxNetSocket').logger.getInstance();
const edittor   = require('./AssignEdittor.js');
const sys       = require('./sysstat.js');
const exec      = require('child_process').exec;
const spawn     = require('child_process').spawn;
const fs        = require('fs');
const os        = require('os');
const type      = os.type();
// const lcb        = require('fxNetSocket').cbConnect;
const NetSocket = require("./NetSocket.js").NetSocket;
const AssignPath = "../../configuration/Assign.json";
const IPFilterPath = "../../configuration/IPFilter.json";
const configurationPath = "../../configuration/";
NSLog.configure({
    logFileEnabled:true,
    consoleEnabled:true,
    level:'trace',
    dateFormat:'[yyyy-MM-dd hh:mm:ss]',
    filePath:Path.join(process.cwd(), "../historyLog"),
    id:"admin",
    remoteEnabled: false,
    /*console:console,*/
    trackBehaviorEnabled: false, // toDB server [not implement]
    maximumFileSize: 1024 * 1024 * 100});

const WPC_Logging_Port  = 10080;
const WPC_HTTP_Port     = 10082;
const Admin_Ctrl_Port   = 8100;
const Server_IP         = "127.0.0.1";
var SERVER_INFO_TICK    =  5 * 1000;
const LATTE_TABLE = [
    {
        "file":"MainLatte.js",
        "name":'_Latte1'
    },
    {
        "file":"MainLatte.js",
        "name":'candy'
    },
    {
        "file":"MainLatte.js",
        "name":'candy2'
    }
];
const MASTER = (process.argv.indexOf("--master") != -1);

var createRemoteSrv = function () {
    var self     = this;
    var counting = 0;
    var ctrl     = new RemoteControl();
    ctrl.insideLogPipe();
    ctrl.webServer = ctrl.outside();
    ctrl.BindingProcEvent(ctrl.webServer,ctrl.webServer);
    if (MASTER) {
        NSLog.log("info", "[Passive] Create listen <%s> for connections on a socket.", Admin_Ctrl_Port);
        ctrl.listens(Admin_Ctrl_Port);
        
        setInterval(function () {
            ctrl.getPodsDevInfo();
            if (global.gc instanceof Function) {
                global.gc();
            }
        }, 5000)
        
    }
    else {
        NSLog.log("info", "[Active] Create an endpoint for communication <%s:%s>.", Server_IP, Admin_Ctrl_Port);
        ctrl.connectAdminCtrl(Admin_Ctrl_Port); //控制
        ctrl.setupSysstat();
        // s.runPID([process.pid]);
        ctrl.getDiskUse();
        ctrl.getLoadAvg();
        ctrl.getNetInfo(1000);

        setInterval(function () {
            ctrl.getLoadAvg();
            counting++;
            if (counting >= 2) {
                counting = 0;
                ctrl.getNetInfo(10000);
            }
            if (global.gc instanceof Function) {
                global.gc();
            }
        }, 10000);

    }
};

util.inherits(RemoteControl, events.EventEmitter); // 繼承事件
function RemoteControl() {
    events.EventEmitter.call(this);
    events.EventEmitter.prototype._maxListeners = 0;
    this.insideSrv     = undefined;
    this.outsideSrv    = undefined;
    this.LoggerSockets = [];
    this.bindingSocks  = {};
    this.clients       = {}; // Webs CLIENT
    this.mClients      = {}; // PODs CLIENT
    this._connections  = 0;
    this.cpusStat      = [];
    this.clusterInfos  = undefined; // SERVER INFO
    this.assignConfig  = undefined;
    this.manage        = undefined; // SERVER CONTROL
    this.historyConns  = [];
    this.sysInfo       = {memory:0, hdd:0, cpuCount: os.cpus().length};
    this.cpusUsagePid  = [];
    // this.noSQL         = new lcb({"uri":["couchbase://127.0.0.1"],"bucket":"nodeHistory"});
    // this.noSQL.createServer();
    this.hostname      = require("os").hostname().replace(/\./g, "-");
    this.syslog        = this.setupInfluxDB({port:10084, host:"192.168.188.123"});
}
RemoteControl.prototype.setupInfluxDB = function (options) {
    var self = this;
    var syslog = new NetSocket(options);
    syslog.on("connect", function () {
        NSLog.log("info", "syslog is Connection.[syslog.Done] [ ON ]");
        syslog.send({action:"setup", cluID:self.hostname + "-" + process.pid});
    });
    syslog.connect();
    return syslog;
};
/** 外部管理者連線 **/
RemoteControl.prototype.outside = function onConnect() {
    var self = this;
    var srv = new fxNet(WPC_HTTP_Port, { runListen:true, glListener:false });
    srv.on('connection', function (client) {
        client.cpuListen = []; //監聽
        self._connections++;
        client.doApplyJoin = false;
        client.sendApplyJoin = false;
        client.tagDomain = self.hostname; //selected pod
        client.heartbeatEnabled = false;

        function initActiveManage() {
            client.manage = new OctoManage();
            client.manage.run(Admin_Ctrl_Port);
            client.manage.on("data", function (data) {
                self.onManageMessage(client, data);
            });
            client.manage.on("local", function (json) {
                client.write(json);
            });
        }
        function onActiveMessage(data) {
            NSLog.log("debug", "onActiveMessage", data);
            const json = JSON.parse(data);
            if (json.event == "joinPod" || json.event == "getPods") return;
            if (json.action == "signIn") {
                self.action(this, json);
            } else {
                self.action(this, json);
            }
        }
        function onPassiveMessage(data) {
            NSLog.log("debug", "onPassiveMessage", data);
            const json = JSON.parse(data);
            //確認進入Pod
            if (client.doApplyJoin == false) {
                if (json.event == "joinPod" || json.event == "getPods") {
                    self.action(this, json);
                }
                return;
            }
            if (json.event == "signIn") {
                self.action(this, json);
            } else if (self.mClients[client.tagDomain].isSignIn) {
                self.action(this, json);
            } else {
                self.action(this, json);
            }
        }

        if (MASTER) {
            client.on('message', onPassiveMessage);
        }
        else {
            initActiveManage();
            client.on('message', onActiveMessage);
        }
        client.refresh_func = function () {
            if (!client.socket.writable) {
                clearTimeout(client.refresh_time);
            } else {
                client.refresh_time = setTimeout(client.refresh_func, SERVER_INFO_TICK);
                if (typeof self.mClients[client.tagDomain] != "undefined" && client.manage.liveLog != true)
                    client.write(JSON.stringify({"event":"getClusterInfos", "data": self.mClients[client.tagDomain].podsInfo}));
            }
        };
        client.refresh_func();

        client.on('disconnect', function () {
            client.manage.close();
            var namespace = client.namespace.substr(1, client.namespace.length);
            var group = self.getClients(namespace);
            if (typeof group != "undefined") {
                group[client.name] = undefined;
                delete group[client.name];
            }

            clearTimeout(client.refresh_time);
            client.refresh_func = {};

            self._connections--;
            if (typeof client.live_log_namespace != "undefined") {
                self.removeClient(client.name, namespace);
            }
            NSLog.log("debug","admin disconnect");

            var pids = Object.keys(client.cpuListen);
            while (pids.length > 0) {
                var pid = pids.shift();
                self.removeListener(pid, client.cpuListen[pid]);
            }
        });
    });
    srv.on('httpUpgrade', function (req, client, head) {});

    return srv;
};
RemoteControl.prototype.onManageMessage = function (client, data) {
    var pod;
    var json;

    this.updateBuffer(client, data);

    var arr = client.chunkBuffer.toString().match(/(\{.+?\})(?={|$)/g);
    if (typeof arr == "undefined" || !arr) arr = [];
    for (var i = 0 ; i < arr.length; i++) {
        var len = Buffer.byteLength(arr[i]);
        try {
            json = JSON.parse(data);
            client.write(data);
            client.chunkBuffer = client.chunkBuffer.slice(len, client.chunkBuffer.length);
            if (json["action"] == "clusterLockEnabled") {
                client.manage.getClusterInfos();
            }
            else if (json["event"] == "getClusterInfos") {
                NSLog.log("info", "outside:onManageMessage:getClusterInfos()");
                pod = this.mClients[client.tagDomain];
                pod.updatePodInfo(json["data"]);
                client.write(JSON.stringify({"event":"getClusterInfos", "data": pod.podsInfo}));
            }
            else if (json["event"] == "onSetLBGamePath") {
                var clients = this.webServer.getClients();
                var keys = Object.keys(clients);
                var clen = keys.length;
                while (--clen >= 0) {
                    var c = clients[keys[clen]].manage;
                    c.getLBGamePath();
                }
            }
            else if (json["action"] == "onReadBlockIPs") {
                client.write(JSON.stringify({event:"onGetIPFilter", data:client.manage.getIPFilter()}));
            }
            else {
                client.manage.getClusterInfos();
            }
        }
        catch (e) {
            // console.error("outside:",e);
        }
    }
};

RemoteControl.prototype.action = function (client, action) {
    var self = this;
    NSLog.log("debug",'action:', action["event"]);
    switch (action["event"])
    {
        case "signin":
            client.manage.signIn(action["data"][0], action["data"][1]);
            break;
        case "signout":
            client.manage.signOut();
            break;
        case "joinPod":
            client.tagDomain = action["data"][0];

            if (typeof self.mClients[client.tagDomain] == "undefined") {
                client.write(JSON.stringify({"event":"joinPod", data:false, error:"NotFound"}));
            } else if (client.sendApplyJoin == true) {
                client.write(JSON.stringify({"event":"joinPod", data:false, error:"RedoCall"}));
            } else {
                client.sendApplyJoin = true;
                self.mClients[client.tagDomain].applyJoin(function (nClient) {
                    client.doApplyJoin = true;
                    client.manage = new OctoManage();
                    client.manage.bounding(nClient.socket);
                    client.manage.on("data", function (data) {
                        self.onManageMessage(client, data);
                    });
                    client.write(JSON.stringify({"event":"joinPod", data: true}));
                });
            }
            break;
        case "getPods":
            client.write(JSON.stringify({"event":"getPods", "data": Object.keys(self.mClients)}));
            break;
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
            if (MASTER == true) {
                client.write(JSON.stringify({"event":"getSysInfo", "data": this.mClients[client.tagDomain].sysInfo}));
            } else {
                this.getDiskUse();
                client.write(JSON.stringify({"event":"getSysInfo", "data": this.sysInfo}));
                delete this.sysstat.devices;
                delete this.sysstat.snmp;
            }

            break;
        }
        case "assignInfo": {
            break;
        }
        case "addCluster": {

            if (isNaN(Number(action["data"][2]))) action["data"][2] = 1024;

            if (action["data"][0].substr(action["data"][0].length-3, action["data"][0].length) == '.js') {
                client.manage.addCluster(action["data"][0], action["data"][1], action["data"][2], action["data"][3]);
            } else if (typeof action["data"][3] == "object")
            {
                const options = action["data"][3];
                if (options.cmd != "" && typeof options.cmd != "undefined" && options.cmd != null) {
                    client.manage.addCluster(action["data"][0], action["data"][1], action["data"][2], action["data"][3]);
                }
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
            client.manage.restartCluster(action["data"][0], action["data"][1]);
            break;
        }
        case "refuseUser": {
            client.manage.refuseUser(action["data"][0],action["data"][1]);
            break;
        }
        case "refuseUser2PID": {
            client.manage.refuseUser2PID(action["data"][0],action["data"][1]);
            break;
        }
        case "addAssign": {
            client.manage.updateAssign(action["data"][0],action["data"][1], action["data"][2]);
            break;
        }
        case "editAssign": {
            client.manage.editAssign(action["data"][0],action["data"][1], action["data"][2], action["data"][3], action["data"][4]);
            break;
        }
        case "deleteAssign": {
            client.manage.deleteAssign(action["data"][0]);
            break;
        }
        case "liveLog": {
            var namespace = action["data"][0].toLowerCase();
            if (typeof client.live_log_namespace != "undefined") {
                self.removeClient(client.name, namespace);
            }
            client.live_log_namespace = namespace;
            client.manage.liveLog = true;

            self.setClients(client, namespace);
            client.write(JSON.stringify({"event":"onLiveLog", data:true}));
            break;
        }
        case "leaveLog": {
            self.removeClient(client.name, action["data"][0].toLowerCase());
            client.write(JSON.stringify({"event":"onLeaveLog", data:true}));
            break;
        }
        case "getLoggerList": {
            self.getLoggerList(client);
            break;
        }
        case "setLockConnection": {

            if (typeof action["data"][0] == "boolean") {
                client.manage.setLockConnection(action["data"][0]);
                // var path = AssignPath;
                // var data = fs.readFileSync(path);
                // var conf = eval("("+data+")");
                // conf["lockState"] = action["data"][0];
                // fs.writeFileSync(path, JSON.stringify(conf));
                //
                // self.mClients[client.tagDomain][0]['lock'] = action["data"][0];
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
        case "setLBGamePath":{
            var keys = Object.keys(action["data"][0]);
            //字母排序
            var sort = keys.sort();
            var key;
            var sortObject = {};
            for (var s = 0; s < sort.length; s++) {
                key = sort[s];
                sortObject[key] = action["data"][0][key];
            }
            action["data"][0] = sortObject;
            //
            if (keys.length == 0) {
                client.write(JSON.stringify({"event":"onSetLBGamePath", "data": 0}));
                return;
            }
            client.manage.setLBGamePath(action["data"]);
            break;
        }
        case "getLBGamePath":{
            client.manage.getLBGamePath();
            break;
        }
        case "viewQuery": {
            self.lcbQuery(action["data"], client);
            break;
        }
        case "getLatteTable": {
            self.getLatteTable(client);
            break;
        }
        case "setLBGamePathOnRole": {
            var index = action["data"][1];
            var data = action["data"][0];
            if (typeof index == "undefined" || typeof data.mode != "string" || typeof data.maxconn != "number") {
                client.write(JSON.stringify({"event":"onSetLBGamePathOnRole", "data": 0}));
                return;
            }

            client.manage.setLBGamePathOnRole({data:data, index:index});
            break;
        }
        case "getLBGamePathOnRole": {
            client.manage.getLBGamePathOnRole();
            break;
        }
        case "kickoutToPID": {
            client.manage.kickoutToPID(action["data"][0], action["data"][1], action["data"][2]);
            break;
        }
        case "reloadToPID": {
            client.manage.reloadToPID(action["data"][0], action["data"][1]);
            break;
        }
        case "hotReload": {
            client.manage.hotReload(action["data"][0], action["data"][1]);
            break;
        }
        case "getSysLog": {
            // client.manage.getSysLog();
            var file = Path.resolve(Path.dirname(__filename), "../historyLog/Dashboard.json");
            fs.readFile(file, function (error, data) {
                client.write(JSON.stringify({event:"onGetSysLog", data: eval("("+data+")")}));
            });
            break;
        }
        case "setLogLevel": {
            client.manage.setLogLevel(action["data"][0], action["data"][1]);
            break;
        }
        case "reloadMgmt": {
            client.manage.reloadMgmt(action["data"][0]);
            break;
        }
        case "setRecordEnabled": {
            client.manage.setRecordEnabled(action["data"][0]);
            break;
        }
        case "connectDistributed": {
            client.manage.connectDistributed(action["data"][0]);
            break;
        }
        case "getIPFilter": {
            client.write(JSON.stringify({event:"onGetIPFilter", data:client.manage.getIPFilter()}));
            break;
        }
        case "setIPFilter": {
            client.manage.setIPFilter(action["data"][0], action["data"][1], action["data"][2], action["data"][3], action["data"][4], action["data"][5]);
            break;
        }
        case "getStreamConf": {
            client.manage.getStreamConf(action["data"][0], client);
            break;
        }
        case "setStreamConf": {
            client.manage.setStreamConf(action["data"][0], client);
            break;
        }
        case "setAMFConfig": {
            client.manage.setAMFConfig(action["data"][0]);
            break;
        }
        case "getAMFConfig": {
            client.manage.getAMFConfig();
            break;
        }
    }

};

/** 內部Logger連線通道 **/
RemoteControl.prototype.insideLogPipe = function () {
    var self = this;
    var srv = this.insideSrv = net.createServer(function (socket) {
        // console.log('connected');
        socket.once('data', function (chunk) {
            var obj;
            try {
                obj = JSON.parse(chunk.toString().toLowerCase());
                socket.name = obj.id;
                socket.source = obj.source;
                socket.sDomain = obj.domain;
                socket.mode = 2;
            } catch (e) {
                obj = chunk.toString().toLowerCase();
                socket.name = obj;
                socket.mode = 1;
            }

            if (socket.source == true) {
                socket.acknowledgement = 0;
                self.LoggerSockets[socket.name] = socket;
                socket.on("data", onDataHandler);
                console.log('Connect Logger Name:', socket.name);
            } else {
                self.bindingSocks[socket.name] = socket;
                socket.acknowledgement = 0;
                socket.on("data", onDataHandler);
            }
        });

        function onDataHandler(chunk) {
            socket.acknowledgement += chunk.byteLength;
            var group = self.getClients(socket.name);
            var n_keys = 0;
            if (typeof group == "undefined") {
                group = [];
            }
            if (group.length == 0 && n_keys.length == 0 ) return;

            var data = JSON.stringify({'event': 'liveLog', 'name': socket.name, 'log': chunk.toString()});
            var g_key = Object.keys(group);
            var g;
            for (g = 0; g < g_key.length; g++) {
                var client = group[g_key[g]];
                client.write(data);

            }
        }


        socket.on("close", function () {
            self.LoggerSockets[socket.name] = undefined;
            delete self.LoggerSockets[socket.name];
            self.bindingSocks[socket.name] = undefined;
            delete self.bindingSocks[socket.name];
        })
    });
    srv.listen(WPC_Logging_Port);
};

RemoteControl.prototype.setClients = function (client, namespace) {

    if (typeof this.clients[namespace] == "undefined") {
        this.clients[namespace] = {};
    }
    namespace = namespace.toLowerCase();
    this.clients[namespace][client.name] = client;

};
RemoteControl.prototype.getLoggerList = function (client) {

    var list = Object.keys(this.LoggerSockets);
    console.log('list ',list);

    client.write(JSON.stringify({"event":"getLoggerList", "data":list}));
};

RemoteControl.prototype.removeClient = function (name, namespace) {
    namespace = namespace.toLowerCase();
    if (typeof this.clients[namespace] == "undefined") {
        return;
    }
    delete this.clients[namespace][name];
};

RemoteControl.prototype.getClients = function (namespace) {

    var group = this.clients[namespace];

    return group;
};

/** Active OctoProxy-node command-line interface **/
RemoteControl.prototype.connectAdminCtrl = function (port) {
    const self   = this;
    var manage = new OctoManage();
    manage.run(port);
    manage.polling();
    NSLog.log("info", "OctoProxy-node command-line interface mode:%s", manage.mode);
    manage.on("data", function (chunk) {
        var arr = chunk.toString().match(/(\{.+?\})(?={|$)/g);

        if (typeof arr == "undefined" || arr == null) arr = [];

        for (var i = 0 ; i < arr.length; i++) {
            try {
                var json = JSON.parse(arr[i]);
                if (json["event"] == "getClusterInfos") {
                    manage.updatePodInfo(json["data"]);
                    self.getPID();
                    self.recordLog(manage.podsInfo);
                }
            }
            catch (e) {
                console.error(e, chunk.toString());
            }
        }

    });
    this.mClients[this.hostname] = manage;
    //this.manage = manage;
};
/** Passive **/
RemoteControl.prototype.listens = function (port) {
    var self = this;
    var mgmtSrv = new fxNet(port, {'runListen':true, glListener:false});
    mgmtSrv.on('connection', function (client) {
        if (client.mode == "ws" || client.mode == "http"){
            client.close();
        }
        client.heartbeatEnabled = false; // timeout false
        client.uptime = new Date().getTime();
        client.hasSetup = false;

        var onMessageHandle = function onMessageHandle(data) {
            try {

                self.updateBuffer(client, data);
                var arr = client.chunkBuffer.toString().match(/(\{.+?\})(?={|$)/g);
                if (typeof arr == "undefined" || !arr) arr = [];
                for (var i = 0 ; i < arr.length; i++) {
                    var json = JSON.parse(arr[i]);
                    var len = Buffer.byteLength(arr[i]);
                    client.chunkBuffer = client.chunkBuffer.slice(len, client.chunkBuffer.length);

                    if (client.hasSetup == true || json.event == "setup") {
                        //NSLog.log('info',"mgmt[message]:", json);
                        if (json.event == "setup") {
                            client.hasSetup = true;
                            client.tagDomain = json.data[0];
                            self.mClients[json.data[0]] = new OctoManage(client);
                            self.mClients[json.data[0]].delegate = self;
                            self.mClients[json.data[0]].tagDomain = client.tagDomain;
                            NSLog.log("info", "Accept a connection on a socket <%s>.", client.tagDomain);
                        } else {
                            self.mClients[client.tagDomain].masterHandle(json);
                        }
                    } else if (json.event == "applyJoin") {
                        if (typeof self.mClients[json.data[0]].blocking["/" + json.data[1]] != "undefined") {
                            self.mClients[json.data[0]].blocking["/" + json.data[1]](client);
                            NSLog.log("info", "Respond a connection on a socket <%s>.", client.name)
                        }
                    }
                }

            } catch (e) {
                console.log("error", '### ', e);
            }
        };
        var onDisconnectHandle = function onDisconnectHandle(name) {};
        var onErrorHandle = function onErrorHandle(data) {
            if (client.isConnect && client.socket.writable && !client.socket.destroyed) {
                client.close();
            }
        };
        var closeHandle = function closeHandle() {
            client.socket.removeListener("close", closeHandle);
            self.mClients[client.tagDomain] = undefined;
            delete self.mClients[client.tagDomain];

        };
        client.on('message', onMessageHandle);
        client.on("disconnect", onDisconnectHandle);
        client.on("error", onErrorHandle);
        client.on("ping", function (obj) {});
        client.socket.on("close", closeHandle);
    });
    mgmtSrv.on("error", function (error) {
        NSLog.log("error", "The service ERROR!!!");
    });
    mgmtSrv.on("close", function () {
        console.log('close');
    });
    mgmtSrv.on("Listening", function () {
        var info = mgmtSrv.app.address();
        NSLog.log("info", "The service has started to address [%s]:%s. ", info.address, info.port);
    });

};

RemoteControl.prototype.updateBuffer = function (socket, data) {
    // NSLog.log("debug", '#2 length - ', data.length, data);
    if (!socket.chunkBuffer || socket.chunkBuffer == null || typeof socket.chunkBuffer == 'undefined'){
        //NSLog.log("debug", '#1 ',socket.chunkBuffer, ((socket.chunkBuffer != null) ? socket.chunkBuffer.length : 0) );
        socket.chunkBuffer = Buffer.from(data);
    }else
    {
        if (socket.chunkBuffer.length == 0) {
            socket.chunkBuffer = Buffer.from(data);
        }else
        {
            var total = socket.chunkBuffer.length + data.length;
            socket.chunkBuffer = Buffer.concat([socket.chunkBuffer,data], total);
        }
    }

    socket.chunkBufSize += data.length;
};

RemoteControl.prototype.recordLog = function (data, hostName) {
    var report = {action:"process", data:{}};
    if (typeof hostName == "undefined") hostName = this.hostname;
    report.data[hostName] = data;
    // NSLog.log("debug", "recordLog()", JSON.stringify(report));
    if (typeof this.syslog != "undefined") this.syslog.send(JSON.stringify(report));
    // this.noSQL.upsertSubDocument(report, "getClusterInfos", hostName);

};
RemoteControl.prototype.lcbQuery = function (action, client) {
    var self   = this;
    var ddoc   = action[0];
    var view   = action[1];
    var start  = action[2];
    var ended  = action[3];
    var keys   = action[4];
    var groups = action[5];
    var stale  = (typeof action[6] == "undefined") ? 1 : action[6];
    if (typeof keys == "undefined") keys = null;
    if (typeof groups == "undefined") groups = false;

    this.noSQL.queryView(ddoc, view, start, ended, stale, keys, groups, function query_callback(err, results) {
        var data;
        if (!err) {
            data = {"action":ddoc + "." + view, "result":self.noSQL.customByUser({"result":results})};
        }else {
            data = {"action":"error","error":err};
        }
        client.write(JSON.stringify({"event": "onViewQuery", "data":data}));
    });
};
RemoteControl.prototype.getLatteTable = function (client) {


    var done = 0;
    var obj;
    for (var i = 0 ; i < LATTE_TABLE.length; i++) {
        obj = LATTE_TABLE[i];
        obj.id = i;
        this.processPID(obj).then(this.processTimes.bind(this)).then(function (value) {
            done+=1;
            onDone();
        }).catch(function (reason) {
            done+=1;
            onDone();
        })
    }

    var onDone = function onDone() {
        if (done == LATTE_TABLE.length) {
            client.write(JSON.stringify({"event": "onGetLatteTable", "data":LATTE_TABLE}));
        }
    }

};
RemoteControl.prototype.processPID = function (obj) {
    var self     = this;
    var id       = obj.id;
    var name     = LATTE_TABLE[id]["name"];
    var procName = LATTE_TABLE[id]["file"] + " " + LATTE_TABLE[id]["name"];
    var cmd = "ps -aef | grep '" + procName + "' | grep -v grep | awk '{print $2}'";
    // NSLog.log("error",cmd);

    var solution = function onSolution(resolve, reject) {
        exec(cmd, function (error, stdout, stderr) {
            if (error) {
                reject(error);
                return;
            }
            var pid = parseInt(stdout.replace(/\s/g, ""));
            if (Number.isNaN(pid)) {
                reject("isNaN");
            }else {
                obj.pid = pid;
                resolve(obj);
            }
        });
    };

    return new Promise(solution);
};
RemoteControl.prototype.processTimes = function (obj) {
    var self     = this;
    var cmd = "ps -o lstart= -p " + obj.pid;
    NSLog.log("error", cmd);

    var solution = function onSolution(resolve, reject) {
        exec(cmd, function (error, stdout, stderr) {
            if (error) {
                reject(error);
            } else {
                obj.times = stdout.toString();
                resolve(stdout.toString());
            }

        });
    };

    return new Promise(solution);
};
RemoteControl.prototype.killLatte = function (pid, cb) {
    var cmd = "kill -9 " + pid;
    exec(cmd, function (error, stdout, stderr) {
        if (typeof cb != "undefined") {
            cb();
        }

    });
};
RemoteControl.prototype.latteReset = function (pid, cmd, sh, client) {
    var cmd = ['-u','Newflash','-H','sh','-c','cd ~/www/Latte/;sh ' + sh];
    NSLog.log("error", cmd);

    var child_proc = spawn("sudo", cmd);
    child_proc.stderr.setEncoding('utf8');
    child_proc.stdout.setEncoding('utf8');

    child_proc.stderr.on('data', function(data) {
        NSLog.log("error","stderr:", data);
        client.write(JSON.stringify({"event": "error", "data":"Command failed", "action":"onRestartLatte"}));
    });
    child_proc.stdout.on('data', function(data) {
        NSLog.log("error","stdout:", data);
        client.write(JSON.stringify({"event": "result", "data":true, "action":"onRestartLatte"}));
    });

};

RemoteControl.prototype.setScheduler = function () {

};
RemoteControl.prototype.getScheduler = function () {

};
//屏棄
RemoteControl.prototype.__defineSetter__("setClusterInfos", function (info) {
    var pre = this.clusterInfos;
    this.clusterInfos = info;
    var i = this.clusterInfos.length;
    var memory = {};
    while (i-- > 0) {
        var proc  = this.clusterInfos[i];
        var pre_proc = (typeof pre == "undefined") ? proc : pre[i];
        var count = parseInt(proc["count"]);
        if (typeof pre_proc != "undefined" && typeof pre_proc["payload"] == "number") {
            proc["payload"] = Math.max(count, pre_proc["payload"]);
            if (proc["payload"] == null) proc["payload"] = count;
        }else {
            proc["payload"] = count;
        }
        if (typeof proc["memoryUsage"] != "undefined" && typeof proc["memoryUsage"]["rss"] != "undefined")
            memory[proc["name"]] = proc["memoryUsage"]["rss"]/1000 + "Kb";
        if (typeof this.cpusUsage[proc.pid] != "undefined" && typeof this.cpusUsage[proc.pid][1] != "undefined") {
            this.clusterInfos[i]["cpuUsage"] = this.cpusUsage[proc.pid][1];
        } else {
            this.clusterInfos[i]["cpuUsage"] = 0;
        }

    }
    // NSLog.log("debug","setClusterInfos:#1");

    memory = null;
    pre = null;
});

util.inherits(OctoManage, events.EventEmitter); // 繼承事件

function OctoManage(socket) {
    events.EventEmitter.call(this);
    this.index = 0;
    this.blocking = {};
    this.socket = undefined;
    this.AssignPath = AssignPath;
    this.IPFilterPath = IPFilterPath;
    this.isSignIn = false;
    this.podsInfo = {};
    this.cpuUsage = {};
    this.sysInfo  = {};
    this.liveLog  = false
    this.delegate = undefined;
    if (typeof socket != "undefined") {
        this.runListening(socket);
        this.polling();
    }

}
OctoManage.MODE_LEADER = 1;
OctoManage.MODE_MEMBER = 0;
OctoManage.prototype.run = function (port) {
    this.mode = OctoManage.MODE_MEMBER;
    this._init();
    this._connect(port);
};
OctoManage.prototype.runListening = function (socket) {
    this.mode = OctoManage.MODE_LEADER;
    this.socket = socket;
    var self = this;
    Object.defineProperty(this.socket, "writable", {
        get:function () {
            if (typeof self.socket.socket == "undefined") return false;
            return self.socket.socket.writable
        }
    })
};
OctoManage.prototype.bounding = function (socket) {
    this.mode = OctoManage.MODE_LEADER;
    this._init(socket);

};
OctoManage.prototype._init = function (socket) {
    var self = this;
    var sock;
    if (typeof socket != "undefined") {
        sock = this.socket = socket;
    } else {
        sock = this.socket = new net.Socket();
    }

    sock.on("data", function (chunk) {
        self.updateBuffer(sock, chunk);
        var arr = sock.chunkBuffer.toString().match(/(\{.+?\})(?={|$)/g);
        if (typeof arr == "undefined" || !arr) arr = [];
        for (var i = 0 ; i < arr.length; i++) {
            var len = Buffer.byteLength(arr[i]);
            sock.chunkBuffer = sock.chunkBuffer.slice(len, sock.chunkBuffer.length);
            self.emit("data", arr[i]);
        }
    });
    sock.on('error', function (e) {
        // self.emit("error", e);
        try {sock.destroy();}
        catch (e) {}
    });
    sock.on('close', function () {
        NSLog.log("info","Retry OctoManage Connect.");
        setTimeout(function () {
            sock.connect(sock.port, Server_IP);
        }, 5000);
    });

};
OctoManage.prototype.polling = function () {
    var self = this;
    if (typeof this.pollingTime != "undefined") {
        clearTimeout(this.pollingTime);
        this.pollingTime = undefined;
    }
    function latest_sys_update() {
        self.getClusterInfos();
        setTimeout(latest_sys_update, SERVER_INFO_TICK);
    }
    this.pollingTime = setTimeout(latest_sys_update,SERVER_INFO_TICK);
};
//master socket event
OctoManage.prototype.masterHandle = function (json) {
    console.log('masterHandle');
    var self = this;
    if (json["event"] == "getClusterInfos") {
        self.updatePodInfo(json["data"]);
        if (typeof this.delegate != "undefined") self.delegate.recordLog(self.clusterInfos, this.tagDomain);
    } else if (json["event"] == "updatePodDevInfo") {
        self.updatePodDevInfo(json["sysInfo"], json["cpusUsage"]);
    } else {
        self.emit("handle", msg);
    }

};
OctoManage.prototype.updatePodInfo = function (info) {
    //NSLog.log("debug",'OctoManage::updatePodInfo()');
    var pre = this.podsInfo;
    this.podsInfo = info;
    var i = this.podsInfo.length;
    var memory = {};
    while (i-- > 0) {
        var proc  = this.podsInfo[i];
        var pre_proc = (typeof pre == "undefined") ? proc : pre[i];
        var count = parseInt(proc["count"] || 0);
        if (typeof pre_proc != "undefined" && typeof pre_proc["payload"] == "number") {
            proc["payload"] = Math.max(count, pre_proc["payload"])
        }else {
            proc["payload"] = count;
        }
        if (typeof proc["memoryUsage"] != "undefined" && typeof proc["memoryUsage"]["rss"] != "undefined")
            memory[proc["name"]] = proc["memoryUsage"]["rss"]/1000 + "Kb";
        if (typeof this.cpuUsage[proc.pid] != "undefined" && typeof this.cpuUsage[proc.pid][1] != "undefined") {
            this.podsInfo[i]["cpuUsage"] = this.cpuUsage[proc.pid][1];
        } else {
            this.podsInfo[i]["cpuUsage"] = 0;
        }


    }
    memory = null;
    pre = null;
};
OctoManage.prototype.getDevInfo = function () {
    var sock = this.socket;
    sock.write(JSON.stringify({"event":"updatePodDevInfo"}));
};
OctoManage.prototype.updatePodDevInfo = function (sysInfo, cpuUsage) {
    if (typeof cpuUsage != "undefined") {
        this.cpuUsage = cpuUsage;
    }
    this.sysInfo = sysInfo;
};
OctoManage.prototype.applyJoin = function (cb) {
    var sock = this.socket;
    this.index++;
    this.blocking["/" + this.index] = cb;
    sock.write(JSON.stringify({"event":"applyJoin", data: ["127.0.0.1", this.index]}));
};
OctoManage.prototype.tasks = function (client) {

};
OctoManage.prototype.updateBuffer = function (socket, data) {
    // NSLog.log("debug", '#2 length - ', data.length, data);
    if (!socket.chunkBuffer || socket.chunkBuffer == null || typeof socket.chunkBuffer == 'undefined'){
        //NSLog.log("debug", '#1 ',socket.chunkBuffer, ((socket.chunkBuffer != null) ? socket.chunkBuffer.length : 0) );
        socket.chunkBuffer = Buffer.from(data);
    }else
    {
        if (socket.chunkBuffer.length == 0) {
            socket.chunkBuffer = Buffer.from(data);
        }else
        {
            var total = socket.chunkBuffer.length + data.length;
            socket.chunkBuffer = Buffer.concat([socket.chunkBuffer,data], total);
        }
    }

    socket.chunkBufSize += data.length;
};
OctoManage.prototype._initWithWS = function (port) {
    var self = this;
    var ws = this.socket = new WebSocket("ws://127.0.0.1:" + port + "/ctrl/");
    ws.on("open",  function () {
        NSLog.log('info', 'connected to the ocotoproxy admin control cli.');
        ws.write(JSON.stringify({"event":"getAssign"}));

    });
    ws.on('message', function incoming(data) {
        self.emit("data", data);
    });
    this.socket.write = this.socket.send;
    this.socket.destroy = this.socket.close;
    Object.defineProperty(this.socket, "writable", {
        get:function () {
            if (typeof self.socket._socket == "undefined") return false;
            return self.socket._socket.writable
        }
    })
};
OctoManage.prototype.close = function () {
    if (this.socket instanceof net.Socket) {
        this.socket.removeAllListeners();
        this.socket.destroy();
    } else {
        this.socket.close();
    }
    clearTimeout(this.pollingTime);
    this.pollingTime = undefined;
};
OctoManage.prototype._connect = function (port) {
    var sock = this.socket;
    sock.port = port;

    sock.on('connect',function () {
        NSLog.log('info', 'connected to the ocotoproxy admin control cli.');
        sock.write(JSON.stringify({"action":"setup"})); // ** Need Send One data. ** //
    });

    sock.connect(port, Server_IP);
};
/** 列出子程序 **/
OctoManage.prototype.getAssign = function () {
    var sock = this.socket;
    if (sock.writable) {
        sock.write(JSON.stringify({"event":"getAssign"}));
    } else {
        edittor.getAssign.apply(this);
    }

};
/** 顯示子程序資訊 **/
OctoManage.prototype.getClusterInfos = function () {
    var sock = this.socket;
    if (sock.writable)
        sock.write(JSON.stringify({"event":"getClusterInfos"}));
};
/** 動態重啟指定程序名稱 - 伺服器重啟就無效 **/
OctoManage.prototype.restartCluster = function (assign, pid) {
    var sock = this.socket;
    sock.write(JSON.stringify({"event":"restartCluster","data":[assign, pid]}));
};
/** 動態新增指定程序 - 伺服器重啟就無效 **/
OctoManage.prototype.addCluster = function (filePath, assign, mxoss, option) {
    var sock = this.socket;
    if (typeof option == "undefined") option = {};
    sock.write(JSON.stringify({"event":"addCluster","data":[filePath, assign, mxoss, option]}));
};
/** 編輯指定名單規則 **/
OctoManage.prototype.editCluster = function (oAssign, nAssign, options) {
    var sock = this.socket;
    console.log(arguments);
    sock.write(JSON.stringify({"event":"editCluster","data":[oAssign, nAssign, options]}));
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
/** send process running kill yourself **/
OctoManage.prototype.reloadToPID = function (pid) {
    var sock = this.socket;
    sock.write(JSON.stringify({"event":"reloadToPID","data":[pid]}));
};
OctoManage.prototype.hotReload = function (pid, params) {
    var sock = this.socket;
    sock.write(JSON.stringify({"event":"hotReload","data":[pid, params]}));
};
/** 踢除某子程序使用者接口 **/
OctoManage.prototype.kickoutToPID = function (pid, trash, params) {
    var sock = this.socket;
    sock.write(JSON.stringify({"event":"kickoutToPID","data":[pid, trash, params]}));
};
/** 拒絕使用者 **/
OctoManage.prototype.refuseUser = function (assign, bool) {
    var sock = this.socket;
    console.log(arguments);
    sock.write(JSON.stringify({"event":"clusterLockEnabled","data":[assign,bool]}));
};
OctoManage.prototype.refuseUser2PID = function (pid, bool) {
    var sock = this.socket;
    console.log(arguments);
    sock.write(JSON.stringify({"event":"clusterLockEnabledToPID","data":[pid,bool]}));
};
/** 新增啟動名單規則 **/
OctoManage.prototype.updateAssign = function (file, assign, mxoss) {
    var sock = this.socket;
    var obj  = {"file":file, "assign":assign, "mxoss":mxoss};
    if (sock.writable) {
        sock.write(JSON.stringify({"event":"updateAssign","data":[ obj ]}));
    }else {
        edittor.updateAssign.apply(this, [obj]);
        this.getAssign();
    }
};
/** 編輯啟動名單規則 **/
OctoManage.prototype.editAssign = function (oAssign, file, nAssign, mxoss, options) {
    var sock = this.socket;
    var obj  = [oAssign, {"file":file, "assign":nAssign, "mxoss":mxoss, options: options}];
    if (sock.writable) {
        sock.write(JSON.stringify({"event":"editAssign","data":obj}));
    } else {
        edittor.editAssign.apply(this, obj);
        this.getAssign();
    }

};
/** 刪除指定名稱啟動名單 **/
OctoManage.prototype.deleteAssign = function (assign) {
    var sock = this.socket;
    if (sock.writable) {
        sock.write(JSON.stringify({"event":"deleteAssign","data":[assign]}));
    } else {
        edittor.deleteAssign.apply(this, [assign]);
        this.getAssign();
    }

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
    var command = "ps -aef | grep 'octoproxy.js' | grep -v grep | awk '{print $2}'";

    if (process.send instanceof Function) {

        command = "sh -c 'pushd ../; kill -9 " + process.pid + "; sh startup.sh; popd;'";
        exec("sh -c 'pushd ../; sh startup.sh; popd;'", function (error, stdout, stderr) {
            
        });
        return;
    }


    exec(command, function (error, stdout, stderr) {

        NSLog.log('debug', 'Listen %s: %s', type, stdout);

        if (error) {
            console.error(error);
            return;
        }
        var state = parseInt(stdout.replace(/\s/g, ""));


        if (isNaN(state) == true) {

            exec("sh -c 'pushd ../; sh startup.sh; popd;'", function(error, stdout, stderr){
                NSLog.log("warning", arguments);
            });
        } else {
            NSLog.log("debug", "killer process octoproxy.");

            exec("kill -9 "+ state, function (err, stdaut, stderr) {

                exec("sh -c 'pushd ../; sh startup.sh; popd;'", function (error, stdout, stderr) {
                    NSLog.log("warning", arguments);
                });

            });

        }
    });

};
OctoManage.prototype.setLBGamePath = function (o) {
    var sock = this.socket;
    if (sock.writable)
        sock.write(JSON.stringify({"event":"setLBGamePath","data":[o]}));
};
OctoManage.prototype.getLBGamePath = function () {
    var sock = this.socket;
    if (sock.writable)
        sock.write(JSON.stringify({"event":"getLBGamePath"}));
};
OctoManage.prototype.setLBGamePathOnRole = function (o) {
    var sock = this.socket;
    if (sock.writable)
        sock.write(JSON.stringify({"event":"setLBGamePathOnRole","data":[o]}));
};
OctoManage.prototype.getLBGamePathOnRole = function () {
    var sock = this.socket;
    if (sock.writable)
        sock.write(JSON.stringify({"event":"getLBGamePathOnRole"}));
};

OctoManage.prototype.setIPFilter = function (ip, state, endTime, count, log) {
    var sock = this.socket;

    var checkIP = ip.match(/^((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)/g);

    if (checkIP == null) {
        sock.write(JSON.stringify({"event":"result","action":"onSetIPFilter", "data": false}));
    }

    var obj = {address: checkIP.toString(), state:state, startTime: new Date().toISOString()};

    if (state) {
        edittor.setIPFilterAdd.apply(this, [obj]);
    } else {
        edittor.setIPFilterDel.apply(this, [obj]);
    }
    if (sock.writable)
        sock.write(JSON.stringify({"event":"readBlockIPs"}));
};
OctoManage.prototype.getIPFilter = function () {
    return edittor.getIPFilter.apply(this);
};
OctoManage.prototype.getStreamConf = function (name, client) {

    var file;
    if (typeof name != "string") name = "";
    switch (name) {
        case "origin":
        {
            file = Path.resolve(Path.dirname(__filename), configurationPath, "./MediaOrigin.json");
            fs.readFile(file, function (error, data) {
                client.write(JSON.stringify({event:"onGetStreamConf", data: {key:name, val:eval("("+data+")")}}));
            });
            break;
        }
        case "broker":
        {
            file = Path.resolve(Path.dirname(__filename), configurationPath, "./MediaBroker.json");
            fs.readFile(file, function (error, data) {
                client.write(JSON.stringify({event:"onGetStreamConf", data: {key:name, val:eval("("+data+")")}}));
            });
            break;
        }
        case "edge":
        {
            file = Path.resolve(Path.dirname(__filename), configurationPath, "./MediaEdge.json");
            fs.readFile(file, function (error, data) {
                client.write(JSON.stringify({event:"onGetStreamConf", data: {key:name, val:eval("("+data+")")}}));
            });
            break;
        }
        case "setting":
        {
            file = Path.resolve(Path.dirname(__filename), configurationPath, "./MediaSetting.json");
            fs.readFile(file, function (error, data) {
                client.write(JSON.stringify({event:"onGetStreamConf", data: {key:name, val:eval("("+data+")")}}));
            });
            break;
        }
        default: {
            client.write(JSON.stringify({event:"onGetStreamConf", data: false}));
        }

    }

};
OctoManage.prototype.setStreamConf = function (name, data, client) {
    var self = this;
    var file;
    switch (name) {
        case "origin":
        case "broker":
        case "edge":
        {
            file = Path.resolve(Path.dirname(__filename), configurationPath, "./MediaOrigin.json");
            fs.writeFile(file, JSON.stringify(this.validStreamConf(data, name)), function (error, data) {
                self.getStreamConf(name, client);
                client.write(JSON.stringify({event:"onSetStreamConf", data: true}));
            });
            break;
        }
        case "setting":
        {
            file = Path.resolve(Path.dirname(__filename), configurationPath, "./MediaSetting.json");
            fs.readFile(file, function (error, data) {
                var filterData = self.validStreamConf(data, name, eval("("+data+")"));
                fs.writeFile(file, JSON.stringify(filterData), function (error, data) {
                    self.getStreamConf(name, client);
                    client.write(JSON.stringify({event:"onSetStreamConf", data: true}));
                });

            });
            break;
        }
        default: {
            client.write(JSON.stringify({event:"onSetStreamConf", data: false}));
        }

    }

};
OctoManage.prototype.validStreamConf = function (data, name, old) {
    var obj = {};
    var keys = Object.keys(data);
    var key;
    var item;
    var filter;
    var value;
    if (name == "origin") {
        while (keys.length > 0) {
            key = keys.shift();
            item = data[key];
            if (Array.isArray(item)) {
                filter = item.filter(function (item1, index, array) {
                    return (typeof item1 == "string");
                });
                obj[key] = filter;
            }

        }
        return obj;
    }
    else if (name == "edge" || name == "broker") {
        while (keys.length > 0) {
            key = keys.shift();
            item = data[key];
            if (Array.isArray(item)) {
                filter = item.filter(function (item1, index, array) {

                    var vPath = item1.vPath;
                    var balance = item1.balance;
                    var host = item1.host;
                    var port = item1.port;
                    if (typeof host == "string") {
                        var reg = host.match(/^([0-9]{1,3}\.){3}[0-9]{1,3}(\/([0-9]|[1-2][0-9]|3[0-2]))?$/g);
                        if (reg != null) {
                            host = reg[0];
                            item1.host = host;
                        } else {
                            delete item1["host"];
                        }
                    }
                    if (typeof port != "undefined") {
                        var v = Math.floor(port);
                        if ((typeof v != "number" || isNaN(v) == true || v.toString() != port) == false) {
                            item1.port = v;
                        } else {
                            delete item1["port"];
                        }
                    }
                    var check1 = (typeof vPath == "string" && vPath[0] == "/");
                    var check2 = (typeof balance == "string" && balance[0] == "/");

                    return (check1 && check2);
                });
                obj[key] = filter;
            }

        }
        return obj;
    }
    else if (name == "setting") {

        if (typeof old != "undefined") obj = old;

        while (keys.length > 0) {
            key = keys.shift();
            item = data[key];
            value = item["host"];
            if (typeof value != "undefined") {
                var reg = value.match(/^([0-9]{1,3}\.){3}[0-9]{1,3}(\/([0-9]|[1-2][0-9]|3[0-2]))?$/g);
                if (reg != null) {
                    obj[key]["host"] = reg[0];
                }
            }
            value = item["port"];
            if (typeof value != "undefined") {
                var v = Math.floor(value);
                if ((typeof v != "number" || isNaN(v) == true || v.toString() != value) == false) {
                    obj[key]["port"] = v;
                }
            }
        }
        return obj;
    }
};
/** 顯示系統相關log **/
OctoManage.prototype.getSysLog = function () {
    var sock = this.socket;
    if (sock.writable)
        sock.write(JSON.stringify({"event":"getSysLog"}));
};
/** 設定子程序log等級 **/
OctoManage.prototype.setLogLevel = function (pid, level) {
    var sock = this.socket;
    if (sock.writable)
        sock.write(JSON.stringify({"event":"setLogLevel", "data":[pid, level]}));
};
/**  **/
OctoManage.prototype.reloadMgmt = function (pid) {
    var sock = this.socket;
    if (sock.writable)
        sock.write(JSON.stringify({"event":"reloadMgmt", "data":[pid]}));
};
OctoManage.prototype.setRecordEnabled = function (enabled) {
    var sock = this.socket;
    if (sock.writable)
        sock.write(JSON.stringify({"event":"setRecordEnabled", "data":[enabled]}));
};
OctoManage.prototype.connectDistributed = function (port) {
    if (typeof port == "undefined") port = 80;

    var command = "netstat -ntu | grep -v LISTEN | awk '{print $5}' | cut -d: -f1 | sort | uniq -c | sort -rn | grep -v server | grep -v Address";

    exec(command, function (error, stdout, stderr) {

    });

};
OctoManage.prototype.getAMFConfig = function () {
    var sock = this.socket;
    if (sock.writable)
        sock.write(JSON.stringify({"event":"getAMFConfig"}));
};
OctoManage.prototype.setAMFConfig = function (o) {
    var sock = this.socket;
    if (sock.writable)
        sock.write(JSON.stringify({"event":"setAMFConfig","data":[o]}));
};
OctoManage.prototype.signIn = function (user, pwd) {

};
OctoManage.prototype.signOut = function () {
    this.isSignIn = false;
    this.user = undefined;
};
OctoManage.prototype.ipcMessage = function (pid, params) {
    var sock = this.socket;
    if (sock.writable)
        sock.write(JSON.stringify({"event":"ipcMessage","data":[pid, params]}));
};


/* ----------------------------------
 *        Process Status
 * ---------------------------------- */
RemoteControl.prototype.setupSysstat = function () {
    this.sysstat = new sys.sysstat();
    this.cpusUsage = {};

};
RemoteControl.prototype.getPID = function () {
    const pods = this.mClients[this.hostname];
    const clusters = pods.podsInfo;
    var arr_pid = [];
    for (var i = 0; i < clusters.length; i++) {
        var cluster = clusters[i];
        if (typeof this.cpusUsagePid[cluster["pid"]] == 'undefined') {
            this.cpusUsagePid[cluster["pid"]] = cluster["pid"];
            arr_pid.push(parseInt(cluster["pid"]));
        }else{

        }

    }
    this.runPID(arr_pid);
};
RemoteControl.prototype.runPID = function (arr) {
    const pods = this.mClients[this.hostname];
    const self = this;

    for (var i = 0; i < arr.length; i++) {
        var pid = arr[i];
        var cpu = this.sysstat.pidCPU(pid);
        this.sysstat.on(pid, function (cpid, info) {
            // self.cpusUsage[process.pid.toString()] = info;
            // self.cpusUsage[cpid.toString()] = info;
            pods.cpuUsage[cpid.toString()] = info;
            self.emit(cpid, info);
        });

    }

};
RemoteControl.prototype.getDiskUse = function () {
    var self = this;
    this.sysstat.fd(function (data) {
        if (typeof data == 'number') {
            self.sysInfo["hdd"] = data;
        }else {
            console.error('getDiskUse:', data);
        }
    });
    if (typeof self.sysInfo["hddBlocks"] == "undefined") {
        this.sysstat.fdblocks(function (data) {
            self.sysInfo["hddBlocks"] = data;
        })
    }
};
RemoteControl.prototype.getLoadAvg = function () {
    this.sysInfo["loadavg"] = os.loadavg();
    this.sysInfo["freemem"] = os.freemem();
};
RemoteControl.prototype.getNetInfo = function (delay) {
    var self = this;
    if (typeof this.sysstat != "undefined") {
        this.sysstat.netDev(delay, function (info) {
            self.sysInfo["devices"] = info;
        });
        this.sysstat.netSnmp(delay, function (info) {
            self.sysInfo["snmp"] = info;
        });
    }
};
//remote device information
RemoteControl.prototype.getPodsDevInfo = function () {
    if (typeof this.mClients == "undefined") return;
    var keys = Object.keys(this.mClients);
    var key;
    var pod;
    for (var i = 0; i < keys.length; i++) {
        key = keys[i];
        pod = this.mClients[key];
        pod.getDevInfo();
    }
};
RemoteControl.prototype.BindingProcEvent = function (proxy, wssrv) {
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
                var usage = process.memoryUsage();
                process.send({"evt":"processInfo", "data" : {"memoryUsage":usage,"connections": 0, lv: "debug", bitrates: {} }});
                usage = undefined;
            }else if (data.evt == "c_init") {

                NSLog.log('debug', "Conversion Socket.Hanlde from Child Process.");
                var socket = new net.Socket({
                    handle:handle,
                    allowHalfOpen:proxy.allowHalfOpen
                });
                //socket.readable = socket.writable = true;
                socket.server = proxy;
                proxy.emit("connection", socket);
                socket.emit("connect");
                socket.emit('data', Buffer.from(data.data));
                socket.resume();
            }else if (data.evt == "c_init2") {

                NSLog.log('debug', "Conversion Socket.Hanlde from Child Process.");
                var socket = new net.Socket({
                    handle:handle,
                    allowHalfOpen:wssrv.app.allowHalfOpen
                });
                //socket.readable = socket.writable = true;
                socket.server = wssrv.app;
                wssrv.app.emit("connection", socket);
                socket.emit("connect");
                socket.emit('data', Buffer.from(data.data));
                socket.resume();
            }else{
                NSLog.log('debug', 'out of hand. dismiss message');
            }

        }
        json = undefined;
        handle = undefined;
    });

};
var server = require('http');
var url = require("url");
var path = require('path');

RemoteControl.prototype.setupHTTPServer = function () {

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
            NSLog.log("error", error);
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


var src = new createRemoteSrv();

if (process.send instanceof Function) {
    process.send({"action":"creationComplete"});
}
