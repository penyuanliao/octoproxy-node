var net = require('net');
//var jsonphp = require('./jsonPHP.js');
//var jphp = new jsonphp();

var couchbase = require('couchbase');
var cluster = new couchbase.Cluster('couchbase://127.0.0.1');
var bucket = cluster.openBucket('default');
var viewQuery = couchbase.ViewQuery;
const cbPort = 8787;

function logSocket(){
    console.log("logSocket start!!");

    this.counterList = []; //紀錄一下count
    this.timeBiased = -1;
    this.updateCount();
    this.start();

}

logSocket.prototype.insert = function(obj){
    var self = this;
    var ts = new Date().getTime().toString();
    for (var t in obj){
        console.log(t + '->'+obj[t]);
    }

    var nextIdNumber = this.counterList[obj["gameType"]];
    if (typeof nextIdNumber == 'undefined' || nextIdNumber == "" || nextIdNumber == null || isNaN(parseInt(nextIdNumber)) ) {
        this.counterList[obj["gameType"]] = nextIdNumber = 0;
    };
    nextIdNumber += 1;
    self.counterList[obj["gameType"]] = nextIdNumber;
    if (!nextIdNumber) nextIdNumber = 0;
    var prefix = obj["gameType"] + "_" + nextIdNumber;
    console.log('-------- insert %s --------', prefix);
    if (!obj["gameType"]) {
        console.error('Error LogObect has undefined gameType.');
        return;
    }
    bucket.insert(prefix ,obj, function(err,result){
        if (err){
            console.log('failed' , err);
            retry();
            return;
        }
        console.log('success!:' + result);
        // self.counterList[obj["gameType"]] = nextIdNumber;
        //process.exit(0);
    });


    function retry() {
        bucket.insert(prefix ,obj, function(err,result){
            if (err){
                console.log('retry failed' , err, JSON.stringify(obj));
                return;
            }

        });
    }

};
//gameType, gameCode,
logSocket.prototype.updateCount = function (cb) {
    // var key = gameType.toString() + gameCode.toString();
    var self = this;
    var query = viewQuery.from('count','autoCount');
    query.group(true);
    //query.limit(10);//.range(key,key,true);
    bucket.query(query, function (err, results) {
        for(var i in results) {
            self.counterList[results[i].key] = results[i].value;
        };
        if(cb) cb(results);
        console.log('result:', results);
    });

};
//#方法二 透過docment累加數字
logSocket.prototype.insertAutoIncrement = function (obj) {
    var prefix = "counter_" + obj["gameType"];

    bucket.get(prefix, function (err, res) {
        if (err) {
            console.log('operation failed:', err);
            
            init(prefix, function () {
                autoIncrement(prefix, function (err, result) {
                    if (err){
                        console.log('failed' , err);
                        return;
                    }
                    console.log('success!:'+result);
                });
            });
            
        }else{

            autoIncrement(prefix, function (err, result) {
                if (err){
                    console.log('failed' , err);
                    return;
                }
                console.log('success!:'+result);
            });

        }

    });
    
    function init(prefix, cb) {
        bucket.insert(prefix, 0, cb);
    }
    function autoIncrement(prefix, cb) {
        bucket.counter(prefix, 1, function (err, result) {
            bucket.insert(prefix + "_" + result.value ,obj, cb);
        });
    }

};


logSocket.prototype.start = function(){
    console.log('start!!');
    var self = this;
    var server = net.createServer(function (socket){
        //!!!! setEncoding onData event callback arg data is string not buffer...
        // socket.setEncoding("utf8");
        console.log('client connect!!'+this);

        socket.parent = this;
        socket.chunkBuffer = null;
        socket.chunkBufSize = 0;
        socket.on('data',function(data){

            // console.log('#2 length - ', data.length, data);
            if (!socket.chunkBuffer || socket.chunkBuffer == null || typeof socket.chunkBuffer == 'undefined'){
                // console.log('#1 ',socket.chunkBuffer, ((socket.chunkBuffer != null) ? socket.chunkBuffer.length : 0) );
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

            // console.log('#3 pos:', pos);

            while (pos != -1) {

                if (pos != 0) {
                    data = socket.chunkBuffer.slice(0,pos);
                    socket.chunkBufSize -= data.byteLength;
                    socket.chunkBuffer = socket.chunkBuffer.slice(data.byteLength, socket.chunkBuffer.length);

                    var tmps = String(data).replace(/\0+/g, "");
                    console.log(' tmps:' + tmps.length);
                    if (tmps.length > 0){
                        var jsonObj = JSON.parse(tmps);
                        console.log('jsonObj:'+jsonObj);

                        if (jsonObj.ts && self.timeBiased != -1) {
                            self.timeBiased = Math.abs(new Date().getTime() - Number(jsonObj.ts));
                        };
                        jsonObj.nodeTs = new Date().getTime();
                        jsonObj.nodeTimeBiased = self.timeBiased;


                        this.parent.parent.insert(jsonObj);
                    }
                }else {
                    socket.chunkBuffer = socket.chunkBuffer.slice(1, socket.chunkBuffer.length);
                    socket.chunkBufSize -= 1;
                }

                pos = socket.chunkBuffer.indexOf('\u0000');
            }

            console.log('socket.chunkBufSize:%d socket.chunkBuffer:%d', socket.chunkBufSize, socket.chunkBuffer.length);
            if (pos = 0 && socket.chunkBufSize == 1 || socket.chunkBuffer.length == 0) {
                socket.chunkBufSize = 0;
                socket.chunkBuffer = null;
            }

        });

        socket.on('end' , function(err){
            console.log('end close....' +err);
            self.timeBiased = -1;
            socket.end();
        });

        socket.write('welcome!!! \0 \n');

        socket.on('error' , function(error){            //error
            console.log('code =>'+error.code);
            console.error(error);
        })

    });
    server.parent = this;

    server.close (function(){
        console.log('server close!!');
    });

    server.listen(cbPort , function(err){
        if (err) throw err;
        console.log('server bound port:', cbPort);
    });
    server.on('error', function (err) {
        new Error("net.createServer error :", err.code);
        if (err.code == "EADDRINUSE") {
            debug('Info - Address in use, retrying...');
            setImmediate(function () {
                server.close();
                server.listen(cbPort , function(err){
                    if (err) throw err;
                    console.log('Info - server bound port:', cbPort);
                });
            },1000);
        }
    });

    var netserver = net.createServer(function(socket){
        socket.addListener("error",function(err){
            socket.end && socket.end() || socket.destroy && socket.destroy();
        });
        var xml = '<?xml version="1.0"?>\n<!DOCTYPE cross-domain-policy SYSTEM \n"http://www.adobe.com/xml/dtds/cross-domain-policy.dtd">\n<cross-domain-policy>\n';
        xml += '<site-control permitted-cross-domain-policies="master-only"/>\n';
        xml += '<allow-access-from domain="*" to-ports="*"/>\n';
        xml += '</cross-domain-policy>\n';
        if(socket && socket.readyState == 'open'){
            socket.write(xml);
            socket.end();
        }
    });
    netserver.addListener("error",function(err){
        console.log('netServer error ');
    });
    netserver.listen(cbPort, '0.0.0.0');
}


function onConnect(){
    console.log('Connect to flash!!')
}

module.exports = logSocket;

/*
 function error(){
 cache.get('a' , function(){
 throw new Error('something wrong');
 });
 }*/
var couch = new logSocket();

/** process state **/
process.on('uncaughtException', function (err) {
    console.error(err.stack);
});