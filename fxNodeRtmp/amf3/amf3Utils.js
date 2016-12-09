/**
 * Created by Benson.Liao on 2016/11/13.
 */

const object = require("./ObjectType.js");
/**
 * @constructor Deserializer
 */
function Deserializer() {
    this.ref = null;
    this._referenceStrings = [];
    this._objectCount=0;
    this._referenceObjects = [];
    this._referenceDefinitions = [];
}

Deserializer.prototype.amf3Decode = function (buf) {
    this.buffer = buf;
    this.offset = 0;
    this._objectCount = 0;
    this._referenceStrings = [];
    this._referenceObjects = [];
    this._referenceDefinitions = [];
    return this.readTypeMarker();
};

Deserializer.prototype.readTypeMarker = function () {
    var typeMarker = this.readByte();
    switch (typeMarker){
        case AMF_Constants.AMF3_UNDEFINED:
        case AMF_Constants.AMF3_NULL:
            return null;
        case AMF_Constants.AMF3_BOOL_FALSE:
            return false;
        case AMF_Constants.AMF3_BOOL_TRUE:
            return true;
        case AMF_Constants.AMF3_INTEGER:
            return this.readInteger();
        case AMF_Constants.AMF3_NUMBER:
            return this.readDouble();
        case AMF_Constants.AMF3_STRING:
            return this.readString();
        case AMF_Constants.AMF3_DATE:
            return this.readDate();
        case AMF_Constants.AMF3_ARRAY:
            return this.readArray();
        case AMF_Constants.AMF3_OBJECT:
            return this.readObject();
        case AMF_Constants.AMF3_XML_DOC:
        case AMF_Constants.AMF3_XMLSTRING:
            return this.readXmlString();
        case AMF_Constants.AMF3_BYTEARRAY:
            return Buffer.from(this.readString());
        case AMF_Constants.AMF3_DICTIONARY:
            return this.readDictionArray();
        default:
            throw new Error("Unsupported type marker:"+ typeMarker, 4000);
    }

};
Deserializer.prototype.readByte = function () {
    var byte = this.buffer.readUInt8(this.offset++);
    return byte;
};
Deserializer.prototype.readDouble = function () {
    var d = this.buffer.readDoubleBE(this.offset);
    this.offset += 8;
    return d;
};
Deserializer.prototype.readInteger = function () {
    var count = 1;
    var intReference = this.readByte();
    var result = 0;
    while (((intReference & 0x80) != 0) && count < 4) {
        result <<= 7;
        result |= (intReference & 0x7f);
        intReference = this.readByte();
        count++;
    }
    if (count < 4) {
        result <<=7;
        result |= intReference;
    }else {
        result <<= 8;
        result |= intReference;

        if ((result & 0x10000000) != 0) {
            result != ~0xFFFFFFF;
        }
    }
    return result;
};
/**
 * Read and deserialize a string
 * Strings can be sent as a reference to a previously
 * occurring String by using an index to the implicit string reference table.
 * Strings are encoding using UTF-8 - however the header may either
 * describe a string literal or a string reference.
 * 0x06 string-data
 * @returns {*}
 */
Deserializer.prototype.readString = function () {

    var stringReference = this.readInteger();

    var length = stringReference >> 1;
    var string;
    //Check if this is a reference string
    // console.log(stringReference,(stringReference & 0x01),length);
    if ((stringReference & 0x01) == 0) {
        // reference string
        stringReference = length;
        if (stringReference >= this._referenceStrings.length) {
            throw new Error("Undefined string reference: " + stringReference, 4001);
        }
        // reference string found
        return this._referenceStrings[stringReference];
    }

    if (length) {
        string = this.buffer.slice(this.offset, this.offset+length).toString();
        this.offset += length;
        this._referenceStrings.push(string);
    }else {
        string = "";
    }

    return string;

};
/**
 * Read and deserialize a date
 * date = 0x08 integer-data [ number-data ]
 */
Deserializer.prototype.readDate = function () {
    var dateReference = this.readInteger();
    if ((dateReference & 0x01) == 0) {
        dateReference = dateReference >> 1;
        if (dateReference >= this._referenceObjects.length) {
            throw new Error('Undefined date reference: ' + dateReference);
        }else {
            return this._referenceObjects[dateReference];
        }
    }

    // var timestamp = Math.floor(this.readDouble() / 1000);
    var timestamp = this.readDouble();

    var date  = new Date();
    date.setTime(timestamp);

    this._referenceObjects.push(date);

    return date;

};
/**
 * Read amf array to js array
 *  - array = 0x09 integer-data ( [ 1OCTET *amf3-data ] | [OCTET *amf3-data 1] | [ OCTET *amf-data ] )
 */
Deserializer.prototype.readArray = function () {
    var arrayReference = this.readInteger();
    if ((arrayReference & 0x01) == 0) {
        arrayReference = arrayReference >> 1;
        if (arrayReference >= this._referenceObjects.length) {
            throw new Error('Unknown array reference: ' + arrayReference);
        }else {
            return this._referenceObjects[arrayReference];
        }
    }
    // Create a holder for the array in the reference list
    var data = [];
    var key = this.readString();

    // Iterating for string based keys.
    while (key != "" && typeof key != "undefined") {
        data[key] = this.readTypeMarker();
        key = this.readString();
    }

    arrayReference = arrayReference >> 1;

    //We have a dense array

    for (var i = 0; i < arrayReference; i++) {
        data.push(this.readTypeMarker());
    }

    this._referenceObjects.push(data);

    return data;
};
/**
 * Read an object from the AMF stream and convert it into a PHP object
 * Rather than using an array of traitsInfo create value
 * return {object|array}
 */
Deserializer.prototype.readObject = function () {
    var traitsInfo   = this.readInteger();
    var storedObject = (traitsInfo & 0x01) == 0;
    traitsInfo = traitsInfo >> 1;

    // Check if the Object is in the stored Objects reference table
    var ref, returnObject, storedClass;
    var className, encoding, propertyNames;
    var loader;
    if (storedObject) {
        ref = traitsInfo;
        returnObject = this._referenceObjects[ref];
        if (typeof returnObject === "undefined") {
            throw new Error("Unknown Object reference: " + ref);
        }

    }else {
        // Check if the Object is in the stored Definitions reference table
        storedClass = (traitsInfo & 0x01) == 0;
        traitsInfo = traitsInfo >> 1;
        if (storedClass) {
            ref = traitsInfo;
            if (typeof this._referenceDefinitions[ref] == "undefined") {
                throw new Error("Unknowns Definition reference: " + ref);
            }
            // Populate the reference attributes
            className     = this._referenceDefinitions[ref]["className"];
            encoding      = this._referenceDefinitions[ref]["encoding"];
            propertyNames = this._referenceDefinitions[ref]["propertyNames"];
        }else {
            // The class was not in the reference tables. Start reading rawdata to build traits.
            // Create a traits table. Zend_Amf_Value_TraitsInfo would be ideal
            className     = this.readString();
            encoding      = traitsInfo & 0x03;
            propertyNames = [];
            traitsInfo    = traitsInfo >> 2;
        }

        // We now have the object traits defined in variables. Time to go to work:
        if (!className || typeof className == "undefined") {
            // No class name generic object
            returnObject = {};
        } else {
            // Defined object
            // Typed object lookup against registered classname maps
            if (loader = TypeLoader.loadType(className)) {
                returnObject = new object[loader]();
            } else {
                //user defined typed object
                throw new Error("Typed object not found: ", className);
            }

        }

        var properties = [];
        var property;
        // Check encoding types for additional processing.

        if (encoding === AMF_Constants.ET_EXTERNAL) {
            // Externalizable object such as {ArrayCollection} and {ObjectProxy}
            if (!storedClass) {
                var extObj = [];
                extObj["className"]     = className;
                extObj["encoding"]      = encoding;
                extObj["propertyNames"] = propertyNames;
                this._referenceDefinitions.push(extObj);
            }
            returnObject["externalizedData"] = this.readTypeMarker();
        }
        else if (encoding === AMF_Constants.ET_DYNAMIC) {
            // used for Name-value encoding
            if (!storedClass) {
                var extObj = [];
                extObj["className"]     = className;
                extObj["encoding"]      = encoding;
                extObj["propertyNames"] = propertyNames;
                this._referenceDefinitions.push(extObj);
            }
            // not a reference object read name value properties from byte stream
            do {
                property = this.readString();
                if (property != "") {
                    propertyNames.push(property);
                    properties[property] = this.readTypeMarker();
                    // console.log('properties[%s]:', property, properties[property]);
                }
            } while (property != "");

        }
        else {
            // basic property list object.
            if (!storedClass) {
                var count = traitsInfo; // Number of properties in the list
                var i;
                for (i = 0; i < count; i++) {
                    propertyNames.push(this.readString());
                }
                // Add a reference to the class.
                var extObj = [];
                extObj["className"]     = className;
                extObj["encoding"]      = encoding;
                extObj["propertyNames"] = propertyNames;
                this._referenceDefinitions.push(extObj);
            }
            for (i = 0; i < propertyNames.length; i++) {
                property = propertyNames[i];
                properties[property] = this.readTypeMarker();
            }
        }

        // Add properties back to the return object.
        if (!(properties.constructor === Array || !(properties.constructor === Object))) {
            properties = [];
        }
        var keys = Object.keys(properties);
        for (i = 0; i < keys.length; i++) {
            var key = keys[i];
            var value = properties[key];

            if (typeof key != "undefined" && key != "") {
                returnObject[key] = value;
            }

        }


        // Add the Object to the reference table
        this._referenceObjects.push(returnObject);
    }

    if (returnObject instanceof object.ArrayCollection) {
        if(typeof returnObject['externalizedData'] != "undefined") {
            returnObject = returnObject["externalizedData"];
        }else {
            returnObject = returnObject;//get_object_vars php
        }
    }

    return returnObject;
};
Deserializer.prototype.readXmlString = function () {
    var xmlReference = this.readInteger();
    var length       = xmlReference >> 1;
    var string       = this.buffer.slice(this.offset, this.offset+length).toString();
    this.offset+=length;
    return string;
};

Deserializer.prototype.readDictionArray = function () {

    var dictArray = {};
    var key = 0;
    var typeMarker;
    do {

        dictArray[(key).toString()] = this.readTypeMarker();
        typeMarker = this.readByte();
        key = this.readByte();
        // console.log(typeMarker,key, this.readObject() >> 1);
    } while (typeMarker == AMF_Constants.AMF3_DICTIONARY);


    return dictArray;
};

function Serializer() {
    /**
     * An array of reference objects per amf body
     * @type {Array}
     * @private
     */
    this._referenceObjects = [];
    /**
     * An array of reference strings per amf body
     * @type {Array}
     * @private
     */
    this._referenceStrings = [];
    /**
     * An array of reference class definitions, indexed by classname
     * @type {Array}
     * @private
     */
    this._referenceDefinitions = [];
    this.ref = null;


    this.stream = new Buffer(1024);
    this.offset = 0;
}
Serializer.prototype.amf3Encode = function (data, markerType) {
    this.offset = 0;

    this._referenceDefinitions = [];
    this._referenceObjects = [];
    this._referenceStrings = [];
    this.cb = arguments[2];
    this.writeTypeMarker(data, markerType);
    return this.stream.slice(0, this.offset);
};
/**
 * Serialize PHP types to AMF3 and write to stream
 *
 * Checks to see if the type was declared and then either
 * auto negotiates the type or use the user defined markerType to
 * serialize the data from php back to AMF3
 *
 * @param data {string | number | object | array}
 * @param markerType {number | null}
 */
Serializer.prototype.writeTypeMarker = function(data, markerType) {
    var dataByVal = arguments[2];

    if (typeof markerType === "undefined") markerType = null;
    if (typeof dataByVal === "undefined") dataByVal = false;

    if (markerType === null && dataByVal !== false) {
        data = dataByVal;
    }
    if (markerType != null) {
        this.writeByte(markerType);
        switch (markerType) {
            case AMF_Constants.AMF3_NULL:
                break;
            case AMF_Constants.AMF3_BOOL_FALSE:
                break;
            case AMF_Constants.AMF3_BOOL_TRUE:
                break;
            case AMF_Constants.AMF3_INTEGER:
                this.writeInteger(data);
                break;
            case AMF_Constants.AMF3_NUMBER:
                this.writeDouble(data);
                break;
            case AMF_Constants.AMF3_STRING:
                this.writeString(data);
                break;
            case AMF_Constants.AMF3_DATE:
                this.writeDate(data);
                break;
            case AMF_Constants.AMF3_ARRAY:
                this.writeArray(data);
                break;
            case AMF_Constants.AMF3_OBJECT:
                this.writeObject(data);
                break;
            case AMF_Constants.AMF3_BYTEARRAY:
                this.writeByteArray(data);
                break;
            case AMF_Constants.AMF3_XMLSTRING:
                this.writeXml(data);
                break;
            case AMF_Constants.AMF3_DICTIONARY:
                this.writeDictionArray(data);
                break;
            default:
                console.error(new Error("Parser Exception Unknown type marker " + markerType));
        }
    } else {
        // Detect Type Marker
        var type = (typeof data);
        var construct = (data != null) ? data.constructor : null;
        if (typeof data == "undefined" || data == null) {
            markerType = AMF_Constants.AMF3_NULL;
        }
        else if (type === "boolean") {
            if (data) markerType = AMF_Constants.AMF3_BOOL_TRUE;
            else markerType = AMF_Constants.AMF3_BOOL_FALSE;
        }
        else if (isInt(data)) {
            if ((data > 0xFFFFFFF) || (data < -268435456)) {
                markerType = AMF_Constants.AMF3_NUMBER;
            }else {
                markerType = AMF_Constants.AMF3_INTEGER;
            }
        }else if (isFloat(data)) {
            markerType = AMF_Constants.AMF3_NUMBER;
        }else if (type === "string") {
            markerType = AMF_Constants.AMF3_STRING;
        }else if (construct === Array) {
            markerType = AMF_Constants.AMF3_ARRAY;
        }else if (construct === Object) {
            markerType = AMF_Constants.AMF3_OBJECT;
        }else if (construct === Date) {
            markerType = AMF_Constants.AMF3_DATE;
        }else if (construct == Buffer){
            markerType = AMF_Constants.AMF3_BYTEARRAY;
        }
        else if (markerType === AMF_Constants.AMF3_STRING && data.substr(0,5) == "<?xml") {
            markerType = AMF_Constants.AMF3_XMLSTRING;
        }
        this.writeTypeMarker(data, markerType);
    }


};
/**
 * Write an AMF3 integer
 * @param num {number | boolean}
 */
Serializer.prototype.writeInteger = function (num) {
    num &= 0x1fffffff;
    if ((num & 0xffffff80) == 0) {
        this.writeByte((num & 0x7f));
        return;
    }
    if ((num & 0xffffc000) == 0) {
        this.writeByte(((num >> 7) | 0x80) & 0xff);
        this.writeByte((num & 0x7f));
        return;
    }
    if ((num & 0xffe00000) == 0) {
        this.writeByte(((num >> 14) | 0x80) & 0xff);
        this.writeByte(((num >> 7) | 0x80) & 0xff);
        this.writeByte((num & 0x7f));
        return;
    }
    this.writeByte(((num >> 22) | 0x80));
    this.writeByte(((num >> 15) | 0x80) & 0xff);//

    this.writeByte(((num >> 8) | 0x80) & 0xff);//
    this.writeByte((num & 0xff));
};

/**
 * Send string to output stream
 * @param str {string}
 */
Serializer.prototype.writeString = function (str) {
    // if (typeof str == "undefined" && str && str === null) str = "";
    var len = str.length;
    if (!len) {
        this.writeInteger(0x01);
        return;
    }

    var ref = this._referenceStrings.indexOf(str);
    ref = (ref != -1) ? ref : false;

    if (ref === false) {
        this._referenceStrings.push(str);
        this.writeBinaryString(str);
    } else {
        ref <<= 1;
        this.writeInteger(ref);
    }
};
/**
 * Convert DateTime to AMF date
 * @param date {Date | number}
 */
Serializer.prototype.writeDate = function (date) {
    var timestamp;
    if (date.constructor === Date) {
        timestamp = date.getTime();
    } else {
        timestamp = date;
        date = new Date();
        date.setTime(timestamp);
    }

    if (this.writeObjectReference(date)) {

    }else {
        this.writeInteger(0x01);
        // write time to stream minus milliseconds
        this.writeDouble(timestamp);
    }
};
/**
 * Write a js array back to the amf output stream
 * @param arr {*}
 */
Serializer.prototype.writeArray = function (arr) {
    // arrays aren't reference here but still counted
    // this._referenceObjects.push(arr);
    var numeric = [];
    var string = [];
    var key,value,i;

    var keys = Object.keys(arr);
    console.log("AllKeys:",keys.length);
    var i = keys.length;

    while (i--) {
        key = Number(keys[i]);
        value = arr[i];

        if (isNaN(key) != true && isInt(key)) {
            numeric.push(value);
        } else {
            string[keys[i]] = value;
        }
    }

    // write the preamble id of the array

    var length = numeric.length;
    var id     = (length << 1) | 0x01;

    this.writeInteger(id);

    //Write the mixed type array to the output stream
    keys = Object.keys(string);
    // console.log("String:",keys.length);
    i = keys.length;
    while (i--) {
        key   = keys[i];
        value = string[i];
        this.writeString(key);
        this.writeTypeMarker(value, null);
    }

    //Write an empty string
    this.writeString(strEmpty);

    // console.log("Numeric:",numeric.length);
    // Write the numeric array to ouput stream
    i = numeric.length;
    while (i--) {
        this.writeTypeMarker(numeric[i], null);
    }
};
/**
 * Write object to ouput stream
 * @param obj {object}
 */
Serializer.prototype.writeObject = function (obj) {
    if (this.writeObjectReference(obj)) {
        return;
    }
    var className = "";
    //Check to see if the object is a typed object and we need to change
    if (className = TypeLoader.getMappedClassName(obj.constructor.name) != false) {
        // the return class mapped name back to actionscript class name.
    }else if (typeof obj["_explicitType"] != "undefined" && obj["_explicitType"] != "") {
        // Check to see if the user has defined an explicit Action Script type.
        className = obj["_explicitType"];
    }else if (typeof obj["getASClassName"] != "undefined") {
        // Check if user has defined a method for accessing the Action Script type
        className = obj.getASClassName();
    }else if (obj instanceof Object) {
        // No return class name is set make it a generic object
        className = "";
    }else {
        // By default, use object's class name
        className = obj.constructor.name;
    }

    var writeTraits = true;

    //check to see, if we have a corresponding definition
    if (typeof this._referenceDefinitions[className] != "undefined") {
        var traitsInfo    = this._referenceDefinitions[className]['id'];
        var encoding      = this._referenceDefinitions[className]['encoding'];
        var propertyNames = this._referenceDefinitions[className]['propertyNames'];

        traitsInfo = ((traitsInfo << 2) | 0x01);

        writeTraits = false;
    }else {
        propertyNames = [];
        var key,value,i;

        if (className == "") {
            //if there is no className, we interpret the class as dynamic without any sealed members
            encoding = AMF_Constants.ET_DYNAMIC;
        }else {
            encoding = AMF_Constants.ET_PROPLIST;

            var keys = Object.keys(obj);

            i = keys.length;
            while (i--) {
                key = keys[i];
                // value = obj[key];
                if (key.substr(0,1) != "_") {
                    propertyNames.push(key);
                }
            }

        }
        var count = Object.keys(this._referenceDefinitions).length;
        this._referenceDefinitions[className] = [];
        this._referenceDefinitions[className]["id"] = count;
        this._referenceDefinitions[className]["encoding"] = encoding;
        this._referenceDefinitions[className]["propertyNames"] = propertyNames;
        traitsInfo = AMF_Constants.AMF3_OBJECT_ENCODING;
        traitsInfo |= encoding << 2;
        traitsInfo |= (propertyNames.length << 4);
    }

    this.writeInteger(traitsInfo);


    try {

        if (writeTraits) {
            this.writeString(className);
            i = propertyNames.length;
            while (i--) {
                this.writeString(propertyNames[i]);
            }
        }
        if (encoding == AMF_Constants.ET_PROPLIST) {
            //Write the sealed values to the output stream.
            i = propertyNames.length;
            while (i--) {
                key = propertyNames[i];
                this.writeTypeMarker(obj[key], null);
            }

        } else if (encoding == AMF_Constants.ET_DYNAMIC) {
            //Write the sealed values to the output stream.
            var self = this;
            i = propertyNames.length;
            while (i--) {
                key = propertyNames[i];
                self.writeTypeMarker(obj[key], null);
            }
            //Write remaining properties
            keys = Object.keys(obj);

            i = keys.length;
            while (i--) {
                key = keys[i];
                value = obj[key];
                if (typeof propertyNames[key] == 'undefined' &&
                    (key.substr(0,1) != "_") ) {
                    this.writeString(key);
                    self.writeTypeMarker(value, null);
                }
            }

            //Write an empty string to end the dynamic part
            this.writeString(strEmpty);

        } else if (encoding == AMF_Constants.ET_EXTERNAL) {
            throw new Error("External Object Encoding not implemented");
        }else {
            throw new Error('Unknown Object Encoding type: ' + encoding);
        }

    }
    catch (e) {
        console.log("Unable to writeObject output: " + e);
    }

};
/**
 * Send ByteArray to output stream
 * @param data {*}
 * @return {*}
 */
Serializer.prototype.writeByteArray = function (data) {
    if (this.writeObjectReference(data)) {
        return;
    }
    if (typeof data === 'string') {
        //to buffer?
    }else if (data instanceof Buffer) {

    }else if (data instanceof DataView) {
        data = new Buffer(new Uint8Array(data.buffer));
    }else if (data instanceof ArrayBuffer) {
        data = new Buffer(new Uint8Array(data));
    }else {
        var err = new TypeError('Invalid ByteArray specified; must be a string or Zend_Amf_Value_ByteArray');
        err.name = "amf3Utils";
        console.log(err);
    }
    this.writeBinaryString(data);
};
/**
 * Send xml to output stream
 * @param xml{string}
 */
Serializer.prototype.writeXml = function (xml) {
    if (this.writeObjectReference(data)) {
        return;
    }

    if (xml.indexOf("<?xml") != -1) {

    } else {
        console.error("Invalid xml specified; must be a DOMDocument or SimpleXMLElement");
    }

    this.writeBinaryString(str);

};
Serializer.prototype.writeDictionArray = function (data) {
    // if (this.writeObjectReference(data)) {
    //     return;
    // }
    //d. 0a 0b 01 05 68..
    //d2.0a 01 07 68 69
    //1. 0a 01 00 04 01 01
    //2. 0a 01 02 04 02 01

    for (var i = 0; i < data.length; i++) {
        var obj = data[i];
        // this.writeByte(0x0a);
        // this.writeObject(obj);
        this.writeTypeMarker(obj, null);
        if (i < data.length-1) this.writeInteger(0x11);
    }

};

/**
 * Check if the given object is in the reference table, write the reference if it exists,
 * otherwise add the object to the reference table
 * @param object {object} object reference to check for reference
 * @return {boolean} true, if the reference was written, false otherwise
 */
Serializer.prototype.writeObjectReference = function (object) {
    var ref = this._referenceObjects.indexOf(JSON.stringify(object));
    ref = (ref != -1) ? ref : false;
    // quickly handle object references
    if (ref !== false) {

        ref <<= 1;
        this.writeInteger(ref);

        return true;
    }

    this._referenceObjects.push(JSON.stringify(object));
    return false;

};

Serializer.prototype.writeBinaryString = function (str) {
    var ref = Buffer.byteLength(str) << 1 | 0x01;
    this.writeInteger(ref);
    this.writeBytes(str);
};
Serializer.prototype.writeByte = function (data) {
    const len = 1;
    if (this.stream.length < (this.offset + len)) {
        this.stream = Buffer.concat([this.stream, new Buffer(len)], this.stream.length + len);
    }

    this.stream.writeUInt8(data, this.offset++);
};
Serializer.prototype.writeBytes = function (data) {
    var dataBuf = Buffer.from(data);
    var len = dataBuf.length;
    if (this.stream.length < (this.offset + len)) {
        this.stream = Buffer.concat([this.stream, dataBuf], this.stream.length + len);
    }
    if (data.constructor === Buffer) {
        this.stream.write(data.toString('hex'), this.offset, len, 'hex');
    }else {
        this.stream.write(data, this.offset, len);
    }

    this.offset += len;

};
Serializer.prototype.writeDouble = function (num) {
    const len = 8;
    if (this.stream.length < (this.offset + len)) {
        this.stream = Buffer.concat([this.stream, new Buffer(len)], this.stream.length + len);
    }

    this.stream.writeDoubleBE(num, this.offset);

    this.offset += 8;
};
Serializer.prototype.encodeDynamic = function (str) {
    var hex = Number(str.length).toString(16);
    var hexHeader = '00' + (hex.length % 2 == 1 ? "0":"") + hex;
    var buf = new Buffer(hexHeader, 'hex');
    var data = new Buffer(str);
    return Buffer.concat([buf, data], buf.length + data.length);
};
Serializer.prototype.MARKER_TYPE_MAP = {
    0x01:function () {},
    0x02:function () {},
    0x03:function () {},
    0x04:this.writeInteger,
    0x05:this.writeDouble,
    0x06:this.writeString,
    0x08:this.writeDate,
    0x09:this.writeArray,
    0x0A:this.writeObject,
    0x0C:this.writeByteArray,
    0x0B:this.writeXml,
    0x11:this.writeDictionArray
};

const AMF_Constants = {
    AMF3_UNDEFINED: 0x00,
    AMF3_NULL:      0x01,
    AMF3_BOOL_FALSE:0x02,
    AMF3_BOOL_TRUE: 0x03,
    AMF3_INTEGER:   0x04,
    AMF3_NUMBER:    0x05,
    AMF3_STRING:    0x06,
    AMF3_XML_DOC:   0x07,
    AMF3_DATE:      0x08,
    AMF3_ARRAY:     0x09,
    AMF3_OBJECT:    0x0A,
    AMF3_XMLSTRING: 0x0B,
    AMF3_BYTEARRAY: 0x0C,
    AMF0_AMF3:      0x11,
    AMF3_DICTIONARY: 0x11,
    AMF3_OBJECT_ENCODING: 0x03,

    // Object encodings for AMF3 object types
    ET_PROPLIST:    0x00,
    ET_EXTERNAL:    0x01,
    ET_DYNAMIC:     0x02,
    ET_PROXY:       0x03,
    FMS_OBJECT_ENCODING: 0x01

};

const strEmpty = "";

function isInt(n) {
    return Number(n) === n && n % 1 === 0;
    // return n % 1 === 0;
}
function isFloat(n) {
    return Number(n) === n && n % 1 !== 0;
}



/***
 *
 *  TypeLoader
 *
 * **/
TypeLoader.instance = null;

/**
 * Singleton getInstance definition
 * @return singleton class
 */
TypeLoader.getInstance = function () {
    if(this.instance === null) {
        this.instance = new TypeLoader();
    }
    return this.instance;
};
function TypeLoader() {
    this.callbackClass;
    this._resourceBroker = null;

}
TypeLoader.classMap = {
    "flex.messaging.messages.AcknowledgeMessage" : "AcknowledgeMessage",
    "flex.messaging.messages.AsyncMessage"       : "AsyncMessage",
    "flex.messaging.messages.CommandMessage"     : "CommandMessage",
    "flex.messaging.messages.ErrorMessage"       : "ErrorMessage",
    "flex.messaging.messages.RemotingMessage"    : "RemotingMessage",
    "flex.messaging.io.ArrayCollection"          : "ArrayCollection"
};
TypeLoader._defaultClassMap = {
    "flex.messaging.messages.AcknowledgeMessage" : "AcknowledgeMessage",
    "flex.messaging.messages.AsyncMessage"       : "AsyncMessage",
    "flex.messaging.messages.CommandMessage"     : "CommandMessage",
    "flex.messaging.messages.ErrorMessage"       : "ErrorMessage",
    "flex.messaging.messages.RemotingMessage"    : "RemotingMessage",
    "flex.messaging.io.ArrayCollection"          : "ArrayCollection"
};
TypeLoader.keys = [
    "flex.messaging.messages.AcknowledgeMessage",
    "flex.messaging.messages.AsyncMessage",
    "flex.messaging.messages.CommandMessage",
    "flex.messaging.messages.ErrorMessage",
    "flex.messaging.messages.RemotingMessage",
    "flex.messaging.io.ArrayCollection"
];
TypeLoader.values = [
    "AcknowledgeMessage",
    "AsyncMessage",
    "CommandMessage",
    "ErrorMessage",
    "RemotingMessage",
    "ArrayCollection"
];

/****
 * Looks up the supplied call name to its mapped class name
 * @param className
 * @returns {*}
 */
TypeLoader.getMappedClassName = function (className) {
    // search keys
    var mappedName = TypeLoader.keys[TypeLoader.values.indexOf(className)];

    if (mappedName && typeof mappedName != "undefined") {
        return mappedName;
    }
    // search values
    mappedName = TypeLoader.values[TypeLoader.keys.indexOf(className)];
    if (mappedName && typeof mappedName != "undefined") {
        return mappedName;
    }
    return false;
};
TypeLoader.loadType = function (className) {
    var cls = TypeLoader.getMappedClassName(className);
    if (typeof cls === "undefined" || !cls) {
        console.error('TypeLoader.loadType ', className);
    }
    return cls;

};
module.exports = exports = {
    deserializer:Deserializer,
    serializer:Serializer,
    AMF_Constants:AMF_Constants
};