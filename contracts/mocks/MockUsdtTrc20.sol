// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// Test-only scaffolding — never deployed to TRON. Stands in for the real
/// USDT-TRC20 contract in local Hardhat tests: 6 decimals (matching real USDT-TRC20
/// exactly, so the 6-decimal-correctness test is meaningful), standard
/// approve/transferFrom/balanceOf/allowance behavior via OpenZeppelin's audited
/// ERC20, plus an unrestricted `mint` for test setup. Allowance genuinely decrements
/// per transferFrom (no "infinite approval" special case), and insufficient
/// balance/allowance reverts — this is the "compliant" token used by all 7 required
/// test cases.
contract MockUsdtTrc20 is ERC20 {
    constructor() ERC20("Mock USDT (TRC20)", "mUSDT") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// Test-only scaffolding for the optional 8th test. A real, documented class of
/// non-compliant ERC20/TRC20 token returns `false` from `transferFrom` on failure
/// instead of reverting — this mock deliberately reproduces that behavior so the
/// test suite can prove `PurseDisperseUsdt`'s use of SafeERC20 (rather than a plain
/// interface call trusting revert-on-failure) actually catches it.
contract NonCompliantMockUsdtTrc20 {
    string public constant name = "Non-Compliant Mock USDT (TRC20)";
    string public constant symbol = "ncUSDT";

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function decimals() external pure returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    /// Deliberately non-compliant: returns false instead of reverting when the
    /// pull can't be satisfied, so callers that don't check the return value (or
    /// don't wrap it in SafeERC20) would silently treat this as a successful
    /// transfer even though no balance moved.
    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) external returns (bool) {
        if (balanceOf[from] < amount || allowance[from][msg.sender] < amount) {
            return false;
        }
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}
