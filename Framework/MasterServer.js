/**
 * Created by Benson.Liao on 20/02/06.
 *
 * central server
 */
const net           = require("net");
const util          = require("util");
const EventEmitter  = require("events");
const Server        = require("../lib/RPCSocket.js").Server;

util.inherits(MasterServer, EventEmitter);
function MasterServer() {
    EventEmitter.call(this);
    this.initial();
    this.setup();
}

MasterServer.prototype.initial = function () {
    this.chain = new Map();
    this.trash = {};
};
MasterServer.prototype.setup = function () {
    const options = {
        port:(process.env.port ? process.env.port : 5213),
        web:true
    };
    this.createServer(options);
};
MasterServer.prototype.createServer = function (options) {
    this.server = new Server(this, options);

    this.server.expose("matchmaking", this.matchmaking.bind(this));
    //mismatched
    this.server.expose("broken", this.broken);
};
MasterServer.prototype.matchmaking = function (params, client, callback) {
    const uuid   = params.uuid;
    const token  = params.token;
    const userID = params.userID;
    const fd = params.fd;

    this.chain.set(uuid, {
        userID: userID,
        uuid: uuid,
        token: token,
        socket: client
    });

    callback(undefined, {result: true});

    console.log("#2matchmaking.write:", client.send({res:"done"}), client.socket instanceof net.Socket);

};
MasterServer.prototype.aborted = function (params, client, callback) {

};
MasterServer.prototype.broken = function (params, client, callback) {
    console.log(process.name);
};
MasterServer.prototype.recycle = function () {
    
};
module.exports = exports = MasterServer;

var main = new MasterServer();