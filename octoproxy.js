/**
 * Created by Benson.Liao on 2016/9/13.
 */
const IConfig = require('./IConfig.js');
let { compatibilityMode } = IConfig.StartAppArguments();
if (!compatibilityMode) compatibilityMode = 'octoKit2';
if (compatibilityMode === 'octoKit1') {
    const Config = require("./config.js");
    const AppDelegate = require('./AppDelegate.js');
    const main = new AppDelegate();
    if (Config["telegram"].enabled) {
        main.createTelegramBot(Config["telegram"].credentials, Config["telegram"].proxyMode);
    }
} else {
    const IDelegate = require('./IDelegate.js');
    const main = new IDelegate();
    const Config = IConfig.getInstance();
    const { enabled, credentials, proxyMode } = Config.telegram;
    console.log(`Telegram enabled: ${enabled}`);
    if (enabled) {
        main.createTelegramBot(credentials, proxyMode);
    }
}




