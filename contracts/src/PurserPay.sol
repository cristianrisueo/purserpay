// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title  ITRC20
 * @notice Minimal TRC-20 / ERC-20 surface PurserPay depends on. Declared inline so the
 *         contract carries no external dependency (pure Foundry build, forge-std only).
 * @dev    Real TRON USDT (TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t) returns a bool from
 *         transferFrom. `transfer` is declared for interface completeness; PurserPay
 *         itself never calls it (it never holds a balance to send).
 */
interface ITRC20 {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

/**
 * @title  PurserPay
 * @notice Non-custodial USDT payout + subscription contract for PurserPay.
 *
 *         Two functions, and the contract holds nothing:
 *           - disperse(): a FREE batch-payout utility. USDT moves straight from the
 *             payer to each recipient via transferFrom — no fee, no percentage, no
 *             funds retained. This is the compliance moat: Purser has zero control
 *             over user funds.
 *           - subscribe(planType): the flat monetization. Pulls EXACTLY the plan's
 *             current price (150 USDT monthly / 1,500 USDT annual at deploy) from the
 *             subscriber and forwards it, in the same transaction, to a cold treasury.
 *
 * @dev    Non-custodial and no-proxy by design: no withdraw, no upgrade path, no
 *         payable/receive/fallback, and the contract never takes custody of any token —
 *         every transfer is a direct payer -> recipient (or subscriber -> treasury)
 *         move, so its own token balance is invariably zero. `usdt` is immutable (set once
 *         in the constructor, can never change — changing the token would break every
 *         standing approval). `treasuryWallet` is NOT immutable: it is owner-updatable via
 *         updateTreasuryWallet, and it only ever RECEIVES PurserPay's own subscription fee
 *         (never user funds — disperse() references neither owner nor treasury), so
 *         redirecting it can never touch custody. Why it must be updatable: it was immutable,
 *         which meant moving revenue to a hardware/multisig wallet later would have required
 *         a FRESH DEPLOY — destroying every subscriber's on-chain subscriptionExpiresAt. That
 *         trap is removed here. disperse() stays permissionless (ownerless — no privileged
 *         caller). The owner's ENTIRE surface is: the two subscription-fee amounts
 *         (updateSubscriptionFees), the treasury destination (updateTreasuryWallet), and the
 *         owner role (transferOwnership) — and nothing else. None of these can ever touch
 *         funds, keys, broadcast, pause anything, or alter the disperse path.
 */
contract PurserPay {
    // -------------------------------------------------------------------------
    // Token (immutable — set once, forever; changing it would break every approval)
    // -------------------------------------------------------------------------

    /// @notice The one token subscriptions are paid in (USDT-TRC20 on mainnet).
    address public immutable usdt;

    // -------------------------------------------------------------------------
    // Treasury (owner-updatable storage — receives ONLY our own subscription fee)
    // -------------------------------------------------------------------------

    /// @notice Treasury that receives every subscription payment. Owner-updatable via
    ///         updateTreasuryWallet so revenue can move to a cold/multisig wallet WITHOUT a
    ///         redeploy (a redeploy would wipe every subscriber's expiry). It only ever
    ///         receives our own fee — never user funds — so redirecting it can't touch custody.
    address public treasuryWallet;

    // -------------------------------------------------------------------------
    // Ownership (the ONLY admin key — governs subscription fees, nothing else)
    // -------------------------------------------------------------------------

    /// @notice The sole privileged account. Can adjust the subscription fees and
    ///         transfer its own role — and nothing else. It can never touch funds,
    ///         keys, broadcast, pause, or the permissionless disperse() path.
    address public owner;

    // -------------------------------------------------------------------------
    // Subscription economics (flat fee — NO percentage of any volume)
    // -------------------------------------------------------------------------

    /// @notice Monthly (plan 0) price in USDT base units (6 decimals). Owner-adjustable
    ///         via updateSubscriptionFees; initialized to 150 USDT at deploy.
    uint256 public SUBSCRIPTION_PRICE;

    /// @notice Monthly (plan 0) period.
    uint256 public constant SUBSCRIPTION_PERIOD = 30 days;

    /// @notice Annual (plan 1) price in USDT base units. Owner-adjustable via
    ///         updateSubscriptionFees; initialized to 1,500 USDT at deploy (two months
    ///         free vs. monthly).
    uint256 public SUBSCRIPTION_PRICE_ANNUAL;

    /// @notice Annual (plan 1) period.
    uint256 public constant SUBSCRIPTION_PERIOD_ANNUAL = 365 days;

    /// @notice Unix timestamp at which each subscriber's access lapses. Written by
    ///         subscribe(); read by the off-chain gate via isSubscriptionActive().
    mapping(address => uint256) public subscriptionExpiresAt;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    /// @notice Emitted once per successful subscription payment.
    event SubscriptionPaid(address indexed subscriber, uint256 amount, uint256 timestamp, uint256 expirationTime);

    /// @notice Emitted when the owner changes the subscription fees.
    event SubscriptionFeesUpdated(uint256 newMonthly, uint256 newAnnual);

    /// @notice Emitted when ownership is transferred (including the initial constructor grant).
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    /// @notice Emitted when the owner redirects the subscription-fee treasury. Only our own
    ///         revenue destination moves; user funds and the disperse path are untouched.
    event TreasuryWalletUpdated(address indexed previousTreasury, address indexed newTreasury);

    /// @notice Emitted once per successful batch. Per-recipient traceability is left
    ///         to the token's own Transfer events. Signature preserved from the prior
    ///         PurseDisperseUsdt contract so existing consumers keep decoding it.
    event Dispersed(address indexed payer, address indexed token, uint256 recipientCount, uint256 totalAmount);

    // -------------------------------------------------------------------------
    // Errors (disperse-guard signatures preserved from PurseDisperseUsdt —
    // the frontend decodes these exact 4-byte selectors)
    // -------------------------------------------------------------------------

    error LengthMismatch(uint256 recipientsLength, uint256 amountsLength);
    error EmptyBatch();
    error ZeroAddressRecipient(uint256 index);
    error ZeroAmount(uint256 index);
    /// @dev Raised when a token transfer fails (reverts, or returns false).
    error TransferFailed(address token, address from, address to, uint256 amount);
    /// @dev Constructor guard: neither immutable may be the zero address.
    error ZeroAddressConfig();
    /// @dev subscribe() called with an unknown plan (only 0 = monthly, 1 = annual exist).
    error InvalidPlan(uint8 planType);
    /// @dev An owner-only function was called by a non-owner.
    error NotOwner();

    // -------------------------------------------------------------------------
    // Modifiers
    // -------------------------------------------------------------------------

    /// @dev Restricts a call to {owner}. The owner governs only the subscription fees.
    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /**
     * @param _usdt           The USDT-TRC20 token subscriptions are charged in.
     * @param _treasuryWallet The cold wallet subscription fees are forwarded to.
     * @dev   The deployer becomes {owner}. Subscription fees start at 150 USDT monthly /
     *        1,500 USDT annual and can later be adjusted by the owner.
     */
    constructor(address _usdt, address _treasuryWallet) {
        if (_usdt == address(0) || _treasuryWallet == address(0)) {
            revert ZeroAddressConfig();
        }
        usdt = _usdt;
        treasuryWallet = _treasuryWallet;

        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);

        SUBSCRIPTION_PRICE = 150 * 10 ** 6;
        SUBSCRIPTION_PRICE_ANNUAL = 1500 * 10 ** 6;
    }

    // -------------------------------------------------------------------------
    // Subscription
    // -------------------------------------------------------------------------

    /**
     * @notice Pay for one subscription period on a fixed plan. Pulls EXACTLY the
     *         plan's price from the caller and forwards it, atomically, to
     *         {treasuryWallet}.
     * @param  planType 0 = monthly ({SUBSCRIPTION_PRICE} / {SUBSCRIPTION_PERIOD}),
     *         1 = annual ({SUBSCRIPTION_PRICE_ANNUAL} / {SUBSCRIPTION_PERIOD_ANNUAL}).
     *         Any other value reverts {InvalidPlan} — the set of plans is fixed (0/1);
     *         only the owner may adjust a plan's PRICE (never add/remove a plan, never
     *         alter a period), and the charge is always read live from storage.
     * @dev    The caller must have approved this contract for at least the plan's
     *         price on {usdt}. If the transfer fails (insufficient balance or
     *         allowance), the whole transaction reverts and no subscription is
     *         granted — you cannot subscribe by paying less; the contract only ever
     *         pulls the fixed price, so you can never pay more. The expiry is set to
     *         `now + period` (reset-from-now). Effect (expiry write) precedes the
     *         interaction (CEI); a failed transfer rolls the expiry write back.
     */
    function subscribe(uint8 planType) external {
        uint256 price;
        uint256 period;
        if (planType == 0) {
            price = SUBSCRIPTION_PRICE;
            period = SUBSCRIPTION_PERIOD;
        } else if (planType == 1) {
            price = SUBSCRIPTION_PRICE_ANNUAL;
            period = SUBSCRIPTION_PERIOD_ANNUAL;
        } else {
            revert InvalidPlan(planType);
        }

        uint256 expiration = block.timestamp + period;
        subscriptionExpiresAt[msg.sender] = expiration;

        _safeTransferFrom(usdt, msg.sender, treasuryWallet, price);

        emit SubscriptionPaid(msg.sender, price, block.timestamp, expiration);
    }

    /// @notice True while `account` has an unexpired subscription. Convenience read
    ///         for the off-chain gate.
    function isSubscriptionActive(address account) external view returns (bool) {
        return subscriptionExpiresAt[account] > block.timestamp;
    }

    // -------------------------------------------------------------------------
    // Owner administration (subscription fees only — never funds/keys/disperse)
    // -------------------------------------------------------------------------

    /**
     * @notice Set the monthly and annual subscription prices (USDT base units, 6 dp).
     *         Applies to every subsequent subscribe(); existing subscriptions and the
     *         disperse path are untouched. This is the ONLY value the owner controls —
     *         it can never move funds, hold custody, pause, or alter disperse.
     * @param  _newMonthly New plan-0 price in base units.
     * @param  _newAnnual  New plan-1 price in base units.
     */
    function updateSubscriptionFees(uint256 _newMonthly, uint256 _newAnnual) external onlyOwner {
        SUBSCRIPTION_PRICE = _newMonthly;
        SUBSCRIPTION_PRICE_ANNUAL = _newAnnual;
        emit SubscriptionFeesUpdated(_newMonthly, _newAnnual);
    }

    /**
     * @notice Redirect where future subscription fees are sent. Applies to every subsequent
     *         subscribe(); it moves ONLY our own revenue destination — it can never reach user
     *         funds, custody, keys, broadcast, pause, or disperse(). This exists so the treasury
     *         can be hardened to a cold/multisig wallet WITHOUT a redeploy (a redeploy would
     *         destroy every subscriber's expiry). Guards the zero address (`ZeroAddressConfig`).
     * @param  _newTreasury The wallet future subscription fees are forwarded to.
     */
    function updateTreasuryWallet(address _newTreasury) external onlyOwner {
        if (_newTreasury == address(0)) revert ZeroAddressConfig();
        address previous = treasuryWallet;
        treasuryWallet = _newTreasury;
        emit TreasuryWalletUpdated(previous, _newTreasury);
    }

    /**
     * @notice Transfer the owner role. Guards against the zero address so fee control
     *         can never be permanently locked. (There is no renounce.)
     * @param  newOwner The account that will hold the owner role.
     */
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddressConfig();
        address previous = owner;
        owner = newOwner;
        emit OwnershipTransferred(previous, newOwner);
    }

    // -------------------------------------------------------------------------
    // Disperse (free utility — no fee, no retained funds)
    // -------------------------------------------------------------------------

    /**
     * @notice Batch-pay `recipients[i]` exactly `amounts[i]` of `token`, all pulled
     *         from the caller. Atomic: every transfer succeeds or the whole call
     *         reverts. The contract never touches the funds — each transfer moves
     *         value directly from the caller to a recipient.
     * @param token      TRC-20 token to pay in (USDT in production).
     * @param recipients Payee addresses; must be non-zero and length-matched to `amounts`.
     * @param amounts    Base-unit amounts (6-dp for USDT); each must be non-zero.
     */
    function disperse(address token, address[] calldata recipients, uint256[] calldata amounts) external {
        uint256 len = recipients.length;

        if (len != amounts.length) {
            revert LengthMismatch(len, amounts.length);
        }
        if (len == 0) {
            revert EmptyBatch();
        }

        uint256 total = 0;

        for (uint256 i = 0; i < len; i++) {
            address recipient = recipients[i];
            uint256 amount = amounts[i];

            if (recipient == address(0)) {
                revert ZeroAddressRecipient(i);
            }
            if (amount == 0) {
                revert ZeroAmount(i);
            }

            _safeTransferFrom(token, msg.sender, recipient, amount);

            total += amount;
        }

        emit Dispersed(msg.sender, token, len, total);
    }

    // -------------------------------------------------------------------------
    // Internal
    // -------------------------------------------------------------------------

    /**
     * @dev Call transferFrom and treat the token as failed if the call reverts OR
     *      returns non-empty data that decodes to false. Mirrors OpenZeppelin's
     *      SafeERC20 semantics (tolerates tokens that return nothing or false)
     *      without pulling in the dependency.
     */
    function _safeTransferFrom(address token, address from, address to, uint256 amount) private {
        (bool success, bytes memory data) =
            token.call(abi.encodeWithSelector(ITRC20.transferFrom.selector, from, to, amount));

        if (!success || (data.length != 0 && !abi.decode(data, (bool)))) {
            revert TransferFailed(token, from, to, amount);
        }
    }
}
