'use strict';

const DEFAULT_TIMEOUT = 0; //Never
const DEFAULT_MAX_PENDING = 1000;

class AsyncLock {

    constructor(opts) {
        opts = opts || {};

	this.Promise = opts.Promise || Promise;

	// format: {key : [fn, fn]}
	// queues[key] = null indicates no job running for key
	this.queues = {};

	this.timeout = opts.timeout || DEFAULT_TIMEOUT;
	this.maxPending = opts.maxPending || DEFAULT_MAX_PENDING;
    }

    /**
     * Acquire Locks
     *
     * @param {String|Array} key resource key or keys to lock
     * @param {function} fn async function
     * @param {Object} opts options
     */
    acquire(key, fn, opts) {
	if (Array.isArray(key)) {
	    return this._acquireBatch(key, fn, opts);
	}

	if (typeof fn !== 'function') {
	    throw new Error('You must pass a function to execute');
	}

	opts = opts || {};

        return new Promise((resolve, reject) => {
	    let timer = null;
            
	    let done = (locked, err, ret) => {
	        if (locked) {
		    if (this.queues[key].length === 0) {
		        delete this.queues[key];
		    }
	        }

		if (err) {
		    reject(err);
		} else {
		    resolve(ret);
		}

	        if (locked) {
		    if (!!this.queues[key] && 0 < this.queues[key].length) {
		        this.queues[key].shift()();
		    }
	        }
	    };

	    let run = (locked) => {
	        if (timer) {
		    clearTimeout(timer);
		    timer = null;
	        }
                
	        this._promiseTry(fn)
		    .then((ret) => {
		        done(locked, undefined, ret);
		    })
                    .catch((error) => {
		        done(locked, error);
		    });
	    };
            
	    if (!this.queues[key]) {
	        this.queues[key] = [];
	        run(true);
	    } else if (this.maxPending <= this.queues[key].length) {
	        done(false, new Error('Too much pending tasks'));
	    } else {
	        this.queues[key].push(() => {
		    run(true);
	        });

	        var timeout = opts.timeout || this.timeout;
	        if (timeout) {
		    timer = setTimeout(() => {
		        timer = null;
		        done(false, new Error('async-lock timed out'));
		    }, timeout);
	        }
	    }
        }
    }

    /*
     * Below is how this function works:
     *
     * Equivalent code:
     * this.acquire(key1, () => {
     *     this.acquire(key2, () => {
     *         this.acquire(key3, fn);
     *     });
     * });
     *
     * Equivalent code:
     * var fn3 = getFn(key3, fn);
     * var fn2 = getFn(key2, fn3);
     * var fn1 = getFn(key1, fn2);
     * fn1();
     */
    _acquireBatch(keys, fn, opts) {
	var getFn = (key, fn) => {
	    return () => {
		this.acquire(key, fn, opts);
	    };
	};

	var fnx = fn;
	keys.reverse().forEach((key) => {
	    fnx = getFn(key, fnx);
	});

	var deferred = this._deferPromise();
	fnx((err, ret) => {
	    if (err) {
		deferred.reject(err);
	    } else {
		deferred.resolve(ret);
	    }
	});
	return deferred.promise;
    }

    /*
     *	Whether there is any running or pending asyncFunc
     *
     *	@param {String} key
     */
    isBusy(key) {
	if (!key) {
	    return 0 < Object.keys(this.queues).length;
	} else {
	    return !!this.queues[key];
	}
    }

    /**
     * Promise.try() implementation to become independent of Q-specific methods
     */
    _promiseTry(fn) {
	try {
	    return this.Promise.resolve(fn());
	} catch (e) {
	    return this.Promise.reject(e);
	}
    }

    /**
     * Promise.defer() implementation to become independent of Q-specific methods
     */
    _deferPromise() {
	if (typeof this.Promise.defer === 'function') {
	    // note that Q does not have a constructor with reject/resolve functions so we have no option but use its defer() method
	    return this.Promise.defer();
	} else {
	    // for promise implementations that don't have a defer() method we create one ourselves
	    var result = {
		reject: function(err) {
		    // some promise libraries e.g. Q take some time setting the reject property while others do it synchronously
		    return Promise.resolve().then(function() {
			result.reject(err);
		    });
		},
		resolve: function(ret) {
		    // some promise libraries e.g. Q take some time setting the reject property while others do it synchronously
		    return Promise.resolve().then(function() {
			result.resolve(ret);
		    });
		},
		promise: undefined
	    };
	    result.promise = new this.Promise(function(resolve, reject) {
		result.reject = reject;
		result.resolve = resolve;
	    });
	    return result;
	}
    }
    
}

module.exports = AsyncLock;
