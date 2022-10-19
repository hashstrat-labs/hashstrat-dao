// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.14;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@chainlink/contracts/src/v0.8/AutomationCompatible.sol";

import "./IPoolV3.sol";
import "./ITreasury.sol";
import "./IDivsDistributor.sol";
import "./IHashStratDAOTokenFarm.sol";
import "./IOwnable.sol";

/**
 * This contract implements the DAO functions executable via DAO proposals.
 *
 * The Owner of this contact should be HashStratTimelockController
 * that will be the executor of all voted proposals.
 */

contract DAOOperations is Ownable, AutomationCompatibleInterface {


    uint public immutable PERC_DECIMALS = 4;
    uint public immutable MAX_POOL_FEE_PERC = 500; // 5% max fee

    uint public divsPerc = 1000; // 100% fees distributed as divs
    uint public totalFeesCollected;
    uint public totalFeesTransferred;

    uint public upkeepInterval = 1 * 24 * 60 * 60;
    uint public lastUpkeepTimestamp;

    bool public ownershipTransferEnabled = true;
    bool public updatesEnabled = true; 

    IERC20Metadata public feesToken;
    ITreasury public treasury;
    IDivsDistributor public divsDistributor;
    IHashStratDAOTokenFarm public tokenFarm;


    // the addresses of LP tokens of the HashStrat Pools and Indexes supported
    address[] private poolsArray;
    mapping(address => bool) private enabledPools;
    uint private enabledPoolsCount;

    address[] private indexesArray;
    mapping(address => bool) private enabledIndexes;
    uint private enabledIndexesCount;


    constructor(
        address feesTokenAddress, 
        address treasuryAddress, 
        address divsDistributorAddress,
        address tokenFarmAddress

        ) {

        treasury = ITreasury(treasuryAddress);
        feesToken = IERC20Metadata(feesTokenAddress);
        divsDistributor = IDivsDistributor(divsDistributorAddress);
        tokenFarm = IHashStratDAOTokenFarm(tokenFarmAddress);

        lastUpkeepTimestamp = block.timestamp;
    }


    //// Public View function ////

    function getPools() external view returns (address[] memory) {
        return poolsArray;
    }


    function getEnabledPools() external view returns (address[] memory) {
        address[] memory enabled = new address[] (enabledPoolsCount);
        uint count = 0;
        for (uint i=0; i<poolsArray.length; i++) {
            address poolAddress = poolsArray[i];
            if (enabledPools[poolAddress] == true) {
                enabled[count] = poolAddress;
                count++;
            }
        }

        return poolsArray;
    }

    function getEnabledIndexes() external view returns (address[] memory) {
        address[] memory enabled = new address[] (enabledIndexesCount);
        uint count = 0;
        for (uint i=0; i<indexesArray.length; i++) {
            address indexAddress = indexesArray[i];
            if (enabledIndexes[indexAddress] == true) {
                enabled[count] = indexAddress;
                count++;
            }
        }

        return indexesArray;
    }



    //// Public functions ////

    // Collect fees from all Pools and transfer them to the Treasury
    function collectFees() public {
        for (uint i=0; i<poolsArray.length; i++) {
            if (enabledPools[poolsArray[i]]) {
                IPoolV3 pool = IPoolV3(poolsArray[i]);
                uint before = feesToken.balanceOf(address(this));
                pool.collectFees(0);  // withdraw fees (converted to stable asset) to this contract
                uint collectedAmount = feesToken.balanceOf(address(this)) - before;
                if (collectedAmount > 0) {
                    totalFeesCollected += collectedAmount;
                    feesToken.transfer(address(treasury), collectedAmount);
                }
            }
        }
    }


    // Returns the value of the LP tokens held in the pools
    function collectableFees() public view returns (uint) {
        uint total = 0;
        for (uint i=0; i<poolsArray.length; i++) {
            if (enabledPools[poolsArray[i]]) {
                IPoolV3 pool = IPoolV3(poolsArray[i]);
                uint feeValue = pool.portfolioValue(address(pool));
                total += feeValue;
            }
        }

        return total;
    }



    //// DAO operations ////

    function setDivsPerc(uint divsPercentage) external onlyOwner {
        require(divsPercentage >= 0 && divsPercentage <= (10 ** PERC_DECIMALS), "invalid percentage");
        
        divsPerc = divsPercentage;
    }


    // DivsDistributor operations
    function setDivsDistributionInterval(uint blocks) external onlyOwner {
        divsDistributor.setDivsDistributionInterval(blocks);
    }


    // Treasury operations
    function transferFunds(address to, uint amount) external onlyOwner {
        require (amount <= feesToken.balanceOf(address(treasury)) , "Excessive amount");
        if (amount > 0) {
            totalFeesTransferred += amount;
            treasury.transferFunds(to, amount);
        }
    }


    // Pool operations

    function setFeesPerc(address poolAddress, uint feesPerc) external onlyOwner {
        require(feesPerc <= MAX_POOL_FEE_PERC, "Fee percentage too high");

        IPoolV3(poolAddress).setFeesPerc(feesPerc);
    }

    function setSlippageThereshold(address poolAddress, uint slippage) external onlyOwner {
        IPoolV3(poolAddress).setSlippageThereshold(slippage);
    }

    function setStrategy(address poolAddress, address strategyAddress) external onlyOwner {
        IPoolV3(poolAddress).setStrategy(strategyAddress);
    }

    function setPoolUpkeepInterval(address poolAddress, uint interval) external onlyOwner {
        IPoolV3(poolAddress).setUpkeepInterval(interval);
    }

    // update dependent contracts
    function setDivDistributor(address divDistributorAddress) external onlyOwner {
        require (updatesEnabled, "DAOOperations: updates are disabled");
        divsDistributor = IDivsDistributor(divDistributorAddress);
    }

    function setTreasury(address treasuryAddress) external onlyOwner {
        require (updatesEnabled, "DAOOperations: updates are disabled");
        treasury = ITreasury(treasuryAddress);
    }


    // Pools & Index management
    function addPools(address[] memory poolAddresses) external onlyOwner {
        for (uint i=0; i<poolAddresses.length; i++) {
            address poolAddress = poolAddresses[i];
            if (enabledPools[poolAddress] == false) {
                enabledPools[poolAddress] = true;
                poolsArray.push(poolAddress);
                enabledPoolsCount++;
            }
        }

        tokenFarm.addPools(poolAddresses);
    }

    function removePools(address[] memory poolAddresses) external onlyOwner {

        for (uint i=0; i<poolAddresses.length; i++) {
            address poolAddress = poolAddresses[i];
            if (enabledPools[poolAddress] == true) {
                enabledPools[poolAddress] = false;
                enabledPoolsCount--;
            }
        }

        tokenFarm.removePools(poolAddresses);
    }

    function addIndexes(address[] memory indexesAddresses) external onlyOwner {
        for (uint i=0; i<indexesAddresses.length; i++) {
            address indexAddress = indexesAddresses[i];
            if (enabledIndexes[indexAddress] == false) {
                enabledIndexes[indexAddress] = true;
                indexesArray.push(indexAddress);
                enabledIndexesCount++;
            }
        }

        tokenFarm.addPools(indexesAddresses);
    }

    function removeIndexes(address[] memory indexesAddresses) external onlyOwner {
        for (uint i=0; i<indexesAddresses.length; i++) {
            address indexAddress = indexesAddresses[i];
            if (enabledIndexes[indexAddress] == true) {
                enabledIndexes[indexAddress] = false;
                enabledIndexesCount--;
            }
        }

        tokenFarm.removePools(indexesAddresses);
    }


    //// AutomationCompatible

    function setUpkeepInterval(uint _upkeepInterval) public onlyOwner {
        upkeepInterval = _upkeepInterval;
    }

    function checkUpkeep(bytes calldata /* checkData */) external view override returns (bool upkeepNeeded, bytes memory performData) {
        bool timeElapsed = (block.timestamp - lastUpkeepTimestamp) >= upkeepInterval;
        upkeepNeeded = (timeElapsed && collectableFees() > 0) || divsDistributor.canCreateNewDistributionInterval();
        
        return (upkeepNeeded, "");
    }


    // Transfer recent fees from Pools to Treasury and create a new distribution interval
    function performUpkeep(bytes calldata /* performData */) external override {
        bool timeElapsed = (block.timestamp - lastUpkeepTimestamp) >= upkeepInterval;
        if ( (timeElapsed && collectableFees() > 0) || divsDistributor.canCreateNewDistributionInterval() ) {
            
            // transfer new fees from pools to the Treasury
            uint trasuryBalanceBefore = feesToken.balanceOf(address(treasury));
            collectFees();
            uint collected = feesToken.balanceOf(address(treasury)) - trasuryBalanceBefore;

            // transfer % of fees to distribute to DivsDistributor
            uint divsToDistribute = collected * divsPerc / 10 ** PERC_DECIMALS;
            if (divsToDistribute > 0) {
                treasury.transferFunds(address(divsDistributor), divsToDistribute);
            }

            // create new distribution interval if possible
            if (divsDistributor.canCreateNewDistributionInterval() ) {
                divsDistributor.addDistributionInterval();
            }
        }

        lastUpkeepTimestamp = block.timestamp;
    }


    ///// Ownership transfer Functionality   /////

    function setOwnerships(address[] memory oldOwners, address newOwner) external onlyOwner {
        require(ownershipTransferEnabled, "DAOOperations: Ownership transfer is disabled");

        for (uint i=0; i<oldOwners.length; i++) {
            IOwnable(oldOwners[i]).transferOwnership(newOwner);
        }
    }

    function disableOwnershipTransfers() external onlyOwner {
        ownershipTransferEnabled = false;
    }

    function disableUpdates() external onlyOwner {
        updatesEnabled = false;
    }

}
