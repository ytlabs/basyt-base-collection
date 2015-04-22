var Promise = require('bluebird'),
    redis = require('redis'),
    _ = require('lodash'),
    validators = require('./validators');


//lodash template setup
_.templateSettings.interpolate = /{{([\s\S]+?)}}/g;

module.exports = BasytBaseCollection;

//validation properties
var flagValidators = ['notNull'];
var helperValidators = ['maxLength', 'minLength', 'contains', 'notContains', 'in', 'notIn', 'max', 'min', 'minLength', 'maxLength', 'regex', 'notRegex', 'after', 'before'];


function BasytBaseCollection(config) {
    //setup publisher for entity event notifications
    this.publisher = redis.createClient();

    //prepare empty validation arrays
    var validations = {
            insert: [],
            query: [],
            update: {
                setField: [],
                unsetField: [],
                setArray: [],
                unsetArray: []
            }
        },
        name = this.name,
        idFunction = this.idFunction,
        idField = this.idField,
        defaultIdField = this.storageDefaultIdField || 'id',
        projection = {},
        embeds = {};
        relations = [];


    var validator = {
        func: validators.transform,
        field: idField,
        name: 'transform',
        param: idFunction,
        mutates: true
    };
    validations.insert.push(validator);
    validations.update.setField.push(validator);
    validations.query.push(validator);

    _.forOwn(config.attributes, function (properties, field) {
        var validator, relation;

        if (_.isString(properties)) {
            /**
             * this case is for field definitions like
             * attributes: {
			 * 		...
			 * 		field: "type"
			 * 		...
			 * 	}
             */
            if (properties === 'id') { //id type field
                validator = {
                    func: validators.transform,
                    field: field,
                    param: idFunction,
                    name: 'transform',
                    mutates: true
                };
            }
            else {
                validator = {
                    func: validators[properties],
                    field: field,
                    name: 'invalid'
                };
            }
            if (_.isUndefined(validator.func)) {
                console.log(name + ' has unrecognized type for field ' + field + ' assumed string');
                validator.func = validators.string;
                validator.name = 'invalid';
            }

            else {
                validations.insert.push(validator);
                validations.update.setField.push(validator);
            }

            return true; //done if properties is just type
        }

        // ''required''  existance validations
        if (properties.required === true) {
            validations.insert.push({
                func: validators.required,
                field: field,
                name: 'required',
                skipUndefined: false
            });
        }

        //''type'' validation is required if field is not relation field
        if (properties.type !== 'relation') {
            if (properties.type === 'id') { //id type field
                validator = {
                    func: validators.transform,
                    field: field,
                    param: idFunction,
                    name: 'transform',
                    mutates: true
                };
            }
            else {
                if (_.isUndefined(properties.type) || _.isUndefined(validators[properties.type])) {
                    console.log(name + ' has undefined type for field ' + field + ' assumed string');
                    properties.type = 'string';
                }
                validator = {
                    func: validators[properties.type],
                    field: field,
                    name: 'invalid'
                };
            }
            validations.insert.push(validator);
            validations.update.setField.push(validator);
            if (properties.type !== 'array' || _.isUndefined(properties.entity)) {
                validations.query.push(validator);
            }
        }

        //''readable'' setup readability
        if (properties.readable === false) {
            projection[field] = 0;
            validations.query.push({
                func: validators.reject,
                field: field,
                name: 'reject'
            })
        }

        //''writeable'' setup writeability
        if (properties.writeable === false) {
            validator = {
                func: validators.reject,
                field: field,
                name: 'reject'
            };
            validations.update.setField.push(validator);
            validations.update.unsetField.push(validator);
            validations.update.setArray.push(validator);
            validations.update.unsetArray.push(validator);
        }

        //array type validations
        if (properties.type === 'array') {
            if (!_.isUndefined(properties.element)) {
                if (_.isString(properties.element) && !_.isUndefined(validators[properties.element])) {
                    properties.element = {type: properties.element};
                    validator = {
                        func: this.validateArrayElements,
                        param: properties.element.type,
                        field: field,
                        name: 'invalid'
                    };
                    validations.insert.push(validator);
                    validations.update.setField.push(validator);
                    validations.update.setArray.push({
                        func: validators[properties.element.type],
                        field: field,
                        name: properties.element.type
                    });
                }

                //helper validators
                _.forEach(helperValidators, function (name) {
                    if (!_.isUndefined(properties.element[name])) {
                        validator = {
                            func: this.validateArrayElements,
                            field: field,
                            param: [name, properties.element[name]],
                            name: name
                        };
                        validations.insert.push(validator);
                        validations.update.setField.push(validator);
                        validations.update.setArray.push({
                            func: validators[name],
                            field: field,
                            params: properties.element[name],
                            name: name
                        });
                    }
                }, this);
            }
        }

        if (properties.type === 'object') {
            embeds[field] = properties.fields;
        }

        //flag validators
        _.forEach(flagValidators, function (name) {
            if (!_.isUndefined(properties[name])) {
                validator = {
                    func: validators[name],
                    field: field,
                    param: [name, properties.name],
                    expect: properties.name,
                    name: name
                };
                validations.insert.push(validator);
                validations.update.setField.push(validator);
            }
        });

        //helper validators
        _.forEach(helperValidators, function (name) {
            if (!_.isUndefined(properties[name])) {
                validator = {
                    func: validators[name],
                    field: field,
                    param: properties[name],
                    name: name
                };
                validations.insert.push(validator);
                validations.update.setField.push(validator);
            }
        });

        //set default value
        if (!_.isUndefined(properties.default)) {
            validator = {
                func: validators.default,
                field: field,
                name: 'default',
                mutates: true,
                param: properties.default,
                skipUndefined: false
            };
            validations.insert.push(validator);
        }

        //insert validator for relations
        if (!_.isUndefined(properties.entity)) {
            relation = {
                field: field,
                entity: properties.entity,
                foreign: properties.foreign,
                required: properties.required,
                role: properties.role || properties.entity + '_collection', //TODO there may be more than one relation without role name
                visible: properties.visible,
                isArray: (properties.type === 'array'),
                transfer: properties.transfer
            };
            relations.push(relation);
        }
    }, this);

    //first handle "strict" validation so unshift to front
    //rejects insertion and update if query includes fields undefined in configuration
    if (config.strict !== false) {
        var strict = {
            func: this.validateStrict,
            param: [_.keys(config.attributes), embeds],
            name: 'strict'
        };
        validations.insert.unshift(strict);
        validations.update.setField.push(strict);
        validations.update.setArray.push(strict);
    }

    this.eventNames = _.isString(config.eventNames) ? [config.eventNames] : (config.eventNames || []);
    this.validations = validations;
    this.relations = relations;
    this.projection = projection;
    this.eventNames.push("entity:" + config.name);
    this.eventNames.push(idField === defaultIdField ? "entity:" + config.name + ":{{obj.id}}" : "entity:" + config.name + ":{{obj." + idField + "}}");
}

BasytBaseCollection.prototype = {
    //validation methods
    validateField: function (entity, validatorSetup) {
        if (_.isUndefined(validatorSetup.field)) {
            return validatorSetup.func(null, validatorSetup.param, entity);
        }
        if (_.isUndefined(entity[validatorSetup.field]) && (validatorSetup.skipUndefined !== false)) {
            return true;
        }
        if (validatorSetup.mutates === true) {
            try {
                entity[validatorSetup.field] = validatorSetup.func(entity[validatorSetup.field], validatorSetup.param, entity, validatorSetup.field);
            }
            catch (e) {
                //if there is an error in mutation reject it
                return false;
            }
            return true;
        }
        return validatorSetup.func(entity[validatorSetup.field], validatorSetup.param, entity, validatorSetup.field);
    },
    validateArrayElements: function (value, param, model, field) {
        var validatorName = _.isArray(param) ? param[0] : param;
        var validatorParam = _.isArray(param) ? param[1] : "";

        var valid;
        _.forEach(value, function (elem) {
            valid = validators[validatorName](elem, validatorParam);
            return valid;
        });
        return valid;
    },
    validateStrict: function (value, param, model) {
        //param contains [model field names, embedded object definitions]
        var fieldList = param[0],
            embedObjList = param[1],
            valid;
        _.forOwn(model, function(v, field){
            var embed = field.split('.');
            if((embed.length > 1)) {
                if((fieldList.indexOf(embed[0]) === -1) || (embedObjList[embed[0]] === false)){
                    valid = false;
                    return valid;
                }
                if(_.isArray(embedObjList[embed[0]])) {
                    valid = embedObjList[embed[0]].indexOf(embed[1]) > -1;
                    return valid;
                }
                valid = true;
                return valid;
            }
            valid = fieldList.indexOf(field) > -1;
            return valid;
        })
        return valid;
    },
    //collection methods
    create: function base_collection_create(_entity) {
        var entity = _.cloneDeep(_entity);
        return Promise.resolve(entity).bind(this)
            .then(this.adapter.validateEntity)
            .then(this.beforeCreate)
            .spread(this.beforeSave)
            .then(this.adapter.create)
            .spread(this.afterCreate);
    },
    read: function base_collection_read(_query, _options) {
        var query = _.cloneDeep(_query), options = _.cloneDeep(_options);
        return Promise.resolve([query, options]).bind(this)
            .spread(this.adapter.validateQuery)
            .spread(this.beforeRead)
            .spread(this.adapter.read);
    },
    update: function base_collection_update(_query, _update, _options) {
        var query = _.cloneDeep(_query), update = _.cloneDeep(_update), options = _.cloneDeep(_options);
        return Promise.resolve([query, update, options]).bind(this)
            .spread(this.adapter.validateUpdate)
            .spread(this.beforeUpdate)
            .spread(this.beforeSave)
            .spread(this.adapter.update)
            .spread(this.afterUpdate);
    },
    'delete': function base_collection_delete(_query, _options) {
        var query = _.cloneDeep(_query), options = _.cloneDeep(_options);
        return Promise.resolve([query, options]).bind(this)
            .spread(this.adapter.validateQuery)
            .spread(this.beforeDelete)
            .spread(this.adapter.delete);
    },
    query: function base_collection_query(_query, _options) {
        var query = _.cloneDeep(_query), options = _.cloneDeep(_options);
        return Promise.resolve([query, options]).bind(this)
            .spread(this.adapter.validateQuery)
            .spread(this.beforeQuery)
            .spread(this.adapter.query);
    },
    count: function base_collection_count(_query) {
        var query = _.cloneDeep(_query);
        return Promise.resolve(query).bind(this)
            .then(this.adapter.validateQuery)
            .spread(this.beforeQuery)
            .spread(this.adapter.count);
    },
    drop: function base_collection_drop() {
        return Promise.resolve(true).bind(this).then(this.adapter.drop);
    },
    //Hook Defaults
    beforeCreate: function base_collection_before_create(entity) {
        return [true, entity];
    },
    afterCreate: function base_collection_after_create(model, entity) {
        return model;
    },
    beforeUpdate: function base_collection_before_update(query, update, options) {
        return [false, update, query, options];
    },
    afterUpdate: function base_collection_after_update(result, update, query, options) {
        return result;
    },
    beforeRead: function base_collection_before_read(query, options) {
        return [query, options];
    },
    afterRead: function base_collection_after_read(model, query, options) {
        return model;
    },
    beforeSave: function base_collection_before_save(isNew, entityOrUpdate, query, options) {
        return isNew ? entityOrUpdate : [query, entityOrUpdate, options];
    },
    afterSave: function base_collection_after_save(model, entityOrUpdate, query, options) {
        return [model, entityOrUpdate, query, options];
    },
    beforeDelete: function base_collection_before_delete(query, options) {
        return [query, options];
    },
    afterDelete: function base_collection_after_delete(query, options) {
        return true;
    },
    beforeQuery: function base_collection_before_query(query, options) {
        return [query, options];
    },
    afterQuery: function base_collection_after_query(list, query, options) {
        return list;
    },
    // ADAPTER Defaults
    adapter: {
        create: function basyt_default_adapter_create(entity) {
            console.log('Adapter did not implement create function');
            return this.afterSave(null, entity);
        },
        read: function basyt_default_adapter_read(query, options) {
            console.log('Adapter did not implement read function');
            return this.afterRead(null, query, options);
        },
        update: function basyt_default_adapter_update(query, update, options) {
            console.log('Adapter did not implement update function');
            return this.afterSave(null, update, query, options);
        },
        'delete': function basyt_default_adapter_delete(query, options) {
            console.log('Adapter did not implement delete function');
            return this.afterDelete(null, query, options);
        },
        query: function basyt_default_adapter_query(query, options) {
            console.log('Adapter did not implement query function');
            return this.afterQuery(null, query, options);
        },
        count: function basyt_default_adapter_count(query) {
            console.log('Adapter did not implement count function');
            return this.afterQuery(null, query);
        },
        drop: function basyt_default_adapter_drop() {
            console.log('Adapter did not implement drop function');
        },
        validateQuery: function basyt_default_adapter_validate_query(args) {
            console.log('Adapter did not implement validate query');
            return Promise.resolve.apply(Array.prototype.slice.call(arguments));
        },
        validateEntity: function basyt_default_adapter_validate_entity(args) {
            console.log('Adapter did not implement validate entity');
            return Promise.resolve.apply(Array.prototype.slice.call(arguments));
        },
        validateUpdate: function basyt_default_adapter_validate_update(args) {
            console.log('Adapter did not implement validate update');
            return Promise.resolve.apply(Array.prototype.slice.call(arguments));
        }
    }

};