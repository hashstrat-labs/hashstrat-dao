// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.14;
pragma abicoder v2;


import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "./StakingPool.sol";
import "./IHashStratDAOToken.sol";


/**
 * A Farm contract to distribute HashStrat DAO tokens among LP token stakers proportionally to the amount and duration of the their stakes.
 * Users are free to add and remove tokens to their stake at any time.
 * Users can also claim their pending HashStrat DAO tokens at any time.
 *
 * The contract implements an efficient O(1) algo to distribute the rewards based on this paper:
 * https://uploads-ssl.webflow.com/5ad71ffeb79acc67c8bcdaba/5ad8d1193a40977462982470_scalable-reward-distribution-paper.pdf
 *
 * Owner of this contract should be DAOOperations to add (and remvoe) supported LP tokens
 *
 */

contract HashStratDAOTokenFarm is StakingPool {

    event RewardPaid(address indexed user, uint256 reward);

    uint public totalStakedValue; // T: sum of the initial value of all active stakes
    uint public rewardPerValueStaked; // S: SUM(reward/T) - sum of all rewards distributed divided all active stakes
    uint public lastUpdated;  // when the totalStakedWeight was last updated (after last stake was ended)


    struct RewardPeriod {
        uint id;
        uint reward;
        uint from;
        uint to;
        uint totalRewardsPaid; 
    }

    struct UserInfo {
        uint stakedLPValue;    // the initial value of the LP staked
        uint userRewardPerTokenStaked;
        uint pendingRewards;
        uint rewardsPaid;
    }

    struct RewardsStats {
        // user stats
        uint claimableRewards;
        uint rewardsPaid;
        // general stats
        uint rewardRate;
        uint totalRewardsPaid;
    }

    // The DAO token to distribute to stakers
    IHashStratDAOToken immutable public hstToken;

    // Fixed amount of token distributed over the 10 periods
    uint public immutable REWARD_PERIODS = 10;
    uint public immutable TOKEN_MAX_SUPPLY;


    RewardPeriod[] public rewardPeriods;
    mapping(address => UserInfo) userInfos;
    uint constant rewardPrecision = 1e9;
    uint public tokensFarmed;

   
    constructor(address hstTokenAddress) StakingPool() {
        hstToken = IHashStratDAOToken(hstTokenAddress);
        TOKEN_MAX_SUPPLY = hstToken.maxSupply();
    }


    //// Public View Functions ////

    function getRewardPeriods() public view returns (RewardPeriod[] memory) {
        return rewardPeriods;
    }


    function rewardPeriodsCount()  public view returns (uint) {
        return rewardPeriods.length;
    }


    function hstTokenBalance() public view returns (uint) {
        return hstToken.balanceOf(address(this));
    }


    // return the id of the last reward period that started before current block.timestamp
    // assumes reward periods are chronologically ordered
    function getLastRewardPeriodId() public view returns (uint) {
        if (REWARD_PERIODS == 0) return 0;
        for (uint i=rewardPeriods.length; i>0; i--) {
            RewardPeriod memory period = rewardPeriods[i-1];
            if (period.from <= block.timestamp) {
                return period.id;
            }
        }
        return 0;
    }


    function getRewardsStats(address account) public view returns (RewardsStats memory) {
        UserInfo memory userInfo = userInfos[msg.sender];

        RewardsStats memory stats = RewardsStats(0, 0, 0, 0);
        // user stats
        stats.claimableRewards = claimableReward(account);
        stats.rewardsPaid = userInfo.rewardsPaid;

        // reward period stats
        uint periodId = getLastRewardPeriodId();
        if (periodId > 0) {
            RewardPeriod memory period = rewardPeriods[periodId-1];
            stats.rewardRate = rewardRate(period);
            stats.totalRewardsPaid = period.totalRewardsPaid;
        }

        return stats;
    }

    
   
    //// Public Functions ////

    function startStake(address lpToken, uint amount) public override {

        address pool = lptokenToPool[lpToken];
        require(pool != address(0), "No pool found for LP token");

        uint periodId = getLastRewardPeriodId();
        RewardPeriod memory period = rewardPeriods[periodId-1];
        require(periodId > 0 && period.from <= block.timestamp, "No active reward period found");

        uint stakedValue = IPoolV3(pool).lpTokensValue(amount);

        update();
        super.startStake(lpToken, amount);

        UserInfo storage userInfo = userInfos[msg.sender];  
        userInfo.stakedLPValue += stakedValue;
        totalStakedValue += stakedValue;
    }


    function endStake(address lpToken, uint amount) public override {

        uint staked = getStakedBalance(msg.sender, lpToken);

        // percentage of staked lp tokens that is being unstaked
        uint percUnstake = amount <= staked ?  rewardPrecision * amount / staked  : rewardPrecision;

        UserInfo storage userInfo = userInfos[msg.sender]; 
        uint valueUnstaked = userInfo.stakedLPValue * percUnstake / rewardPrecision;

        update();
        super.endStake(lpToken, amount);
        
        userInfo.stakedLPValue -= (valueUnstaked <= userInfo.stakedLPValue) ? valueUnstaked : userInfo.stakedLPValue;
        totalStakedValue -= (valueUnstaked <= totalStakedValue) ? valueUnstaked : totalStakedValue;

        claim();

    }


    function claimableReward(address account) public view returns (uint) {
        uint periodId = getLastRewardPeriodId();
        if (periodId == 0) return 0;

        RewardPeriod memory period = rewardPeriods[periodId-1];
        uint newRewardPerValueStaked = calculateRewardDistribution(period);
        uint reward = calculateReward(account, newRewardPerValueStaked);

        UserInfo memory userInfo = userInfos[account];
        uint pending = userInfo.pendingRewards;

        return pending + reward;
    }

 
    function claimReward() public {
        update();
        claim();
    }


    function addRewardPeriods() public  {
        require(rewardPeriods.length == 0, "Reward periods already set");

        // firt year reward is 500k tokens halving every following year
        uint initialRewardAmount = TOKEN_MAX_SUPPLY / 2;
        
        uint secondsInYear = 365 * 24 * 60 * 60;

        uint rewardAmount = initialRewardAmount;
        uint from = block.timestamp;
        uint to = from + secondsInYear - 1;
        
        // create all distribution periods
        uint totalAmount = 0;
        for (uint i=0; i<REWARD_PERIODS; i++) {
            if (i == (REWARD_PERIODS-1)) {
                rewardAmount = TOKEN_MAX_SUPPLY - totalAmount;
            }
            addRewardPeriod(rewardAmount, from, to);

            totalAmount += rewardAmount;
            from = (to + 1);
            to = (from + secondsInYear - 1);
            rewardAmount /= 2;
        }
    }



    //// INTERNAL FUNCTIONS ////

    function claim() internal {

        UserInfo storage userInfo = userInfos[msg.sender];
        uint rewardsToPay = userInfo.pendingRewards;

        if (rewardsToPay != 0) {
            userInfo.pendingRewards = 0;

            uint periodId = getLastRewardPeriodId();
            RewardPeriod storage period = rewardPeriods[periodId-1];
            period.totalRewardsPaid += rewardsToPay;

            // set the sender as delegate if none is set
            if (hstToken.delegates(msg.sender) == address(0)) {
                hstToken.delegate(msg.sender, msg.sender);
            }

            payReward(msg.sender, rewardsToPay);
        }
    }


    function payReward(address account, uint reward) internal {
        UserInfo storage userInfo = userInfos[msg.sender];
        userInfo.rewardsPaid += reward;
        tokensFarmed += reward;

        hstToken.mint(account, reward);

        emit RewardPaid(account, reward);
    }


    function addRewardPeriod(uint reward, uint from, uint to) internal {
        require(reward > 0, "Invalid reward amount");
        require(to > from && to > block.timestamp, "Invalid period interval");
        require(rewardPeriods.length == 0 || from > rewardPeriods[rewardPeriods.length-1].to, "Invalid period start time");

        rewardPeriods.push(RewardPeriod(rewardPeriods.length+1, reward, from, to, 0));
    }



    /// Reward calcualtion logic


    // calculate the updated average rate of reward to be distributed from from 'lastUpdated' to min(block.timestamp, period.to)
    function rewardRate(RewardPeriod memory last) internal view returns (uint) {

        uint from = lastUpdated;
        uint to = lastUpdated;
        uint reward;
     
        // cycle through all period and deterine the reward to be distributed and the interval
        uint i=0;
        while (i < rewardPeriods.length && rewardPeriods[i].id <= last.id) {

            RewardPeriod memory period = rewardPeriods[i];

            if (lastUpdated <= period.to && block.timestamp >= period.from ) {
                uint start = Math.max(lastUpdated, period.from); // lastUpdated > period.from ? lastUpdated : period.from; // start at max(lastUpdated or period.from),
                uint end = Math.min(block.timestamp, period.to); // block.timestamp > period.to ? period.to : block.timestamp; // end at min(block.timestamp or period.to)
                
                uint interval = end - start;
                uint periodRate = period.reward / (period.to - period.from);
                uint rewardForInterval = interval * periodRate;

                reward += rewardForInterval;
                to = Math.max(to, end);
            }

            i++;
        }
        
        uint rate = (to > from) ? reward / (to - from) : 0;
        return rate;
    }


    function update() internal {
        
        uint periodId = getLastRewardPeriodId();
        if (periodId == 0) return;

        RewardPeriod storage period = rewardPeriods[periodId-1];
        uint newRewardPerValueStaked = calculateRewardDistribution(period);

        // update pending rewards reward since rewardPerValueStaked was updated
        uint reward = calculateReward(msg.sender, newRewardPerValueStaked);
        UserInfo storage userInfo = userInfos[msg.sender];
        userInfo.pendingRewards += reward;
        userInfo.userRewardPerTokenStaked = newRewardPerValueStaked;

        require(newRewardPerValueStaked >= rewardPerValueStaked, "Reward distribution should be monotonic increasing");

        rewardPerValueStaked = newRewardPerValueStaked;
        lastUpdated = block.timestamp;
    }


    // Returns the reward for one unit of value staked from 'lastUpdated' up to the 'period 'provided
    function calculateRewardDistribution(RewardPeriod memory period) internal view returns (uint) {

        // calculate an updated average rate of the reward/second to be distributed since lastUpdated
        uint rate = rewardRate(period);

      
        // calculate the amount of additional reward to be distributed from 'lastUpdated' to min(block.timestamp, period.to)
        uint rewardIntervalEnd = block.timestamp > period.to ? period.to : block.timestamp;
        uint deltaTime = rewardIntervalEnd > lastUpdated ? rewardIntervalEnd - lastUpdated : 0;
        uint reward = deltaTime * rate; // the additional reward

        // S = S + r / T
        uint newRewardPerValueStaked = (totalStakedValue == 0)?  
                                        rewardPerValueStaked :
                                        rewardPerValueStaked + ( rewardPrecision * reward / totalStakedValue ); 

        return newRewardPerValueStaked;
    }


    // calculates the additional reward for the 'account' based on the 'rewardDistributionPerValue' 
    function calculateReward(address account, uint rewardDistributionPerValue) internal view returns (uint) {
        if (rewardDistributionPerValue == 0) return 0;

        UserInfo memory userInfo = userInfos[account];
        uint reward = (userInfo.stakedLPValue * (rewardDistributionPerValue - userInfo.userRewardPerTokenStaked)) / rewardPrecision;
        return reward;
    }

}

