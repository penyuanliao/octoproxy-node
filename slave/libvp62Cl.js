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
const isWorker = ('NODE_CDID' in process.env);
const isMaster = (isWorker === false);

util.inherits(libvp62Cl,fxNetSocket.clusterConstructor);

function libvp62Cl() {

    /* Variables */

    this.connections = []; //記錄連線物件

    /* rtmp config - Variables */
    this.rtmpConnectListener = true; //send request "connect" event to be received data.


    this.init();

    this.config = process.env.streamConfig;

    this.config = {
        bFMSHost:'183.182.79.162',
        bFMSPort:1935,
        videoPaths:["video/daabb/videosd"]
    };
    var videoPaths = this.config.videoPaths;
    
    for (var vPthNum = 0; vPthNum < videoPaths.length; vPthNum++ ) {
        this.setupFMSClient(videoPaths[vPthNum]);
        console.log('create stream');
    }
};

libvp62Cl.prototype.init = function () {
    this.initProcessEvent();
};

/**
 * 建立fms連線
 * @param client NetConnection自己封裝的Client
 */
libvp62Cl.prototype.setupFMSClient = function (namespace) {
    var _rtmp;
    var uri = {
        host:this.config.bFMSHost,
        port:this.config.bFMSPort,
        path:"rtmp://" + this.config.bFMSHost + ":" + this.config.bFMSPort + "/" + path.dirname(namespace),
        app:path.dirname(namespace),
        video:path.basename(namespace)
    };
    console.log(uri);
    //建立FMS連線
    _rtmp = this.connect(uri);

    _rtmp.name = namespace;
    //存在array裡面方便讀取
    if (!this.connections[namespace] || typeof this.connections[namespace] == 'undefined'
        || this.connections[namespace] == "" || this.connections[namespace] == null) {
        this.connections[namespace] = _rtmp;
    }else
    {
        debug("ERROR video of repeated impact to ", namespace);
    };

};

/**
 * 連線到伺服器
 * @param uri obj{host,port}
 * @param socket 連線client socket
 * @returns {RTMPClient}
 */
libvp62Cl.prototype.connect = function (uri) {
    var self = this;
    var rtmp = undefined;
    // #1 建立連線
    console.log('.', uri.host, uri.port);
    rtmp = libRtmp.RTMPClient.connect(uri.host,uri.port, function (){
        debug("RTMPClient Connected!");

        if (self.rtmpConnectListener) {
            rtmp.isVideoStream = true;
            rtmp.connectResponse();
            rtmp.on('status',function (cmd) {
                if (cmd.name == "connect_result") {
                    streamPlay()
                }
            })
        }

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

        function streamPlay() {
            rtmp.netStreamConnect(uri.video); //ex: play('ddabb');
        }

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
                debug('RTMP message event "chk":', message);

            } else if(cmd != '_result') {
                debug('RTMP message event "_result":', message);

            }else
            {
                debug('RTMP message event:', message);
            }
        };
    });

    rtmp.on('videoData', function (data) {

        if(isWorker) process.send({"evt":"videoData","namespace": rtmp.name, "data" : data});
    });

    // #3 FMS錯誤訊息事件
    rtmp.on("error", function (args) {
        console.log("RTMP ERROR", args);
    });
    // #4 FMS關閉的事件
    rtmp.on('close', function (args) {
        console.log("RTMP connection closed");
    });
    // 沒有解析的資料
    rtmp.on('data', function (chunk) {
        // header長度
        var header_size = chunk.readUInt8(0);
        
        // console.log('header_size:%d, number:%d', header_size, chunk.readInt32BE(14));

        if (chunk[0] == 0x02 && chunk.byteLength == 18) {
            console.log(chunk);
            var num = chunk.readInt32BE(14);
            rtmp.pingResponse(num);

        }
    });

    return rtmp;
};
/** cluster parent send message event **/
libvp62Cl.prototype.onMessage = function (data) {
    // libvp62Cl.super_.prototype.onMessage(data).apply(this,[data]);
    var self = this;
    var json = data;
    if (typeof json === 'string') {

    }else if(typeof json === 'object'){

        if (data.evt == "c_init") {

            debug("Conversion Socket.Hanlde from Child Process.");

            var socket = new net.Socket({
                handle:handle,
                allowHalfOpen:srv.app.allowHalfOpen
            });
            socket.readable = socket.writable = true;
            socket.server = srv.app;
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


module.exports = exports = libvp62Cl;


var service = new libvp62Cl();