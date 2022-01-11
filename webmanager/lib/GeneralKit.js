"use strict";
const Path    = require('path');
const NSLog   = require('fxNetSocket').logger.getInstance();

/**
 *
 * @constructor
 */
function GeneralKit() {}

GeneralKit.getLogPath = function (pathName, root) {
    let segment = process.cwd().split(Path.sep);
    let val = "";
    if (!root) root = "octoproxy-node";
    while (segment.length > 0) {
        val = segment.pop();
        if (val === root) break;
    }

    if (segment.length === 0) {
        return `./${pathName}`;
    } else {
        return Path.resolve(segment.join(Path.sep), val, pathName);
    }
};
GeneralKit.setLog = function ({filePath, fileName}) {
    NSLog.configure({
        /* File for record */
        logFileEnabled:true,
        /* console log */
        consoleEnabled:true,
        /* quiet, error, warning, info, debug, trace, log */
        level:'debug',
        remoteEnabled: true,
        dateFormat:'[yyyy-MM-dd hh:mm:ss]',
        fileDateHide: true,
        filePath : filePath,
        /*filePath: undefined,*/
        /* lof filename */
        fileName: fileName,
        /* create file max amount */
        fileMaxCount: 0,
        /* sort : none, asc, desc */
        fileSort:"asc",
        maximumFileSize: 1024 * 1024 * 100});
}
module.exports = exports = GeneralKit;