"use strict";
const http   = require('http');
const net    = require('net');
const util   = require("util");
const events = require("events");
const {fork} = require('child_process');
/**
 * 
 * @constructor
 */
class test3 extends events.EventEmitter {
    constructor(port) {
        super();
        this.setup(port);
    }
    get isPrimary() {
        return !(process.send instanceof Function);
    }
    setup(port) {
        if (this.isPrimary) {
            this.child = this.forkCreate();
            this.web = this.primary(port)
        } else {
            this.web = this.secondary(port);
            this.ipcBonding();
        }
    }
    forkCreate() {
        let child = new fork(__filename, [], {silent: false});
        child.on('exit', (code, signal) => {
            console.info(`${__dirname} process will exit ${signal} ${code}`);
        });
        child.on('message', (data, handle) => {

        });
        return child;
    }
    forkSubmit(handle, data, cb) {
        let { child } = this;

        child.send({
            evt: 'c_init',
            mode: 'http',
            data
        }, handle, {silent: false}, () => {
            console.log('child.send completed');
            if (cb) cb();
        });
    }
    primary(port) {

        let web = net.createServer((socket) => {
            console.log(`primary-connection`);
            socket.once("data", (chunk) => {
                socket.pause();
                this.forkSubmit(socket._handle, chunk);
            })
            socket.on("close", (element) => {
                console.log('close');
            })
        });
        web.listen(port, () => {
            console.log('Web Service start listening port %s.', port);
        });
        return web;
    }
    secondary(port) {
        const web = http.createServer((req, res) => {
            console.log('secondary-connection');
            res.writeHead(200,{'Content-Type':'text/html'});
            res.write('<html><body>HelloWorld</body></html>');
            res.end();
        });
        web.name = 'secondary';
        return web;
    }
    ipcBonding() {
console.log(`------- ipcBonding -------
isPrimary: ${this.isPrimary}
web.name: ${this.web.name}
--------------------------`);
        process.on('message', (json, handle) => {
            let { evt, mode, data } = json;
            let { web } = this;
            if (evt === 'c_init') {
                console.log(`=> start socket mode ${mode}`);
                let socket = new net.Socket({handle});
                socket.server = (mode === 'http' ? null : web);
                web.emit("connection", socket);
                socket.emit("connect");
                socket.emit('data', Buffer.from(data));
                socket.resume();
            }
        })
    }
    clean() {
    }
    release() {
    }
}


(function main() {
    // let main = new test3(8081);
}());

function median(values){
    values.sort(function(a,b){
        return a-b;
    });
    var half = Math.floor(values.length / 2);

    if (values.length % 2)
        return values[half];
    else
        return (values[half - 1] + values[half]) / 2.0;
}

console.log(median([1,2,3,4]));
console.log(median([1,2,3,4,5]));