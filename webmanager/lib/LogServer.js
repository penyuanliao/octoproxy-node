"use strict";
const net           = require("net");
const util          = require("util");
const EventEmitter  = require("events");
const PassThrough   = require("stream").PassThrough;
const NSLog         = require('fxNetSocket').logger.getInstance();
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
    /**
     * 初始化
     * @param port
     */
    setup(port) {
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
    createPassThrough(name) {
        let through;
        if (this.pipeline.has(name)) {
            through = this.pipeline.get(name);
        } else {
            through = new PassThrough();
            this.pipeline.set(name, through);
        }
        return through;
    };
    pushThrough(through, data) {
        through.write(data);
        through.resume();
    };
    bindThrough(name, socket) {
        let through = this.pipeline.get(name);
        if (through) {
            through.pipe(socket);
            return true;
        } else {
            return false;
        }
    };
    unbindThrough(name, socket) {
        let through = this.pipeline.get(name);
        if (through) {
            through.unpipe(socket);
            return true;
        } else {
            return false;
        }
    };
    broadcast(name, data) {
        //檢查是否有使用者檢視log
        if (this.clients.has(name)) {
            // NSLog.info('broadcast', name, this.clients.has(name));
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
    join(name, client) {
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
            NSLog.info('join', name, groupMap.size);
        }
        group.set(client, groupMap);
        if (!groupMap.has(client)) {
            groupMap.add(client);
        }
    };
    leave(name, client) {
        let group;
        let groupMap;
        if (this.clients.has(name)) {
            group = this.clients.get(name);
            groupMap = this.clientsMap.get(name);
            group.delete(client);
            groupMap.delete(client);
            NSLog.info('leave', name, groupMap.size);
            if (groupMap.size == 0) {
                this.clients.delete(name);
                this.clientsMap.delete(name);
            }

        }
    };
    clean() {

    };
    release() {

    };
}
module.exports = exports = LogServer;