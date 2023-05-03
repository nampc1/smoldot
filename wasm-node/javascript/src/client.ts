// Smoldot
// Copyright (C) 2019-2022  Parity Technologies (UK) Ltd.
// SPDX-License-Identifier: GPL-3.0-or-later WITH Classpath-exception-2.0

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { MalformedJsonRpcError, PlatformBindings, start as startInstance } from './instance/instance.js';

export { MalformedJsonRpcError, QueueFullError, CrashError } from './instance/instance.js';

/**
 * Thrown in case of a problem when initializing the chain.
 */
export class AddChainError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "AddChainError"
    }
}

/**
 * Thrown in case the API user tries to use a chain or client that has already been destroyed.
 */
export class AlreadyDestroyedError extends Error {
    constructor() {
        super()
        this.name = "AlreadyDestroyedError"
    }
}

/**
 * Thrown when trying to send a JSON-RPC message to a chain whose JSON-RPC system hasn't been
 * enabled.
 */
export class JsonRpcDisabledError extends Error {
    constructor() {
        super()
        this.name = "JsonRpcDisabledError"
    }
}

/**
 * Client with zero or more active connections to blockchains.
 */
export interface Client {
    /**
     * Connects to a chain.
     *
     * After you've called this function, the client will verify whether the chain specification is
     * valid. Once this is done, the `Promise` returned by this function will yield a
     * {@link Chain} that can be used to interact with that chain. Only after the `Promise` has
     * yielded will the client actually start establishing networking connections to the chain.
     *
     * The `Promise` throws an exception if the chain specification isn't valid, or if the chain
     * specification concerns a parachain but no corresponding relay chain can be found.
     *
     * Smoldot will automatically de-duplicate chains if multiple identical chains are added, in
     * order to save resources. In other words, it is not a problem to call `addChain` multiple
     * times with the same chain specifications and obtain multiple {@link Chain} objects.
     * When the same client is used for multiple different purposes, you are in fact strongly
     * encouraged to trust smoldot and not attempt to de-duplicate chains yourself, as determining
     * whether two chains are identical is complicated and might have security implications.
     *
     * Smoldot tries to distribute CPU resources equally between all active {@link Chain} objects
     * of the same client.
     *
     * @param options Configuration of the chain to add.
     *
     * @throws {@link AddChainError} If the chain can't be added.
     * @throws {@link AlreadyDestroyedError} If the client has been terminated earlier.
     * @throws {@link CrashError} If the background client has crashed.
     */
    addChain(options: AddChainOptions): Promise<Chain>;

    /**
     * Terminates the client.
     *
     * This implicitly calls {@link Chain.remove} on all the chains associated with this client,
     * then shuts down the client itself.
     *
     * Afterwards, trying to use the client or any of its chains again will lead to an exception
     * being thrown.
     *
     * @throws {@link AlreadyDestroyedError} If the client has already been terminated earlier.
     * @throws {@link CrashError} If the background client has crashed.
     */
    terminate(): Promise<void>;
}

/**
 * Active connection to a blockchain.
 */
export interface Chain {
    /**
     * Enqueues a JSON-RPC request that the client will process as soon as possible.
     *
     * The response will be sent back using the callback passed when adding the chain.
     *
     * See <https://www.jsonrpc.org/specification> for a specification of the JSON-RPC format. Only
     * version 2 is supported.
     * Be aware that some requests will cause notifications to be sent back using the same callback
     * as the responses.
     *
     * A {@link MalformedJsonRpcError} is thrown if the request isn't a valid JSON-RPC request
     * (for example if it is not valid JSON) or if the request is unreasonably large (64 MiB at the
     * time of writing of this comment).
     * If, however, the request is a valid JSON-RPC request but that concerns an unknown method, or
     * if for example some parameters are missing, an error response is properly generated and
     * yielded through the JSON-RPC callback.
     * In other words, a {@link MalformedJsonRpcError} is thrown in situations where something
     * is *so wrong* with the request that it is not possible for smoldot to send back an error
     * through the JSON-RPC callback.
     *
     * Two JSON-RPC APIs are supported by smoldot:
     *
     * - The "legacy" one, documented here: <https://polkadot.js.org/docs/substrate/rpc>
     * - The more recent one: <https://github.com/paritytech/json-rpc-interface-spec>
     *
     * @param rpc JSON-encoded RPC request.
     *
     * @throws {@link MalformedJsonRpcError} If the payload isn't valid JSON-RPC.
     * @throws {@link QueueFullError} If the queue of JSON-RPC requests of the chain is full.
     * @throws {@link AlreadyDestroyedError} If the chain has been removed or the client has been terminated.
     * @throws {@link JsonRpcDisabledError} If the JSON-RPC system was disabled in the options of the chain.
     * @throws {@link CrashError} If the background client has crashed.
     */
    sendJsonRpc(rpc: string): void;

    /**
     * Waits for a JSON-RPC response or notification to be generated.
     *
     * Each chain contains a buffer of the responses waiting to be sent out. Calling this function
     * pulls one element from the buffer. If this function is called at a slower rate than responses
     * are generated, then the buffer will eventually become full, at which point calling
     * {@link Chain.sendJsonRpc} will throw an exception.
     *
     * If this function is called multiple times "simultaneously" (generating multiple different
     * `Promise`s), each `Promise` will return a different JSON-RPC response or notification. In
     * that situation, there is no guarantee in the ordering in which the responses or notifications
     * are yielded. Calling this function multiple times "simultaneously" is in general a niche
     * corner case that you are encouraged to avoid.
     *
     * @throws {@link AlreadyDestroyedError} If the chain has been removed or the client has been terminated.
     * @throws {@link JsonRpcDisabledError} If the JSON-RPC system was disabled in the options of the chain.
     * @throws {@link CrashError} If the background client has crashed.
     */
    nextJsonRpcResponse(): Promise<string>;

    /**
     * Disconnects from the blockchain.
     *
     * The JSON-RPC callback will no longer be called. This is the case immediately after this
     * function is called. Any on-going JSON-RPC request is instantaneously aborted.
     *
     * Trying to use the chain again will lead to an exception being thrown.
     *
     * If this chain is a relay chain, then all parachains that use it will continue to work. Smoldot
     * automatically keeps alive all relay chains that have an active parachains. There is no need
     * to track parachains and relay chains, or to destroy them in the correct order, as this is
     * handled automatically internally.
     *
     * @throws {@link AlreadyDestroyedError} If the chain has already been removed or the client has been terminated.
     * @throws {@link CrashError} If the background client has crashed.
     */
    remove(): void;
}

/**
 * @param level How important this message is. 1 = Error, 2 = Warn, 3 = Info, 4 = Debug, 5 = Trace
 * @param target Name of the sub-system that the message concerns.
 * @param message Human-readable message that developers can use to figure out what is happening.
 */
export type LogCallback = (level: number, target: string, message: string) => void;

/**
 * Configuration of a client.
 */
// TODO: these options aren't all used by the inner start; a bit spaghetti
export interface ClientOptions {
    /**
     * Callback that the client will invoke in order to report a log event.
     *
     * By default, prints the log on the `console`. If you want to disable logging altogether,
     * please pass an empty callback function.
     */
    logCallback?: LogCallback;

    /**
     * The client will never call the log callback with a value of `level` superior to this value.
     * Defaults to 3.
     *
     * While this filtering could be done manually in the `logCallback`, passing a maximum log level
     * leads to better performances as the client doesn't even need to generate a `message` when it
     * knows that this message isn't interesting.
     */
    maxLogLevel?: number;

    /**
     * Maximum amount of CPU that the client should consume on average.
     *
     * This must be a number between `0.0` and `1.0`. For example, passing `0.25` bounds the client
     * to 25% of CPU power.
     * Defaults to `1.0` if no value is provided.
     *
     * Note that this is implemented by sleeping for certain amounts of time in order for the average
     * CPU consumption to not go beyond the given limit. It is therefore still possible for the
     * client to use high amounts of CPU for short amounts of time.
     */
    cpuRateLimit?: number;

    /**
     * If `true`, then the client will never open any TCP connection.
     * Defaults to `false`.
     *
     * This option can be used in order to mimic an environment where the TCP protocol isn't
     * supported (e.g. browsers) from an environment where TCP is supported (e.g. NodeJS).
     *
     * This option has no effect in environments where the TCP protocol isn't supported anyway.
     */
    forbidTcp?: boolean;

    /**
     * If `true`, then the client will never open any non-secure WebSocket connection.
     * Defaults to `false`.
     *
     * This option can be used in order to mimic an environment where non-secure WebSocket
     * connections aren't supported (e.g. web pages) from an environment where they are supported
     * (e.g. NodeJS).
     *
     * This option has no effect in environments where non-secure WebSocket connections aren't
     * supported anyway.
     */
    forbidWs?: boolean;

    /**
     * If `true`, then the client will never open any non-secure WebSocket connection to addresses
     * other than `localhost` or `127.0.0.1`.
     * Defaults to `false`.
     *
     * This option is similar to `forbidWs`, except that connections to `localhost` and `127.0.0.1`
     * do not take the value of this option into account.
     *
     * This option can be used in order to mimic an environment where non-secure WebSocket
     * connections aren't supported (e.g. web pages) from an environment where they are supported
     * (e.g. NodeJS).
     *
     * This option has no effect in environments where non-secure WebSocket connections aren't
     * supported anyway.
     */
    forbidNonLocalWs?: boolean;

    /**
     * If `true`, then the client will never open any secure WebSocket connection.
     * Defaults to `false`.
     *
     * This option exists of the sake of completeness. All environments support secure WebSocket
     * connections.
     */
    forbidWss?: boolean;

    /**
     * If `true`, then the client will never open any WebRTC connection.
     * Defaults to `false`.
     *
     * This option has no effect in environments where non-secure WebSocket connections aren't
     * supported anyway.
     */
    forbidWebRtc?: boolean;
}

/**
 * Configuration of a blockchain.
 */
export interface AddChainOptions {
    /**
     * JSON-encoded specification of the chain.
     *
     * The specification of the chain can be generated from a Substrate node by calling
     * `<client> build-spec --raw > spec.json`. Only "raw" chain specifications are supported by
     * smoldot at the moment.
     *
     * If the chain specification contains a `relayChain` field, then smoldot will try to match
     * the value in `relayChain` with the value in `id` of the chains in
     * {@link AddChainOptions.potentialRelayChains}.
     */
    chainSpec: string;

    /**
     * Content of the database of this chain.
     *
     * The content of the database can be obtained by using the
     * `chainHead_unstable_finalizedDatabase` JSON-RPC function. This undocumented JSON-RPC function
     * accepts one parameter of type `number` indicating an upper limit to the size of the database.
     * The content of the database is always a UTF-8 string whose content is at the discretion of
     * the smoldot implementation.
     *
     * Smoldot reserves the right to change its database format, making previous databases
     * incompatible. For this reason, no error is generated if the content of the database is
     * invalid and/or can't be decoded.
     *
     * Providing a database can considerably improve the time it takes for smoldot to be fully
     * synchronized with a chain by reducing the amount of data that it has to download.
     * Furthermore, the database also contains a list of nodes that smoldot can use in order to
     * reduce the load that is being put on the bootnodes.
     *
     * Important: please note that using a malicious database content can lead to a security
     * vulnerability. This database content is considered by smoldot as trusted input. It is the
     * responsibility of the API user to make sure that the value passed in this field comes from
     * the same source of trust as the chain specification that was used when retrieving this
     * database content. In other words, if you load this database content for example from the disk
     * or from the browser's local storage, be absolutely certain that no malicious program has
     * modified the content of that file or local storage.
     */
    databaseContent?: string;

    /**
     * If `chainSpec` concerns a parachain, contains the list of chains whose `id` smoldot will try
     * to match with the parachain's `relayChain`.
     * Defaults to `[]`.
     *
     * Must contain exactly the {@link Chain} objects that were returned by previous calls to
     * `addChain`. The library uses a `WeakMap` in its implementation in order to identify chains.
     *
     * # Explanation and usage
     *
     * The primary way smoldot determines which relay chain is associated to a parachain is by
     * inspecting the chain specification of that parachain (i.e. the `chainSpec` field).
     *
     * This poses a problem in situations where the same client is shared between multiple different
     * applications: multiple applications could add mutiple different chains with the same `id`,
     * creating an ambiguity, or an application could register malicious chains with small variations
     * of a popular chain's `id` and try to benefit from a typo in a legitimate application's
     * `relayChain`.
     *
     * These problems can be solved by using this parameter to segregate multiple different uses of
     * the same client. To use it, pass the list of all chains that the same application has
     * previously added to the client. By doing so, you are guaranteed that the chains of multiple
     * different applications can't interact in any way (good or bad), while still benefiting from
     * the de-duplication of resources that smoldot performs in `addChain`.
     *
     * When multiple different parachains use the same relay chain, it is important to be sure that
     * they are indeed using the same relay chain, and not accidentally using different ones. For
     * this reason, this parameter is a list of potential relay chains in which only one chain
     * should match, rather than a single `Chain` corresponding to the relay chain.
     */
    potentialRelayChains?: Chain[];

    /**
     * Disables the JSON-RPC system of the chain.
     *
     * This option can be used in order to save up some resources.
     *
     * It will be illegal to call {@link Chain.sendJsonRpc} and {@link Chain.nextJsonRpcResponse} on
     * this chain.
     */
    disableJsonRpc?: boolean,
}

// This function is similar to the `start` function found in `index.ts`, except with an extra
// parameter containing the platform-specific bindings.
// Contrary to the one within `index.js`, this function is not supposed to be directly used.
export function start(options: ClientOptions, wasmModule: Promise<WebAssembly.Module>, platformBindings: PlatformBindings): Client {
    const logCallback = options.logCallback || ((level, target, message) => {
        // The first parameter of the methods of `console` has some printf-like substitution
        // capabilities. We don't really need to use this, but not using it means that the logs might
        // not get printed correctly if they contain `%`.
        if (level <= 1) {
            console.error("[%s] %s", target, message);
        } else if (level == 2) {
            console.warn("[%s] %s", target, message);
        } else if (level == 3) {
            console.info("[%s] %s", target, message);
        } else if (level == 4) {
            console.debug("[%s] %s", target, message);
        } else {
            console.trace("[%s] %s", target, message);
        }
    });

    // For each chain object returned by `addChain`, the associated internal chain id.
    //
    // Immediately cleared when `remove()` is called on a chain.
    const chainIds: WeakMap<Chain, number> = new WeakMap();

    // If `Client.terminate()̀  is called, this error is set to a value.
    // All the functions of the public API check if this contains a value.
    const alreadyDestroyedError: { value: null | AlreadyDestroyedError } = { value: null };

    const instance = startInstance({
        wasmModule,
        // Maximum level of log entries sent by the client.
        // 0 = Logging disabled, 1 = Error, 2 = Warn, 3 = Info, 4 = Debug, 5 = Trace
        maxLogLevel: options.maxLogLevel || 3,
        logCallback,
        cpuRateLimit: options.cpuRateLimit || 1.0,
    }, platformBindings);

    return {
        addChain: async (options: AddChainOptions): Promise<Chain> => {
            if (alreadyDestroyedError.value)
                throw alreadyDestroyedError.value;

            // Passing a JSON object for the chain spec is an easy mistake, so we provide a more
            // readable error.
            if (!(typeof options.chainSpec === 'string'))
                throw new Error("Chain specification must be a string");

            let potentialRelayChainsIds = [];
            if (!!options.potentialRelayChains) {
                for (const chain of options.potentialRelayChains) {
                    // The content of `options.potentialRelayChains` are supposed to be chains earlier
                    // returned by `addChain`.
                    const id = chainIds.get(chain);
                    if (id === undefined) // It is possible for `id` to be missing if it has earlier been removed.
                        continue;
                    potentialRelayChainsIds.push(id);
                }
            }

            const outcome = await instance.addChain(options.chainSpec, typeof options.databaseContent === 'string' ? options.databaseContent : "", potentialRelayChainsIds, !!options.disableJsonRpc);

            if (!outcome.success)
                throw new AddChainError(outcome.error);

            const chainId = outcome.chainId;
            const wasDestroyed = { destroyed: false };

            // `expected` was pushed by the `addChain` method.
            // Resolve the promise that `addChain` returned to the user.
            const newChain: Chain = {
                sendJsonRpc: (request) => {
                    if (alreadyDestroyedError.value)
                        throw alreadyDestroyedError.value;
                    if (wasDestroyed.destroyed)
                        throw new AlreadyDestroyedError();
                    if (options.disableJsonRpc)
                        throw new JsonRpcDisabledError();
                    if (request.length >= 64 * 1024 * 1024) {
                        throw new MalformedJsonRpcError();
                    };
                    instance.request(request, chainId);
                },
                nextJsonRpcResponse: () => {
                    if (alreadyDestroyedError.value)
                        return Promise.reject(alreadyDestroyedError.value);
                    if (wasDestroyed.destroyed)
                        return Promise.reject(new AlreadyDestroyedError());
                    if (options.disableJsonRpc)
                        return Promise.reject(new JsonRpcDisabledError());
                    return instance.nextJsonRpcResponse(chainId);
                },
                remove: () => {
                    if (alreadyDestroyedError.value)
                        throw alreadyDestroyedError.value;
                    if (wasDestroyed.destroyed)
                        throw new AlreadyDestroyedError();
                    wasDestroyed.destroyed = true;
                    console.assert(chainIds.has(newChain));
                    chainIds.delete(newChain);
                    instance.removeChain(chainId);
                },
            };

            chainIds.set(newChain, chainId);
            return newChain;
        },
        terminate: async () => {
            if (alreadyDestroyedError.value)
                throw alreadyDestroyedError.value
            alreadyDestroyedError.value = new AlreadyDestroyedError();
            instance.startShutdown()
        }
    }
}
