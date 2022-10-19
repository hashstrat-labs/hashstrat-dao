// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.14;

import "@openzeppelin/contracts/governance/TimelockController.sol";

contract HashStratTimelockController is TimelockController {

    // minDelay, initial array of proposers, initial array of executors
    constructor( uint256 minDelay ) TimelockController(minDelay, new address[](0) , new address[](0) ) { }

}