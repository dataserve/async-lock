'use strict';

var Q = require('q');
var Bluebird = require('bluebird');
var _ = require('lodash');
var assert = require('assert');

var ReadwriteLock = require('../index');

Q.longStackSupport = true;

function delayPromise(delay) {
    return new Promise((resolve, reject) => {
        setTimeout(resolve, delay);
    });
}

function getKey(i) {
    var key;
    if (i === 0) {
        key = 'test-key';
    } else if (i === 1) {
        key = [...Array(10).keys()];
    } else {
        key = [];
        for (let i = 0; i < 1000; ++i) {
            key.push(Math.floor(Math.random() * 1000));
        }
    }
    return key;
}

describe('ReadwriteLock Tests', function() {
    it('Single write key test', function(done) {
        var lock = new ReadwriteLock();

        let runTest = (i) => {
            return new Promise((resolve, reject) => {
                var taskCount = 8;
                var finishedCount = 0;
                var isRunning = {};
                var taskNumbers = [...Array(taskCount).keys()];

                taskNumbers.forEach((number) => {
                    let key = getKey(number % 3);
                    lock.acquireWrite(key, () => {
                        assert(!isRunning[key]);
                        assert(lock.isBusy() && lock.isBusy(key));

                        let delay = Math.random() * 10;
                        return delayPromise(delay)
                            .then(() => {
                                isRunning[key] = false;

                                return 'result';
                            });
                    }).then((result) => {
                        finishedCount++;
                        assert(result === 'result');
                        if (finishedCount === taskCount) {
                            assert(!lock.isBusy());
                            done();
                        }
                    }).catch((err) => {
                        done(err);
                    });
                });
            });
        };

        runTest(1)
            .then(() => runTest(2))
            .then(() => runTest(3))
            .then(() => done())
            .catch(err => done(err));
    });

    it('Read/write locks single/multi keys', function(done) {
        var lock = new ReadwriteLock();
        var key;

        let runTest = (i) => {
            return new Promise((resolve, reject) => {
                let write1Done = false, write2Done = false,
                    read1Done = false, read2Done = false,
                    key = getKey(i);

                assert(!lock.isBusy(key));
                
                lock.acquireWrite(key, () => {
                    assert(!write1Done);
                    assert(lock.isBusy() && lock.isBusy(key));
                    let delay = Math.random() * 10;
                    return delayPromise(delay)
                        .then(() => {
                            write1Done = true;
                            return 'result';
                        });
                }).then((result) => {
                    assert(result === 'result');
                }).catch((err) => {
                    reject(err);
                });
                lock.acquireWrite(key, () => {
                    assert(write1Done);
                    assert(!write2Done);
                    assert(lock.isBusy() && lock.isBusy(key));
                    let delay = Math.random() * 10;
                    return delayPromise(delay)
                        .then(() => {
                            write2Done = true;
                            return 'result';
                        });
                }).then((result) => {
                    assert(result === 'result');
                }).catch((err) => {
                    reject(err);
                });
                lock.acquireRead(key, () => {
                    assert(!read1Done);
                    assert(write1Done);

                    let delay = Math.random() * 10;
                    return delayPromise(delay)
                        .then(() => {
                            read1Done = true;
                            return 'result';
                        });
                }).then((result) => {
                    assert(result === 'result');
                }).catch((err) => {
                    reject(err);
                });
                lock.acquireRead(key, () => {
                    assert(!read2Done);
                    assert(write1Done);
                    
                    let delay = Math.random() * 10;
                    return delayPromise(delay)
                        .then(() => {
                            read2Done = true;
                            return 'result';
                        });
                }).then((result) => {
                    assert(result === 'result');
                }).catch((err) => {
                    reject(err);
                });
                lock.acquireWrite(key, () => {
                    assert(read1Done && read2Done);
                    
                    let delay = Math.random() * 10;
                    return delayPromise(delay);
                }).then((result) => {
                    assert(result === undefined);
                    resolve();
                }).catch((err) => {
                    reject(err);
                });
            });
        };

        runTest(1)
            .then(() => runTest(2))
            .then(() => runTest(3))
            .then(() => done())
            .catch(err => done(err));
    });

    it('Time out test', function(done) {
        var lock = new ReadwriteLock({timeout: 20});

        lock.acquireWrite('key', () => {
        }).then((result) => {
        }).catch((err) => {
            assert('unknown error in timeout test');
        });

        lock.acquireWrite('key', () => {
            return delayPromise(50);
        }).then((result) => {
        }).catch((err) => {
            assert('unknown error in timeout test');
        });
        
        lock.acquireWrite('key', () => {
            assert('should not execute here');
        }).catch((err) => {
            done();
        });
    });

    it('Time out multi test', function(done) {
        var lock = new ReadwriteLock({timeout: 20}),
            keys = ['key1', 'key2'];

        
        lock.acquireWrite(keys, () => {
        }).then((result) => {
        }).catch((err) => {
            assert('unknown error in timeout test');
        });

        lock.acquireWrite(keys, () => {
            return delayPromise(50);
        }).then((result) => {
        }).catch((err) => {
            assert('unknown error in timeout test');
        });
        
        lock.acquireWrite(keys, () => {
            assert('should not execute here');
        }).catch((err) => {
            done();
        });
    });
    
    it('Error handling', function(done) {
        var lock = new ReadwriteLock();
        
        lock.acquireWrite('key', () => {
            throw new Error('error');
        }).then(() => {
            assert('catch failed');
        }).catch((err) => {
            assert(err.message === 'error');
        }).then(() => {
            return lock.acquireWrite(['key1', 'key2'], () => {
                throw new Error('error');
            }).then(() => {
                done(new Error('catch failed'));
            }).catch((err) => {
                assert(err.message === 'error');
                done();
            });
        });
    });

    it('Too many pending', function(done) {
        var lock = new ReadwriteLock({maxPending: 1});
        
        lock.acquireWrite('key', () => {
            return delayPromise(20);
        });
        lock.acquireWrite('key', () => {
            return delayPromise(20);
        });

        lock.acquireWrite('key', () => {})
            .then((result) => {
                done(new Error('error'));
            })
            .catch((err) => {
                done();
            });
    });

    it('use bluebird promise', function(done) {
        var lock = new ReadwriteLock({Promise: Bluebird});
        
        lock.acquireWrite('key', () => 'bluebirdpromise')
            .then((result) => {
                assert(result === 'bluebirdpromise');
                done();
            }, done);
    });

    it('use Q promise', function(done) {
        var lock = new ReadwriteLock({Promise: Q.Promise});
        
        lock.acquireWrite('key', () => 'qpromise')
            .then((result) => {
                assert(result === 'qpromise');
                done();
            }, done);
    });
    
    it('use ES6 promise', function(done) {
        var lock = new ReadwriteLock({Promise: Promise});
        
        lock.acquireWrite('key', () => 'es6promise')
            .then((result) => {
                assert(result === 'es6promise');
                done();
            }, done);
    });

    it('uses global Promise by default', function(done) {
        var lock = new ReadwriteLock({});
        
        lock.acquireWrite('key', () => 'globalpromise')
            .then((result) => {
                assert(result === 'globalpromise');
                done();
            }, done);
    });

    it('invalid parameter', function(done) {
        var lock = new ReadwriteLock();

        lock.acquireWrite('key', null)
            .then(() => {
                assert('invalid parameter not caught');
            }).catch((err) => {
                done();
            });
    });

});
