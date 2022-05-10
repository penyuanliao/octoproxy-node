/**
 * Created by Benson.Liao on 2016/6/7.
 */
const net          = require('net');
const uuid         = require('node-uuid');
const os           = require('os');
const events       = require('events');
const util         = require('util');
const sys          = os.platform();
const couchbase    = require('couchbase');
const viewQuery    = couchbase.ViewQuery;
const NSLog        = require('../index.js').logger.getInstance();
const noSQLs       = ["couchbase://192.168.188.205","couchbase://192.168.188.206","couchbase://192.168.188.207","couchbase://192.168.188.208"];
const noSQLs2      = ["couchbase://127.0.0.1"];
const BUCKET_TABLE = "nodeHistory";
const TTLMaximum   = 30 * 24 * 60 * 60;
util.inherits(cbConnect, events.EventEmitter); // 繼承事件

function cbConnect(options) {
    NSLog.log('info','init cbConnect');
    events.EventEmitter.call(this);
    this.services = options;
    this.cluster  = undefined;
    this.bucket   = undefined;
    this.cbPort   = 8787;
    this.sockServ = undefined;
    if (typeof options != "undefined" && typeof options.remote != "undefined" && options.remote == true) {
    } else {
        this.init();
    }
}

cbConnect.prototype.init = function () {
    var uri, bucketTable;

    if (typeof this.services == "undefined") {
        uri = noSQLs[parseInt(Math.random() * noSQLs.length)];
        if (process.env.NODE_DEV == "development") uri = noSQLs2[0];
    } else {
        uri = this.services.uri[parseInt(Math.random() * this.services.uri.length)];
    }

    if (typeof this.services == "undefined") {
        bucketTable = BUCKET_TABLE;
    } else {
        bucketTable = this.services.bucket;
    }

    NSLog.log('info', "create open Bucket connection try using %s.", uri);

    this.cluster = new couchbase.Cluster(uri);
    this.bucket  = this.cluster.openBucket(bucketTable);

    const DEFAULT_BUCKET = ["nodeHistory", "default"];
    this.dbBuckets = {};
    for (var i = 0 ; i < DEFAULT_BUCKET.length; i++) {
        var db = this.createBucket(DEFAULT_BUCKET[i] + "i", this.cluster, DEFAULT_BUCKET[i]);
        if (typeof this.dbBuckets[DEFAULT_BUCKET[i]] == "undefined") this.dbBuckets[DEFAULT_BUCKET[i]] = [];
        this.dbBuckets[DEFAULT_BUCKET[i]].push(db);
    }

};
cbConnect.prototype.createServer = function () {
    var self = this;

    var connected = function (socket) {
        NSLog.log('info','client connected to', self.getNOW);
        socket.chunkBuffer = null;
        socket.chunkBufSize = 0;

        socket.on('data', onRuleData);

        socket.on('end', onEnd);

        socket.on('error', onError);

    };
    var onRuleData   = function (data) {
        var socket = this;
        socket.removeListener("data", onRuleData);
        var json;

        var tmp = String(data).replace(/\0+/g, "");
        var mode = data.indexOf('\u0000') != -1 ? "flashSocket" : "socket";
        try {
            json = JSON.parse(tmp);
            if (typeof tmp == "string" && json.action == "setup") {

                socket.configure = {bucket:json.bucket, mode:mode, expiry:json.expiry, expiryTime:json.expiryTime};
                if (mode == "socket")
                    socket.on("data", onSocketData);
                else
                    socket.on('data', onData);
            } else {
                console.error(new Error("NOT_SETUP"));
            }
        } catch (e) {
            console.log(e);
            onData(data);
            socket.on('data', onData);
        }


    };
    var onData       = function (data) {
        self.onFlashSocketData(data, this);
    };
    var onSocketData = function (data) {
        self.onSocketData(data, this);
    };
    var onEnd        = function (err) {
        NSLog.log('info','end close....' + err);
        self.timeBiased = -1;
        // socket.end();
    };
    var onError      = function (error) {
        NSLog.log('info','code =>'+error.code);
        console.error(error);
    };
    var blockListen  = function (err) {
        if (err) throw err;
        NSLog.log('info','server bound port:', self.cbPort);
    };
    var s = net.createServer(connected);

    var srvError = function (err) {
        console.error("net.createServer error :", err);
        if (err.code === 'EADDRINUSE') {
            setTimeout(function () {
                server.close();
                server.listen(self.cbPort, blockListen);
            }, 3000)
        }
    };
    s.on('error', srvError);

    s.listen(self.cbPort, blockListen);
    self.sockServ = s;
    return s;
};
cbConnect.prototype.updateBuffer = function (socket, data) {
    // console.log('#2 length - ', data.length, data);
    if (!socket.chunkBuffer || socket.chunkBuffer == null || typeof socket.chunkBuffer == 'undefined'){
        //console.log('#1 ',socket.chunkBuffer, ((socket.chunkBuffer != null) ? socket.chunkBuffer.length : 0) );
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
cbConnect.prototype.onSocketData = function (data, socket) {
    this.updateBuffer(socket, data);
    var arr = socket.chunkBuffer.toString().match(/(\{.+?\})(?={|$)/g);

    for (var i = 0 ; i < arr.length; i++) {
        try {
            var one = arr[i];
            var len = Buffer.byteLength(arr[i]);

            var json = JSON.parse(one);
            socket.chunkBuffer = socket.chunkBuffer.slice(len, socket.chunkBuffer.length);
            socket.chunkBufSize -= len;
            if (typeof socket.configure.bucket != "undefined") {
                if (typeof socket.configure.expiry != "undefined" && socket.configure.expiry == true) {
                    var expiry = socket.configure.expiryTime;
                    if (expiry >= TTLMaximum) expiry = (new Date().getTime() + expiry);
                    this.threadRoutine2(socket,json, socket.configure.bucket, expiry);
                }else {
                    this.threadRoutine2(socket,json, socket.configure.bucket);
                }
            }

        } catch (e) {
            console.log(e);
        }
    }
};
cbConnect.prototype.onFlashSocketData = function (data, socket) {
    var self = this;
    self.updateBuffer(socket, data);

    var pos = socket.chunkBuffer.indexOf('\u0000');

    while (pos != -1) {

        if (pos != 0) {
            data = socket.chunkBuffer.slice(0,pos);
            socket.chunkBufSize -= data.byteLength;
            socket.chunkBuffer = socket.chunkBuffer.slice(data.byteLength, socket.chunkBuffer.length);

            var tmps = String(data).replace(/\0+/g, "");
            if (tmps.length > 0){
                var jsonObj = JSON.parse(tmps);

                if (jsonObj.ts && self.timeBiased != -1) {
                    self.timeBiased = new Date().getTime() - parseInt(jsonObj.ts);
                }
                jsonObj.nodeTs = new Date().getTime();
                jsonObj.nodeTimeBiased = self.timeBiased;

                if (typeof socket.configure.bucket != "undefined") {
                    if (typeof socket.configure.expiry != "undefined" && socket.configure.expiry == true) {
                        var expiry = new Date().getTime() + expiryValue;
                        this.threadRoutine2(socket, jsonObj, socket.configure.bucket, expiry);
                    }else {
                        this.threadRoutine2(socket, jsonObj, socket.configure.bucket);
                    }
                }
            }
        } else {
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
cbConnect.prototype.threadRoutine2 = function (socket, jsonObj, bucketName, expiry) {
    var group = this.dbBuckets[bucketName];
    var bucket = group[0]["db"];
    var guid = this.getGUID;


    if (typeof jsonObj.cmd != "undefined")
    {
        if (jsonObj.cmd == "get") {
            this.getOnBucket(socket, bucket, jsonObj.docName);
        } else if (jsonObj.cmd == "update") {
            this.updateOnBucket(socket, bucket, jsonObj.data, jsonObj.docName, jsonObj.expiry);
        }
        return;
    }


    var appendDocName = jsonObj["appendDocName"];
    var docName = jsonObj["docName"];

    if (typeof docName == "undefined") {
        if (typeof appendDocName != "undefined") {
            guid = guid + "-" + appendDocName;
            delete jsonObj["appendDocName"];
        }
        guid = guid +"-"+ new Date().getTime();
        docName = guid;

    } else {
        delete jsonObj["docName"];
    }
    console.log('insertOnBucket');
    this.insertOnBucket(socket,bucket, jsonObj, docName, expiry);
};
cbConnect.prototype.createBucket = function (id, cluster, bucketName) {
    var bucket  = cluster.openBucket(bucketName);
    bucket.on("error", function (err) {
    });
    var viewQuery = couchbase.ViewQuery;

    return {"id":id, "db":bucket, "cluster": cluster};
};
cbConnect.prototype.getOnBucket = function (client, bucket, docName) {
    bucket.get(docName, function (err, res) {
        if (err) {
            NSLog.log('info','insert failed id:%s err:', docName, err);
        }
        var json = {};
        json.cmd = "onGet";
        json.docName = docName;
        json.data = res["value"];
        json.event = (err) ? false:true;
        client.write(JSON.stringify(json));
    });
}
cbConnect.prototype.insertOnBucket = function (client, bucket, obj, docName, expiry) {
    var self = this;

    var block = function (err, result) {
        if (err){
            NSLog.log('info','insert failed id:%s err:', docName, err);
        }
        var json = {};
        json.cmd  = "insert";
        json.data = docName;
        json.event = (err) ? false:true;
        client.write(JSON.stringify(json));
    };
    if (typeof expiry != "undefined") {
        if (bucket.connected) bucket.insert(docName, obj, {expiry:expiry}, block);
    }else {
        if (bucket.connected) bucket.insert(docName, obj, block);
    }
};
cbConnect.prototype.updateOnBucket = function (client, bucket, obj, docName, expiry) {
    bucket.replace(docName, obj, function (err, res) {
        if (err) {
            NSLog.log('info','insert failed id:%s err:', docName, err);
        }
        var json = {};
        json.cmd = "onUpdate";
        json.docName = docName;
        json.data = res;
        json.event = (err) ? false:true;
        client.write(JSON.stringify(json));
    });
};

cbConnect.prototype.insert = function (obj, docName, expiry) {
    var self = this;
    var guid = this.getGUID;
    if (typeof docName != "undefined") guid = guid + "-" + docName;
    guid = guid +"-"+ new Date().getTime();
    var block = function (err, result) {
      if (err){
          NSLog.log('info','insert failed id:%s err:', guid, err);
      }
    };
    if (typeof expiry != "undefined") {
        if (this.bucket.connected) this.bucket.insert(guid, obj, {expiry:expiry}, block);
    }else {
        if (this.bucket.connected) this.bucket.insert(guid, obj, block);
    }

};
cbConnect.prototype.upsertSubDocument = function (obj, docName, field) {
    var self = this;
    var time = new Date();
    var keyTime = new Date(time.getFullYear(), time.getMonth(), time.getDate());
    keyTime.setHours(time.getHours());
    var timestamp = keyTime.getTime();
    var minBySec  = time.getTime() - keyTime.getTime();

    console.log(time ,timestamp, minBySec);
    //time.getFullYear() + "/" + (time.getMonth() + 1) + "/" + time.getDate() + "-" + time.getHours();
    var guid = timestamp.toString();
    var subKey = minBySec.toString();
    var block = function (err, result) {
        if (err){
            NSLog.log('info','insert failed id:%s err:', 1, err, field);
        }
    };
    var lookupInBlock = function (err, result) {
        if (err) {
            if (result.cas == "0" && result.contents[0].error.code === 63) {
                console.log(subKey + "." + field);
                self.bucket.mutateIn(guid).upsert(subKey, obj, true).execute(block)
            } else if ((!result.cas) == true) {

                var createData = {};
                createData[subKey] = obj;
                self.bucket.upsert(guid, createData, insertBlock);
            }
        } else {

        }


    };
    var insertBlock = function (err, result) {

    }
    this.bucket.lookupIn(guid).get(subKey + "." + field).execute(lookupInBlock)
    //if (this.bucket.connected) this.bucket.mutateIn(guid).upsert(field, obj, true).execute(block)
};

cbConnect.prototype.queryView = function (ddoc, name, skip, limit, stale, search, byGroup, query_cb) {
    //.range([2017,1,1],[2017,1,31],true);
    var self = this;
    var query = viewQuery.from(ddoc, name);

    if (typeof limit == "number" && limit != null) {
        query = query.limit(limit);
    }else {
        query = query.limit(100);
    }

    if (typeof stale == "number") {
        query = query.stale(stale);
    }

    if (Array.isArray(search) && search != null) {
        query = query.range.apply(query, search);
    }
    if (typeof skip == "number" && skip != null) {
        query = query.skip(skip);
    }else {
        query = query.skip(0);
    }
    if (typeof byGroup == "boolean" && byGroup != null) {
        query = query.group(byGroup);
    }
    else if (typeof byGroup == "number" && byGroup != null) {
        query = query.group(false).group_level(byGroup);
    }
    else {
        query = query.group(false);
    }
    // console.log(query);
    var bucket = this.bucket;

    if (typeof query_cb != "undefined") {
        bucket.query(query, query_cb);
    } else {
        bucket.query(query, function (err, results) {
            if (!err) {
                self.emit("queryResult", {"event":ddoc + "." + name,"result":results});
            }else {
                self.emit("queryError",err);
            }
        })
    }
};

cbConnect.prototype.__defineGetter__('getGUID', function () {
    return uuid.v4();
});
cbConnect.prototype.__defineGetter__('getNOW', function () {
    var d = new Date();
    return (d.getFullYear() + '/' + d.getMonth() + '/' + d.getDay() + ':' + d.getMinutes());
});

cbConnect.prototype.customByUser = function (event) {
    var len = event["result"].length;
    var groups = {};
    var data = {};
    while (len--) {
        var key = event["result"][len]["key"];
        var result = event["result"][len]["value"];
        var resultKey = Object.keys(result);
        for (var i = 0; i < resultKey.length; i++) {

            var group = groups[resultKey[i]];

            if (typeof group == "undefined") groups[resultKey[i]] = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
            var k = parseInt(key[3]);
            if (typeof groups[resultKey[i]][k] == "undefined") groups[resultKey[i]][k] = 0;
            groups[resultKey[i]][k] = Math.max(groups[resultKey[i]][k],result[resultKey[i]][0]);
            /*
            var date = key[2] + ":" + key[3];

            if (typeof data[date] == "undefined") {
                data[date] = {};
            }
            if (typeof data[date][resultKfey[i]] == "undefined") data[date][resultKey[i]] = 0;
            data[date][resultKey[i]] =  Math.max(data[date][resultKey[i]],result[resultKey[i]][0]);
            */
        }
    }
    return groups;
};


cbConnect.prototype.createRemote = function () {
    this.socket = this.initRemote(this.services);
};

cbConnect.prototype.initRemote = function (options) {

    var self = this;
    var sock = new net.Socket();
    sock.on("connect", function () {
        self.emit("connect");
    });
    sock.on("data", function (data) {
        self.updateBuffer(sock, data);
        var arr = sock.chunkBuffer.toString().match(/(\{.+?\})(?={|$)/g);
        for (var i = 0 ; i < arr.length; i++) {
            try {
                var one = arr[i];
                var len = Buffer.byteLength(arr[i]);

                var json = JSON.parse(one);
                sock.chunkBuffer = sock.chunkBuffer.slice(len, sock.chunkBuffer.length);
                sock.chunkBufSize -= len;

                self.emit("message", json);

            } catch (e) {
                console.log(e);
            }
        }
    });
    sock.on("error", function (err) {
        if (err) sock.destroy();
    });
    sock.on("close", function () {
        sock.connect(options.port, options.host);
    });
    sock.connect(options.port, options.host);

    return sock;
};
cbConnect.prototype.updateBuffer = function (socket, data) {
    // console.log('#2 length - ', data.length, data);
    if (!socket.chunkBuffer || socket.chunkBuffer == null || typeof socket.chunkBuffer == 'undefined'){
        //console.log('#1 ',socket.chunkBuffer, ((socket.chunkBuffer != null) ? socket.chunkBuffer.length : 0) );
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
cbConnect.prototype.send = function (message) {
    try {
        var json = JSON.stringify(message);

        if (this.socket && this.socket.writable && !this.socket.destroyed) {
            this.socket.write(json);
        }
    } catch (e) {

    }

};

module.exports = exports = cbConnect;
