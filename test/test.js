"use strict";

var Q = require("q");
var Bluebird = require("bluebird");
var _ = require("lodash");
var ReadwriteLock = require("../index.js");
var assert = require("assert");

Q.longStackSupport = true;

function delayPromise(delay) {
    return new Promise((resolve, reject) => {
        setTimeout(resolve, delay);
    });
}

describe("ReadwriteLock Tests", function() {
    it("Single write key test", function(done) {
	var lock = new ReadwriteLock();

	var taskCount = 8;
	var keyCount = 2;
	var finishedCount = 0;

	var isRunning = {};

	var taskNumbers = [];
	for (let i = 0; i < taskCount; i++) {
	    taskNumbers.push(i);
	}

	taskNumbers.forEach((number) => {
	    let key = number % keyCount;
	    lock.acquireWrite(key, () => {
		assert(!isRunning[key]);
		assert(lock.isBusy() && lock.isBusy(key));

		let timespan = Math.random() * 10;
		console.log("task%s(key%s) start, %s ms", number, key, timespan);
                return delayPromise(timespan);
	    }).then((result) => {
		console.log("task%s(key%s) done", number, key);

		isRunning[key] = false;
		finishedCount++;
		if (finishedCount === taskCount) {
		    assert(!lock.isBusy());
		    done();
		}
            }).catch((err) => {
                return done(err);
            });
	});
    });

    it("Multiple keys test", function(done) {
	var lock = new ReadwriteLock();
	var busy1 = false, busy2 = false;

	var finishCount = 0;
	var finish = () => {
	    finishCount++;
	    if (finishCount === 3) {
		done();
	    }
	};

	lock.acquireWrite(1, () => {
	    assert(!busy1);
	    busy1 = true;

	    let timespan = 10;
	    console.log("task1(key1) start, %sms", timespan);
            
            return delayPromise(timespan);
	}).then((result) => {
	    busy1 = false;
	    console.log("task1(key1) done");
	    finish();
        }).catch((err) => {
            return done(err);
        });

	lock.acquireWrite(2, () => {
	    assert(!busy2);
	    busy2 = true;

	    let timespan = 20;
	    console.log("task2(key2) start, %sms", timespan);

            return delayPromise(timespan);
	}).then((result) => {
	    busy2 = false;
	    console.log("task2(key2) done");
	    finish();
        }).catch((err) => {
            return done(err);
        });

	lock.acquireWrite([1, 2], () => {
	    assert(!busy1 && !busy2);
	    busy1 = busy2 = true;

	    let timespan = 10;
	    console.log("task3(key1&2) start, %sms", timespan);

            return delayPromise(timespan);
	}).then((result) => {
	    busy1 = busy2 = false;

	    console.log("task3(key1&2) done");
	    finish();
        }).catch((err) => {
            return done(err);
        });
    });

    it("Time out test", function(done) {
	var lock = new ReadwriteLock({timeout: 20});
	var timedout = false;

	lock.acquireWrite("key", () => {
            return delayPromise(50);
	}).then((result) => {
	    assert(timedout);
	    done();
	}).catch((err) => {
	    assert(timedout);
	    done();
        });
        
	lock.acquireWrite("key", () => {
	    assert("should not execute here");
	}).catch((err) => {
	    // timed out
	    console.log(err);
	    if (err) {
		timedout = true;
	    }
	});
    });

    it("Promise mode (Q)", function(done) {
	var lock = new ReadwriteLock();
	var value = 0;
	var concurrency = 8;

	Q.all(_.range(concurrency).map(() => {
	    return lock.acquireWrite("key", () => {
		let tmp = null;
		// Simulate non-atomic check and set
		return Q() // jshint ignore:line
		    .delay(_.random(10))
		    .then(() => {
			tmp = value;
		    })
		    .delay(_.random(20))
		    .then(() => {
			value = tmp + 1;
		    });
	    });
	}))
	    .then(() => {
		assert(value === concurrency);
	    })
	    .then(() => {
		let key1 = false, key2 = false;
		lock.acquireWrite("key1", () => {
		    key1 = true;
                    return delayPromise(20)
                        .then(() => {
			    key1 = false;
		        });
		});
		lock.acquireWrite("key2", () => {
		    key2 = true;
		    return delayPromise(10)
                        .then(() => {
			    key2 = false;
		        });
		});

		return lock.acquireWrite(["key1", "key2"], () => {
		    assert(key1 === false && key2 === false);
		});
	    })
	    .nodeify(done);
    });

    it("Error handling", function(done) {
	var lock = new ReadwriteLock();
	lock.acquireWrite("key", () => {
	    throw new Error("error");
	}).catch((err) => {
	    assert(err.message === "error");
	    done();
	});
    });

    it("Too much pending", function(done) {
	var lock = new ReadwriteLock({maxPending: 1});
	lock.acquireWrite("key", () => {
	    return delayPromise(20);
	});
	lock.acquireWrite("key", () => {
	    return delayPromise(20);
	});

	lock.acquireWrite("key", () => {})
            .then((result) => {
                done(new Error("error"));
            })
	    .catch((err) => {
		done();
	    });
    });

    it("use bluebird promise", function(done) {
	var lock = new ReadwriteLock({Promise: Bluebird});
	lock.acquireWrite("key", () => {})
            .then(done, done);
    });

    it("use Q promise", function(done) {
	var lock = new ReadwriteLock({Promise: Q});
	lock.acquireWrite("key", () => {})
            .then(done, done);
    });
    
    it("use ES6 promise", function(done) {
	var lock = new ReadwriteLock({Promise: Promise});
	lock.acquireWrite("key", () => {})
	    .then(done, done);
    });

    it("uses global Promise by default", function(done) {
	var lock = new ReadwriteLock({});
	lock.acquireWrite("key", () => {})
	    .then(done, done);
    });

    it("invalid parameter", function(done) {
	var lock = new ReadwriteLock();
	try {
	    lock.acquireWrite("key", null);
	} catch (e) {
	    done();
	}
    });

    it("bug #2 on https://github.com/rain1017/async-lock/issues/2", function(done) {
	var lock = new ReadwriteLock({});

	// this case gave a TypeError
	var work = () => {
	    return delayPromise(10);
	};

	var doneCount = 0;
	var cb = () => {
	    doneCount++;
	    if (doneCount === 2) {
		done();
	    }
	};

	lock.acquireWrite(["A", "B", "C"], work).then(cb, cb);
	lock.acquireWrite(["A", "B", "C"], work).then(cb, cb);
    });

});
