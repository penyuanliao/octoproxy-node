/**
 * Created by Benson.Liao on 16/3/9.
 */
/**
 * Created by Benson.Liao on 15/12/9.
 * --always-compact: always full gc().
 * --expose-gc: manual gc().
 */

const debug         = require('debug')('rtmp:BridgeSrv');
debug.log           = console.log.bind(console); //file log 需要下這行
const fxNetSocket   = require('fxNetSocket');
const net           = require('net');
const FxConnection  = fxNetSocket.netConnection;
const parser        = fxNetSocket.parser;
const utilities     = fxNetSocket.utilities;
const libRtmp       = require('./fxNodeRtmp').RTMP;
const config        = require('./config.js');
const path          = require('path');
const isWorker      = ('NODE_CDID' in process.env); //檢查是否啟動worker
const isMaster      = (isWorker === false);
const NSLog         = fxNetSocket.logger.getInstance();
const fileName      = path.basename(require.main.filename) + process.argv[2];
var LOG_LEVEL = "info";
NSLog.configure({logFileEnabled:true, consoleEnabled:true, level:LOG_LEVEL, dateFormat:'[yyyy-MM-dd hh:mm:ss]',fileName:fileName,filePath:__dirname+"/historyLog", maximumFileSize: 1024 * 1024 * 100,
                id:process.argv[2], remoteEnabled: false});

const OPEN_BRACE     = 123;

var connections = []; //記錄連線物件
var connsCount = 0; //連線數
var srv = createNodejsSrv(config.srvOptions.port);
/**
 * 連線到伺服器
 * @param uri obj{host,port}
 * @param client 連線client socket
 * @returns {RTMPClient}
 */
function connect(uri, client) {
    var rtmp = undefined;
    // #1 建立連線
    rtmp = libRtmp.RTMPClient.connect(uri.host,uri.port, function (){
        var remoteAddress = rtmp.socket.remoteAddress.replace("::ffff:", "");
        if (typeof client.originAddress != "undefined") {
            remoteAddress = client.originAddress;
        }
        NSLog.log('debug', "RTMPClient %s:%s Connected! (%s)", rtmp.socket.remoteAddress, rtmp.socket.remotePort, remoteAddress, client.headers);
        //#1-1 送給Client連線成功
        rtmp.on('status', function (cmd) {
            if (client.isConnect && client.flModule === "n/a") {
                rtmp.fmsCall("setClientIP", [remoteAddress]);
                client.write(JSON.stringify({"NetStatusEvent":"Connected.amfIsReady"}));
            } else {
                client.write(JSON.stringify({"NetStatusEvent":"Connected.amfIsReady"}));
            }
        });
        rtmp.connectResponse();
        let args = undefined;
        if (client.flModule === "sp1") {
            args = ["aaa", "bbb"];
        }
        //LNX 11,7,700,203
        //MAC 10,0,32,18
        //MAC 11,8,800,94
        //WIN 11,3,372,94
        //#2-1 告訴FMS進行connect連線
        rtmp.sendInvoke2('connect', 1, {
            app: uri.app, //app name
            flashVer: "MAC 10,0,32,18", //flash version
            tcUrl: uri.path, //rtmp path
            fpad: false, // unknown
            capabilities: 239, // unknown
            audioCodecs: 3191, // audio code
            videoCodecs: 252, // video code
            videoFunction: 1
        }, args);
        NSLog.log('debug', 'sendInvoke FMS connect.');

        //完成後就可以自己送出要的事件
    });

    // #2 接收FMS訊息
    rtmp.on('message', function (message) {
        //檢查FMS訊息Type = 20(0x14 invoke message structure)
        if (message.messageHeader.messageType == 20) {
            //message 裡有Data結構為{commandName:FMS回傳的名稱(String), transactionId:傳輸編號(int),arguments:FMS回傳的變數(Array)};
            var data = message.data;
            var cmd = data.commandName.value;
            var tranId = data.transactionId;
            var argument = data.arguments;
            // debug('INFO :: cmd:%s, argument:%s', cmd, Object.keys(argument));
            //這邊暫時忽略_result訊息
            if(cmd != '_result' || client.flModule == "sp1") {
                NSLog.log("error", "rtmp(%s) > client | client status:%s %s %s, cmd:%s", uri, client.isConnect, client.socket.writable, !client.socket.destroyed, cmd);
                if (client.isConnect && client.socket.writable && !client.socket.destroyed)
                    client.write(JSON.stringify({"NetStatusEvent":"Data","cmd":cmd, args:argument}));
            }else
            {
                // NSLog.log('info','FMS _result:', cmd, argument);
                // rtmp.setWindowACK(2500000);
            }
        };
    });
    // #3 FMS錯誤訊息事件
    rtmp.on("error", function (args) {
        NSLog.log('error',"RTMP ERROR", args);
        if (client.isConnect && client.socket.writable && !client.socket.destroyed) {
            client.write(JSON.stringify({"NetStatusEvent":'NetConnection.Connect.Timeout'}))
        }
        setTimeout(function () {
            onSocketClose(client.name);
        },1000)
    });
    // #4 FMS關閉的事件
    rtmp.on('close', function (args) {
        NSLog.log('info',"RTMP connection closed");
        if(client.isConnect){
            // socket.write(JSON.stringify({"NetStatusEvent":"NetConnection.Connect.Closed"}));
            setTimeout(function () {
                onSocketClose(client.name);
            },1000)
        }

    });
    // 沒有解析的資料
    rtmp.on('data', function (chunk) {
        // header長度
        var header_size = chunk.readUInt8(0);

        if (chunk[0] == 0x02 && chunk.byteLength == 18) {

            NSLog.log('info','basicHeader fmt:%d, number:%d', header_size >> 6, chunk.readInt32BE(14));

            var num = chunk.readInt32BE(14);
            rtmp.pingResponse(num);

        }
    });

    return rtmp;
}
/**
 * 建立fms連線
 * @param client NetConnection自己封裝的Client
 */
function setupFMSClient(client) {

    const parser = parseNamespace(client.namespace);
    var _rtmp;
    var bHost;
    if (parser != false) {
        console.log(parser);
        bHost = parser.host;
        client.socket.namespace = parser.namespace;
        client.flModule = "sp1";
    } else {
        bHost = getFMSServerIP(client);
    }

    var uri = {
        host:bHost,
        port:config.bFMSPort,
        path:"rtmp://" + bHost + ":" + config.bFMSPort + client.namespace,
        app:client.namespace.substr(1,client.namespace.length)
    };

    NSLog.log('info','Bridge of fms:', uri);
    //建立FMS連線
    _rtmp = connect(uri, client);
    //設定一下名稱跟client一樣
    _rtmp.name = client.name;
    //存在array裡面方便讀取
    connections[client.name] = {ws:client, fms:_rtmp};
    connsCount++;
}
function parseNamespace(namespace) {
    console.log(namespace);
    const path = (namespace || "").split("/");
    if (path.indexOf("hk") == -1 && path.indexOf("tp") == -1) {
        return false;
    }
    const args = path[3].split("-");
    
    let ns = ["", path[2], args[1]];
    if (path.length >= 4) {
        ns = ns.concat(path.slice(4));
    }
    return {
        host: args[0],
        namespace: ns.join("/")
    };
}
function parseNamespace2(namespace) {
    const path = (namespace || "").split("/");
    if (path.indexOf("hk") == -1 && path.indexOf("tp") == -1) {
        return false;
    }
    const args = path[2].split("-");

    let ns = ["", args[1]];
    if (path.length >= 3) {
        ns = ns.concat(path.slice(3));
    }
    return {
        host: args[0],
        namespace: ns.join("/")
    };
}
/**
 * config.bExceptions = [ {"Host":"127.0.0.1", "rules":["/BacPlayerLight/V"]}];
 * expection server
 * @param client
 * @returns {string}
 */
function getFMSServerIP(client) {
    if (typeof config.bExceptions != "undefined" && Array.isArray(config.bExceptions))
    {
        for (var i = 0; i < config.bExceptions.length; i++) {
            var host = config.bExceptions[i]["Host"];
            var rules = config.bExceptions[i]["rules"];
            var len = (typeof rules.length != "undefined") ? rules.length : -1;
            while (len-- >= 0) {
                var rule = rules[len];
                if (client.namespace.indexOf(rule) != -1) {
                    return host;
                }
            }

        }
    }

    return config.bFMSHost;
}
/** not implement **/
function ebbStream(sockList) {
    if (typeof sockList != 'object') {
        NSLog.log("error", "type of cannot %s", typeof sockList);
        return;
    }
    var max = sockList.length;
    var isObject = false;
    var keys;
    if (sockList.constructor == Object) {
        keys = Object.keys(sockList);
        max = keys.length;
        isObject = true;
    }
    var count = 1;

    function ebbStreamRun() {

        if (count*511 > max){
            run_ebb(0, max);
        }else {
            run_ebb(0, count*511);
            count++;
        }
    }

    function run_ebb(start, ended) {
        var i = start;

        while (i < ended) {

            if (isObject) {
                // sockList[keys[i]]._handle;
                process.send({'evt':"socket_handle"}, socket._handle);
            }

            i++;
        }
        if (ended < max) return setTimeout(ebbStreamRun, 100);
    }
    ebbStreamRun();
}

/**
 * 建立NodeJS Server
 * @param port
 * @returns {port}
 */
function createNodejsSrv(port) {
    var server = new FxConnection(port, {runListen: isMaster});
    var self = this;
    server.on('connection', function (client) {
        client.flModule = "n/a";
        NSLog.log('info','Connection Clients name:%s(%s) (namespace %s)', client.name, client.originAddress, client.namespace);
        if(typeof client.namespace == "undefined" || client.namespace.indexOf("policy-file-request") != -1 ) {
            console.log('Clients is none rtmp... to destroy.');
            client.close();
            return;
        }
        setupFMSClient(client);
    });
    server.on("ping", function (evt) {
        //回應時間
    });
    server.on('message', function (evt) {
        NSLog.log('error','message :', evt.data);
        var socket = evt.client;
        const sockName = socket.name;
        if (typeof socket == "undefined" || typeof socket.name == "undefined") return;
        var data = evt.data;
        if (typeof data != "undefined" && data.length > 1 && data.charCodeAt(0) == OPEN_BRACE) {
            //object
            try {
                var json = JSON.parse(data);
            }
            catch (e) {
                socket.write(JSON.stringify({"NetStatusEvent":"JSON.Parse.Failed","error":e}));
            }
            var event = json["event"];
            var _fms = connections[sockName].fms;
            //檢查fms有沒有被建立成功沒有就回傳失敗
            if (!_fms) {
                socket.write(JSON.stringify({"NetStatusEvent":"Connect.FMS.Failed"}));
                return;
            }

            /* ----------------------------------
             *        這邊是Websocket事件
             * ---------------------------------- */

            if (event == "Connect") {
                NSLog.log('trace','data', json["data"]);

            }else if (event == "close") {
                socket.close();

            }else if (event == "Send") {
                //測試用
                NSLog.log('trace','data', json["data"]);

                _fms.fmsCall("setObj",json["data"]);

            }else if (typeof event != 'undefined' && event != null && event != "" && typeof json["data"] != "undefined"){

                if (Array.isArray(json["data"]) == false) return;

                json["data"].unshift(event);
                NSLog.log('debug','!!!!! event :', event);
                setTimeout(function () {
                    _fms.fmsCall.apply(_fms, json["data"]);
                },1);
                // _fms.fmsCall(event,json["data"]);

            } else {
                // todo call data
                NSLog.log('trace','[JSON DATA]', json);
                _fms.fmsCall( "serverHandlerAMF", json);
            };
        }else
        {
            /* 如果送出來了事件是字串的話會在這裡 */
        }

    });

    /** server client socket destroy **/
    server.on('disconnect', function (name) {
        NSLog.log('info','disconnect connect client(%s).', name);

        var removeItem = connections[name];

        if (typeof removeItem != 'undefined' && typeof removeItem.fms != 'undefined' && removeItem.fms) {
            removeItem.ws.close();
            removeItem.fms.state = "closed";
            removeItem.fms.socket.destroy();
            delete connections[name];
            NSLog.log('debug','disconnect count:', connsCount,typeof removeItem != 'undefined' , typeof removeItem.fms != 'undefined' );
        };
        connsCount--;
    });

    /**
     * client socket connection is http connect()
     * @param req: request
     * @param client: client socket
     * @param head: req header
     * **/
    server.on('httpUpgrade', function (req, client, head) {

        NSLog.log('debug','## HTTP upgrade ##');
        var _get = head[0].split(" ");

        var socket = client.socket;
        failureHeader(404, socket, "html");
        client.close();

    });
    /**
     * @param code: response header Status Code
     * @param socket: client socket
     * @param type: content-type
     * */
    function successfulHeader(code, socket, type) {

        var contentType = type === 'js' ? "application/javascript" : "text/html";

        var headers = parser.headers.responseHeader(code, {
            "Host": server.app.address().address,
            "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Connection": "Keep-Alive",
            "Keep-Alive": "timeout=3, max=10",
            "Access-Control-Allow-Origin": "*",
            "Content-Type": contentType
        });

        //socket.write("Content-Security-Policy: default-src 'self'; img-src *;object-src 'self' http://127.0.0.1; script-src 'self' http://127.0.0.1;\n");
        socket.write(headers);
    };
    /**
     * @param code: response header Status Code
     * @param socket: client socket
     * */
    function failureHeader(code, socket) {

        var headers = parser.headers.responseHeader(code, {
            "Connection": "close" });
        socket.write(headers);

    };

    return server;
}
function onSocketClose(name) {
    var removeItem = connections[name];

    if (typeof removeItem != 'undefined' && typeof removeItem.fms != 'undefined' && removeItem.fms) {

        if (removeItem.ws.isConnect ){
            removeItem.ws.close();
        }else
        {
            NSLog.log('trace','WS socket is close()');
        }
        if (removeItem.fms.socket.writable){
            removeItem.fms.socket.destroy();
        }else {
            NSLog.log('trace','FMS socket is close()');
        }
        removeItem["fms"] = null;
        removeItem["ws"] = null;
        delete connections[name];

        NSLog.log('debug','disconnect count:', connsCount, typeof removeItem != 'undefined' , typeof removeItem.fms != 'undefined' );
    }
}

/* ------- ended testing logger ------- */
/**
 * 程序錯誤會出現在這裡
 */
process.on('uncaughtException', function (err) {
    NSLog.log('error', 'Process uncaughtException :',err.stack);
});
process.on('SIGQUIT',function () {
    NSLog.log('debug', "IPC channel exit -1");
    process.exit(-1);
});
process.on('disconnect', function () {
    NSLog.log('debug', "sends a QUIT signal (SIGQUIT)");
    process.exit(0);
});
process.on('message', function (data, handle) {
    var json = data;
    if (typeof json === 'string') {

    }else if(typeof json === 'object'){

        if (data.evt == "c_init") {

            NSLog.log('debug', "Conversion Socket.Hanlde from Child Process.");

            var socket = new net.Socket({
                handle:handle,
                allowHalfOpen:srv.app.allowHalfOpen
            });
            socket.readable = socket.writable = true;
            socket.server = srv.app;
            srv.app.emit("connection", socket);
            socket.emit("connect");
            socket.emit('data',Buffer.from(data.data));
            socket.resume();
        } else if(data.evt == "kickUsersOut") {
            NSLog.log("warning", "start kick user out.", json.params);
            var cliKeys = Object.keys(connections);
            for (var i = 0; i < cliKeys.length; i++) {
                onSocketClose(cliKeys[i]);
            }


        } else if(data.evt == "processInfo") {
            process.send({"evt":"processInfo", "data" : {"memoryUsage":process.memoryUsage(),"connections": connsCount, "lv": LOG_LEVEL}})
        } else if (data.evt == "setLogLevel") {
            LOG_LEVEL = data.params.lv;
            NSLog.configure({level:LOG_LEVEL});
            // NSLog.log('warning', "Server manager change NSLog level: [%s]", LOG_LEVEL);

        } else{
            NSLog.log('debug', 'out of hand. dismiss message');
        }
    }
});


function makeSureComplete() {
    if (process.send instanceof Function) {
        process.send({"action":"creationComplete"});
        process.send({evt:"processConf", data: {lv:LOG_LEVEL, f2db:undefined}});
    }
    process.on("SIGTERM", function (signal) {})
}
makeSureComplete();
