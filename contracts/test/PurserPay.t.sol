// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {PurserPay} from "../src/PurserPay.sol";

/**
 * @dev Faithful 6-decimal USDT-TRC20 mock, matching the REAL Tether contract's two
 *      non-standard traits the guard must interact with:
 *
 *      1. transferFrom has NO `returns (bool)` — real USDT (Solidity 0.4.x) returns
 *         nothing. PurserPay._safeTransferFrom tolerates that (empty return = success).
 *      2. A blacklist (getBlackListStatus / isBlackListed), but transferFrom does NOT
 *         check the DESTINATION: a transfer to a frozen address SUCCEEDS and the funds
 *         are trapped forever. That is exactly the trap PurserPay's on-chain guard
 *         defends against — so this mock must let a test freeze a recipient and see the
 *         transfer itself would go through (only PurserPay reverts it).
 *
 *      transferFrom still reverts on insufficient balance/allowance (the well-behaved
 *      failure). Declared inline so contracts/mocks/ can stay deleted and the Foundry
 *      env carries no external dependency.
 */
contract MockUSDT {
    string public name = "Mock USDT (TRC20)";
    string public symbol = "mUSDT";
    uint8 public constant decimals = 6;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    /// @dev Real Tether exposes BOTH isBlackListed (public map) and getBlackListStatus().
    mapping(address => bool) public isBlackListed;
    address public blacklistOwner;

    constructor() {
        blacklistOwner = msg.sender;
    }

    function getBlackListStatus(address maker) external view returns (bool) {
        return isBlackListed[maker];
    }

    function addBlackList(address evilUser) external {
        require(msg.sender == blacklistOwner, "only owner");
        isBlackListed[evilUser] = true;
    }

    function removeBlackList(address clearedUser) external {
        require(msg.sender == blacklistOwner, "only owner");
        isBlackListed[clearedUser] = false;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    /// @dev NO return value (real USDT ABI). Does NOT check the destination blacklist —
    ///      a transfer to a frozen `to` SUCCEEDS here; only PurserPay's guard stops it.
    function transferFrom(address from, address to, uint256 amount) external {
        require(balanceOf[from] >= amount, "insufficient balance");
        require(allowance[from][msg.sender] >= amount, "insufficient allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }
}

/**
 * @dev Non-compliant token: transferFrom RETURNS FALSE instead of reverting on failure
 *      (the ERC-20 quirk SafeERC20 exists to defend against). Proves PurserPay's
 *      _safeTransferFrom treats a false return as a failure and reverts the batch.
 */
contract NonCompliantUSDT {
    uint8 public constant decimals = 6;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => bool) public isBlackListed;

    /// @dev Blacklist view so this can stand in as PurserPay's `usdt` immutable — the
    ///      guard staticcalls getBlackListStatus before each transfer. Left permanently
    ///      empty here; this mock exists to prove the FALSE-RETURN path, not the blacklist.
    function getBlackListStatus(address maker) external view returns (bool) {
        return isBlackListed[maker];
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (balanceOf[from] < amount || allowance[from][msg.sender] < amount) {
            return false; // no revert — the non-compliant path
        }
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract PurserPayTest is Test {
    PurserPay internal purser;
    MockUSDT internal usdt;

    address internal treasury;
    address internal subscriber;
    address internal payer;

    uint256 internal constant PRICE = 150 * 10 ** 6; // exact monthly price (plan 0)
    uint256 internal constant PRICE_ANNUAL = 1500 * 10 ** 6; // exact annual price (plan 1)
    uint256 internal constant UNDERPAY = 149 * 10 ** 6; // one dollar short

    // Local copies of the contract's events, for vm.expectEmit matching.
    event SubscriptionPaid(
        address indexed subscriber, uint256 amount, uint256 timestamp, uint256 expirationTime
    );
    event Dispersed(
        address indexed payer, address indexed token, uint256 recipientCount, uint256 totalAmount
    );
    event SubscriptionFeesUpdated(uint256 newMonthly, uint256 newAnnual);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event TreasuryWalletUpdated(address indexed previousTreasury, address indexed newTreasury);

    function setUp() public {
        treasury = makeAddr("treasury");
        subscriber = makeAddr("subscriber");
        payer = makeAddr("payer");

        usdt = new MockUSDT();
        purser = new PurserPay(address(usdt), treasury);
    }

    // -------------------------------------------------------------------------
    // Constructor / immutability
    // -------------------------------------------------------------------------

    function test_Constructor_SetsImmutables() public {
        assertEq(purser.usdt(), address(usdt));
        assertEq(purser.treasuryWallet(), treasury);
        assertEq(purser.SUBSCRIPTION_PRICE(), PRICE);
        assertEq(purser.SUBSCRIPTION_PERIOD(), 30 days);
        assertEq(purser.SUBSCRIPTION_PRICE_ANNUAL(), PRICE_ANNUAL);
        assertEq(purser.SUBSCRIPTION_PERIOD_ANNUAL(), 365 days);
    }

    /// @dev The deployer (this test contract) becomes the owner.
    function test_Constructor_SetsOwner() public {
        assertEq(purser.owner(), address(this), "deployer is owner");
    }

    function test_Constructor_RevertsOnZeroUsdt() public {
        vm.expectRevert(PurserPay.ZeroAddressConfig.selector);
        new PurserPay(address(0), treasury);
    }

    function test_Constructor_RevertsOnZeroTreasury() public {
        vm.expectRevert(PurserPay.ZeroAddressConfig.selector);
        new PurserPay(address(usdt), address(0));
    }

    // -------------------------------------------------------------------------
    // subscribe() — exact 150 passes, 149 reverts
    // -------------------------------------------------------------------------

    function test_Subscribe_Exact150_Succeeds() public {
        usdt.mint(subscriber, PRICE);
        vm.prank(subscriber);
        usdt.approve(address(purser), PRICE);

        uint256 expectedExpiry = block.timestamp + purser.SUBSCRIPTION_PERIOD();

        vm.expectEmit(true, false, false, true, address(purser));
        emit SubscriptionPaid(subscriber, PRICE, block.timestamp, expectedExpiry);

        vm.prank(subscriber);
        purser.subscribe(0);

        assertEq(usdt.balanceOf(treasury), PRICE, "treasury funded with exactly 150");
        assertEq(usdt.balanceOf(subscriber), 0, "subscriber fully debited");
        assertEq(usdt.balanceOf(address(purser)), 0, "contract holds nothing");
        assertEq(purser.subscriptionExpiresAt(subscriber), expectedExpiry, "expiry persisted");
        assertTrue(purser.isSubscriptionActive(subscriber), "subscription active");
    }

    /// @dev 149 USDT of balance (allowance ample) → transfer fails → whole tx reverts,
    ///      and crucially NO subscription is granted (CEI: the expiry write rolls back).
    function test_Subscribe_With149Balance_Reverts() public {
        usdt.mint(subscriber, UNDERPAY);
        vm.prank(subscriber);
        usdt.approve(address(purser), PRICE);

        vm.prank(subscriber);
        vm.expectRevert(
            abi.encodeWithSelector(
                PurserPay.TransferFailed.selector, address(usdt), subscriber, treasury, PRICE
            )
        );
        purser.subscribe(0);

        assertEq(usdt.balanceOf(treasury), 0, "no payment reached treasury");
        assertEq(purser.subscriptionExpiresAt(subscriber), 0, "no subscription granted");
        assertFalse(purser.isSubscriptionActive(subscriber));
    }

    /// @dev 149 USDT of allowance (balance ample) → can't subscribe by approving less.
    function test_Subscribe_With149Allowance_Reverts() public {
        usdt.mint(subscriber, 1000 * 10 ** 6);
        vm.prank(subscriber);
        usdt.approve(address(purser), UNDERPAY);

        vm.prank(subscriber);
        vm.expectRevert(
            abi.encodeWithSelector(
                PurserPay.TransferFailed.selector, address(usdt), subscriber, treasury, PRICE
            )
        );
        purser.subscribe(0);

        assertEq(usdt.balanceOf(treasury), 0);
        assertEq(purser.subscriptionExpiresAt(subscriber), 0);
    }

    /// @dev Even with a huge allowance, subscribe() pulls EXACTLY 150 — never more.
    function test_Subscribe_PullsExactly150_NeverMore() public {
        usdt.mint(subscriber, 1000 * 10 ** 6);
        vm.prank(subscriber);
        usdt.approve(address(purser), 1000 * 10 ** 6);

        vm.prank(subscriber);
        purser.subscribe(0);

        assertEq(usdt.balanceOf(treasury), PRICE, "exactly 150 forwarded");
        assertEq(usdt.balanceOf(subscriber), 1000 * 10 ** 6 - PRICE, "only 150 pulled");
        assertEq(
            usdt.allowance(subscriber, address(purser)),
            1000 * 10 ** 6 - PRICE,
            "only 150 spent from allowance"
        );
    }

    /// @dev Renewal resets expiry to now + 30d (literal spec; documents the behavior).
    function test_Subscribe_Renewal_ResetsExpiry() public {
        usdt.mint(subscriber, 1000 * 10 ** 6);
        vm.startPrank(subscriber);
        usdt.approve(address(purser), 1000 * 10 ** 6);

        purser.subscribe(0);
        uint256 firstExpiry = purser.subscriptionExpiresAt(subscriber);

        vm.warp(block.timestamp + 10 days);
        purser.subscribe(0);
        vm.stopPrank();

        assertEq(purser.subscriptionExpiresAt(subscriber), block.timestamp + 30 days);
        assertGt(purser.subscriptionExpiresAt(subscriber), firstExpiry);
        assertEq(usdt.balanceOf(treasury), 2 * PRICE);
    }

    // -------------------------------------------------------------------------
    // subscribe(planType) — annual tier (plan 1) and invalid-plan revert
    // -------------------------------------------------------------------------

    /// @dev Plan 1 pulls EXACTLY 1,500 USDT and grants a 365-day period.
    function test_Subscribe_Annual_Pulls1500_Adds365Days() public {
        usdt.mint(subscriber, PRICE_ANNUAL);
        vm.prank(subscriber);
        usdt.approve(address(purser), PRICE_ANNUAL);

        uint256 expectedExpiry = block.timestamp + purser.SUBSCRIPTION_PERIOD_ANNUAL();

        vm.expectEmit(true, false, false, true, address(purser));
        emit SubscriptionPaid(subscriber, PRICE_ANNUAL, block.timestamp, expectedExpiry);

        vm.prank(subscriber);
        purser.subscribe(1);

        assertEq(usdt.balanceOf(treasury), PRICE_ANNUAL, "treasury funded with exactly 1,500");
        assertEq(usdt.balanceOf(subscriber), 0, "subscriber fully debited");
        assertEq(usdt.balanceOf(address(purser)), 0, "contract holds nothing");
        assertEq(expectedExpiry, block.timestamp + 365 days, "365-day period");
        assertEq(purser.subscriptionExpiresAt(subscriber), expectedExpiry, "annual expiry persisted");
        assertTrue(purser.isSubscriptionActive(subscriber), "subscription active");
    }

    /// @dev The annual plan pulls EXACTLY 1,500 even with a larger allowance — never more.
    function test_Subscribe_Annual_PullsExactly1500_NeverMore() public {
        usdt.mint(subscriber, 5000 * 10 ** 6);
        vm.prank(subscriber);
        usdt.approve(address(purser), 5000 * 10 ** 6);

        vm.prank(subscriber);
        purser.subscribe(1);

        assertEq(usdt.balanceOf(treasury), PRICE_ANNUAL, "exactly 1,500 forwarded");
        assertEq(usdt.balanceOf(subscriber), 5000 * 10 ** 6 - PRICE_ANNUAL, "only 1,500 pulled");
    }

    /// @dev Any plan other than 0/1 reverts InvalidPlan — nothing charged, no access granted.
    function test_Subscribe_InvalidPlan_Reverts() public {
        usdt.mint(subscriber, PRICE_ANNUAL);
        vm.prank(subscriber);
        usdt.approve(address(purser), PRICE_ANNUAL);

        vm.prank(subscriber);
        vm.expectRevert(abi.encodeWithSelector(PurserPay.InvalidPlan.selector, uint8(2)));
        purser.subscribe(2);

        assertEq(usdt.balanceOf(treasury), 0, "no payment on an invalid plan");
        assertEq(purser.subscriptionExpiresAt(subscriber), 0, "no subscription granted");
        assertFalse(purser.isSubscriptionActive(subscriber));
    }

    // -------------------------------------------------------------------------
    // updateSubscriptionFees / transferOwnership — owner-only fee governance
    // -------------------------------------------------------------------------

    /// @dev The owner sets new fees, the event fires, both getters update, and a
    ///      subsequent subscribe pulls the NEW price (proving it's a live storage read).
    function test_UpdateSubscriptionFees_OwnerUpdatesEmitsAndCharges() public {
        uint256 newMonthly = 200 * 10 ** 6;
        uint256 newAnnual = 2000 * 10 ** 6;

        vm.expectEmit(false, false, false, true, address(purser));
        emit SubscriptionFeesUpdated(newMonthly, newAnnual);

        // The test contract is the owner (it deployed purser in setUp).
        purser.updateSubscriptionFees(newMonthly, newAnnual);

        assertEq(purser.SUBSCRIPTION_PRICE(), newMonthly, "monthly fee updated");
        assertEq(purser.SUBSCRIPTION_PRICE_ANNUAL(), newAnnual, "annual fee updated");

        // subscribe(0) now charges exactly the new monthly price.
        usdt.mint(subscriber, newMonthly);
        vm.startPrank(subscriber);
        usdt.approve(address(purser), newMonthly);
        purser.subscribe(0);
        vm.stopPrank();

        assertEq(usdt.balanceOf(treasury), newMonthly, "treasury charged the new price");
        assertTrue(purser.isSubscriptionActive(subscriber), "subscription active at new price");
    }

    /// @dev Any non-owner call to updateSubscriptionFees reverts and changes nothing.
    function test_UpdateSubscriptionFees_NonOwnerReverts() public {
        vm.prank(subscriber);
        vm.expectRevert(PurserPay.NotOwner.selector);
        purser.updateSubscriptionFees(1, 1);

        assertEq(purser.SUBSCRIPTION_PRICE(), PRICE, "monthly fee unchanged");
        assertEq(purser.SUBSCRIPTION_PRICE_ANNUAL(), PRICE_ANNUAL, "annual fee unchanged");
    }

    /// @dev The owner can hand off the role; the event fires and the new owner can set fees.
    function test_TransferOwnership_OwnerTransfersAndEmits() public {
        vm.expectEmit(true, true, false, false, address(purser));
        emit OwnershipTransferred(address(this), subscriber);
        purser.transferOwnership(subscriber);

        assertEq(purser.owner(), subscriber, "owner is now subscriber");

        // The new owner can update fees; the old owner no longer can.
        vm.prank(subscriber);
        purser.updateSubscriptionFees(300 * 10 ** 6, 3000 * 10 ** 6);
        assertEq(purser.SUBSCRIPTION_PRICE(), 300 * 10 ** 6, "new owner updated fee");

        vm.expectRevert(PurserPay.NotOwner.selector);
        purser.updateSubscriptionFees(1, 1); // old owner (this) is now unauthorized
    }

    /// @dev Non-owner cannot transfer ownership.
    function test_TransferOwnership_NonOwnerReverts() public {
        vm.prank(subscriber);
        vm.expectRevert(PurserPay.NotOwner.selector);
        purser.transferOwnership(subscriber);

        assertEq(purser.owner(), address(this), "owner unchanged");
    }

    /// @dev Ownership can never be transferred to the zero address (no accidental lock).
    function test_TransferOwnership_ZeroAddressReverts() public {
        vm.expectRevert(PurserPay.ZeroAddressConfig.selector);
        purser.transferOwnership(address(0));

        assertEq(purser.owner(), address(this), "owner unchanged");
    }

    // -------------------------------------------------------------------------
    // updateTreasuryWallet — owner redirects OUR OWN revenue (never user funds)
    // -------------------------------------------------------------------------

    /// @dev The owner redirects the treasury; the event fires; the getter updates; and a
    ///      subsequent subscribe pays the NEW treasury (proving it's a live storage read).
    function test_UpdateTreasuryWallet_OwnerUpdates_SubscribePaysNewTreasury() public {
        address newTreasury = makeAddr("newTreasury");

        vm.expectEmit(true, true, false, false, address(purser));
        emit TreasuryWalletUpdated(treasury, newTreasury);

        // The test contract is the owner (it deployed purser in setUp).
        purser.updateTreasuryWallet(newTreasury);
        assertEq(purser.treasuryWallet(), newTreasury, "treasury redirected");

        // subscribe(0) now forwards to the NEW treasury; the OLD one receives nothing.
        usdt.mint(subscriber, PRICE);
        vm.startPrank(subscriber);
        usdt.approve(address(purser), PRICE);
        purser.subscribe(0);
        vm.stopPrank();

        assertEq(usdt.balanceOf(newTreasury), PRICE, "new treasury funded");
        assertEq(usdt.balanceOf(treasury), 0, "old treasury receives nothing");
        assertEq(usdt.balanceOf(address(purser)), 0, "contract holds nothing");
    }

    /// @dev Any non-owner call reverts NotOwner and changes nothing.
    function test_UpdateTreasuryWallet_NonOwnerReverts() public {
        vm.prank(subscriber);
        vm.expectRevert(PurserPay.NotOwner.selector);
        purser.updateTreasuryWallet(subscriber);

        assertEq(purser.treasuryWallet(), treasury, "treasury unchanged");
    }

    /// @dev The treasury can never be redirected to the zero address (no accidental burn).
    function test_UpdateTreasuryWallet_ZeroAddressReverts() public {
        vm.expectRevert(PurserPay.ZeroAddressConfig.selector);
        purser.updateTreasuryWallet(address(0));

        assertEq(purser.treasuryWallet(), treasury, "treasury unchanged");
    }

    /// @dev Redirecting the treasury does NOT touch the disperse path: a disperse after the
    ///      update pays recipients directly and the contract still holds nothing. The treasury
    ///      is never in the disperse code path, so it cannot be affected either way.
    function test_UpdateTreasuryWallet_DisperseUnaffected() public {
        purser.updateTreasuryWallet(makeAddr("newTreasury"));

        address r1 = makeAddr("d1");
        address[] memory recipients = new address[](1);
        recipients[0] = r1;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 42 * 10 ** 6;

        usdt.mint(payer, 42 * 10 ** 6);
        vm.startPrank(payer);
        usdt.approve(address(purser), 42 * 10 ** 6);
        purser.disperse(address(usdt), recipients, amounts);
        vm.stopPrank();

        assertEq(usdt.balanceOf(r1), 42 * 10 ** 6, "recipient paid directly");
        assertEq(usdt.balanceOf(address(purser)), 0, "contract still holds nothing");
    }

    // -------------------------------------------------------------------------
    // disperse() — happy path, holds nothing, correct event
    // -------------------------------------------------------------------------

    function test_Disperse_HappyPath_PaysExactAndHoldsNothing() public {
        address r1 = makeAddr("r1");
        address r2 = makeAddr("r2");
        address r3 = makeAddr("r3");

        address[] memory recipients = new address[](3);
        recipients[0] = r1;
        recipients[1] = r2;
        recipients[2] = r3;

        uint256[] memory amounts = new uint256[](3);
        amounts[0] = 100 * 10 ** 6;
        amounts[1] = 250 * 10 ** 6;
        amounts[2] = 5 * 10 ** 6;
        uint256 total = 355 * 10 ** 6;

        usdt.mint(payer, total);
        vm.prank(payer);
        usdt.approve(address(purser), total);

        vm.expectEmit(true, true, false, true, address(purser));
        emit Dispersed(payer, address(usdt), 3, total);

        vm.prank(payer);
        purser.disperse(address(usdt), recipients, amounts);

        assertEq(usdt.balanceOf(r1), 100 * 10 ** 6);
        assertEq(usdt.balanceOf(r2), 250 * 10 ** 6);
        assertEq(usdt.balanceOf(r3), 5 * 10 ** 6);
        assertEq(usdt.balanceOf(payer), 0, "payer fully debited");
        assertEq(usdt.balanceOf(address(purser)), 0, "contract holds nothing");
    }

    // -------------------------------------------------------------------------
    // disperse() — guards (preserved error selectors) + atomicity
    // -------------------------------------------------------------------------

    function test_Disperse_LengthMismatch_Reverts() public {
        address[] memory recipients = new address[](2);
        recipients[0] = makeAddr("a");
        recipients[1] = makeAddr("b");
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1;

        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(PurserPay.LengthMismatch.selector, 2, 1));
        purser.disperse(address(usdt), recipients, amounts);
    }

    function test_Disperse_EmptyBatch_Reverts() public {
        address[] memory recipients = new address[](0);
        uint256[] memory amounts = new uint256[](0);

        vm.prank(payer);
        vm.expectRevert(PurserPay.EmptyBatch.selector);
        purser.disperse(address(usdt), recipients, amounts);
    }

    function test_Disperse_ZeroAddressRecipient_RevertsAndRollsBack() public {
        address r0 = makeAddr("r0");
        address[] memory recipients = new address[](2);
        recipients[0] = r0;
        recipients[1] = address(0);
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 10 * 10 ** 6;
        amounts[1] = 20 * 10 ** 6;

        usdt.mint(payer, 30 * 10 ** 6);
        vm.prank(payer);
        usdt.approve(address(purser), 30 * 10 ** 6);

        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(PurserPay.ZeroAddressRecipient.selector, 1));
        purser.disperse(address(usdt), recipients, amounts);

        // Index-0 transfer must have rolled back (atomic).
        assertEq(usdt.balanceOf(r0), 0, "earlier transfer rolled back");
        assertEq(usdt.balanceOf(payer), 30 * 10 ** 6, "payer untouched");
    }

    function test_Disperse_ZeroAmount_RevertsAndRollsBack() public {
        address x = makeAddr("x");
        address y = makeAddr("y");
        address[] memory recipients = new address[](2);
        recipients[0] = x;
        recipients[1] = y;
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 5 * 10 ** 6;
        amounts[1] = 0;

        usdt.mint(payer, 5 * 10 ** 6);
        vm.prank(payer);
        usdt.approve(address(purser), 5 * 10 ** 6);

        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(PurserPay.ZeroAmount.selector, 1));
        purser.disperse(address(usdt), recipients, amounts);

        assertEq(usdt.balanceOf(x), 0, "earlier transfer rolled back");
    }

    /// @dev Allowance one unit short of the total → the batch reverts and nobody is paid.
    function test_Disperse_InsufficientAllowance_RevertsWholeBatch() public {
        address ra = makeAddr("ra");
        address rb = makeAddr("rb");
        address[] memory recipients = new address[](2);
        recipients[0] = ra;
        recipients[1] = rb;
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 400 * 10 ** 6;
        amounts[1] = 500 * 10 ** 6;
        uint256 total = 900 * 10 ** 6;

        usdt.mint(payer, total);
        vm.prank(payer);
        usdt.approve(address(purser), total - 1);

        vm.prank(payer);
        vm.expectRevert(
            abi.encodeWithSelector(
                PurserPay.TransferFailed.selector, address(usdt), payer, rb, 500 * 10 ** 6
            )
        );
        purser.disperse(address(usdt), recipients, amounts);

        assertEq(usdt.balanceOf(ra), 0, "nobody paid");
        assertEq(usdt.balanceOf(rb), 0, "nobody paid");
        assertEq(usdt.balanceOf(payer), total, "payer whole");
    }

    /// @dev A token that returns false (instead of reverting) must still fail the batch.
    /// @dev A token that returns false (instead of reverting) must still fail the batch.
    ///      Since disperse now enforces `token == usdt`, the non-compliant token has to BE
    ///      this contract's `usdt`: deploy a dedicated PurserPay over `bad` so the
    ///      false-return path is still exercised end-to-end through the real disperse.
    function test_Disperse_NonCompliantTokenReturningFalse_Reverts() public {
        NonCompliantUSDT bad = new NonCompliantUSDT();
        PurserPay badPurser = new PurserPay(address(bad), treasury);
        address r1 = makeAddr("r1nc");
        address[] memory recipients = new address[](1);
        recipients[0] = r1;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 100 * 10 ** 6;

        // Underfunded (1 unit) but generous allowance → transferFrom returns false.
        bad.mint(payer, 1);
        vm.prank(payer);
        bad.approve(address(badPurser), 100 * 10 ** 6);

        vm.prank(payer);
        vm.expectRevert(
            abi.encodeWithSelector(
                PurserPay.TransferFailed.selector, address(bad), payer, r1, 100 * 10 ** 6
            )
        );
        badPurser.disperse(address(bad), recipients, amounts);

        assertEq(bad.balanceOf(r1), 0);
    }

    // -------------------------------------------------------------------------
    // disperse() — frozen-address guard (the on-chain security layer)
    // -------------------------------------------------------------------------

    /// @dev disperse is USDT-only: a token other than the immutable `usdt` reverts
    ///      UnsupportedToken so the frozen-address blacklist read always matches the
    ///      token actually moved. Nothing is transferred.
    function test_Disperse_UnsupportedToken_Reverts() public {
        MockUSDT other = new MockUSDT();
        address r1 = makeAddr("ru");
        address[] memory recipients = new address[](1);
        recipients[0] = r1;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 10 * 10 ** 6;

        other.mint(payer, 10 * 10 ** 6);
        vm.prank(payer);
        other.approve(address(purser), 10 * 10 ** 6);

        vm.prank(payer);
        vm.expectRevert(
            abi.encodeWithSelector(PurserPay.UnsupportedToken.selector, address(other))
        );
        purser.disperse(address(other), recipients, amounts);

        assertEq(other.balanceOf(r1), 0, "nothing moved");
        assertEq(other.balanceOf(payer), 10 * 10 ** 6, "payer whole");
    }

    /// @dev A single frozen recipient → the disperse reverts DestinationBlacklisted and
    ///      NOT ONE base unit moves (USDT itself would have let it through and trapped it).
    function test_Disperse_FrozenDestination_Reverts() public {
        address frozen = makeAddr("frozen");
        address[] memory recipients = new address[](1);
        recipients[0] = frozen;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 100 * 10 ** 6;

        usdt.mint(payer, 100 * 10 ** 6);
        vm.prank(payer);
        usdt.approve(address(purser), 100 * 10 ** 6);

        usdt.addBlackList(frozen);

        vm.prank(payer);
        vm.expectRevert(
            abi.encodeWithSelector(PurserPay.DestinationBlacklisted.selector, frozen)
        );
        purser.disperse(address(usdt), recipients, amounts);

        assertEq(usdt.balanceOf(frozen), 0, "frozen recipient unpaid");
        assertEq(usdt.balanceOf(payer), 100 * 10 ** 6, "payer whole");
    }

    /// @dev One frozen row among many → the WHOLE batch reverts (atomic, D-4). The frozen
    ///      row is LAST, so rows that already transferred must roll back — no partial payout.
    function test_Disperse_OneFrozenRowAmongMany_RevertsWholeBatch() public {
        address a = makeAddr("fa");
        address b = makeAddr("fb");
        address frozen = makeAddr("fc");

        address[] memory recipients = new address[](3);
        recipients[0] = a;
        recipients[1] = b;
        recipients[2] = frozen;
        uint256[] memory amounts = new uint256[](3);
        amounts[0] = 100 * 10 ** 6;
        amounts[1] = 250 * 10 ** 6;
        amounts[2] = 5 * 10 ** 6;
        uint256 total = 355 * 10 ** 6;

        usdt.mint(payer, total);
        vm.prank(payer);
        usdt.approve(address(purser), total);

        usdt.addBlackList(frozen);

        vm.prank(payer);
        vm.expectRevert(
            abi.encodeWithSelector(PurserPay.DestinationBlacklisted.selector, frozen)
        );
        purser.disperse(address(usdt), recipients, amounts);

        // Atomicity: the two earlier rows rolled back — nobody was paid.
        assertEq(usdt.balanceOf(a), 0, "row 0 rolled back");
        assertEq(usdt.balanceOf(b), 0, "row 1 rolled back");
        assertEq(usdt.balanceOf(frozen), 0, "frozen row unpaid");
        assertEq(usdt.balanceOf(payer), total, "payer whole - no partial payout");
        assertEq(usdt.balanceOf(address(purser)), 0, "contract holds nothing");
    }

    /// @dev A frozen PAYER → named SenderBlacklisted before the token is touched (USDT's
    ///      own transferFrom would have reverted opaquely). Nothing moves.
    function test_Disperse_FrozenSender_Reverts() public {
        address r1 = makeAddr("rs");
        address[] memory recipients = new address[](1);
        recipients[0] = r1;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 100 * 10 ** 6;

        usdt.mint(payer, 100 * 10 ** 6);
        vm.prank(payer);
        usdt.approve(address(purser), 100 * 10 ** 6);

        usdt.addBlackList(payer);

        vm.prank(payer);
        vm.expectRevert(
            abi.encodeWithSelector(PurserPay.SenderBlacklisted.selector, payer)
        );
        purser.disperse(address(usdt), recipients, amounts);

        assertEq(usdt.balanceOf(r1), 0, "recipient unpaid");
        assertEq(usdt.balanceOf(payer), 100 * 10 ** 6, "payer whole");
    }

    /// @dev Un-freezing a destination restores the happy path — the guard reads live
    ///      blacklist state, it is not a deploy-time constant.
    function test_Disperse_UnfreezeRestoresPayment() public {
        address r1 = makeAddr("rf");
        address[] memory recipients = new address[](1);
        recipients[0] = r1;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 100 * 10 ** 6;

        usdt.mint(payer, 100 * 10 ** 6);
        vm.prank(payer);
        usdt.approve(address(purser), 100 * 10 ** 6);

        usdt.addBlackList(r1);
        usdt.removeBlackList(r1);

        vm.prank(payer);
        purser.disperse(address(usdt), recipients, amounts);

        assertEq(usdt.balanceOf(r1), 100 * 10 ** 6, "paid after unfreeze");
        assertEq(usdt.balanceOf(address(purser)), 0, "contract holds nothing");
    }

    /// @dev The faithful mock's transferFrom returns NOTHING (real USDT ABI). A clean
    ///      disperse still succeeds through _safeTransferFrom's empty-return-is-success
    ///      handling — proving the guard + disperse interact correctly with the missing return.
    function test_Disperse_MissingReturnTransferFrom_Succeeds() public {
        address r1 = makeAddr("rmr");
        address[] memory recipients = new address[](1);
        recipients[0] = r1;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 77 * 10 ** 6;

        usdt.mint(payer, 77 * 10 ** 6);
        vm.prank(payer);
        usdt.approve(address(purser), 77 * 10 ** 6);

        vm.prank(payer);
        purser.disperse(address(usdt), recipients, amounts);

        assertEq(usdt.balanceOf(r1), 77 * 10 ** 6, "recipient paid despite void return");
        assertEq(usdt.balanceOf(address(purser)), 0, "contract holds nothing");
    }

    // -------------------------------------------------------------------------
    // Fuzz — the contract's final USDT balance is ALWAYS strictly zero
    // -------------------------------------------------------------------------

    function testFuzz_Disperse_ContractBalanceAlwaysZero(uint256 seed, uint8 rawCount) public {
        uint256 count = bound(uint256(rawCount), 1, 100);

        address[] memory recipients = new address[](count);
        uint256[] memory amounts = new uint256[](count);
        uint256 total = 0;

        for (uint256 i = 0; i < count; i++) {
            address r = address(uint160(uint256(keccak256(abi.encode(seed, i)))));
            // Keep recipients valid and never the contract/payer (either would confound
            // the invariant with a legitimate credit rather than a retained fee).
            if (r == address(0) || r == address(purser) || r == payer) {
                r = address(uint160(i + 1));
            }
            recipients[i] = r;

            uint256 amt = bound(uint256(keccak256(abi.encode(seed, i, "amt"))), 1, 1_000_000 * 10 ** 6);
            amounts[i] = amt;
            total += amt;
        }

        usdt.mint(payer, total);
        vm.prank(payer);
        usdt.approve(address(purser), total);

        vm.prank(payer);
        purser.disperse(address(usdt), recipients, amounts);

        // THE compliance invariant: not one base unit is ever retained.
        assertEq(usdt.balanceOf(address(purser)), 0);
    }
}

/**
 * @dev Handler for stateful invariant testing: drives PurserPay through arbitrary
 *      sequences of disperse() and subscribe() with random, self-funded actors.
 */
contract PurserPayHandler is Test {
    PurserPay public purser;
    MockUSDT public usdt;

    constructor(PurserPay _purser, MockUSDT _usdt) {
        purser = _purser;
        usdt = _usdt;
    }

    function disperse(uint256 seed, uint8 rawCount) external {
        uint256 count = bound(uint256(rawCount), 1, 20);
        address actor = address(uint160(uint256(keccak256(abi.encode("actor", seed))) | 1));

        address[] memory recipients = new address[](count);
        uint256[] memory amounts = new uint256[](count);
        uint256 total = 0;

        for (uint256 i = 0; i < count; i++) {
            address r = address(uint160(uint256(keccak256(abi.encode(seed, i))) | 1));
            if (r == address(purser)) {
                r = address(uint160(i + 1));
            }
            recipients[i] = r;
            uint256 amt = bound(uint256(keccak256(abi.encode(seed, i, "amt"))), 1, 1000 * 10 ** 6);
            amounts[i] = amt;
            total += amt;
        }

        usdt.mint(actor, total);
        vm.startPrank(actor);
        usdt.approve(address(purser), total);
        purser.disperse(address(usdt), recipients, amounts);
        vm.stopPrank();
    }

    function subscribe(uint256 seed) external {
        address sub = address(uint160(uint256(keccak256(abi.encode("sub", seed))) | 1));
        usdt.mint(sub, 150 * 10 ** 6);
        vm.startPrank(sub);
        usdt.approve(address(purser), 150 * 10 ** 6);
        purser.subscribe(0);
        vm.stopPrank();
    }
}

contract PurserPayInvariantTest is Test {
    PurserPay internal purser;
    MockUSDT internal usdt;
    PurserPayHandler internal handler;

    function setUp() public {
        usdt = new MockUSDT();
        purser = new PurserPay(address(usdt), makeAddr("treasury"));
        handler = new PurserPayHandler(purser, usdt);
        targetContract(address(handler));
    }

    /// @notice Across any sequence of disperse/subscribe calls, PurserPay never holds USDT.
    function invariant_PurserPayHoldsNoUsdt() public {
        assertEq(usdt.balanceOf(address(purser)), 0);
    }
}
