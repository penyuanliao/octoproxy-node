/**
 * Created by Benson.Liao on 16/3/17.
 */
var fxNetSocket = require('./fxNetSocket');
var logger = require('./logger');
/** Customize Socket Server **/
var FxConnection = fxNetSocket.netConnection;
/** 解析http用 **/
var parser = fxNetSocket.parser;
/** 建立RTMP Server **/
var libRtmp = require('./fxNodeRtmp').RTMP;
/** 紀錄連線物件 **/
var connections = [];
// ============================================== //
//               NodeJS Server Start              //
// ============================================== //
/** 建立連結的websocket server **/
var server = new FxConnection(port);

server.on('connection', function (client) {

    // 連線成功會在這裡 //

    console.log('Connection');

});

server.on('message', function (evt) {

    // socket, flashsocket, websocket 傳送的訊息會在這裡出現 //

    // evt:{ client:fxsocket, data:chunk }

};

server.on('disconnect', function (name) {
   // socket被停止會出現在這裡 //
};

server.on('httpUpgrade', function (req, client, head) {
    // http 事件會出現在這裡 //
};

// ============================================== //
//          RTMP Client Connection Start          //
// ============================================== //
/** 連線成功建立RTMP **/
function setupFMSClient(host, port, namespace) {
    var _rtmp;
    var uri = {
        host:host,
        port:port,
        path:"rtmp://" + host + ":" + port + namespace,
        app:client.namespace.substr(1,namespace);
    };
    //建立FMS連線
    _rtmp = connect(uri, client);
    //設定一下名稱跟client一樣
    _rtmp.name = client.name;
    //存在array裡面方便讀取
    connections[client.name] = {ws:client, fms:_rtmp};


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
            // 連線成功後會在這裡 //
            // 建立RTMP connect //
            rtmp.sendInvoke('connect', 1, {
                app: uri.app,
                flashVer: "MAC 10,0,32,18",
                tcUrl: uri.path,
                fpad: false,
                capabilities: 15.0,
                audioCodecs: 0.0,
                videoCodecs: 252.0,
                videoFunction: 1.0
            });
            //完成後就可以自己送出要的事件
        });

        // #2 接收FMS訊息
        rtmp.on('message', function (message) {
            //檢查FMS訊息Type = 20(0x14 invoke message structure)
            if (message.messageHeader.messageType == 20) {
                //message 裡有Data結構為{commandName:FMS回傳的名稱(String), transactionId:傳輸編號(int),arguments:FMS回傳的變數(Array)};
                var data = message.data;
                var cmd = data.commandName;//FMS 傳送的事件
                var tranId = data.transactionId;//FMS傳送的通道
                var argument = data.arguments;//FMS傳送的參數
            };

            //#3 送出訊息
            // rtmp.fmsCall(<(String)commandName>, <(Object)Data>);
        });
        // #3 FMS錯誤訊息事件
        rtmp.on("error", function (args) {
            console.log("RTMP ERROR", args);
        });
        // #4 FMS關閉的事件
        rtmp.on('close', function (args) {
            console.log("RTMP connection closed");
        });

        return rtmp;
    };


}

