"use strict";

const ReadwriteLock = require("../index.js");
const lock = new ReadwriteLock();

lock.acquire("test", () => {
    console.log("lock acquired");
}).then(() => {
    lock.acquire("test", () => {
        console.log("sub lock acquired again");
    }).then(() => {
        console.log("sub lock released again");
    });
}).then(() => {
    console.log("lock released");
});

lock.acquire("test", () => {
    console.log("lock acquired again");
}).then(() => {
    console.log("lock released again");
});
