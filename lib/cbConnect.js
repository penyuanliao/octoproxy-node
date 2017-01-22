/**
 * Created by Benson.Liao on 2016/6/7.
 */
const net = require('net');
const uuid = require('node-uuid');
const os   = require('os');
const sys = os.platform();
const couchbase = require('couchbase');
const NSLog     = require('fxNetSocket').logger.getInstance();
const noSQLs = ["couchbase://192.168.188.205","couchbase://192.168.188.206","couchbase://192.168.188.207","couchbase://192.168.188.208"];
const bucket = "nodeHistory";
function cbConnect() {
    NSLog.log('info','init cbConnect');
    this.cluster = undefined;
    this.bucket = undefined;
    this.cbPort = 8787;
    // this.server = this.createServer();
    this.init();
}

cbConnect.prototype.init = function () {
    var uri = noSQLs[parseInt(Math.random() * noSQLs.length)];
    NSLog.log('info', uri);
    this.cluster = new couchbase.Cluster(uri);
    this.bucket  = this.cluster.openBucket(bucket);
};
cbConnect.prototype.createServer = function () {
    var self = this;

    var connected = function (socket) {
        NSLog.log('info','client connected to', self.getNOW);
        socket.chunkBuffer = null;
        socket.chunkBufSize = 0;

        socket.on('data',onData);

        socket.on('end', onEnd);

        socket.on('error', onError);

        socket.write('welcome!!! \0 \n');

    };
    var onData = function (data) {

        var socket = this;

        if (!socket.chunkBuffer || socket.chunkBuffer == null || typeof socket.chunkBuffer == 'undefined'){
            // NSLog.log('info','#1 ',socket.chunkBuffer, ((socket.chunkBuffer != null) ? socket.chunkBuffer.length : 0) );
            socket.chunkBuffer = new Buffer(data);
        }else
        {
            if (socket.chunkBuffer.length == 0) {
                socket.chunkBuffer = new Buffer(data);
            }else
            {
                var total = socket.chunkBuffer.length + data.length;
                socket.chunkBuffer = Buffer.concat([socket.chunkBuffer,data], total);
            }
        }
        socket.chunkBufSize += data.length;

        var pos = socket.chunkBuffer.indexOf('\u0000');

        // NSLog.log('info','#3 pos:', pos);

        while (pos != -1) {

            if (pos != 0) {
                data = socket.chunkBuffer.slice(0,pos);
                socket.chunkBufSize -= data.byteLength;
                socket.chunkBuffer = socket.chunkBuffer.slice(data.byteLength, socket.chunkBuffer.length);

                var tmps = String(data).replace(/\0+/g, "");
                if (tmps.length > 0){
                    var jsonObj = JSON.parse(tmps);

                    if (jsonObj.ts && self.timeBiased != -1) {
                        self.timeBiased = Math.abs(new Date().getTime() - Number(jsonObj.ts));
                    };
                    jsonObj.nodeTs = new Date().getTime();
                    jsonObj.nodeTimeBiased = self.timeBiased;


                    self.insert(jsonObj);
                }
            }else {
                socket.chunkBuffer = socket.chunkBuffer.slice(1, socket.chunkBuffer.length);
                socket.chunkBufSize -= 1;
            }

            pos = socket.chunkBuffer.indexOf('\u0000');
        }

        if (pos = 0 && socket.chunkBufSize == 1 || socket.chunkBuffer.length == 0) {
            socket.chunkBufSize = 0;
            socket.chunkBuffer = null;
        }
    };
    var onEnd  = function (err) {
        NSLog.log('info','end close....' + err);
        self.timeBiased = -1;
        socket.end();
    };
    var onError = function (error) {
        NSLog.log('info','code =>'+error.code);
        console.error(error);
    };
    var blockListen = function (err) {
        if (err) throw err;
        NSLog.log('info','server bound port:', self.cbPort);
    };
    var server = net.createServer(connected);

    var srvError = function (err) {
        console.error("net.createServer error :", err);
        if (err.code === 'EADDRINUSE') {
            setTimeout(function () {
                server.close();
                server.listen(self.cbPort, blockListen);
            }, 3000)
        }
    };
    server.on('error', srvError);

    server.listen(self.cbPort, blockListen);

    return server;
};

cbConnect.prototype.insert = function (obj) {
    var self = this;
    var guid = this.getGUID +"-"+ new Date().getTime();
    var block = function (err, result) {
      if (err){
          NSLog.log('info','insert failed id:%s err:', guid, err);
      }
    };

    this.bucket.insert(guid, obj, block);

};

cbConnect.prototype.__defineGetter__('getGUID', function () {
    return uuid.v4();
});
cbConnect.prototype.__defineGetter__('getNOW', function () {
    var d = new Date();
    return (d.getFullYear() + '/' + d.getMonth() + '/' + d.getDay() + ':' + d.getMinutes());
});

module.exports = exports = cbConnect;

