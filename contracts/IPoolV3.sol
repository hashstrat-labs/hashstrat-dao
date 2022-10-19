// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.14;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/**
*  Pool's functionality required by DAOOperations and DAOFarm
*/

interface IPoolV3 {

    function lpToken() external view returns (IERC20Metadata);
    function lpTokensValue (uint lpTokens) external view returns (uint);

    function portfolioValue(address addr) external view returns (uint);
    function collectFees(uint amount) external;

    function setFeesPerc(uint feesPerc) external;
    function setSlippageThereshold(uint slippage) external;
    function setStrategy(address strategyAddress) external;
    function setUpkeepInterval(uint upkeepInterval) external;
}
