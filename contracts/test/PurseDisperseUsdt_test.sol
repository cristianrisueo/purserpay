// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// These are Remix/TronIDE "Solidity Unit Testing" tests — run directly from the
// Unit Testing plugin, no separate JS toolchain. remix_tests.sol / remix_accounts.sol
// are virtual imports the IDE resolves internally; they aren't real files in this
// repo. Each contract below is one independent test suite: `beforeAll` sets up that
// suite's own fresh token + disperse contract, and every public non-hook function is
// one test case, asserted via the `Assert` library. Because the test contract itself
// is what calls `disperseContract.disperse(...)`, `msg.sender` inside disperse() is
// this contract's own address — so each suite mints/approves to `address(this)` and
// acts as its own "payer," exactly like the reference BallotTest example calls
// `ballotToTest.vote(0)` directly.
//
// Every assertion checks actual token balances moved (or didn't), not merely whether
// a call reverted — a call reverting for the wrong reason, or "succeeding" while
// silently mis-paying someone, would pass a reverted-only check.

import "remix_tests.sol";
import "remix_accounts.sol";
import "../PurseDisperseUsdt.sol";
import "../mocks/MockUsdtTrc20.sol";

// 1. THE core money-correctness test. Distinct (non-equal) amounts per recipient —
// if the contract ever mixed up an index (e.g. amounts[i] landing on
// recipients[i+1]), equal amounts would hide it; distinct amounts can't.
contract CoreCorrectnessTest {
    MockUsdtTrc20 token;
    PurseDisperseUsdt disperseContract;
    address r1;
    address r2;
    address r3;
    address r4;

    function beforeAll() public {
        token = new MockUsdtTrc20();
        disperseContract = new PurseDisperseUsdt();
        r1 = TestsAccounts.getAccount(1);
        r2 = TestsAccounts.getAccount(2);
        r3 = TestsAccounts.getAccount(3);
        r4 = TestsAccounts.getAccount(4);
    }

    function checkEachRecipientGetsExactlyItsAmount() public {
        uint256 a1 = 100_000000;
        uint256 a2 = 250_000000;
        uint256 a3 = 75_500000;
        uint256 a4 = 1_000000;
        uint256 sum = a1 + a2 + a3 + a4;

        token.mint(address(this), sum);
        token.approve(address(disperseContract), sum);

        address[] memory recipients = new address[](4);
        recipients[0] = r1;
        recipients[1] = r2;
        recipients[2] = r3;
        recipients[3] = r4;
        uint256[] memory amounts = new uint256[](4);
        amounts[0] = a1;
        amounts[1] = a2;
        amounts[2] = a3;
        amounts[3] = a4;

        disperseContract.disperse(address(token), recipients, amounts);

        Assert.equal(token.balanceOf(r1), a1, "r1 should receive exactly a1");
        Assert.equal(token.balanceOf(r2), a2, "r2 should receive exactly a2");
        Assert.equal(token.balanceOf(r3), a3, "r3 should receive exactly a3");
        Assert.equal(token.balanceOf(r4), a4, "r4 should receive exactly a4");
        Assert.equal(token.balanceOf(address(this)), uint256(0), "payer should be fully debited");
    }
}

// 2. Atomicity when a batch fails PARTWAY through, not at the first index. Recipient
// 1 is individually affordable against the remaining allowance at the moment it's
// attempted, recipient 2 is not — so recipient 1's transfer must be rolled back too,
// even though it "succeeded" transiently within the same call. This is what actually
// proves the contract leans on Solidity's revert-unwinds-the-whole-call-frame
// semantics, not just early input rejection.
contract MidBatchAtomicityTest {
    MockUsdtTrc20 token;
    PurseDisperseUsdt disperseContract;
    address r1;
    address r2;
    address r3;

    function beforeAll() public {
        token = new MockUsdtTrc20();
        disperseContract = new PurseDisperseUsdt();
        r1 = TestsAccounts.getAccount(1);
        r2 = TestsAccounts.getAccount(2);
        r3 = TestsAccounts.getAccount(3);
    }

    function checkWholeBatchRevertsAndEarlierTransfersAreUndone() public {
        uint256 a1 = 300_000000;
        uint256 a2 = 300_000000;
        uint256 a3 = 300_000000;
        uint256 totalMinted = a1 + a2 + a3;
        uint256 approved = 500_000000; // covers r1 (300), not enough left for r2 (needs 300, only 200 remains)

        token.mint(address(this), totalMinted);
        token.approve(address(disperseContract), approved);

        address[] memory recipients = new address[](3);
        recipients[0] = r1;
        recipients[1] = r2;
        recipients[2] = r3;
        uint256[] memory amounts = new uint256[](3);
        amounts[0] = a1;
        amounts[1] = a2;
        amounts[2] = a3;

        bool reverted = false;
        try disperseContract.disperse(address(token), recipients, amounts) {
            reverted = false;
        } catch {
            reverted = true;
        }

        Assert.ok(reverted, "batch should revert when allowance runs out partway through");
        Assert.equal(token.balanceOf(r1), uint256(0), "r1 must be rolled back even though it ran first");
        Assert.equal(token.balanceOf(r2), uint256(0), "r2 should never have been paid");
        Assert.equal(token.balanceOf(r3), uint256(0), "r3 should never have been paid");
        Assert.equal(token.balanceOf(address(this)), totalMinted, "payer balance must be fully unchanged");
    }
}

// 3. Malformed input: a recipient with no corresponding amount (or vice versa) is
// nonsensical data, not a payable batch — reject before touching anything else.
contract LengthMismatchTest {
    MockUsdtTrc20 token;
    PurseDisperseUsdt disperseContract;

    function beforeAll() public {
        token = new MockUsdtTrc20();
        disperseContract = new PurseDisperseUsdt();
    }

    function checkRevertsOnLengthMismatch() public {
        address[] memory recipients = new address[](2);
        recipients[0] = TestsAccounts.getAccount(1);
        recipients[1] = TestsAccounts.getAccount(2);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 100_000000;

        try disperseContract.disperse(address(token), recipients, amounts) {
            Assert.ok(false, "expected revert but disperse succeeded");
        } catch (bytes memory lowLevelData) {
            bytes4 selector = bytes4(lowLevelData);
            Assert.equal(
                uint32(selector),
                uint32(PurseDisperseUsdt.LengthMismatch.selector),
                "expected LengthMismatch error"
            );
        }
    }
}

// 4. An empty batch passes the length-equality check (0 == 0) but is still a silent
// no-op — reject explicitly so a UI bug that resolves to "pay nobody" can never
// masquerade as a successful, empty payout.
contract EmptyBatchTest {
    MockUsdtTrc20 token;
    PurseDisperseUsdt disperseContract;

    function beforeAll() public {
        token = new MockUsdtTrc20();
        disperseContract = new PurseDisperseUsdt();
    }

    function checkRevertsOnEmptyBatch() public {
        address[] memory recipients = new address[](0);
        uint256[] memory amounts = new uint256[](0);

        try disperseContract.disperse(address(token), recipients, amounts) {
            Assert.ok(false, "expected revert but disperse succeeded");
        } catch (bytes memory lowLevelData) {
            bytes4 selector = bytes4(lowLevelData);
            Assert.equal(
                uint32(selector),
                uint32(PurseDisperseUsdt.EmptyBatch.selector),
                "expected EmptyBatch error"
            );
        }
    }
}

// 5. Zero-address recipient, deliberately NOT at index 0 — proves the guard checks
// every index, and that a recipient positioned BEFORE the bad entry also gets rolled
// back (same atomicity property as test 2, triggered by input validation rather than
// a failed transfer).
contract ZeroAddressRecipientTest {
    MockUsdtTrc20 token;
    PurseDisperseUsdt disperseContract;
    address r1;
    address r3;

    function beforeAll() public {
        token = new MockUsdtTrc20();
        disperseContract = new PurseDisperseUsdt();
        r1 = TestsAccounts.getAccount(1);
        r3 = TestsAccounts.getAccount(3);
    }

    function checkRevertsOnZeroAddressAndRollsBackEarlierTransfer() public {
        uint256 amount = 100_000000;
        uint256 sum = amount * 3;

        token.mint(address(this), sum);
        token.approve(address(disperseContract), sum);

        address[] memory recipients = new address[](3);
        recipients[0] = r1;
        recipients[1] = address(0);
        recipients[2] = r3;
        uint256[] memory amounts = new uint256[](3);
        amounts[0] = amount;
        amounts[1] = amount;
        amounts[2] = amount;

        try disperseContract.disperse(address(token), recipients, amounts) {
            Assert.ok(false, "expected revert but disperse succeeded");
        } catch (bytes memory lowLevelData) {
            bytes4 selector = bytes4(lowLevelData);
            Assert.equal(
                uint32(selector),
                uint32(PurseDisperseUsdt.ZeroAddressRecipient.selector),
                "expected ZeroAddressRecipient error"
            );
        }

        Assert.equal(token.balanceOf(r1), uint256(0), "r1 must be rolled back even though it came first");
        Assert.equal(token.balanceOf(address(this)), sum, "payer balance must be fully unchanged");
    }
}

// 6. A zero-amount row is virtually always a data/mapping bug, never an intentional
// instruction — must revert rather than silently succeed as a no-op transfer that
// could still read as "paid" on Tronscan or in a naive UI.
contract ZeroAmountTest {
    MockUsdtTrc20 token;
    PurseDisperseUsdt disperseContract;
    address r1;
    address r2;

    function beforeAll() public {
        token = new MockUsdtTrc20();
        disperseContract = new PurseDisperseUsdt();
        r1 = TestsAccounts.getAccount(1);
        r2 = TestsAccounts.getAccount(2);
    }

    function checkRevertsOnZeroAmountAndRollsBackEarlierTransfer() public {
        uint256 amount = 100_000000;

        token.mint(address(this), amount);
        token.approve(address(disperseContract), amount);

        address[] memory recipients = new address[](2);
        recipients[0] = r1;
        recipients[1] = r2;
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = amount;
        amounts[1] = 0;

        try disperseContract.disperse(address(token), recipients, amounts) {
            Assert.ok(false, "expected revert but disperse succeeded");
        } catch (bytes memory lowLevelData) {
            bytes4 selector = bytes4(lowLevelData);
            Assert.equal(
                uint32(selector),
                uint32(PurseDisperseUsdt.ZeroAmount.selector),
                "expected ZeroAmount error"
            );
        }

        Assert.equal(token.balanceOf(r1), uint256(0), "r1 must be rolled back even though it came first");
        Assert.equal(token.balanceOf(address(this)), amount, "payer balance must be fully unchanged");
    }
}

// 7. Insufficient allowance from the very start (never approved) — the simpler, far
// more common real-world case (agency wallet forgot to approve/top up). Deliberately
// a different root cause from test 2 (zero approval vs. an allowance that runs out
// partway) so the two read as distinct money stories, not duplicates.
contract ZeroApprovalFromStartTest {
    MockUsdtTrc20 token;
    PurseDisperseUsdt disperseContract;
    address r1;
    address r2;

    function beforeAll() public {
        token = new MockUsdtTrc20();
        disperseContract = new PurseDisperseUsdt();
        r1 = TestsAccounts.getAccount(1);
        r2 = TestsAccounts.getAccount(2);
    }

    function checkRevertsCleanlyWithNoApproval() public {
        uint256 amount = 100_000000;
        token.mint(address(this), amount * 2);
        // No approve() call at all — allowance stays at the default of 0.

        address[] memory recipients = new address[](2);
        recipients[0] = r1;
        recipients[1] = r2;
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = amount;
        amounts[1] = amount;

        bool reverted = false;
        try disperseContract.disperse(address(token), recipients, amounts) {
            reverted = false;
        } catch {
            reverted = true;
        }

        Assert.ok(reverted, "expected revert with zero allowance");
        Assert.equal(token.balanceOf(r1), uint256(0), "r1 should receive nothing");
        Assert.equal(token.balanceOf(r2), uint256(0), "r2 should receive nothing");
        Assert.equal(token.balanceOf(address(this)), amount * 2, "payer balance must be fully unchanged");
    }
}

// 8. Regression guard for the contract's core "no decimal math" invariant. USDT-TRC20
// has 6 decimals, so 2940 USDT is 2_940_000000 raw base units. If a future edit
// "helpfully" added fee/percentage math on `amounts`, this is the test that would
// catch it — the contract must move exactly the integer it's given.
contract SixDecimalCorrectnessTest {
    MockUsdtTrc20 token;
    PurseDisperseUsdt disperseContract;
    address r1;

    function beforeAll() public {
        token = new MockUsdtTrc20();
        disperseContract = new PurseDisperseUsdt();
        r1 = TestsAccounts.getAccount(1);
    }

    function checkMovesExactBaseUnitsWithNoDecimalMath() public {
        uint256 amount = 2_940_000000; // 2940 USDT at 6 decimals
        token.mint(address(this), amount);
        token.approve(address(disperseContract), amount);

        address[] memory recipients = new address[](1);
        recipients[0] = r1;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = amount;

        disperseContract.disperse(address(token), recipients, amounts);

        Assert.equal(token.balanceOf(r1), uint256(2_940_000000), "recipient must receive the exact raw base units");
    }
}

// 9. [additional, beyond the required cases] All the tests above use a compliant
// mock that reverts on failure, so they'd pass identically with a plain
// `transferFrom` call instead of SafeERC20 — this is the one test that actually
// exercises why SafeERC20 was chosen: a token that returns `false` instead of
// reverting must still cause the whole batch to revert, not silently "succeed."
contract NonCompliantTokenTest {
    NonCompliantMockUsdtTrc20 token;
    PurseDisperseUsdt disperseContract;
    address r1;

    function beforeAll() public {
        token = new NonCompliantMockUsdtTrc20();
        disperseContract = new PurseDisperseUsdt();
        r1 = TestsAccounts.getAccount(1);
    }

    function checkRevertsOnNonCompliantFalseReturn() public {
        // Deliberately no mint/approve — transferFrom hits the insufficient-balance
        // branch and returns false rather than reverting.
        address[] memory recipients = new address[](1);
        recipients[0] = r1;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 100_000000;

        bool reverted = false;
        try disperseContract.disperse(address(token), recipients, amounts) {
            reverted = false;
        } catch {
            reverted = true;
        }

        Assert.ok(reverted, "expected SafeERC20 to revert on a false return value");
        Assert.equal(token.balanceOf(r1), uint256(0), "recipient should receive nothing");
    }
}
