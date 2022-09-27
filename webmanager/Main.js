const xPath       = require('path');
const NSLog       = require('fxNetSocket').logger.getInstance();
const GeneralKit  = require('./lib/GeneralKit.js');
const { Command } = require('commander');

const cmd = new Command();
cmd.option('-m, --proxy-mode <number>', 'proxy manager server');
cmd.parse(process.argv);
let options = cmd.opts();

//管理端控制中心: 給客端連線用
(function main() {
    let {proxyMode} = options;

    GeneralKit.setLog({
        filePath: GeneralKit.getLogPath("historyLog"),
        fileName: (proxyMode ? "px-manager": "manager")
    });
    NSLog.info(`main start()`, options);

    if (proxyMode == 2) {
        const ProxyServer = require('./lib/ProxyServer.js');
        const app = new ProxyServer();
    } else {
        const configure = require('../IConfig.js').getInstance();
        const APIServer = require('./lib/APIServer.js');
        const app = new APIServer(configure);
        app.on('gracefully-shutdown', (done, reject) => app.shutdown(done, reject));
    }
})();