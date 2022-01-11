"use strict";
const WebSocket = require("ws");
const http      = require("http");
const path      = require("path");
const util      = require("util");
const events    = require("events");
const querystring  = require('querystring');
const NSLog     = require('fxNetSocket').logger.getInstance();

/**
 * 
 * @constructor
 */
class ProxyServer extends events.EventEmitter {
    constructor() {
        super();
        this.appPath = true;
        this.service = {};
        this.service.web = this.createHTTPServer({listen: true, port:8001});
        this.service.wsServer = this.createWebsocketServer();
    }
    createHTTPServer({listen, port}) {
        const server = http.createServer((request, res) => {
            const {pathname, namespace, query} = this.urlParse(request.url);
            console.log(pathname, namespace, query);
            this.http_gateway({
                mode: "http",
                endpoint: res,
                stream: res,
                pathname: pathname,
                namespace: namespace,
                query: query,
                headers: request.headers
            });

        });

        server.on('close', () => {

        });

        if (listen) server.listen(port, () => {
            NSLog.log("info",'Web Service start listening port %s.', port);
        });

        return server;
    }
    createWebsocketServer() {
        const {web} = this.service;
        const wsServer = new WebSocket.Server({ noServer: true });

        wsServer.on("connection", (ws) => this.onWebSocketConnection(ws));

        web.on('upgrade', (request, socket, head) => {
            const {pathname, namespace, query} = this.urlParse(request.url);
            if (request.headers["upgrade"] == "websocket") {
                wsServer.handleUpgrade(request, socket, head, function done(ws) {
                    ws.pathname = pathname;
                    ws.namespace = namespace;
                    ws.query = query;
                    wsServer.emit('connection', ws, request);
                });
            } else {
                NSLog.log("debug",'http - upgrade');
                request.end();
            }
        });

        return wsServer;
    }
    onWebSocketConnection(ws) {
        const duplex = new WebSocket.createWebSocketStream(ws, { encoding: "utf8"});
        this.ws_gateway({
            mode: "ws",
            endpoint: ws,
            stream: duplex,
            pathname: ws.pathname,
            namespace: ws.namespace,
            query: ws.query
        });
    }
    /**
     * 分析路徑
     * @param url
     * @return {{namespace: string, pathname: string, query: object}}
     */
    urlParse(url) {
        const urls = new URL("http://127.0.0.1" + url);
        const pathname = urls.pathname;
        let urlParse    = path.parse(pathname);
        let namespace = util.format("%s%s/%s",
            (this.appPath ? "/" : ""),
            urlParse.dir.split("/").slice(2).join("/"),
            urlParse.name);
        if (namespace.substr(-1, 1) != "/") namespace += (this.appPath ? "/" : "");
        const query = urls.searchParams;//querystring.parse(urls.query)

        return {
            pathname,
            namespace,
            query
        }
    }

    /**
     * 連線倒轉
     * @param mode
     * @param endpoint
     * @param stream
     * @param pathname
     * @param namespace
     * @param query
     */
    async ws_gateway({mode, endpoint, stream, pathname, namespace, query}) {
        let host = "";
        if (query instanceof URLSearchParams) {
            host = query.get("host");
        } else {
            host = query.host;
        }
        console.log(`host`, host);
        let args = {
            host: host,
            port: 8000,
            endpoint,
            stream
        };
        if (host == "" || typeof host == "undefined" || host == null) {
            endpoint.send(JSON.stringify({
                result: false,
                error: "rejection: host is undefined."
            }));
            endpoint.close();
            return false;
        }
        let duplex = await this.proxyingManager("ws://127.0.0.1:8000");
        duplex.pipe(stream);
        stream.pipe(duplex);
        return true;
    }
    async http_gateway({mode, endpoint, stream, pathname, namespace, query, headers}) {

    };

    async proxyingManager(url) {
        return new Promise((resolve) => {
            const ws = new WebSocket(url, "admin");
            ws.on('open', () => {
                console.log(`open`);
                const duplex = WebSocket.createWebSocketStream(ws, { encoding: "utf8"});
                resolve(duplex);
            });
            ws.on('close', () => {
                console.log(`close`);
            });
            ws.on('message', (data) => {
                console.log(url, data.toString());
            });
        })

    }
    async start() {
        console.log('start');
        await this.proxyingManager("ws://127.0.0.1:8001?host=127.0.0.1");
    }
    clean() {
    }
    release() {
    }
}
module.exports = exports = ProxyServer;

const m = new ProxyServer();
// setTimeout(()=>m.start(), 1000);