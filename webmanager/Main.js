const NSLog       = require('fxNetSocket').logger.getInstance();
const GeneralKit  = require('./lib/GeneralKit.js');
const { Command } = require('commander');

const cmd = new Command();
cmd.option('--proxy-mode', 'proxy manager server');
cmd.parse(process.argv);
let options = cmd.opts();

(function main() {
    NSLog.log("info",`main start()`, options);
    let {proxyMode} = options;
    GeneralKit.setLog({
        filePath: GeneralKit.getLogPath("historyLog"),
        fileName: (proxyMode ? "px-manager": "manager")
    });
    if (proxyMode == 2) {
        const ProxyServer = require('./lib/ProxyServer.js');
        const app = new ProxyServer();
    } else {
        const APIServer = require('./lib/APIServer.js');
        const app = new APIServer();
        app.on('gracefully-shutdown', (done, reject) => app.shutdown(done, reject));
    }
})();
