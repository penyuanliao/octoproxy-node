const  net     = require("net");
const {Client} = require("../lib/RPCSocket.js");
const IConfig  = require("./IManagerConfig.js");
const NSLog    = require("fxNetSocket").logger.getInstance();

/**
 * 與控制端連線服務
 */
class RemoteClient {
    constructor() {
        this.mode = IConfig.client.mode;
        this.ctrl = undefined;
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
        const {port, host} = IConfig.client.passive;
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
        let {host, port} = JSON.parse(JSON.stringify(IConfig.client.active));
        let options = {
            host,
            port,
            delimiter:'\r\n'
        }
        const ctrl = new Client(this, options);
        ctrl.on("connect", function () {
            NSLog.info(' - Active mode, the client connect to server port.');
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

    async send(params) {
        if (!this.ctrl) return false;
        return await this.ctrl.callAsync("targetEvent", params);
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