import {
    Cmp
} from '../types/utilTypes';

import equal from 'fast-deep-equal';
import clone from 'rfdc';

export let deepEqual = equal;
export let deepCopy = clone();

//================================================================================
// TIME

export let microsecondNow = () =>
    Date.now() * 1000;

export let sleep = (ms: number) =>
    new Promise((res, rej) => {
        setTimeout(res, ms);
    });

//================================================================================
// NUMBERS

export let remap = (x: number, oldLo: number, oldHi: number, newLo: number, newHi: number ): number => {
    let pct = (x - oldLo) / (oldHi - oldLo);
    return newLo + (newHi - newLo) * pct;
}

export let randRange = (lo: number, hi: number): number =>
    remap(Math.random(), 0, 1, lo, hi);

//================================================================================
// TEMP FAKE HACKS

export let fakeUuid = () =>
    ('' + randRange(0, 999999999999999)).padStart(15, '0');

export let sha256b32 = (s: string) =>
    'fake-sha-256:' + fakeUuid();  // TODO

//================================================================================
// MISC 

export let getPromiseParts = <T>() => {
    // make a promise, extract the res and rej methods, and return all three.
    let resolve: (value: T | PromiseLike<T>) => void = null as any;
    let reject: (reason?: any) => void = null as any;
    let prom = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { prom, resolve, reject };
}

//================================================================================
// SORTING

export let compare = (a: any, b: any): Cmp => {
    if (a === b) { return Cmp.EQ; }
    return (a < b) ? Cmp.LT : Cmp.GT;
}

export let arrayCompare = (a: any[], b: any[]): Cmp => {
    let minLen = Math.min(a.length, b.length);
    for (let ii = 0; ii < minLen; ii++) {
        let elemCmp = compare(a[ii], b[ii]);
        if (elemCmp !== Cmp.EQ) { return elemCmp; }
    }
    return compare(a.length, b.length);
}

export let keyComparer = (key: string) =>
    (a: Record<string, any>, b: Record<string, any>): Cmp =>
        compare(a[key], b[key]);

export let fnComparer = (fn: (x: any) => any) =>
    (a: Record<string, any>, b: Record<string, any>): Cmp =>
        compare(fn(a), fn(b));

export let arrayComparer = (fn: (x: any) => any[]) =>
    (a: Record<string, any>, b: Record<string, any>): Cmp =>
        arrayCompare(fn(a), fn(b));

// myArray.sort(keyComparer('signature'));
// myArray.sort(fnComparer((x) => x.signature + x.path));
// myArray.sort(arrayComparer((x) => [x.signature, x.path]));
