const Path    = require('path');
const NSLog   = require('fxNetSocket').logger.getInstance();
const Manager = require('./views/Website');
const Manager2 = require('./lib/RestManager.js');
// const APIServer = require('./lib/APIServer.js');

NSLog.configure({
    logFileEnabled:true,
    consoleEnabled:true,
    level:'trace',
    dateFormat:'[yyyy-MM-dd hh:mm:ss]',
    filePath:Path.join(process.cwd(), "../historyLog"),
    id:"admin",
    remoteEnabled: false,
    /*console:console,*/
    trackBehaviorEnabled: false, // toDB server [not implement]
    maximumFileSize: 1024 * 1024 * 100});

(function main() {
    const APIServer = require('./lib/APIServer.js');
    this.app = new APIServer();
})();
