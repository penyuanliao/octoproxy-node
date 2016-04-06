/**
 * Created by Benson.Liao on 16/3/9.
 */
/**
 * Created by Benson.Liao on 15/12/9.
 * --always-compact: always full gc().
 * --expose-gc: manual gc().
 */

var debug = require('debug')('Live');
var fxNetSocket = require('./fxNetSocket');
var FxConnection = fxNetSocket.netConnection;
var parser = fxNetSocket.parser;
var utilities = fxNetSocket.utilities;
var libRtmp = require('./fxNodeRtmp').RTMP;
var connections = []; //記錄連線物件

var config = function () {

    if (!process.env.NODE_ENV){
        return {
            bFMSHost:"10.251.34.14",
            bFMSPort:1935,
            bNodePort:80
        };
    }else {
        //開發用
        return {
            bFMSHost:"43.251.76.26",
            bFMSPort:443,
            bNodePort:8000
        };
    }
}();

var srv = createNodejsSrv(config.bNodePort);


/**
 * 連線到伺服器
 * @param uri obj{host,port}
 * @param socket 連線client socket
 * @returns {RTMPClient}
 */
function connect(uri, socket) {

    var rtmp = undefined;
    // #1 建立連線
    rtmp = libRtmp.RTMPClient.connect(uri.host,uri.port, function (){
        debug("RTMPClient Connected!");
        //#1-1 送給Client連線成功
        if (socket.isConnect)
            socket.write(JSON.stringify({"NetStatusEvent":"Connected.amfIsReady"}));

        //LNX 11,7,700,203
        //MAC 10,0,32,18
        //MAC 11,8,800,94
        //WIN 11,3,372,94
        //#2-1 告訴FMS進行connect連線
        rtmp.sendInvoke('connect', 1, {
            app: uri.app,
            flashVer: "MAC 10,0,32,18",
            tcUrl: uri.path,
            fpad: false,
            capabilities: 15.0,
            audioCodecs: 0.0,
            videoCodecs: 0.0,
            videoFunction: 0.0
        });

        //完成後就可以自己送出要的事件
    });

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
            if(cmd != '_result') {
                if (socket.isConnect)
                    socket.write(JSON.stringify({"NetStatusEvent":"Data","cmd":cmd, args:argument}));
            }else
            {
                // rtmp.setWindowACK(2500000);
            }
        };
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
    rtmp.on('data', function (chunk) {
       if (chunk[0] == 0x02 && chunk.byteLength == 18) {
           console.log(chunk);
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
    var server = new FxConnection(port);

    server.on('connection', function (client) {

        debug('clients name:%s (namespace %s)',client.name, client.namespace);
        if(client.namespace.indexOf("policy-file-request") != -1 ) {
            console.log('is none rtmp...');
            client.destroy();
            return;
        }
        setupFMSClient(client);

    });

    server.on('message', function (evt) {
        debug('message :', evt.data);
        var socket = evt.client;

        var data = evt.data;
        if (data.charCodeAt(0) == 123) {
            //object
            var json = JSON.parse(data);
            var event = json["event"];
            var _fms = connections[socket.name].fms;
            //檢查fms有沒有被建立成功沒有就回傳失敗
            if (!_fms) {
                connections[rtmp.name].write({"NetStatusEvent":"Connect.FMS.Failed"});
                return;
            }

            /* ----------------------------------
             *        這邊是Websocket事件
             * ---------------------------------- */

            if (event == "Connect") {
                console.log('data', json["data"]);

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

        var removeItem = connections[name];



        if (typeof removeItem != 'undefined' && typeof removeItem.fms != 'undefined' && removeItem.fms) {

            removeItem.fms.socket.destroy();
            delete connections[name];
        };
        console.log('index', connections,typeof removeItem != 'undefined' , typeof removeItem.fms != 'undefined' );

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
}

/* ------- ended testing logger ------- */
/**
 * 程序錯誤會出現在這裡
 */
process.on('uncaughtException', function (err) {
    console.error(err.stack);
});