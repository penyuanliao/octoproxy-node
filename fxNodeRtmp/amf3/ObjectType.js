/**
 * Created by Benson.Liao on 2016/11/12.
 */
const util = require('util');
util.inherits(AsyncMessage, AbstractMessage); // 繼承事件
util.inherits(AcknowledgeMessage, AsyncMessage); // 繼承事件
util.inherits(ErrorMessage, AcknowledgeMessage); // 繼承事件
util.inherits(CommandMessage, AsyncMessage); // 繼承事件
util.inherits(RemotingMessage, AbstractMessage); // 繼承事件

function AbstractMessage() {
    /**
     * Client identifier
     * @type {string}
     */
    this.clientId    = undefined;
    /**
     * Destination
     * @type {string}
     */
    this.destination = undefined;
    /**
     * Message identifier
     * @type {string}
     */
    this.messageId   = undefined;
    /**
     * Message timestamp
     * @type {number}
     */
    this.timestamp   = 0;
    /**
     * Message TTL
     * @type {number}
     */
    this.timeToLive  = 0;
    /**
     * Message headers
     * @type {{}}
     */
    this.headers     = {};
    /**
     * Message body
     * @type {string}
     */
    this.body        = undefined;
}
/**
 * generate a unique id
 * Format is: ########-####-####-####-############
 * Where # is an uppercase letter or number
 * example: 6D9DC7EC-A273-83A9-ABE3-00005FD752D6
 *
 * @return {string}
 */
AbstractMessage.prototype.generateId = function () {
    /**
     * @return {string}
     */
    function S4() {
        return (((1+Math.random())*0x10000)|0).toString(16).substring(1);
    }
    return (S4() + S4() + "-" + S4() + "-4" + S4().substr(0,3) + "-" + S4() + "-" + S4() + S4() + S4()).toUpperCase();
};
/**
 * current timestamp
 * @return {String} timestamp
 */
AbstractMessage.prototype.time = function () {
    return new Date().getTime().toString().substr(0,10) + '00';
};
/**
 *
 * @param message {String}
 * @constructor AcknowledgeMessage
 */
function AcknowledgeMessage(message) {
    // AsyncMessage.call(this);
    // console.log(this.constructor.name, "AcknowledgeMessage");

    this.clientId    = this.generateId();
    this.destination = null;
    this.messageId   = this.generateId();
    this.timestamp   = this.time();
    this.timeToLive  = 0;
    this.headers     = {};
    this.body        = null;

    this.correlationId = undefined;

    if (message && typeof message["messageId"] != "undefined") {
        this.correlationId = message["messageId"];
    }
}
/***
 * This type of message contains information necessary to perform
 * point-to-point or publish-subscribe messaging.
 * @constructor AsyncMessage
 */
function AsyncMessage() {
    AbstractMessage.call(this);
    // console.log(this.constructor.name, "AsyncMessage");
    /**
     * The message id to be responded to.
     * @type {string}
     */
    this.correlationId = undefined;

}
/**
 * A message that represents an infrastructure command passed between
 * @constructor CommandMessage
 */
function CommandMessage() {
    // console.log(this.constructor.name, "CommandMessage");
    AsyncMessage.call(this);
    const SUBSCRIBE_OPERATION = 0;
    const UNSUSBSCRIBE_OPERATION = 1;
    const POLL_OPERATION = 2
    const CLIENT_SYNC_OPERATION = 4;
    const CLIENT_PING_OPERATION = 5;
    const CLUSTER_REQUEST_OPERATION = 7;
    const LOGIN_OPERATION = 8;
    const LOGOUT_OPERATION = 9;
    const SESSION_INVALIDATE_OPERATION = 10;
    const MULTI_SUBSCRIBE_OPERATION = 11;
    const DISCONNECT_OPERATION = 12;
    const UNKNOWN_OPERATION = 10000;
    this.operation = UNKNOWN_OPERATION;
}
/**
 * Creates the error message to report to flex the issue with the call
 * @constructor ErrorMessage
 */
function ErrorMessage() {
    AcknowledgeMessage.call(this);
    // console.log(this.constructor.name, "ErrorMessage");
    /** Additional data with error **/
    this.extendedData = null;
    /** Error code number **/
    this.faultCode;
    /** Description as to the cause of the error **/
    this.faultDetail;
    /** Short description of error **/
    this.faultString = '';
    /** root cause of error **/
    this.rootCause = '';
}
/**
 * This type of message contains information needed to perform a Remoting invocation.
 * @constructor RemotingMessage
 */
function RemotingMessage() {

    AbstractMessage.call(this);

    // console.log(this.constructor.name, "RemotingMessage");

    this.source;
    this.operation;
    this.parameters;
    this.clientId = this.generateId();
    this.destination = null;
    this.messageId = this.generateId();
    this.timestamp = this.time();
    this.timeToLive = 0;
    this.headers = {};
    this.body = null;


}
/**
 * Type encapsulating Flex ArrayCollectio
 * @constructor ArrayCollection
 */
function ArrayCollection() {
    // console.log(this.constructor.name, "ArrayCollection");
}

function ObjectType() {

}

ObjectType.AcknowledgeMessage = AcknowledgeMessage;
ObjectType.AsyncMessage = AsyncMessage;
ObjectType.CommandMessage = CommandMessage;
ObjectType.ErrorMessage = ErrorMessage;
ObjectType.RemotingMessage = RemotingMessage;
ObjectType.ArrayCollection = ArrayCollection;
ObjectType.AbstractMessage = AbstractMessage;

module.exports = ObjectType;