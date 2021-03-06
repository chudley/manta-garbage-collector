/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2019, Joyent, Inc.
 */

var Ajv = require('ajv');
var mod_assertplus = require('assert-plus');
var mod_jsprim = require('jsprim');
var mod_util = require('util');

var mod_errors = require('./errors');

var InvalidShardsConfigError = mod_errors.InvalidShardsConfigError;
var InvalidCreatorsConfigError = mod_errors.InvalidCreatorsConfigError;
var InvalidBucketsConfigError = mod_errors.InvalidBucketsConfigError;
var InvalidTunablesConfigError = mod_errors.InvalidTunablesConfigError;
var InvalidMakoConfigError = mod_errors.InvalidMakoConfigError;

var AJV_ENV = new Ajv();

var SORT_ATTRS = [
	'_mtime'
];

var SORT_ORDERS = [
	'DESC',
	'desc',
	'ASC',
	'asc'
];

var tunables_cfg_properties = {
	'instr_upload_batch_size': {
		'type': 'integer',
		'minimum': 1
	},
	'instr_upload_flush_delay': {
		'type': 'integer',
		'minimum': 1
	},
	'instr_upload_path_prefix': {
		'type': 'string',
		'minLength': 1
	},
	'record_read_batch_size': {
		'type': 'integer',
		'minimum': 1
	},
	'record_read_wait_interval': {
		'type': 'integer',
		'minimum': 0
	},
	'record_read_sort_attr': {
		'type': 'string',
		'enum': SORT_ATTRS
	},
	'record_read_sort_order': {
		'type': 'string',
		'enum': SORT_ORDERS
	},
	'record_delete_batch_size': {
		'type': 'integer',
		'minimum': 1
	},
	'record_delete_delay': {
		'type': 'integer',
		'minimum': 0
	},
	'capacity': {
		'type': 'integer',
		'minimum': 100
	}
};
var tunables_property_names = Object.keys(tunables_cfg_properties);

AJV_ENV.addSchema({
    id: 'shards-old-cfg',
    type: 'array',
    minItems: 2,
    maxItems: 2,
    items: {
	type: 'integer',
	minimum: 0
    }
});

AJV_ENV.addSchema({
	id: 'shards-cfg',
	type: 'array',
	items: { allOf: [ { '$ref': 'shard-cfg' } ] }
});

AJV_ENV.addSchema({
	id: 'shard-cfg',
	type: 'object',
	properties: {
		'host': {
			type: 'string',
			minLength: 1
		},
		'last': {
			type: 'boolean'
		}
	},
	required: [
		'host'
	],
	additionalProperties: false
});

var DELETE_RECORD_BUCKETS = [
	'manta_delete_log',
	'manta_fastdelete_queue'
];


AJV_ENV.addSchema({
	id: 'buckets-cfg',
	type: 'array',
	items: { allOf: [ { '$ref': 'bucket-cfg' } ] },
	minItems: 1
});


AJV_ENV.addSchema({
	id: 'bucket-cfg',
	type: 'object',
	properties: {
		'name': {
			type: 'string',
			enum: DELETE_RECORD_BUCKETS
		},
		'last': {
			type: 'boolean'
		}
	},
	required: [
		'name'
	],
	additionalProperties: false
});


AJV_ENV.addSchema({
	id: 'creators-cfg',
	type: 'array',
	items: { allOf: [ { '$ref': 'creator-cfg' } ] },
	minItems: 1
});


AJV_ENV.addSchema({
	id: 'creator-cfg',
	type: 'object',
	properties: {
		'uuid': {
			type: 'string',
			format: 'uuid',
			minLength: 1
		},
		'last': {
			type: 'boolean'
		}
	},
	required: [
		'uuid'
	],
	additionalProperties: false
});


AJV_ENV.addSchema({
	id: 'tunables-cfg',
	type: 'object',
	properties: tunables_cfg_properties,
	required: tunables_property_names,
	additionalProperties: false
});


AJV_ENV.addSchema({
	id: 'tunables-update-cfg',
	type: 'object',
	properties: tunables_cfg_properties,
	additionalProperties: false
});


// Internal helpers

function
allowed_values_text(allowed)
{
	mod_assertplus.array(allowed, 'allowed');

	var seen = {};
	var values = [];

	allowed.map(JSON.stringify).forEach(function (str) {
		var key = str.toUpperCase();
		if (!seen.hasOwnProperty(key)) {
			seen[key] = true;
			values.push(str);
		}
	});

	return (' (' + values.join(', ') + ')');
}


function
error_message(err, name)
{
	var msg = name + err.dataPath + ' ' + err.message;

	if (err.params.hasOwnProperty('allowedValues')) {
		msg += allowed_values_text(err.params.allowedValues);
	}

	return (msg);
}


function
errors_text(errs, name)
{
	return (errs.map(function (err) {
		return (error_message(err, name));
	}).join(', '));
}


// Schema validation API

function
validate_shards_old_cfg(cfg)
{
	if (AJV_ENV.validate('shards-old-cfg', cfg)) {
		if (cfg.interval !== undefined &&
		    cfg.interval[0] > cfg.interval[1]) {
			return (new InvalidShardsConfigError(
			    'expected shard interval [a,b] ' +
			    'with a <= b'));
		}
		return (null);
	}
	return (new InvalidShardsConfigError('%s',
	    errors_text(AJV_ENV.errors, 'shards-cfg')));
}

function
validate_shards_cfg(cfg)
{
	if (AJV_ENV.validate('shards-cfg', cfg)) {
		return (null);
	}
	return (new InvalidShardsConfigError('%s',
		errors_text(AJV_ENV.errors, 'shards-cfg')));
}


function
validate_buckets_cfg(cfg)
{
	if (AJV_ENV.validate('buckets-cfg', cfg)) {
		return (null);
	}
	return (new InvalidBucketsConfigError('%s',
		errors_text(AJV_ENV.errors, 'buckets-cfg')));
}


function
validate_creators_cfg(cfg)
{
	if (AJV_ENV.validate('creators-cfg', cfg)) {
		return (null);
	}

	return (new InvalidCreatorsConfigError('%s',
		errors_text(AJV_ENV.errors, 'creators-cfg')));
}


function
validate_tunables_cfg(cfg)
{
	if (AJV_ENV.validate('tunables-cfg', cfg)) {
		return (null);
	}

	return (new InvalidTunablesConfigError('%s',
		errors_text(AJV_ENV.errors, 'tunables-cfg')));
}


function
validate_tunables_update_cfg(cfg)
{
	if (AJV_ENV.validate('tunables-update-cfg', cfg)) {
		return (null);
	}

	return (new InvalidTunablesConfigError('%s',
	    errors_text(AJV_ENV.errors, 'tunables-update-cfg')));
}


module.exports = {

	validate_shards_cfg: validate_shards_cfg,

	validate_shards_old_cfg: validate_shards_old_cfg,

	validate_buckets_cfg: validate_buckets_cfg,

	validate_creators_cfg: validate_creators_cfg,

	validate_tunables_cfg: validate_tunables_cfg,

	validate_tunables_update_cfg:
	    validate_tunables_update_cfg

};
