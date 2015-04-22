var _ = require('lodash'),
    validator = require('validator'),
    validators = {
        //types
        'string': _.isString,
        'integer': validator.isInt,
        'decimal': validator.isFloat,
        'numeric': validator.isNumeric,
        'boolean': _.isBoolean,
        'email': validator.isEmail,
        'url': validator.isURL,
        'datetime': validator.isDate,
        'array': _.isArray,
        'object': _.isObject,
        'json': function (x) {
            //json is not object. it is serialized object.
            if (_.isUndefined(x)) return false;
            try {
                JSON.parse(x);
            }
            catch (err) {
                return false;
            }
            return true;
        },

        //validators
        'minLength': function (x, min) {
            return validator.isLength(x, min);
        },
        'maxLength': function (x, max) {
            return validator.isLength(x, 0, max);
        },
        'after': validator.isAfter,
        'before': validator.isBefore,
        'contains': validator.contains,
        'notContains': function (x, str) {
            return !validator.contains(x, str);
        },
        'in': validator.isIn,
        'notIn': function (x, arrayOrString) {
            return !validator.isIn(x, arrayOrString);
        },
        'max': function (x, val) {
            var number = parseFloat(x);
            return isNaN(number) || number <= val;
        },
        'min': function (x, val) {
            var number = parseFloat(x);
            return isNaN(number) || number >= val;
        },
        'regex': function (x, regex) {
            return validator.matches(x, regex);
        },
        'notRegex': function (x, regex) {
            return !validator.matches(x, regex);
        },
        'notNull': function (x) {
            return !validator.isNull(x);
        },

        //operators
        'required': function (x) {
            if (!x && x !== 0) x = '';
            else if (typeof x.toString !== 'undefined') x = x.toString();
            else x = '' + x;
            return !validator.isNull(x);
        },
        'reject': _.isUndefined,
        'default': function (x, defaults) {
            if (_.isUndefined(x)) x = _.isFunction(defaults) ? defaults() : _.clone(defaults);
            return x;
        },
        'transform': function (x, func) {
            if (!_.isUndefined(x)) x = func(x);
            return x;
        }
    };

module.exports = validators;

