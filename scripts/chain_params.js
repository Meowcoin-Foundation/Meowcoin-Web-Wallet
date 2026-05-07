import { reactive } from 'vue';

// In most BTC-derived coins, the below parameters can be found in the 'src/chainparams.cpp' Mainnet configuration.
// These below params share the same names as the CPP params, so finding and editing these is easy-peasy!
// <[network_byte] [32_byte_payload] [0x01] [4_byte_checksum]>
export const PRIVKEY_BYTE_LENGTH = 38;

export const COIN_DECIMALS = 8;
export const COIN = 10 ** 8;

/** The maximum gap (absence of transactions within a range of derived addresses) before an account search ends */
export const MAX_ACCOUNT_GAP = 20;

/* Internal tweaking parameters */
// A new encryption password must be 'at least' this long.
export const MIN_PASS_LENGTH = 6;

/** BIP21 coin prefix */
export const BIP21_PREFIX = 'mewc';

/* chainparams */
export const cChainParams = reactive({
    current: null,
    main: {
        name: 'mainnet',
        collateralInSats: 10000 * COIN,
        isTestnet: false,
        TICKER: 'MEWC',
        PUBKEY_PREFIX: ['M'],
        STAKING_PREFIX: 'M',
        PUBKEY_ADDRESS: 50,
        STAKING_ADDRESS: 122,
        SECRET_KEY: 112,
        BIP44_TYPE: 1669,
        BIP44_TYPE_LEDGER: 77,
        PROTOCOL_VERSION: 70030,
        MASTERNODE_PORT: 8788,
        blockExplorer: 'https://explorer.mewccrypto.com',
        // A list of Labs-trusted explorers
        Explorers: [
            { name: 'MEWC Electrs 1', url: 'https://electrs.mewccrypto.com' },
            { name: 'MEWC Electrs 2', url: 'https://electrs2.mewccrypto.com' },
            { name: 'MEWC Electrs 3', url: 'https://electrs3.meowcoin.org' },
        ],
        Nodes: [
	    { name: 'MEWC Node 1', url: 'seed-mainnet-mewc.meowcoin.cc' },
	    { name: 'MEWC Node 2', url: 'dnsseed.nodeslist.xyz' },
	    { name: 'MEWC Node 3', url: 'seed2-mainnet-mewc.testtopper.site' },
	],
        Consensus: {
            // Network upgrades
            UPGRADE_V6_0: undefined,
        },
        coinbaseMaturity: 100,
        budgetCycleBlocks: 43200,
        proposalFee: 50 * COIN,
        proposalFeeConfirmRequirement: 6,
        maxPaymentCycles: 6,
        maxPayment: 10 * 43200 * COIN, // 43200 blocks of 10 MEWC
        defaultColdStakingAddress: 'MdgQDpS8jDRJDX8yK8m9KnTMarsE84zdsy', // Labs Cold Pool
    },
    testnet: {
        name: 'testnet',
        collateralInSats: 10000 * COIN,
        isTestnet: true,
        TICKER: 'tMEWC',
        PUBKEY_PREFIX: ['m', 'm'],
        STAKING_PREFIX: 'm',
        PUBKEY_ADDRESS: 109,
        STAKING_ADDRESS: 124,
        SECRET_KEY: 114,
        BIP44_TYPE: 1,
        BIP44_TYPE_LEDGER: 1,
        PROTOCOL_VERSION: 70030,
        MASTERNODE_PORT: 4969,
        blockExplorer: 'https://explorer.mewccrypto.com',
        // A list of Labs-trusted explorers
        Explorers: [
            { name: 'MEWC Electrs 1', url: 'https://electrs.mewccrypto.com' },
            { name: 'MEWC Electrs 2', url: 'https://electrs2.mewccrypto.com' },
            { name: 'MEWC Electrs 3', url: 'https://electrs3.meowcoin.org' },
        ],
        Nodes: [
	    { name: 'MEWC TestNode1', url: 'seed-mainnet-mewc.meowcoin.cc' },
	    { name: 'MEWC TestNode2', url: 'dnsseed.nodeslist.xyz' },
	],
        Consensus: {
            // Network upgrades
            UPGRADE_V6_0: undefined,
        },
        coinbaseMaturity: 15,
        budgetCycleBlocks: 144,
        proposalFee: 50 * COIN,
        proposalFeeConfirmRequirement: 3,
        maxPaymentCycles: 20,
        maxPayment: 10 * 144 * COIN, // 144 blocks of 10 tMEWC
        defaultColdStakingAddress: 'mmNziUEPyhnUkiVdfsiNX93H6rSJnios44', // Sparrow's Testnet Cold Pool
    },
});
// Set default chain
cChainParams.current = cChainParams.main;
