// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.14;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import "./ITreasury.sol";


/**
 * The DAO Treasury holds the funds collected from the Pools.
 * Owner of this contract should be DAOOperations to allow Governance to make payments
 *
*/

contract Treasury is ITreasury, Ownable {

    event FundsTransferred(address indexed recepient, uint amount);

    IERC20Metadata public paymentToken;
    Payment[] public payments;

    struct Payment {
        uint id;
        uint timestamp;
        uint amount;
        address recepient;
    }

    constructor(address tokenAddress) {
        paymentToken = IERC20Metadata(tokenAddress);
    }

    function getBalance() external view returns (uint) {
        return paymentToken.balanceOf(address(this));
    }

    function getPayments() public view returns (Payment[] memory) {
        return payments;
    }

    // used by DAOOperations to make payments
    function transferFunds(address to, uint amount) external onlyOwner {
        payments.push(Payment(payments.length+1, block.timestamp, amount, to));
        paymentToken.transfer(to, amount);

        emit FundsTransferred(to, amount);
    }

}