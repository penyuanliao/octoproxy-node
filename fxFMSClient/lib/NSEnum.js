/**
 * Created by penyuan on 2016/4/27.
 */
function defineConstant(obj, name, value) {
    obj.__defineGetter__(name, function() { return value; });
}
function defineConstants(obj, dict) {
    for (key in dict)
        defineConstant(obj, key, dict[key]);
}


function NSEnum() {

};

/* ************************************************************************
 SINGLETON CLASS DEFINITION
 ************************************************************************ */

NSEnum.instance = null;

/**
 * Singleton getInstance definition
 * @return singleton class
 */
NSEnum.getInstance = function () {
    if(this.instance === null) {
        this.instance = new NSEnum();
    }
    return this.instance;
};
module.exports = NSEnum.getInstance();