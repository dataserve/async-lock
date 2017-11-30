"use strict";

const DEFAULT_TIMEOUT = 0; //Never
const DEFAULT_MAX_PENDING = 1000;
const DEBUG = false;

class ReadwriteLock {

    constructor(opts) {
        opts = opts || {};

	this.Promise = opts.Promise || Promise;

	// format: {key : [{fn: fn, isWrite: isWrite}, {fn: fn, isWrite: isWrite}]}
	// queues[key] = null indicates no job running for key
	this.queues = {};
        this.queuesReaders = {};
        this.cnt = 0;

	this.timeout = opts.timeout || DEFAULT_TIMEOUT;
	this.maxPending = opts.maxPending || DEFAULT_MAX_PENDING;
    }

    /**
     * Acquire Read Lock(s)
     *
     * @param {String|Array} key resource key or keys to lock
     * @param {function} fn async function
     * @param {Object} opts options
     */
    acquireRead(key, fn, opts) {
        return this._acquire(false, key, fn,opts);
    }
    
    /**
     * Acquire Write Lock(s)
     *
     * @param {String|Array} key resource key or keys to lock
     * @param {function} fn async function
     * @param {Object} opts options
     */
    acquireWrite(key, fn, opts) {
        return this._acquire(true, key, fn,opts);
    }

    _acquire(isWrite, key, fn, opts) {
	if (Array.isArray(key)) {
	    return this._acquireBatch(isWrite, key, fn, opts);
	}

	if (typeof fn !== "function") {
	    throw new Error("You must pass a function to execute");
	}

	opts = opts || {};

        return new Promise((resolve, reject) => {
	    let timer = null;

            let cnt = this.cnt++;
            
	    let done = (locked, err, ret) => {
		if (err) {
		    reject(err);
		} else {
		    resolve(ret);
		}

	        if (locked) {
                    if (DEBUG) {
                        console.log(cnt, "DONE! READER", key, this.queuesReaders[key]);
                    }
                    if (isWrite) {
                        this.queuesReaders[key] = 0;
                    } else {
                        --this.queuesReaders[key];
                    }

                    let continued = this._continueQueue(cnt, isWrite, key);
                    
		    if (!continued && this.queues[key].length === 0 && this.queuesReaders[key] === 0) {
		        delete this.queues[key];
                        delete this.queuesReaders[key];
		    }
	        }
	    };
            
	    let run = () => {
	        if (timer) {
		    clearTimeout(timer);
		    timer = null;
	        }

                if (isWrite) {
                    this.queuesReaders[key] = -1;
                } else {
                    this.queuesReaders[key] += 1;
                }

                if (DEBUG) {
                    console.log(cnt, isWrite ? "WRITER" : "READER", key, this.queuesReaders[key]);
                }
                
	        this._promiseTry(fn)
		    .then((ret) => {
		        done(true, undefined, ret);
		    })
                    .catch((error) => {
		        done(true, error);
		    });
	    };
            
	    if (!this.queues[key] || (!isWrite && this.queues[key].length === 0)) {
                if (!this.queues[key]) {
	            this.queues[key] = [];
                    this.queuesReaders[key] = 0;
                }
	        run();
	    } else if (this.maxPending <= this.queues[key].length) {
	        done(false, new Error("Too much pending tasks"));
	    } else {
	        this.queues[key].push({
                    isWrite: isWrite,
                    fn: () => {
		        run();
	            }
                });
                
	        let timeout = opts.timeout || this.timeout;
	        if (timeout) {
		    timer = setTimeout(() => {
		        timer = null;
		        done(false, new Error("readwrite-lock timed out"));
		    }, timeout);
	        }
	    }
        });
    }

    _continueQueue(cnt, isWrite, key) {
        if (this.queues[key].length === 0) {
            return;
        }
        if (this.queues[key][0].isWrite && 0 < this.queuesReaders[key]) {
            return;
        }
        if (DEBUG) {
            console.log(cnt, "CONTINUE", key, this.queues[key][0].isWrite ? "WRITER" : "READER", this.queuesReaders[key]);
        }
        var nx = this.queues[key].shift();
        setImmediate(nx.fn);
        if (nx.isWrite) {
            return true;
        }
        while (true) {
            if (this.queues[key].length === 0) {
                break;
            }
            nx = this.queues[key][0];
            if (nx.isWrite) {
                break;
            }
            if (DEBUG) {
                console.log(cnt, "CONTINUE NESTED", key, this.queues[key][0].isWrite ? "WRITER" : "READER", this.queuesReaders[key]);
            }
            setImmediate(this.queues[key].shift().fn);
        }
        return true;
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
    _acquireBatch(isWrite, keys, fn, opts) {
	var getFn = (key, fn) => {
            return () => {
	        return this._acquire(isWrite, key, fn, opts);
            };
	};

	var fnx = fn;
        // sort to prevent deadlocks
        // keys need to lock in same order on multiple requests
	keys.sort().reverse().forEach((key) => {
	    fnx = getFn(key, fnx);
	});

        return fnx();
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
     * Promise.try() treat exceptions as rejected promise
     */
    _promiseTry(fn) {
	try {
	    return this.Promise.resolve(fn());
	} catch (e) {
	    return this.Promise.reject(e);
	}
    }
        
}

module.exports = ReadwriteLock;
