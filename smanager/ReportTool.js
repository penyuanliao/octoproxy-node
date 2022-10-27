"use strict";
const events      = require("events");
const Path        = require('path');
const crypto      = require('crypto');
const {NetSocket} = require("../lib/NetSocket.js");
const NSLog       = require('fxNetSocket').logger.getInstance();
/**
 * influx db
 * @constructor
 */
class ReportTool extends events.EventEmitter {
    constructor(src) {
        super();
        this.filepath = this.getPath(src);
        this.hostname = require("os").hostname().replace(/\./g, "-");
    }
    getPath(src) {
        let directory = process.cwd();
        let root = (process.send instanceof Function) ? "../../" : "../";
        if (!src) src = 'configuration/InfluxDB.json';
        return Path.join(directory, root, src);
    }
    start() {
        let {
            enabled,
            influxDB_IP,
            influxDB_Port
        } = require('fxNetSocket').getConfig(this.filepath).pipelines;
        NSLog.info(JSON.stringify({
            message: 'Report-InfluxDB-Configure',
            enabled,
            host:influxDB_IP,
            port: influxDB_Port
        }, null, '\t'));
        NSLog.info(`Start create Reporting influxDB enabled => ${enabled}`);
        if (enabled) {
            if (this.reporting) this.reporting.close();
            this.reporting = this.createConnect({
                port: influxDB_Port,
                host: influxDB_IP
            });
        }
        return this;
    }
    /**
     *
     * @param options
     * @param options.host
     * @param options.port
     */
    createConnect(options) {

        let reporting = new NetSocket(options);
        reporting.on('connect', (element) => {
            NSLog.info('Reporting influxDB is Connection. [ ON ]');
            reporting.send({action: 'setup', cluID: `${this.hostname}-${process.pid}`});
        });
        reporting.on('failure', (err) => {
            NSLog.error(`Reporting connection failed error code ${err.errno} (${err.code})`);
        })
        reporting.on('close', () => {
            NSLog.warning('Reporting connection closed.');
            this.onClosed();
        })
        reporting.connect();
        return reporting;
    }
    submit(data) {
        let report = {
            action: 'process',
            data: {}
        };
        report.data[this.hostname] = data;

        if (this.reporting) {
            this.reporting.send(JSON.stringify(report));
        }
    }
    onClosed() {

    }
    clean() {
    }
    release() {
    }
}
module.exports = exports = ReportTool;