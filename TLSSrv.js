/**
 * Created by Benson on 2017/2/20.
 */
const fxNetSocket   = require('fxNetSocket');
const net           = require('net');
const tls           = require('tls');
const fs            = require('fs');
const FxConnection  = fxNetSocket.netConnection;
const parser        = fxNetSocket.parser;
const utilities     = fxNetSocket.utilities;
const ws            = fxNetSocket.WSClient;
const daemon        = fxNetSocket.daemon;
const NSLog         = fxNetSocket.logger.getInstance();
const proc = require("child_process");

var LOG_LEVEL = "debug";

NSLog.configure({logFileEnabled:true, consoleEnabled:true, level:LOG_LEVEL, dateFormat:'[yyyy-MM-dd hh:mm:ss]',fileName: "sample" ,filePath:__dirname, maximumFileSize: 1024 * 1024 * 100,
    id:process.argv[2], remoteEnabled: false});

function TLSSrv(opt) {
    this.cluster = this.createThread();
    if (opt.tlsEnabled) {
        this.createTLSServer(opt.tlsOptions);
    }
}
TLSSrv.prototype.createTLSServer = function (opt) {
    const self = this;
    const options = {};
    const listenOpt = {};
    if (!opt || !opt.certFile || !opt.certFile) {
        NSLog.log("error", "Not found cert file.");
        return false;
    }
    listenOpt.host = opt.host || "0.0.0.0";
    listenOpt.port = opt.port || 8000;
    options.rejectUnauthorized = opt.rejectUnauthorized || false;
    if (opt.keyFile) options.key = fs.readFileSync(opt.keyFile);
    if (opt.certFile) options.cert = fs.readFileSync(opt.certFile);
    console.log(options);
    const server = net.createServer(function (clone) {
        console.log('socket connect');
        // self.cluster.send({
        //     action: "tls"
        // }, clone);
        clone.on("data",function (chunk) {
            console.log('socket', chunk.toString());
        })
        clone.write("welcome!");
    });
    server.listen(8080);
    const tlsServer = tls.createServer(options, function onTlsIncoming(tlsSocket) {
        console.log('server connected',
            tlsSocket.authorized ? 'authorized' : 'unauthorized');
        const clone = new net.Socket();
        clone.pipe(tlsSocket);
        clone.connect(8080);

    });
    tlsServer.listen(listenOpt, function () {
        console.log('tls server bound');
    });
};

TLSSrv.prototype.createThread = function () {
};

TLSSrv.prototype.createClient = function () {
    const options = {
        port: 8000,
        host: "localhost",
        ca: [ fs.readFileSync('./auth/public-cert.pem') ]
    };
    const socket = tls.connect( options, () => {
        console.log('client connected',
            socket.authorized ? 'authorized' : 'unauthorized');
    });
    socket.setEncoding('utf8');
    socket.on('data', (data) => {
        console.log("Cli", data);
        socket.write("hi!");
    });

    socket.on('end', () => {
        console.log('Ended')
    });
};

const main = new TLSSrv({
    tlsEnabled: true,
    tlsOptions: {
        keyFile: "./auth/private-key.pem",
        certFile: "./auth/public-cert.pem"
    }
});

setTimeout(function () {
    main.createClient();
}, 1000);

