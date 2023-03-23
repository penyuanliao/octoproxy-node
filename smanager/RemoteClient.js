const  net     = require("net");
const {Client} = require("../lib/RPCSocket.js");
const { IManagerConfig }  = require('../IConfig.js').getInstance();
const NSLog    = require("fxNetSocket").logger.getInstance();

/**
 * 與控制端連線服務
 */
class RemoteClient {
    constructor() {
        this.mode = IManagerConfig.client.mode;
        this.version = null;
        this.ctrl = undefined;
        this.progress = new Map();
        this.storageInfo = new Map();
        this.caches = new Set(['getServiceInfo', 'getSysInfo', 'getDashboardInfo']);
        this.setup();
    }
    /**
     * 初始化
     */
    setup() {
        if (this.mode === 'passive') {
            this.server = this.createPassiveServer();
        } else if (this.mode === 'active') {
            this.ctrl = this.active();
        }
        NSLog.info(' |- The connection method in manager is set as "%s mode".', this.mode);
    }
    /**
     * 建立被動監聽服務port
     * @return {*}
     */
    createPassiveServer() {
        const {port, host} = IManagerConfig.client.passive;
        const server = net.createServer(async (socket) => {
            const ctrl = await this.passive(socket);
            if (!ctrl) return false;
            NSLog.info(' |- Passive mode, the server connect to client port.');
        });
        server.listen(port, () => {
            NSLog.info(' |- client listen port %s', port);
        });
        return server;
    };
    /**
     * 主動連線到伺服器
     * @return {Client}
     */
    active() {
        let {host, port} = JSON.parse(JSON.stringify(IManagerConfig.client.active));
        let options = {
            host,
            port,
            delimiter:'\r\n'
        }
        const ctrl = new Client(this, options);
        ctrl.on("connect", async () => {
            let {version} = await this.getVersions();
            this.version = version;
            NSLog.info(' - Active mode, the client connect to server port:%s.', port);
        });
        return ctrl;
    };
    /**
     * 被動等待伺服器連線
     * @param socket
     * @return {Promise}
     */
    passive(socket) {
        return new Promise((resole) => {
            const ctrl = new Client(this, {
                host: '127.0.0.1',
                port: 8100,
                delimiter:'\r\n',
                bound: true
            });
            ctrl.once('connect', () => {
                resole(ctrl);
            });
            ctrl.on('close', () => {
                resole(false);
            });
            ctrl.connect(socket);
        });
    };
    /**
     * 發送訊息
     * @param params
     * @param {string} [params.method]
     * @return {Promise<*|boolean|*>}
     */
    async send(params) {
        if (!this.ctrl) return false;

        let method = params.method;
        if (this.caches.has(method)) {
            let cache = this.getCache(method);
            if (cache) return cache;
            let data = await this.ctrl.callAsync("targetEvent", params);
            this.setCache(method, data);
            return data;
        } else {
            return await this.ctrl.callAsync("targetEvent", params);
        }
    };
    /**
     * @private
     * @param method
     * @return {null|*}
     */
    getCache(method) {
        const {storageInfo} = this;
        if (storageInfo.has(method)) {
            let {time, data} = storageInfo.get(method);
            let expired = Math.floor((Date.now() - time) / 1000 ) >= 1;
            if (!expired) {
                return data;
            } else {
                storageInfo.delete(method);
            }
        }
        return null;
    };
    /**
     * @private
     * @param method
     * @param data
     */
    setCache(method, data) {
        const {storageInfo} = this;
        storageInfo.set(method, {
            time: Date.now(),
            data
        });
    };
    /**
     * @private
     * @param method
     * @param show
     */
    joinSteps({method, show}) {
        this.progress.set(method, show);
    };
    /**
     * @private
     * @param msg
     */
    progressSteps(msg) {
        const { method, step, done } = msg;
        if (this.progress.has(method)) {
            let show = this.progress.get(method);
            if (step) show(step);
            if (done) {
                this.progress.delete(method);
            }
        }
    };
    /**
     * @public
     */
    async getVersions() {
        return this.send({method: "versions"});
    }
}

module.exports = exports = RemoteClient;


return;
new RemoteClient();
// process.stderr.cursorTo(0);
// process.stderr.write("|||");
// process.stderr.clearLine(1);
var prettyjson = require('prettyjson');

var data = {
    username: 'rafeca',
    url: 'https://github.com/rafeca',
    twitter_account: 'https://twitter.com/rafeca',
    projects: ['prettyprint', 'connfu']
};

console.log(prettyjson.render(data, {
    keysColor: 'yellow',
    dashColor: 'magenta',
    stringColor: 'white'
}));