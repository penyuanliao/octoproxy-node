"use strict";
const net           = require("net");
const util          = require("util");
const EventEmitter  = require("events");
const PassThrough   = require("stream").PassThrough;
/**
 * 服務LOG導出到控制端
 * @constructor
 */
class LogServer extends EventEmitter {
    constructor(port) {
        super();
        this.inBound = new Map();
        this.pipeline = new Map();
        this.clients = new Map();
        this.clientsMap = new Map();
        this.setup(port);
    }
}
/**
 * 初始化
 * @param port
 */
LogServer.prototype.setup = function (port) {
    const server = net.createServer((socket) => {
        socket.once("data", (chunk) => {
            let data;
            let obj = {
                acknowledgement: 0,
                socket: socket
            };
            let inBound = this.inBound;
            try {
                data = JSON.parse(chunk.toString().toLowerCase());
                obj.name = data.id;
                obj.source = data.source;
                obj.sDomain = data.domain;
                obj.mode = 2;
            } catch (e) {
                obj.name = chunk.toString().toLowerCase();
                obj.mode = 1;
            }
            inBound.set(obj.name, obj);
            let through = this.createPassThrough(obj.name);
            socket.on("data", (chunk) => {
                obj.acknowledgement = socket.bytesWritten;
                let output = JSON.stringify({
                    event: 'liveLog',
                    name: obj.name,
                    log: chunk.toString()
                });
                this.pushThrough(through, output); //方法1
                this.emit("update", output); //方法2
                this.broadcast(obj.name, output); //方法3
            });
            //console.log(`Remote log ${obj.name} connected.`);
        });
    });

    server.listen(port, () => {
        console.log(`logServer listen: ${port}`);
    });
};
LogServer.prototype.createPassThrough = function (name) {
    let through;
    if (this.pipeline.has(name)) {
        through = this.pipeline.get(name);
    } else {
        through = new PassThrough();
        this.pipeline.set(name, through);
    }
    return through;
}
LogServer.prototype.pushThrough = function (through, data) {
    through.write(data);
    through.resume();
};
LogServer.prototype.bindThrough = function (name, socket) {
    let through = this.pipeline.get(name);
    if (through) {
        through.pipe(socket);
        return true;
    } else {
        return false;
    }
};
LogServer.prototype.unbindThrough = function (name, socket) {
    let through = this.pipeline.get(name);
    if (through) {
        through.unpipe(socket);
        return true;
    } else {
        return false;
    }
};
LogServer.prototype.broadcast = function (name, data) {
    //檢查是否有使用者檢視log
    if (this.clients.has(name)) {
        let group = this.clients.get(name);//檢查是否存在
        let groupMap = this.clientsMap.get(name);
        for (let client of groupMap.values()) {
            if (group.has(client)) {
                client.write(data);
            } else {
                groupMap.delete(client);
            }
        }
    }
};
LogServer.prototype.join = function (name, client) {
    let group;
    let groupMap;
    if (this.clients.has(name)) {
        group = this.clients.get(name);
        groupMap = this.clientsMap.get(name);
    } else {
        group = new WeakMap();
        groupMap = new Set();
        this.clients.set(name, group);//檢查clients是否移除
        this.clientsMap.set(name, groupMap);
    }
    group.set(client, groupMap);
    groupMap.add(client);
};
LogServer.prototype.leave = function (name, client) {
    if (this.clients.has(name)) {
        this.clients.delete(name);
        this.clientsMap.delete(name);
    }
};
LogServer.prototype.clean = function () {
};
LogServer.prototype.release = function () {

};
module.exports = exports = LogServer;