/**
 * Created by Benson.Liao on 2016/11/7.
 * @constructor responder
 * @type responseID {string}
 */
function responder(result, status, self) {

    if (typeof self != "undefined" && self != null) {
        this.onResult = function () {
            result.apply(self,arguments);
        };
        this.onStatus = function () {
            status.apply(self,arguments);
        };
    }else {
        this.onResult = result;
        this.onStatus = status;
    }
}

responder.prototype.release = function () {
    this.onResult = undefined;
    this.onStatus = undefined;
};
/**
 * @namespace responseID
 */
responder.prototype.__defineSetter__("responseID", function (value) {
    this._responseID = value;
});
responder.prototype.__defineGetter__("responseID", function () {
    return this._responseID;
});
module.exports = responder;