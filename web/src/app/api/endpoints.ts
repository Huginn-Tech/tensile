/**
 * The API reference: the documented routes, in the order the page lists
 * them, each with its parameters and an example response. The page renders
 * from this file alone (page.tsx, reference.tsx).
 *
 * Each parameter's type, allowed values, range and default are the ones
 * observer-api enforces (fibre-sentinel/observer/api). The example
 * responses are real answers of the Mocha API (mocha-5), taken between 4
 * and 12 October 2026 with the Try it values below; all but the ones marked
 * `whole` are trimmed to a few fields. Nothing is added and no value is
 * changed.
 *
 * In descriptions and error lines, `backticks` mark a field or parameter.
 */

export type Param = {
  name: string;
  in: "path" | "query";
  /** the type as the table prints it */
  type: "string" | "integer" | "RFC 3339";
  /** the only values the route accepts; Try it offers them as a list */
  values?: string[];
  /** "1–500" */
  range?: string;
  default?: string;
  required?: boolean;
  desc: string;
  /** the value Try it starts with; none leaves the parameter out */
  example?: string;
};

export type Endpoint = {
  /** the row's anchor on the page */
  id: string;
  path: string;
  /** twelve words at most */
  summary: string;
  /** two short sentences at most, only where the summary is not enough */
  desc?: string;
  params: Param[];
  /** the route's own error answers, beyond the ones every route shares */
  errors?: string;
  /** a real answer; absent only until one is taken, when the page shows none */
  example?: string;
  /** the example is the whole answer, not a trimmed one */
  whole?: boolean;
  /** a second real answer, of another kind the route answers with: what it is ("a failure"), and whether it is whole */
  also?: { what: string; example: string; whole?: boolean };
  /** what the route answers with, when it is not JSON */
  format?: "atom" | "text";
};

export type Group = { id: string; title: string; endpoints: Endpoint[] };

// ---- parameters several routes share ----

// validators are written in the operator form, as the site links them
const HUGINN = "celestiavaloper1d2ktc37cme7ydk30ylzhamutcynhdvyet7nt3x";
const PUBLISHER = "celestia1las83d0dt9gew3faq2mxp2gtupq5drclee9snr";
const NAMESPACE = "00000000000000000000000000000000000000736f762d6e696b6f2d61";
const BLOB = "36f68ba9a781754e80037357ebf485d25e471332f436596904467099cfda2417";
// the transaction that settled BLOB
const TX = "e1ee077529fac8d580b8359758734af3b8f3e16bb28a634e8e9a58dfd41d8370";

const windowParam: Param = {
  name: "window", in: "query", type: "string", values: ["24h", "7d", "30d", "all"], default: "24h",
  desc: "The period the figures cover.", example: "7d",
};
const asOf: Param = {
  name: "as_of", in: "query", type: "RFC 3339",
  desc: "End the period at this time instead of now.",
};
const validatorAddr: Param = {
  name: "addr", in: "path", type: "string", required: true,
  desc: "The validator's operator address (celestiavaloper1…), or its consensus or account address.", example: HUGINN,
};
const rows: Param = {
  name: "rows", in: "query", type: "string", values: ["0", "1"], default: "0",
  desc: "1 adds each reading's `row_indices` and `rows_sha256`.",
};

// ---- example responses ----

const EX_VALIDATORS = `{
  "window": {"name": "7d"},
  "computed_at": "2026-10-04T14:29:17.748900805Z",
  "validators": [
    {
      "address": "e4401aea8b1f8359fe58216d70d78a402689a2a4",
      "moniker": "Huginn",
      "operator_address": "celestiavaloper1d2ktc37cme7ydk30ylzhamutcynhdvyet7nt3x",
      "host": "174.138.180.150:7980",
      "voting_power": 2100001,
      "endpoint_state": "reachable",
      "identity_status": "verified",
      "obligations": {
        "served": 1855,
        "broken": 0,
        "rate": {"num": 1855, "den": 1855, "value": 1}
      },
      "signing": {"assigned": 8524, "signed": 7815},
      "hosting": {"provider": "InterServer", "country": "US"}
    }
  ]
}`;

const EX_VALIDATOR = `{
  "window": {"name": "7d"},
  "validator": {
    "address": "e4401aea8b1f8359fe58216d70d78a402689a2a4",
    "moniker": "Huginn",
    "operator_address": "celestiavaloper1d2ktc37cme7ydk30ylzhamutcynhdvyet7nt3x",
    "endpoint_state": "reachable",
    "obligations": {
      "served": 279,
      "broken": 0,
      "not_counted": 0,
      "rate": {"num": 279, "den": 279, "value": 1}
    },
    "signing": {"assigned": 288, "signed": 279},
    "load": {"bytes": 350634496, "rows_per_blob": 148}
  },
  "windows": [
    {"window": {"name": "7d"}, "obligations": {"served": 279, "broken": 0}},
    {"window": {"name": "30d"}, "obligations": {"served": 2277, "broken": 0}}
  ],
  "network_reference": {"median_rate": 1, "validators": 79},
  "recent_probes": [
    {
      "promise_hash": "3a067a16beea3c589d9a6e7cad24d823d6663345155fadf63e2c373a02564651",
      "started_at": "2026-10-11T04:05:25.646767908Z",
      "outcome": "SERVED_OK",
      "classification": "HEALTHY",
      "rows_returned": 148,
      "service": "served",
      "settled_at": "2026-10-11T00:15:27.630572508Z",
      "settlement_tx_hash": "bac83a65ac59b85e4b7b5d3d9c3be6fbd528462d1a69b7f168049691b39077ec"
    }
  ],
  "recent_probes_truncated": true,
  "endpoint_history": [
    {
      "outcome": "changed",
      "height": 1498207,
      "tx_index": 0,
      "time": "2026-10-08T14:16:39.471280795Z",
      "tx_hash": "4f4b53a6c2bb9f1fd634b7d63f66c68a4e68ea9198573331ffb7c2796adc27b6",
      "host": "67.217.56.190:7980",
      "previous_host": "174.138.180.150:7980"
    },
    {
      "outcome": "failed",
      "height": 1498161,
      "tx_index": 0,
      "time": "2026-10-08T14:14:28.390034287Z",
      "tx_hash": "dc4d2bb8d076dc10ff10185b519bef91609c12904f5e63581d0a232310f1c8e4",
      "host": "67.217.56.190:7980",
      "attempted": "change",
      "reason": "Out of gas"
    },
    {
      "outcome": "registered",
      "height": 1095061,
      "tx_index": 0,
      "time": "2026-09-25T06:30:25.876417365Z",
      "tx_hash": "6f0377b258c0d6288e66fc08ab4a6d45382c9a8fe44f2049d75879aa62ec242f",
      "host": "174.138.180.150:7980"
    }
  ]
}`;

const EX_STATUS = `{
  "address": "e4401aea8b1f8359fe58216d70d78a402689a2a4",
  "operator_address": "celestiavaloper1d2ktc37cme7ydk30ylzhamutcynhdvyet7nt3x",
  "moniker": "Huginn",
  "host": "174.138.180.150:7980",
  "window": {"name": "7d"},
  "jailed": false,
  "bond_status": "BOND_STATUS_BONDED",
  "endpoint_state": "reachable",
  "identity_status": "verified",
  "obligations": {
    "served": 1855,
    "broken": 0,
    "rate": {"num": 1855, "den": 1855, "value": 1}
  },
  "signing": {
    "assigned": 8524,
    "signed": 7815,
    "last_endorsed_at": "2026-10-04T14:28:50.795350731Z"
  },
  "last_endpoint_check": {
    "at": "2026-10-04T14:27:12.361746574Z",
    "outcome": "REACHABLE"
  }
}`;

const EX_PROBES = `{
  "limit": 1,
  "truncated": true,
  "next_before": "2026-10-04T14:02:09.958745992Z",
  "probes": [
    {
      "promise_hash": "3c45d04e34f44378810e469b2df62404387b58247965bd9cb4534fdb1559aa4a",
      "validator_address": "e4401aea8b1f8359fe58216d70d78a402689a2a4",
      "operator_address": "celestiavaloper1d2ktc37cme7ydk30ylzhamutcynhdvyet7nt3x",
      "started_at": "2026-10-04T14:02:09.958745992Z",
      "outcome": "SERVED_OK",
      "classification": "HEALTHY",
      "rows_returned": 148,
      "rows_expected": 148,
      "total_duration_ms": 368,
      "service": "served"
    }
  ]
}`;

const EX_BLOBS = `{
  "blobs": [
    {
      "promise_hash": "36f68ba9a781754e80037357ebf485d25e471332f436596904467099cfda2417",
      "namespace": "00000000000000000000000000000000000000736f762d6e696b6f2d61",
      "blob_size": 16777216,
      "publisher": "celestia1las83d0dt9gew3faq2mxp2gtupq5drclee9snr",
      "settlement_height": 1204085,
      "settlement_tx_hash": "e1ee077529fac8d580b8359758734af3b8f3e16bb28a634e8e9a58dfd41d8370",
      "settlement_time": "2026-09-28T20:48:38.760812205Z",
      "blob_version": 0,
      "reconstructable": {
        "status": "yes",
        "served_distinct_rows": 8051,
        "needed_rows": 4096
      },
      "charge": {"fee_utia": 3530000}
    }
  ],
  "limit": 2,
  "offset": 0,
  "total": 8467,
  "truncated": true,
  "next_before_height": 1204085,
  "next_before_tx_index": 1
}`;

const EX_BLOB = `{
  "blob": {
    "promise_hash": "36f68ba9a781754e80037357ebf485d25e471332f436596904467099cfda2417",
    "blob_size": 16777216,
    "publisher": "celestia1las83d0dt9gew3faq2mxp2gtupq5drclee9snr",
    "settlement_tx_hash": "e1ee077529fac8d580b8359758734af3b8f3e16bb28a634e8e9a58dfd41d8370",
    "must_serve_until": "2026-09-29T00:48:35.807567083Z",
    "blob_version": 0,
    "reconstructable": {
      "status": "yes",
      "served_distinct_rows": 8051,
      "needed_rows": 4096
    },
    "charge": {"fee_utia": 3530000}
  },
  "assignments": [
    {
      "validator_address": "f345f91cd3c36238f550a024800c0a2cd0d7d49c",
      "operator_address": "celestiavaloper19jz75rcp26a6tkch208qm2wmt2ekk4a272cvlx",
      "row_count": 1451,
      "attested": true,
      "service": "served"
    }
  ],
  "probes": [
    {
      "validator_address": "f345f91cd3c36238f550a024800c0a2cd0d7d49c",
      "operator_address": "celestiavaloper19jz75rcp26a6tkch208qm2wmt2ekk4a272cvlx",
      "outcome": "SERVED_OK",
      "classification": "HEALTHY",
      "rows_returned": 1451,
      "total_duration_ms": 1849
    }
  ],
  "probes_truncated": false,
  "tx_cost": {
    "gas_wanted": 226943,
    "gas_used": 206399,
    "fee": "908utia",
    "fee_payer": "celestia1las83d0dt9gew3faq2mxp2gtupq5drclee9snr",
    "messages": 1
  }
}`;

const EX_TX = `{
  "tx_hash": "e1ee077529fac8d580b8359758734af3b8f3e16bb28a634e8e9a58dfd41d8370",
  "status": "success",
  "height": 1204085,
  "tx_index": 2,
  "time": "2026-09-28T20:48:38.760812205Z",
  "kind": "settlement",
  "messages": [
    {
      "index": 0,
      "type_url": "/celestia.fibre.v1.MsgPayForFibre",
      "fibre": true,
      "signer": "celestia1las83d0dt9gew3faq2mxp2gtupq5drclee9snr"
    }
  ],
  "cost": {
    "gas_wanted": 226943,
    "gas_used": 206399,
    "fee": "908utia",
    "fee_payer": "celestia1las83d0dt9gew3faq2mxp2gtupq5drclee9snr"
  },
  "effect": {
    "blob_size": 16777216,
    "blob_version": 0,
    "commitment": "3c6ead4767ad64b8ceaf869bb0a62e0ec4e0197729039681c2e48413c3be4766",
    "fee_paid_utia": 3530000,
    "namespace": "00000000000000000000000000000000000000736f762d6e696b6f2d61",
    "promise_hash": "36f68ba9a781754e80037357ebf485d25e471332f436596904467099cfda2417",
    "settled": true,
    "timed_out": false
  },
  "related": {
    "publisher": "celestia1las83d0dt9gew3faq2mxp2gtupq5drclee9snr",
    "blob": {
      "promise_hash": "36f68ba9a781754e80037357ebf485d25e471332f436596904467099cfda2417",
      "commitment": "3c6ead4767ad64b8ceaf869bb0a62e0ec4e0197729039681c2e48413c3be4766",
      "blob_version": 0,
      "must_serve_until": "2026-09-29T00:48:35.807567083Z",
      "reconstructable": {
        "status": "yes",
        "served_distinct_rows": 8051,
        "needed_rows": 4096
      }
    }
  }
}`;

const EX_TX_FAILED = `{
  "tx_hash": "2f9bb8f9f45408918797f115ba51fc7cedb27bc6531ec371c08dec143e78f5de",
  "status": "failed",
  "final": true,
  "height": 1083951,
  "tx_index": 0,
  "time": "2026-09-24T21:28:44.700721344Z",
  "kind": "set_host",
  "messages": [
    {
      "index": 0,
      "type_url": "/celestia.valaddr.v1.MsgSetFibreProviderInfo",
      "fibre": true,
      "signer": "celestiavaloper1nps4re4zt7klwajk0t958w6g0z763kgfnfwx97"
    }
  ],
  "cost": {"gas_wanted": 49054, "gas_used": 49712, "fee": "99utia"},
  "failure": {
    "code": 11,
    "codespace": "sdk",
    "reason": "Out of gas",
    "log": "out of gas in location: ReadFlat; gasWanted: 49054, gasUsed: 49712: out of gas"
  },
  "effect": {"attempted": "registration", "requested_host": "195.154.153.32:7980"},
  "related": {
    "validator": {
      "address": "61c7225d947271edd34f5f17f309ef77393492ab",
      "operator_address": "celestiavaloper1nps4re4zt7klwajk0t958w6g0z763kgfnfwx97",
      "moniker": "ChainSafe"
    }
  }
}`;

const EX_NAMESPACES = `{
  "namespaces": [
    {
      "namespace": "00000000000000000000000000000000000000000074656e73696c6500",
      "blobs": 33,
      "bytes": 550502400,
      "blobs_24h": 32,
      "bytes_24h": 550240256,
      "accounts": 1,
      "first_seen": "2026-10-01T17:18:06.819013523Z",
      "last_blob": "2026-10-04T14:28:50.795350731Z"
    }
  ],
  "limit": 3,
  "truncated": true
}`;

const EX_PUBLISHERS = `{
  "window": {"name": "7d"},
  "count": 5,
  "publishers": [
    {
      "publisher": "celestia1las83d0dt9gew3faq2mxp2gtupq5drclee9snr",
      "settlements": 8472,
      "bytes": 142723776512,
      "fees_utia": 30006960000,
      "fees_share": 0.9921409253965701,
      "paid_per_mib_utia": 220457.85823439521,
      "namespaces": [
        {"namespace": "00000000000000000000000000000000000000736f762d6e696b6f2d61", "settlements": 8467, "bytes": 142052687872}
      ],
      "namespaces_total": 2,
      "first_settlement_at": "2026-09-28T12:47:32.406462187Z",
      "last_settlement_at": "2026-10-02T14:54:50.445602763Z",
      "readings": {"available": 8329, "unavailable": 0, "in_retention_window": 0, "not_read": 143},
      "escrow": {"balance_utia": 19993040000, "available_utia": 19993040000}
    }
  ]
}`;

const EX_PUBLISHER = `{
  "window": {"name": "7d"},
  "publisher": {
    "publisher": "celestia1las83d0dt9gew3faq2mxp2gtupq5drclee9snr",
    "settlements": 8472,
    "fees_utia": 30006960000,
    "timeouts": 0,
    "first_settlement_at": "2026-09-28T12:47:32.406462187Z",
    "last_settlement_at": "2026-10-02T14:54:50.445602763Z",
    "readings": {"available": 8329, "unavailable": 0, "in_retention_window": 0, "not_read": 143},
    "escrow": {"balance_utia": 19993040000, "available_utia": 19993040000},
    "pending_withdrawals": {"count": 0, "utia": 0}
  },
  "windows": [
    {
      "window": {"name": "all"},
      "settlements": 8472,
      "namespaces": [
        {"namespace": "00000000000000000000000000000000000000736f762d6e696b6f2d61", "settlements": 8467, "bytes": 142052687872}
      ],
      "namespaces_total": 2
    }
  ],
  "recent_payments": [
    {
      "kind": "settlement",
      "height": 1204085,
      "time": "2026-09-28T20:48:38.760812205Z",
      "promise_hash": "36f68ba9a781754e80037357ebf485d25e471332f436596904467099cfda2417",
      "amount_utia": 3530000
    }
  ]
}`;

const EX_PUBLISHER_TXS = `{
  "publisher": "celestia1las83d0dt9gew3faq2mxp2gtupq5drclee9snr",
  "view": "escrow",
  "limit": 3,
  "offset": 0,
  "total": 2,
  "failed_total": 0,
  "txs": [
    {
      "kind": "deposit",
      "status": "success",
      "height": 1316265,
      "tx_index": 0,
      "msg_index": 0,
      "time": "2026-10-02T14:00:18.634759532Z",
      "tx_hash": "014a24c36ac087b8181f1ee9a3b9af355fc4baa889879f0b7d119df1cc785fb8",
      "amount_utia": 20000000000
    },
    {
      "kind": "deposit",
      "status": "success",
      "height": 1193648,
      "tx_index": 0,
      "msg_index": 0,
      "time": "2026-09-28T12:32:19.985143198Z",
      "tx_hash": "b4ed81c319c4b2aec4a9a1a8807d6f12031c1e0f0c7a91d962eb370d616d6197",
      "amount_utia": 30000000000
    }
  ],
  "sums": {
    "deposited_utia": 50000000000,
    "settlements": 8472,
    "fees_utia": 30006960000,
    "timeouts": 0,
    "charged_utia": 0,
    "withdrawn_utia": 0
  }
}`;

const EX_MARKET = `{
  "window": {"name": "7d"},
  "settlements": 8524,
  "blobs": 8524,
  "fees_settled_utia": 30244655000,
  "bytes": 143911550976,
  "publishers_active": 4,
  "timeouts": 0,
  "escrow_total_utia": 20873330000,
  "daily": [
    {
      "day": "2026-09-28",
      "settlements": 8472,
      "fees_utia": 29896305000,
      "bytes": 142079164416
    }
  ]
}`;

const EX_NETWORK = `{
  "window": {"name": "7d"},
  "registered_endpoints": 78,
  "reachability": {"num": 76, "den": 78, "value": 0.9743589743589743},
  "reachability_window": {"num": 156374, "den": 158666, "value": 0.9855545611536183},
  "obligations": {
    "served": 282534,
    "broken": 4,
    "not_counted": 172260,
    "rate": {"num": 282534, "den": 282538, "value": 0.9999858426123212}
  },
  "reconstructable": {
    "recoverable": {"num": 1999, "den": 1999, "value": 1},
    "yes": 1999,
    "no": 0,
    "not_read": 138,
    "publications_examined": 2000
  }
}`;

const EX_SIGNING = `{
  "window": {"name": "7d"},
  "threshold": {"num": 2, "den": 3},
  "promises": 8524,
  "meets_threshold": {"num": 8524, "den": 8524, "value": 1},
  "buckets": [
    {"key": "q_70", "label": "⅔ – 70%", "count": 6212},
    {"key": "70_75", "label": "70 – 75%", "count": 1661}
  ],
  "signers_median": 53
}`;

const EX_HOSTING = `{
  "summary": {
    "registered_hosts": 78,
    "resolved_hosts": 78,
    "by_provider": [
      {"key": "Scaleway", "hosts": 3, "stake_share": 0.14623101036259428}
    ],
    "nakamoto_third": {
      "provider": {
        "count": 3,
        "entities": ["Scaleway", "Cherry Servers", "GTHost"],
        "share": 0.3962039256745373
      }
    }
  }
}`;

const EX_PARAMS = `{
  "current": {
    "shard_retention_s": 14400,
    "payment_promise_timeout_s": 3600,
    "withdrawal_delay_s": 86400,
    "source": "seed"
  },
  "derived": {"must_serve_window_s": 14400},
  "changes": 0,
  "protocol": {
    "max_blob_size_bytes": 134217728,
    "min_rows_per_validator": 148,
    "max_rows_per_validator": 4096
  },
  "price_formula": {
    "base_gas": 650000,
    "gas_per_chunk": 45000,
    "chunk_bytes": 262144,
    "utia_per_gas": 1
  }
}`;

const EX_EXPORTS = `{
  "exports": [
    {
      "name": "tensile-ut-1-2026-09-29.tar.gz",
      "bytes": 30490344,
      "sha256": "0ea0eda3f14487eae44f44cd10ccd5329a09efe4186a1aebb95eb9b5de6177b6",
      "day": "2026-09-29",
      "methodology_version": "2026-10-02",
      "signature": {
        "algorithm": "ed25519",
        "key_fingerprint": "sha256:8eb4c98fd59e067ce8651f0edec06bcccc6d92b49b2ddd8161929ec3826a5412"
      }
    }
  ]
}`;

const EX_PUBKEY = `{
  "signed": true,
  "current": {
    "algorithm": "ed25519",
    "key_fingerprint": "sha256:8eb4c98fd59e067ce8651f0edec06bcccc6d92b49b2ddd8161929ec3826a5412",
    "public_key": "VgeY7esoNK5uSXdt0DRLdS0K74K3hneAD2Gx5T1vd8s=",
    "first_day": "2026-09-24",
    "last_day": "2026-10-03"
  }
}`;

const EX_META = `{
  "methodology_version": "2026-10-08",
  "chain_id": "mocha-5",
  "vantages": [
    {"name": "de-1", "newest_at": "2026-10-08T11:38:34.687949213Z", "primary": false},
    {"name": "ut-1", "newest_at": "2026-10-08T11:41:39.549261168Z", "primary": true}
  ],
  "app_version": "10",
  "fibre_app_version": "10",
  "fibre_active": true,
  "chain_height": "1494936",
  "counts": {"Publications": 8918, "Assignments": 731950, "Probes": 517247, "OpenEndpoints": 80, "Runs": 231},
  "last_probe_at": "2026-10-08T10:55:29.371169265Z",
  "server_time": "2026-10-08T11:41:48.842585946Z",
  "pin_status": "matches"
}`;

const EX_TIP = `{
  "height": 1377383,
  "block_time": "2026-10-04T14:29:36.479193218Z",
  "fibre_active": true,
  "latest_blob": {
    "promise_hash": "873f226127aafe95680a625a16b89906954447f97ab190f8bc16f84819269369",
    "settlement_height": 1377367
  },
  "server_time": "2026-10-04T14:29:40.842798062Z"
}`;

const EX_HEALTH = `{
  "status": "ok",
  "checks": [
    {"name": "prober", "ok": true, "detail": "alive"},
    {
      "name": "chain_liveness",
      "ok": true,
      "detail": "newest block 36s old (2026-10-04T14:29:05Z)"
    },
    {
      "name": "day_partials",
      "ok": true,
      "detail": "no audit found a difference, and no day due has stayed unsealed for two days"
    }
  ],
  "pin_status": "matches",
  "server_time": "2026-10-04T14:29:40.849080098Z",
  "day_partials": {
    "state": "on",
    "origin": "loaded",
    "sealed_row_days": 31,
    "sealed_settlement_days": 30,
    "ledger_built": true,
    "last_audit_at": "2026-10-04T14:12:03.511243118Z",
    "last_audit": "as the store holds them: row day 2026-09-17, settlement day 2026-09-17, ledger day 2026-09-17",
    "rebuilds": 0
  }
}`;

const EX_VALIDATOR_FEED = `<feed xmlns="http://www.w3.org/2005/Atom">
  <title type="text">Tensile · Huginn · Fibre endpoint events</title>
  <updated>2026-09-25T06:31:19Z</updated>
  <entry>
    <id>tag:tensile.huginn.tech,2026:tensile/mocha-5/e4401aea8b1f8359fe58216d70d78a402689a2a4/registration/1095061-1</id>
    <title type="text">Huginn: registered Fibre host 174.138.180.150:7980</title>
    <updated>2026-09-25T06:30:25Z</updated>
    <category term="registered"></category>
  </entry>
</feed>`;

const EX_FEED = `<feed xmlns="http://www.w3.org/2005/Atom">
  <title type="text">Tensile · mocha-5 · Fibre network events</title>
  <updated>2026-10-04T13:09:24Z</updated>
  <entry>
    <id>tag:tensile.huginn.tech,2026:tensile/mocha-5/5282878ddcbbe0d2e0ca42d54cb64711c901ba75/bonded-joined/20260929T181013Z</id>
    <updated>2026-09-29T18:10:13Z</updated>
    <category term="bonded-joined"></category>
    <summary type="text">First seen in AllBondedFibreProviders at height 1230995 with host 158.51.121.62:7980.</summary>
  </entry>
</feed>`;

const EX_EXPORT = `0ea0eda3f14487eae44f44cd10ccd5329a09efe4186a1aebb95eb9b5de6177b6  tensile-ut-1-2026-09-29.tar.gz`;

// ---- the reference ----

export const GROUPS: Group[] = [
  {
    id: "validators",
    title: "Validators",
    endpoints: [
      {
        id: "validators",
        path: "/v1/validators",
        summary: "Every validator on record, with service, endorsements and hosting.",
        desc: "A validator that is not bonded and has no open endpoint is listed only for a period that holds something of it; `/v1/validators/{addr}` answers for it in any period.",
        params: [windowParam, asOf],
        example: EX_VALIDATORS,
      },
      {
        id: "validator",
        path: "/v1/validators/{addr}",
        summary: "One validator's service, endorsements, load and newest readings.",
        desc: "`windows` repeats the service counts for 24h, 7d, 30d and all. `recent_probes` holds the newest 50 requests, not-probed ones left out, each with its blob's `settled_at` and `settlement_tx_hash`; `attempt` 1 or 2 is a request made again after an answer that did not serve. `endpoint_history` lists its Fibre endpoint registrations on chain, newest first, the newest 50 at most (`endpoint_history_truncated` when more were left out), then the endpoint it had when Tensile's record began; it is absent with `as_of` and for a validator with none. A row's `outcome` is registered, changed (from `previous_host`), same, failed (signed by its operator address, it changed nothing: `attempted` change or registration, and `reason`), before_record (the endpoint the record began with) or after_gap (registered while Tensile's record had a gap; `first` when it had none before); `tx_hash` is the transaction's, when Tensile recorded it.",
        params: [validatorAddr, windowParam, asOf],
        errors: "404 when no validator is on record at the address.",
        example: EX_VALIDATOR,
      },
      {
        id: "validator-status",
        path: "/v1/validators/{addr}/status",
        summary: "One validator's endpoint state, service, endorsements and last check.",
        params: [validatorAddr, windowParam],
        errors: "400 when `as_of` is given; 404 when no validator is on record at the address.",
        example: EX_STATUS,
      },
      {
        id: "validator-feed",
        path: "/v1/validators/{addr}/feed.atom",
        summary: "Atom feed of one validator's endpoint, bonded-list and first not-served events.",
        desc: "The newest 50 entries of the last 30 days. A reachability or certificate change is published once three checks in a row agree.",
        params: [validatorAddr],
        errors: "404 when no validator is on record at the address.",
        example: EX_VALIDATOR_FEED,
        format: "atom",
      },
      {
        id: "probes",
        path: "/v1/probes",
        summary: "Tensile's readings, newest first, by validator, blob, class or time.",
        desc: "One row per request; `attempt` 1 or 2 asks again after an answer that did not serve (owed while that answer carries `next_attempt_due`, `NOT_PROBED` when it could not start in time), and its `raw_error` names another request whose answer it repeats when the endpoint failed before any blob was asked for. `service` says what a request counts as; the last answer carries it.",
        params: [
          { name: "validator", in: "query", type: "string", desc: "A validator's operator address (celestiavaloper1…), or its consensus or account address.", example: HUGINN },
          { name: "blob", in: "query", type: "string", desc: "A promise hash, 64 hex characters." },
          { name: "class", in: "query", type: "string", desc: "A classification, such as HEALTHY, FAULT or UNREACHABLE.", example: "HEALTHY" },
          { name: "served", in: "query", type: "string", values: ["no"], desc: "Only the readings counted as not served." },
          { name: "since", in: "query", type: "RFC 3339", desc: "Readings started at or after this time." },
          { name: "before", in: "query", type: "RFC 3339", desc: "Readings started before this time: pass `next_before` for the next page." },
          { name: "at", in: "query", type: "RFC 3339", desc: "Readings scheduled at this time." },
          { name: "limit", in: "query", type: "integer", range: "1–1000; 1–200 with rows=1", default: "100", desc: "Readings per page.", example: "1" },
          rows,
        ],
        example: EX_PROBES,
      },
    ],
  },
  {
    id: "blobs",
    title: "Blobs",
    endpoints: [
      {
        id: "blobs",
        path: "/v1/blobs",
        summary: "Settled blobs, newest first, by namespace, commitment, transaction or publisher.",
        desc: "Filters combine, and `total` counts every blob the filters and the cursor select. Each blob carries `settlement_tx_hash`, the transaction that settled it, and `blob_version`, the first byte of the client's blob ID.",
        params: [
          { name: "namespace", in: "query", type: "string", desc: "A namespace, 58 hex characters.", example: NAMESPACE },
          { name: "commitment", in: "query", type: "string", desc: "A blob commitment, the client's blob ID without its version byte: 64 hex characters, either case, with or without 0x. An answer with no blob is not cached." },
          { name: "tx", in: "query", type: "string", desc: "The hash of the transaction that settled the blob: 64 hex characters, either case, with or without 0x. Asked on its own, a Fibre transaction that failed in a block answers `failed_tx` instead: its block, code, reason, messages, gas and error. An answer with no blob is not cached, unless it carries a `failed_tx` whose `ante_passed` is true." },
          { name: "publisher", in: "query", type: "string", desc: "The celestia1… account whose escrow paid." },
          { name: "limit", in: "query", type: "integer", range: "1–500", default: "50", desc: "Blobs per page.", example: "2" },
          { name: "before_height", in: "query", type: "integer", desc: "Blobs settled before this height: pass `next_before_height`." },
          { name: "before_tx_index", in: "query", type: "integer", range: "0 or more", default: "0", desc: "With `before_height`: pass `next_before_tx_index`." },
          { name: "offset", in: "query", type: "integer", range: "0–100000", default: "0", desc: "Blobs to skip, for numbered pages." },
          { name: "include_failed", in: "query", type: "string", values: ["0", "1"], default: "0", desc: "1 lists the blob payments that failed in a block among the blobs, in the same order and pages, each with `status` failed: the failed transaction's `settlement_height`, `settlement_tx_index`, `settlement_tx_hash` and `settlement_time`, its promise's `promise_hash`, `namespace` and `publisher`, the chain's `code`, `codespace` and `reason`, and `final`. Blobs then carry `status` success; `total` counts both and `failed_total` the failed ones. A failure that was not `final` and has since landed is left out: its blob is listed. Ignored with `commitment` or `tx`; a page holding a failure that is not `final` is not cached." },
        ],
        errors: "400 when `include_failed` is not 0 or 1.",
        example: EX_BLOBS,
      },
      {
        id: "blob",
        path: "/v1/blobs/{hash}",
        summary: "One blob: availability, charge, validators with rows, and readings.",
        desc: "The blob carries `settlement_tx_hash` and `blob_version`, as on /v1/blobs. `reconstructable.status` is yes (Available), no (Unavailable), pending, not_read or unknown. Each assignment's `service` is served, not_served, in_retention_window (until the window closes; `probes` carry the reading's result once it is in) or deadline_unverified. `tx_cost` is the settlement transaction's own `gas_wanted`, `gas_used`, `fee` and `fee_payer`, and `messages`, how many messages the fee paid for, when Tensile recorded them.",
        params: [
          { name: "hash", in: "path", type: "string", required: true, desc: "The blob's promise hash, 64 hex characters.", example: BLOB },
          rows,
        ],
        errors: "404 when no blob has this promise hash, not cached: asked again, a blob is found once it is recorded.",
        example: EX_BLOB,
      },
      {
        id: "tx",
        path: "/v1/txs/{hash}",
        summary: "One Fibre transaction by its hash, successful or failed.",
        desc: "`status` is success or failed; `kind` is settlement, deposit, withdrawal_request, timeout, set_host, or several when its Fibre messages are of more than one kind. `messages` lists every message in order, or with `messages_partial` only its Fibre messages, for a success Tensile found by its escrow movements before it recorded costs. `cost` is its gas and fee, with `fee_payer` on a success only, and is absent for a success from before Tensile recorded costs. A failure carries `final`, true when its fee and sequence were taken so it can never land, and `failure`: `code`, `codespace`, `reason`, `failed_msg_index`, `log`, and `log_cut` when the log was cut. `effect` is what it did: a settlement's `promise_hash`, `commitment`, `blob_version`, `namespace`, `blob_size`, `fee_paid_utia`, `settled` and `timed_out`; a deposit's, withdrawal request's or timeout's `amount_utia`, a timeout's `promise_hash`, and a request's `withdrawal` (`available_at`, `outcome` pending, paid or consumed, `paid_height`, `paid_at`, `payout_delay_s`, `reduced_utia`); an endpoint registration's `action` (registered, changed or same), `host` and `previous_host`. A failure's is what it asked for: a settlement's or timeout's `promise_hash` (and a settlement's `namespace` and `blob_size`), a deposit's or request's `requested` and `requested_utia`, a registration's `requested_host` with `attempted` and `host_at_block`, or `not_a_validator`; and `publisher`, as plain text, where `related` does not link one. `related` links the `publisher`, `blob`, `validator` or `validators` it touches. A success wins over a failure of the same hash; a failure that is not `final` could still land in a later block, so its answer is not cached, nor is a success whose `effect` and `related` are still empty, read before the rest of its block.",
        params: [
          { name: "hash", in: "path", type: "string", required: true, desc: "The transaction hash: 64 hex characters, either case, with or without 0x.", example: TX },
        ],
        errors: "400 when `hash` is not 64 hex characters; 404 when no Fibre transaction with this hash is on record, not cached: asked again, a transaction is found once its block is read.",
        example: EX_TX,
        also: { what: "a failure", example: EX_TX_FAILED, whole: true },
      },
      {
        id: "namespaces",
        path: "/v1/namespaces",
        summary: "Namespaces by newest settlement, with blob counts, bytes and accounts.",
        params: [
          { name: "limit", in: "query", type: "integer", range: "1–500", default: "100", desc: "Namespaces per answer.", example: "3" },
        ],
        example: EX_NAMESPACES,
      },
    ],
  },
  {
    id: "publishers",
    title: "Publishers",
    endpoints: [
      {
        id: "publishers",
        path: "/v1/publishers",
        summary: "Publishers with escrow movements in the period: fees, bytes, namespaces, escrow.",
        desc: "`namespaces` lists the period's ten most used; `first_settlement_at`, `last_settlement_at` and `readings` cover all time.",
        params: [windowParam, asOf],
        example: EX_PUBLISHERS,
      },
      {
        id: "publisher",
        path: "/v1/publishers/{addr}",
        summary: "One publisher: fees, escrow, withdrawals and recent payments.",
        desc: "`window` and `as_of` apply to the `publisher` object only; the rest of the answer is as of now. Each of `windows` lists its namespaces as a row does; the publisher's blobs are /v1/blobs?publisher=.",
        params: [
          { name: "addr", in: "path", type: "string", required: true, desc: "The publisher's celestia1… account.", example: PUBLISHER },
          windowParam, asOf,
        ],
        errors: "404 when the account has no escrow movement on record.",
        example: EX_PUBLISHER,
      },
      {
        id: "publisher-txs",
        path: "/v1/publishers/{addr}/txs",
        summary: "One publisher's Fibre transactions, successful and failed, newest first, paged.",
        desc: "Blob payments, deposits, withdrawal requests and timeouts, each with its `status`: a failure has `code`, `reason` and `final` and no `amount_utia`; a withdrawal request has its `payout`, `paid` only once a payout is on record. A page holding a failure that is not `final` is not cached.",
        params: [
          { name: "addr", in: "path", type: "string", required: true, desc: "The publisher's celestia1… account.", example: PUBLISHER },
          { name: "view", in: "query", type: "string", values: ["all", "escrow"], default: "all", desc: "escrow lists the deposits and withdrawal requests alone, with `sums`: what went in, the fees, the timed-out charges and the payouts, over the whole record.", example: "escrow" },
          { name: "limit", in: "query", type: "integer", range: "1–100", default: "25", desc: "Transactions per page.", example: "3" },
          { name: "offset", in: "query", type: "integer", range: "0–100000", default: "0", desc: "Transactions to skip, for numbered pages." },
        ],
        errors: "400 when `addr` is not a celestia1… account, `view` is neither all nor escrow, or `limit` or `offset` is out of range.",
        example: EX_PUBLISHER_TXS,
        whole: true,
      },
      {
        id: "market",
        path: "/v1/market",
        summary: "Blob market totals: settlements, fees, bytes, escrow, daily figures, readings.",
        desc: "`readings` counts every blob on record by Tensile's reading, available, unavailable and not_read, over the whole record whatever the period.",
        params: [windowParam, asOf],
        example: EX_MARKET,
      },
    ],
  },
  {
    id: "network",
    title: "Network",
    endpoints: [
      {
        id: "network",
        path: "/v1/network",
        summary: "Network service rate, availability and endpoint reachability.",
        desc: "`reachability` is the registered endpoints that answered their latest check, now; `reachability_window` is every endpoint check in the selected period that answered. `exclude` recomputes the figures without the named validators (availability still counts every validator), and `provisional_faults`, when present, counts the `broken` obligations that rest only on not-served readings under 30 minutes old, which can still be withdrawn.",
        params: [
          windowParam, asOf,
          { name: "exclude", in: "query", type: "string", desc: "Up to 8 validators in any address form, comma-separated or repeated." },
        ],
        example: EX_NETWORK,
      },
      {
        id: "signing",
        path: "/v1/signing",
        summary: "Endorsements per settled promise, against the ⅔ quorum.",
        params: [windowParam, asOf],
        example: EX_SIGNING,
      },
      {
        id: "hosting",
        path: "/v1/hosting",
        summary: "Where registered Fibre hosts run: by hosting provider, country and AS.",
        desc: "`nakamoto_third` is the fewest hosting providers, AS numbers or countries that together hold more than a third of the hosts' stake.",
        params: [],
        errors: "400 when `as_of` is given.",
        example: EX_HOSTING,
      },
      {
        id: "params",
        path: "/v1/params",
        summary: "x/fibre parameters and their history, protocol constants, the fee formula.",
        desc: "`derived.must_serve_window_s` is how long endorsing validators owe a blob's rows: the longer of shard retention and the promise timeout.",
        params: [],
        example: EX_PARAMS,
      },
      {
        id: "feed",
        path: "/v1/feed.atom",
        summary: "Network Atom feed: registrations, host changes, bonded list changes, first not-served readings.",
        desc: "The newest 50 entries of the last 30 days.",
        params: [],
        example: EX_FEED,
        format: "atom",
      },
    ],
  },
  {
    id: "exports",
    title: "Exports",
    endpoints: [
      {
        id: "exports",
        path: "/v1/exports",
        summary: "Daily archives of the record, one per UTC day, with digests.",
        desc: "Newest day first. Each archive names the key that signed it by `key_fingerprint`; the keys are /v1/exports/pubkey.",
        params: [
          { name: "limit", in: "query", type: "integer", range: "1–1500", default: "60", desc: "Days per page." },
          { name: "before", in: "query", type: "string", desc: "The days before this one, YYYY-MM-DD: pass `next_before` for the next page." },
        ],
        example: EX_EXPORTS,
      },
      {
        id: "exports-pubkey",
        path: "/v1/exports/pubkey",
        summary: "The ed25519 keys that sign archive manifests, with the days each signed.",
        params: [],
        errors: "404 when the archives are not signed.",
        example: EX_PUBKEY,
      },
      {
        id: "export",
        path: "/v1/exports/{name}",
        summary: "One archive, or its .sha256 digest or .sig signature.",
        desc: "Archives are gzip tarballs and take HTTP byte ranges.",
        params: [
          { name: "name", in: "path", type: "string", required: true, desc: "A name from /v1/exports, optionally ending in .sha256 or .sig.", example: "tensile-ut-1-2026-09-29.tar.gz.sha256" },
        ],
        errors: "404 when there is no such export; 416, as plain text, for a byte range past the end.",
        example: EX_EXPORT,
        whole: true,
        format: "text",
      },
    ],
  },
  {
    id: "status",
    title: "Status",
    endpoints: [
      {
        id: "meta",
        path: "/v1/meta",
        summary: "The methodology version, the chain, Fibre's activation and record counts.",
        desc: "`methodology_version` is the version of the rules every figure the API serves is computed under; each export manifest carries its own day's. `pin_status` is matches, chain_ahead, chain_behind or unknown: whether the chain's app version matches the celestia-app release Tensile is built against.",
        params: [],
        example: EX_META,
      },
      {
        id: "tip",
        path: "/v1/tip",
        summary: "The chain's newest block and the newest blob Tensile has recorded.",
        desc: "`height` and `block_time` are the chain node's newest committed block, at most a quarter of a second old, and the answer is not cached; `block_time` is absent only when the node does not answer and Tensile is still catching up to the tip. `latest_blob`, its `promise_hash` and `settlement_height`, is the first blob /v1/blobs lists, and absent while there is none: when it changes, a new blob is on record.",
        params: [],
        example: EX_TIP,
        whole: true,
      },
      {
        id: "health",
        path: "/v1/health",
        summary: "Tensile's status, ok, degraded or down, with each check behind it.",
        desc: "The status is down when no process is alive and degraded when any check fails, such as a stopped process, the chain's newest block over 10 minutes old or less than 15% of the disk free. `day_partials` is the per-day partials the 7d, 30d and all windows are summed from: `state` is on, off, loading or raw-fallback (an audit found them not what the store holds, and every window is read whole until the API restarts), with the days sealed, the oldest day due and not sealed, and the last hourly audit and what it found. Its check fails on raw-fallback, on an audit that found a sealed day not what the store holds, and on a day due and not sealed for over two days.",
        params: [],
        errors: "503 when the status is not ok, with the same body.",
        example: EX_HEALTH,
      },
    ],
  },
];
