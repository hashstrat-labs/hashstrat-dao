// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.14;

interface ITreasury {

    function getBalance() external view returns (uint);
    function transferFunds(address to, uint amount) external;
}