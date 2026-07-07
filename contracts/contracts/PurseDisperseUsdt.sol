// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// PurseDisperseUsdt — the on-chain half of Purser Pay's non-custodial promise.
///
/// This contract is ownerless, immutable, and has no admin/pause/upgrade surface of
/// any kind. It never holds funds and never can: every transfer inside `disperse`
/// pulls from `msg.sender`'s own balance/allowance directly to each recipient in the
/// same call, so the only way money moves is if the caller has already approved this
/// contract to spend it. There is no `payable` function and no `receive`/`fallback`,
/// so the contract cannot even passively accumulate native TRX.
///
/// `disperse` is atomic by construction: if any single transfer in the batch fails,
/// the whole call reverts and every transfer that ran earlier in the same call is
/// unwound with it (ordinary EVM/TVM revert semantics — no manual rollback logic is
/// needed or present). There is no partial payout.
///
/// USDT-TRC20 has 6 decimals (1 USDT = 1_000_000 base units). This contract does no
/// decimal math whatsoever — `amounts` are raw base units, passed straight through to
/// `transferFrom` untouched. Converting a human amount (e.g. "2940 USDT") into base
/// units is the caller's responsibility, done off-chain before calling `disperse`.
contract PurseDisperseUsdt {
    using SafeERC20 for IERC20;

    /// Emitted once per successful disperse call. Per-recipient detail is not
    /// re-emitted here: every `transferFrom` below already causes `token` to emit its
    /// own standard `Transfer(msg.sender, recipient, amount)` event, which is what
    /// Tronscan already indexes per address — that covers per-recipient traceability
    /// (Sprint 3D's "individual" receipt links to it directly) at zero extra cost.
    /// This event covers the batch-level summary (Sprint 3D's "group" receipt).
    event Dispersed(
        address indexed payer,
        address indexed token,
        uint256 recipientCount,
        uint256 totalAmount
    );

    error LengthMismatch(uint256 recipientsLength, uint256 amountsLength);
    error EmptyBatch();
    error ZeroAddressRecipient(uint256 index);
    error ZeroAmount(uint256 index);

    /// Pulls `amounts[i]` of `token` from `msg.sender` to `recipients[i]`, for every
    /// index, in one atomic transaction. `msg.sender` is the only source of funds —
    /// there is no `from` parameter — so calling this can never move funds belonging
    /// to anyone other than whoever signs the transaction.
    function disperse(
        address token,
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external {
        uint256 len = recipients.length;

        // Distinct from the empty-batch guard below: mismatched lengths mean the
        // input itself is malformed (a recipient with no amount, or vice versa) —
        // reject before touching anything else, cheapest possible check.
        if (len != amounts.length) {
            revert LengthMismatch(len, amounts.length);
        }

        // `len == amounts.length == 0` passes the check above but is still a silent
        // no-op call — reject explicitly so a UI bug that resolves to "pay nobody"
        // can never masquerade as a successful, empty payout.
        if (len == 0) {
            revert EmptyBatch();
        }

        uint256 total = 0;

        for (uint256 i = 0; i < len; i++) {
            address recipient = recipients[i];
            uint256 amount = amounts[i];

            // Checked here rather than trusted to `token`'s own behavior — not every
            // ERC20/TRC20-shaped token is guaranteed to reject transfers to the zero
            // address itself, and this contract's safety promise shouldn't depend on
            // an arbitrary, caller-supplied token being defensive about it.
            if (recipient == address(0)) {
                revert ZeroAddressRecipient(i);
            }

            // A zero-amount row is virtually always a data/mapping bug (an unmapped
            // column, a zeroed-out split), never an intentional instruction. Left
            // unchecked, `transferFrom(msg.sender, recipient, 0)` would still succeed
            // against most compliant tokens and still emit a Transfer event —
            // indistinguishable, to a naive UI or on Tronscan, from a real payment.
            // That would let a roster row read "paid" when nothing moved: the exact
            // silent-wrong-money failure this product exists to prevent.
            if (amount == 0) {
                revert ZeroAmount(i);
            }

            // SafeERC20, not a plain interface call: `token` is caller-supplied, so
            // this contract's atomicity guarantee can't depend on trusting that
            // whatever token gets passed in reverts (rather than silently returning
            // false) on failure — a real, documented class of non-compliant ERC20
            // behavior. safeTransferFrom reverts on either failure mode.
            IERC20(token).safeTransferFrom(msg.sender, recipient, amount);

            total += amount;
        }

        emit Dispersed(msg.sender, token, len, total);
    }
}
