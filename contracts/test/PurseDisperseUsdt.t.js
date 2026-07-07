const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

// These tests validate PurseDisperseUsdt's LOGIC ONLY, against Hardhat's local
// in-process EVM — no deploy, no real Energy measurement (see sprint_report.txt
// for what still needs manual verification on TRON's Nile testnet). Every case
// asserts what money actually did (who ended up with what balance), not merely
// whether a call reverted — a call that reverts for the wrong reason, or "succeeds"
// while silently mis-paying someone, would pass a reverted-only assertion.

async function deployFixture() {
  const [payer, r1, r2, r3, r4] = await ethers.getSigners();

  const MockUsdtTrc20 = await ethers.getContractFactory("MockUsdtTrc20");
  const token = await MockUsdtTrc20.deploy();

  const NonCompliantMockUsdtTrc20 = await ethers.getContractFactory(
    "NonCompliantMockUsdtTrc20"
  );
  const nonCompliantToken = await NonCompliantMockUsdtTrc20.deploy();

  const PurseDisperseUsdt = await ethers.getContractFactory("PurseDisperseUsdt");
  const disperse = await PurseDisperseUsdt.deploy();

  return { disperse, token, nonCompliantToken, payer, r1, r2, r3, r4 };
}

describe("PurseDisperseUsdt", function () {
  // 1. THE core money-correctness test. Distinct (non-equal) amounts per recipient —
  // if the contract ever mixed up an index (e.g. amounts[i] landing on
  // recipients[i+1]), equal amounts would hide it; distinct amounts can't.
  it("pays each recipient exactly its own amount, and debits the payer by the exact sum", async function () {
    const { disperse, token, payer, r1, r2, r3, r4 } = await loadFixture(
      deployFixture
    );

    const a1 = 100_000000n;
    const a2 = 250_000000n;
    const a3 = 75_500000n;
    const a4 = 1_000000n;
    const sum = a1 + a2 + a3 + a4;

    await token.mint(payer.address, sum);
    await token.connect(payer).approve(disperse.target, sum);

    const recipients = [r1.address, r2.address, r3.address, r4.address];
    const amounts = [a1, a2, a3, a4];

    const tx = disperse.connect(payer).disperse(token.target, recipients, amounts);

    await expect(tx).to.changeTokenBalances(
      token,
      [payer, r1, r2, r3, r4],
      [-sum, a1, a2, a3, a4]
    );
  });

  // 2. Atomicity when a batch fails PARTWAY through, not at the first index. This is
  // the case that actually proves the contract leans on Solidity's revert-unwinds-
  // the-whole-call-frame semantics, rather than just rejecting bad input upfront:
  // recipient 1 is individually affordable against the remaining allowance at the
  // moment it's attempted, recipient 2 is not — so recipient 1's transfer must be
  // rolled back too, even though it "succeeded" transiently within the same call.
  it("reverts the WHOLE batch if one transfer fails partway through, undoing any transfers that ran before it", async function () {
    const { disperse, token, payer, r1, r2, r3 } = await loadFixture(deployFixture);

    const a1 = 300_000000n;
    const a2 = 300_000000n;
    const a3 = 300_000000n;
    const totalMinted = a1 + a2 + a3;
    const approved = 500_000000n; // enough for r1 (300), not enough left for r2 (needs 300, only 200 remains)

    await token.mint(payer.address, totalMinted);
    await token.connect(payer).approve(disperse.target, approved);

    const recipients = [r1.address, r2.address, r3.address];
    const amounts = [a1, a2, a3];

    await expect(
      disperse.connect(payer).disperse(token.target, recipients, amounts)
    ).to.be.reverted;

    expect(await token.balanceOf(r1.address)).to.equal(0n);
    expect(await token.balanceOf(r2.address)).to.equal(0n);
    expect(await token.balanceOf(r3.address)).to.equal(0n);
    expect(await token.balanceOf(payer.address)).to.equal(totalMinted);
  });

  // 3. Malformed input: a recipient with no corresponding amount (or vice versa) is
  // nonsensical data, not a payable batch — reject before touching anything else.
  it("reverts when recipients and amounts have different lengths", async function () {
    const { disperse, token, r1, r2 } = await loadFixture(deployFixture);

    await expect(
      disperse.disperse(token.target, [r1.address, r2.address], [100_000000n])
    )
      .to.be.revertedWithCustomError(disperse, "LengthMismatch")
      .withArgs(2, 1);
  });

  // 4. An empty batch passes the length-equality check (0 == 0) but is still a
  // silent no-op — reject explicitly so a UI bug that resolves to "pay nobody" can
  // never masquerade as a successful, empty payout.
  it("reverts on an empty batch", async function () {
    const { disperse, token } = await loadFixture(deployFixture);

    await expect(
      disperse.disperse(token.target, [], [])
    ).to.be.revertedWithCustomError(disperse, "EmptyBatch");
  });

  // 5. Zero-address recipient, deliberately NOT at index 0 — proves the guard checks
  // every index, and that a recipient positioned BEFORE the bad entry also gets
  // rolled back (same atomicity property as test 2, triggered by input validation
  // rather than a failed transfer).
  it("reverts on a zero-address recipient, rolling back any earlier transfers in the same batch", async function () {
    const { disperse, token, payer, r1, r3 } = await loadFixture(deployFixture);

    const amount = 100_000000n;
    const sum = amount * 3n;

    await token.mint(payer.address, sum);
    await token.connect(payer).approve(disperse.target, sum);

    const recipients = [r1.address, ethers.ZeroAddress, r3.address];
    const amounts = [amount, amount, amount];

    await expect(disperse.connect(payer).disperse(token.target, recipients, amounts))
      .to.be.revertedWithCustomError(disperse, "ZeroAddressRecipient")
      .withArgs(1);

    expect(await token.balanceOf(r1.address)).to.equal(0n);
    expect(await token.balanceOf(payer.address)).to.equal(sum);
  });

  // 6. Insufficient allowance from the very start (never approved) — the simpler,
  // far more common real-world case (agency wallet forgot to approve/top up).
  // Deliberately a different root cause from test 2 (zero approval vs. an allowance
  // that runs out partway) so the two read as distinct money stories, not duplicates.
  it("reverts cleanly with zero approval, moving nothing", async function () {
    const { disperse, token, payer, r1, r2 } = await loadFixture(deployFixture);

    const amount = 100_000000n;
    await token.mint(payer.address, amount * 2n);
    // No approve() call at all — allowance stays at the default of 0.

    await expect(
      disperse
        .connect(payer)
        .disperse(token.target, [r1.address, r2.address], [amount, amount])
    ).to.be.reverted;

    expect(await token.balanceOf(r1.address)).to.equal(0n);
    expect(await token.balanceOf(r2.address)).to.equal(0n);
    expect(await token.balanceOf(payer.address)).to.equal(amount * 2n);
  });

  // 7. Regression guard for the contract's core "no decimal math" invariant. USDT-
  // TRC20 has 6 decimals, so 2940 USDT is 2_940_000000 raw base units. If a future
  // edit "helpfully" added fee/percentage math on `amounts`, this is the test that
  // would catch it — the contract must move exactly the integer it's given.
  it("moves exactly the given base-unit amount, with no decimal math applied", async function () {
    const { disperse, token, payer, r1 } = await loadFixture(deployFixture);

    const amount = 2_940_000000n; // 2940 USDT at 6 decimals
    await token.mint(payer.address, amount);
    await token.connect(payer).approve(disperse.target, amount);

    await disperse.connect(payer).disperse(token.target, [r1.address], [amount]);

    expect(await token.balanceOf(r1.address)).to.equal(2_940_000000n);
  });

  // 8. OPTIONAL — beyond the brief's required 7. All 7 cases above use a compliant
  // token that reverts on failure, so they'd pass identically with a plain
  // `transferFrom` call instead of SafeERC20 — this is the one test that actually
  // exercises why SafeERC20 was chosen: a token that returns `false` instead of
  // reverting must still cause the whole batch to revert, not silently "succeed."
  it("[additional] reverts on a non-compliant token that returns false instead of reverting on failure", async function () {
    const { disperse, nonCompliantToken, payer, r1 } = await loadFixture(
      deployFixture
    );

    const amount = 100_000000n;
    // Deliberately no mint/approve — transferFrom will hit the insufficient-balance
    // branch and return false rather than revert.

    await expect(
      disperse.connect(payer).disperse(nonCompliantToken.target, [r1.address], [amount])
    ).to.be.reverted;

    expect(await nonCompliantToken.balanceOf(r1.address)).to.equal(0n);
  });
});
