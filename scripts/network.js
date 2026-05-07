import { cChainParams, MAX_ACCOUNT_GAP } from './chain_params.js';
import { createAlert } from './misc.js';
import { getEventEmitter } from './event_bus.js';
import {
    STATS,
    cStatKeys,
    cAnalyticsLevel,
    setExplorer,
    fAutoSwitch,
    debug,
} from './settings.js';
import { ALERTS, translation } from './i18n.js';
import { mempool, stakingDashboard } from './global.js';

/**
 * Virtual class rapresenting any network backend
 *
 */
export class Network {
    wallet;
    /**
     * @param {import('./wallet.js').Wallet} wallet
     */
    constructor(wallet) {
        if (this.constructor === Network) {
            throw new Error('Initializing virtual class');
        }
        this._enabled = true;
        this.wallet = wallet;
    }

    /**
     * @param {boolean} value
     */
    set enabled(value) {
        if (value !== this._enabled) {
            getEventEmitter().emit('network-toggle', value);
            this._enabled = value;
        }
    }

    get enabled() {
        return this._enabled;
    }

    enable() {
        this.enabled = true;
    }

    disable() {
        this.enabled = false;
    }

    toggle() {
        this.enabled = !this.enabled;
    }

    getFee(bytes) {
        // TEMPORARY: Hardcoded fee per-byte
        return bytes * 4350; // 50 sat/byte
    }

    get cachedBlockCount() {
        throw new Error('cachedBlockCount must be implemented');
    }

    error() {
        throw new Error('Error must be implemented');
    }

    getBlockCount() {
        throw new Error('getBlockCount must be implemented');
    }

    sentTransaction() {
        throw new Error('sendTransaction must be implemented');
    }

    submitAnalytics(_strType, _cData = {}) {
        throw new Error('submitAnalytics must be implemented');
    }

    setWallet(wallet) {
        this.wallet = wallet;
    }

    async getTxInfo(_txHash) {
        throw new Error('getTxInfo must be implemented');
    }
}

/**
 *
 */
export class ElectrsNetwork extends Network {
    /**
     * @param {string} strUrl - URL pointing to the electrs REST explorer
     */
    constructor(strUrl, wallet) {
        super(wallet);
        /**
         * @type{string}
         * @public
         */
        this.strUrl = strUrl;

        /**
         * @type{Number}
         * @private
         */
        this.blocks = 0;

        this.historySyncing = false;
        this.utxoFetched = false;
        this.fullSynced = false;
        this.lastBlockSynced = 0;
    }

    error() {
        if (this.enabled) {
            this.disable();
            createAlert('warning', ALERTS.CONNECTION_FAILED);
        }
    }

    get cachedBlockCount() {
        return this.blocks;
    }

    async getBlockCount() {
        try {
            const res = await retryWrapper(fetchElectrs, '/blocks/tip/height');
            const blocks = parseInt(await res.text());
            if (blocks > this.blocks) {
                getEventEmitter().emit('new-block', blocks, this.blocks);
                this.blocks = blocks;
                if (this.fullSynced) {
                    await this.getLatestTxs(this.lastBlockSynced);
                    this.lastBlockSynced = this.blocks;
                    stakingDashboard.update(0);
                    getEventEmitter().emit('new-tx');
                }
            }
        } catch (e) {
            this.error();
            throw e;
        }
        return this.blocks;
    }

    async getLatestTxs(_nStartHeight) {
        if (!this.wallet || !this.wallet.isLoaded()) return;
        if (debug) {
            console.time('getLatestTxsTimer');
        }

        const fetchAddressTxs = async (addr) => {
            const res = await retryWrapper(fetchElectrs, `/address/${addr}/txs`);
            return res.json();
        };

        if (!this.wallet.isHD()) {
            const txs = await fetchAddressTxs(this.wallet.getKeyToExport());
            for (const tx of txs) {
                mempool.updateMempool(mempool.parseTransaction(tx));
            }
        } else {
            for (const chain of [0, 1]) {
                this.wallet.loadAddresses(chain);
                let gap = 0;
                let index = 0;
                while (gap < MAX_ACCOUNT_GAP) {
                    const addr = this.wallet.getAddress(chain, index);
                    const txs = await fetchAddressTxs(addr);
                    if (txs.length > 0) {
                        gap = 0;
                        for (const tx of txs) {
                            mempool.updateMempool(mempool.parseTransaction(tx));
                        }
                    } else {
                        gap++;
                    }
                    index++;
                }
            }
        }

        mempool.setBalance();
        await mempool.saveOnDisk();

        if (debug) {
            console.log('getLatestTxs done, fullSynced?', this.fullSynced);
            console.timeEnd('getLatestTxsTimer');
        }
    }

    async walletFullSync() {
        if (this.fullSynced) return;
        if (!this.wallet || !this.wallet.isLoaded()) return;
        await this.getLatestTxs(this.lastBlockSynced);
        const nBlockHeights = Array.from(mempool.orderedTxmap.keys());
        this.lastBlockSynced =
            nBlockHeights.length == 0
                ? 0
                : nBlockHeights.sort((a, b) => a - b).at(-1);
        this.fullSynced = true;
        createAlert('success', translation.syncStatusFinished, 12500);
        getEventEmitter().emit('sync-status-update', 0, 0, true);
    }

    reset() {
        this.fullSynced = false;
        this.blocks = 0;
        this.lastBlockSynced = 0;
    }

    /**
     * @typedef {object} ElectrsUTXO
     * @property {string} txid - The TX hash of the output
     * @property {number} vout - The index position of the output
     * @property {number} value - The satoshi value of the output
     * @property {number} confirmations - The depth of the TX in the blockchain
     */

    /**
     * Fetch UTXOs from the current primary explorer
     * @param {string} strAddress - Optional address, gets UTXOs without changing MPW's state
     * @returns {Promise<Array<ElectrsUTXO>>} Resolves when it has finished fetching UTXOs
     */
    async getUTXOs(strAddress = '') {
        if (this.utxoFetched && !strAddress) {
            return;
        }
        if (!strAddress) {
            if (!this.wallet || !this.wallet.isLoaded()) return;
            if (this.isSyncing) return;
            this.isSyncing = true;
        }
        try {
            const normalizeUTXOs = (raw) =>
                raw.map((u) => ({
                    txid: u.txid,
                    vout: u.vout,
                    value: u.value,
                    confirmations: u.status.confirmed
                        ? Math.max(0, this.blocks - u.status.block_height)
                        : 0,
                }));

            const fetchUTXOsForAddr = async (addr) => {
                const res = await retryWrapper(
                    fetchElectrs,
                    `/address/${addr}/utxo`
                );
                return normalizeUTXOs(await res.json());
            };

            let allUTXOs = [];

            if (strAddress) {
                allUTXOs = await fetchUTXOsForAddr(strAddress);
            } else if (!this.wallet.isHD()) {
                allUTXOs = await fetchUTXOsForAddr(
                    this.wallet.getKeyToExport()
                );
            } else {
                for (const chain of [0, 1]) {
                    let gap = 0;
                    let index = 0;
                    while (gap < MAX_ACCOUNT_GAP) {
                        const addr = this.wallet.getAddress(chain, index);
                        const utxos = await fetchUTXOsForAddr(addr);
                        allUTXOs.push(...utxos);
                        gap = utxos.length > 0 ? 0 : gap + 1;
                        index++;
                    }
                }
            }

            if (this === getNetwork() && !strAddress) {
                this.utxoFetched = true;
                getEventEmitter().emit('utxo', allUTXOs);
            }

            return allUTXOs;
        } catch (e) {
            console.error(e);
            this.error();
        } finally {
            this.isSyncing = false;
        }
    }

    async sendTransaction(hex) {
        try {
            const res = await retryWrapper(fetchElectrs, '/tx', {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: hex,
            });
            const txid = (await res.text()).trim();

            if (!txid || txid.length !== 64) throw new Error('Invalid txid: ' + txid);

            console.log('Transaction sent! ' + txid);
            getEventEmitter().emit('transaction-sent', true, txid);
            return txid;
        } catch (e) {
            getEventEmitter().emit('transaction-sent', false, e);
            return false;
        }
    }

    async getTxInfo(txHash) {
        const req = await retryWrapper(fetchElectrs, `/tx/${txHash}`);
        const tx = await req.json();
        return {
            ...tx,
            blockHeight: tx.status.confirmed ? tx.status.block_height : -1,
        };
    }

    // MEWC Foundation Analytics: if you are a user, you can disable this FULLY via the Settings.
    // ... if you're a developer, we ask you to keep these stats to enhance upstream development,
    // ... but you are free to completely strip MPW of any analytics, if you wish, no hard feelings.
    submitAnalytics(strType, cData = {}) {
        if (!this.enabled) return;

        // TODO: rebuild Labs Analytics, submitAnalytics() will be disabled at code-level until this is live again
        /* eslint-disable */
        return;

        // Limit analytics here to prevent 'leakage' even if stats are implemented incorrectly or forced
        let i = 0,
            arrAllowedKeys = [];
        for (i; i < cAnalyticsLevel.stats.length; i++) {
            const cStat = cAnalyticsLevel.stats[i];
            arrAllowedKeys.push(cStatKeys.find((a) => STATS[a] === cStat));
        }

        // Check if this 'stat type' was granted permissions
        if (!arrAllowedKeys.includes(strType)) return false;

        // Format
        const cStats = { type: strType, ...cData };

        // Send to Labs Analytics
        const request = new XMLHttpRequest();
        request.open('POST', 'https://scpscan.net/mpw/statistic', true);
        request.setRequestHeader('Content-Type', 'application/json');
        request.send(JSON.stringify(cStats));
        return true;
    }
}

let _network = null;

/**
 * Sets the network in use by MPW.
 * @param {ElectrsNetwork} network - network to use
 */
export function setNetwork(network) {
    _network = network;
}

/**
 * Gets the network in use by MPW.
 * @returns {ElectrsNetwork?} Returns the network in use, may be null if MPW hasn't properly loaded yet.
 */
export function getNetwork() {
    return _network;
}

/**
 * A Fetch wrapper which uses the current electrs Network's base URL
 * @param {string} api - The specific electrs api to call
 * @param {RequestInit} options - The Fetch options
 * @returns {Promise<Response>} - The unresolved Fetch promise
 */
export function fetchElectrs(api, options) {
    return fetch(_network.strUrl + api, options);
}

/**
 * A wrapper for electrs calls which can, in the event of an unresponsive explorer,
 * seamlessly attempt the same call on multiple other explorers until success.
 * @param {Function} func - The function to re-attempt with
 * @param  {...any} args - The arguments to pass to the function
 */
async function retryWrapper(func, ...args) {
    // Track internal errors from the wrapper
    let err;

    // If allowed by the user, Max Tries is ALL MPW-supported explorers, otherwise, restrict to only the current one.
    let nMaxTries = cChainParams.current.Explorers.length;
    let retries = 0;

    // The explorer index we started at
    let nIndex = cChainParams.current.Explorers.findIndex(
        (a) => a.url === getNetwork().strUrl
    );

    // Run the call until successful, or all attempts exhausted
    while (retries < nMaxTries) {
        try {
            // Call the passed function with the arguments
            const res = await func(...args);

            // If the endpoint is non-OK, assume it's an error
            if (!res.ok) throw res;

            // Return the result if successful
            return res;
        } catch (error) {
            err = error;

            // If allowed, switch explorers
            if (!fAutoSwitch) throw err;
            nIndex = (nIndex + 1) % cChainParams.current.Explorers.length;
            const cNewExplorer = cChainParams.current.Explorers[nIndex];

            // Set the explorer at Network-class level, then as a hacky workaround for the current callback; we
            // ... adjust the internal URL to the new explorer.
            getNetwork().strUrl = cNewExplorer.url;
            setExplorer(cNewExplorer, true);

            // Bump the attempts, and re-try next loop
            retries++;
        }
    }

    // Throw an error so the calling code knows the operation failed
    throw err;
}
