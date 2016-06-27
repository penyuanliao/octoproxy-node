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
const util = require('util');
const path = require('path');
const FxConnection = fxNetSocket.netConnection;
const parser = fxNetSocket.parser;
const utilities = fxNetSocket.utilities;
const libRtmp = require('../fxNodeRtmp').RTMP;
const config = require('../config.js');
const isWorker = ('NODE_CDID' in process.env);
const isMaster = (isWorker === false);

util.inherits(libvp62Srv,fxNetSocket.clusterConstructor);

function libvp62Srv() {

    /* Variables */

    this.connections = []; //記錄連線物件

    /* rtmp config - Variables */
    this.rtmpConnectListener = false; //send request "connect" event to be received data.


    this.init();

    this.srv = this.initWebSocketSrv(config.srvOptions.port);
    
};


libvp62Srv.prototype.init = function () {
    this.initProcessEvent();
};
/**
 * 建立NodeJS Server
 * @param port
 * @returns {port}
 */
libvp62Srv.prototype.initWebSocketSrv = function (port) {
    var self = this;
    var server = new FxConnection(port,{runListen: isMaster});

    server.on('connection', function (client) {

        debug('Connection Clients name:%s (namespace %s)',client.name, client.namespace);
        if(client.namespace.indexOf("policy-file-request") != -1 ) {
            console.log('Clients is none rtmp... to destroy.');
            client.close();
            return;
        }
        self.setupFMSClient(client);

    });

    server.on('message', function (evt) {
        debug('message :', evt.data);
        var socket = evt.client;
        const sockName = socket.name;
        var data = evt.data;
        if (data.charCodeAt(0) == 123) {
            //object
            var json = JSON.parse(data);
            var event = json["event"];
            var _fms = self.connections[sockName].fms;
            //檢查fms有沒有被建立成功沒有就回傳失敗
            if (!_fms) {
                socket.write(JSON.stringify({"NetStatusEvent":"Connect.FMS.Failed"}));
                return;
            }

            /* ----------------------------------
             *        這邊是Websocket事件
             * ---------------------------------- */

            if (event == "Connect") {
                console.log('data', json["data"]);

            }else if (event == "close") {
                socket.close();

            }else if (event == "Send") {
                //測試用
                console.log('data', json["data"]);

                _fms.fmsCall("setObj",json["data"]);

            }else if (typeof event != 'undefined' && event != null && event != ""){

                _fms.fmsCall(event,json["data"]);

            } else {
                // todo call data
                console.log('[JSON DATA]', json);
                _fms.fmsCall( "serverHandlerAMF", json);
            };
        }else
        {
            /* 如果送出來了事件是字串的話會在這裡 */
        }

    });

    /** server client socket destroy **/
    server.on('disconnect', function (name) {
        debug('disconnect_fxconnect_client.');

        var removeItem = self.connections[name];

        if (typeof removeItem != 'undefined' && typeof removeItem.fms != 'undefined' && removeItem.fms) {

            removeItem.fms.socket.destroy();
            delete self.connections[name];

            console.log('disconnect count:', Object.keys(self.connections).length,typeof removeItem != 'undefined' , typeof removeItem.fms != 'undefined' );
        };

    });

    /**
     * client socket connection is http connect()
     * @param req: request
     * @param client: client socket
     * @param head: req header
     * **/
    server.on('httpUpgrade', function (req, client, head) {

        debug('## HTTP upgrade ##');
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
};

/**
 * 建立fms連線
 * @param client NetConnection自己封裝的Client
 */
libvp62Srv.prototype.setupFMSClient = function (client) {
    var _rtmp;
    var uri = {
        host:config.bFMSHost,
        port:config.bFMSPort,
        path:"rtmp://" + config.bFMSHost + ":" + config.bFMSPort + "/" + path.dirname(client.namespace),
        app:path.dirname(client.namespace),
        video:path.basename(client.namespace)
    };
    //建立FMS連線
    _rtmp = this.connect(uri, client);
    //設定一下名稱跟client一樣
    _rtmp.name = client.name;
    //存在array裡面方便讀取
    this.connections[client.name] = {ws:client, fms:_rtmp};
};

/**
 * 連線到伺服器
 * @param uri obj{host,port}
 * @param socket 連線client socket
 * @returns {RTMPClient}
 */
libvp62Srv.prototype.connect = function (uri, socket) {
    var self = this;
    var rtmp = undefined;
    // #1 建立連線
    rtmp = libRtmp.RTMPClient.connect(uri.host,uri.port, function (){
        debug("RTMPClient Connected!");
        //#1-1 送給Client連線成功
        if (socket.isConnect)
            socket.write(JSON.stringify({"NetStatusEvent":"Connected.amfIsReady"}));

        if (self.rtmpConnectListener) rtmp.connectResponse();

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
            capabilities: 239, // unknown
            audioCodecs: 3575, // audio code
            videoCodecs: 252, // video code
            videoFunction: 1,
            objectEncoding: 0
        });

        //完成後就可以自己送出要的事件

        rtmp.netStreamConnect(path.basename(uri.app)); //ex: play('ddabb');

    });;

    // #2 接收FMS訊息
    rtmp.on('message', function (message) {
        //檢查FMS訊息Type = 20(0x14 invoke message structure)
        if (message.messageHeader.messageType == 20) {
            //message 裡有Data結構為{commandName:FMS回傳的名稱(String), transactionId:傳輸編號(int),arguments:FMS回傳的變數(Array)};
            var data = message.data;
            var cmd = data.commandName;
            var tranId = data.transactionId;
            var argument = data.arguments;
            debug('INFO :: cmd:%s, argument:%s', cmd, argument);
            //這邊暫時忽略_result訊息
            if (cmd == "chk") {
                //
            } else if(cmd != '_result') {
                if (socket.isConnect)
                    socket.write(JSON.stringify({"NetStatusEvent":"Data","cmd":cmd, args:argument}));
            }else
            {
                // rtmp.setWindowACK(2500000);
            }
        };
    });

    rtmp.on('videoData', function (data) {
        if (socket.isConnect)
            socket.write(JSON.stringify({"NetStatusEvent":"Data","cmd":"videoData", args:data}));
    });

    // #3 FMS錯誤訊息事件
    rtmp.on("error", function (args) {
        console.log("RTMP ERROR", args);
    });
    // #4 FMS關閉的事件
    rtmp.on('close', function (args) {
        console.log("RTMP connection closed");
        if(socket.isConnect){
            socket.write(JSON.stringify({"NetStatusEvent":"Connected.Close"}));
            socket.destroy();
        }

    });
    // 沒有解析的資料
    rtmp.on('data', function (chunk) {
        // header長度
        var header_size = chunk.readUInt8(0);

        console.log('header_size:%d, number:%d', header_size, chunk.readInt32BE(14));

        if (chunk[0] == 0x02 && chunk.byteLength == 18) {
            console.log(chunk);
            var num = chunk.readInt32BE(14);
            rtmp.pingResponse(num);

        }
    });

    return rtmp;
};
/** cluster parent send message event **/
libvp62Srv.prototype.onMessage = function (data) {
    // libvp62Srv.super_.prototype.onMessage(data).apply(this,[data]);
    var self = this;
    var json = data;
    if (typeof json === 'string') {

    }else if(typeof json === 'object'){

        if (data.evt == "c_init") {

            debug("Conversion Socket.Hanlde from Child Process.");

            var socket = new net.Socket({
                handle:handle,
                allowHalfOpen:self.srv.app.allowHalfOpen
            });
            socket.readable = socket.writable = true;
            socket.server = self.srv.app;
            self.srv.app.emit("connection", socket);
            socket.emit("connect");
            socket.emit('data',new Buffer(data.data));
            socket.resume();
            return;
        }else if(data.evt == "processInfo") {

            process.send({"evt":"processInfo", "data" : {"memoryUsage":process.memoryUsage(),"connections": Object.keys(this.connections).length}})
        }else{
            debug('out of hand. dismiss message');
        };

    };

};


module.exports = exports = libvp62Srv;


var service = new libvp62Srv();

