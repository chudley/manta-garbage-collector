<!--
    This Source Code Form is subject to the terms of the Mozilla Public
    License, v. 2.0. If a copy of the MPL was not distributed with this
    file, You can obtain one at http://mozilla.org/MPL/2.0/.
-->

<!--
    Copyright (c) 2018, Joyent, Inc.
-->

# Manta Garbage Collector

This repository is part of the Joyent Manta project.  For contribution
guidelines, issues, and general documentation, visit the main
[Manta](http://github.com/joyent/manta) project page.

# Overview

The garbage-collector is an extension added to Manta in [RFD
143](https://github.com/joyent/rfd/blob/master/rfd/0143/README.md). It is
responsible for reading delete records added to the `manta_fastdelete_queue` and
producing instructions to delete backing files from the storage nodes on which the
objects exists. These instructions are syntactically identical to those
generated by the backup-based GC pipeline, and they are still processed by a cron job
that runs on all storage nodes in Manta.

**Garbage-collector processes are intended to be used only in deployments with
snaplink-disabled accounts**. To avoid any confusion, garbage-collector instances
will not start (the SMF service will enter the 'maintenance' state) if the Manta
deployment has no snaplink-disabled accounts.

# Running the Server

The entry point for the server lives in `cmd/server.js`, which is symlinked to
`bin/server`. First, build the component with `make`, and then run it from the
root of the repository with `$ LOG_LEVEL=<level> bin/server`.

# Running Tests

The garbage-collector uses [catest](https://github.com/joyent/catest) for auto
tests. Each major component has a corresponding test script in the `test/`
directory. Running the tests requires that you have a working Triton/Manta
deployment with a recently updated metadata schema (each metadata node must have
a `manta_fastdelete_queue`).

In order to run the test, you'll need to set up a `etc/testconfig.json`
to match your environment (use `etc/testconfig.json.template` as a guide). This
file closely mimcs the configuration that is passed to a garbage-collector in
a real deployment. For further discussion of what these fields mean, see the
"Configuration" section.

To run the tests, you'll want to make the following changes to
`etc/testconfig.json.template` and rename it to `etc/testconfig.json`:
- Replace all instances of "orbit.example.com" with the `DOMAIN_NAME` of your
  Manta application. The appropriate value can be found by running: `sdc-sapi
  /applications?name=manta | json -Ha metadata.DOMAIN_NAME` on your Triton
  headnode.
- Replace `manta.user` with the user you're testing with. This must be a
  snaplink-disabled user.
- Replace `manta.sign.key` with a private key for the Manta user you're testing
  with.
- Replace `manta.sign.keyId` with the value of `ssh-keygen -l -f
  ~/.ssh/id_rsa.pub | awk '{print $2}' | tr -d '\n'`, for the public key
  corresponding to the private key in the previous step.
- Replace the `shards` array with a similarly formatted array pointing to at
  least one metadata shard in your deployment. To find the
  appropriately-formatted list of index shards (along with their urls) run:
  `sdc-sapi /applications?name=manta | json -Ha metadata.INDEX_MORAY_SHARDS`
  on your Triton headnode (it is recommended you use only one of these during
  testing). The tests will create rows in the `manta_fastdelete_queue` on this
  shard. It is recommended that this shard not see too much (if any) other
  accelerated gc delete traffic while you run the tests.
- Replace the `allowed_creators` array with a similarly formatted array
  containing at least one reference to the uuid of your `manta.user`.
  `etc/testconfig.json.template` contains an example of what this array should
  look like.

Once you've set up the test configuration, run the tests with:
```
$ LOG_LEVEL=debug make test
```
from the root of the repository.

To run a specific test, edit the Makefile variable `CATEST_FILES` to be a
space-separated list of test files to be run on each `make test`. Each
`*.test.js` is a self-contained test that exercises multiple use-cases of the
component.

# Node Version

The garbage collector targets and has been tested with node-4.8.7.

# Configuration

## Process Level Configuration File Structure

The configuration in `etc/config.json.template` is an example of how the garbage
collector is configured. Some chunks of this configuration are described below:
* `manta`: A JSON object passed to node-manta's `createClient`.
* `moray`: A JSON object with options passed to node-moray's `createClient`. At
minimum, this must include a resolver.
* `shards`: A JSON array of objects. Each object has a "host" field which is the
SRV domain for a given metadata shard. The last object in this array must have a
"last" boolean field set to true. This syntax is required by
[Mustache](https://mustache.github.io/), Manta's template system.
* `buckets`: A JSON array of objects. Each object must have a "name" field whose
value is the name of the Moray bucket from which the garbage-collector should
stream records. This bucket must be present on all shards in the `shards` array.
* `allowed_creators`: An array of objects with a single field, `uuid`. Any delete
records whose `value.creator` field doesn't match the `uuid` field of some
object in this array will be ignored. This field will be initialized with the
SAPI value `ACCOUNTS_SNAPLINKS_DISABLED`, which originates from the Manta SAPI
application.
* `tunables`: A JSON object. This object consists of performance-tunables such
as batch-sizes and various delays. The next section contains more detailed
descriptions of each of the fields in this object.
* `address`/`port`: The address and port on which to start the HTTP management
interface described above.

## Deploying Garbage-Collectors

Accelerated garbage-collection is delpoyed with the `manta-adm accel-gc`
subcommand. Documentation of this process can be foudn in the Manta
[operator guide](https://joyent.github.io/manta/). For information about
`manta-adm accel-gc`, see:
[manta-adm(1)](https://github.com/joyent/sdc-manta/blob/master/docs/man/man1/manta-adm.md).

## Operating Garbage-Collectors

Garbage-collectors are configured with SAPI. The default values for the tunables
vary by deployment size, but the following metadata values are installed in the
garbage-collector service object on `manta-init`:

### Basics

* `GC_ASSIGNED_SHARDS` - A list of json objects, each with the single string
  field `host`, containing the URL of a shard the collector will poll records
  from. The last element of this array must contain a boolean `last` field
  set to true.
* `GC_ASSIGNED_BUCKETS` - A list of json objects, each with the single string
  field `name`, containing the name of the Moray bucket on each shard (from
  `GC_ASSIGNED_SHARDS`) from which delete records will be read. The last element
  of this array must contain a boolean `last` field set to true.
* `GC_CONCURRENCY` - A positive integer indicating the concurrency with which to
  read records, upload instructions, and delete records for each assigned shard.

One limitation of the configuration is that garbage-collectors must poll records
from the same buckets on each shard it is assigned. While this does constrain
the collectors, it also helps ensure that the collectors in a deployment are
configured consistently.

Another note here is that `GC_CONCURRENCY` applies to each bucket on each shard
the collector is assigned, meaning the total concurrency for a given collector
is `GC_ASSIGNED_SHARDS * GC_CONCURRENCY * GC_ASSIGNED_BUCKETS`. Manta operators
should exercise caution when setting these tunables, taking care not to
overwhelm the CN on which garbage-collectors are deployed (the `manta-adm
accel-gc` attempts to help with these decisions -- see
[manta-adm(1)](https://github.com/joyent/sdc-manta/blob/master/docs/man/man1/manta-adm.md)).

### Record Ingest

* `GC_RECORD_READ_BATCH_SIZE` - The number of `manta_fastdelete_queue` records
   to read per `findObjects`.
* `GC_RECORD_READ_WAIT_INTERVAL` - The number of milliseconds to wait between
  `findObjects` on the `manta_fastdelete_queue`.
* `GC_RECORD_READ_SORT_ATTR` - Which `manta_fastdelete_queue` bucket attribute
  to use when sorting.
* `GC_RECORD_READ_SORT_ORDER` - What order to sort records in. This value can be
  one of `ASC|DESC|asc|desc`.

### Instruction Upload

* `GC_INSTR_UPLOAD_BATCH_SIZE` - The number of delete instructions (lines) to
  include per instruction object.
* `GC_INSTR_UPLOAD_FLUSH_DELAY` - The number of milliseconds to wait between
  attempt to upload an instruction object.
* `GC_INSTR_UPLOAD_PATH_PREFIX` - The location in which to upload delete
  instructions. In order to maintain interoperability with the offline GC, the
  value of this variable should always be `poseidon/stor/manta_gc/mako`.

### Record Delete

* `GC_RECORD_DELETE_BATCH_SIZE` - The batch size with which to delete records
  from the `manta_fastdelete_queue`.
* `GC_RECORD_DELETE_DELAY` - The number of milliseconds to wait between deletes
  from the `manta_fastdelete_queue`.

### Memory

* `GC_CACHE_CAPACITY` - A global cap on the nubmer of entities a collector can
  have cached at once. This is a coarse limit intended to limit the memory
  consumption of a collector on a system experiencing memory pressure.

Each of these SAPI values can be overridden in the instance object of a single
collector.

# Metrics

The garbage collector exposes a number of application-level metrics, in addition
to node-fast metrics for the two RPCs it uses: `findObjects`, and `batch`.

| name                       | type      | help                                |
|:---------------------------|:----------|:------------------------------------|
| gc_cache_entries           | gauge     | total number of cache entries       |
| gc_delete_records_read     | histogram | records read per `findObjects`      |
| gc_delete_records_cleaned  | histogram | records cleaned per `batch`         |
| gc_mako_instrs_uploaded    | histogram | instructions uploaded per Manta PUT |
| gc_bytes_marked_for_delete | histogram | how much storage space can be reclaimed after a round of `mako_gc.sh` on all sharks |

# HTTP Management Interface

Each garbage-collector process starts a restify http server listening on port
2020 by default (this is configurable). **Any configuration changes made through
this interface will not persist**. This interface is intended for
one-off experiments with tunable changes. To persist changes, make them via
SAPI.

The server supports the following endpoints:
```
Request:

GET /ping

Response:

{
	ok: boolean
	when: ISO timestamp
}
```

Endpoints listed under `/workers` implement worker control. Supported
actions include **listing**, **pausing**, and **resuming** the
workers. Newly created workers start in the running phase, even if
other workers are paused.
```
Request:

GET /workers/get

Response:

{
	"shard-url": {
		"bucket": [
		    {
			"component": "worker",
			"state": "running|paused|error",
			"actors": [
				{
					"component": "reader",
					"state": "running|waiting|error"
				},
				{
					"component": "transformer",
					"state": "running|waiting|error",
					"cached": integer
				},
				{
					"component": "instruction uploader",
					"state": "running|waiting|error"
				},
				{
					"component": "cleaner",
					"state": "running",
					"cached": integer
				}
			]
		    }
		...
		]
	}
	...
}
```
The `shard-url` variable will be a full domain like `2.moray.orbit.example.com`.
`bucket` will generally be either `manta_fastdelete_queue` or
`manta_delete_log`.

Pause all workers:
```
POST /workers/pause

Response:

{
	ok: boolean,
	when: ISO timestamp
}
```

Resume all workers:
```
POST /workers/resume

Response:

{
	ok: boolean,
	when: ISO timestamp
}
```

Retrieve performance tunables:
```
GET /tunables

Response:

{
	"instr_upload_batch_size": integer,
	"instr_upload_flush_delay": integer,
	"instr_upload_path_prefix": string,
	"record_read_batch_size": integer,
	"record_read_wait_interval": integer (ms),
	"record_read_sort_attr": "_mtime",
	"record_read_sort_order": "asc|ASC|desc|DESC",
	"record_delete_batch_size": integer,
	"record_delete_delay": integer (ms)
}
```

The following request allows an operator to modify any of the tunables returned
by the previous endpoint.
```
POST /tunables
Content-Type: application/json

{
	"instr_upload_batch_size": integer,
	"instr_upload_flush_delay": integer,
	"instr_upload_path_prefix": string
	"record_read_batch_size": integer,
	"record_read_wait_interval": integer (ms),
	"record_read_sort_attr": "_mtime",
	"record_read_sort_order": "asc|ASC|desc|DESC",
	"record_delete_batch_size": integer,
	"record_delete_delay": integer (ms)
}

Response:
{
	ok: boolean,
	when: ISO timestamp
}
```
