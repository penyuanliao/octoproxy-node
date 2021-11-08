const ClientElasticsearch = require("../lib/ClientElasticsearch.js");
const elastic = new ClientElasticsearch({
    index: "hello"
});
// let ret = elastic.createIndex({
//     index: "hello"
// }, function (result) {
//     console.log("cb:",result);
// });
// ret = elastic.existsIndex("hello", function (result) {
//     console.log(result);
// })
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
    dateFormat:'yyyy-MM-dd hh:mm:ss',
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

    elasticOptions: {
        extensions: elastic
    },
    maximumFileSize: 50000});

const message = NSLog.entry("debug", {
        code: 10010101,
        message: "helloword22",
        status: "124",
        byebye: "yes",
    }
);
console.log(typeof message);
// console.log(elastic.bulk(message));
