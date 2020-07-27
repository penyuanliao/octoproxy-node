const fxNetSocket   = require('fxNetSocket');
const NSLog   = fxNetSocket.logger.getInstance();

NSLog.configure({
    /* File for record */
    logFileEnabled:false,
    /* console log */
    consoleEnabled:false,
    /* quiet, error, warning, info, debug, trace, log */
    level:'debug',
    /* Date format */
    dateFormat:'[yyyy-MM-dd hh:mm:ss]',
    /*  */
    filePath: "./historyLog",
    /*filePath: undefined,*/
    /* lof filename */
    fileName:'test',
    /* create file max amount */
    fileMaxCount:3,
    /* sort : none, asc, desc */
    fileSort:"desc",
    /** file show times **/
    fileDateHide: true,
    initClear: true,
    maximumFileSize: 50000});

NSLog.entry(
    "debug", {
        code: 10010101,
        messgae: "helloword"
    }
);