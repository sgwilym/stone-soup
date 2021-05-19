import t = require('tap');
import { onFinishOneTest } from '../browser-run-exit';

import {
    AuthorKeypair
} from '../../util/doc-types';
import {
    ICryptoDriver,
} from '../../crypto/crypto-types';
import {
    isErr,
    ValidationError,
} from '../../util/errors';

import {
    stringToBytes
} from '../../util/bytes';
import {
    decodeAuthorKeypairToBytes,
    encodeAuthorKeypairToStrings,
} from '../../crypto/keypair';
import {
    GlobalCrypto,
    GlobalCryptoDriver,
    setGlobalCryptoDriver
} from '../../crypto/crypto';

//================================================================================

// use this unicode character for testing
let snowmanString = '\u2603';  // ☃ \u2603  [0xe2, 0x98, 0x83] -- 3 bytes
let snowmanBytes = Uint8Array.from([0xe2, 0x98, 0x83]);

//================================================================================

export let runCryptoTests = (driver: ICryptoDriver) => {
    let TEST_NAME = 'crypto shared tests';
    let SUBTEST_NAME = (driver as any).name;

    // Boilerplate to help browser-run know when this test is completed.
    // When run in the browser we'll be running tape, not tap, so we have to use tape's onFinish function.
    /* istanbul ignore next */ 
    (t.test as any)?.onFinish?.(() => onFinishOneTest(TEST_NAME, SUBTEST_NAME));

    t.test(SUBTEST_NAME + ': sha256 of strings', (t: any) => {
        setGlobalCryptoDriver(driver);

        let vectors : [string, string][] = [
            // input, output
            ['', 'b4oymiquy7qobjgx36tejs35zeqt24qpemsnzgtfeswmrw6csxbkq'],
            ['abc', 'bxj4bnp4pahh6uqkbidpf3lrceoyagyndsylxvhfucd7wd4qacwwq'],
            [snowmanString, 'bkfsdgyoht3fo6jni32ac3yspk4f2exm4fxy5elmu7lpbdnhum3ga'],
        ];

        for (let [input, output] of vectors) {
            t.equal(GlobalCrypto.sha256base32(input), output, `hash of ${JSON.stringify(input)}`);
        }
        t.same(driver, GlobalCryptoDriver, `GlobalCryptoDriver has not changed unexpectedly.  should be ${(driver as any).name}, was ${(GlobalCryptoDriver as any).name}`)
        t.end();
    });

    t.test(SUBTEST_NAME + ': sha256 of bytes', (t: any) => {
        setGlobalCryptoDriver(driver);

        let vectors : [Uint8Array, string][] = [
            // input, output
            [stringToBytes(''), 'b4oymiquy7qobjgx36tejs35zeqt24qpemsnzgtfeswmrw6csxbkq'],
            [Uint8Array.from([]), 'b4oymiquy7qobjgx36tejs35zeqt24qpemsnzgtfeswmrw6csxbkq'],
            [stringToBytes('abc'), 'bxj4bnp4pahh6uqkbidpf3lrceoyagyndsylxvhfucd7wd4qacwwq'],
            [Uint8Array.from([97, 98, 99]), 'bxj4bnp4pahh6uqkbidpf3lrceoyagyndsylxvhfucd7wd4qacwwq'],
            // snowman in utf-8
            [snowmanBytes, 'bkfsdgyoht3fo6jni32ac3yspk4f2exm4fxy5elmu7lpbdnhum3ga'],
        ];
        for (let [input, output] of vectors) {
            t.equal(GlobalCrypto.sha256base32(input), output, `hash of bytes: ${JSON.stringify(input)}`)
        }
        t.same(driver, GlobalCryptoDriver, `GlobalCryptoDriver has not changed unexpectedly.  should be ${(driver as any).name}, was ${(GlobalCryptoDriver as any).name}`)
        t.end();
    });

    t.test(SUBTEST_NAME + ': generateAuthorKeypair', (t: any) => {
        setGlobalCryptoDriver(driver);

        t.ok(isErr(GlobalCrypto.generateAuthorKeypair('abc')), 'error when author shortname is too short');
        t.ok(isErr(GlobalCrypto.generateAuthorKeypair('abcde')), 'error when author shortname is too long');
        t.ok(isErr(GlobalCrypto.generateAuthorKeypair('TEST')), 'error when author shortname is uppercase');
        t.ok(isErr(GlobalCrypto.generateAuthorKeypair('1abc')), 'error when author shortname starts with a number');
        t.ok(isErr(GlobalCrypto.generateAuthorKeypair('abc-')), 'error when author shortname has dashes');
        t.ok(isErr(GlobalCrypto.generateAuthorKeypair('abc.')), 'error when author shortname has a dot');
        t.ok(isErr(GlobalCrypto.generateAuthorKeypair('abc ')), 'error when author shortname has a space');
        t.ok(isErr(GlobalCrypto.generateAuthorKeypair('')), 'error when author shortname is empty');

        let keypair = GlobalCrypto.generateAuthorKeypair('ok99');
        if (isErr(keypair)) {
            t.ok(false, 'should have succeeded but instead was an error: ' + keypair);
            t.end();
            return;
        } else {
            t.equal(typeof keypair.address, 'string', 'keypair has address');
            t.equal(typeof keypair.secret, 'string', 'keypair has secret');
            t.ok(keypair.address.startsWith('@ok99.'), 'keypair.address starts with @ok99.');
            t.ok(keypair.secret.startsWith('b'), 'keypair.secret starts with "b"');
        }

        let keypair2 = GlobalCrypto.generateAuthorKeypair('ok99');
        if (isErr(keypair2)) {
            t.ok(false, 'should have succeeded but instead was an error: ' + keypair2);
        } else {
            t.notSame(keypair.address, keypair2.address, 'keypair crypto.generation is not deterministic (pubkeys differ)');
            t.notSame(keypair.secret, keypair2.secret, 'keypair crypto.generation is not deterministic (secrets differ)');
        }

        t.same(driver, GlobalCryptoDriver, `GlobalCryptoDriver has not changed unexpectedly.  should be ${(driver as any).name}, was ${(GlobalCryptoDriver as any).name}`)
        t.end();
    });

    t.test(SUBTEST_NAME + ': authorKeypairIsValid', (t: any) => {
        setGlobalCryptoDriver(driver);

        let keypair1 = GlobalCrypto.generateAuthorKeypair('onee');
        let keypair2 = GlobalCrypto.generateAuthorKeypair('twoo');
        if (isErr(keypair1)) { 
            t.ok(false, 'keypair1 was not generated successfully');
            t.end();
            return;
        }
        if (isErr(keypair2)) { 
            t.ok(false, 'keypair2 was not generated successfully');
            t.end();
            return;
        }

        t.equal(GlobalCrypto.checkAuthorKeypairIsValid(keypair1), true, 'keypair1 is valid');
        t.notSame(keypair1.secret, keypair2.secret, 'different keypairs have different secrets');

        t.ok(isErr(GlobalCrypto.checkAuthorKeypairIsValid({
            address: '',
            secret: keypair1.secret,
        })), 'empty address makes keypair invalid');

        t.ok(isErr(GlobalCrypto.checkAuthorKeypairIsValid({
            address: keypair1.address,
            secret: '',
        })), 'empty secret makes keypair invalid');

        t.ok(isErr(GlobalCrypto.checkAuthorKeypairIsValid({
            address: keypair1.address + 'a',
            secret: keypair1.secret,
        })), 'adding char to pubkey makes keypair invalid');

        t.ok(isErr(GlobalCrypto.checkAuthorKeypairIsValid({
            address: keypair1.address,
            secret: keypair1.secret + 'a'
        })), 'adding char to secret makes keypair invalid');

        t.ok(isErr(GlobalCrypto.checkAuthorKeypairIsValid({
            address: keypair1.address.slice(0, -8) + 'aaaaaaaa',
            secret: keypair1.secret,
        })), 'altering pubkey makes keypair invalid');

        t.ok(isErr(GlobalCrypto.checkAuthorKeypairIsValid({
            address: keypair1.address,
            secret: keypair1.secret.slice(0, -8) + 'aaaaaaaa',
        })), 'altering secret makes keypair invalid');

        t.ok(isErr(GlobalCrypto.checkAuthorKeypairIsValid({
            address: keypair1.address,
            secret: keypair2.secret,
        })), 'mixing address and secret from 2 different keypairs is invalid');

        t.ok(isErr(GlobalCrypto.checkAuthorKeypairIsValid({
            address: keypair1.address,
            secret: keypair1.secret.slice(0, -1) + '1',  // 1 is not a valid b32 character
        })), 'invalid b32 char in address makes keypair invalid');

        t.ok(isErr(GlobalCrypto.checkAuthorKeypairIsValid({
            address: keypair1.address,
            secret: keypair1.secret.slice(0, -1) + '1',  // 1 is not a valid b32 character
        })), 'invalid b32 char in secret makes keypair invalid');

        t.ok(isErr(GlobalCrypto.checkAuthorKeypairIsValid({
            secret: keypair1.secret,
        } as any)), 'missing address is invalid');

        t.ok(isErr(GlobalCrypto.checkAuthorKeypairIsValid({
            address: keypair1.address,
        } as any)), 'missing secret is invalid');

        t.same(driver, GlobalCryptoDriver, `GlobalCryptoDriver has not changed unexpectedly.  should be ${(driver as any).name}, was ${(GlobalCryptoDriver as any).name}`)
        t.end();
    });

    t.test(SUBTEST_NAME + ': encode/decode author keypair: from bytes to string and back', (t: any) => {
        setGlobalCryptoDriver(driver);

        let shortname = 'test';
        let keypair = GlobalCrypto.generateAuthorKeypair(shortname);
        if (isErr(keypair)) {
            t.ok(false, 'keypair 1 is an error');
            t.end();
            return;
        }
        let keypairBytes = decodeAuthorKeypairToBytes(keypair);
        if (isErr(keypairBytes)) {
            t.ok(false, 'keypairBytes is an error');
            t.end();
            return;
        };
        let keypair2 = encodeAuthorKeypairToStrings(shortname, keypairBytes);
        if (isErr(keypair2)) {
            t.ok(false, 'keypair 2 is an error');
            t.end();
            return;
        }
        let keypairBytes2 = decodeAuthorKeypairToBytes(keypair);
        if (isErr(keypairBytes2)) {
            t.ok(false, 'keypairBytes2 is an error');
            t.end();
            return;
        };

        t.same(keypair, keypair2, 'keypair encoding/decoding roundtrip matched (strings)');
        t.same(keypairBytes, keypairBytes2, 'keypair encoding/decoding roundtrip matched (bytes)');

        keypair.secret = 'x';
        let err1 = decodeAuthorKeypairToBytes(keypair);
        t.ok(isErr(err1), 'decodeAuthorKeypairToBytes returns an error if the secret is bad base32 (no leading "b")');

        keypair.secret = 'b1';
        let err2 = decodeAuthorKeypairToBytes(keypair);
        t.ok(isErr(err2), 'decodeAuthorKeypairToBytes returns an error if the secret is bad base32 (invalid base32 character)');

        // we test for base32-too-short later in another test

        t.same(driver, GlobalCryptoDriver, `GlobalCryptoDriver has not changed unexpectedly.  should be ${(driver as any).name}, was ${(GlobalCryptoDriver as any).name}`)
        t.end();
    });

    t.test(SUBTEST_NAME + ': signatures', (t: any) => {
        setGlobalCryptoDriver(driver);

        let input = 'abc';

        let keypair = GlobalCrypto.generateAuthorKeypair('test') as AuthorKeypair;
        let keypair2 = GlobalCrypto.generateAuthorKeypair('fooo') as AuthorKeypair;
        if (isErr(keypair) || isErr(keypair2)) {
            t.ok(false, 'keypair generation error');
            t.end(); return;
        }

        let sig = GlobalCrypto.sign(keypair, input);
        let sig2 = GlobalCrypto.sign(keypair2, input);
        if (isErr(sig)) {
            t.ok(false, 'signature error ' + sig);
            t.end(); return;
        }
        if (isErr(sig2)) {
            t.ok(false, 'signature error ' + sig2);
            t.end(); return;
        }

        t.ok(GlobalCrypto.verify(keypair.address, sig, input), 'real signature is valid');

        // ways a signature should fail
        t.notOk(GlobalCrypto.verify(keypair.address, 'bad sig', input), 'garbage signature is not valid');
        t.notOk(GlobalCrypto.verify(keypair.address, sig2, input), 'signature from another key is not valid');
        t.notOk(GlobalCrypto.verify(keypair.address, sig, 'different input'), 'signature is not valid with different input');
        t.notOk(GlobalCrypto.verify('@bad.address', sig, input), 'invalid author address = invalid signature, return false');

        // determinism
        t.equal(GlobalCrypto.sign(keypair, 'aaa'), GlobalCrypto.sign(keypair, 'aaa'), 'signatures should be deterministic');

        // changing input should change signature
        t.notEqual(GlobalCrypto.sign(keypair, 'aaa'), GlobalCrypto.sign(keypair, 'xxx'), 'different inputs should make different signature');
        t.notEqual(GlobalCrypto.sign(keypair, 'aaa'), GlobalCrypto.sign(keypair2, 'aaa'), 'different keys should make different signature');

        // encoding of input msg
        let snowmanStringSig = GlobalCrypto.sign(keypair, snowmanString);
        let snowmanBytesSig = GlobalCrypto.sign(keypair, snowmanBytes);
        if (isErr(snowmanStringSig)) {
            t.ok(false, 'signature error ' + snowmanStringSig);
            t.end(); return;
        }
        if (isErr(snowmanBytesSig)) {
            t.ok(false, 'signature error ' + snowmanBytesSig);
            t.end(); return;
        }
        t.ok(GlobalCrypto.verify(keypair.address, snowmanStringSig, snowmanString), 'signature roundtrip works on snowman utf-8 string');
        t.ok(GlobalCrypto.verify(keypair.address, snowmanBytesSig, snowmanBytes), 'signature roundtrip works on snowman Uint8Array');

        t.same(driver, GlobalCryptoDriver, `GlobalCryptoDriver has not changed unexpectedly.  should be ${(driver as any).name}, was ${(GlobalCryptoDriver as any).name}`)
        t.end();
    });

    t.test(SUBTEST_NAME + ': decodeAuthorKeypairToBytes checks Uint8Array length', (t: any) => {
        setGlobalCryptoDriver(driver);

        interface Vector {
            valid: Boolean,
            keypair: AuthorKeypair,
        }
        let vectors: Vector[] = [
            {
                valid: true,
                keypair: {
                    address: '@suzy.b724w6da6euw2ip7szpxopq2uodagdyswovh4pqd6ptnanz2u362a',
                    secret: 'bwgwycyh4gytyw4p2cp55t53wqhbxb7kqnj4assaazroviffuqn7a'
                },
            }, {
                valid: false,
                keypair: {
                    address: '@suzy.b724w6da6euw2ip7szpxopq2uodagdyswovh4pqd6ptnanz2u362a',
                    secret: 'b'  // valid base32 but wrong length
                },
            }, {
                valid: false,
                keypair: {
                    address: '@suzy.b724w6da6euw2ip7szpxopq2uodagdyswovh4pqd6ptnanz2u362a',
                    secret: 'b???'  // invalid base32
                },
            }, {
                valid: false,
                keypair: {
                    address: '@suzy.b724w6da6euw2ip7szpxopq2uodagdyswovh4pqd6ptnanz2u362a',
                    secret: 'baa'  // valid base32 but wrong length
                },
            }, {
                valid: false,
                keypair: {
                    address: '@suzy.b',  // valid base32 but wrong length
                    secret: 'bwgwycyh4gytyw4p2cp55t53wqhbxb7kqnj4assaazroviffuqn7a'
                },
            }, {
                valid: false,
                keypair: {
                    address: '@suzy.b???',  // invalid base32
                    secret: 'bwgwycyh4gytyw4p2cp55t53wqhbxb7kqnj4assaazroviffuqn7a'
                },
            }, {
                valid: false,
                keypair: {
                    address: '@suzy.baa',  // valid base32 but wrong length
                    secret: 'bwgwycyh4gytyw4p2cp55t53wqhbxb7kqnj4assaazroviffuqn7a'
                },
            }, {
                valid: false,
                keypair: {
                    address: '@suzy.724w6da6euw2ip7szpxopq2uodagdyswovh4pqd6ptnanz2u362a', // no b
                    secret: 'bwgwycyh4gytyw4p2cp55t53wqhbxb7kqnj4assaazroviffuqn7a'
                },
            }, {
                valid: false,
                keypair: {
                    address: '@suzy.b724w6da6euw2ip7szpxopq2uodagdyswovh4pqd6ptnanz2u362a',
                    secret: 'wgwycyh4gytyw4p2cp55t53wqhbxb7kqnj4assaazroviffuqn7a'  // no b
                },
            },
        ];

        for (let { valid, keypair } of vectors) {
            let keypairBytesOrErr = decodeAuthorKeypairToBytes(keypair);
            if (valid) {
                t.same(keypairBytesOrErr instanceof ValidationError, false, 'should not be an error: ' + JSON.stringify(keypair));
            } else {
                t.same(keypairBytesOrErr instanceof ValidationError, true, 'should be an error: ' + JSON.stringify(keypair));
            }
        }
        t.same(driver, GlobalCryptoDriver, `GlobalCryptoDriver has not changed unexpectedly.  should be ${(driver as any).name}, was ${(GlobalCryptoDriver as any).name}`)
        t.end();
    });

}