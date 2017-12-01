"use strict";

const DEFAULT_TIMEOUT = 0; //Never
const DEFAULT_MAX_PENDING = 1000;
const DEBUG = false;

class Lock {

    constructor() {
        this.queue = [];
        this.readers = 0;
    }

    append(id, isWrite, run) {
        this.queue.push({
            id: id,
            isWrite: isWrite,
            run: run
        });
    }

    run(isWrite) {
        if (isWrite) {
            this.readers = -1;
        } else {
            this.readers += 1;
        }
    }

    done(isWrite) {
        if (isWrite) {
            this.readers = 0;
        } else {
            --this.readers;
        }
    }

    canRead() {
        return this.queue.length === 0 && 0 <= this.readers;
    }
    
    isEmpty() {
        return this.queue.length === 0 && this.readers === 0;
    }

    pendingCnt() {
        return this.queue.length;
    }

    shiftPending() {
        if (this.queue.length === 0) {
            return;
        }
        if (this.queue[0].isWrite && 0 < this.readers) {
            return;
        }
        var tasks = [];
        var task = this.queue.shift();
        tasks.push(task);
        if (task.isWrite) {
            return tasks;
        }
        while (true) {
            if (this.queue.length === 0) {
                break;
            }
            task = this.queue[0];
            if (task.isWrite) {
                break;
            }
            tasks.push(this.queue.shift());
        }
        return tasks;
    }

}

class ReadwriteLock {

    constructor(opts) {
        opts = opts || {};

        this.Promise = opts.Promise || Promise;

        // format: {key : [{fn: fn, isWrite: isWrite}, {fn: fn, isWrite: isWrite}]}
        // queues[key] = null indicates no job running for key
        this.queues = {};
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
                    this.debug(cnt, "DONE", isWrite ? "WRITER" : "READER", key, this.queues[key].readers);
                    this.queues[key].done(isWrite);

                    let pending = this.queues[key].shiftPending();
                    if (pending && pending.length) {
                        while (pending.length) {
                            let task = pending.shift();

                            this.debug(task.id, "SHIFTED", task.isWrite ? "WRITER" : "READER", key, this.queues[key].readers);
                            
                            this.queues[key].run(task.isWrite);
                            task.run();
                        }
                    } else if (this.queues[key].isEmpty()) {
                        delete this.queues[key];
                    }
                }
            };
            
            let run = () => {
                if (timer) {
                    clearTimeout(timer);
                    timer = null;
                }

                this.debug(cnt, "RUN", isWrite ? "WRITER" : "READER", key, this.queues[key].readers);

                this._promiseTry(fn)
                    .then((ret) => {
                        done(true, undefined, ret)
                    })
                    .catch((error) => {
                        done(true, error)
                    });
            };

            if (!this.queues[key] || (!isWrite && this.queues[key].canRead())) {
                if (!this.queues[key]) {
                    this.queues[key] = new Lock;
                }
                this.queues[key].run(isWrite);
                run();
            } else if (this.maxPending <= this.queues[key].pendingCnt()) {
                done(false, new Error("Too much pending tasks"));
            } else {
                this.debug(cnt, "QUEUE", isWrite ? "WRITER" : "READER", key, this.queues[key].readers);

                this.queues[key].append(cnt, isWrite, run);
                
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

    /*
     * This function immediatly attempts to gain access to the
     * locks for each key passed in. If a lock is already taken,
     * it will be added to the queue. Only after every lock has
     * received lock access will the passed in fn() be called.
     */
    _acquireBatch(isWrite, keys, fn, opts) {
        let acquiredLocks = 0;
        let pendingAcquireResolve = [];
        let acquireErr = null;

        keys = [...new Set(keys)];

        return new Promise((parentResolve, parentReject) => {
            let checkAcquireFinished = () => {
                if (acquiredLocks !== keys.length) {
                    return;
                }
                this.debug("BATCH ACQUIRED", keys, acquiredLocks, acquireErr);
                if (acquireErr) {
                    releaseLocks();
                } else {
                    this._promiseTry(fn)
                        .catch((err) => {
                            acquireErr = err;
                        })
                            .then(releaseLocks);
                }
            };
            let releaseLocks = () => {
                pendingAcquireResolve.forEach((cb) => {
                    cb();
                });
                if (acquireErr) {
                    parentReject(acquireErr);
                } else {
                    parentResolve();
                }
            }
            keys.forEach((key) => {
                this._acquire(isWrite, key, () => {
                    ++acquiredLocks;
                    return new Promise((acquireResolve, acquireReject) => {
                        pendingAcquireResolve.push(acquireResolve);
                        checkAcquireFinished();
                    });
                }, opts).catch((err) => {
                    acquireErr = err;
                    ++acquiredLocks;
                    checkAcquireFinished();
                });
            });
        });
    }

    /*
     * Whether there is any running or pending asyncFunc
     *
     * @param {String} key
     */
    isBusy(key) {
        if (!key) {
            return 0 < Object.keys(this.queues).length;
        } else if (Array.isArray(key)) {
            for (let k in key) {
                if (this.isBusy(k)) {
                    return true;
                }
            }
            return false;
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

    debug(...args) {
        if (!DEBUG) {
            return;
        }
        console.log("readwriteLock", ...args);
    }
    
}

module.exports = ReadwriteLock;
