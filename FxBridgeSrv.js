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

const FMS_Domain = "10.251.34.14";
//const FMS_Domain = "192.168.0.154";
const FMS_Port = 1935;
// const FMS_Domain = "43.251.76.111";
// const FMS_Port = 443;

var connections = [];
/****/

function connect(uri,socket) {

    var rtmp = undefined;

    rtmp = libRtmp.RTMPClient.connect(uri.host,uri.port, function (){
        debug("complete connected!");
        if (socket.isConnect)
            socket.write(JSON.stringify({"NetStatusEvent":"Connected.amfIsReady"}));



        // send connect event
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
        // init
        //rtmp.setWindowACK(2500000);
        //rtmp.setPeerBandwidth(2500000,2);
        //rtmp.setChunkSize(4000);

    });

    rtmp.on('message', function (message) {
        if (message.messageHeader.messageType == 20) {
            var data = message.data;
            var cmd = data.commandName;
            var tranId = data.transactionId;
            var argument = data.arguments;
            console.log('INFO :: cmd:%s, argument:%s', cmd, argument);
            if(cmd != '_result') {
                if (socket.isConnect)
                    socket.write(JSON.stringify({"NetStatusEvent":"Data","cmd":cmd, args:argument}));
            }
        };
    });
    rtmp.on("error", function (args) {
        console.log("RTMP ERROR", args);
    });
    rtmp.on('close', function (args) {
        console.log("RTMP connection closed");
    });

    return rtmp;
};

function Call(rtmp, commandName, obj){

    var s1 = new libRtmp.AMF.AMFSerialiser(commandName);
    var s2 = new libRtmp.AMF.AMFSerialiser(1);
    var data_buf = libRtmp.amfUtils.amf0Encode([{},obj]);
    var buf = new Buffer(s1.byteLength + s2.byteLength).fill(0x0);
    s1.write(buf.slice(0,s1.byteLength));
    s2.write(buf.slice(s1.byteLength,s1.byteLength + s2.byteLength));
    buf = Buffer.concat([buf, data_buf]);
    if (rtmp)
        rtmp.sendPacket(0x14, libRtmp.RTMPMessage.RTMP_MESSAGE_TYPE_INVOKE, buf);
    else
        connections[rtmp.name].write({"NetStatusEvent":"Connect.FMS.Failed"})
};

//utilities.autoReleaseGC(); //** 手動 10 sec gc
var server = new FxConnection(80);
server.on('connection', function (client) {
    debug('clients:%s - %s',client.name, client.namespace);

    setupFMSClient(client)

});

function setupFMSClient(client){
    var _rtmp;
    var uri = {
        host:FMS_Domain,
        port:FMS_Port,
        path:"rtmp://" + FMS_Domain + ":" + FMS_Port + client.namespace,
        app:client.namespace.substr(1,client.namespace.length)
    };
    //if (typeof json["data"] != 'undefined' || json["data"] != null || json["data"] != "") {
    //    uri = verificationString(json["data"]);
    //}else
    //{
    //    uri = {
    //        host:"10.251.40.14",
    //        port:1935,
    //        path:"rtmp://10.251.40.14/motest/g1",
    //        app:"motest/g1"
    //    };
    //}
    _rtmp = connect(uri, client);
    _rtmp.name = client.name;
    connections[client.name] = {ws:client, amf:_rtmp};
}

/** socket data event **/
server.on('message', function (evt) {
    debug('message :', evt.data);
    var socket = evt.client;

    var data = evt.data;
    if (data.charCodeAt(0) == 123) {
        //object
        var json = JSON.parse(data);
        var event = json["event"];
        if (event == "Connect") {
            console.log('data', json["data"]);


        }else if (event == "Send") {
            console.log('data', json["data"]);

            Call(connections[socket.name].amf, "setObj", json["data"]);
        }else if (typeof event != 'undefined' && event != null && event != ""){

            Call(connections[socket.name].amf, event, json["data"]);

        } else {
            // todo call data
            console.log('JSON DATA', json);
            Call(connections[socket.name].amf, "serverHandlerAMF", json);
        }
    }else
    {
        //string
    }

});

/** client socket destroy **/
server.on('disconnect', function (name) {
    debug('disconnect_fxconnect_client.');
    //socket.removeListener('connection', callback);
    var index = connections.indexOf(name);
    var removeItem;
    if (index > -1) removeItem = index.splice(index, 1);
    if (typeof connections[name] != 'undefined' && typeof connections[name].amf != 'undefined' && connections[name].amf) connections[name].amf.socket.destroy();
    delete connections[name];
});


/** verification **/
function verificationString(str) {
    var _path = str.match(/([a-z]+\:\/+)([^\/\s]*)([a-z0-9\-@\^=%&;\/~\+]*)[\?]?([^ \#]*)#?([^ \#]*)/i);

    if (typeof _path === 'undefined') return null;

    if (!_path[2]) return null;

    var url = String(_path[2]).split(":");

    if(!url[1]) url[1] = "443";


    var path = {
        host:url[0],
        port:url[1],
        path:_path[0],
        app:_path[3].substr(1,_path[3].length)
    };
    return path;
}

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

}
/* ------- ended testing logger ------- */

process.on('uncaughtException', function (err) {
    console.error(err.stack);
});