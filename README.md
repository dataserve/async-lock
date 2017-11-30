# readwrite-lock

Read/Write locks on asynchronous code

[![Build Status](https://api.travis-ci.org/dataserve/readwrite-lock.svg?branch=master)](https://travis-ci.org/dataserve/readwrite-lock)

* Uses ES6 promises
* Individual or an Array of lock keys supported
* Timeout supported
* Pending task limit supported
* 100% code coverage

## Why you need locking on single threaded nodejs?

Nodejs is single threaded, and the code execution is never get interrupted inside an event loop, so locking is unnecessary? This is true ONLY IF your critical section can be executed inside a single event loop.
However, if you have any async code inside your critical section (it can be simply triggered by any I/O operation, or timer), your critical logic will across multiple event loops, therefore it's not concurrency safe!

Consider the following code
```js
redis.get('key', function(err, value){
	redis.set('key', value * 2);
});
```
The above code simply multiply a redis key by 2.
However, if two users run concurrency, the execution order may like this
```
user1: redis.get('key') -> 1
user2: redis.get('key') -> 1
user1: redis.set('key', 1 x 2) -> 2
user2: redis.set('key', 1 x 2) -> 2
```
Obviously it's not what you expected


With readwriteLock, you can easily write your async critical section
```js
lock.acquireWrite('key', () => {
	// Concurrency safe
	redis.get('key', (err, value) => {
		redis.set('key', value * 2);
	});
}).then((result) => {
}).catch((err) => {
})
```

## Get Started

```
var ReadwriteLock = require('readwrite-lock');
var lock = new ReadwriteLock();

/**
 * @param {String|Array} key 	resource key or keys to lock
 * @param {function} fn 	execute function
 * @param {Object} opts 	(optional) options
 */
lock.acquireRead(key, () => {
	// return value or promise
}, opts).then(() => {
	// lock released
});

/**
 * @param {String|Array} key 	resource key or keys to lock
 * @param {function} fn 	execute function
 * @param {Object} opts 	(optional) options
 */
lock.acquireWrite(key, () => {
	// return value or promise
}, opts).then(() => {
	// lock released
});
```

## Error Handling

```
lock.acquireRead(key, () => {
	throw new Error('error');
}).catch((err) => {
	console.log(err.message) // output: error
});
```

## Acquire multiple keys

```
lock.acquireRead([key1, key2], fn);
```

## Options

```
// Specify timeout
var lock = new ReadwriteLock({timeout : 5000});
lock.acquireWrite(key, fn, (err, ret) => {
	// timed out error will be returned here if lock not acquired in given time
});

// Set max pending tasks
var lock = new ReadwriteLock({maxPending : 1000});
lock.acquireWrite(key, fn, (err, ret) => {
	// Handle too much pending error
})

// Whether there is any running or pending async function
lock.isBusy();

// Use your own promise library instead of the global Promise variable
var lock = new ReadwriteLock({Promise : require('bluebird')}); // Bluebird
var lock = new ReadwriteLock({Promise : require('q')}); // Q
```

## Issues

See [isse tracker](https://github.com/dataserve/readwrite-lock/issues).

## License

MIT, see [LICENSE](./LICENSE)
