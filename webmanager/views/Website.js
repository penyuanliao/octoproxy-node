"use strict";

const net           = require("net");
const util          = require("util");
const EventEmitter  = require("events");
const NSLog         = require('fxNetSocket').logger.getInstance();
const express       = require("express");
const bodyParser    = require('body-parser');
const ejs = require('ejs');

/**
 * 管理介面
 * @constructor
 */
class Website extends EventEmitter {
    constructor() {
        super();
        this.app = this.createHttpServer();
    }
    createHttpServer() {
        var app = express(); //建立Express個體

        app.set('port', 8001);
        app.use(bodyParser.json()); // support json encoded bodies
        app.use(bodyParser.urlencoded({ extended: true })); // support encoded bodies
        app.use('/css', express.static(__dirname + '/css'));
        app.use('/fonts', express.static(__dirname + '/fonts'));
        app.use('/js', express.static(__dirname + '/js'));
        app.set('views', __dirname + '/html');
        /*
        //ejs
        app.set("view options", {
            openDelimiter: "{{",
            delimiter: " ",
            closeDelimiter: "}}"
        });
        app.set('view engine', 'ejs');
        app.get('/', function(req, res) {
            res.render('index', {hidden:"hidden", title: "12345"});

        });
         */
        this.setPug(app);

        return app;
    }
    setPug(app) {
        app.set('view engine', 'pug');
        app.get('/', (req, res) => {
            res.render('index', {user: "pug", mode: 'http'});
        })
    }
}

Website.prototype.setup = function () {
    console.log('create');
};
Website.prototype.start = function (port) {
    this.app.listen(port);
    // this.app.listen(app.get('port'));
}


Website.prototype.clean = function () {

};
Website.prototype.release = function () {

};

Website.prototype.binding = function ({wsServer, httpServer}) {
    /** process state **/
    process.on('uncaughtException', function (err) {
        console.error(err.stack);
        NSLog.log('error', 'uncaughtException:', err.stack);
    });
}

module.exports = exports = Website;