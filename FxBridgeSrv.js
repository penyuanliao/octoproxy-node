/**
 * Created by Benson.Liao on 16/3/9.
 */
/**
 * Created by Benson.Liao on 15/12/9.
 * --always-compact: always full gc().
 * --expose-gc: manual gc().
 */

const debug = require('debug')('rtmp:BridgeSrv');
debug.log = console.log.bind(console); //file log 需要下這行
const fxNetSocket = require('fxNetSocket');
const net = require('net');
const FxConnection = fxNetSocket.netConnection;
const parser = fxNetSocket.parser;
const utilities = fxNetSocket.utilities;
const libRtmp = require('./fxNodeRtmp').RTMP;
const config = require('./config.js');
const isWorker = ('NODE_CDID' in process.env);
const isMaster = (isWorker === false);
const NSLog  = fxNetSocket.logger.getInstance();
NSLog.configure({logFileEnabled:true, consoleEnabled:true, level:'trace', dateFormat:'[yyyy-MM-dd hh:mm:ss]',filePath:__dirname+"/historyLog", maximumFileSize: 1024 * 1024 * 100});

var connections = []; //記錄連線物件
var srv = createNodejsSrv(config.srvOptions.port);

/**
 * 連線到伺服器
 * @param uri obj{host,port}
 * @param socket 連線client socket
 * @returns {RTMPClient}
 */
function connect(uri, socket) {
    console.log(uri);
    var rtmp = undefined;
    // #1 建立連線
    rtmp = libRtmp.RTMPClient.connect(uri.host,uri.port, function (){
        NSLog.log('debug', "RTMPClient %s:%s Connected!", rtmp.socket.remoteAddress, rtmp.socket.remotePort);
        //#1-1 送給Client連線成功
        rtmp.on('status', function (cmd) {
            if (socket.isConnect)
                socket.write(JSON.stringify({"NetStatusEvent":"Connected.amfIsReady"}));
        });
        rtmp.connectResponse();

        
        //LNX 11,7,700,203
        //MAC 10,0,32,18
        //MAC 11,8,800,94
        //WIN 11,3,372,94
        //#2-1 告訴FMS進行connect連線
        rtmp.sendInvoke('connect', 1, {
            app: uri.app, //app name
            flashVer: "MAC 10,0,32,18", //flash version
            tcUrl: uri.path, //rtmp path
            fpad: false, // unknown
            capabilities: 9947.75, // unknown
            audioCodecs: 3191, // audio code
            videoCodecs: 252, // video code
            videoFunction: 1
        });
        NSLog.log('debug', 'sendInvoke FMS connect.');

        //完成後就可以自己送出要的事件
    });;

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
            if(cmd != '_result') {
                if (socket.isConnect)
                    socket.write(JSON.stringify({"NetStatusEvent":"Data","cmd":cmd, args:argument}));
            }else
            {
                // NSLog.log('info','FMS _result:', cmd, argument);
                // rtmp.setWindowACK(2500000);
            }
        };
    });
    // #3 FMS錯誤訊息事件
    rtmp.on("error", function (args) {
        console.log("RTMP ERROR", args);
        if (socket.isConnect) {
            socket.write(JSON.stringify({"NetStatusEvent":'NetConnection.Connect.Timeout'}))
        }
        setTimeout(function () {
            onSocketClose(socket.name);
        },1000)
    });
    // #4 FMS關閉的事件
    rtmp.on('close', function (args) {
        console.log("RTMP connection closed");
        if(socket.isConnect){
            // socket.write(JSON.stringify({"NetStatusEvent":"NetConnection.Connect.Closed"}));
            setTimeout(function () {
                onSocketClose(socket.name);
            },1000)
        }

    });
    // 沒有解析的資料
    rtmp.on('data', function (chunk) {
        // header長度
        var header_size = chunk.readUInt8(0);

        if (chunk[0] == 0x02 && chunk.byteLength == 18) {

            console.log('basicHeader fmt:%d, number:%d', header_size >> 6, chunk.readInt32BE(14));

           var num = chunk.readInt32BE(14);
           rtmp.pingResponse(num);

       }
    });

    return rtmp;
};
/**
 * 建立fms連線
 * @param client NetConnection自己封裝的Client
 */
function setupFMSClient(client) {
    var _rtmp;
    var uri = {
        host:config.bFMSHost,
        port:config.bFMSPort,
        path:"rtmp://" + config.bFMSHost + ":" + config.bFMSPort + client.namespace,
        app:client.namespace.substr(1,client.namespace.length)
    };
    debug('Bridge of fms:',uri.path);
    //建立FMS連線
    _rtmp = connect(uri, client);
    //設定一下名稱跟client一樣
    _rtmp.name = client.name;
    //存在array裡面方便讀取
    connections[client.name] = {ws:client, fms:_rtmp};
};
/**
 * 建立NodeJS Server
 * @param port
 * @returns {port}
 */
function createNodejsSrv(port) {
    var server = new FxConnection(port,{runListen: isMaster});
    var self = this;
    server.on('connection', function (client) {

        NSLog.log('info','Connection Clients name:%s (namespace %s)',client.name, client.namespace);
        if(client.namespace.indexOf("policy-file-request") != -1 ) {
            console.log('Clients is none rtmp... to destroy.');
            client.close();
            return;
        }
        setupFMSClient(client);
    });

    server.on('message', function (evt) {
        NSLog.log('debug','message :', evt.data);
        var socket = evt.client;
        const sockName = socket.name;
        var data = evt.data;
        if (data.charCodeAt(0) == 123) {
            //object
            var json = JSON.parse(data);
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

            }else if (typeof event != 'undefined' && event != null && event != ""){
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
        NSLog.log('trace','disconnect connect client(%s).', name);

        var removeItem = connections[name];

        if (typeof removeItem != 'undefined' && typeof removeItem.fms != 'undefined' && removeItem.fms) {
            removeItem.ws.close();
            removeItem.fms.socket.destroy();
            delete connections[name];

            NSLog.log('debug','disconnect count:', Object.keys(connections).length,typeof removeItem != 'undefined' , typeof removeItem.fms != 'undefined' );
        };

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

        NSLog.log('debug','disconnect count:', Object.keys(connections).length,typeof removeItem != 'undefined' , typeof removeItem.fms != 'undefined' );
    };
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
            socket.emit('data',new Buffer(data.data));
            socket.resume();
            return;
        }else if(data.evt == "processInfo") {
            process.send({"evt":"processInfo", "data" : {"memoryUsage":process.memoryUsage(),"connections": Object.keys(connections)}})
        }else{
            NSLog.log('debug', 'out of hand. dismiss message');
        };

    };
});