# readwrite-lock

[Read/Write locks](https://en.wikipedia.org/wiki/Readers%E2%80%93writer_lock) on asynchronous code

[![Build Status](https://api.travis-ci.org/dataserve/readwrite-lock.svg?branch=master)](https://travis-ci.org/dataserve/readwrite-lock)
[![Codacy Badge](https://api.codacy.com/project/badge/Coverage/0b57b3c89aee44acab6514989f0ac872)](https://www.codacy.com/app/kdeegan/readwrite-lock?utm_source=github.com&utm_medium=referral&utm_content=dataserve/readwrite-lock&utm_campaign=Badge_Coverage)

RW lock rules:
* there may be one or more readers at a time
* there may be only one writer at a time
* attempts to acquire read lock are queued as long as a write lock is taken
* attempts to acquire write lock are queued as long as at least one read lock is taken

Features
* Uses ES6 promises
* Individual or an array of lock keys supported
* Timeout supported
* Pending task limit supported

## Why you need locking on single threaded nodejs?

Nodejs is single threaded, and the code execution is never get interrupted inside an event loop, so locking is unnecessary? This is true ONLY IF your critical section can be executed inside a single event loop. However, if you have any async code inside your critical section (it can be simply triggered by any I/O operation, or timer), your critical logic will across multiple event loops, therefore it's not concurrency safe!

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
});
```

## Why read/write locking?

Read locks run concurrently, while write locks run exclusively. This is useful when working with multiple async IO calls to modify a resource. Below is an example of how read write locks work. This is of course not a real use case, it is only used as an example of what can happen when using asynchronous IO in NodeJS.

```js
function concatHtml() {
    return new Promise((resolve, reject) => {
        htmlDownload("https://www.google.com", googleHtml => {
            fs.writeFile('concat_html.txt', googleHtml, () => {
                htmlDownload("https://www.github.com", githubHtml => {
                    fs.appendFile('concat_html.txt', githubHtml, () => resolve());
                });
            });
        });
    });
}

function readHtml() {
    return new Promise((resolve, reject) => {
        fs.readFile('concat_html.txt', result => resolve(result))
    });
}
```

```
user1: concatHtml()
user2: readHtml() -> only googleHtml found in file
user3: readHtml() -> googleHtml + githubHtml found in file
```

With readwriteLock, you can make sure that read locks can run concurrently as long as no writes are queued up. Likewise, writes block all reads until they are completed.

```js
lock.acquireWrite('key', () => {
    // no other locks exist when this is running
    return concatHtml();
}).then(result => {
}).catch(err => {
});

lock.acquireRead('key', () => {
    // runs parallel with other read locks
    return readHtml();
}).then(result => {
}).catch(err => {
});

lock.acquireRead('key', () => {
    // runs parallel with other read locks
    return readHtml();
}).then(result => {
}).catch(err => {
});
```

## Get Started

```js
var ReadwriteLock = require('readwrite-lock');
var lock = new ReadwriteLock();

/**
 * @param {String|Array} key 	resource key or keys to lock
 * @param {function} fn 	execute function
 * @param {Object} opts 	(optional) options
 */
lock.acquireRead(key, () => {
    // critical section
    // return value or promise
}, opts).then(() => {
    // continue execution outside critical section
    // NOTE: LOCK IS RELEASED AS SOON AS CRITICAL SECTION RETURNS
             there is no guaranteed order of this "then()" call
             compared to other recently released locks of same key
});

/**
 * @param {String|Array} key 	resource key or keys to lock
 * @param {function} fn 	execute function
 * @param {Object} opts 	(optional) options
 */
lock.acquireWrite(key, () => {
    // critical section
    // return value or promise
}, opts).then(() => {
    // continue execution outside critical section
    // NOTE: LOCK IS RELEASED AS SOON AS CRITICAL SECTION RETURNS
             there is no guaranteed order of this "then()" call
             compared to other recently released locks of same key
});
```

## Error Handling

```js
lock.acquireRead(key, () => {
    throw new Error('error');
}).catch(err => {
    console.log(err.message); // output: error
});


lock.acquireWrite(key, () => {
    throw new Error('error');
}).catch(err => {
    console.log(err.message); // output: error
});
```

## Acquire multiple keys

```js
lock.acquireRead([key1, key2], fn)
    .then(() => {
        // no longer in critical section
    })
    .catch(err => {
        console.log(err.message);
    });

lock.acquireWrite([key1, key2], fn)
    .then(() => {
        // no longer in critical section
    })
    .catch(err => {
        console.log(err.message);
    });
```

## Options

```js
// Specify timeout
var lock = new ReadwriteLock({timeout : 5000});
lock.acquireRead(key, fn)
    .then(() => {
           // critical section will never be entered if timeout occurs
    })
    .catch(err => {
           // timed out error will be returned here if lock not acquired in given time
    });
lock.acquireWrite(key, fn)
    .then(() => {
           // critical section will never be entered if timeout occurs
    })
    .catch(err => {
           // timed out error will be returned here if lock not acquired in given time
    });

// Set max pending tasks
var lock = new ReadwriteLock({maxPending : 1000});
lock.acquireRead(key, fn)
    .then(() => {
           // critical section will never be entered if pending limit reached
    })
    .catch(err => {
           // too many pending tasks error will be returned here if lock not acquired in given time
    });
lock.acquireWrite(key, fn)
    .then(() => {
           // critical section will never be entered if pending limit reached
    })
    .catch(err => {
           // too many pending tasks error will be returned here if lock not acquired in given time
    });

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
