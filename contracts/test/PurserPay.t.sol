// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {PurserPay} from "../src/PurserPay.sol";

/**
 * @dev Minimal, compliant 6-decimal TRC-20 mock: transferFrom REVERTS on insufficient
 *      balance/allowance (the well-behaved case). Declared inline so contracts/mocks/
 *      can stay deleted and the Foundry env carries no external dependency.
 */
contract MockUSDT {
    string public name = "Mock USDT (TRC20)";
    string public symbol = "mUSDT";
    uint8 public constant decimals = 6;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

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

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "insufficient balance");
        require(allowance[from][msg.sender] >= amount, "insufficient allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
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

    uint256 internal constant PRICE = 250 * 10 ** 6; // exact subscription price
    uint256 internal constant UNDERPAY = 249 * 10 ** 6; // one dollar short

    // Local copies of the contract's events, for vm.expectEmit matching.
    event SubscriptionPaid(
        address indexed subscriber, uint256 amount, uint256 timestamp, uint256 expirationTime
    );
    event Dispersed(
        address indexed payer, address indexed token, uint256 recipientCount, uint256 totalAmount
    );

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
    // subscribe() — exact 250 passes, 249 reverts
    // -------------------------------------------------------------------------

    function test_Subscribe_Exact250_Succeeds() public {
        usdt.mint(subscriber, PRICE);
        vm.prank(subscriber);
        usdt.approve(address(purser), PRICE);

        uint256 expectedExpiry = block.timestamp + purser.SUBSCRIPTION_PERIOD();

        vm.expectEmit(true, false, false, true, address(purser));
        emit SubscriptionPaid(subscriber, PRICE, block.timestamp, expectedExpiry);

        vm.prank(subscriber);
        purser.subscribe();

        assertEq(usdt.balanceOf(treasury), PRICE, "treasury funded with exactly 250");
        assertEq(usdt.balanceOf(subscriber), 0, "subscriber fully debited");
        assertEq(usdt.balanceOf(address(purser)), 0, "contract holds nothing");
        assertEq(purser.subscriptionExpiresAt(subscriber), expectedExpiry, "expiry persisted");
        assertTrue(purser.isSubscriptionActive(subscriber), "subscription active");
    }

    /// @dev 249 USDT of balance (allowance ample) → transfer fails → whole tx reverts,
    ///      and crucially NO subscription is granted (CEI: the expiry write rolls back).
    function test_Subscribe_With249Balance_Reverts() public {
        usdt.mint(subscriber, UNDERPAY);
        vm.prank(subscriber);
        usdt.approve(address(purser), PRICE);

        vm.prank(subscriber);
        vm.expectRevert(
            abi.encodeWithSelector(
                PurserPay.TransferFailed.selector, address(usdt), subscriber, treasury, PRICE
            )
        );
        purser.subscribe();

        assertEq(usdt.balanceOf(treasury), 0, "no payment reached treasury");
        assertEq(purser.subscriptionExpiresAt(subscriber), 0, "no subscription granted");
        assertFalse(purser.isSubscriptionActive(subscriber));
    }

    /// @dev 249 USDT of allowance (balance ample) → can't subscribe by approving less.
    function test_Subscribe_With249Allowance_Reverts() public {
        usdt.mint(subscriber, 1000 * 10 ** 6);
        vm.prank(subscriber);
        usdt.approve(address(purser), UNDERPAY);

        vm.prank(subscriber);
        vm.expectRevert(
            abi.encodeWithSelector(
                PurserPay.TransferFailed.selector, address(usdt), subscriber, treasury, PRICE
            )
        );
        purser.subscribe();

        assertEq(usdt.balanceOf(treasury), 0);
        assertEq(purser.subscriptionExpiresAt(subscriber), 0);
    }

    /// @dev Even with a huge allowance, subscribe() pulls EXACTLY 250 — never more.
    function test_Subscribe_PullsExactly250_NeverMore() public {
        usdt.mint(subscriber, 1000 * 10 ** 6);
        vm.prank(subscriber);
        usdt.approve(address(purser), 1000 * 10 ** 6);

        vm.prank(subscriber);
        purser.subscribe();

        assertEq(usdt.balanceOf(treasury), PRICE, "exactly 250 forwarded");
        assertEq(usdt.balanceOf(subscriber), 750 * 10 ** 6, "only 250 pulled");
        assertEq(
            usdt.allowance(subscriber, address(purser)),
            1000 * 10 ** 6 - PRICE,
            "only 250 spent from allowance"
        );
    }

    /// @dev Renewal resets expiry to now + 30d (literal spec; documents the behavior).
    function test_Subscribe_Renewal_ResetsExpiry() public {
        usdt.mint(subscriber, 1000 * 10 ** 6);
        vm.startPrank(subscriber);
        usdt.approve(address(purser), 1000 * 10 ** 6);

        purser.subscribe();
        uint256 firstExpiry = purser.subscriptionExpiresAt(subscriber);

        vm.warp(block.timestamp + 10 days);
        purser.subscribe();
        vm.stopPrank();

        assertEq(purser.subscriptionExpiresAt(subscriber), block.timestamp + 30 days);
        assertGt(purser.subscriptionExpiresAt(subscriber), firstExpiry);
        assertEq(usdt.balanceOf(treasury), 2 * PRICE);
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
    function test_Disperse_NonCompliantTokenReturningFalse_Reverts() public {
        NonCompliantUSDT bad = new NonCompliantUSDT();
        address r1 = makeAddr("r1nc");
        address[] memory recipients = new address[](1);
        recipients[0] = r1;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 100 * 10 ** 6;

        // Underfunded (1 unit) but generous allowance → transferFrom returns false.
        bad.mint(payer, 1);
        vm.prank(payer);
        bad.approve(address(purser), 100 * 10 ** 6);

        vm.prank(payer);
        vm.expectRevert(
            abi.encodeWithSelector(
                PurserPay.TransferFailed.selector, address(bad), payer, r1, 100 * 10 ** 6
            )
        );
        purser.disperse(address(bad), recipients, amounts);

        assertEq(bad.balanceOf(r1), 0);
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
        usdt.mint(sub, 250 * 10 ** 6);
        vm.startPrank(sub);
        usdt.approve(address(purser), 250 * 10 ** 6);
        purser.subscribe();
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
