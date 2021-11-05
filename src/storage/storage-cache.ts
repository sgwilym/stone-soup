import isEqual from "fast-deep-equal";
import stringify from "fast-json-stable-stringify";

import { AuthorKeypair, Doc, DocToSet, Path } from "../util/doc-types";
import { isErr, StorageIsClosedError } from "../util/errors";
import { microsecondNow } from "../util/misc";
import { docMatchesFilter, cleanUpQuery } from "../query/query";
import { QueryFollower } from "../query-follower/query-follower";
import { Query } from "../query/query-types";
import { IngestEvent, IStorageAsync, LiveQueryEvent } from "./storage-types";
import { Crypto } from '../crypto/crypto';

//--------------------------------------------------

import { Logger } from "../util/log";
let logger = new Logger("storage cache", "cyan");

//================================================================================

// A synchronous, limited version of a storage.

// Lifted from StorageDriverAsyncMemory
// Slightly different in that it does not check if doc matches the filter,
// as this has been done beforehand by now.
function sortAndLimit(query: Query, docs: Doc[]) {
  let filteredDocs: Doc[] = [];

  for (let doc of docs) {
    if (query.orderBy === "path ASC") {
      if (query.startAfter !== undefined) {
        if (
          query.startAfter.path !== undefined &&
          doc.path <= query.startAfter.path
        ) {
          continue;
        }
        // doc.path is now > startAfter.path
      }
    }
    if (query.orderBy === "path DESC") {
      if (query.startAfter !== undefined) {
        if (
          query.startAfter.path !== undefined &&
          doc.path >= query.startAfter.path
        ) {
          continue;
        }
        // doc.path is now < startAfter.path (we're descending)
      }
    }
    if (query.orderBy === "localIndex ASC") {
      if (query.startAfter !== undefined) {
        if (
          query.startAfter.localIndex !== undefined &&
          (doc._localIndex || 0) <= query.startAfter.localIndex
        ) {
          continue;
        }
        // doc.path is now > startAfter.localIndex
      }
    }
    if (query.orderBy === "localIndex DESC") {
      if (query.startAfter !== undefined) {
        if (
          query.startAfter.localIndex !== undefined &&
          (doc._localIndex || 0) >= query.startAfter.localIndex
        ) {
          continue;
        }
        // doc.path is now < startAfter.localIndex (we're descending)
      }
    }

    // finally, here's a doc we want
    filteredDocs.push(doc);

    // stop when hitting limit
    if (query.limit !== undefined && filteredDocs.length >= query.limit) {
      break;
    }
  }

  return filteredDocs;
}

export class StorageCache {
  version = 0;
  _storage: IStorageAsync;

  _docCache = new Map<
    string,
    { docs: Doc[]; follower: QueryFollower; expires: number }
  >();

  _timeToLive: number;

  _onCacheUpdatedCallbacks = new Set<() => void | (() => Promise<void>)>();

  constructor(storage: IStorageAsync, timeToLive?: number) {
    this._storage = storage;
    this._timeToLive = timeToLive || 1000;
  }

  // GET

  getAllDocs(): Doc[] {
    if (this._storage.isClosed()) {
      throw new StorageIsClosedError();
    }
    return this.queryDocs({
      historyMode: "all",
      orderBy: "path DESC",
    });
  }

  getLatestDocs(): Doc[] {
    if (this._storage.isClosed()) {
      throw new StorageIsClosedError();
    }
    return this.queryDocs({
      historyMode: "latest",
      orderBy: "path DESC",
    });
  }

  getAllDocsAtPath(path: Path): Doc[] {
    if (this._storage.isClosed()) {
      throw new StorageIsClosedError();
    }
    return this.queryDocs({
      historyMode: "all",
      orderBy: "path DESC",
      filter: { path: path },
    });
  }

  getLatestDocAtPath(path: Path): Doc | undefined {
    if (this._storage.isClosed()) {
      throw new StorageIsClosedError();
    }
    let docs = this.queryDocs({
      historyMode: "latest",
      orderBy: "path DESC",
      filter: { path: path },
    });
    if (docs.length === 0) {
      return undefined;
    }
    return docs[0];
  }

  queryDocs(query: Query = {}): Doc[] {
    // make a deterministic string out of the query
    let cleanUpQueryResult = cleanUpQuery(query);

    if (cleanUpQueryResult.willMatch === "nothing") {
      return [];
    }

    let queryString = stringify(cleanUpQueryResult.query);

    // Check if the cache has anything from this
    // and if so, return it.
    const cachedResult = this._docCache.get(queryString);

    if (cachedResult) {
      // Query the storage, set the eventual result in the cache.
      this._storage.queryDocs(query).then((docs) => {
        this._docCache.set(queryString, { ...cachedResult, docs });
      });

      if (Date.now() > cachedResult.expires) {
        this._storage.queryDocs(query).then((docs) => {
          this._docCache.set(queryString, {
            follower,
            docs,
            expires: Date.now() + this._timeToLive,
          });
          logger.debug("⌛️");
          this._fireOnCacheUpdateds();
        });
      }

      return cachedResult.docs;
    }

    let follower = new QueryFollower(
      this._storage,
      { ...query, historyMode: "all", orderBy: "localIndex ASC" },
    );
    follower.bus.on(async (event: LiveQueryEvent) => {
      if (event.kind === 'existing' || event.kind === 'success') {
          logger.debug("🐣");
          this._updateCacheOptimistically(event.doc);
      }
    });

    // Add an entry to the cache.
    this._docCache.set(queryString, {
      docs: [],
      follower,
      expires: Date.now() + this._timeToLive,
    });

    // Hatch the follower.
    follower.hatch();

    this._storage.queryDocs(query).then((docs) => {
      this._docCache.set(queryString, {
        follower,
        docs,
        expires: Date.now() + this._timeToLive,
      });
      logger.debug("👹");
      this._fireOnCacheUpdateds();
    });

    // Return an empty result for the moment.
    return [];
  }

  // SET

  // Do a version of set which assumes this will be latest, and add that doc to the cache.
  // In the meantime, call set on the backing storage, and update results after.
  set(keypair: AuthorKeypair, docToSet: DocToSet): IngestEvent {
    if (this._storage.isClosed()) {
      throw new StorageIsClosedError();
    }

    let doc: Doc = {
      format: "es.4",
      author: keypair.address,
      content: docToSet.content,
      contentHash: Crypto.sha256base32(docToSet.content),
      deleteAfter: null,
      path: docToSet.path,
      timestamp: microsecondNow(),
      workspace: this._storage.workspace,
      signature: "?",
    };

    let signedDoc = this._storage.formatValidator.signDocument(keypair, doc);
    if (isErr(signedDoc)) {
      return {
          kind: 'failure',
          reason: 'invalid_document',
          err: signedDoc,
          maxLocalIndex: this._storage.storageDriver.getMaxLocalIndex(),
      }
    }

    // Update the cache optimistically
    logger.debug("🚂");
    this._updateCacheOptimistically(signedDoc);

    // Set with actual storage.
    this._storage.set(keypair, docToSet);

    // Assume this is accepted and latest for the moment.
    return {
        kind: 'success',
        maxLocalIndex: this._storage.storageDriver.getMaxLocalIndex(),
        doc: signedDoc,  // this is missing _localIndex for now
        docIsLatest: true,
        prevDocFromSameAuthor: null, // we don't actually know this
        prevLatestDoc: null, // we don't actually know this
    };
  }

  // OVERWRITE
  
  // We just call the backing storage's implementation
  // A user calling this method probably wants to be sure 
  // that their docs are _really_ deleted,
  // so we don't do a quick and dirty version in the cache here.

  overwriteAllDocsByAuthor(keypair: AuthorKeypair) {
    return this._storage.overwriteAllDocsByAuthor(keypair);
  }

  // CACHE

  // Update cache entries as best as we can until results from the backing storage arrive.
  _updateCacheOptimistically(doc: Doc): void {
    this._docCache.forEach((entry, key) => {
      const query: Query = JSON.parse(key);

      /*
      IF at least one document with same path is present
        AND historymode is latest
          AND doc has different author
            REPLACE
          OR doc has same author
            AND is different otherwise
              REPLACE
            OR is the same
              NOOP
        OR history mode is all
          AND doc has same author
            REPLACE one with same a
          OR doc has different author
            REPLACE
          
       
      OR zero documents with the same path
        AND query has a filter
          AND doc matches filter
            APPEND
          OR does not match filter
            NOOP
        OR query has no filter 
          APPEND
     */

      const appendDoc = () => {
        logger.debug("🥞");
        let nextDocs = [...entry.docs, doc];
        this._docCache.set(key, {
          ...entry,
          docs: sortAndLimit(query, nextDocs),
        });
        this._fireOnCacheUpdateds();
      };

      const replaceDoc = ({ exact }: { exact: boolean }) => {
        logger.debug("🔄");
        const nextDocs = entry.docs.map((existingDoc) => {
          if (
            exact &&
            existingDoc.path === doc.path &&
            existingDoc.author === doc.author
          ) {
            return doc;
          } else if (!exact && existingDoc.path === doc.path) {
            return doc;
          }

          return existingDoc;
        });

        this._docCache.set(key, {
          ...entry,
          docs: sortAndLimit(query, nextDocs),
        });
        this._fireOnCacheUpdateds();
      };

      const documentsWithSamePath = entry.docs.filter(
        (existingDoc) => existingDoc.path === doc.path
      );

      const documentsWithSamePathAndAuthor = entry.docs.filter(
        (existingDoc) =>
          existingDoc.path === doc.path && existingDoc.author === doc.author
      );

      if (documentsWithSamePath.length === 0) {
        if (
          (query.filter && docMatchesFilter(doc, query.filter)) ||
          !query.filter
        ) {
          appendDoc();
        }
        return;
      }

      const historyMode = query.historyMode || "latest";

      if (historyMode === "all") {
        if (documentsWithSamePathAndAuthor.length === 0) {
          appendDoc();
          return;
        }

        logger.debug("🕰");
        replaceDoc({ exact: true });
        return;
      }

      const latestDoc = documentsWithSamePath[0];

      // console.log({latestDoc, doc})

      const docIsDifferent =
        doc.author !== latestDoc?.author || !isEqual(doc, latestDoc);

      const docIsLater = doc.timestamp > latestDoc.timestamp;

      if (docIsDifferent && docIsLater) {
        logger.debug("⌚️");
        replaceDoc({ exact: false });
        return;
      }
    });
  }

  // SUBSCRIBE

  _fireOnCacheUpdateds() {
    this.version++;
    return Promise.all(
      Array.from(this._onCacheUpdatedCallbacks.values()).map((callback) => {
        return callback();
      })
    );
  }

  // Provide a function to be called when the storage cache knows its caller has stale results.
  onCacheUpdated(callback: () => void | (() => Promise<void>)): () => void {
    this._onCacheUpdatedCallbacks.add(callback);

    return () => {
      this._onCacheUpdatedCallbacks.delete(callback);
    };
  }
}
