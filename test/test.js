const fxNetSocket   = require('fxNetSocket');
const net           = require('net');
const FxConnection  = fxNetSocket.netConnection;
const parser        = fxNetSocket.parser;
const utilities     = fxNetSocket.utilities;
const fxSocket     = fxNetSocket.WSClient;
const daemon     = fxNetSocket.daemon;
function create() {
    var server = new FxConnection(8000,{runListen: false});
    var self = this;
    server.on('connection', function (client) {

        console.log('info','Connection Clients name:%s (namespace %s)',client.name, client.namespace);
        // client.write(JSON.stringify())
    });

    server.on('message', function (evt) {
        console.log('debug','message :', evt.data);

    });
    server.on('disconnect', function (name) {
        console.log('debug','disconnect :', name);
    });

    return server;
}
var srv = create();

// const host = "127.0.0.1";
// const host = "103.241.238.149";
const host = "103.241.238.126";
const port = 80;

var s = new net.connect( port, host, function () {
    console.log('connect2');
    s.write(JSON.stringify({
        action:"setup",
        uuid:'0',
        cluID: '2ntt.1jrjbu1',
        delimiter: '\r\n',
        balance:"/fxLive/fxLB?gameType=fetchWager"}));
    // s.write("\0");
});
// s.write(JSON.stringify({"action":"setup", "delimiter": "\r\n"}));

const headers = {
    "X-Forwarded-For": "203.0.113.195"
};


const xff = headers["X-Forwarded-For"].replace(/\s+/g, '');
const xffSplit = xff.split(",");
console.log(xff);
console.log("'%s'", (xffSplit.length > 1) ? xffSplit[xffSplit.length - 1] : xff);