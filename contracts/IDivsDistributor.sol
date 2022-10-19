// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.14;


interface IDivsDistributor {

    function canCreateNewDistributionInterval() external view returns (bool);
    function addDistributionInterval() external;
    function setDivsDistributionInterval(uint blocks) external;
}